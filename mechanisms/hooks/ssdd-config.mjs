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
// (which reads cfg, not error) keeps the rules that are well-formed. Routing
// is checked to the regex: each route needs a reviewer name and `paths` (and
// any `exclude`, and reviewGate.exclude) as lists of sources that compile, or
// the routing (or that exclude) is dropped with an error. A hook that built
// the regexes itself could throw, and a harness reads a throw as "allow".
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
//   preCommit.blockUntracked  true only when the config says true: the
//                           pre-commit then refuses while an untracked file
//                           exists (otherwise it lists them as a warning)
//   productionGuard         { writePath (default "migrations on merge to
//                           main"), extraRules (default []), ...one object
//                           per pack, which the pack validates }
//   modelReview.generation  the Claude model generation the instructions
//                           were last reviewed for (default 5); the session
//                           view says when a session runs a newer one
//
// A section-scoped error is also in `sectionErrors[section]`, so a hook that
// reads one section (prod-guard) can tell its own error from another's. A
// file that can't be read or parsed has `error` alone.
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
  ['preCommit', isObject, 'an object'],
  ['productionGuard', isObject, 'an object'],
  ['modelReview', isObject, 'an object'],
];
export const DEFAULT_WRITE_PATH = 'migrations on merge to main';
// SSDD's own text was last reviewed for the Claude 5 generation (v3 Part 5).
export const DEFAULT_REVIEWED_GENERATION = 5;

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

// '' when every entry is a string that compiles as a regex, else why not.
function regexListError(v) {
  if (!Array.isArray(v) || !v.every((p) => typeof p === 'string')) return 'must be a list of regex sources';
  for (const p of v) { try { new RegExp(p); } catch { return `"${p}" isn't a valid regex`; } }
  return '';
}
// '' when productionGuard is well-formed, else the first problem. A pack's
// own section (any other key) only has to be an object here; the pack checks
// the rest.
function productionGuardError(pg) {
  if ('writePath' in pg && typeof pg.writePath !== 'string') return '"writePath" must be a string';
  if ('extraRules' in pg) {
    if (!Array.isArray(pg.extraRules)) return '"extraRules" must be a list';
    for (const [i, r] of pg.extraRules.entries()) {
      if (!isObject(r)) return `extraRules[${i}] must be an object`;
      if (typeof r.match !== 'string') return `extraRules[${i}]: "match" must be a regex source`;
      try { new RegExp(r.match); } catch { return `extraRules[${i}]: "${r.match}" isn't a valid regex`; }
      if (r.decision !== 'ask' && r.decision !== 'deny') return `extraRules[${i}]: "decision" must be "ask" or "deny"`;
      if ('reason' in r && typeof r.reason !== 'string') return `extraRules[${i}]: "reason" must be a string`;
    }
  }
  for (const [k, v] of Object.entries(pg)) {
    if (['writePath', 'extraRules', '$comment'].includes(k)) continue;
    if (!isObject(v)) return `"${k}" must be an object (a pack's options)`;
  }
  return '';
}

function routingError(routing) {
  for (const [i, r] of routing.entries()) {
    if (typeof r.reviewer !== 'string' || !r.reviewer.trim()) return `routing[${i}]: "reviewer" must be a name`;
    for (const key of ['paths', 'exclude']) {
      if (key === 'exclude' && r.exclude === undefined) continue;
      const why = regexListError(r[key]);
      if (why) return `routing[${i}]: ${why.startsWith('must') ? `"${key}" ${why}` : why}`;
    }
  }
  return '';
}

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
    preCommit: { ...(config.preCommit ?? {}), blockUntracked: config.preCommit?.blockUntracked === true },
    productionGuard: {
      ...(config.productionGuard ?? {}),
      writePath: typeof config.productionGuard?.writePath === 'string' && config.productionGuard.writePath.trim()
        ? config.productionGuard.writePath.trim() : DEFAULT_WRITE_PATH,
      extraRules: Array.isArray(config.productionGuard?.extraRules) ? config.productionGuard.extraRules : [],
    },
    modelReview: { ...(config.modelReview ?? {}), generation: config.modelReview?.generation ?? DEFAULT_REVIEWED_GENERATION },
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
  const sectionErrors = {};
  const fail = (section, why) => { sectionErrors[section] ??= why; };
  for (const [key, ok, type] of SECTIONS) {
    if (key in config && !ok(config[key])) { fail(key, `"${key}" must be ${type}`); delete config[key]; }
  }
  const routing = Array.isArray(config.routing) ? routingError(config.routing) : '';
  if (routing) { fail('routing', routing); delete config.routing; }
  if (config.reviewGate && 'exclude' in config.reviewGate) {
    const why = regexListError(config.reviewGate.exclude);
    if (why) { fail('reviewGate', `reviewGate.exclude: ${why}`); delete config.reviewGate.exclude; }
  }
  const pg = isObject(config.productionGuard) ? productionGuardError(config.productionGuard) : '';
  if (pg) { fail('productionGuard', `productionGuard: ${pg}`); delete config.productionGuard; }
  const gen = config.modelReview?.generation;
  if (gen !== undefined && !(Number.isInteger(gen) && gen > 0)) {
    fail('modelReview', 'modelReview.generation must be a positive whole number'); delete config.modelReview;
  }
  const cfg = build(root, config);
  const errors = Object.values(sectionErrors);
  if (!errors.length) return { root, cfg };
  return { root, cfg, error: `${PATH}: ${errors.join('; ')}`, sectionErrors };
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
