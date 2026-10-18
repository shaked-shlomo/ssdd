#!/usr/bin/env node
// SSDD installer / updater — zero deps, Node >= 18, git CLI.
//
//   ssdd.mjs install <target> [adapters] [--ref <ref>] [--force]
//   ssdd.mjs update  <target> [--to <ref>] [--adapters <a,b>] [--force]
//   ssdd.mjs adopt   <target> --base <ref> [--to <ref>] [--adapters <a,b>]
//   ssdd.mjs status  <target> [--skills]
//
// adapters: comma-separated claude-code, cursor, generic (default: generic).
//
// Content always comes from a git ref of this repo — by default the newest
// vX.Y.Z tag — never from the working tree, so the lock's commit is exactly
// what was installed. <target>/.ssdd/ssdd.lock.json records the version, the
// commit, the adapters, and for every framework-owned ("managed") file its
// source path and sha256. `update` three-way merges each managed file: base =
// the locked commit's copy, ours = the project's file, theirs = the new
// version. Project edits survive, upstream fixes land, real conflicts get
// standard conflict markers. "Seeded" files (config.json, skills.json, AGENTS.md,
// CLAUDE.md, .claude/settings.json) are project-owned: update never touches
// them and prints how their templates changed instead.
//
// A repo runs fully without this checkout; only update/adopt/status need it.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARM_HOOK, DEFAULT_PATHS, dormantHook, foreignHook, loadSsddConfig } from '../mechanisms/hooks/ssdd-config.mjs';
import { collect, ledgerIgnoreRule } from '../mechanisms/hooks/work-state.mjs';

const LOCK = '.ssdd/ssdd.lock.json';
// Superpowers writes this file as `*` when none exists (create-only); SSDD's
// version keeps each plan's progress.md ledger in git. Its default is replaced,
// anything else is the project's.
const SP_GITIGNORE = '.superpowers/sdd/.gitignore';
const isSuperpowersDefault = (buf) => buf !== null && buf.toString('utf8').trim() === '*';
const ADAPTERS = ['claude-code', 'cursor', 'generic'];
// Source paths that moved between versions: [current prefix, older prefix].
// Used only to find a pre-lock install's base copy (`adopt`).
const LEGACY_SOURCES = [['skills/', 'adapters/claude-code/skills/']];

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv.shift();
const pos = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--force' || a === '--skills') opt[a.slice(2)] = true;
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
  else pos.push(a);
}
const SRC = resolve(opt.source || process.env.SSDD_SOURCE || join(dirname(fileURLToPath(import.meta.url)), '..'));

function die(msg) { console.error(`ssdd: ${msg}`); process.exit(2); }
function usage() {
  die('usage: ssdd.mjs install <target> [adapters] [--ref <ref>] | update <target> [--to <ref>] ' +
      '[--adapters a,b] [--force] | adopt <target> --base <ref> [--to <ref>] [--adapters a,b] | status <target> [--skills]');
}

// ── git / fs helpers ─────────────────────────────────────────────────────────
const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const read = (p) => (existsSync(p) && !lstatSync(p).isDirectory() ? readFileSync(p) : null);
const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;
// JSON files that differ only in formatting count as equal.
function equivalent(a, b, path) {
  if (same(a, b)) return true;
  if (a === null || b === null || !path.endsWith('.json')) return false;
  try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)); } catch { return false; }
}

function walk(root, sub) {
  const out = [];
  const dir = join(root, sub);
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const rel = `${sub}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

function resolveRef(ref) {
  if (!ref) {
    const tags = tryGit(SRC, 'tag', '--list', 'v*', '--sort=-v:refname');
    ref = tags ? tags.split('\n')[0] : 'HEAD';
  }
  const commit = tryGit(SRC, 'rev-parse', '--verify', `${ref}^{commit}`);
  if (!commit) die(`unknown ref "${ref}" in ${SRC} (try: git -C ${SRC} fetch --tags)`);
  if (ref === 'HEAD' && tryGit(SRC, 'status', '--porcelain')) {
    console.warn('ssdd: note — uncommitted changes in the ssdd checkout are not included (content comes from commits)');
  }
  return { ref, commit };
}

const trees = [];
function exportTree(commit) {
  const dir = mkdtempSync(join(tmpdir(), 'ssdd-tree-'));
  trees.push(dir);
  execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', SRC, commit, dir]);
  return dir;
}
process.on('exit', () => { for (const d of trees) rmSync(d, { recursive: true, force: true }); });

// A release is a commit tagged v<VERSION>; anything else is <VERSION>+<sha7>,
// so a lock taken from a dev commit never claims to be a release.
function versionOf(commit, tree) {
  const tag = tryGit(SRC, 'describe', '--tags', '--exact-match', '--match', 'v*', commit);
  const f = join(tree, 'VERSION');
  if (existsSync(f)) {
    const v = readFileSync(f, 'utf8').trim();
    return tag === `v${v}` ? v : `${v}+${commit.slice(0, 7)}`;
  }
  return tag ? tag.replace(/^v/, '') : `0.0.0+${commit.slice(0, 7)}`;
}

const semver = (v) => String(v).split(/[+-]/)[0].split('.').map(Number);
function cmpVersion(a, b) {
  const x = semver(a); const y = semver(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

function parseAdapters(s, fallback) {
  const list = (s ?? fallback ?? 'generic').toString().split(',').map((x) => x.trim()).filter(Boolean);
  for (const a of list) if (!ADAPTERS.includes(a)) die(`unknown adapter: ${a} (${ADAPTERS.join('|')})`);
  return list;
}

function writeFile(dst, buf, modeFrom) {
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, buf);
  if (modeFrom) chmodSync(dst, statSync(modeFrom).mode & 0o777);
}

// ── the one source → target mapping (install, update and adopt share it) ─────
function plan(tree, adapters) {
  const managed = {};
  const seeded = {};
  const add = (map, target, src) => { if (existsSync(join(tree, src))) map[target] = src; };
  for (const f of walk(tree, 'process')) managed[`.ssdd/${f}`] = f;
  for (const f of walk(tree, 'reviewers')) managed[`.ssdd/${f}`] = f;
  for (const f of walk(tree, 'mechanisms/hooks')) if (f.endsWith('.mjs')) managed[`.ssdd/hooks/${basename(f)}`] = f;
  add(managed, '.ssdd/drift-audit.md', 'mechanisms/drift-audit.md');
  add(managed, '.githooks/pre-commit', 'mechanisms/hooks/pre-commit');
  add(managed, SP_GITIGNORE, 'mechanisms/superpowers-sdd.gitignore');
  for (const f of walk(tree, 'skills')) managed[`.agents/${f}`] = f;
  if (adapters.includes('cursor')) {
    add(managed, '.cursor/hooks.json', 'adapters/cursor/hooks.json');
    add(managed, '.cursor/rules/ssdd.mdc', 'adapters/cursor/rules/ssdd.mdc');
  }
  add(seeded, '.ssdd/config.json', 'mechanisms/config.example.json');
  add(seeded, '.ssdd/skills.json', 'mechanisms/skills.example.json');
  add(seeded, 'AGENTS.md', 'adapters/generic/AGENTS.md');
  if (adapters.includes('claude-code')) {
    add(seeded, '.claude/settings.json', 'adapters/claude-code/settings-hooks.json');
    add(seeded, 'CLAUDE.md', 'adapters/claude-code/CLAUDE.md');
  }
  return { managed, seeded };
}

// Harness discovery paths are symlinks onto the single source of truth.
function linkAll(target, adapters, log) {
  if (!adapters.includes('claude-code')) return;
  const link = (rel, dst) => {
    const abs = join(target, dst);
    const real = join(dirname(abs), rel);
    let st = null;
    try { st = lstatSync(abs); } catch { /* absent */ }
    if (st?.isSymbolicLink()) return;
    if (st) {
      // A v1-style copy identical to its source is replaced; an edited one is left.
      if (st.isFile() && same(read(abs), read(real))) {
        unlinkSync(abs); symlinkSync(rel, abs); log(`relinked  ${dst} (identical copy → symlink)`);
      } else {
        log(`WARNING   ${dst} is a copy, not a symlink — move its edits into ${rel.replace(/^(\.\.\/)+/, '')}, then: ln -sfn ${rel} ${dst}`);
      }
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    symlinkSync(rel, abs);
    log(`linked    ${dst} -> ${rel}`);
  };
  for (const f of walk(target, '.ssdd/reviewers')) {
    const name = basename(f);
    if (name === 'domain-reviewer-template.md' || !name.endsWith('.md')) continue;
    link(`../../.ssdd/reviewers/${name}`, `.claude/agents/${name}`);
  }
  const skills = join(target, '.agents/skills');
  if (existsSync(skills)) {
    for (const e of readdirSync(skills, { withFileTypes: true })) {
      if (e.isDirectory()) link(`../../.agents/skills/${e.name}`, `.claude/skills/${e.name}`);
    }
  }
}

function seedOne(target, t, tree, s, log) {
  let dst = t;
  if (t === 'AGENTS.md' && existsSync(join(target, 'AGENTS.md'))) dst = 'AGENTS.ssdd.md';
  if (existsSync(join(target, dst))) return;
  writeFile(join(target, dst), readFileSync(join(tree, s)), join(tree, s));
  log(`seeded    ${dst}${dst !== t ? ' (merge into AGENTS.md, then delete it)' : ''}`);
}

const readLock = (target) => {
  const p = join(target, LOCK);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
function writeLock(target, lock) {
  mkdirSync(join(target, '.ssdd'), { recursive: true });
  writeFileSync(join(target, LOCK), JSON.stringify(lock, null, 2) + '\n');
}
function lockFrom(version, ref, commit, adapters, p, tree) {
  const managed = {};
  for (const [t, s] of Object.entries(p.managed)) managed[t] = { src: s, sha256: sha(readFileSync(join(tree, s))) };
  const seeded = {};
  for (const [t, s] of Object.entries(p.seeded)) seeded[t] = { src: s };
  return { ssdd: version, ref, commit, adapters, updatedAt: new Date().toISOString(), managed, seeded };
}

// Arm the portable pre-commit layer: set core.hooksPath to .githooks when it
// is unset, or when it is an absolute path to a checkout's .githooks (shared
// by every worktree, so each would run that one copy). A value that belongs
// to something else (.husky, .git/hooks), or an unset one with real hooks in
// .git/hooks, is left for the user. Only at the top
// of a work tree that has .githooks/pre-commit. → true when it is armed.
// → { value, state: 'armed' | 'armable' | 'other' }, or null when the target
// isn't the top of a work tree with .githooks/pre-commit.
function hookSetting(target) {
  if (tryGit(target, 'rev-parse', '--is-inside-work-tree') !== 'true') return null;
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const top = tryGit(target, 'rev-parse', '--show-toplevel');
  if (!top || real(top) !== real(target) || !existsSync(join(target, '.githooks', 'pre-commit'))) return null;
  const value = tryGit(target, 'config', '--get', 'core.hooksPath') ?? '';
  if (!value) {
    // Unset, but a hook in .git/hooks (pre-commit framework, lefthook, a
    // hand-written one) would stop running once hooksPath is set.
    const dir = tryGit(target, 'rev-parse', '--git-path', 'hooks');
    let own = [];
    try { own = readdirSync(resolve(target, dir ?? '.git/hooks')).filter((f) => !f.endsWith('.sample')); } catch { /* none */ }
    return { value, state: own.length ? 'other' : 'armable' };
  }
  const path = value.replace(/^~(?=\/|$)/, homedir());
  if (!isAbsolute(path)) return { value, state: real(resolve(target, path)) === real(join(target, '.githooks')) ? 'armed' : 'other' };
  const trees = (tryGit(target, 'worktree', 'list', '--porcelain') ?? '').split('\n')
    .filter((l) => l.startsWith('worktree ')).map((l) => real(join(l.slice('worktree '.length), '.githooks')));
  return { value, state: trees.includes(real(path)) ? 'armable' : 'other' };
}
function armHook(target, log) {
  const h = hookSetting(target);
  if (h?.state !== 'armable') return h?.state === 'armed';
  const { value } = h;
  git(target, 'config', 'core.hooksPath', '.githooks');
  log(`armed     core.hooksPath = .githooks${value ? ` (was "${value}")` : ''}`);
  return true;
}

function nextSteps(target, adapters, armed) {
  const steps = [
    ...(armed ? [] : [`git -C '${target}' config core.hooksPath .githooks`]),
    "Edit .ssdd/config.json routing/lint for THIS project's paths (the shipped values are examples)",
    'Fill the Documentation Map and Harnesses rows in AGENTS.md (or merge AGENTS.ssdd.md into it, then delete it)',
    'Fill the project domain list in .agents/skills/docs-drift-audit/SKILL.md',
    'Run /skills-audit to pick the stack\'s best-practice skills (in Claude Code it also offers the automation recommender)',
  ];
  if (existsSync(join(target, 'package.json'))) {
    steps.splice(1, 0, `Optional: add "prepare": "${ARM_HOOK}" to package.json scripts, so a fresh clone arms the hook on install`);
  }
  if (adapters.includes('claude-code')) {
    steps.push('If .claude/settings.json already existed, merge adapters/claude-code/settings-hooks.json into it');
    steps.push('Make sure CLAUDE.md starts with @AGENTS.md (see adapters/claude-code/CLAUDE.md)');
  }
  steps.push('Reload the agent session so hooks take effect; run: node --test .ssdd/hooks/*.selftest.mjs');
  steps.push(`Commit the whole setup, including ${LOCK} — the framework travels with the repo`);
  console.log('\nManual steps left:');
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}

// ── install ──────────────────────────────────────────────────────────────────
function install(target) {
  const adapters = parseAdapters(opt.adapters ?? pos[1]);
  const existing = readLock(target);
  if (existing) die(`already installed (v${existing.ssdd}); use: update ${target}`);
  const { ref, commit } = resolveRef(opt.ref);
  const tree = exportTree(commit);
  const version = versionOf(commit, tree);
  const p = plan(tree, adapters);
  const clash = Object.entries(p.managed)
    .filter(([t, s]) => existsSync(join(target, t)) && !same(read(join(target, t)), read(join(tree, s))))
    .filter(([t]) => !(t === SP_GITIGNORE && isSuperpowersDefault(read(join(target, t)))))
    .map(([t]) => t);
  if (clash.length && !opt.force) {
    die(`${clash.length} framework file(s) already exist with different content (e.g. ${clash[0]}).\n` +
        `This looks like a pre-lock install: run  adopt ${target} --base <the ssdd version it came from>  then update.\n` +
        'Or pass --force to overwrite them.');
  }
  const log = (m) => console.log(`  ${m}`);
  console.log(`Installing SSDD v${version} (${ref} ${commit.slice(0, 7)}) into ${target} — adapters: ${adapters.join(',')}`);
  for (const [t, s] of Object.entries(p.managed)) writeFile(join(target, t), readFileSync(join(tree, s)), join(tree, s));
  log(`wrote     ${Object.keys(p.managed).length} framework file(s)`);
  for (const [t, s] of Object.entries(p.seeded)) seedOne(target, t, tree, s, log);
  // The folders the config names (a project's own config may move them).
  const paths = loadSsddConfig(target)?.cfg?.paths ?? DEFAULT_PATHS;
  for (const d of Object.values(paths)) mkdirSync(join(target, d), { recursive: true });
  linkAll(target, adapters, log);
  writeLock(target, lockFrom(version, ref, commit, adapters, p, tree));
  log(`locked    ${LOCK} @ v${version}`);
  nextSteps(target, adapters, armHook(target, log));
}

// ── update ───────────────────────────────────────────────────────────────────
function merge3(local, base, up, t, vOld, vNew) {
  const d = mkdtempSync(join(tmpdir(), 'ssdd-merge-'));
  trees.push(d);
  const [o, b, u] = ['ours', 'base', 'theirs'].map((n) => join(d, n));
  writeFileSync(o, local); writeFileSync(b, base); writeFileSync(u, up);
  const r = spawnSync('git', ['merge-file', '-p', '-L', `${t} (project)`, '-L', `${t} (ssdd v${vOld})`,
    '-L', `${t} (ssdd v${vNew})`, o, b, u], { maxBuffer: 64 * 1024 * 1024 });
  return { conflicts: r.status, out: r.stdout };
}

// CHANGELOG sections after `from` up to `to`. A `+sha` target is a commit past
// its VERSION, so it also carries the sections headed "unreleased".
function changelogSections(tree, from, to) {
  const f = join(tree, 'CHANGELOG.md');
  if (!existsSync(f)) return [];
  const dev = String(to).includes('+');
  return readFileSync(f, 'utf8').split(/^(?=## \[?\d+\.\d+\.\d+)/m).filter((s) => {
    const m = /^## \[?(\d+\.\d+\.\d+)\]?([^\n]*)/.exec(s);
    if (!m || cmpVersion(m[1], from) <= 0) return false;
    return cmpVersion(m[1], to) <= 0 || (dev && /unreleased/i.test(m[2]));
  });
}
const changelogBetween = (tree, from, to) => changelogSections(tree, from, to).join('').trim();

// Each crossed version's `### Upgrade…` subsection, oldest first: the manual
// steps a MAJOR needs (CHANGELOG.md's header says they live there).
function upgradeSteps(tree, from, to) {
  return changelogSections(tree, from, to).reverse().map((s) => {
    const body = [];
    let inside = false;
    for (const line of s.split('\n')) {
      if (/^#{2,3} /.test(line)) inside = /^### Upgrade/i.test(line);
      else if (inside) body.push(line);
    }
    const text = body.join('\n').trim();
    return text ? `v${/^## \[?(\d+\.\d+\.\d+)/.exec(s)[1]}:\n${text}` : '';
  }).filter(Boolean);
}

// The onboarding steps still open: the work-state view's onboarding lines.
function onboarding(target) {
  let lines = [];
  try { lines = collect(target)?.onboarding ?? []; } catch { /* no view, no lines */ }
  return lines.map((l) => `onboarding: ${l}`);
}

function update(target) {
  const lock = readLock(target);
  if (!lock) die(`no ${LOCK} in ${target}. For a pre-lock install run: adopt ${target} --base <ref>`);
  const adapters = parseAdapters(opt.adapters, lock.adapters.join(','));
  if (!tryGit(SRC, 'rev-parse', '--verify', `${lock.commit}^{commit}`)) {
    die(`locked commit ${lock.commit.slice(0, 7)} (v${lock.ssdd}) is not in ${SRC} — git -C ${SRC} fetch --tags`);
  }
  const { ref, commit } = resolveRef(opt.to);
  const baseTree = exportTree(lock.commit);
  const newTree = exportTree(commit);
  const version = versionOf(commit, newTree);
  const p = plan(newTree, adapters);
  const targets = [...new Set([...Object.keys(lock.managed), ...Object.keys(p.managed)])].sort();

  if (tryGit(target, 'rev-parse', '--is-inside-work-tree') === 'true') {
    const dirty = tryGit(target, 'status', '--porcelain', '--', ...targets.filter((t) => existsSync(join(target, t))));
    if (dirty && !opt.force) {
      die(`uncommitted changes under SSDD-managed paths — commit or stash them first (or --force):\n${dirty}`);
    }
  } else {
    console.warn(`ssdd: ${target} is not a git work tree — the update can't be reviewed with git diff`);
  }

  console.log(`Updating SSDD v${lock.ssdd} (${lock.commit.slice(0, 7)}) → v${version} (${ref} ${commit.slice(0, 7)}) in ${target}`);
  const rows = { updated: [], added: [], merged: [], kept: [], removed: [], conflict: [], sidecar: [], skipped: [] };
  let unchanged = 0;
  for (const t of targets) {
    const abs = join(target, t);
    const baseSrc = lock.managed[t]?.src;
    const newSrc = p.managed[t];
    const base = baseSrc ? read(join(baseTree, baseSrc)) : null;
    const up = newSrc ? read(join(newTree, newSrc)) : null;
    let isLink = false;
    try { isLink = lstatSync(abs).isSymbolicLink(); } catch { /* absent */ }
    if (isLink) { rows.skipped.push(`${t} (symlink — left alone)`); continue; }
    const local = read(abs);
    const modeFrom = newSrc ? join(newTree, newSrc) : null;

    if (up === null) { // removed upstream
      if (local === null) continue;
      if (same(local, base)) { rmSync(abs); rows.removed.push(t); }
      else rows.kept.push(`${t} (removed upstream; kept — locally modified)`);
      continue;
    }
    if (base === null) { // new upstream (or new to this install)
      if (local === null) { writeFile(abs, up, modeFrom); rows.added.push(t); }
      else if (t === SP_GITIGNORE && isSuperpowersDefault(local)) { writeFile(abs, up, modeFrom); rows.added.push(`${t} (replaced Superpowers' default)`); }
      else if (!equivalent(local, up, t)) { writeFile(`${abs}.ssdd-new`, up, modeFrom); rows.sidecar.push(`${t}.ssdd-new`); }
      else unchanged++;
      continue;
    }
    if (local === null) { rows.skipped.push(`${t} (deleted locally — not restored)`); continue; }
    if (equivalent(local, up, t)) { unchanged++; continue; }
    if (same(local, base)) { writeFile(abs, up, modeFrom); rows.updated.push(t); continue; }
    if (equivalent(base, up, t)) { rows.kept.push(t); continue; }
    const m = merge3(local, base, up, t, lock.ssdd, version);
    if (m.conflicts === 0) { writeFile(abs, m.out, modeFrom); rows.merged.push(t); }
    else if (m.conflicts > 0 && m.conflicts < 128) { writeFile(abs, m.out, modeFrom); rows.conflict.push(`${t} (${m.conflicts} hunk(s))`); }
    else { writeFile(`${abs}.ssdd-new`, up, modeFrom); rows.sidecar.push(`${t}.ssdd-new (merge failed)`); }
  }

  const log = (m) => console.log(`  ${m}`);
  const notes = [];
  for (const [t, s] of Object.entries(p.seeded)) {
    if (!existsSync(join(target, t))) { seedOne(target, t, newTree, s, log); continue; }
    const oldSrc = lock.seeded?.[t]?.src;
    const before = oldSrc ? read(join(baseTree, oldSrc)) : null;
    const after = read(join(newTree, s));
    if (before && !same(before, after)) {
      const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-prefix',
        join(baseTree, oldSrc), join(newTree, s)], { encoding: 'utf8' });
      notes.push(`── template for ${t} changed (project-owned — port what you need):\n` +
        r.stdout.split('\n').slice(4).join('\n'));
    }
  }
  linkAll(target, adapters, log);
  writeLock(target, lockFrom(version, ref, commit, adapters, p, newTree));
  armHook(target, log);

  const label = { updated: 'updated', added: 'added', merged: 'merged (project edits kept)', kept: 'kept (project-only edit)',
    removed: 'removed', conflict: 'CONFLICT — resolve markers', sidecar: 'NEW VERSION BESIDE YOURS — reconcile, then delete', skipped: 'skipped' };
  console.log(`\nunchanged: ${unchanged} file(s)`);
  for (const [k, list] of Object.entries(rows)) {
    if (!list.length) continue;
    console.log(`\n${label[k]} (${list.length}):`);
    for (const x of list) console.log(`  ${x}`);
  }
  for (const n of notes) console.log(`\n${n}`);
  const log2 = changelogBetween(newTree, lock.ssdd, version);
  if (log2) console.log(`\n── CHANGELOG since v${lock.ssdd}:\n${log2}`);
  const steps = upgradeSteps(newTree, lock.ssdd, version);
  if (steps.length) console.log(`\n── Upgrade steps (manual), from the CHANGELOG:\n${steps.join('\n\n')}`);
  const open = onboarding(target);
  if (open.length) console.log(`\n${open.join('\n')}`);
  console.log(`\nlocked ${LOCK} @ v${version}. Review with: git -C '${target}' diff`);
  if (rows.conflict.length || rows.sidecar.length) process.exit(1);
}

// ── adopt: give a pre-lock install a lock, as if installed from <base> ───────
function adopt(target) {
  if (!opt.base) die('adopt needs --base <ref> — the ssdd version the existing files came from');
  if (readLock(target)) die(`${target} already has ${LOCK}; use update`);
  const adapters = parseAdapters(opt.adapters ?? pos[1]);
  const { ref, commit } = resolveRef(opt.base);
  const baseTree = exportTree(commit);
  const head = resolveRef(opt.to);
  const p = plan(exportTree(head.commit), adapters);
  const log = (m) => console.log(`  ${m}`);
  console.log(`Adopting ${target} as SSDD ${ref} (${commit.slice(0, 7)}) — adapters: ${adapters.join(',')}`);
  // Map each current target to where its source lived in <base>.
  const managed = {};
  for (const [t, s] of Object.entries(p.managed)) {
    let src = existsSync(join(baseTree, s)) ? s : null;
    for (const [now, then] of LEGACY_SOURCES) {
      if (!src && s.startsWith(now) && existsSync(join(baseTree, then + s.slice(now.length)))) src = then + s.slice(now.length);
    }
    if (src) managed[t] = { src, sha256: sha(readFileSync(join(baseTree, src))) };
  }
  // v1 layout: skills were copied into .claude/skills/; v2 keeps them in .agents/skills/.
  const legacySkills = join(target, '.claude/skills');
  if (existsSync(legacySkills)) {
    for (const e of readdirSync(legacySkills, { withFileTypes: true })) {
      const from = join(legacySkills, e.name);
      const to = join(target, '.agents/skills', e.name);
      if (e.isDirectory() && !lstatSync(from).isSymbolicLink() && !existsSync(to) &&
          Object.keys(p.managed).some((t) => t.startsWith(`.agents/skills/${e.name}/`))) {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        log(`moved     .claude/skills/${e.name} → .agents/skills/${e.name}`);
      }
    }
  }
  linkAll(target, adapters, log);
  const seeded = {};
  for (const [t, s] of Object.entries(p.seeded)) if (existsSync(join(baseTree, s))) seeded[t] = { src: s };
  writeLock(target, {
    ssdd: versionOf(commit, baseTree), ref, commit, adapters, updatedAt: new Date().toISOString(), managed, seeded,
  });
  log(`locked    ${LOCK} @ ${ref} (${Object.keys(managed).length} managed file(s) traced to that version)`);
  console.log(`\nNext: commit, then  node ${join(SRC, 'bin/ssdd.mjs')} update ${target}${opt.to ? ` --to ${opt.to}` : ''}`);
}

// ── status --skills ──────────────────────────────────────────────────────────
// Upstream skill sources recorded by /skills-audit (.ssdd/skills.json) that
// moved past their sha. Network only on request; never changes the exit code.
// skills-audit.mjs applies the same rule; keep them identical.
const remoteUrl = (repo) => (/^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}` : repo);
function remoteHead(repo) {
  try {
    const out = execFileSync('git', ['ls-remote', '--', remoteUrl(repo), 'HEAD'], {
      encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return out.split(/\s/)[0] || null;
  } catch { return null; }
}
function drift(recorded, head) {
  if (typeof recorded !== 'string' || !/^[0-9a-f]{7,40}$/.test(recorded)) return 'never pinned';
  if (head === undefined) return 'not checked';
  if (!head) return 'unreachable';
  return head.startsWith(recorded) ? 'current' : `moved ${recorded.slice(0, 7)}→${head.slice(0, 7)}`;
}
function skillsDrift(target) {
  const p = join(target, '.ssdd/skills.json');
  let sources = {};
  try {
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      const s = parsed && parsed.sources;
      if (s && typeof s === 'object' && !Array.isArray(s)) sources = s;
    }
  } catch (e) {
    console.log(`skills: unreadable .ssdd/skills.json (${e.message})`);
    return;
  }
  const entries = Object.entries(sources);
  if (!entries.length) { console.log('skills: no skill sources recorded in .ssdd/skills.json (run /skills-audit)'); return; }
  console.log(`skills (${entries.length}):`);
  for (const [repo, s] of entries) {
    const sha = s && typeof s === 'object' && typeof s.sha === 'string' ? s.sha : null;
    const state = drift(sha, sha ? remoteHead(repo) : undefined);
    console.log(`  ${state.padEnd(22)}  ${repo}`);
  }
}

// ── status: is the gate armed? ───────────────────────────────────────────────
// A broken config blocks every commit, and a dormant pre-commit hook never
// runs. Informational only.
function gateWarnings(target) {
  const loaded = loadSsddConfig(target);
  if (loaded?.error) console.log(`WARNING: ${loaded.error} — the gate blocks every commit until it's fixed`);
  const dormant = dormantHook(target);
  const orUpdate = hookSetting(target)?.state === 'armable' ? ` (or rerun: update '${target}')` : '';
  if (dormant) console.log(`WARNING: the pre-commit hook is dormant (${dormant}) — run: git -C '${target}' ${ARM_HOOK.replace(/^git /, '')}${orUpdate}`);
  const ledgerRule = ledgerIgnoreRule(target, '.superpowers/sdd/_/progress.md');
  if (ledgerRule) console.log(`WARNING: git ignores Superpowers ledgers here (${ledgerRule}) — remove that rule so .superpowers/sdd/*/progress.md is tracked`);
  const foreign = foreignHook(target);
  if (foreign) {
    console.log(`NOTE: core.hooksPath is "${foreign}", so this checkout runs that directory's pre-commit, not its own ` +
      `(a linked worktree runs the main checkout's copy). The gate still runs. To have each checkout use its own, ` +
      `run once (the setting is shared by every worktree): git -C '${target}' ${ARM_HOOK.replace(/^git /, '')}${orUpdate}`);
  }
}

// ── status ───────────────────────────────────────────────────────────────────
function status(target) {
  const lock = readLock(target);
  if (!lock) die(`no ${LOCK} in ${target}`);
  console.log(`SSDD v${lock.ssdd} (${lock.ref} ${lock.commit.slice(0, 7)}) — adapters: ${lock.adapters.join(',')}`);
  const custom = []; const missing = []; const conflicted = []; const sidecars = [];
  for (const [t, { sha256 }] of Object.entries(lock.managed)) {
    const local = read(join(target, t));
    if (local === null) { missing.push(t); continue; }
    if (/^<{7} /m.test(local.toString('utf8'))) conflicted.push(t);
    else if (sha(local) !== sha256) custom.push(t);
    if (existsSync(join(target, `${t}.ssdd-new`))) sidecars.push(`${t}.ssdd-new`);
  }
  const show = (title, list) => { if (list.length) { console.log(`${title} (${list.length}):`); list.forEach((x) => console.log(`  ${x}`)); } };
  show('customized in this project', custom);
  show('missing (deleted locally)', missing);
  show('UNRESOLVED CONFLICT MARKERS', conflicted);
  show('PENDING .ssdd-new FILES', sidecars);
  const tags = existsSync(SRC) ? tryGit(SRC, 'tag', '--list', 'v*', '--sort=-v:refname') : null;
  const latest = tags?.split('\n')[0];
  if (latest && cmpVersion(latest.replace(/^v/, ''), lock.ssdd) > 0) {
    console.log(`update available: ${latest} — node ${join(SRC, 'bin/ssdd.mjs')} update ${target}`);
  } else if (latest) {
    console.log(`up to date with the newest release in ${SRC} (${latest})`);
  }
  gateWarnings(target);
  for (const l of onboarding(target)) console.log(l);
  if (opt.skills) skillsDrift(target);
  if (conflicted.length || sidecars.length) process.exit(1);
}

// ── main ─────────────────────────────────────────────────────────────────────
const target = pos[0] ? resolve(pos[0]) : null;
if (!cmd || !target) usage();
if (!existsSync(target)) die(`no such directory: ${target}`);
if (!existsSync(join(SRC, '.git'))) die(`${SRC} is not an ssdd git checkout`);
const run = { install, update, adopt, status }[cmd];
if (!run) usage();
run(target);
