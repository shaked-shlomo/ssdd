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
//   <file> [<file> …]     lint the given files (CI / manual)
//   --staged              lint the currently staged files (git pre-commit)
//   (default: JSON stdin) Claude PostToolUse(Edit|Write) or Cursor afterFileEdit
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

function lintFile(relPath) {
  const findings = [];
  let src;
  try { src = readFileSync(join(root, relPath), 'utf8'); } catch { return findings; }
  for (const rule of rules) {
    if (rule.include && !rule.include.test(relPath)) continue;
    if (rule.exclude && rule.exclude.test(relPath)) continue;
    src.split('\n').forEach((line, i) => {
      if (rule.pattern.test(line)) {
        findings.push(`${relPath}:${i + 1} [${rule.name}] ${rule.message}\n    ${line.trim()}`);
      }
    });
  }
  return findings;
}

function report(findings, exitCode) {
  if (!findings.length) process.exit(0);
  process.stderr.write(`[ssdd-convention-lint] ${findings.length} finding(s):\n` + findings.join('\n') + '\n');
  process.exit(exitCode);
}

const toRel = (p) => (isAbsolute(p) ? relative(root, p) : p).split('\\').join('/');

if (process.argv[2] === '--staged') {
  const staged = git('diff', '--staged', '--name-only', '--diff-filter=d').split('\n').filter(Boolean);
  report(staged.flatMap(lintFile), 1);
} else if (process.argv.length > 2) {
  report(process.argv.slice(2).map(toRel).flatMap(lintFile), 1);
} else {
  const path = hookFilePath(payload);
  if (!path) process.exit(0);
  const rel = toRel(path);
  if (rel.startsWith('..')) process.exit(0); // outside the repo
  report(lintFile(rel), 2); // exit 2 → the agent self-corrects
}
