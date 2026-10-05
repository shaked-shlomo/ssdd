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
 * removed. Separators: `;` `&&` `||` `|` `&` newline `(` `)`. Heredoc bodies
 * are dropped and backslash-newline continuations joined. No expansion:
 * `$VAR` / `$(…)` stay literal, so callers can refuse to resolve them.
 */
export function splitCommands(cmd) {
  const s = stripHeredocs(cmd).replace(/\\\n/g, ' ');
  const cmds = [];
  let words = [];
  let word = '';
  let inWord = false;
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endCmd = () => { endWord(); if (words.length) cmds.push(words); words = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      word += s.slice(i + 1, j === -1 ? s.length : j); inWord = true;
      i = j === -1 ? s.length : j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) if (s[j] === '\\') j++;
      word += s.slice(i + 1, j).replace(/\\(["\\$`])/g, '$1'); inWord = true;
      i = j;
    } else if (c === '\\' && i + 1 < s.length) {
      word += s[++i]; inWord = true;
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

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const PIPE_TO_SHELL = /\|\s*(?:\S+=\S*\s+)*(?:\S*\/)?(?:ba|z|da|k)?sh\b/;

/** Heredoc bodies in order of appearance (the ones stripHeredocs blanks). */
function heredocBodies(cmd) {
  return [...cmd.matchAll(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n[ \t]*\1\b/g)].map((m) => m[2]);
}

// The script a single command hands to a shell, if any: `eval <words>`,
// `sh -c <script>` (any flag cluster with c: -lc, -ec), a shell fed a heredoc,
// or a shell fed by a pipe (`echo '<script>' | sh` — the producer's arguments).
function innerScript(words, docs, piped) {
  const i = commandStart(words);
  const w = base(words[i]);
  if (w === 'eval') return words.slice(i + 1).join(' ');
  if (!SHELLS.has(w)) return null;
  for (let j = i + 1; j < words.length; j++) {
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(words[j])) return words[j + 1] ?? null;
    if (words[j] === '<<heredoc>') break;
    if (!words[j].startsWith('-')) return null; // a script file — not visible
  }
  if (docs.length) return docs[0];
  if (piped) return piped.slice(commandStart(piped) + 1).join(' ').replace(/\\n/g, '\n');
  return null;
}

/**
 * Every simple command that runs, in order, with scripts handed to a shell
 * (`bash -c '…'`, `eval "…"`, `bash <<EOF`, `echo '…' | sh`) flattened in
 * place — so the hooks judge what actually runs. Depth-limited. Scripts in
 * files, in variables, or produced by other programs stay invisible.
 */
export function flatten(cmd, depth = 0) {
  const bodies = heredocBodies(cmd);
  let b = 0;
  const piped = PIPE_TO_SHELL.test(skeleton(cmd));
  const cmds = splitCommands(cmd);
  const out = [];
  cmds.forEach((words, k) => {
    out.push(words);
    const docs = words.filter((t) => t === '<<heredoc>').map(() => bodies[b++] ?? '');
    if (depth >= 3) return;
    const script = innerScript(words, docs, piped && k > 0 ? cmds[k - 1] : null);
    if (script) out.push(...flatten(script, depth + 1));
  });
  return out;
}

/** The command text plus every inner script, one per line — for regex rules. */
export function expandWrappers(cmd, depth = 0) {
  const bodies = heredocBodies(cmd);
  let b = 0;
  const piped = PIPE_TO_SHELL.test(skeleton(cmd));
  const cmds = splitCommands(cmd);
  const inner = [];
  cmds.forEach((words, k) => {
    const docs = words.filter((t) => t === '<<heredoc>').map(() => bodies[b++] ?? '');
    if (depth >= 3) return;
    const script = innerScript(words, docs, piped && k > 0 ? cmds[k - 1] : null);
    if (script) inner.push(expandWrappers(script, depth + 1));
  });
  return [cmd, ...inner].join('\n');
}
