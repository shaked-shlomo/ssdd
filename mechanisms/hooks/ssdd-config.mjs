// SSDD config loader shared by the review gate and the git guard.
//
// Reads the working-tree .ssdd/config.json, nothing else: what is on disk when
// the hook runs is the config in force, staged or not. (The hooks keep a
// cooperating agent on the process; they are not a sandbox, so a commit that
// edits its own routing table is not defended against.)
//
// Absent → null (not an SSDD repo). Unreadable, not valid JSON, not a JSON
// object, or a section of the wrong type → `error` set: callers fail closed.
// A wrong-type section is dropped and the rest still builds, so git-guard
// (which reads cfg, not error) keeps the rules that are well-formed.
//
// The returned cfg keeps the shape callers read:
//   routing                 each route with reviewGate.exclude baked into its
//                           own exclude
//   reviewGate.stamping     "hooks" or "manual" (default)
//   reviewGate.reviewerModelSets  [reviewerModels] when it is a non-empty list
//   gitGuard.block*         off only when the config says false
//   gitGuard.extraRules     as given
//   paths.plans / .specs / .ledgers  repo-relative; defaults .ssdd/plans,
//                           .ssdd/specs, .ssdd/ledgers
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PATH = '.ssdd/config.json';
const GUARD_TOGGLES = ['blockBulkAdd', 'blockNoVerify', 'blockAmend', 'blockHooksPath'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A section that is present must have its type. A string spread as an object
// would turn into index-keyed characters.
const SECTIONS = [
  ['reviewGate', isObject, 'an object'],
  ['gitGuard', isObject, 'an object'],
  ['routing', (v) => Array.isArray(v) && v.every(isObject), 'a list of objects'],
  ['paths', isObject, 'an object'],
];

// Where plans, specs and ledgers live, repo-relative. A key that isn't a
// non-empty string keeps its default.
export const DEFAULT_PATHS = Object.freeze({ plans: '.ssdd/plans', specs: '.ssdd/specs', ledgers: '.ssdd/ledgers' });
function buildPaths(paths) {
  const out = { ...DEFAULT_PATHS };
  for (const k of Object.keys(DEFAULT_PATHS)) {
    const v = typeof paths?.[k] === 'string' ? paths[k].trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '') : '';
    if (v) out[k] = v;
  }
  return out;
}
const broken = (root, error) => ({ root, cfg: { root }, error });

const gitText = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });

function build(root, config) {
  const global = Array.isArray(config.reviewGate?.exclude) ? config.reviewGate.exclude : [];
  const routing = (Array.isArray(config.routing) ? config.routing : [])
    .map((r) => ({ ...r, exclude: [...global, ...(Array.isArray(r?.exclude) ? r.exclude : [])] }));
  const models = config.reviewGate?.reviewerModels;
  const gitGuard = { extraRules: Array.isArray(config.gitGuard?.extraRules) ? config.gitGuard.extraRules : [] };
  for (const k of GUARD_TOGGLES) gitGuard[k] = config.gitGuard?.[k] !== false;
  // root goes last, so a "root" key in the file can't move the repo root.
  return {
    ...config,
    routing,
    reviewGate: {
      ...(config.reviewGate ?? {}),
      exclude: [],
      stamping: config.reviewGate?.stamping === 'hooks' ? 'hooks' : 'manual',
      reviewerModelSets: Array.isArray(models) && models.length ? [models] : [],
    },
    gitGuard: { ...(config.gitGuard ?? {}), ...gitGuard },
    paths: buildPaths(config.paths),
    root,
  };
}

// → null (no repo, or no config) | { root, cfg, error? }
export function loadSsddConfig(repo) {
  let root;
  try { root = gitText(repo, 'rev-parse', '--show-toplevel').trim(); } catch { return null; }
  let text;
  try { text = readFileSync(join(root, PATH), 'utf8'); } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null;
    return broken(root, `${PATH} can't be read: ${e.message}`);
  }
  let config;
  try {
    config = JSON.parse(text);
    if (!isObject(config)) throw new Error('not a JSON object');
  } catch (e) {
    return broken(root, `${PATH} is not valid JSON: ${e.message}`);
  }
  const bad = SECTIONS.filter(([key, ok]) => key in config && !ok(config[key]));
  for (const [key] of bad) delete config[key];
  const cfg = build(root, config);
  if (!bad.length) return { root, cfg };
  return { root, cfg, error: `${PATH}: ${bad.map(([key, , type]) => `"${key}" must be ${type}`).join('; ')}` };
}

// The portable pre-commit layer runs only while core.hooksPath points at a
// directory with a pre-commit (git then ignores .git/hooks entirely).
// → null when the repo has no .githooks/pre-commit, else
//   { value, own: it resolves to this checkout's .githooks,
//     runs: the directory it resolves to has a pre-commit }
function hooksPath(root) {
  if (!existsSync(join(root, '.githooks', 'pre-commit'))) return null;
  let value = '';
  try { value = gitText(root, 'config', '--get', 'core.hooksPath').trim(); } catch { /* unset */ }
  if (!value) return { value, own: false, runs: false };
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const abs = resolve(root, value.replace(/^~(?=\/|$)/, homedir()));
  const own = real(abs) === real(join(root, '.githooks'));
  return { value, own, runs: own || existsSync(join(abs, 'pre-commit')) };
}

// Why the pre-commit layer is dormant ("core.hooksPath is unset"), or '' when
// it runs or the repo has no .githooks/pre-commit. git-guard denies writes to
// core.hooksPath, so the fix is the user's to run.
export function dormantHook(root) {
  const h = hooksPath(root);
  if (!h || h.runs) return '';
  return h.value ? `core.hooksPath is "${h.value}"` : 'core.hooksPath is unset';
}

// core.hooksPath when it resolves to another directory's pre-commit, else ''.
// The usual cause: an absolute path to the main checkout's .githooks, which
// every linked worktree then runs instead of its own. That shim still runs
// this checkout's .ssdd/hooks (it resolves the repo root itself), so the gate
// is on; only a change to this branch's .githooks/pre-commit doesn't apply.
export function foreignHook(root) {
  const h = hooksPath(root);
  return h && h.runs && !h.own ? h.value : '';
}
export const ARM_HOOK = 'git config core.hooksPath .githooks';

// When /skills-audit last ran here: `audited` in .ssdd/skills.json, which the
// skill sets on every run (even one that matched nothing). Null when it never
// ran, or the ledger is missing or unreadable.
export function skillsAudited(root) {
  try {
    const v = JSON.parse(readFileSync(join(root, '.ssdd', 'skills.json'), 'utf8'))?.audited;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch { return null; }
}
