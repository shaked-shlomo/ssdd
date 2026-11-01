// Line-based comment-only check for the JS/TS family, used by the review gate
// to carry a clean stamp over a comment-only change (spec v3.4, Decision 3).
// No tokenizer: a change is comment-only when the two texts have the same code
// lines (trailing whitespace aside) and every other changed line is blank or a
// whole-line `//` comment that no tool reads. Each changed spot must start in
// code: a raw-character guard says no where a template, a JSX tag, a block
// comment or a `\` string continuation may hold it, and where a directive above
// may target it. The guards over-report, never under-report: a wrong "comment
// only" lets an unreviewed code change through; a wrong no costs a review.
// Not covered: Function.prototype.toString shows a function's comments.

import { extname } from 'node:path';

export const COMMENT_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
// The files TypeScript parses with JSX on.
const JSX_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.tsx']);
// A comment some tool reads (lint, types, coverage, bundlers, source maps): matched
// anywhere in the comment, case-insensitive, so prose that names one is reviewed too.
const DIRECTIVE = /[@#]|^\s*[/!]|lint|jshint|prettier|ignore|istanbul|\b[cv]8\b|coverage|global|exported|pure|side.?effects|webpack|turbopack|source(mapping)?url|license|preserve/i;
// A line comment: `//` then not `/` (`///` is a TS reference), not a directive,
// and no line terminator JS sees but a `\n` split doesn't (it would end the comment).
const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') && !DIRECTIVE.test(t.slice(2)) && !/[\r\u2028\u2029]/.test(t);
};
const ignorable = (line) => line.trim() === '' || isComment(line);

// What the guards need of one text, each found in one pass so a file with many
// edits stays linear. Each field is read raw: a quote, comment or regex holding
// the character counts too, so the guards over-report.
function context(L) {
  const text = L.join('\n');
  const starts = [0];
  for (const l of L) starts.push(starts.at(-1) + l.length + 1);
  const lineAt = (pos) => { let k = 0; while (starts[k + 1] <= pos) k++; return k; };
  const first = (re) => { const m = re.exec(text); return m ? lineAt(m.index) : Infinity; };
  const ticks = [0]; // backticks in the lines before line k
  for (const l of L) ticks.push(ticks.at(-1) + l.split('`').length - 1);
  // open[k]: a `/*` still open at the start of line k. `*/*` and `/*/` could hide a
  // real opener from this reading, so from the line holding one on, all count as open.
  const open = [false];
  let inside = false;
  for (let at = 0, k = 1; k <= L.length;) {
    const i = text.indexOf(inside ? '*/' : '/*', at);
    for (const pos = i < 0 ? Infinity : i; k <= L.length && starts[k] - 1 < pos; k++) open.push(inside);
    if (i < 0) break;
    inside = !inside;
    at = i + 2;
  }
  // The last spot a JSX closer (`</`, `/>`, spaces allowed) starts at, tried at each `<` and `/`.
  let closer = -1;
  const close = /<\s*\/|\/\s*>/y;
  for (let i = text.length - 1; i >= 0 && closer < 0; i--) {
    if (text[i] !== '<' && text[i] !== '/') continue;
    close.lastIndex = i;
    if (close.test(text)) closer = lineAt(i);
  }
  return { L, ticks, open, overlap: first(/\*\/\*|\/\*\//), lt: first(/</), closer, counted: first(/ignore\s+next\s+\d/i) };
}

// Whether line k may start outside code (gap: a changed run of blank and comment
// lines starts there) or end outside it (not gap: its trailing whitespace
// changed): in a template (a backtick each side, or an odd count), a `\` string
// continuation, a block comment, or a JSX element (a `<` before, a closer from
// this line on). A gap also must not move a directive's target.
function unsafe(c, k, gap, jsx) {
  const { L, ticks } = c;
  const cut = gap ? k : k + 1; // the lines before the spot
  const total = ticks.at(-1);
  if (ticks[cut] > 0 && (total > ticks[cut] || total % 2)) return true;
  if ((L[cut - 1] ?? '').trimEnd().endsWith('\\') || c.open[cut] || c.overlap < cut) return true;
  if (jsx && c.lt < cut && c.closer >= cut) return true;
  if (!gap) return false;
  // `ignore next 3` counts physical lines from above; a next-line directive
  // targets the line below it, so one above the gap (past blank and comment
  // lines, through the first code line's comment) would see its target move.
  // A line that starts in a block comment may end a wrapped one.
  if (c.counted < k) return true;
  for (let i = k - 1; i >= 0; i--) {
    if (c.open[i]) return true;
    const at = L[i].search(/\/[/*]/);
    if (at >= 0 && DIRECTIVE.test(L[i].slice(at + 2))) return true;
    if (!ignorable(L[i])) break;
  }
  return false;
}

/** True only when a and b differ and every difference is blank lines, whole-line `//` comments or trailing whitespace, each in code. */
export function commentOnly(a, b, path) {
  try {
    if (typeof a !== 'string' || typeof b !== 'string' || typeof path !== 'string' || a === b) return false;
    const ext = extname(path);
    if (!COMMENT_EXTS.has(ext) || (a + b).includes('\uFFFD')) return false;
    const A = a.split('\n');
    const B = b.split('\n');
    // Walk both texts' code lines in step; between them lie gaps of ignorable lines.
    const spots = []; // [line in A, line in B, gap]
    for (let i = 0, j = 0; ;) {
      const gi = i;
      const gj = j;
      while (i < A.length && ignorable(A[i])) i++;
      while (j < B.length && ignorable(B[j])) j++;
      if (i - gi !== j - gj || A.slice(gi, i).some((l, n) => l !== B[gj + n])) spots.push([gi, gj, true]);
      if (i === A.length || j === B.length) {
        if (i !== A.length || j !== B.length) return false;
        break;
      }
      if (A[i].trimEnd() !== B[j].trimEnd()) return false;
      if (A[i] !== B[j]) spots.push([i, j, false]);
      i++;
      j++;
    }
    if (!spots.length) return false;
    const jsx = JSX_EXTS.has(ext);
    const [ca, cb] = [context(A), context(B)];
    return spots.every(([i, j, gap]) => !unsafe(ca, i, gap, jsx) && !unsafe(cb, j, gap, jsx));
  } catch {
    return false; // anything unexpected: never classify on an error
  }
}
