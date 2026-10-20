#!/usr/bin/env node
// SSDD git guard — enforces the non-negotiable git rules at the agent-harness
// layer (Claude Code PreToolUse(Bash); Cursor beforeShellExecution via
// .cursor/hooks.json). `git add` cannot be intercepted by a git hook, so a
// harness hook is the only mechanical enforcement point for it.
//
// Default blocks (each toggleable in .ssdd/config.json → gitGuard; a toggle is
// off only when the working-tree config turns it off):
//   git add -A | -Av / -fA clusters | --all | git add .       (never bulk-stage)
//   git commit … --no-verify | -n | -nm / -anm clusters      (never bypass pre-commit)
//   git commit … --amend                                     (never amend)
//   git -c core.hooksPath=… | git config … core.hooksPath <value> / --unset …
//   | GIT_CONFIG_PARAMETERS / GIT_CONFIG_KEY_<n> = core.hooksPath
//                                                    (never re-point or unset the hooks;
//                                                     a read passes)
// plus any gitGuard.extraRules [{pattern, message}]. Also, as PreToolUse(Edit|Write):
// the Edit/Write tools never touch .git/ssdd-review-* (stamp and dispatch files);
// with reviewGate.stamping "hooks", Bash can't run `review-gate.mjs --stamp` or
// touch those files either — only a reviewer's completion stamps.
//
// Global options between `git` and the subcommand (`-C <p>`, `-c k=v`,
// `--git-dir=…`) are skipped, and each rule's flag scan stops at the end of its
// own command (`;` `&` `|` newline): `git commit -m x && git log -n 3` is not
// `commit -n`. Quoted strings and heredoc bodies are blanked first, so a message
// that merely mentions a pattern isn't the pattern. Scripts handed to a shell
// (`bash -c '…'`, `eval "…"`, `bash <<EOF`, `echo '…' | sh`) are not unwrapped;
// the pre-commit layer is the backstop. Grammar: git-cmd.mjs.
// Read-only; never mutates.
import { readFileSync } from 'node:fs';
import { hookCommand, hookFilePath, hookPermissionBody, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';
import { cluster, collapseGlobalFlags, gitRule, skeleton, stripHeredocs } from './git-cmd.mjs';
import { loadSsddConfig } from './ssdd-config.mjs';

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

const probe = skeleton(cmd);

// The working-tree config (ssdd-config.mjs). No config, or one that can't be
// read or parsed, contributes nothing, so the defaults stay on. A section of
// the wrong type is dropped; the rest of the config still applies.
let config = {};
try {
  config = loadSsddConfig(resolveHookRepo(payload))?.cfg ?? {};
} catch {
  // not a repo → defaults on
}
const guard = config.gitGuard ?? {};
const STAMP_FILES = /ssdd-review-(?:stamp|dispatch)/;

// Edit / Write / MultiEdit / NotebookEdit: the gate's own state is off limits.
const filePath = hookFilePath(payload);
if (filePath && STAMP_FILES.test(filePath)) {
  deny('Blocked: .git/ssdd-review-* is the review gate\'s state — stamps come from reviewers (project rule).');
}

// core.hooksPath is matched on the command with quotes KEPT (skeleton would
// blank `-c 'core.hooksPath=…'`) but heredocs dropped, anchored at a command
// start (after optional VAR=value assignments) so a mention inside a message
// needs a separator in front of `git` to match — a false block at worst,
// never a bypass. Config keys are case-insensitive → /i.
//
// Reads are allowed. Each `git config … core.hooksPath` in the call is
// judged on its own (a read must not cover a write after it):
//   read   --get* / --list / -l, or the `get` / `list` subcommand; or no
//          write option and nothing after the key but redirections (the
//          scan stops at `)`, so `"$(git config core.hooksPath)"` reads)
//   write  a value after the key (`""` too), --unset*, --add,
//          --replace-all, -e / --edit, or the `set` / `unset` subcommand
// Arming (`git config core.hooksPath .githooks`) is a write: it stays the user's.
const READ_OPT = /(?:^|\s)(?:--get(?:-all|-regexp)?|--list|-l|get|list)(?=\s|$)/;
const WRITE_OPT = /(?:^|\s)(?:--unset(?:-all)?|--add|--replace-all|-e|--edit|set|unset)(?=\s|$)/;
// The words after the key, once redirections are dropped: none → no value.
function hasValue(tail) {
  const words = tail.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (/^\d*[<>]+&?$/.test(words[i])) { i++; continue; } // `>` / `2>` and its target
    if (/^\d*[<>]/.test(words[i])) continue;              // `2>/dev/null`, `>&2`
    return true;
  }
  return false;
}
if (guard.blockHooksPath !== false) {
  const RUNNER = String.raw`(?:\S*\/)?(?:sudo|command|env|nohup|time|exec|nice|builtin)(?:\s+-\S+)*`;
  const START = String.raw`(?:^|[;&|(\n]\s*)(?:(?:[A-Za-z_]\w*=\S*|${RUNNER})\s+)*(?:\S*\/)?git\s+(?:(?:-[cC]\s*(?:'[^']*'|"[^"]*"|\S+)|--?[\w-]+(?:=\S*)?)\s+)*`;
  const viaFlag = new RegExp(START + String.raw`-c\s*['"]?core\.hookspath\b`, 'i');
  const viaConfig = new RegExp(START + String.raw`config\b([^;&|\n]*?)(['"]?)\bcore\.hookspath\b\2([^;&|\n)]*)`, 'gi');
  const viaEnv = /\bGIT_CONFIG_(?:PARAMETERS=[^;&|\n]*core\.hookspath|KEY_\d+=['"]?core\.hookspath\b)/i;
  const quoted = stripHeredocs(cmd);
  const writes = [...quoted.matchAll(viaConfig)].some(([, before, , after]) =>
    !READ_OPT.test(before) && (WRITE_OPT.test(before) || hasValue(after)));
  if (viaFlag.test(quoted) || viaEnv.test(quoted) || writes) {
    deny('Blocked: re-pointing or unsetting `core.hooksPath` disables the pre-commit gate (project rule).');
  }
}

if (config.reviewGate?.stamping === 'hooks') {
  const quoted = stripHeredocs(cmd);
  if (/review-gate\.mjs\b[^\n;&|]*--stamp\b/.test(quoted) || STAMP_FILES.test(quoted)) {
    deny('Blocked: reviewGate.stamping is "hooks" — a reviewer\'s completion stamps its files. ' +
      'Dispatch the reviewers the gate names instead of stamping or editing the stamp file.');
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
