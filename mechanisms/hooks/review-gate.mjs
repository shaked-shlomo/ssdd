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
// A stamp names the blob its reviewer saw, so when a file changes after its
// stamp, the block message gives `git diff <stamped blob> <staged blob>`: the
// re-review reads that change, and the new stamp lands on the new blob.
//
// A merge of the default branch that stopped (a conflict, or --no-commit)
// owes only what differs from git's own merge of the two sides: conflict
// resolutions and edits made during the merge. A path equal to `git
// merge-tree --write-tree HEAD MERGE_HEAD` came in reviewed. Merging anything
// the default branch doesn't hold, an octopus merge, or a git older than
// 2.38 is judged in full. (A merge with no conflict commits without pre-commit.)
//
// Stamping without actually running the named reviewers defeats the gate and
// is forbidden by the process (process/SDD.md §4).
//
// The routing table is the working-tree .ssdd/config.json (ssdd-config.mjs).
// A config that isn't valid JSON blocks.
//
// Modes (same script, no deps, Node >= 18):
//   --stamp <reviewer,…> [--files <path,…>] [--repo <path>]
//                                   attest reviewers ran on the CURRENT staged
//                                   change of every routed file they cover, or
//                                   of the named files only (a delta round);
//                                   --repo for a commit in another work tree
//   --check [--repo <path>]         what the index owes, on stdout, without
//                                   committing: exit 1 when a commit would be
//                                   blocked; writes nothing
//   --pre-commit                    portable git pre-commit mode (any harness):
//                                   judges the index git is committing (git's
//                                   cwd, never the env); exit 1 if reviews owed
//   (default: JSON on stdin)        harness hook mode (Claude PreToolUse or
//                                   Cursor beforeShellExecution): intercepts
//                                   `git commit`, exit 2 to block
//
// Harness mode runs BEFORE the command, so it reads the index as it is now.
// It judges the repo the commit really targets — starting from the payload's
// cwd, `cd <dir>` moves, `git -C <dir>` composes, `~` expands; `$VAR` / `$(…)`
// or an unopenable repo fail CLOSED — and, when that repo has a config, refuses
// the shapes whose committed content it can't see: staging chained before the
// commit in one call (except a `git add` naming only unrouted files),
// `commit -a/-i/-o`, and `commit <pathspec>`. Scripts
// handed to a shell (`bash -c '…'`, `eval "…"`, `bash <<EOF`, `… | sh`) are
// not unwrapped: the pre-commit layer is the backstop for them.
//
//   (stdin, SubagentStart / SubagentStop — Claude Code)
//                                   completion stamps: a routed reviewer's start
//                                   snapshots the staged keys of its files; its
//                                   stop stamps the ones still unchanged, if its
//                                   last lines carry a verdict (CLEAN / SECURE /
//                                   N ISSUE(S) / N RISK(S)) and it ran on an
//                                   allowed model (reviewGate.reviewerModels,
//                                   e.g. ["opus>=5.5", "sonnet>=5.5"])
//
// Stamp file: .git/ssdd-review-stamp.json (inside .git — never an untracked file).
//   { "version": 2, "reviewers": { "<name>": { "<path>": { "key", "at",
//     ["by": "hook", "verdict", "issues", "model"] } } } }
// reviewGate.stamping: "manual" (default) | "hooks" — in hooks mode only
// completion stamps count for the agent: git-guard denies `--stamp` and writes
// to .git/ssdd-review-*, and the block message says to dispatch reviewers.
// Bypass: SSDD_REVIEW_SKIP=1 — emergencies only, requires the USER's explicit
// go-ahead in chat (never self-authorized).
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, join, isAbsolute, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { hookCommand, hookPermissionBody, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';
import { commandStart, gitInvocation, isCommit, skeleton, splitCommands } from './git-cmd.mjs';
import { ARM_HOOK, dormantHook, loadSsddConfig } from './ssdd-config.mjs';

let repo = resolveHookRepo(null);
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// The config the commit is judged by: the working-tree one (ssdd-config.mjs).
// null → not an SSDD repo, gate disarmed. A broken config comes back with
// `error` set and every mode fails closed on it.
const loadConfig = () => loadSsddConfig(repo);
const brokenMessage = (error) =>
  `[ssdd-review-gate] ${error}\n` +
  "The gate fails closed on a config it can't use. Fix .ssdd/config.json and retry.\n";
// [[reviewer, matches(path)]]. A path routes to a reviewer when it matches one
// of the route's `paths` and neither the route's `exclude` nor the global
// `reviewGate.exclude` (e.g. a test-file filter no new route can forget).
// Routes naming the same reviewer merge.
const rx = (list) => (list ?? []).map((p) => new RegExp(p));
const routes = (cfg) => {
  const global = rx(cfg?.reviewGate?.exclude);
  const byName = new Map();
  for (const { reviewer, paths, exclude } of cfg?.routing ?? []) {
    const inc = rx(paths);
    const exc = [...global, ...rx(exclude)];
    const one = (f) => inc.some((re) => re.test(f)) && !exc.some((re) => re.test(f));
    const prev = byName.get(reviewer);
    byName.set(reviewer, prev ? (f) => prev(f) || one(f) : one);
  }
  return [...byName];
};

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
// While a merge of the default branch is stopped (MERGE_HEAD holds one
// commit, and that commit is on the default branch), git's own merge of HEAD
// and that commit (`merge-tree --write-tree`, git ≥ 2.38): a staged path
// whose index entry equals it came in reviewed, so only conflict resolutions
// and edits made during the merge owe. → { head, paths } | null, and null
// judges the merge as before: no merge, an octopus, a commit the default
// branch doesn't hold (another branch, a `git stash create` object), or a
// git that can't.
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// The default branch as work-state.mjs reads it: the remote's as last fetched
// (origin/HEAD) and its local namesake, else local main or master. A commit
// either holds counts.
function onDefaultBranch(oid) {
  const quiet = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const remote = quiet('symbolic-ref', '-q', 'refs/remotes/origin/HEAD').stdout?.trim();
  const refs = remote
    ? [remote, `refs/heads/${remote.replace(/^refs\/remotes\/origin\//, '')}`]
    : ['refs/heads/main', 'refs/heads/master'];
  return refs.some((ref) => quiet('merge-base', '--is-ancestor', oid, ref).status === 0);
}
function mergeClean(staged) {
  let heads;
  try {
    const file = git('rev-parse', '--git-path', 'MERGE_HEAD').trim();
    heads = readFileSync(isAbsolute(file) ? file : join(repo, file), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch { return null; } // not merging
  if (heads.length !== 1 || !OID.test(heads[0]) || !onDefaultBranch(heads[0])) return null;
  const r = spawnSync('git', ['-C', repo, 'merge-tree', '--write-tree', 'HEAD', heads[0]],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tree = String(r.stdout ?? '').split('\n')[0].trim();
  if ((r.status !== 0 && r.status !== 1) || !OID.test(tree)) return null; // 1 = conflicts, still a tree
  let differ;
  try { differ = new Set(git('diff', '--cached', '--name-only', '--no-renames', '-z', tree).split('\0')); } catch { return null; }
  return { head: heads[0], paths: new Set([...staged.keys()].filter((p) => !differ.has(p))) };
}
// The staged changes that can owe a review: the staged diff minus a stopped
// merge's clean paths. Everything that decides what's owed reads this.
function stagedOwed() {
  const staged = stagedChanges();
  const merged = mergeClean(staged);
  if (merged) for (const p of merged.paths) staged.delete(p);
  return { staged, merged };
}

const readStamp = () => {
  try {
    const s = JSON.parse(readFileSync(stampPath(), 'utf8'));
    if (s?.version === 2 && s.reviewers && typeof s.reviewers === 'object') return s;
  } catch { /* absent or unreadable */ }
  return { version: 2, reviewers: {} }; // a version-1 (whole-diff hash) file reads as no stamps
};

const gitDir = () => {
  const dir = git('rev-parse', '--git-dir').trim();
  return isAbsolute(dir) ? dir : join(repo, dir);
};
// Read-modify-write of the stamp file under a short lock: parallel reviewers
// finishing together must not drop each other's stamps.
function updateStamp(mutate) {
  const lock = `${stampPath()}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try { mkdirSync(lock); break; } catch {
      if (Date.now() > deadline) { try { rmdirSync(lock); } catch { /* stale */ } continue; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const stamp = readStamp();
    mutate(stamp);
    writeFileSync(stampPath(), JSON.stringify(stamp, null, 2));
  } finally {
    try { rmdirSync(lock); } catch { /* already gone */ }
  }
}
const stampingMode = (cfg) => (cfg?.reviewGate?.stamping === 'hooks' ? 'hooks' : 'manual');

// Reviewers flagged issues on files that are about to be committed unchanged:
// allowed (fix-or-triage), but worth a line so triage isn't silent.
function triageNote(cfg) {
  const { staged } = stagedOwed();
  const stamp = readStamp();
  const lines = [];
  for (const [name, files] of reviewerFiles(cfg, staged)) {
    const flagged = files.filter((f) => {
      const e = stamp.reviewers[name]?.[f];
      return e?.key === staged.get(f) && e.issues > 0;
    });
    if (flagged.length) {
      const n = stamp.reviewers[name][flagged[0]].issues;
      lines.push(`  • ${name} reported ${n} finding(s) on ${flagged.join(', ')} — unchanged since`);
    }
  }
  return lines.length
    ? `[ssdd-review-gate] committing files reviewers flagged; make sure each finding was fixed elsewhere or triaged in the ledger:\n${lines.join('\n')}\n`
    : '';
}

// [[reviewer, routedStagedPaths]] for every reviewer with at least one staged file.
const reviewerFiles = (cfg, staged) =>
  routes(cfg)
    .map(([name, matches]) => [name, [...staged.keys()].filter(matches)])
    .filter(([, files]) => files.length);

// The staged diff, judged: per reviewer with an unmet stamp, the routed staged
// files it still owes (with the key it last stamped, if any); the unrouted
// staged paths, for context; and the oversize warning if one is due.
function judge(cfg) {
  const { staged, merged } = stagedOwed();
  const stamp = readStamp();
  const owed = [];
  const routed = new Set();
  for (const [name, files] of reviewerFiles(cfg, staged)) {
    files.forEach((f) => routed.add(f));
    const mine = stamp.reviewers[name] ?? {};
    const missing = files
      .filter((f) => mine[f]?.key !== staged.get(f))
      .map((f) => {
        const prev = mine[f]?.key ?? null;
        return { path: f, prev, now: staged.get(f), delta: prev === null ? null : deltaFor(prev, staged.get(f)) };
      });
    if (missing.length) owed.push({ name, files, missing, refused: stamp.refused?.[name]?.reason });
  }
  const unrouted = [...staged.keys()].filter((f) => !routed.has(f)).sort();
  return {
    owed, unrouted, warning: oversizeWarning(cfg, routed.size),
    merged: merged?.paths.size ? { head: merged.head, count: merged.paths.size } : null,
  };
}

// What a reviewer re-reads after a fix: the change from the blob its stamp
// names to the staged one. → { cmd, baseMoved } | 'gone' (that blob was
// pruned) | null (no delta: a deletion on either side, the same blob — a mode
// change — or a key this gate didn't write). Total, like short(): it feeds
// the block message. The base moved when HEAD's side changed to something
// other than the reviewed content (a rebase, not a commit of the stamped change).
const KEY = /^(\d+):([0-9a-f]+)→(\d+):([0-9a-f]+)$/;
function deltaFor(prev, now) {
  const p = KEY.exec(String(prev));
  const n = KEY.exec(String(now));
  const zero = (b) => /^0+$/.test(b);
  if (!p || !n || zero(p[4]) || zero(n[4]) || p[4] === n[4]) return null;
  try {
    execFileSync('git', ['-C', repo, 'cat-file', '-e', p[4]], { stdio: 'ignore' });
  } catch { return 'gone'; }
  return { cmd: `git diff ${p[4].slice(0, 12)} ${n[4].slice(0, 12)}`, baseMoved: p[2] !== n[2] && n[2] !== p[4] };
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
const CHECK_LINE = 'To see what\'s owed without committing: node .ssdd/hooks/review-gate.mjs --check\n';
function blockMessage({ owed, unrouted, warning, merged }, repoHint = '', mode = 'manual') {
  const lines = [];
  for (const { name, files, missing, refused } of owed) {
    const never = missing.length === files.length && missing.every((m) => m.prev === null);
    if (refused) lines.push(`  ! ${name}: ${refused}`);
    lines.push(
      never
        ? `  • ${name} — never stamped on this diff (${files.length} routed file(s)):`
        : `  • ${name} — owes ${missing.length} of ${files.length} routed file(s):`,
    );
    for (const { path, prev, delta } of missing) {
      lines.push(
        never ? `      ${path}`
        : prev === null ? `      ${path}   never stamped`
        : `      ${path}   changed since its last stamp (was ${short(prev)})`,
      );
      if (delta === 'gone') lines.push('        its stamped blob is gone: review the whole change');
      else if (delta) lines.push(`        review the change: ${delta.cmd}${delta.baseMoved ? ' (its base moved too)' : ''}`);
    }
  }
  if (unrouted.length) lines.push(`  also staged, routed to no reviewer: ${unrouted.join(', ')}`);
  if (merged) lines.push(`  merge: ${merged.count} staged path(s) match git's own merge with ${merged.head.slice(0, 7)} — owed by no one`);
  if (mode === 'hooks') {
    return (
      warning +
      `[ssdd-review-gate] the staged diff owes reviews:\n` +
      lines.join('\n') +
      `\nDispatch each owing reviewer with the Agent tool (subagent_type = its name), telling\n` +
      `it the files it owes; for a file with a \`git diff\` line, that diff is its input.\n` +
      `When it finishes with its verdict line, its completion stamps\n` +
      `those files — a file edited during its review stays owed. Fix or triage findings,\n` +
      `re-stage, and retry the commit. (reviewGate.stamping is "hooks": the agent can't run\n` +
      `--stamp; a person in a terminal can.)\n` +
      CHECK_LINE
    );
  }
  return (
    warning +
    `[ssdd-review-gate] the staged diff owes reviews:\n` +
    lines.join('\n') +
    `\nRun each reviewer checklist (.ssdd/reviewers/<name>.md) against the files it owes —\n` +
    `for a file with a \`git diff\` line, that diff is its input; dispatch them in\n` +
    `parallel if your harness supports subagents — fix/triage findings,\n` +
    `re-stage, then attest:\n` +
    `  node .ssdd/hooks/review-gate.mjs --stamp ${owed.map(({ name }) => name).join(',')}${repoHint}\n` +
    `(add --files <path,…> when a reviewer re-read only those files) and retry the\n` +
    `commit. Stamp only AFTER the reviewers actually ran on those files — stamping\n` +
    `blind defeats the gate.\n` +
    CHECK_LINE
  );
}

// ── --stamp mode ─────────────────────────────────────────────────────────────
if (process.argv[2] === '--stamp') {
  const csv = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const names = process.argv[3]?.startsWith('--') ? [] : csv(process.argv[3]);
  const filesAt = process.argv.indexOf('--files');
  const only = filesAt > -1 ? csv(process.argv[filesAt + 1]) : null;
  const repoAt = process.argv.indexOf('--repo');
  if (repoAt > -1) repo = resolve(process.argv[repoAt + 1] ?? '.');
  if (!names.length || (only && !only.length) || (repoAt > -1 && !process.argv[repoAt + 1])) {
    console.error('usage: review-gate.mjs --stamp <reviewer,reviewer,…> [--files <path,path,…>] [--repo <path>]');
    process.exit(1);
  }
  const loaded = loadConfig();
  if (!loaded) { console.error('[ssdd-review-gate] no .ssdd/config.json — nothing to stamp'); process.exit(1); }
  if (loaded.error) { process.stderr.write(brokenMessage(loaded.error)); process.exit(1); }
  const { cfg } = loaded;
  const { staged, merged } = stagedOwed();
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
        // A merge-clean path is staged, but stagedOwed() took it out of the diff.
        const clean = bad.filter((f) => merged?.paths.has(f));
        const rest = bad.filter((f) => !clean.includes(f));
        if (clean.length) {
          const many = clean.length > 1;
          console.error(
            `[ssdd-review-gate] refused for ${n}: ${clean.join(', ')} — ${many ? 'match' : 'matches'} git's own merge ` +
            `with ${merged.head.slice(0, 7)}, so ${many ? 'they are' : 'it is'} owed by no one; there's nothing to stamp.`,
          );
        }
        if (rest.length) {
          console.error(
            `[ssdd-review-gate] refused for ${n}: ${rest.join(', ')} — not staged, or not routed to ${n}.\n` +
            `A reviewer can be stamped only on files in its part of the staged diff; paths are\n` +
            `repo-relative, as \`git diff --staged --name-only\` prints them.`,
          );
        }
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
  const at = new Date().toISOString();
  updateStamp((stamp) => {
    for (const [n, files] of plan) {
      stamp.reviewers[n] ??= {};
      for (const f of files) stamp.reviewers[n][f] = { key: staged.get(f), at };
    }
  });
  for (const [n, files] of plan) {
    console.log(`[ssdd-review-gate] stamped ${n} on ${files.length} file(s): ${files.join(', ')}`);
  }
  process.exit(0);
}

// ── --check mode: what the index owes, without committing ───────────────────
// The verdict a commit would get from the index of git's cwd (or --repo), on
// stdout; exit 1 when a commit would be blocked. Writes nothing. A command's
// shape and the pre-commit's other steps aren't judged here.
if (process.argv[2] === '--check') {
  const repoAt = process.argv.indexOf('--repo');
  if (repoAt > -1 && !process.argv[repoAt + 1]) {
    console.error('usage: review-gate.mjs --check [--repo <path>]');
    process.exit(1);
  }
  repo = repoAt > -1 ? resolve(process.argv[repoAt + 1]) : process.cwd();
  const loaded = loadConfig();
  if (!loaded) { console.log('[ssdd-review-gate] no .ssdd/config.json — not gated'); process.exit(0); }
  if (loaded.error) { process.stderr.write(brokenMessage(loaded.error)); process.exit(1); }
  const { cfg } = loaded;
  repo = cfg.root;
  const verdict = judge(cfg);
  if (!verdict.owed.length) {
    process.stdout.write(verdict.warning + triageNote(cfg) + '[ssdd-review-gate] nothing owed\n');
    process.exit(0);
  }
  process.stdout.write(blockMessage(verdict, repoAt > -1 ? ` --repo ${repo}` : '', stampingMode(cfg)));
  process.exit(1);
}

// ── --pre-commit mode (portable: any harness, any human) ─────────────────────
if (process.argv[2] === '--pre-commit') {
  // git runs hooks at the top of the work tree being committed (with
  // GIT_INDEX_FILE set for -a / pathspec commits), so cwd is always right
  // and an env var can't point the gate at a decoy.
  repo = process.cwd();
  if (process.env.SSDD_REVIEW_SKIP === '1') {
    console.error('[ssdd-review-gate] bypassed via SSDD_REVIEW_SKIP=1 — allowed ONLY with the user\'s explicit go-ahead.');
    process.exit(0);
  }
  const loaded = loadConfig();
  if (!loaded) process.exit(0);
  if (loaded.error) { process.stderr.write(brokenMessage(loaded.error)); process.exit(1); }
  const { cfg } = loaded;
  const verdict = judge(cfg);
  if (!verdict.owed.length) {
    if (verdict.warning) process.stderr.write(verdict.warning);
    process.stderr.write(triageNote(cfg));
    process.exit(0);
  }
  process.stderr.write(blockMessage(verdict, '', stampingMode(cfg)));
  process.exit(1);
}

// ── default: harness stdin hook (Claude PreToolUse / Cursor beforeShell) ─────
const payload = parseHookStdin(readFileSync(0, 'utf8'));
if (payload?.hook_event_name === 'SubagentStart' || payload?.hook_event_name === 'SubagentStop') {
  try { subagentHook(payload); } catch (e) {
    process.stderr.write(`[ssdd-review-gate] completion stamp skipped: ${String(e?.message ?? e).split('\n')[0]}\n`);
  }
  process.exit(0); // observational: never blocks a subagent
}
const cmd = hookCommand(payload);

function finish(code, permission, extra = {}) {
  process.stdout.write(JSON.stringify(hookPermissionBody(permission, extra)) + '\n');
  process.exit(code);
}
function deny(msg, user = 'SSDD review gate: blocked — see the message.') {
  process.stderr.write(msg);
  finish(2, 'deny', { agentMessage: msg, userMessage: user });
}

// Quoted strings and heredoc bodies are blanked first, so a commit MESSAGE
// that mentions "git commit" (or the bypass token) never triggers or
// authorizes anything.
const probe = skeleton(cmd);
if (!isCommit(probe)) finish(0, 'allow');
if (/\bSSDD_REVIEW_SKIP=1\b/.test(probe)) {
  process.stderr.write('[ssdd-review-gate] bypassed via SSDD_REVIEW_SKIP=1 — allowed ONLY with the user\'s explicit go-ahead in chat.\n');
  finish(0, 'allow');
}

// ── which repo does the commit target? ───────────────────────────────────────
// Starting from the payload's cwd, `cd <dir>` moves, `git -C <dir>` composes,
// `~` expands; `$VAR` / `$(…)` / `cd -` can't be read before the command runs.
const commands = splitCommands(cmd); // in execution order
const start = payload?.cwd || process.env.CLAUDE_PROJECT_DIR || process.env.SSDD_PROJECT_DIR ||
  payload?.workspace_roots?.[0] || process.cwd();
const toplevel = (dir) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};
const home = homedir();
const expand = (p) => (p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p);
const unresolvable = (p) => /[$`]/.test(p) || p === '-';
// Every git invocation with the directory it runs in. `bad` is the first `cd`,
// or a commit's `-C`, that can't be read; a staging command's is its own reason.
// Only a plain `cd <dir>` is followed (its redirections aside): `pushd`,
// `popd`, and a `cd` with an option, more than one word, or a runner in front
// (`builtin cd`) can't be. That matters only if a commit comes after it.
// Every command is a step, in order; a git one carries its invocation.
const unquotedRedirect = (words, i) => /^\d*[<>]/.test(words[i]) && !words.quoted?.[i];
function withoutRedirects(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (unquotedRedirect(words, i)) { if (/^\d*[<>]+&?$/.test(words[i])) i++; continue; }
    out.push(words[i]);
  }
  return out;
}
function walk(from) {
  let cwd = from;
  let bad = null;
  let lost = null; // a directory change that can't be followed, until a commit makes it matter
  const steps = [];
  for (const all of commands) {
    const words = withoutRedirects(all);
    const at = commandStart(words);
    const head = (words[at] ?? '').split('/').pop();
    if (head === 'pushd' || head === 'popd' ||
      (head === 'cd' && (at > 0 || words.length > 2 || /^-./.test(words[1] ?? '')))) {
      lost ??= words.join(' ');
      steps.push({ name: head });
      continue;
    }
    if (head === 'cd') {
      const to = words[1] ?? '~';
      if (unresolvable(to)) bad ??= `cd ${to}`;
      cwd = resolve(cwd, expand(to));
      steps.push({ name: 'cd' });
      continue;
    }
    const inv = gitInvocation(all);
    if (!inv) { steps.push({ name: head }); continue; }
    const badC = inv.dashC.find(unresolvable);
    if (inv.sub === 'commit') {
      if (badC !== undefined) bad ??= `git -C ${badC}`;
      if (lost) bad ??= lost;
    }
    steps.push({ name: `git ${inv.sub}`, inv, words: all, dir: inv.dashC.reduce((dir, p) => resolve(dir, expand(p)), cwd), badC: badC ?? (lost ? lost : undefined) });
  }
  return { steps, bad, cwd };
}
const { steps, bad, cwd } = walk(start);
{
  const targets = steps.filter((s) => s.inv?.sub === 'commit').map((s) => s.dir);
  const roots = [...new Set((targets.length ? targets : [cwd]).map(toplevel))];
  if (!bad && roots.length > 1 && !roots.includes(null)) {
    deny(`[ssdd-review-gate] one call commits to ${roots.length} repos (${roots.join(', ')}) — commit to one repo per call.\n`);
  }
  const root = bad || roots.includes(null) ? null : roots[0];
  if (!root) {
    deny(
      `[ssdd-review-gate] cannot resolve the repo this commit targets (${bad ?? targets[0] ?? cwd}) — use a literal\n` +
      'path in `cd …` / `git -C …` (no `$VAR`, no `$(…)`, no `cd -`), then retry.\n',
    );
  }
  repo = root;
}
// `--stamp` defaults to the env's project dir or its own cwd; name the repo
// whenever the commit targets anything else (a worktree, a `cd` elsewhere).
const defaults = [start, process.env.CLAUDE_PROJECT_DIR, process.env.SSDD_PROJECT_DIR].filter(Boolean).map(toplevel);
const repoHint = defaults.every((r) => r === repo) ? '' : ` --repo ${repo}`;

// Shapes are judged only in an SSDD repo: a scratch repo passes them all.
const loaded = loadConfig();
if (!loaded) finish(0, 'allow'); // no .ssdd/config.json in that repo → not an SSDD repo
if (loaded.error) deny(brokenMessage(loaded.error), "SSDD review gate: .ssdd/config.json can't be used.");
const { cfg } = loaded;

// ── commits whose content this hook can't see are refused ────────────────────
// Harness mode runs BEFORE the command, so it reads the index as it is now.
// Staging chained before a commit is refused, except a visible `git add`: it
// names files (no option but -f / -v, no directory, glob, pathspec magic or
// expansion), inside this repo, and none is routed. Those can't change what
// the commit owes, so the index judged now owes what the commit will. Each
// file exists now, or is a tracked file being deleted. No other git command
// may run before the commit but git reads (status, diff, log, show,
// rev-parse, ls-files), since one could change the index, and none of it in
// a subshell, whose `cd` can't be followed. (Other programs are free to run:
// git called from a program is the accepted limit the pre-commit layer
// backs.) A word is a redirection only where the command has it unquoted.
const BESIDE_ADD = new Set(['git add', 'git status', 'git diff', 'git log', 'git show', 'git rev-parse', 'git ls-files']);
const STAGING = new Set(['add', 'rm', 'mv', 'restore', 'update-index']);
function chainedAddReason({ inv: { args }, words, dir, badC }) {
  if (badC !== undefined) return `where it runs (\`${badC}\`) can't be read before it runs`;
  let rootReal;
  try { rootReal = realpathSync.native(repo); } catch { rootReal = repo; }
  const routeOf = (rel) => routes(cfg).find(([, matches]) => matches(rel))?.[0];
  const offset = words.length - args.length;
  const redirect = (i) => /^\d*[<>]/.test(args[i]) && !words.quoted?.[offset + i]; // `'2>'` is a file name
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (redirect(i) && /^\d*[<>]+&?$/.test(w)) { i++; continue; } // bare redirection: skip its target
    if (redirect(i)) continue;                                     // attached redirection
    if (options && w === '--') { options = false; continue; }
    if (options && w.startsWith('-')) {
      if (!/^(?:-f|--force|-v|--verbose)$/.test(w)) return `\`${w}\``;
      continue;
    }
    if (/[$`]/.test(w)) return `\`${w}\` can't be read before it runs`;
    if (/[*?[]/.test(w)) return `a glob \`${w}\``;
    if (w.startsWith(':')) return `pathspec magic \`${w}\``;
    const abs = resolve(dir, expand(w));
    let real; // its spelling on disk: on a case-insensitive disk SRC/a.ts is src/a.ts
    try { real = realpathSync.native(abs); } catch {
      try { real = join(realpathSync.native(dirname(abs)), basename(abs)); } catch { real = abs; }
    }
    const rel = relative(rootReal, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return `\`${w}\` is outside the repo`;
    const posixRel = rel.split(sep).join('/');
    const reviewer = routeOf(posixRel);
    if (reviewer) return `\`${w}\`, routed to ${reviewer}`;
    let exists = true;
    try { lstatSync(abs); } catch { exists = false; }
    if (!exists) {
      let tracked = '';
      try { tracked = git('ls-files', '-z', '--', `:(literal)${posixRel}`); } catch { /* none */ }
      if (tracked !== `${posixRel}\0`) return `\`${w}\` doesn't exist yet`;
    }
    let isDir = rel === '';
    try { isDir ||= statSync(real).isDirectory(); } catch { /* a deletion */ }
    if (isDir) return `a directory \`${w}\``;
  }
  return '';
}
{
  let lastCommit = -1;
  steps.forEach((s, i) => { if (s.inv?.sub === 'commit') lastCommit = i; });
  const before = steps.slice(0, lastCommit);
  for (const { inv } of before) {
    if (inv && STAGING.has(inv.sub) && inv.sub !== 'add') {
      deny(
        `[ssdd-review-gate] \`git ${inv.sub}\` chained before \`git commit\` in ONE call — the gate reads\n` +
        'the index BEFORE the command runs, so it cannot see what that stages. Stage first,\n' +
        'then stamp and commit in SEPARATE calls.\n',
      );
    }
  }
  const adds = before.filter((s) => s.inv?.sub === 'add');
  const other = before.find((s) => s.inv && !BESIDE_ADD.has(s.name));
  for (const add of adds) {
    const why = /[()]/.test(probe) ? 'a subshell can\'t be followed'
      : other ? `\`${other.name}\` runs in the same call, and may change what it stages`
      : chainedAddReason(add);
    if (why) {
      deny(
        `[ssdd-review-gate] \`git add\` chained before \`git commit\` in ONE call: ${why}. The gate\n` +
        'reads the index BEFORE the command runs, so it cannot see what that stages. A chained\n' +
        'add passes only when it names files no reviewer is routed to; otherwise stage first,\n' +
        'then stamp and commit in SEPARATE calls.\n',
      );
    }
  }
}
for (const { inv } of steps.filter((s) => s.inv?.sub === 'commit')) {
  const toks = inv.args;
  // Words after `commit` (quotes already removed). Value-taking options skip
  // their value; redirections are not pathspecs.
  const valueOpts = new Set(['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c',
    '--reedit-message', '-t', '--template', '--author', '--date', '--cleanup',
    '--pathspec-from-file', '--fixup', '--squash', '-S', '--gpg-sign', '--trailer']);
  let reason = '';
  for (let i = 0; i < toks.length && !reason; i++) {
    const t = toks[i];
    if (/^\d*[<>]+&?$/.test(t)) { i++; continue; } // bare redirection: skip its target
    if (/^\d*[<>]/.test(t)) continue;               // attached redirection / <<heredoc>
    if (t === '--') { if (toks.length > i + 1) reason = 'a pathspec after --'; break; }
    if (valueOpts.has(t)) { i++; continue; }
    if (/^--(all|include|only)(=|$)/.test(t)) { reason = `\`${t}\``; continue; }
    if (/^-[a-zA-Z]+$/.test(t)) {
      // A short cluster: -a/-i/-o commit outside the index. A value-taking flag
      // ends the cluster — the rest (or the next word) is its value: `-sm wip`.
      for (let j = 1; j < t.length; j++) {
        const ch = t[j];
        if ('aio'.includes(ch)) { reason = `\`${t}\``; break; }
        if ('mFCct'.includes(ch)) { if (j === t.length - 1) i++; break; }
        if ('Su'.includes(ch)) break; // optional value, attached only
      }
      continue;
    }
    if (t.startsWith('-')) continue;
    reason = `pathspec \`${t}\``;
  }
  if (reason) {
    deny(
      `[ssdd-review-gate] \`git commit\` with ${reason} commits content OUTSIDE the staged snapshot\n` +
      'this gate judges — stage with `git add <path>` (separate call), then a bare `git commit`.\n',
    );
  }
}

let verdict;
try {
  verdict = judge(cfg);
} catch (e) {
  deny(`[ssdd-review-gate] could not evaluate the staged diff (${String(e?.message ?? e).split('\n')[0]}) — fix .ssdd/config.json or the repo, then retry.\n`);
}
// The pre-commit layer backs this hook up for commits made outside the agent;
// say so when it is switched off. git-guard denies the fix, so it's the user's.
const dormant = dormantHook(cfg.root);
const dormantNote = dormant
  ? `[ssdd-review-gate] note: the pre-commit hook is dormant in this repo (${dormant}), so commits\n` +
    `  made outside this agent aren't gated. Ask the user to run: ${ARM_HOOK}\n`
  : '';
if (!verdict.owed.length) {
  if (verdict.warning) process.stderr.write(verdict.warning);
  const note = triageNote(cfg) + dormantNote;
  if (note) {
    process.stderr.write(note);
    finish(0, 'allow', { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } });
  }
  finish(0, 'allow');
}
deny(blockMessage(verdict, stampingMode(cfg) === 'hooks' ? '' : repoHint, stampingMode(cfg)) + dormantNote, 'SSDD review gate: stamps owed before commit.');

// ── completion stamps (SubagentStart / SubagentStop) ─────────────────────────
// The verdict is the reviewer contract's last line: CLEAN / SECURE /
// N ISSUE(S) / N RISK(S). NO DIFF, or no verdict, stamps nothing.
function parseVerdict(text) {
  const tail = String(text ?? '').split('\n').map((l) => l.replace(/[*`_>#]/g, '').trim()).filter(Boolean).slice(-3).reverse();
  for (const l of tail) {
    if (/\bNO DIFF\b/.test(l)) return null;
    const clean = /^(?:verdict\W*)?(CLEAN|SECURE)\b/.exec(l);
    if (clean) return { verdict: clean[1], issues: 0 };
    const n = /^(?:verdict\W*)?(\d+)\s+(ISSUE|RISK)(?:\(S\)|S)?\b/i.exec(l);
    if (n) return { verdict: `${n[2].toUpperCase()}S`, issues: Number(n[1]) };
  }
  return null;
}

// `claude-opus-5-5`, `claude-sonnet-5-5-20260101`, `claude-opus-6` → { family,
// version }; the older `claude-3-5-sonnet-…` order too. null if unrecognized.
function parseModel(id) {
  const s = String(id).toLowerCase();
  let m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(s);
  if (m) return { family: m[1], version: [Number(m[2]), Number(m[3] ?? 0)] };
  m = /claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)/.exec(s);
  if (m) return { family: m[3], version: [Number(m[1]), Number(m[2] ?? 0)] };
  return null;
}
// An allow-list entry is `<family>` (any version), `<family>>=<major>.<minor>`
// (that family at or above that version), or else a substring of the model id.
function modelAllowed(id, entry) {
  const e = String(entry).trim().toLowerCase();
  const floor = /^(opus|sonnet|haiku|fable|mythos)\s*>=\s*(\d+)(?:\.(\d+))?$/.exec(e);
  const fam = /^(opus|sonnet|haiku|fable|mythos)$/.exec(e);
  if (!floor && !fam) return String(id).toLowerCase().includes(e);
  const m = parseModel(id);
  if (!m || m.family !== (floor ?? fam)[1]) return false;
  if (!floor) return true;
  const [maj, min] = [Number(floor[2]), Number(floor[3] ?? 0)];
  return m.version[0] > maj || (m.version[0] === maj && m.version[1] >= min);
}

// One pass over the reviewer's transcript → { models, handback }.
// models: what its turns actually ran on.
// handback: the report of a final SubagentHandback call (the desktop app ends
// subagents with one; last_assistant_message is then empty). It counts only
// as the last content block written: a later user prompt (a resumed agent)
// clears it. A user line carrying a tool_result, and meta lines (system
// reminders), don't.
function readTranscript(path) {
  const models = new Set();
  let last;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const m = j?.message?.model;
    if (m && m !== '<synthetic>') models.add(m);
    const content = j?.message?.content;
    if (j?.type === 'assistant' && Array.isArray(content) && content.length) last = content[content.length - 1];
    else if (j?.type === 'user' && !j.isMeta && !(Array.isArray(content) && content.some((b) => b?.type === 'tool_result'))) last = undefined;
  }
  const handback = last?.type === 'tool_use' && last.name === 'SubagentHandback' && typeof last.input?.message === 'string'
    ? last.input.message : undefined;
  return { models: [...models], handback };
}

function subagentHook(p) {
  const agentId = String(p.agent_id ?? '').replace(/[^\w-]/g, '_');
  const type = String(p.agent_type ?? '').replace(/^.*:/, ''); // plugin-scoped name → bare
  if (!agentId || !type) return;
  repo = p.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const loaded = loadConfig();
  if (loaded?.error) throw new Error(loaded.error);
  const cfg = loaded?.cfg;
  if (!cfg || !routes(cfg).some(([n]) => n === type)) return; // not a routed reviewer
  repo = cfg.root;
  const dir = join(gitDir(), 'ssdd-review-dispatch');
  const file = join(dir, `${agentId}.json`);

  if (p.hook_event_name === 'SubagentStart') {
    const { staged } = stagedOwed();
    const mine = new Map(reviewerFiles(cfg, staged)).get(type) ?? [];
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ reviewer: type, files: Object.fromEntries(mine.map((f) => [f, staged.get(f)])), at: new Date().toISOString() }));
    return;
  }

  let d;
  try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { return; } // no matching start
  rmSync(file, { force: true });
  // A refusal is recorded so the gate's block message can say why — the
  // orchestrating agent never sees this hook's stderr.
  const refuse = (m) => {
    process.stderr.write(`[ssdd-review-gate] ${type}: ${m}\n`);
    updateStamp((stamp) => { (stamp.refused ??= {})[type] = { at: new Date().toISOString(), reason: m }; });
  };
  const say = (m) => process.stderr.write(`[ssdd-review-gate] ${type}: ${m}\n`);
  // Which model(s) ran the review is always recorded (best effort); it is
  // enforced only when the project sets a floor. A handback is the
  // reviewer's final word, so it takes precedence.
  let models = [];
  let handback;
  try { ({ models, handback } = readTranscript(p.agent_transcript_path)); } catch { /* unreadable */ }
  const v = parseVerdict(handback ?? p.last_assistant_message);
  if (!v) return refuse('its last review ended without a verdict line (or with NO DIFF) — nothing stamped');
  // The configured list, if any: a model must pass it.
  for (const allowed of cfg.reviewGate?.reviewerModelSets ?? []) {
    const ok = models.length && models.every((m) => allowed.some((a) => modelAllowed(m, a)));
    if (!ok) return refuse(`its last review ran on ${models.join(', ') || 'an unknown model'}; reviewGate.reviewerModels allows ${allowed.join(', ')} — nothing stamped (run the session on an allowed model, and don't override the model when dispatching)`);
  }
  const staged = stagedChanges();
  const keep = Object.keys(d.files).filter((f) => staged.get(f) === d.files[f]);
  const moved = Object.keys(d.files).filter((f) => !keep.includes(f));
  if (keep.length) {
    const at = new Date().toISOString();
    updateStamp((stamp) => {
      if (stamp.refused) delete stamp.refused[type];
      stamp.reviewers[type] ??= {};
      for (const f of keep) {
        stamp.reviewers[type][f] = { key: staged.get(f), at, by: 'hook', verdict: v.verdict, issues: v.issues, ...(models.length ? { model: models.join(',') } : {}) };
      }
    });
  }
  say(`stamped ${keep.length} file(s) (${v.verdict}${v.issues ? ` ${v.issues}` : ''})` +
    (moved.length ? `; still owed, changed during review: ${moved.join(', ')}` : ''));
}
