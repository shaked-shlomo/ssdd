#!/usr/bin/env node
// SSDD review gate — makes the pre-commit reviewer pass DETERMINISTIC instead
// of memory-dependent. On `git commit`, routes the STAGED diff to the reviewer
// lenses it requires (routing table in .ssdd/config.json) and blocks until a
// stamp attests that those reviewers ran against this exact diff.
//
// Stamps are keyed to the staged-diff hash — a changed diff invalidates them.
// Stamping without actually running the named reviewers defeats the gate and
// is forbidden by the process (process/SDD.md §4).
//
// Modes (same script, no deps, Node >= 18):
//   --stamp <reviewer,reviewer,…>   attest reviewers ran on the CURRENT staged diff
//   --pre-commit                    portable git pre-commit mode (any harness):
//                                   exit 1 + message if reviewers are missing
//   (default: JSON on stdin)        Claude Code PreToolUse(Bash) hook mode:
//                                   intercepts `git commit`, exit 2 to block
//
// Stamp file: .git/ssdd-review-stamp.json (inside .git — never an untracked file).
// Bypass: SSDD_REVIEW_SKIP=1 — emergencies only, requires the USER's explicit
// go-ahead in chat (never self-authorized).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, isAbsolute } from 'node:path';

const repo = process.env.CLAUDE_PROJECT_DIR || process.env.SSDD_PROJECT_DIR || process.cwd();
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function loadConfig() {
  try {
    const root = git('rev-parse', '--show-toplevel').trim();
    return { root, ...JSON.parse(readFileSync(join(root, '.ssdd', 'config.json'), 'utf8')) };
  } catch {
    return null; // no repo or no config → gate disarmed
  }
}
const routes = (cfg) =>
  (cfg?.routing ?? []).map(({ reviewer, paths }) => [reviewer, (paths ?? []).map((p) => new RegExp(p))]);

const stampPath = () => {
  const dir = git('rev-parse', '--git-dir').trim();
  return join(isAbsolute(dir) ? dir : join(repo, dir), 'ssdd-review-stamp.json');
};
const stagedHash = () => createHash('sha256').update(git('diff', '--staged')).digest('hex').slice(0, 16);
const readStamp = () => {
  try { return JSON.parse(readFileSync(stampPath(), 'utf8')); } catch { return { reviewers: {} }; }
};

function missingReviewers(cfg) {
  const staged = git('diff', '--staged', '--name-only').split('\n').filter(Boolean);
  if (!staged.length) return [];
  const required = routes(cfg)
    .filter(([, res]) => staged.some((f) => res.some((re) => re.test(f))))
    .map(([name]) => name);
  if (!required.length) return [];
  const hash = stagedHash();
  const stamp = readStamp();
  return required.filter((n) => stamp.reviewers?.[n] !== hash);
}

const blockMessage = (missing, hash) =>
  `[ssdd-review-gate] staged diff (${hash}) requires reviewer(s) not yet run against it:\n` +
  missing.map((n) => `  • ${n}`).join('\n') +
  `\nRun each reviewer checklist (.ssdd/reviewers/<name>.md) against the staged diff —\n` +
  `dispatch them in parallel if your harness supports subagents — fix/triage findings,\n` +
  `re-stage, then attest:\n` +
  `  node .ssdd/hooks/review-gate.mjs --stamp ${missing.join(',')}\n` +
  `and retry the commit. Stamp only AFTER the reviewers actually ran on this diff —\n` +
  `stamping blind defeats the gate.\n`;

// ── --stamp mode ─────────────────────────────────────────────────────────────
if (process.argv[2] === '--stamp') {
  const names = (process.argv[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) { console.error('usage: review-gate.mjs --stamp <reviewer,reviewer,…>'); process.exit(1); }
  const hash = stagedHash();
  const stamp = readStamp();
  for (const n of names) stamp.reviewers[n] = hash;
  writeFileSync(stampPath(), JSON.stringify(stamp, null, 2));
  console.log(`[ssdd-review-gate] stamped ${names.join(', ')} @ staged-diff ${hash}`);
  process.exit(0);
}

// ── --pre-commit mode (portable: any harness, any human) ─────────────────────
if (process.argv[2] === '--pre-commit') {
  if (process.env.SSDD_REVIEW_SKIP === '1') {
    console.error('[ssdd-review-gate] bypassed via SSDD_REVIEW_SKIP=1 — allowed ONLY with the user\'s explicit go-ahead.');
    process.exit(0);
  }
  const cfg = loadConfig();
  if (!cfg) process.exit(0);
  const missing = missingReviewers(cfg);
  if (!missing.length) process.exit(0);
  process.stderr.write(blockMessage(missing, stagedHash()));
  process.exit(1);
}

// ── default: Claude Code PreToolUse(Bash) hook mode ──────────────────────────
let cmd = '';
try {
  cmd = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? '';
} catch {
  process.exit(0); // unparseable payload → don't block
}

// Strip quoted strings / heredoc bodies BEFORE matching, so a commit MESSAGE
// that merely mentions "git commit" (or the bypass token) never triggers or
// authorizes anything. Only real command structure is inspected.
function skeleton(s) {
  return s
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n[ \t]*\1\b/g, ' <<heredoc> ')
    .replace(/'(?:[^'\\]|\\.)*'/g, " '' ")
    .replace(/"(?:[^"\\]|\\.)*"/g, ' "" ');
}
const probe = skeleton(cmd);
if (!/\bgit\s+([^\s]+\s+)*commit\b/.test(probe)) process.exit(0);
if (/\bSSDD_REVIEW_SKIP=1\b/.test(probe)) {
  process.stderr.write('[ssdd-review-gate] bypassed via SSDD_REVIEW_SKIP=1 — allowed ONLY with the user\'s explicit go-ahead in chat.\n');
  process.exit(0);
}

const cfg = loadConfig();
if (!cfg) process.exit(0);
let missing;
try {
  missing = missingReviewers(cfg);
} catch {
  process.exit(0); // git unavailable → not this hook's problem
}
if (!missing.length) process.exit(0);
process.stderr.write(blockMessage(missing, stagedHash()));
process.exit(2);
