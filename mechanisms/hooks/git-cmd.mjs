// Shared command grammar for the harness hooks (git-guard, review-gate): ONE
// definition of "what does this shell string do with git", so the two hooks
// can't drift apart. Ported from the source project's hardened hooks.
// Not a shell parser — enough structure for flag scans and cd / -C tracking.

const HEREDOC = /<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n[ \t]*\1\b/g;

/** Drop heredoc bodies (<<'TAG' … TAG | <<TAG … TAG | <<-TAG … TAG); quotes stay. */
export const stripHeredocs = (s) => s.replace(HEREDOC, ' <<heredoc> ');

/**
 * Blank quoted strings and heredoc bodies, so a commit message or echo that
 * merely *mentions* a pattern (`git add -A`, `--no-verify`) is never mistaken
 * for command structure.
 */
export function skeleton(s) {
  return stripHeredocs(s)
    .replace(/'(?:[^'\\]|\\.)*'/g, " '' ")
    .replace(/"(?:[^"\\]|\\.)*"/g, ' "" ');
}

/** `git` plus any global options, then whitespace — the prefix of a subcommand. */
export const GIT = String.raw`\bgit(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace|exec-path|super-prefix|config-env)\s+\S+|\s+--?[\w-]+(?:=\S*)?)*\s+`;

/** A short-flag cluster containing `letter` (`-n`, `-nm`, `-Av`, `-fu`). */
export const cluster = (letter) => String.raw`\s-[a-zA-Z]*${letter}[a-zA-Z]*\b`;

/**
 * A rule for `git <sub>` whose flag scan stops at the end of THIS command
 * (`;` `&` `|` newline), so `git commit -m x && git log -n 3` is not `commit -n`.
 */
export const gitRule = (sub, tail) => new RegExp(GIT + sub + String.raw`\b[^;&|\n]*(?:` + tail + ')');

/** Is there a `git commit` in this (skeletonized) string? */
export const isCommit = (probe) => new RegExp(GIT + String.raw`commit\b`).test(probe);

// Collapse the global-option run after `git` (`git -C <p> …`, `git -c k=v …`)
// so free-form regexes — a project's gitGuard.extraRules — see the subcommand
// right after `git`. Value-taking options consume their argument, so a bare
// word like `log` always ends the run.
const VALUE_FLAGS = '-[Cc]|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env';
export const collapseGlobalFlags = (s) =>
  s.replace(new RegExp(String.raw`\bgit\s+(?:(?:(?:${VALUE_FLAGS})\s+\S+|--\S+|-[pP])\s+)+`, 'g'), 'git ');

/**
 * Split a shell string into simple commands, each a list of words with quotes
 * removed. Separators: `;` `&&` `||` `|` `&` newline `(` `)`, but not the `&`
 * of a redirection (`2>&1`, `&>file`). Heredoc bodies
 * are dropped and backslash-newline continuations joined. No expansion:
 * `$VAR` / `$(…)` stay literal, so callers can refuse to resolve them.
 * Each command's `quoted` property marks the words that had a quote or a
 * backslash in them: `'2>'` is a word, `2>` a redirection.
 */
export function splitCommands(cmd) {
  const s = stripHeredocs(cmd).replace(/\\\n/g, ' ');
  const cmds = [];
  let words = [];
  let quoted = [];
  let word = '';
  let inWord = false;
  let wasQuoted = false;
  const endWord = () => { if (inWord) { words.push(word); quoted.push(wasQuoted); } word = ''; inWord = false; wasQuoted = false; };
  const endCmd = () => { endWord(); if (words.length) { words.quoted = quoted; cmds.push(words); } words = []; quoted = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      word += s.slice(i + 1, j === -1 ? s.length : j); inWord = true; wasQuoted = true;
      i = j === -1 ? s.length : j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) if (s[j] === '\\') j++;
      word += s.slice(i + 1, j).replace(/\\(["\\$`])/g, '$1'); inWord = true; wasQuoted = true;
      i = j;
    } else if (c === '\\' && i + 1 < s.length) {
      word += s[++i]; inWord = true; wasQuoted = true;
    } else if (c === '&' && ((inWord && /[<>]$/.test(word)) || s[i + 1] === '>')) {
      word += c; inWord = true; // `2>&1`, `>&2`, `&>file` are one redirection, not a separator
    } else if (/[;&|\n()]/.test(c)) {
      endCmd();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word += c; inWord = true;
    }
  }
  endCmd();
  return cmds;
}

// Words that run the next word as the command: `sudo git …`, `env X=1 git …`.
const PREFIXES = new Set(['sudo', 'command', 'env', 'nohup', 'time', 'exec', 'nice', 'builtin']);
const isAssign = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
const base = (w) => (w ?? '').split('/').pop();

/** Index of the word that is actually run, past `VAR=x`, `sudo`, `env -i …`. */
export function commandStart(words) {
  let i = 0;
  for (;;) {
    while (i < words.length && isAssign(words[i])) i++;
    if (!PREFIXES.has(base(words[i]))) return i;
    i++;
    while (i < words.length && words[i].startsWith('-')) i++; // the prefix's own flags
  }
}

/**
 * For a tokenized command, `{ dashC, sub, args }`: the `-C <path>` values in
 * order (git composes them relatively), the subcommand, and the words after
 * it. `null` if it isn't git. `VAR=value` and runner prefixes are skipped.
 */
export function gitInvocation(words) {
  let i = commandStart(words);
  if (base(words[i]) !== 'git') return null;
  const dashC = [];
  for (i++; i < words.length; i++) {
    const w = words[i];
    if (w === '-C') { dashC.push(words[++i] ?? ''); continue; }
    if (['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix'].includes(w)) { i++; continue; }
    if (w.startsWith('-')) continue;
    break;
  }
  return { dashC, sub: words[i] ?? '', args: words.slice(i + 1) };
}
