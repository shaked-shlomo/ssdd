#!/usr/bin/env node
// SSDD review gate — makes the pre-commit reviewer pass DETERMINISTIC instead
// of memory-dependent. On `git commit`, routes the STAGED diff to the reviewer
// lenses it requires (routing table in .ssdd/config.json) and blocks until a
// stamp attests that those reviewers ran against this exact diff.
//
// A stamp is per REVIEWER × per ROUTED FILE × that file's exact staged change.
// The key is `srcMode:srcBlob→dstMode:dstBlob` from
// `git diff --staged --raw`, so it names both sides of the diff: a re-stage
// that changes nothing keeps the stamp, an edit, a deletion, a mode change or
// a different base voids it — for THAT file, for every reviewer routed to it.
// Files that did not change keep their stamps, and a file no reviewer is
// routed to (a ledger, a doc) never enters a key at all. (v1 keyed one hash to
// the whole staged diff, so any edit anywhere voided every stamp; in the source
// project one plan ran six full review rounds over 29 files and never converged.)
//
// Stamping without actually running the named reviewers defeats the gate and
// is forbidden by the process (process/SDD.md §4).
//
// Modes (same script, no deps, Node >= 18):
//   --stamp <reviewer,…> [--files <path,…>]
//                                   attest reviewers ran on the CURRENT staged
//                                   change of every routed file they cover, or
//                                   of the named files only (a delta round)
//   --pre-commit                    portable git pre-commit mode (any harness):
//                                   exit 1 + message if reviews are owed
//   (default: JSON on stdin)        harness hook mode (Claude PreToolUse or
//                                   Cursor beforeShellExecution): intercepts
//                                   `git commit`, exit 2 to block
//
// Stamp file: .git/ssdd-review-stamp.json (inside .git — never an untracked file).
//   { "version": 2, "reviewers": { "<name>": { "<path>": { "key", "at" } } } }
// Bypass: SSDD_REVIEW_SKIP=1 — emergencies only, requires the USER's explicit
// go-ahead in chat (never self-authorized).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { hookCommand, hookPermissionBody, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';

let repo = resolveHookRepo(null);
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

// Map<path, key> over the staged diff, one git call. `--raw -z` emits
// `:srcMode dstMode srcBlob dstBlob status\0path\0` per file; NUL-delimited so
// a path with a space round-trips. `--no-renames` so a rename is D + A.
const stagedChanges = () => {
  const parts = git('diff', '--staged', '--raw', '--no-renames', '--abbrev=40', '-z').split('\0');
  const out = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\S+) (\S+) (\S+) (\S+) \S+$/.exec(parts[i]);
    if (m) out.set(parts[i + 1], `${m[1]}:${m[3]}→${m[2]}:${m[4]}`);
  }
  return out;
};
const readStamp = () => {
  try {
    const s = JSON.parse(readFileSync(stampPath(), 'utf8'));
    if (s?.version === 2 && s.reviewers && typeof s.reviewers === 'object') return s;
  } catch { /* absent or unreadable */ }
  return { version: 2, reviewers: {} }; // a version-1 (whole-diff hash) file reads as no stamps
};

// [[reviewer, routedStagedPaths]] for every reviewer with at least one staged file.
const reviewerFiles = (cfg, staged) =>
  routes(cfg)
    .map(([name, res]) => [name, [...staged.keys()].filter((f) => res.some((re) => re.test(f)))])
    .filter(([, files]) => files.length);

// The staged diff, judged: per reviewer with an unmet stamp, the routed staged
// files it still owes (with the key it last stamped, if any); the unrouted
// staged paths, for context; and the oversize warning if one is due.
function judge(cfg) {
  const staged = stagedChanges();
  const stamp = readStamp();
  const owed = [];
  const routed = new Set();
  for (const [name, files] of reviewerFiles(cfg, staged)) {
    files.forEach((f) => routed.add(f));
    const mine = stamp.reviewers[name] ?? {};
    const missing = files
      .filter((f) => mine[f]?.key !== staged.get(f))
      .map((f) => ({ path: f, prev: mine[f]?.key ?? null }));
    if (missing.length) owed.push({ name, files, missing });
  }
  const unrouted = [...staged.keys()].filter((f) => !routed.has(f)).sort();
  return { owed, unrouted, warning: oversizeWarning(cfg, routed.size) };
}

// Not a block: SDD.md §4 is per task — implement → review gate → commit — and a
// diff over N ROUTED files is the shape that does not converge (source project:
// six rounds over 29 files, 15 routed). N is config.json → reviewGate.maxRoutedFiles;
// the default sat above every task commit that converged there (2–8 routed files).
const DEFAULT_MAX_ROUTED_FILES = 10;
function oversizeWarning(cfg, routedCount) {
  const max = Number.isInteger(cfg?.reviewGate?.maxRoutedFiles)
    ? cfg.reviewGate.maxRoutedFiles
    : DEFAULT_MAX_ROUTED_FILES;
  if (routedCount <= max) return '';
  return (
    `[ssdd-review-gate] WARNING: ${routedCount} routed file(s) staged (limit ${max}). SDD.md §4 is\n` +
    `  per task — implement → review gate → commit. A diff this size rarely converges\n` +
    `  under review: split it, commit the settled part first.\n`
  );
}

// `abc1234→def5678`; the modes are shown only when they are the whole change.
// Total: a key this gate did not write (a hand-edited stamp file) is echoed as
// is, so the block message can never throw — a throw here would exit 1, which
// the PreToolUse harness reads as non-blocking, i.e. the gate would fail open.
const short = (key) => {
  const m = /^(\d+):([0-9a-f]+)→(\d+):([0-9a-f]+)$/.exec(String(key));
  if (!m) return String(key);
  const [, sm, sb, dm, db] = m;
  return sb === db ? `${sm}:${sb.slice(0, 7)}→${dm}:${db.slice(0, 7)}` : `${sb.slice(0, 7)}→${db.slice(0, 7)}`;
};
function blockMessage({ owed, unrouted, warning }) {
  const lines = [];
  for (const { name, files, missing } of owed) {
    const never = missing.length === files.length && missing.every((m) => m.prev === null);
    lines.push(
      never
        ? `  • ${name} — never stamped on this diff (${files.length} routed file(s)):`
        : `  • ${name} — owes ${missing.length} of ${files.length} routed file(s):`,
    );
    for (const { path, prev } of missing) {
      lines.push(
        never ? `      ${path}`
        : prev === null ? `      ${path}   never stamped`
        : `      ${path}   changed since its last stamp (was ${short(prev)})`,
      );
    }
  }
  if (unrouted.length) lines.push(`  also staged, routed to no reviewer: ${unrouted.join(', ')}`);
  return (
    warning +
    `[ssdd-review-gate] the staged diff owes reviews:\n` +
    lines.join('\n') +
    `\nRun each reviewer checklist (.ssdd/reviewers/<name>.md) against the files it owes —\n` +
    `dispatch them in parallel if your harness supports subagents — fix/triage findings,\n` +
    `re-stage, then attest:\n` +
    `  node .ssdd/hooks/review-gate.mjs --stamp ${owed.map(({ name }) => name).join(',')}\n` +
    `(add --files <path,…> when a reviewer re-read only those files) and retry the\n` +
    `commit. Stamp only AFTER the reviewers actually ran on those files — stamping\n` +
    `blind defeats the gate.\n`
  );
}

// ── --stamp mode ─────────────────────────────────────────────────────────────
if (process.argv[2] === '--stamp') {
  const csv = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const names = process.argv[3]?.startsWith('--') ? [] : csv(process.argv[3]);
  const filesAt = process.argv.indexOf('--files');
  const only = filesAt > -1 ? csv(process.argv[filesAt + 1]) : null;
  if (!names.length || (only && !only.length)) {
    console.error('usage: review-gate.mjs --stamp <reviewer,reviewer,…> [--files <path,path,…>]');
    process.exit(1);
  }
  const cfg = loadConfig();
  if (!cfg) { console.error('[ssdd-review-gate] no .ssdd/config.json — nothing to stamp'); process.exit(1); }
  const staged = stagedChanges();
  const table = new Map(reviewerFiles(cfg, staged));
  const known = new Set(routes(cfg).map(([name]) => name));
  // Validate everything before writing anything: a refused name or file leaves
  // the stamp file untouched, so a typo can never half-attest a round.
  const plan = [];
  for (const n of names) {
    if (!known.has(n)) {
      console.error(`[ssdd-review-gate] refused: "${n}" is not a reviewer in .ssdd/config.json routing`);
      process.exit(1);
    }
    const routed = table.get(n) ?? [];
    let files = routed;
    if (only) {
      const bad = only.filter((f) => !routed.includes(f));
      if (bad.length) {
        console.error(
          `[ssdd-review-gate] refused for ${n}: ${bad.join(', ')} — not staged, or not routed to ${n}.\n` +
          `A reviewer can be stamped only on files in its part of the staged diff; paths are\n` +
          `repo-relative, as \`git diff --staged --name-only\` prints them.`,
        );
        process.exit(1);
      }
      files = only;
    }
    if (!files.length) {
      console.error(`[ssdd-review-gate] refused: no staged file routes to ${n} — nothing to stamp (wrong reviewer?)`);
      process.exit(1);
    }
    plan.push([n, files]);
  }
  const warning = oversizeWarning(cfg, new Set([...table.values()].flat()).size);
  if (warning) process.stderr.write(warning);
  const stamp = readStamp();
  const at = new Date().toISOString();
  for (const [n, files] of plan) {
    stamp.reviewers[n] ??= {};
    for (const f of files) stamp.reviewers[n][f] = { key: staged.get(f), at };
  }
  writeFileSync(stampPath(), JSON.stringify(stamp, null, 2));
  for (const [n, files] of plan) {
    console.log(`[ssdd-review-gate] stamped ${n} on ${files.length} file(s): ${files.join(', ')}`);
  }
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
  const verdict = judge(cfg);
  if (!verdict.owed.length) {
    if (verdict.warning) process.stderr.write(verdict.warning);
    process.exit(0);
  }
  process.stderr.write(blockMessage(verdict));
  process.exit(1);
}

// ── default: harness stdin hook (Claude PreToolUse / Cursor beforeShell) ─────
const payload = parseHookStdin(readFileSync(0, 'utf8'));
repo = resolveHookRepo(payload);
const cmd = hookCommand(payload);

function finish(code, permission, extra = {}) {
  process.stdout.write(JSON.stringify(hookPermissionBody(permission, extra)) + '\n');
  process.exit(code);
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
if (!/\bgit\s+([^\s]+\s+)*commit\b/.test(probe)) finish(0, 'allow');
if (/\bSSDD_REVIEW_SKIP=1\b/.test(probe)) {
  process.stderr.write('[ssdd-review-gate] bypassed via SSDD_REVIEW_SKIP=1 — allowed ONLY with the user\'s explicit go-ahead in chat.\n');
  finish(0, 'allow');
}

const cfg = loadConfig();
if (!cfg) finish(0, 'allow');
let verdict;
try {
  verdict = judge(cfg);
} catch {
  finish(0, 'allow'); // git unavailable → not this hook's problem
}
if (!verdict.owed.length) {
  if (verdict.warning) process.stderr.write(verdict.warning);
  finish(0, 'allow');
}
process.stderr.write(blockMessage(verdict));
finish(2, 'deny', {
  agentMessage: blockMessage(verdict),
  userMessage: 'SSDD review gate: stamps owed before commit.',
});
