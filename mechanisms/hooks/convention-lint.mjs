#!/usr/bin/env node
// SSDD convention lint — surfaces the clearest, greppable convention
// violations EARLY (edit time / pre-commit) so they're fixed before review.
// NEVER auto-writes files (auto-fix would race the harness's file-state
// tracking).
//
// Rules live in .ssdd/config.json → lint: [{name, pattern, message, include,
// exclude}] — pattern/include/exclude are JS regex sources; pattern is tested
// per line, include/exclude against the repo-relative path. A line holding
// `ssdd-lint-ignore` (in a comment, say) is skipped by every rule.
//
// Modes (no deps, Node >= 22):
//   <file> [<file> …]     lint the given files whole (CI / manual); exit 1
//   --staged              lint the lines the staged change adds (git
//                         pre-commit); exit 1 blocks the commit
//   (default: JSON stdin) Claude PostToolUse(Edit|Write) or Cursor
//                         afterFileEdit: lint the lines THIS edit added
// Only added lines: an old violation isn't flagged again on every edit (in
// the source project, most lint firings were old lines). `--staged` reads the
// staged content from the diff, not the file on disk, and detects renames,
// so a moved file isn't new.
//
// The edit hook reads the edit from the payload: Edit's (or MultiEdit's, or
// Cursor's `edits`) old_string → new_string, undone on the file on disk to
// get the file before it; Write's tool_response.originalFile, else HEAD's
// copy (none → the whole file is new). A payload with neither is diffed
// against HEAD. Under Claude Code findings are a warning: exit 0 with
// hookSpecificOutput.additionalContext, which reaches the agent beside the
// tool result (plain output at exit 0 doesn't; exit 2 reads as a tool
// error). Under Cursor: stderr, exit 2. The pre-commit is where they block.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { hookFilePath, hookHarness, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';

const stdinMode = process.argv.length <= 2;
const payload = stdinMode ? parseHookStdin(readFileSync(0, 'utf8')) : null;
const repo = resolveHookRepo(payload);
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const PREFIX = '[ssdd-convention-lint] ';
const claude = stdinMode && hookHarness(payload) === 'claude';
// Findings, or a config that can't be used: a warning at edit time, a block
// on the command line and in the pre-commit.
function fail(message, exitCode) {
  if (claude) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }) + '\n');
    process.exit(0);
  }
  process.stderr.write(message);
  process.exit(exitCode);
}

// No repo or no config → nothing to lint (exit 0). A config that isn't valid
// JSON, or a rule whose regex doesn't compile, is reported as a finding: an
// agent that just wrote it hears at once, and `--staged` fails the commit.
const failCode = stdinMode ? 2 : 1;
let root, text, rules;
try { root = git('rev-parse', '--show-toplevel').trim(); } catch { process.exit(0); }
try { text = readFileSync(join(root, '.ssdd', 'config.json'), 'utf8'); } catch (e) {
  if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') process.exit(0);
  text = null;
}
try {
  if (text === null) throw new Error('unreadable');
  rules = (JSON.parse(text)?.lint ?? [])
    .map((r) => ({
      name: r.name ?? r.pattern,
      message: r.message ?? '',
      pattern: new RegExp(r.pattern),
      include: r.include ? new RegExp(r.include) : null,
      exclude: r.exclude ? new RegExp(r.exclude) : null,
    }));
} catch (e) {
  fail(`${PREFIX}.ssdd/config.json can't be used (${e.message}) — fix it; lint rules are not running.\n`, failCode);
}
if (!rules.length) process.exit(0);

const IGNORE = /ssdd-lint-ignore/;
// lines: [[lineNo, text]].
function lintLines(relPath, lines) {
  const findings = [];
  for (const rule of rules) {
    if (rule.include && !rule.include.test(relPath)) continue;
    if (rule.exclude && rule.exclude.test(relPath)) continue;
    for (const [n, line] of lines) {
      if (rule.pattern.test(line) && !IGNORE.test(line)) {
        findings.push(`${relPath}:${n} [${rule.name}] ${rule.message}\n    ${line.trim()}`);
      }
    }
  }
  return findings;
}
function lintFile(relPath) {
  let src;
  try { src = readFileSync(join(root, relPath), 'utf8'); } catch { return []; }
  return lintLines(relPath, src.split('\n').map((line, i) => [i + 1, line]));
}

// A `+++ b/<path>` name: C-quoted ("…") when it holds a quote, a backslash or a
// control character (core.quotePath=false keeps other bytes literal).
function diffPath(raw) {
  let p = raw;
  if (p.startsWith('"')) {
    const bytes = [];
    for (let i = 1; i < p.length - 1; i++) {
      if (p[i] !== '\\') { bytes.push(...Buffer.from(p[i])); continue; }
      const c = p[++i];
      if (/[0-7]/.test(c)) { bytes.push(parseInt(p.slice(i, i + 3), 8)); i += 2; continue; }
      bytes.push(({ n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 })[c] ?? c.charCodeAt(0));
    }
    p = Buffer.from(bytes).toString('utf8');
  }
  return p.replace(/^b\//, '');
}
// `git diff -U0` → Map<path, [[lineNo, text]]> of the lines it adds. A hunk
// runs while its lines start with `+`, `-` or `\`, so inside one, `+++ x` is
// an added line `++ x`, not the next file's header. An added line that only
// gains or drops the file's final newline (`\ No newline at end of file`
// follows the side without one) is the removed line it replaces, not a new one.
function addedLines(diff) {
  const out = new Map();
  let file = null;
  let hunk = null; // { n, removed, added: [{ n, text, eof }], last }
  const flush = () => {
    if (!file || !hunk) return;
    for (const a of hunk.added) {
      const same = hunk.removed.find((r) => !r.used && r.text === a.text && r.eof !== a.eof);
      if (same) same.used = true;
      else out.get(file).push([a.n, a.text]);
    }
  };
  for (const line of diff.split('\n')) {
    if (hunk && /^[-+\\]/.test(line)) {
      if (line[0] === '\\') { if (hunk.last) hunk.last.eof = true; continue; }
      hunk.last = { n: line[0] === '+' ? hunk.n++ : 0, text: line.slice(1), eof: false };
      (line[0] === '+' ? hunk.added : hunk.removed).push(hunk.last);
      continue;
    }
    flush();
    hunk = null;
    if (line.startsWith('+++ ')) {
      // git ends a name that holds a space with a tab
      file = line === '+++ /dev/null' ? null : diffPath(line.slice(4).replace(/\t$/, ''));
      if (file) out.set(file, out.get(file) ?? []);
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) hunk = { n: Number(h[1]), removed: [], added: [], last: null };
  }
  flush();
  return out;
}
const DIFF = ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const lintAdded = (diff) => [...addedLines(diff)].flatMap(([path, lines]) => lintLines(path, lines));
// The edit hook's paths are root-relative, so its git runs at the root (the
// hook's project dir may be a subdirectory).
const atRoot = (...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const inHead = (rel) => { try { atRoot('cat-file', '-e', `HEAD:${rel}`); return true; } catch { return false; } };

function report(findings, exitCode, scope = '') {
  if (!findings.length) process.exit(0);
  fail(`${PREFIX}${findings.length} finding(s)${scope}:\n` + findings.join('\n') + '\n' +
    'A deliberate exception: put `ssdd-lint-ignore` in a comment on its line.\n', exitCode);
}

const toRel = (p) => (isAbsolute(p) ? relative(root, p) : p).split('\\').join('/');

// The lines of `after` that `before` doesn't have → [[lineNo, text]]: the
// common head and tail are dropped, and in what's left a line `before` also
// has (as often) isn't new.
function newLines(before, after) {
  const a = before.split('\n'); const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const had = new Map();
  for (const l of a.slice(head, a.length - tail)) had.set(l, (had.get(l) ?? 0) + 1);
  const out = [];
  b.slice(head, b.length - tail).forEach((l, i) => {
    if (had.get(l)) had.set(l, had.get(l) - 1);
    else if (l !== '') out.push([head + i + 1, l]);
  });
  return out;
}

// The file as it was before this edit, from the payload; undefined when the
// payload doesn't say what the edit was.
function before(rel, now) {
  const input = payload?.tool_input ?? payload ?? {};
  const edits = Array.isArray(input.edits) ? input.edits
    : typeof input.new_string === 'string' ? [input] : null;
  if (edits) {
    // Undo the edits last to first. One whose new text isn't in the file
    // (changed since) is left as it is.
    let text = now;
    for (const e of [...edits].reverse()) {
      const neu = String(e?.new_string ?? ''); const old = String(e?.old_string ?? '');
      if (!neu || !text.includes(neu)) continue;
      text = e.replace_all ? text.split(neu).join(old) : text.replace(neu, () => old);
    }
    return text;
  }
  if (typeof input.content === 'string') {
    const orig = payload?.tool_response?.originalFile;
    if (typeof orig === 'string') return orig;
    if (payload?.tool_response?.type === 'create' || !inHead(rel)) return '';
    return atRoot('show', `HEAD:${rel}`);
  }
  return undefined;
}

if (process.argv[2] === '--staged') {
  report(lintAdded(git(...DIFF, '--staged', '-M', '--diff-filter=d')), 1);
} else if (process.argv.length > 2) {
  report(process.argv.slice(2).map(toRel).flatMap(lintFile), 1);
} else {
  const path = hookFilePath(payload);
  if (!path) process.exit(0);
  const rel = toRel(path);
  if (rel.startsWith('..')) process.exit(0); // outside the repo
  let now;
  try { now = readFileSync(join(root, rel), 'utf8'); } catch { process.exit(0); }
  const prev = before(rel, now);
  const findings = prev !== undefined ? lintLines(rel, newLines(prev, now))
    : inHead(rel) ? lintAdded(atRoot(...DIFF, 'HEAD', '--', rel)) : lintFile(rel);
  report(findings, 2, prev !== undefined ? ' in the lines this edit added' : '');
}
