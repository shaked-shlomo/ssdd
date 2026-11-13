#!/usr/bin/env node
// Pre-merge migration-history check, for a project whose migrations reach
// production only through the Supabase GitHub integration's deploy on merge.
// Ported from the source project's migration skill.
//
//   node .ssdd/packs/supabase/sync-check.mjs [--pr <number>] [--base <branch>] [--digits <n>]
//
// Run from the branch's checkout (a worktree too) before opening a PR that adds
// or edits a migration, and again right before merging it. Production's history
// comes from the local CLI login (`supabase migration list --linked`, with
// --workdir = the main checkout, since a worktree has no linked project ref);
// local versions from this checkout's supabase/migrations/, uncommitted files
// included. Exit 1 on:
//   1. remote-only: a version applied in production with no file here: applied
//      out of band (MCP, a manual CLI apply), or this branch is behind the base;
//   2. out of order: a pending file older than the newest applied version;
//   3. added-but-applied: a version this branch adds that is already live,
//      unless the open PR's description declares it on its own line,
//      `applied-early: <versions…>` (an authorized early apply; strict, fails closed);
//   4. edited-applied: this branch edits an applied migration, which never re-runs;
//   5. a version whose digit count isn't the history's: 14 for timestamps
//      (`supabase migration new`), 4 for a `0001_` sequence. The width is the
//      oldest applied version's, or --digits; never the branch's own files,
//      so a mistyped prefix can't vouch for itself.
// Blind spot: it reads only supabase_migrations.schema_migrations, so DDL with
// no history row (dashboard SQL, MCP execute_sql, a proof that committed) is
// invisible. Only process prevents that.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Any numeric prefix counts as a version, as the CLI reads it; evaluate() then
// fails one of the wrong width — dropping it would let it skip every check.
const VERSION = /^\d+$/;
const num = (v) => BigInt(v);
const byNum = (a, b) => (num(a) < num(b) ? -1 : num(a) > num(b) ? 1 : 0);

/** `supabase migration list` text → [{ local, remote }]. Reads ASCII `|` with
 *  backticks (CLI ≥ 2.111) and box `│` separators (older). */
export function parseRows(text) {
  const rows = [];
  for (const line of text.replace(/│/g, '|').split('\n')) {
    const f = line.split('|');
    if (f.length < 3) continue;
    const local = f[0].replace(/[\s`]/g, '');
    const remote = f[1].replace(/[\s`]/g, '');
    if (VERSION.test(local) || VERSION.test(remote)) {
      rows.push({ local: VERSION.test(local) ? local : '', remote: VERSION.test(remote) ? remote : '' });
    }
  }
  return rows;
}

/** The history's version width: the oldest applied version's digit count. */
export function widthOf(remote) {
  const oldest = [...remote].sort(byNum)[0];
  return oldest ? oldest.length : 0;
}

/** Versions declared on a strict `applied-early:` line of a PR description. */
export function declaredEarly(body, digits) {
  const out = new Set();
  const v = `\\d{${digits}}`;
  const line = new RegExp(`^\\s*applied-early:\\s*(${v}(?:\\s+${v})*)\\s*$`);
  for (const l of (body ?? '').replace(/\r/g, '').split('\n')) {
    const m = l.match(line);
    if (m) for (const x of m[1].split(/\s+/)) out.add(x);
  }
  return out;
}

/**
 * Pure verdict. remote = applied versions; local = versions with a file in
 * this checkout; onBase = versions with a file on the base branch; added /
 * modified = versions this branch adds / edits vs the base; declared =
 * applied-early versions; digits = the history's version width.
 */
export function evaluate({ remote, local, onBase, added, modified, declared, digits }) {
  const errors = [];
  const remoteSet = new Set(remote);
  const localSet = new Set(local);
  const remoteHead = [...remoteSet].sort(byNum).at(-1) ?? '';
  const fresh = digits === 14 ? "'supabase migration new <name>'" : `the next ${digits}-digit number`;

  const malformed = [...new Set([...remoteSet, ...localSet])].filter((v) => v.length !== digits).sort(byNum);
  if (malformed.length) {
    errors.push(`versions that are not ${digits} digits: ${malformed.join(' ')}\n` +
      `   → rename the file with ${fresh}; never hand-write a prefix of another width.`);
  }

  const remoteOnly = [...remoteSet].filter((v) => !localSet.has(v)).sort(byNum);
  const behind = remoteOnly.filter((v) => onBase.has(v));
  const outOfBand = remoteOnly.filter((v) => !onBase.has(v));
  if (behind.length) {
    errors.push(`the base gained applied migrations this branch lacks: ${behind.join(' ')}\n` +
      '   → merge the base branch in. (If this branch deletes that applied file, restore it.)');
  }
  if (outOfBand.length) {
    errors.push(`applied in production with no file anywhere: ${outOfBand.join(' ')}\n` +
      '   → applied OUT-OF-BAND (MCP apply_migration, a manual CLI apply). Commit the file under that exact\n' +
      "     version (never 'migration repair --status reverted'), and apply future migrations only by merging.");
  }

  const early = [];
  const preapplied = [];
  for (const v of added) {
    if (!remoteSet.has(v)) continue;
    (declared.has(v) ? early : preapplied).push(v);
  }
  if (preapplied.length) {
    errors.push(`this branch ADDS migrations already applied in production: ${preapplied.join(' ')}\n` +
      '   → applied before merge. Only an authorized early apply is allowed; then put\n' +
      "     'applied-early: <version> …' on its own line in the PR description.");
  }

  const editedApplied = [...modified].filter((v) => remoteSet.has(v));
  if (editedApplied.length) {
    errors.push(`this branch EDITS applied migrations: ${editedApplied.join(' ')}\n` +
      `   → an applied version never re-runs. Revert the edit; ship a NEW migration (${fresh}).`);
  }

  const pending = [...localSet].filter((v) => !remoteSet.has(v)).sort(byNum);
  const outOfOrder = pending.filter((v) => remoteHead && num(v) <= num(remoteHead));
  if (outOfOrder.length) {
    errors.push(`pending migrations older than the newest applied version (${remoteHead}): ${outOfOrder.join(' ')}\n` +
      `   → renumber with ${fresh}: move the SQL to the new file, delete the old one.`);
  }

  // On the base but not applied (and not added here): the base's own deploy failed or is still running.
  const stuck = [...onBase].filter((v) => !remoteSet.has(v) && !added.has(v)).sort(byNum);
  return { errors, pending, early, stuck, remoteHead };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const versionsOf = (names) =>
  new Set(names.map((n) => n.match(/^(?:supabase\/migrations\/)?(\d+)_.*\.sql$/)?.[1]).filter(Boolean));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const base = arg('--base') ?? 'main';
  const prArg = arg('--pr');
  const digitsArg = arg('--digits');
  if (digitsArg !== undefined && !/^[1-9]\d?$/.test(digitsArg)) { console.error('❌ --digits takes a number, e.g. 14 or 4'); return 1; }
  const dir = 'supabase/migrations';
  if (!existsSync(dir)) { console.error(`❌ no ${dir}/ here — run this from the repo (or worktree) root`); return 1; }

  // The main checkout holds the linked project ref (supabase/.temp/); worktrees don't.
  const mainCheckout = dirname(resolve(sh('git', ['rev-parse', '--git-common-dir']).trim()));

  try { sh('git', ['fetch', '--quiet', 'origin', base]); }
  catch (e) { console.error(`❌ git fetch origin ${base} failed:\n${e.stderr ?? e.message}`); return 1; }
  const baseRef = `origin/${base}`;

  let listing;
  for (let attempt = 1; ; attempt++) {
    try { listing = sh('supabase', ['migration', 'list', '--linked', '--workdir', mainCheckout]); break; }
    catch (e) {
      console.error(`supabase migration list failed (attempt ${attempt}/2):\n${e.stderr ?? e.message}`);
      if (attempt === 2) return 1;
      sleep(10_000);
    }
  }
  const rows = parseRows(listing);
  if (rows.length === 0) { console.error('❌ parsed no migration rows — the CLI output format changed; fix parseRows()'); return 1; }
  const remote = rows.map((r) => r.remote).filter(Boolean);
  if (remote.length === 0) { console.error('❌ no remote versions parsed — refusing to pass vacuously'); return 1; }
  const digits = digitsArg ? Number(digitsArg) : widthOf(remote);

  const local = [...versionsOf(readdirSync(dir))];
  const onBase = versionsOf(sh('git', ['ls-tree', '--name-only', `${baseRef}:${dir}`]).split('\n'));
  const diffNames = (filter) =>
    versionsOf(sh('git', ['diff', `--diff-filter=${filter}`, '--name-only', `${baseRef}...HEAD`, '--', dir]).split('\n'));
  // Committed adds plus uncommitted and untracked new files (the pre-PR run comes before the commit).
  const added = diffNames('A');
  for (const v of local) if (!onBase.has(v)) added.add(v);
  const modified = diffNames('M');
  for (const v of versionsOf(sh('git', ['diff', '--name-only', 'HEAD', '--', dir]).split('\n'))) {
    if (onBase.has(v)) modified.add(v);
  }

  let declared = new Set();
  try {
    // Only an OPEN PR counts: without --pr, gh may resolve an old closed PR from the same branch name.
    const pr = JSON.parse(sh('gh', ['pr', 'view', ...(prArg ? [prArg] : []), '--json', 'body,state,number']));
    if (pr.state === 'OPEN') declared = declaredEarly(pr.body, digits);
    else console.log(`ℹ️  PR #${pr.number} is ${pr.state} — applied-early lines not read.`);
  } catch {
    console.log('ℹ️  no PR found for this branch (or gh failed) — applied-early lines not read.');
  }

  const v = evaluate({ remote, local, onBase, added, modified, declared, digits });
  for (const e of v.early) console.log(`⚠️  ${e} applied early (declared applied-early) — the integration will skip it.`);
  for (const s of v.stuck) console.log(`⚠️  ${s} is on ${base} but NOT applied — check the integration's deploy log for ${base}.`);
  if (v.errors.length) {
    console.error(`❌ migration history NOT in sync:\n - ${v.errors.join('\n - ')}`);
    return 1;
  }
  if (v.pending.length) console.log(`Pending — the Supabase integration applies these on merge: ${v.pending.join(' ')}`);
  console.log(`✅ migration history consistent (${remote.length} applied, newest ${v.remoteHead}).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
