#!/usr/bin/env node
// SSDD git guard — enforces the non-negotiable git rules at the agent-harness
// layer (Claude Code PreToolUse(Bash); other harnesses rely on the same rules
// stated in AGENTS.md — `git add` cannot be intercepted by a git hook, so a
// harness hook is the only mechanical enforcement point for it).
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

let cmd = '';
try {
  cmd = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? '';
} catch {
  process.exit(0); // unparseable payload → don't block
}

function skeleton(s) {
  return s
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n[ \t]*\1\b/g, ' <<heredoc> ')
    .replace(/'(?:[^'\\]|\\.)*'/g, " '' ")
    .replace(/"(?:[^"\\]|\\.)*"/g, ' "" ');
}
const probe = skeleton(cmd);

let guard = {};
try {
  const repo = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  guard = JSON.parse(readFileSync(join(root, '.ssdd', 'config.json'), 'utf8'))?.gitGuard ?? {};
} catch {
  // no config → defaults on
}

const RULES = [];
if (guard.blockBulkAdd !== false) RULES.push([/\bgit\s+add\s+(-A\b|--all\b|\.(\s|$))/,
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
    process.exit(2);
  }
}
process.exit(0);
