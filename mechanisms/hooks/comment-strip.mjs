// Comment scanner for the JS/TS family, used by the review gate to carry a
// clean stamp over a comment-only change (spec v3.6, Decision 3, Clarify 2).
// No dependencies; not a parser — a tokenizer that knows strings, templates,
// regex literals, JSX and comments well enough to remove the comments.
//
// stripComments(text, ext) returns the text with comments, trailing
// whitespace and blank lines removed, or null when it can't classify the text
// (or the extension isn't in COMMENT_EXTS). Everything it removes is something
// the language treats as whitespace: a comment is a token boundary, and one
// holding a line break is a line break for ASI. String, template, regex and
// JSX-text bytes are never touched. It returns null at each ambiguity it knows
// (a `/` or JSX `<` it can't place, an HTML-like comment, a directive whose
// target line would move); that list is what review and fuzzing against
// TypeScript found, not a proof that none is left. A wrong "comment only" lets
// an unreviewed code change through; a wrong null costs a review.
// Not covered: Function.prototype.toString shows a function's comments.

import { extname } from 'node:path';

export const COMMENT_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
// The files TypeScript parses with JSX on: there `<` in expression position
// opens an element, so `<p>// hi</p>` is text, not a comment.
const JSX_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.tsx']);
// checkJs reads JSDoc types in these.
const JSDOC_TYPED_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx']);

// After these keywords an expression starts, so `/` opens a regex and `<` JSX.
// `default` is beyond Clarify 2's list: after it (`export default /re/`) only
// an expression or `:` can follow, and `x.default` is caught by the `.` rule.
const EXPR_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'default']);
// Of those, these can also be identifiers (`var of = 4; n = of / 2`; `yield`
// and `await` in sloppy or non-async code), so a `/` or `<` after one is ambiguous.
const MAYBE_ID = new Set(['of', 'yield', 'await']);
// The `)` closing the head of these is followed by a statement.
const COND_KW = new Set(['if', 'while', 'for', 'with']);
// TS-family files: a `>` may close type arguments (`y as A<B> / 2`, `f<T> / 2`)
// and `void` may end a type (`y as () => void / 2`), where `/` is division.
const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
// Templates and JSX recurse; real code never nests this deep.
const MAX_DEPTH = 1000;

class Unclassifiable extends Error {}
const fail = (reason) => { throw new Unclassifiable(reason); };

// ---- comments a tool reads are code ------------------------------------------
// `body` is the comment without its delimiters; `raw` has them.
const TOOL_READ = [
  (b) => /eslint-(disable|enable|env)/i.test(b) || /^\s*eslint\s/i.test(b),
  (b, raw) => raw.startsWith('/*') && /^\s*(globals?|exported)\s/.test(b), // ESLint reads these in blocks only
  (b) => /^\s*(jshint|jslint)\s/.test(b),
  (b) => /@ts-/.test(b),
  (b) => /prettier-ignore/.test(b),
  (b) => /\b(c8|istanbul|v8)\s+ignore\b/.test(b) || /node:coverage/.test(b),
  (b) => /[#@]__PURE__|__NO_SIDE_EFFECTS__/.test(b),
  (b, raw) => /^\/\/\/\s*</.test(raw),
  (b) => /^[#@]\s*source(Mapping)?URL=/.test(b),
  (b) => /@jsx/.test(b),
  (b) => /@(no)?flow\b/.test(b),
  (b) => /\b(webpack|turbopack)[A-Z]\w*\s*:/.test(b),
  (b) => /@vite-ignore/.test(b),
  (b, raw) => raw.startsWith('/*!') || /@(license|preserve)\b/.test(b),
  (b) => /biome-ignore|deno-(lint|fmt)-ignore|dprint-ignore|oxlint-|tslint:/.test(b),
  (b) => /ssdd-lint-ignore/.test(b), // convention-lint.mjs reads it
  (b) => /@refresh\b/.test(b),
  (b) => /@(vitest|jest)-environment/.test(b),
  (b) => /@(format|prettier)\b/.test(b),
  (b, raw) => raw.startsWith('/*') && /^(::?|flow-include\b)/.test(b), // Flow comment types: /*: T */, /*:: … */
];
// A kept directive aimed at the next line: removing a comment line or a blank
// line after it would move its target, so that can't be classified.
const NEXT_LINE = /next-line|\bignore\b(?![-\s]+file)|expect-error/i;
const JSDOC_ALWAYS = /@(template|typedef|callback|import|overload|enum|this|private|protected|public|readonly|constructor|class|override)\b/;
const JSDOC_WITH_BRACE = /@(type|param|arg|argument|returns?|satisfies|property|prop|extends|augments|implements)\b/;

function toolRead(raw, ext) {
  const body = raw.startsWith('/*') ? raw.slice(2, -2) : raw.slice(2);
  if (TOOL_READ.some((test) => test(body, raw))) return true;
  return JSDOC_TYPED_EXTS.has(ext) && raw.startsWith('/**') && raw !== '/**/' &&
    (JSDOC_ALWAYS.test(body) || (JSDOC_WITH_BRACE.test(body) && body.includes('{')));
}

// ---- characters --------------------------------------------------------------
const isLT = (c) => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
const isWS = (c) => c === ' ' || c === '\t' || c === '\v' || c === '\f' ||
  (c > '\x7f' && !isLT(c) && /\s/.test(c));
// Tokens that never merge with a neighbour, so a removed comment beside one leaves no space.
const SEP = new Set(['(', ')', '[', ']', '{', '}', ';', ',']);
// Trailing whitespace, removed at a line break met in code.
const TRIM = new Set([' ', '\t', '\r', '\v', '\f']);
const isIdStart = (c) => c !== undefined && (/[A-Za-z_$\\]/.test(c) || (c > '\x7f' && !/\s/.test(c)));
const isIdPart = (c) => c !== undefined && (/[\w$\\]/.test(c) || (c > '\x7f' && !/\s/.test(c)));
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';

class Scanner {
  constructor(text, ext) {
    this.s = text;
    this.ext = ext;
    this.jsx = JSX_EXTS.has(ext);
    this.ts = TS_EXTS.has(ext);
    this.directive = false; // a kept next-line directive with no code after it yet
    this.i = 0;
    this.out = [];
    this.depth = 0;
  }

  push(c) {
    if (this.directive && !isWS(c) && !isLT(c)) this.directive = false;
    this.out.push(c);
  }

  enter() { if (++this.depth > MAX_DEPTH) fail('too deep'); }

  // A line break met in code: trim trailing whitespace, drop a blank line.
  codeNewline() {
    const o = this.out;
    while (o.length && TRIM.has(o[o.length - 1])) o.pop();
    if (o.length && o[o.length - 1] !== '\n') o.push('\n');
    else if (this.directive) fail('a blank line after a next-line directive');
  }

  run() {
    const s = this.s;
    if (s[0] === '\uFEFF') { this.push(s[0]); this.i = 1; }
    if (s.startsWith('#!', this.i)) {
      while (this.i < s.length && !isLT(s[this.i])) this.push(s[this.i++]);
    }
    this.js(false);
    const o = this.out;
    while (o.length && (TRIM.has(o[o.length - 1]) || o[o.length - 1] === '\n')) o.pop();
    return o.join('');
  }

  // A comment starts at this.i (`//` or `/*`): remove it, or keep it if a tool
  // reads it. Returns whether it held a line break.
  comment() {
    const s = this.s;
    const start = this.i;
    let end;
    let hasLT = false;
    if (s[start + 1] === '/') {
      end = start + 2;
      while (end < s.length && !isLT(s[end])) end++;
    } else {
      const close = s.indexOf('*/', start + 2);
      if (close < 0) fail('unterminated comment');
      end = close + 2;
      for (let k = start + 2; k < close; k++) if (isLT(s[k])) { hasLT = true; break; }
    }
    const raw = s.slice(start, end);
    this.i = end;
    if (toolRead(raw, this.ext)) {
      for (const c of raw) this.push(c);
      if (NEXT_LINE.test(raw)) this.directive = true;
      return hasLT;
    }
    if (this.directive) fail('a comment removed after a next-line directive');
    if (raw[1] === '/') return false; // the line break after it stays
    if (hasLT) this.codeNewline();
    const o = this.out;
    const prev = o.length ? o[o.length - 1] : '\n';
    const next = s[this.i];
    if (prev === '\n' || TRIM.has(prev) || isWS(prev)) {
      // A boundary is already there: drop the whitespace on the other side too.
      while (this.i < s.length && isWS(s[this.i])) this.i++;
    } else if (!(next === undefined || isWS(next) || isLT(next) || SEP.has(prev) || SEP.has(next))) {
      this.push(' '); // keep the boundary the comment made: `a/**/b` is not `ab`
    }
    return hasLT;
  }

  string(q) {
    const s = this.s;
    this.push(s[this.i++]);
    for (;;) {
      const c = s[this.i];
      if (c === undefined || c === '\n' || c === '\r') fail('unterminated string');
      this.push(c); this.i++;
      if (c === '\\') {
        if (this.i >= s.length) fail('unterminated string');
        if (s[this.i] === '\r' && s[this.i + 1] === '\n') { this.push('\r'); this.i++; }
        this.push(s[this.i++]);
      } else if (c === q) return;
    }
  }

  template() {
    const s = this.s;
    this.enter();
    this.push(s[this.i++]);
    for (;;) {
      const c = s[this.i];
      if (c === undefined) fail('unterminated template');
      if (c === '\\') {
        this.push(c); this.i++;
        if (this.i >= s.length) fail('unterminated template');
        this.push(s[this.i++]);
      } else if (c === '`') {
        this.push(c); this.i++; break;
      } else if (c === '$' && s[this.i + 1] === '{') {
        this.push('$'); this.push('{'); this.i += 2;
        this.js(true);
      } else {
        this.push(c); this.i++;
      }
    }
    this.depth--;
  }

  regex() {
    const s = this.s;
    let j = this.i + 1;
    let inClass = false;
    for (;;) {
      const c = s[j];
      if (c === undefined || isLT(c)) fail('unterminated regex');
      if (c === '\\') {
        if (s[j + 1] === undefined || isLT(s[j + 1])) fail('unterminated regex');
        j += 2; continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      j++;
    }
    j++;
    while (isIdPart(s[j])) j++; // flags
    for (let k = this.i; k < j; k++) this.push(s[k]);
    this.i = j;
  }

  // Scan JS to the end of the text, or (inBrace) to the `}` closing a `${` or
  // a JSX `{`, which it consumes and keeps.
  js(inBrace) {
    const s = this.s;
    this.enter();
    const stack = []; // open ( [ { with whether a `(` heads an if/while/for/with
    // What the last token lets `/` and `<` be:
    //   'start' | 'op' | 'kw' | 'cond' — an expression may start: regex, JSX
    //   'value' — an operand just ended: division, less-than
    //   'rbrace' | 'incdec' — `}` `++` `--`: a `/` here can't be classified
    //   'amb' — `of` `yield` `await`, and in TS a closing `>` or `void`: neither
    //     a `/` nor a JSX-opening `<` can be classified
    // After a line break, a `/` or JSX `<` that follows a value can't be either:
    // ASI may end the statement there (`let x\n/re/`) or not (`x = a\n/ b`).
    let prev = 'start';
    let afterDot = false; // the last token was `.` or `?.`
    let lineBreak = !inBrace; // a line break (or the start) since the last token
    let lastWord = null, lastWord2 = null, lastWordAfterDot = false;
    const exprPos = () => prev === 'start' || prev === 'op' || prev === 'kw' || prev === 'cond';
    for (;;) {
      const c = s[this.i];
      if (c === undefined) {
        if (inBrace) fail('unterminated ${ or {');
        if (stack.length) fail('bracket left open');
        this.depth--;
        return;
      }
      if (c === '\n') { this.codeNewline(); this.i++; lineBreak = true; continue; }
      if (isLT(c)) { this.push(c); this.i++; lineBreak = true; continue; }
      if (isWS(c)) { this.push(c); this.i++; continue; }
      const n = s[this.i + 1];
      if (c === '/' && (n === '/' || n === '*')) { if (this.comment()) lineBreak = true; continue; }

      let word = null;
      let dot = false;
      if (c === '/') {
        if (prev === 'value' && lineBreak) fail('/ after a line break');
        if (exprPos()) { this.regex(); prev = 'value'; }
        else if (prev === 'value') { this.push(c); this.i++; prev = 'op'; }
        else fail(`/ after ${prev === 'rbrace' ? '}' : prev === 'incdec' ? '++ or --' : 'an ambiguous token'}`);
      } else if (c === '"' || c === "'") { this.string(c); prev = 'value'; }
      else if (c === '`') { this.template(); prev = 'value'; }
      else if (c === '<' && s.startsWith('<!--', this.i)) fail('an HTML-like comment');
      else if (c === '-' && lineBreak && s.startsWith('-->', this.i)) fail('an HTML-like comment');
      else if (c === '<' && (n === '<' || n === '=')) {
        // `<<` and `<=` are one operator: the second character never opens JSX.
        this.push(c); this.push(n); this.i += 2; prev = 'op';
      } else if (c === '<' && this.jsx && (exprPos() || prev === 'rbrace' || prev === 'amb' || lineBreak)) {
        if (isIdStart(n) || n === '>') {
          if (!exprPos()) fail('a JSX-opening < after }, an ambiguous token, or a line break');
          this.jsxElement(); prev = 'value';
        } else if (exprPos()) {
          fail('< in expression position that opens no element');
        } else { this.push(c); this.i++; prev = 'op'; }
      } else if (c === '(' || c === '[' || c === '{') {
        const cond = c === '(' && !afterDot &&
          ((prev === 'value' && COND_KW.has(lastWord) && !lastWordAfterDot) ||
            (lastWord === 'await' && lastWord2 === 'for'));
        stack.push({ c, cond });
        this.push(c); this.i++; prev = 'op';
      } else if (c === ')' || c === ']' || c === '}') {
        if (c === '}' && stack.length === 0 && inBrace) { this.push(c); this.i++; this.depth--; return; }
        const top = stack.pop();
        const want = c === ')' ? '(' : c === ']' ? '[' : '{';
        if (!top || top.c !== want) fail('mismatched bracket');
        this.push(c); this.i++;
        prev = c === '}' ? 'rbrace' : (top.cond ? 'cond' : 'value');
      } else if (isDigit(c) || (c === '.' && isDigit(n))) {
        // `1e-5` scans as `1e` `-` `5`: the same operand/operator outcome.
        while (this.i < s.length && /[\w.]/.test(s[this.i])) this.push(s[this.i++]);
        prev = 'value';
      } else if (c === '#' || isIdStart(c)) {
        const st = this.i;
        this.i++;
        while (isIdPart(s[this.i])) this.i++;
        word = s.slice(st, this.i);
        for (const ch of word) this.push(ch);
        prev = afterDot ? 'value'
          : MAYBE_ID.has(word) || (this.ts && word === 'void') ? 'amb'
            : EXPR_KW.has(word) ? 'kw' : 'value';
        lastWordAfterDot = afterDot;
      } else if (c === '.') {
        if (n === '.' && s[this.i + 2] === '.') { this.push('...'); this.i += 3; prev = 'op'; }
        else { this.push(c); this.i++; prev = 'op'; dot = true; }
      } else if (c === '?' && n === '.' && !isDigit(s[this.i + 2])) {
        this.push('?.'); this.i += 2; prev = 'op'; dot = true;
      } else if ((c === '+' || c === '-') && n === c) {
        this.push(c); this.push(c); this.i += 2; prev = 'incdec';
      } else if (c === '!' && n !== '=' && prev === 'value' && !lineBreak) {
        // TS non-null assertion `x!` (no line break before it): the operand continues.
        this.push(c); this.i++;
      } else if (c === '>' && this.ts && s[this.i - 1] !== '=' && n !== '=' && n !== '>') {
        // May close type arguments (`as A<B>`, `f<T>`), after which `/` is division.
        this.push(c); this.i++; prev = 'amb';
      } else {
        this.push(c); this.i++; prev = 'op';
      }
      afterDot = dot;
      lineBreak = false;
      if (word !== null) { lastWord2 = lastWord; lastWord = word; }
      else if (c !== '(') { lastWord2 = null; lastWord = null; }
    }
  }

  jsxName() {
    const s = this.s;
    const st = this.i;
    if (!isIdStart(s[this.i])) return '';
    while (isIdPart(s[this.i]) || s[this.i] === '-' || s[this.i] === ':' || s[this.i] === '.') this.i++;
    const name = s.slice(st, this.i);
    for (const ch of name) this.push(ch);
    return name;
  }

  // Whitespace and comments inside a JSX tag.
  jsxTagSpace() {
    const s = this.s;
    for (;;) {
      const c = s[this.i];
      if (c === '\n') { this.codeNewline(); this.i++; }
      else if (c !== undefined && (isLT(c) || isWS(c))) { this.push(c); this.i++; }
      else if (c === '/' && (s[this.i + 1] === '/' || s[this.i + 1] === '*')) this.comment();
      else return;
    }
  }

  jsxElement() {
    const s = this.s;
    this.enter();
    this.push('<'); this.i++;
    let name = '';
    if (s[this.i] === '>') { this.push('>'); this.i++; } // a fragment
    else {
      name = this.jsxName();
      if (!name) fail('JSX tag name');
      for (;;) {
        this.jsxTagSpace();
        const c = s[this.i];
        if (c === undefined) fail('JSX tag left open');
        if (c === '/') {
          if (s[this.i + 1] !== '>') fail('JSX / in a tag');
          this.push('/'); this.push('>'); this.i += 2; this.depth--; return;
        }
        if (c === '>') { this.push('>'); this.i++; break; }
        if (c === '{') { this.push('{'); this.i++; this.js(true); continue; }
        if (isIdStart(c)) {
          const st = this.i;
          while (isIdPart(s[this.i]) || s[this.i] === '-' || s[this.i] === ':') this.i++;
          for (const ch of s.slice(st, this.i)) this.push(ch);
          this.jsxTagSpace();
          if (s[this.i] === '=') {
            this.push('='); this.i++;
            this.jsxTagSpace();
            const v = s[this.i];
            if (v === '"' || v === "'") { // no escapes: byte for byte to the closing quote
              const close = s.indexOf(v, this.i + 1);
              if (close < 0) fail('JSX attribute string left open');
              for (let k = this.i; k <= close; k++) this.push(s[k]);
              this.i = close + 1;
            } else if (v === '{') { this.push('{'); this.i++; this.js(true); }
            else fail('JSX attribute value');
          }
          continue;
        }
        fail('JSX tag character (a .tsx generic?)');
      }
    }
    // Children: text is code, kept byte for byte, up to `<` or `{`.
    for (;;) {
      const c = s[this.i];
      if (c === undefined) fail('JSX element left open');
      if (c === '<') {
        const n = s[this.i + 1];
        if (n === '/') {
          this.push('<'); this.push('/'); this.i += 2;
          const close = s[this.i] === '>' ? '' : this.jsxName();
          if (close !== name) fail('JSX closing name');
          if (s[this.i] !== '>') fail('JSX closing tag');
          this.push('>'); this.i++;
          this.depth--;
          return;
        }
        if (isIdStart(n) || n === '>') { this.jsxElement(); continue; }
        fail('JSX < in text');
      }
      if (c === '{') { this.push('{'); this.i++; this.js(true); continue; }
      this.push(c); this.i++;
    }
  }
}

/** The text without comments, trailing whitespace and blank lines, or null: can't classify, or not a COMMENT_EXTS extension. */
export function stripComments(text, ext) {
  try {
    if (typeof text !== 'string' || !COMMENT_EXTS.has(ext)) return null;
    // U+FFFD is what a non-UTF-8 blob decodes to: two blobs differing in those
    // bytes would read the same, so the text says nothing about the bytes.
    if (text.includes('\uFFFD')) return null;
    return new Scanner(text, ext).run();
  } catch {
    return null; // Unclassifiable, a RangeError, anything: never classify on an error
  }
}

/** True only when a and b differ and both strip to the same classified text. */
export function commentOnly(a, b, path) {
  try {
    if (typeof a !== 'string' || typeof b !== 'string' || typeof path !== 'string' || a === b) return false;
    const ext = extname(path);
    const sa = stripComments(a, ext);
    return sa !== null && sa === stripComments(b, ext);
  } catch {
    return false;
  }
}
