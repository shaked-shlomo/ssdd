// SSDD config loader shared by the review gate and the git guard.
//
// A commit is judged by the config it starts from (HEAD's .ssdd/config.json)
// AND the config it leaves behind (the index's), whichever is stricter — so a
// commit can't loosen its own review by editing the table it is judged by,
// and an unstaged edit can't switch a guard off. The working-tree file is read
// only when neither exists (the setup commit: no committed table to loosen).
// `git show :path` honours GIT_INDEX_FILE, so a `commit -a` pre-commit hook
// reads the index git is actually committing.
//
// Absent everywhere → null (not an SSDD repo). A broken staged (or fallback
// working-tree) config → `error` set: callers fail closed. A broken HEAD
// config → `warnings`: the commit that fixes it must be able to land.
//
// The merged config keeps the shape callers already read:
//   routing                 both lists; each config's reviewGate.exclude is
//                           baked into its own routes' exclude
//   reviewGate.stamping     "hooks" if either says so
//   reviewGate.reviewerModelSets  every non-empty reviewerModels list; a model
//                           must satisfy each
//   reviewGate.maxRoutedFiles     the index's (it only warns)
//   gitGuard.block*         off only when every present config turns it off
//   gitGuard.extraRules     both lists
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PATH = '.ssdd/config.json';
const GUARD_TOGGLES = ['blockBulkAdd', 'blockNoVerify', 'blockAmend', 'blockHooksPath'];

const gitText = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });

// { text } | null (absent). `git show` fails for "no HEAD yet", "not in that
// tree" and "not in the index" alike — all mean absent.
function blob(repo, spec) {
  try { return { text: gitText(repo, 'show', `${spec}:${PATH}`) }; } catch { return null; }
}
function file(root) {
  try { return { text: readFileSync(join(root, PATH), 'utf8') }; } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null;
    return { error: e.message };
  }
}
function parse(src, label) {
  if (!src) return null;
  if (src.error) return { label, error: src.error };
  try {
    const cfg = JSON.parse(src.text);
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { label, error: 'not a JSON object' };
    return { label, cfg };
  } catch (e) {
    return { label, error: e.message };
  }
}

function merge(cfgs) {
  const routing = [];
  const modelSets = [];
  for (const c of cfgs) {
    const global = Array.isArray(c.reviewGate?.exclude) ? c.reviewGate.exclude : [];
    for (const r of Array.isArray(c.routing) ? c.routing : []) {
      routing.push({ ...r, exclude: [...global, ...(Array.isArray(r?.exclude) ? r.exclude : [])] });
    }
    const m = c.reviewGate?.reviewerModels;
    if (Array.isArray(m) && m.length) modelSets.push(m);
  }
  const last = cfgs[cfgs.length - 1] ?? {};
  const gitGuard = { extraRules: cfgs.flatMap((c) => (Array.isArray(c.gitGuard?.extraRules) ? c.gitGuard.extraRules : [])) };
  for (const k of GUARD_TOGGLES) gitGuard[k] = !(cfgs.length && cfgs.every((c) => c.gitGuard?.[k] === false));
  return {
    ...last,
    routing,
    reviewGate: {
      ...(last.reviewGate ?? {}),
      exclude: [],
      stamping: cfgs.some((c) => c.reviewGate?.stamping === 'hooks') ? 'hooks' : 'manual',
      reviewerModels: modelSets[modelSets.length - 1],
      reviewerModelSets: modelSets,
    },
    gitGuard,
  };
}

// → null (no repo, or no config anywhere) | { root, cfg, error, warnings, sources }
export function loadSsddConfig(repo) {
  let root;
  try { root = gitText(repo, 'rev-parse', '--show-toplevel').trim(); } catch { return null; }
  const head = parse(blob(root, 'HEAD'), 'HEAD');
  const index = parse(blob(root, ''), 'staged');
  const tree = head || index ? null : parse(file(root), 'working tree');
  const found = [head, index, tree].filter(Boolean);
  if (!found.length) return null;

  const warnings = [];
  let error = null;
  if (head?.error) warnings.push(`HEAD's ${PATH} is not valid JSON (${head.error}) — judged by the staged one alone`);
  for (const s of [index, tree]) if (s?.error) error = `${PATH} (${s.label}) is not valid JSON: ${s.error}`;
  const good = found.filter((s) => s.cfg);
  return { root, cfg: { root, ...merge(good.map((s) => s.cfg)) }, error, warnings, sources: found.map((s) => s.label) };
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
