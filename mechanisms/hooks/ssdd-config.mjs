// SSDD config loader shared by the review gate and the git guard.
//
// Reads the working-tree .ssdd/config.json, nothing else: what is on disk when
// the hook runs is the config in force, staged or not. (The hooks keep a
// cooperating agent on the process; they are not a sandbox, so a commit that
// edits its own routing table is not defended against.)
//
// Absent → null (not an SSDD repo). Unreadable, not valid JSON, or not a JSON
// object → `error` set: callers fail closed.
//
// The returned cfg keeps the shape callers read:
//   routing                 each route with reviewGate.exclude baked into its
//                           own exclude
//   reviewGate.stamping     "hooks" or "manual" (default)
//   reviewGate.reviewerModelSets  [reviewerModels] when it is a non-empty list
//   gitGuard.block*         off only when the config says false
//   gitGuard.extraRules     as given
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PATH = '.ssdd/config.json';
const GUARD_TOGGLES = ['blockBulkAdd', 'blockNoVerify', 'blockAmend', 'blockHooksPath'];

const gitText = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });

function build(root, config) {
  const global = Array.isArray(config.reviewGate?.exclude) ? config.reviewGate.exclude : [];
  const routing = (Array.isArray(config.routing) ? config.routing : [])
    .map((r) => ({ ...r, exclude: [...global, ...(Array.isArray(r?.exclude) ? r.exclude : [])] }));
  const models = config.reviewGate?.reviewerModels;
  const gitGuard = { extraRules: Array.isArray(config.gitGuard?.extraRules) ? config.gitGuard.extraRules : [] };
  for (const k of GUARD_TOGGLES) gitGuard[k] = config.gitGuard?.[k] !== false;
  return {
    root,
    ...config,
    routing,
    reviewGate: {
      ...(config.reviewGate ?? {}),
      exclude: [],
      stamping: config.reviewGate?.stamping === 'hooks' ? 'hooks' : 'manual',
      reviewerModelSets: Array.isArray(models) && models.length ? [models] : [],
    },
    gitGuard: { ...(config.gitGuard ?? {}), ...gitGuard },
  };
}

// → null (no repo, or no config) | { root, cfg, error? }
export function loadSsddConfig(repo) {
  let root;
  try { root = gitText(repo, 'rev-parse', '--show-toplevel').trim(); } catch { return null; }
  let text;
  try { text = readFileSync(join(root, PATH), 'utf8'); } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null;
    return { root, cfg: { root }, error: `${PATH} can't be read: ${e.message}` };
  }
  let config;
  try {
    config = JSON.parse(text);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('not a JSON object');
  } catch (e) {
    return { root, cfg: { root }, error: `${PATH} is not valid JSON: ${e.message}` };
  }
  return { root, cfg: build(root, config) };
}

// The portable pre-commit layer runs only while core.hooksPath points at the
// repo's .githooks (git then ignores .git/hooks entirely). Returns why it is
// dormant ("core.hooksPath is unset"), or '' when it is armed or the repo has
// no .githooks/pre-commit. git-guard denies writes to core.hooksPath, so the
// fix is the user's to run.
export function dormantHook(root) {
  if (!existsSync(join(root, '.githooks', 'pre-commit'))) return '';
  let value = '';
  try { value = gitText(root, 'config', '--get', 'core.hooksPath').trim(); } catch { /* unset */ }
  if (!value) return 'core.hooksPath is unset';
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const abs = resolve(root, value.replace(/^~(?=\/|$)/, homedir()));
  return real(abs) === real(join(root, '.githooks')) ? '' : `core.hooksPath is "${value}"`;
}
export const ARM_HOOK = 'git config core.hooksPath .githooks';
