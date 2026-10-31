#!/usr/bin/env node
// SSDD git guard — Claude Code PreToolUse(Bash) and Cursor beforeShellExecution
// (.cursor/hooks.json). The git pre-commit is the review gate; this hook only
// keeps the agent from switching it off, and says so when a command is risky.
//
// Two blocks (each denies, exit 2):
//   git commit … --no-verify | -n | -nm / -anm clusters      (never bypass pre-commit)
//   git -c core.hooksPath=… | git config … core.hooksPath <value> / --unset …
//                                                    (never re-point or unset the hooks;
//                                                     a read passes)
// Two warnings (the command runs; the agent is told):
//   git add -A | -Av / -fA clusters | --all | git add .   (stages everything: check what went in)
//   git commit … --amend                                  (rewrites the last commit)
// plus any gitGuard.extraRules [{pattern, message}] from the working-tree
// .ssdd/config.json (a block). Nothing else in the config is read: the nine
// toggles and reviewGate.stamping are gone, and the Edit/Write check of
// .git/ssdd-review-* with them. Each comes back only with an incident that
// shows the pre-commit alone isn't enough.
//
// A warning reaches the agent as hookSpecificOutput.additionalContext on Claude
// Code (it never sees stderr from a hook that exits 0) and as agent_message on
// a Cursor allow (undocumented there: best effort). A plain allow prints
// nothing on Claude Code.
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
import { hookCommand, hookHarness, hookPermissionBody, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';
import { cluster, collapseGlobalFlags, gitRule, skeleton, splitCommands, stripHeredocs } from './git-cmd.mjs';
import { loadSsddConfig } from './ssdd-config.mjs';

const payload = parseHookStdin(readFileSync(0, 'utf8'));
const cmd = hookCommand(payload);

// Cursor's failClosed needs a permission body every time. Claude Code acts on
// the exit code (2 = block, stderr to the agent), so an allow prints nothing,
// unless it carries a warning: that goes out as additionalContext, the only
// output of an allowed PreToolUse call the model sees.
function finish(code, permission, extra = {}) {
  const claude = hookHarness(payload) === 'claude';
  if (claude && permission === 'allow' && extra.agentMessage) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: extra.agentMessage } }) + '\n');
  } else if (permission !== 'allow' || !claude) {
    process.stdout.write(JSON.stringify(hookPermissionBody(permission, extra)) + '\n');
  }
  process.exit(code);
}
function deny(msg) {
  process.stderr.write(`[ssdd-git-guard] ${msg}\n→ ${cmd.split('\n')[0]}\n`);
  finish(2, 'deny', { agentMessage: msg, userMessage: msg });
}
function warn(msg) {
  finish(0, 'allow', { agentMessage: msg });
}

const probe = skeleton(cmd);

// The working-tree config (ssdd-config.mjs), for extraRules only. No config,
// or one that can't be read or parsed, contributes nothing; the blocks and
// warnings below don't depend on it.
let config = {};
try {
  config = loadSsddConfig(resolveHookRepo(payload))?.cfg ?? {};
} catch {
  // not a repo → no extra rules
}

// core.hooksPath is matched on the command with quotes KEPT (skeleton would
// blank `-c 'core.hooksPath=…'`) but heredocs dropped, anchored at a command
// start (after optional VAR=value assignments) so a mention inside a message
// needs a separator in front of `git` to match — a false block at worst,
// never a bypass. Config keys are case-insensitive → /i.
//
// Reads are allowed. Each `git config … core.hooksPath` in the call is
// judged on its own (a read must not cover a write after it), and it's a
// write when:
//   - its first word after `config` is `set`, `unset`, `edit`,
//     `rename-section` or `remove-section`;
//   - any word before the key, quotes removed, is `-e` or one of the long
//     write options spelled out (`--unset-all`, not `--unset-a`);
//   - anything but an exact redirection follows the key: a value, `""`, a
//     process substitution, or a --get value pattern. The scan stops at `)`,
//     so `"$(git config core.hooksPath)"` is a read.
// Everything else (`git config [--local|--show-origin|get|--get] core.hooksPath`,
// an option the shell would expand) is a read: the pre-commit layer is the
// backstop for what this scan can't see. Arming (`git config core.hooksPath
// .githooks`) is a write: the user's.
const WRITE_LONG = ['--unset', '--unset-all', '--add', '--replace-all', '--edit'];
const isWriteOption = (w) => w === '-e' || WRITE_LONG.includes(w);
const REDIRECT = String.raw`\d*(?:>>?|<|>&|<&|&>>?|>\|)`;
const REDIRECT_BARE = new RegExp(`^${REDIRECT}$`);              // its target is the next word
const REDIRECT_ATTACHED = new RegExp(`^${REDIRECT}[^(<>&|]\\S*$`); // `2>/dev/null`, `2>&1`
function configWrites(before, after) {
  const words = splitCommands(before).flat();
  if (/^(?:set|unset|edit|rename-section|remove-section)$/.test(words[0] ?? '')) return true;
  if (words.some(isWriteOption)) return true;
  const tail = after.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tail.length; i++) {
    if (REDIRECT_BARE.test(tail[i])) { i++; continue; }
    if (REDIRECT_ATTACHED.test(tail[i])) continue;
    return true;
  }
  return false;
}
{
  const RUNNER = String.raw`(?:\S*\/)?(?:sudo|command|env|nohup|time|exec|nice|builtin)(?:\s+-\S+)*`;
  const START = String.raw`(?:^|[;&|(\n]\s*)(?:(?:[A-Za-z_]\w*=\S*|${RUNNER})\s+)*(?:\S*\/)?git\s+(?:(?:-[cC]\s*(?:'[^']*'|"[^"]*"|\S+)|--?[\w-]+(?:=\S*)?)\s+)*`;
  const viaFlag = new RegExp(START + String.raw`-c\s*['"]?core\.hookspath\b`, 'i');
  // The tail runs to a separator or `)`; `&` and `|` inside a redirection (`2>&1`, `>|`) don't end it.
  const viaConfig = new RegExp(START + String.raw`config\b([^;&|\n]*?)(['"]?)\bcore\.hookspath\b\2((?:[<>]&|&>|>\||[^;&|\n)])*)`, 'gi');
  const quoted = stripHeredocs(cmd);
  const writes = [...quoted.matchAll(viaConfig)].some(([, before, , after]) => configWrites(before, after));
  if (viaFlag.test(quoted) || writes) {
    deny('Blocked: re-pointing or unsetting `core.hooksPath` disables the pre-commit gate (project rule).');
  }
}

// Known false positive of the -n cluster: `-uno` — write `--untracked-files=no`.
if (gitRule('commit', String.raw`\s--no-verify\b|` + cluster('n')).test(probe)) {
  deny('Blocked: `git commit --no-verify` (or its short form `-n`) skips the pre-commit hook (project rule). ' +
    '(For untracked-files=no, write `--untracked-files=no`.)');
}

// Project regexes see the subcommand right after `git` (global options collapsed).
const collapsed = collapseGlobalFlags(probe);
for (const { pattern, message } of config.gitGuard?.extraRules ?? []) {
  let re;
  try { re = new RegExp(pattern); } catch { continue; } // bad regex → skip
  if (re.test(collapsed)) deny(message ?? `Blocked by gitGuard.extraRules: ${pattern}`);
}

// Warnings come last: a command a block refuses prints only the block.
const warnings = [];
if (gitRule('add', cluster('A') + String.raw`|\s--all\b|\s\.(?=\s|$)`).test(probe)) {
  warnings.push('[ssdd-git-guard] `git add -A` / `.` / `--all` stages everything in the work tree, secrets and scratch files included. ' +
    "Before committing, check `git diff --staged --name-only` and unstage what isn't this task's (`git restore --staged <path>`); next time stage by path.");
}
if (gitRule('commit', String.raw`\s--amend\b`).test(probe)) {
  warnings.push('[ssdd-git-guard] `git commit --amend` rewrites the last commit. ' +
    "Amend only a commit that isn't pushed: a pushed one needs a force push.");
}
if (warnings.length) warn(warnings.join('\n'));
finish(0, 'allow');
