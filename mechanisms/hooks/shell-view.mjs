// Every simple command a shell string would run, for prod-guard and its packs.
// Ported from the source project's supabase-guard (its shellView and
// substitutions), and extended so a `$(…)` is read to its matching `)`
// through quotes, nested substitutions and heredocs: a PR body in
// `--body "$(cat <<'EOF' … EOF)"` is data, whatever it says.
//
//   shellCommands(cmd, { maxDepth = 4 }) → { commands, unparsed }
//
// commands: each a word list as splitCommands (git-cmd.mjs) gives it (quotes
// removed, `words.quoted` marks), plus `depth`, `via` ('top' | '-c' | 'eval' |
// 'subst' | 'heredoc') and `heredocs` (the bodies fed to that command, each
// { body, expands }). Nested commands are listed too:
//   - a shell's `-c` script (`bash -lc '…'`), `env -S '…'`, `eval …`
//   - each `$(…)` and backtick span bash would expand: unquoted, in "…", or
//     in a heredoc whose delimiter isn't quoted
//   - a heredoc fed to a shell (`bash <<EOF`, `sh -s`, `source`, `ssh`)
// Any other heredoc is data, and so is quoted text. `#` comments are dropped.
// A word keeps a substitution's text (`"$(cat q.sql)"` → `$(cat q.sql)`), so a
// caller can see it isn't literal.
//
// unparsed: each text (top level or nested) that can't be read: an unbalanced
// quote, an unterminated heredoc or substitution, or nesting past maxDepth.
// The caller decides whether it matters. Not a shell parser: `case` patterns
// with `)` inside `$(…)` aren't understood. Never throws on a string.
import { splitCommands } from './git-cmd.mjs';

const LT = ''; // a quoted `<`: splitCommands must not read `<<` there as a heredoc
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const FEEDS = new Set([...SHELLS, 'source', '.', 'ssh']);
const base = (w) => String(w ?? '').split('/').pop();
const BREAK = /[\s;&|<>()]/;

// After `<<` or `<<-` at k: the delimiter, whether it was quoted, and where it ends.
function heredocTag(s, k) {
  const dash = s[k] === '-';
  if (dash) k++;
  while (s[k] === ' ' || s[k] === '\t') k++;
  let tag = '';
  let quoted = false;
  while (k < s.length && !BREAK.test(s[k])) {
    if (s[k] === "'" || s[k] === '"') {
      const e = s.indexOf(s[k], k + 1);
      if (e < 0) return null;
      tag += s.slice(k + 1, e); k = e + 1; quoted = true;
    } else if (s[k] === '\\') { tag += s[k + 1] ?? ''; k += 2; quoted = true; } else tag += s[k++];
  }
  return tag ? { tag, dash, quoted, end: k } : null;
}

// The lines from i up to the delimiter line → { body, next }, or null when none ends it.
function readBody(s, i, { tag, dash }) {
  const lines = [];
  for (;;) {
    if (i >= s.length) return null;
    const e = s.indexOf('\n', i);
    const line = s.slice(i, e < 0 ? s.length : e);
    i = e < 0 ? s.length : e + 1;
    if ((dash ? line.replace(/^\t+/, '') : line) === tag) return { body: lines.join('\n'), next: i };
    lines.push(line);
  }
}

// `$((…))`, `$[…]` or `((…))` starting at i → the index of its last character, or -1.
function arithmeticEnd(s, i) {
  const open = s[i + 1] === '[' ? '[' : '(';
  const close = open === '[' ? ']' : ')';
  let depth = 0;
  for (let j = s[i] === '$' ? i + 1 : i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j;
  }
  return -1;
}
const isArithmetic = (s, i, wordStart) =>
  (s[i] === '$' && (s.startsWith('((', i + 1) || s[i + 1] === '[')) || (s[i] === '(' && s[i + 1] === '(' && wordStart);

// The index of the `)` or backtick that ends the substitution starting at i, or -1.
function substEnd(s, i) {
  const n = s.length;
  if (s[i] === '`') {
    let j = i + 1;
    while (j < n && s[j] !== '`') j += s[j] === '\\' ? 2 : 1;
    return j < n ? j : -1;
  }
  let depth = 1;
  let j = i + 2;
  let wordStart = true;
  const pending = [];
  while (j < n) {
    const c = s[j];
    if (c === '\\') { j += 2; wordStart = false; continue; }
    if (c === "'") { const e = s.indexOf("'", j + 1); if (e < 0) return -1; j = e + 1; wordStart = false; continue; }
    if (c === '"') { const e = dqEnd(s, j); if (e < 0) return -1; j = e + 1; wordStart = false; continue; }
    if (isArithmetic(s, j, wordStart)) { const e = arithmeticEnd(s, j); if (e < 0) return -1; j = e + 1; wordStart = false; continue; }
    if (c === '`' || (c === '$' && s[j + 1] === '(')) { const e = substEnd(s, j); if (e < 0) return -1; j = e + 1; wordStart = false; continue; }
    if (c === '#' && wordStart) { while (j < n && s[j] !== '\n') j++; continue; }
    if (c === '<' && s[j + 1] === '<' && s[j + 2] === '<') { j += 3; wordStart = true; continue; }
    if (c === '<' && s[j + 1] === '<') {
      const t = heredocTag(s, j + 2);
      if (!t) return -1;
      pending.push(t); j = t.end; wordStart = true; continue;
    }
    if (c === '\n') {
      j++;
      while (pending.length) { const b = readBody(s, j, pending.shift()); if (!b) return -1; j = b.next; }
      wordStart = true; continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j;
    wordStart = /[\s;&|()]/.test(c);
    j++;
  }
  return -1;
}

// The index of the `"` that closes the double quote opened at i, or -1.
function dqEnd(s, i) {
  let k = i + 1;
  while (k < s.length && s[k] !== '"') {
    if (s[k] === '\\') { k += 2; continue; }
    if (s[k] === '`' || (s[k] === '$' && s[k + 1] === '(')) { const e = substEnd(s, k); if (e < 0) return -1; k = e + 1; continue; }
    k++;
  }
  return k < s.length ? k : -1;
}

// The inner texts of the substitutions in a heredoc body bash expands, or null.
function substsIn(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') { i++; continue; }
    if (body[i] === '`' || (body[i] === '$' && body[i + 1] === '(' && body[i + 2] !== '(')) {
      const e = substEnd(body, i);
      if (e < 0) return null;
      out.push(body.slice(i + (body[i] === '`' ? 1 : 2), e));
      i = e;
    }
  }
  return out;
}

// A detection view of s: heredocs replaced by `__HEREDOC_n__` words, each
// substitution by `__SUBST_n__`, comments dropped, quoted `<` hidden. null
// when s can't be read.
function view(s) {
  const n = s.length;
  let out = '';
  const substs = []; const substRaw = []; const heredocs = []; const pending = [];
  let i = 0;
  let wordStart = true;
  const subst = (from, e) => {
    const raw = s.slice(from, e + 1);
    substRaw.push(raw);
    substs.push(raw[0] === '`' ? raw.slice(1, -1).replace(/\\([`\\$])/g, '$1') : raw.slice(2, -1));
    return `__SUBST_${substs.length - 1}__`;
  };
  while (i < n) {
    const c = s[i];
    if (c === '\\') {
      out += '\\' + (s[i + 1] === '<' ? LT : s[i + 1] ?? '');
      i += 2; wordStart = false;
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      out += s.slice(i, j + 1).replace(/</g, LT);
      i = j + 1; wordStart = false;
    } else if (c === '$' && s[i + 1] === "'") {
      let j = i + 2;
      while (j < n && s[j] !== "'") j += s[j] === '\\' ? 2 : 1;
      if (j >= n) return null;
      out += `'${s.slice(i + 2, j).replace(/\\(.)/g, '$1').replace(/'/g, '').replace(/</g, LT)}'`;
      i = j + 1; wordStart = false;
    } else if (c === '"') {
      let piece = '"';
      let j = i + 1;
      while (j < n && s[j] !== '"') {
        if (s[j] === '\\') { piece += '\\' + (s[j + 1] === '<' ? LT : s[j + 1] ?? ''); j += 2; continue; }
        if (s[j] === '`' || (s[j] === '$' && s[j + 1] === '(' && s[j + 2] !== '(')) {
          const e = substEnd(s, j);
          if (e < 0) return null;
          piece += subst(j, e); j = e + 1; continue;
        }
        piece += s[j] === '<' ? LT : s[j];
        j++;
      }
      if (j >= n) return null;
      out += piece + '"';
      i = j + 1; wordStart = false;
    } else if (c === '#' && wordStart) {
      while (i < n && s[i] !== '\n') i++;
    } else if (isArithmetic(s, i, wordStart)) {
      const e = arithmeticEnd(s, i);
      if (e < 0) return null;
      out += s.slice(i, e + 1).replace(/</g, LT);
      i = e + 1; wordStart = false;
    } else if (c === '`' || (c === '$' && s[i + 1] === '(')) {
      const e = substEnd(s, i);
      if (e < 0) return null;
      out += subst(i, e);
      i = e + 1; wordStart = false;
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
      out += ` ${LT}${LT}${LT} `;
      i += 3; wordStart = true;
    } else if (c === '<' && s[i + 1] === '<') {
      const t = heredocTag(s, i + 2);
      if (!t) return null;
      pending.push({ ...t, id: heredocs.length });
      out += ` __HEREDOC_${heredocs.length}__ `;
      heredocs.push({ body: '', expands: !t.quoted });
      i = t.end; wordStart = true;
    } else if (c === '\n') {
      out += '\n';
      i++; wordStart = true;
      while (pending.length) {
        const t = pending.shift();
        const b = readBody(s, i, t);
        if (!b) return null;
        heredocs[t.id].body = b.body;
        i = b.next;
      }
    } else {
      out += c;
      i++; wordStart = /[\s;&|()]/.test(c);
    }
  }
  return pending.length ? null : { text: out, substs, substRaw, heredocs };
}

export function shellCommands(cmd, { maxDepth = 4 } = {}) {
  const commands = [];
  const unparsed = [];
  const walk = (text, depth, via) => {
    if (depth > maxDepth) { unparsed.push(text); return; }
    const v = view(text);
    if (!v) { unparsed.push(text); return; }
    const restore = (w) => w.replace(/__SUBST_(\d+)__/g, (m, k) => v.substRaw[Number(k)] ?? m).replace(//g, '<');
    for (const split of splitCommands(v.text)) {
      const words = [];
      const quoted = [];
      const heredocs = [];
      split.forEach((w, k) => {
        const m = /^__HEREDOC_(\d+)__$/.exec(w);
        if (m && !split.quoted[k]) { heredocs.push(v.heredocs[Number(m[1])]); return; }
        words.push(restore(w));
        quoted.push(split.quoted[k]);
      });
      if (!words.length) continue;
      Object.assign(words, { quoted, depth, via, heredocs });
      commands.push(words);
      for (let k = 0; k < words.length; k++) {
        const b = base(words[k]);
        if (SHELLS.has(b)) {
          const c = words.findIndex((w, j) => j > k && /^-[a-z]*c[a-z]*$/.test(w));
          if (c > 0 && c + 1 < words.length) walk(words[c + 1], depth + 1, '-c');
        }
        if (b === 'env') {
          const e = words.findIndex((w, j) => j > k && (w === '-S' || w === '--split-string'));
          if (e > 0 && e + 1 < words.length) walk(words[e + 1], depth + 1, '-c');
        }
        if (b === 'eval' && k + 1 < words.length) walk(words.slice(k + 1).join(' '), depth + 1, 'eval');
        if (FEEDS.has(b)) for (const h of heredocs) walk(h.body, depth + 1, 'heredoc');
      }
    }
    for (const inner of v.substs) walk(inner, depth + 1, 'subst');
    for (const h of v.heredocs) {
      if (!h.expands) continue;
      const inner = substsIn(h.body);
      if (inner === null) unparsed.push(h.body);
      else for (const t of inner) walk(t, depth + 1, 'subst');
    }
  };
  walk(cmd == null ? '' : String(cmd), 0, 'top');
  return { commands, unparsed };
}
