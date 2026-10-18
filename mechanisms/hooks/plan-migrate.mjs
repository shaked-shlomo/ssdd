// The mechanical half of the v3 plan migration (SPEC.md → v3 → Part 2,
// Clarify 15). Pure: no I/O, no git.
//
//   migratePlan(text)      criteria → `- **AC1** — …`; what changed; what's left
//   todoFor(text, opts)    what the agent pass still has to do for a plan
//   needsMigration(text)   "old format": criteria to rewrite, or a closed plan
//                          with an ID that has no Verification entry
//   lostText(old, new)     removed lines whose text the new file doesn't keep
//   idRange(ids)           ['AC1','AC2','AC3','AC5'] → 'AC1–AC3, AC5'
//
// Only top-level items of `## Acceptance criteria` change: the section's
// least-indented list lines, outside code fences. Checkboxes are dropped, IDs
// are kept (never renumbered), ID-less items are numbered after the highest
// ID. Verification sections are never touched; the agent pass cites IDs there.
import { AC_ID, CHECKBOX, parsePlan } from './plan-parse.mjs';

const CLOSED = new Set(['BUILT', 'SHIPPED']);
const LIST = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
const BOX = new RegExp(`^${CHECKBOX}[ \\t]+`);
const BOLD_HEAD = new RegExp(`^\\*\\*(${AC_ID})\\b(.*?)\\*\\*(.*)$`);
// `**AC7 — a title that wraps` (the bold closes on a continuation line).
const OPEN_BOLD = new RegExp(`^\\*\\*(${AC_ID})\\b(.*)$`);
const BARE_HEAD = new RegExp(`^(${AC_ID})\\b(.*)$`);
const SEP = /^\s*(?:[—–:.-](?=\s|$))?\s*/;
// One ID or a run of them (`AC1–AC3`, `AC1/AC2`), as a regex source.
const ID_RUN = `${AC_ID}(?:\\s*[–/,&-]\\s*${AC_ID})*\\b`;
const num = (id) => Number(/\d+/.exec(id)[0]);
// The IDs a run names: `AC1–AC3` → AC1, AC2, AC3; `AC2/AC3` → AC2, AC3.
function idsIn(run) {
  const parts = run.split(/\s*([–/,&-])\s*/);
  const ids = [];
  for (let k = 0; k < parts.length; k += 2) {
    const [prev, sep, id] = [parts[k - 2], parts[k - 1], parts[k]];
    if (prev && /[–-]/.test(sep) && /^AC\d+$/.test(prev) && /^AC\d+$/.test(id)) {
      for (let n = num(prev) + 1; n < num(id); n++) ids.push(`AC${n}`);
    }
    ids.push(id);
  }
  return ids;
}

// Lines without a BOM and with LF endings, plus how to put both back.
function split(text) {
  const s = String(text ?? '');
  const bom = s.startsWith('﻿') ? '﻿' : '';
  const crlf = /\r\n/.test(s);
  const lines = s.slice(bom.length).replace(/\r\n?/g, '\n').split('\n');
  return { lines, join: (ls) => bom + (crlf ? ls.join('\r\n') : ls.join('\n')) };
}

// Each line's `## ` section (lower case) and whether it sits in a code fence.
function scan(lines) {
  let section = null; let fence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return { section, fence: true }; }
    if (!fence && /^##[ \t]/.test(line) && !line.startsWith('###')) section = line.replace(/^##[ \t]+/, '').trim().toLowerCase();
    return { section, fence };
  });
}

// Top-level criteria: [{ i, indent, box, id, body }] — id null when the item has
// none; body is the text after the ID and its separator.
function criteriaItems(lines) {
  const where = scan(lines);
  const bySection = new Map();
  lines.forEach((line, i) => {
    const w = where[i];
    if (w.fence || !w.section?.startsWith('acceptance criteria') || /^##/.test(line)) return;
    const m = LIST.exec(line);
    if (!m) return;
    if (!bySection.has(w.section)) bySection.set(w.section, []);
    bySection.get(w.section).push({ i, indent: m[1], marker: m[2], rest: m[3] });
  });
  const items = [];
  for (const list of bySection.values()) {
    const min = Math.min(...list.map((x) => x.indent.length));
    for (const x of list.filter((y) => y.indent.length === min)) {
      let rest = x.rest; let box = null;
      const b = BOX.exec(rest);
      if (b) { box = rest[1]; rest = rest.slice(b[0].length); }
      if (rest.startsWith('<')) continue; // a template placeholder
      let id = null; let body = rest;
      const bold = BOLD_HEAD.exec(rest);
      const open = OPEN_BOLD.exec(rest);
      const bare = BARE_HEAD.exec(rest);
      if (bold) {
        const title = bold[2].replace(SEP, '').trim();
        id = bold[1];
        body = title ? `**${title}**${bold[3]}` : bold[3].replace(SEP, '');
      } else if (open) {
        id = open[1];
        body = `**${open[2].replace(SEP, '')}`;
      } else if (bare) {
        id = bare[1];
        body = bare[2].replace(SEP, '');
      }
      items.push({ i: x.i, indent: x.indent, box, id, body });
    }
  }
  return items.sort((a, b) => a.i - b.i);
}

export function idRange(ids) {
  const runs = [];
  for (const id of ids) {
    const last = runs.at(-1);
    const plain = /^AC\d+$/.test(id);
    if (last && plain && last.plain && num(id) === num(last.ids.at(-1)) + 1) last.ids.push(id);
    else runs.push({ plain, ids: [id] });
  }
  return runs.map((r) => (r.ids.length > 1 ? `${r.ids[0]}–${r.ids.at(-1)}` : r.ids[0])).join(', ');
}

const STATUS_CUT = 60;
// The agent's to-do for a plan as it now reads. ticked: IDs whose old checkbox
// claimed them done (an open plan needs entries only for those).
export function todoFor(text, { ticked = [] } = {}) {
  const { lines } = split(text);
  const p = parsePlan(lines.join('\n'));
  const todo = [];
  if (!p.status.word) {
    const raw = p.status.raw;
    todo.push(raw === null ? 'no Status line: add one of the six'
      : `Status "${raw.length > STATUS_CUT ? `${raw.slice(0, STATUS_CUT)}…` : raw}" isn't one of the six: pick one, checked against git`);
  }
  const ids = criteriaItems(lines).map((x) => x.id).filter(Boolean);
  const dups = [...new Set(ids.filter((id, k) => ids.indexOf(id) !== k))];
  if (dups.length) todo.push(`duplicate criterion IDs: ${dups.join(', ')}`);
  const claimed = !p.status.word || CLOSED.has(p.status.word) ? p.criteria : p.criteria.filter((id) => ticked.includes(id));
  const missing = claimed.filter((id) => !p.entries.has(id));
  if (missing.length) todo.push(`no Verification entry: ${idRange(missing)}`);
  const where = scan(lines);
  const head = new RegExp(`^\\s*(?:(?:[-*+]|\\d+[.)])\\s+)?(?:${CHECKBOX}\\s+)?(?:\\*\\*)?(${ID_RUN})`);
  const entry = new RegExp(`^\\s*[-*]\\s+(?:${CHECKBOX}\\s+)?\\*\\*${AC_ID}\\b`);
  const unparsed = [];
  lines.forEach((line, i) => {
    if (where[i].fence || !where[i].section?.startsWith('verification')) return;
    const m = head.exec(line);
    // A line the check can't read is left to do while a criterion it names has
    // no entry; a kept range line with one entry per ID after it is fine.
    const owed = (id) => p.criteria.includes(id) && !p.entries.has(id);
    if (m && (!entry.test(line) || /[–/,&-]/.test(m[1])) && idsIn(m[1]).some(owed)) unparsed.push(m[1]);
  });
  if (unparsed.length) todo.push(`Verification lines cite IDs the close check can't read: ${unparsed.join(', ')} (write - **AC1** — …, one ID per line)`);
  return todo;
}

export function migratePlan(text) {
  const { lines, join } = split(text);
  const items = criteriaItems(lines);
  const max = Math.max(0, ...items.filter((x) => x.id).map((x) => num(x.id)));
  const hadIds = items.some((x) => x.id);
  let next = max;
  const boxed = []; const reformatted = []; const numbered = []; const ticked = [];
  const out = [...lines];
  for (const x of items) {
    const id = x.id ?? `AC${++next}`;
    if (!x.id) numbered.push(id);
    if (x.box && x.box !== ' ' && x.box !== '-') ticked.push(id);
    const line = x.body ? `${x.indent}- **${id}** — ${x.body}` : `${x.indent}- **${id}**`;
    if (line === lines[x.i]) continue;
    out[x.i] = line;
    if (x.id && x.box !== null) boxed.push(id);
    else if (x.id) reformatted.push(id);
  }
  const changes = [];
  if (boxed.length) changes.push(`${idRange(boxed)}: checkbox dropped`);
  if (reformatted.length) changes.push(`${idRange(reformatted)}: reformatted`);
  if (numbered.length) changes.push(`numbered ${idRange(numbered)}${hadIds ? ' after the existing IDs' : ''}`);
  const changed = changes.length > 0;
  const newText = changed ? join(out) : String(text ?? '');
  const todo = todoFor(newText, { ticked });
  if (numbered.length) todo.push("criteria were unnumbered: references like \"criterion 3\" may need the ID");
  return { text: newText, changed, changes, ticked, todo };
}

export function needsMigration(text) {
  if (migratePlan(text).changed) return true;
  const p = parsePlan(text);
  return CLOSED.has(p.status.word) && p.criteria.some((id) => !p.entries.has(id));
}

// A line's text without its formatting: quote and list markers, checkbox,
// bold, a "Status:" label, leading IDs and ✅/❌/☐ and separators.
const ID_HEAD = new RegExp(`^${ID_RUN}`);
function bare(line) {
  return line
    .replace(/^\s*(?:>\s*)*/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(new RegExp(`^${CHECKBOX}\\s*`), '')
    .replace(/\*\*/g, '')
    .replace(/^Status:\s*/i, '')
    .replace(ID_HEAD, '')
    .replace(/^[\s✅❌☐]*/, '')
    .replace(/^[—–:.-]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lostText(oldText, newText) {
  const before = split(oldText).lines;
  const after = split(newText).lines;
  const left = new Map();
  for (const l of after) left.set(l, (left.get(l) ?? 0) + 1);
  const kept = after.map(bare).filter(Boolean).join(' ');
  const lost = [];
  for (const l of before) {
    if (left.get(l)) { left.set(l, left.get(l) - 1); continue; }
    const b = bare(l);
    if (b && !kept.includes(b)) lost.push(l);
  }
  return lost;
}
