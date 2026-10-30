#!/usr/bin/env node
// SSDD review gate — makes the pre-commit reviewer pass DETERMINISTIC instead
// of memory-dependent. Git's pre-commit runs `--pre-commit`, which routes the
// STAGED diff to the reviewer lenses it requires (routing table in
// .ssdd/config.json) and blocks until a stamp attests that those reviewers ran
// against this exact diff. Git is the only gate: it runs on every `git commit`
// whatever the harness, and judges the index it is committing.
//
// A stamp is per REVIEWER × per ROUTED FILE × that file's exact staged change.
// The key is `srcMode:srcBlob→dstMode:dstBlob` from
// `git diff --staged --raw` (`--stamp` reads a scratch copy of the index after
// `git add` of the changed routed paths), so it names both sides of the diff:
// a re-stage that changes nothing keeps the stamp, an edit, a deletion, a mode
// change or a different base voids it — for THAT file, for every reviewer routed to it.
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
// Modes (same script, no deps, Node >= 22):
//   --stamp <reviewer,…> [--files <path,…>] [--repo <path>]
//                                   attest reviewers ran on the CURRENT change
//                                   of every routed file they cover, or of the
//                                   named files only (a delta round). Keyed on
//                                   the work tree, as `git add` would stage it,
//                                   so it can run before `git add`; a file whose
//                                   staged copy differs stays owed until added.
//                                   --repo for a commit in another work tree
//   --check [--repo <path>]         what the index owes, on stdout, without
//                                   committing: exit 1 when a commit would be
//                                   blocked; writes nothing
//   --pre-commit                    the gate, run by git's pre-commit hook:
//                                   judges the index git is committing (git's
//                                   cwd, never the env); exit 1 if reviews owed
//   (no mode)                       inert. A harness entry left in a project's
//                                   settings by an older release still calls
//                                   the script: exit 0, nothing printed — except
//                                   {"permission":"allow"} for Cursor's
//                                   beforeShellExecution, whose failClosed entry
//                                   would otherwise block every shell call
//
// Stamp file: .git/ssdd-review-stamp.json (inside .git — never an untracked file).
//   { "version": 2, "reviewers": { "<name>": { "<path>": { "key", "at",
//     ["issues"] } } } }
// Bypass: SSDD_REVIEW_SKIP=1 — emergencies only, requires the USER's explicit
// go-ahead in chat (never self-authorized).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, isAbsolute, resolve } from 'node:path';
import { hookPermissionBody, parseHookStdin, resolveHookRepo } from './stdin-payload.mjs';
import { loadSsddConfig } from './ssdd-config.mjs';

let repo = resolveHookRepo(null);
const gitIn = (opts, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const git = (...args) => gitIn({}, ...args);
// Run against another index file (the --stamp scratch index) when one is given.
const onIndex = (indexFile) => (indexFile ? { env: { ...process.env, GIT_INDEX_FILE: indexFile } } : {});

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

// Map<path, key> over the staged diff of an index (the real one, or the
// --stamp scratch copy), one git call. `--raw -z` emits
// `:srcMode dstMode srcBlob dstBlob status\0path\0` per file; NUL-delimited so
// a path with a space round-trips. `--no-renames` so a rename is D + A.
const indexChanges = (indexFile) => {
  const parts = gitIn(onIndex(indexFile), 'diff', '--staged', '--raw', '--no-renames', '--abbrev=40', '-z').split('\0');
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
function mergeClean(changes, indexFile) {
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
  try { differ = new Set(gitIn(onIndex(indexFile), 'diff', '--cached', '--name-only', '--no-renames', '-z', tree).split('\0')); } catch { return null; }
  return { head: heads[0], paths: new Set([...changes.keys()].filter((p) => !differ.has(p))) };
}
// The staged changes that can owe a review: the staged diff minus a stopped
// merge's clean paths. Everything that decides what's owed reads this.
function stagedOwed() {
  const staged = indexChanges();
  const merged = mergeClean(staged);
  if (merged) for (const p of merged.paths) staged.delete(p);
  return { staged, merged };
}
// What `git add` would stage, for the routed paths that changed: the keys
// --stamp attests, so a reviewer can stamp before `git add` and the commit
// finds the same keys. git computes them (eol and clean filters, the exec bit
// and core.fileMode, symlinks, deletions) in a scratch copy of the index, which
// is removed whatever happens; the real index is never touched. The scratch
// `add` writes the blobs too, so deltaFor can find them later.
// → { changes: Map<path, key>, merged }, merge-clean paths already out.
function workTreeChanges(cfg) {
  const matches = routes(cfg).map(([, m]) => m);
  const list = (...args) => git(...args).split('\0').filter(Boolean);
  const unborn = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', 'HEAD'], { stdio: 'ignore' }).status !== 0;
  const changed = unborn
    ? [...list('diff', '--cached', '--name-only', '--no-renames', '-z'), ...list('ls-files', '-z')]
    : list('diff', 'HEAD', '--name-only', '--no-renames', '-z');
  const paths = [...new Set([...changed, ...list('ls-files', '--others', '--exclude-standard', '-z')])]
    .filter((p) => matches.some((m) => m(p)));
  const gitDir = git('rev-parse', '--absolute-git-dir').trim();
  const tmp = join(gitDir, `ssdd-stamp-index-${process.pid}`);
  try {
    const real = git('rev-parse', '--git-path', 'index').trim();
    const realIndex = isAbsolute(real) ? real : join(repo, real);
    if (existsSync(realIndex)) {
      copyFileSync(realIndex, tmp);
      // A copy is newer than every entry, so git would trust a stat-matching
      // entry; an edit made in the same instant as the stage (same size, same
      // mtime) would keep its stale blob. Dated 1970-01-01T00:00:01 (git reads
      // a zero timestamp as unset), every entry is racy and git re-reads the
      // file, as it does against the real index.
      utimesSync(tmp, 1, 1);
    }
    if (paths.length) {
      gitIn({ ...onIndex(tmp), input: paths.join('\0') + '\0' }, 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul');
    }
    const changes = indexChanges(tmp);
    const merged = mergeClean(changes, tmp);
    if (merged) for (const p of merged.paths) changes.delete(p);
    return { changes, merged };
  } finally {
    rmSync(tmp, { force: true });
  }
}

const readStamp = () => {
  try {
    const s = JSON.parse(readFileSync(stampPath(), 'utf8'));
    if (s?.version === 2 && s.reviewers && typeof s.reviewers === 'object') return s;
  } catch { /* absent or unreadable */ }
  return { version: 2, reviewers: {} }; // a version-1 (whole-diff hash) file reads as no stamps
};

// Read-modify-write of the stamp file under a short lock: parallel `--stamp`
// runs must not drop each other's stamps.
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
    if (missing.length) owed.push({ name, files, missing });
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
  return { cmd: `git diff ${p[4]} ${n[4]}`, baseMoved: p[2] !== n[2] && n[2] !== p[4] };
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
const mergeLine = (merged) =>
  `  merge: ${merged.count} staged path(s) match git's own merge with ${merged.head.slice(0, 7)} — owed by no one`;
function blockMessage({ owed, unrouted, warning, merged }, repoHint = '') {
  const lines = [];
  for (const { name, files, missing } of owed) {
    const never = missing.length === files.length && missing.every((m) => m.prev === null);
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
  if (merged) lines.push(mergeLine(merged));
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
  repo = cfg.root; // paths below are top-level relative, whatever --repo named
  const { changes, merged } = workTreeChanges(cfg);
  const table = new Map(reviewerFiles(cfg, changes));
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
        // A merge-clean path changed, but workTreeChanges() took it out of the diff.
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
            `[ssdd-review-gate] refused for ${n}: ${rest.join(', ')} — not changed, or not routed to ${n}.\n` +
            `A reviewer can be stamped only on files in its part of the change (an ignored file\n` +
            `is not one); paths are repo-relative, as \`git diff HEAD --name-only\` prints them.`,
          );
        }
        process.exit(1);
      }
      files = only;
    }
    if (!files.length) {
      console.error(`[ssdd-review-gate] refused: no changed file routes to ${n} — nothing to stamp (wrong reviewer?)`);
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
      for (const f of files) stamp.reviewers[n][f] = { key: changes.get(f), at };
    }
  });
  // The stamp names the work-tree copy (what the reviewer read). A commit
  // judges the index, so a path whose staged key differs stays owed until added.
  const staged = indexChanges();
  for (const f of new Set(plan.flatMap(([, files]) => files))) {
    if (staged.get(f) !== changes.get(f)) {
      console.error(`[ssdd-review-gate] ${f}: stamped the work-tree copy; the staged copy differs — git add it before committing`);
    }
  }
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
    process.stdout.write(
      verdict.warning + triageNote(cfg) + '[ssdd-review-gate] nothing owed\n' +
      (verdict.merged ? `${mergeLine(verdict.merged)}\n` : ''),
    );
    process.exit(0);
  }
  process.stdout.write(blockMessage(verdict, repoAt > -1 ? ` --repo ${repo}` : ''));
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
  process.stderr.write(blockMessage(verdict, ` --repo ${repo}`));
  process.exit(1);
}

// ── no mode: inert (stale harness wiring) ────────────────────────────────────
// Releases before 3.6 wired this script into the harness. A project that hasn't
// edited its settings still calls it: allow, silently. Cursor's failClosed entry
// needs a permission body on beforeShellExecution; SubagentStart (which
// hookHarness also calls "cursor") and Claude Code's events print nothing.
let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
const payload = parseHookStdin(raw);
if (payload?.hook_event_name === 'beforeShellExecution') {
  process.stdout.write(JSON.stringify(hookPermissionBody('allow')) + '\n');
}
process.exit(0);
