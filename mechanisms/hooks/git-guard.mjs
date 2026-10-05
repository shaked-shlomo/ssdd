#!/usr/bin/env node
// SSDD git guard — enforces the non-negotiable git rules at the agent-harness
// layer (Claude Code PreToolUse(Bash); Cursor beforeShellExecution via
// .cursor/hooks.json). `git add` cannot be intercepted by a git hook, so a
// harness hook is the only mechanical enforcement point for it.
//
// Default blocks (each toggleable in .ssdd/config.json → gitGuard):
//   git add -A | -Av / -fA clusters | --all | git add .       (never bulk-stage)
//   git commit … --no-verify | -n | -nm / -anm clusters      (never bypass pre-commit)
//   git commit … --amend                                     (never amend)
//   git -c core.hooksPath=… | git config … core.hooksPath …
//   | GIT_CONFIG_PARAMETERS / GIT_CONFIG_KEY_<n> = core.hooksPath
//                                                    (never re-point or unset the hooks)
// plus any gitGuard.extraRules [{pattern, message}].
//
// Global options between `git` and the subcommand (`-C <p>`, `-c k=v`,
// `--git-dir=…`) are skipped, and each rule's flag scan stops at the end of its
// own command (`;` `&` `|` newline): `git commit -m x && git log -n 3` is not
// `commit -n`. Quoted strings and heredoc bodies are blanked first, so a message
// that merely mentions a pattern isn't the pattern. Scripts handed to a shell
// (`bash -c '…'`, `eval "…"`, `bash <<EOF`, `echo '…' | sh`) are checked as if
// typed directly. Grammar: git-cmd.mjs.
// Read-only; never mutates.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { hookCommand, hookPermissionBody, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';
import { cluster, collapseGlobalFlags, expandWrappers, gitRule, skeleton, stripHeredocs } from './git-cmd.mjs';

const payload = parseHookStdin(readFileSync(0, 'utf8'));
const cmd = hookCommand(payload);

function finish(code, permission, extra = {}) {
  process.stdout.write(JSON.stringify(hookPermissionBody(permission, extra)) + '\n');
  process.exit(code);
}
function deny(msg) {
  process.stderr.write(`[ssdd-git-guard] ${msg}\n→ ${cmd.split('\n')[0]}\n`);
  finish(2, 'deny', { agentMessage: msg, userMessage: msg });
}

const full = expandWrappers(cmd); // the command plus any script it hands to a shell
const probe = skeleton(full);

let guard = {};
try {
  const repo = resolveHookRepo(payload);
  const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  guard = JSON.parse(readFileSync(join(root, '.ssdd', 'config.json'), 'utf8'))?.gitGuard ?? {};
} catch {
  // no config → defaults on
}

// core.hooksPath is matched on the command with quotes KEPT (skeleton would
// blank `-c 'core.hooksPath=…'`) but heredocs dropped, anchored at a command
// start (after optional VAR=value assignments) so a mention inside a message
// needs a separator in front of `git` to match — a false block at worst,
// never a bypass. Config keys are case-insensitive → /i. Reads are allowed.
if (guard.blockHooksPath !== false) {
  const RUNNER = String.raw`(?:\S*\/)?(?:sudo|command|env|nohup|time|exec|nice|builtin)(?:\s+-\S+)*`;
  const START = String.raw`(?:^|[;&|(\n]\s*)(?:(?:[A-Za-z_]\w*=\S*|${RUNNER})\s+)*(?:\S*\/)?git\s+(?:(?:-[cC]\s*(?:'[^']*'|"[^"]*"|\S+)|--?[\w-]+(?:=\S*)?)\s+)*`;
  const viaFlag = new RegExp(START + String.raw`-c\s*['"]?core\.hookspath\b`, 'i');
  const viaConfig = new RegExp(START + String.raw`config\b([^;&|\n]*?)['"]?\bcore\.hookspath\b`, 'i');
  const viaEnv = /\bGIT_CONFIG_(?:PARAMETERS=[^;&|\n]*core\.hookspath|KEY_\d+=['"]?core\.hookspath\b)/i;
  const quoted = stripHeredocs(full);
  const m = viaConfig.exec(quoted);
  if (viaFlag.test(quoted) || viaEnv.test(quoted) || (m && !/(?:^|\s)(?:--get(?:-all|-regexp)?|--list|-l)\b/.test(m[1]))) {
    deny('Blocked: re-pointing or unsetting `core.hooksPath` disables the pre-commit gate (project rule).');
  }
}

const RULES = [];
if (guard.blockBulkAdd !== false) {
  RULES.push([gitRule('add', cluster('A') + String.raw`|\s--all\b|\s\.(?=\s|$)`),
    'Blocked: `git add -A` / `git add .` / `--all`. Stage specific files by path (project rule: never bulk-stage).']);
}
if (guard.blockNoVerify !== false) {
  // Known false positive of the -n cluster: `-uno` — write `--untracked-files=no`.
  RULES.push([gitRule('commit', String.raw`\s--no-verify\b|` + cluster('n')),
    'Blocked: `git commit --no-verify` (or its short form `-n`) skips the pre-commit hook (project rule). ' +
    '(For untracked-files=no, write `--untracked-files=no`.)']);
}
if (guard.blockAmend !== false) {
  RULES.push([gitRule('commit', String.raw`\s--amend\b`),
    'Blocked: `git commit --amend`. Never amend commits (project rule).']);
}
for (const [re, msg] of RULES) if (re.test(probe)) deny(msg);

// Project regexes see the subcommand right after `git` (global options collapsed).
const collapsed = collapseGlobalFlags(probe);
for (const { pattern, message } of guard.extraRules ?? []) {
  let re;
  try { re = new RegExp(pattern); } catch { continue; } // bad regex → skip
  if (re.test(collapsed)) deny(message ?? `Blocked by gitGuard.extraRules: ${pattern}`);
}
finish(0, 'allow');
