#!/usr/bin/env node
// SSDD git guard — enforces the non-negotiable git rules at the agent-harness
// layer (Claude Code PreToolUse(Bash); Cursor beforeShellExecution via
// .cursor/hooks.json). `git add` cannot be intercepted by a git hook, so a
// harness hook is the only mechanical enforcement point for it.
//
// Default blocks (each toggleable in .ssdd/config.json → gitGuard):
//   git add -A | git add . | git add --all     (never bulk-stage)
//   git commit … --no-verify                   (never bypass pre-commit)
//   git commit … --amend                       (never amend)
// plus any gitGuard.extraRules [{pattern, message}].
//
// Read-only; never mutates. Quoted strings and heredoc bodies are stripped
// BEFORE matching so a commit message that merely *mentions* a forbidden
// pattern is not mistaken for the command itself.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { hookCommand, hookPermissionBody, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';

const payload = parseHookStdin(readFileSync(0, 'utf8'));
const cmd = hookCommand(payload);

function finish(code, permission, extra = {}) {
  process.stdout.write(JSON.stringify(hookPermissionBody(permission, extra)) + '\n');
  process.exit(code);
}

function skeleton(s) {
  return s
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n[ \t]*\1\b/g, ' <<heredoc> ')
    .replace(/'(?:[^'\\]|\\.)*'/g, " '' ")
    .replace(/"(?:[^"\\]|\\.)*"/g, ' "" ');
}

// Collapse git's global-flag run (`git -C <path> add …`, `git -c k=v commit …`)
// so every rule below — including user-supplied extraRules — matches the
// subcommand directly and can't be bypassed by inserting flags before it.
// Only the flag run immediately following `git` is touched; the value-taking
// flags consume their argument (both `--git-dir <p>` and `--git-dir=<p>` forms),
// so a bare word like `log` always ends the run and `git log … | grep add -A 3`
// is left alone.
const GIT_VALUE_FLAGS = '-[Cc]|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env';
const dropGlobalFlags = (s) =>
  s.replace(new RegExp(String.raw`\bgit\s+(?:(?:(?:${GIT_VALUE_FLAGS})\s+\S+|--\S+|-[pP])\s+)+`, 'g'), 'git ');

const probe = dropGlobalFlags(skeleton(cmd));

let guard = {};
try {
  const repo = resolveHookRepo(payload);
  const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  guard = JSON.parse(readFileSync(join(root, '.ssdd', 'config.json'), 'utf8'))?.gitGuard ?? {};
} catch {
  // no config → defaults on
}

const RULES = [];
// `(-{1,2}[\w-]+\s+)*` tolerates flags between `add` and the bulk selector
// (`git add --force -A`); `-[a-z]*A[a-z]*` catches bundled short flags (-vA/-Av).
if (guard.blockBulkAdd !== false) RULES.push([/\bgit\s+add\s+(-{1,2}[\w-]+\s+)*(-[a-zA-Z]*A[a-zA-Z]*\b|--all\b|\.(\s|$))/,
  'Blocked: `git add -A` / `git add .` / `--all`. Stage specific files by path (project rule: never bulk-stage).']);
if (guard.blockNoVerify !== false) RULES.push([/\bgit\s+commit\b[^\n]*--no-verify/,
  'Blocked: `git commit --no-verify`. Never bypass the pre-commit hook (project rule).']);
if (guard.blockAmend !== false) RULES.push([/\bgit\s+commit\b[^\n]*--amend/,
  'Blocked: `git commit --amend`. Never amend commits (project rule).']);
for (const { pattern, message } of guard.extraRules ?? []) {
  try { RULES.push([new RegExp(pattern), message ?? `Blocked by gitGuard.extraRules: ${pattern}`]); } catch { /* bad regex → skip */ }
}

for (const [re, msg] of RULES) {
  if (re.test(probe)) {
    process.stderr.write(`[ssdd-git-guard] ${msg}\n→ ${cmd.split('\n')[0]}\n`);
    finish(2, 'deny', { agentMessage: msg, userMessage: msg });
  }
}
finish(0, 'allow');
