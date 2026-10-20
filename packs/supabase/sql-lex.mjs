// SQL lexer for the Supabase pack's classifier (sql-readonly.mjs). Ported
// verbatim from the source project's supabase-guard (lib/sql-lex.mjs), where
// it is a twin of its migration helper's scanner.
//
// It follows Postgres's scan.l with standard_conforming_strings = on: `--`
// comments end at \n or \r, block comments nest, '…' with '' escapes and
// literal backslashes, E'…' with backslash escapes, newline-separated string
// continuation, "…" identifiers, $tag$…$tag$ bodies, non-ASCII identifier
// characters. standard_conforming_strings = on is the Postgres default; the
// classifier refuses any SQL naming it (or client_encoding / SET NAMES).
// Deliberate differences from scan.l:
//   - identifiers / numbers / `$n` params are whole tokens, so a `$$` right
//     after `$1` or `1` opens a dollar quote exactly as Postgres does;
//   - "quoted identifiers" collapse to the word `__QID__` in `code`;
//   - dollar-quoted bodies are also returned raw (`bodies`);
//   - `names` = code with quoted identifiers and dollar bodies kept raw and
//     plain / E-strings as the word `__STR__`: what the out-of-band scan reads,
//     so a string that merely MENTIONS `dblink%` stays data;
//   - `ends` = where each top-level `;` sits in `lits` / `names`.

export const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_CONT = /[A-Za-z0-9_$\u0080-￿]/;
const TAG_CONT = /[A-Za-z0-9_\u0080-￿]/;
const DIGIT = /[0-9]/;

/** → { code, lits, names, bodies, ends, open }. code: comments → ' ', strings / dollar bodies → ' 0 ',
 * quoted identifiers → ' __QID__ '. lits: only comments blanked. names: comments blanked, plain and
 * E-strings → ' __STR__ ', quoted identifiers and dollar bodies raw. bodies: raw dollar-quoted body
 * texts. ends: [index in lits, index in names] of every top-level `;`. open: unterminated construct. */
export function lexSql(sql) {
  let code = '';
  let lits = '';
  let names = '';
  const bodies = [];
  const ends = [];
  const n = sql.length;
  let i = 0;
  const emit = (c, l = c, nm = l) => { code += c; lits += l; names += nm; };
  const fail = (what) => ({ code, lits, names, bodies, ends, open: what });
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1] ?? '';
    if (c === '-' && next === '-') {
      let j = i + 2;
      while (j < n && sql[j] !== '\n' && sql[j] !== '\r') j++;
      emit(' ');
      i = j;
    } else if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      if (depth > 0) return fail('block comment');
      emit(' ');
      i = j;
    } else if (c === "'" || ((c === 'E' || c === 'e') && next === "'")) {
      const escapes = c !== "'";
      let j = escapes ? i + 2 : i + 1;
      for (;;) {
        if (j >= n) return fail('string');
        if (sql[j] === '\\') j += escapes ? 2 : 1; // plain '…': literal (standard_conforming_strings = on)
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") {
          const k = continuation(sql, j + 1);
          if (k < 0) break;
          j = k + 1;
        } else j++;
      }
      emit(' 0 ', sql.slice(i, j + 1), ' __STR__ ');
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) return fail('quoted identifier');
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') break;
        else j++;
      }
      emit(' __QID__ ', sql.slice(i, j + 1));
      i = j + 1;
    } else if (c === '$' && DIGIT.test(next)) { // $1 parameter — a `$$` after it opens a quote
      let j = i + 1;
      while (j < n && DIGIT.test(sql[j])) j++;
      emit(sql.slice(i, j));
      i = j;
    } else if (c === '$' && (next === '$' || IDENT_START.test(next))) {
      let k = i + 1;
      while (k < n && TAG_CONT.test(sql[k])) k++;
      if (sql[k] !== '$') { emit(c); i++; continue; } // `$name` without a closing `$`
      const tag = sql.slice(i, k + 1);
      const close = sql.indexOf(tag, k + 1);
      if (close < 0) return fail('dollar-quoted body');
      bodies.push(sql.slice(k + 1, close));
      emit(' 0 ', sql.slice(i, close + tag.length));
      i = close + tag.length;
    } else if (IDENT_START.test(c) || DIGIT.test(c)) { // a whole identifier (incl. `$`) / number
      const cont = DIGIT.test(c) ? DIGIT : IDENT_CONT;
      let j = i + 1;
      while (j < n && cont.test(sql[j])) j++;
      emit(sql.slice(i, j));
      i = j;
    } else {
      if (c === ';') ends.push([lits.length, names.length]);
      emit(c);
      i++;
    }
  }
  return { code, lits, names, bodies, ends, open: null };
}

// After a closing quote at i-1: the index of the `'` that continues the literal, or -1
// (whitespace / `--` comments holding at least one newline, then a quote).
function continuation(sql, i) {
  let sawNewline = false;
  for (;;) {
    const c = sql[i];
    if (c === '\n' || c === '\r') { sawNewline = true; i++; }
    else if (c === ' ' || c === '\t' || c === '\f' || c === '\v') i++;
    else if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++; }
    else return sawNewline && c === "'" ? i : -1;
  }
}
