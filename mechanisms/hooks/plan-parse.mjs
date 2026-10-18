// Turns SSDD plan and ledger text into data. Pure: no I/O, no git.
//
//   parseStatus(text)      the first `**Status:**` line and its status word
//   parsePlan(text)        status, AC IDs, Verification entries, open questions
//   parseSsddLedger(text)  task rows of an SSDD task ledger
//   parseProgress(text)    a Superpowers progress.md ledger
//   countPlanTasks(text)   `### Task N` headings (a Superpowers plan's tasks)
//
// Accepts the forms the injected projects already write: criteria as
// `- [ ] AC1 …` (prizma) or `- **AC1** — …`, entries as `- **AC1** — …` or
// `- **AC1 ✅ — …`. An ID may carry a letter (`AC8b`). A criterion may carry
// any checkbox (`[ ]`, `[x]`, `[~]`, `[-]`); an entry only a ticked one (`[x]`,
// `[~]`). Criteria are the top-level items of the criteria section, and a line
// in a code fence belongs to no section. CRLF and a leading BOM parse the same
// as LF.

// Matched in this order, so IN PROGRESS wins over a later word in the line.
export const STATUS_WORDS = ['IN PROGRESS', 'DRAFT', 'BUILT', 'SHIPPED', 'SUPERSEDED', 'ABANDONED'];
export const OPEN_WORDS = new Set(['DRAFT', 'IN PROGRESS', 'BUILT']);

const normalize = (text) => String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

export function parseStatus(text) {
  const m = /^[ \t]*(?:>[ \t]*)?\*\*Status:\*\*[ \t]*(.*)$/im.exec(normalize(text));
  if (!m) return { raw: null, word: null };
  const raw = m[1].trim();
  const upper = raw.toUpperCase();
  const word = STATUS_WORDS.find((w) => upper.startsWith(w) && !/^[A-Z0-9]/.test(upper.slice(w.length))) ?? null;
  return { raw, word };
}

// Each line's `## ` section (lower case), whether it sits in a code fence, and
// whether it is the heading itself. A `##` line inside a fence starts no
// section; `###` and deeper stay inside theirs.
export function scan(lines) {
  let section = null; let fence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return { section, fence: true }; }
    if (!fence && /^##[ \t]+\S/.test(line) && !line.startsWith('###')) {
      section = line.replace(/^##[ \t]+/, '').trim().toLowerCase();
      return { section, fence, heading: true };
    }
    return { section, fence };
  });
}

// `## Name` sections → [{ name, lines }], fenced lines left out.
function sections(lines) {
  const out = [];
  let cur = null;
  scan(lines).forEach((w, i) => {
    if (w.heading) { cur = { name: w.section, lines: [] }; out.push(cur); return; }
    if (cur && !w.fence) cur.lines.push(lines[i]);
  });
  return out;
}
const linesOf = (secs, prefix) => secs.filter((s) => s.name.startsWith(prefix)).flatMap((s) => s.lines);

// The criteria: list lines (`-`, `*`, `+`, `1.`) at each acceptance-criteria
// section's least indent, outside fences → [{ i, indent, marker, rest }]. A
// sub-bullet that names an ID ("AC5's follow-up") is not a criterion.
const LIST = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
export function criteriaLines(lines) {
  const where = scan(lines);
  const bySection = new Map();
  lines.forEach((line, i) => {
    const w = where[i];
    if (w.fence || w.heading || !w.section?.startsWith('acceptance criteria')) return;
    const m = LIST.exec(line);
    if (!m) return;
    if (!bySection.has(w.section)) bySection.set(w.section, []);
    bySection.get(w.section).push({ i, indent: m[1], marker: m[2], rest: m[3] });
  });
  const out = [];
  for (const list of bySection.values()) {
    const min = Math.min(...list.map((x) => x.indent.length));
    out.push(...list.filter((x) => x.indent.length === min));
  }
  return out.sort((a, b) => a.i - b.i);
}

// Regex sources shared with plan-migrate.mjs.
export const AC_ID = 'AC\\d+[a-z]?';
export const CHECKBOX = '\\[[ xX~-]\\]';
const CRITERION = new RegExp(`^\\s*[-*]\\s+(?:${CHECKBOX}\\s+)?(?:\\*\\*)?(${AC_ID})\\b`);
// An entry's checkbox, if it has one, is ticked: `- [ ] **AC1** — run the
// suite` is a check still to do, not a record of one. A head naming a run of
// IDs (`**AC1–AC3`, `**AC2/AC3`) is no ID's entry: each ID gets its own line
// (`/migrate-plans` adds one per ID after a kept run).
export const ENTRY = new RegExp(`^\\s*[-*]\\s+(?:\\[[xX~]\\]\\s+)?\\*\\*(${AC_ID})\\b(?!\\s*[–/,&-]\\s*AC\\d)`);
const ITEM = /^\s*(?:[-*]|\d+[.)])\s+(.*\S)/;

export function parsePlan(text) {
  const lines = normalize(text).split('\n');
  const secs = sections(lines);
  const criteria = [];
  for (const { i } of criteriaLines(lines)) {
    const m = CRITERION.exec(lines[i]);
    if (m && !criteria.includes(m[1])) criteria.push(m[1]);
  }
  const entries = new Map();
  for (const line of linesOf(secs, 'verification')) {
    const m = ENTRY.exec(line);
    if (m && !entries.has(m[1])) entries.set(m[1], { deferred: /\bDEFERRED\b/.test(line), notRecorded: /\bNOT RECORDED\b/.test(line) });
  }
  let openQuestions = 0;
  for (const line of linesOf(secs, 'open questions')) {
    const m = ITEM.exec(line);
    if (m && !m[1].startsWith('<') && !/^(none|n\/a)\b/i.test(m[1])) openQuestions++;
  }
  return { status: parseStatus(text), criteria, entries, openQuestions };
}

function cut(s, max) {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const at = head.search(/\s\S*$/);
  return (at > 0 ? head.slice(0, at) : head).trimEnd();
}

export function parseSsddLedger(text) {
  let done = 0; let total = 0; let next = null;
  for (const line of normalize(text).split('\n')) {
    const m = /^\s*-\s+\[( |x|X)\]\s+(Task\s+\d+.*?)\s*$/.exec(line);
    if (!m) continue;
    total++;
    if (m[1] !== ' ') done++;
    else if (next === null) next = cut(m[2].replace(/\*\*|`/g, ''), 60);
  }
  return { done, total, next };
}

export function parseProgress(text) {
  const lines = normalize(text).split('\n');
  const first = lines.find((l) => l.trim()) ?? '';
  const id = /^#\s*SDD ledger\s*[—–-]+\s*plan:\s*(.+?)\s*$/.exec(first);
  let done = 0;
  for (const l of lines) {
    const m = /^Task (\d+): complete\b/.exec(l);
    if (m) done = Math.max(done, Number(m[1]));
  }
  const last = [...lines].reverse().find((l) => l.trim()) ?? '';
  const fix = /^Task (\d+): fix round\b/.exec(last);
  return { plan: id ? id[1] : null, done, inReview: fix ? Number(fix[1]) : null };
}

export const countPlanTasks = (text) => (normalize(text).match(/^### Task \d+\b/gm) ?? []).length;
