// A reviewer's reply → its verdict, its findings and its answers to findings
// it was given (spec v3.5, Decision 2, Clarify 2). Pure: no fs, no git. The
// review gate reads it from the report `--stamp --report <file>` is handed.
//
// The verdict is one of the last three non-empty lines: CLEAN / SECURE /
// N ISSUE(S) / N RISK(S). NO DIFF, or no verdict, is an error, and the gate
// stamps nothing.
//
// A finding is a line that starts with ❌ or ⚠️ once its leading markup is
// dropped (whitespace, `>`, `#`, `|`, a list marker, a number `1.`, bold,
// backticks), so "0 ❌, 4 ⚠️" in prose isn't one. After the mark, an optional
// `[pre-existing]` tag. Its place is the first `path:line` (or `path:line-line`)
// on its line, else on the lines after it up to the next mark, heading or
// blank line, else a bare `dir/file.ext` on its line, else none.
//
// An answer is `✅ [F<n>]` (fixed) or `❌ [F<n>] …` (still open): neither is
// a new finding. Real replies vary (reviewers write findings as headings,
// bold, bullets, tables), so the parse is tolerant, and a count that doesn't
// match the verdict's N is the gate's note to print, not an error here.

const LEAD = /^[\s>#*_`|+-]*(?:\d+[.)]\s*)?[\s*_`]*/;
const MARK = /^(❌|⚠️?|✅)️?/;
const BRACKET = /^[\s*_`]*\[(pre-existing|F\d+)\][\s*_`]*/i;
const MAX_TEXT = 300;

const plain = (s) => String(s).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const markOf = (line) => MARK.exec(line.replace(LEAD, ''))?.[1];

// → { verdict, issues, index } | { noDiff: true } | null, over lines.
function findVerdict(lines) {
  const tail = [];
  for (let i = lines.length - 1; i >= 0 && tail.length < 3; i--) {
    const l = lines[i].replace(/[*`_>#]/g, '').trim();
    if (l) tail.push([l, i]);
  }
  for (const [l, index] of tail) {
    if (/\bNO DIFF\b/.test(l)) return { noDiff: true };
    const clean = /^(?:verdict\W*)?(CLEAN|SECURE)\b/i.exec(l);
    if (clean) return { verdict: clean[1].toUpperCase(), issues: 0, index };
    const n = /^(?:verdict\W*)?(\d+)\s+(ISSUE|RISK)(?:\(S\)|S)?\b/i.exec(l);
    if (n) return { verdict: `${n[2].toUpperCase()}S`, issues: Number(n[1]), index };
  }
  return null;
}

export function parseVerdict(text) {
  const v = findVerdict(String(text ?? '').split(/\r?\n/));
  return v && !v.noDiff ? { verdict: v.verdict, issues: v.issues } : null;
}

// The first `path:line[-line]` in a line → { path, line } | null. A backticked
// span holding only path characters is taken whole (a path may hold a
// space); elsewhere a path is a run of
// path characters with a `/` or a file extension, so `10:30` isn't one.
const SPAN = /`([^`]+?):(\d+)(?:\s*[-–]\s*(\d+))?`/;
const BARE = /(?:^|[^\w.@+~/-])([\w.@+~/-]+):(\d+)(?:\s*[-–]\s*(\d+))?/g;
const looksLikePath = (p) => /[\w@+~-]/.test(p) && (p.includes('/') || /[\w-]\.[A-Za-z][\w-]*$/.test(p));
function placeIn(line) {
  const s = SPAN.exec(line);
  if (s && /^[\w.@+~/ -]+$/.test(s[1].trim()) && looksLikePath(s[1].trim())) return at(s[1].trim(), s[2], s[3]);
  for (const m of line.replace(/\*\*|__/g, '').matchAll(BARE)) {
    if (looksLikePath(m[1])) return at(m[1], m[2], m[3]);
  }
  return null;
}
const at = (path, from, to) => ({ path, line: [Number(from), Number(to ?? from)] });
// A bare `dir/file.ext` (no line): docs-sync cites a doc this way.
function bareIn(line) {
  const m = /(?:^|[\s`(])((?:[\w.@+~-]+\/)+[\w@+~-][\w.@+~-]*\.[A-Za-z][\w-]*|[\w@+~-][\w.@+~-]*\.(?:md|mdc|json|ya?ml|toml|txt))(?=$|[\s`),;:])/.exec(line);
  return m ? { path: m[1], line: null } : null;
}

export function parseReport(text, { root } = {}) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { error: 'the report is empty' };
  const lines = raw.split(/\r?\n/);
  const v = findVerdict(lines);
  if (v?.noDiff) return { error: 'it answered NO DIFF — a review of nothing is never stamped' };
  if (!v) return { error: 'no verdict line (CLEAN / SECURE / N ISSUE(S) / N RISK(S)) in its last three lines' };
  const rel = (p) => {
    const r = root ? String(root).replace(/\/+$/, '') + '/' : null;
    return r && p.startsWith(r) ? p.slice(r.length) : p;
  };
  const findings = [];
  const answers = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === v.index) continue;
    const body = lines[i].replace(LEAD, '');
    const mark = MARK.exec(body);
    if (!mark) continue;
    let rest = body.slice(mark[0].length);
    const b = BRACKET.exec(rest);
    const tag = b?.[1].toLowerCase() === 'pre-existing' ? 'pre-existing' : null;
    const id = b && !tag ? `F${b[1].slice(1)}` : null;
    if (mark[1] === '✅') { if (id) answers.push({ id, fixed: true }); continue; }
    if (id) { answers.push({ id, fixed: false }); continue; }
    if (b) rest = rest.slice(b[0].length);
    let place = placeIn(lines[i]);
    for (let j = i + 1; !place && j < lines.length && j !== v.index; j++) {
      const next = lines[j];
      if (!next.trim() || /^\s*#/.test(next) || markOf(next)) break;
      place = placeIn(next);
    }
    place ??= bareIn(lines[i]);
    findings.push({
      kind: mark[1] === '❌' ? '❌' : '⚠️',
      tag,
      path: place ? rel(place.path) : null,
      line: place?.line ?? null,
      text: plain(rest).replace(/^[|\s]+|[|\s]+$/g, '').slice(0, MAX_TEXT),
    });
  }
  return { verdict: v.verdict, issues: v.issues, findings, answers };
}

// The same finding, reported again: texts equal once markup is dropped and
// case folded (Clarify 6).
export const sameFinding = (a, b) => plain(a).toLowerCase() === plain(b).toLowerCase();
