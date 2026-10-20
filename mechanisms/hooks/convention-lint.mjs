#!/usr/bin/env node
// SSDD convention lint — surfaces the clearest, greppable convention
// violations EARLY (edit time / pre-commit) so they're fixed before review.
// Advisory: prints findings and exits non-zero so the caller (agent or git
// hook) reacts; NEVER auto-writes files (auto-fix would race the harness's
// file-state tracking).
//
// Rules live in .ssdd/config.json → lint: [{name, pattern, message, include,
// exclude}] — pattern/include/exclude are JS regex sources; pattern is tested
// per line, include/exclude against the repo-relative path.
//
// Modes (no deps, Node >= 18):
//   <file> [<file> …]     lint the given files whole (CI / manual)
//   --staged              lint the lines the staged change adds (git pre-commit)
//   (default: JSON stdin) Claude PostToolUse(Edit|Write) or Cursor afterFileEdit:
//                         lint the lines added since HEAD; a file HEAD
//                         doesn't have is linted whole
// Only added lines: an old violation isn't flagged again on every edit (in
// the source project, most lint firings were old lines). `--staged` reads the
// staged content from the diff, not the file on disk, and detects renames,
// so a moved file isn't new.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { hookFilePath, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';

const stdinMode = process.argv.length <= 2;
const payload = stdinMode ? parseHookStdin(readFileSync(0, 'utf8')) : null;
const repo = resolveHookRepo(payload);
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

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
  process.stderr.write(`[ssdd-convention-lint] .ssdd/config.json can't be used (${e.message}) — fix it; lint rules are not running.\n`);
  process.exit(failCode);
}
if (!rules.length) process.exit(0);

// lines: [[lineNo, text]].
function lintLines(relPath, lines) {
  const findings = [];
  for (const rule of rules) {
    if (rule.include && !rule.include.test(relPath)) continue;
    if (rule.exclude && rule.exclude.test(relPath)) continue;
    for (const [n, line] of lines) {
      if (rule.pattern.test(line)) {
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
// `git diff -U0` → Map<path, [[lineNo, text]]> of the lines it adds.
function addedLines(diff) {
  const out = new Map();
  let file = null;
  let n = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      // git ends a name that holds a space with a tab
      file = line === '+++ /dev/null' ? null : diffPath(line.slice(4).replace(/\t$/, ''));
      if (file) out.set(file, out.get(file) ?? []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { n = Number(hunk[1]); continue; }
    if (file && line.startsWith('+')) out.get(file).push([n++, line.slice(1)]);
  }
  return out;
}
const DIFF = ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const lintAdded = (diff) => [...addedLines(diff)].flatMap(([path, lines]) => lintLines(path, lines));
const inHead = (rel) => { try { git('cat-file', '-e', `HEAD:${rel}`); return true; } catch { return false; } };

function report(findings, exitCode) {
  if (!findings.length) process.exit(0);
  process.stderr.write(`[ssdd-convention-lint] ${findings.length} finding(s):\n` + findings.join('\n') + '\n');
  process.exit(exitCode);
}

const toRel = (p) => (isAbsolute(p) ? relative(root, p) : p).split('\\').join('/');

if (process.argv[2] === '--staged') {
  report(lintAdded(git(...DIFF, '--staged', '-M', '--diff-filter=d')), 1);
} else if (process.argv.length > 2) {
  report(process.argv.slice(2).map(toRel).flatMap(lintFile), 1);
} else {
  const path = hookFilePath(payload);
  if (!path) process.exit(0);
  const rel = toRel(path);
  if (rel.startsWith('..')) process.exit(0); // outside the repo
  // exit 2 → the agent self-corrects
  report(inHead(rel) ? lintAdded(git(...DIFF, 'HEAD', '--', rel)) : lintFile(rel), 2);
}
