#!/usr/bin/env node
// SSDD work state: where each plan stands, read from plans, ledgers and git.
//
//   node .ssdd/hooks/work-state.mjs                    the full view
//   node .ssdd/hooks/work-state.mjs --session-start    capped, for a session-start hook
//   node .ssdd/hooks/work-state.mjs --session-start=cursor   the same, as Cursor JSON
//
// Sources: the default branch (origin/HEAD as last fetched, else main, else
// master, else the current branch), every other local branch (git objects),
// and every worktree (its files on disk, uncommitted edits included). Never
// fetches, never edits a plan. No .ssdd/config.json → prints nothing.
//
// A plan on the default branch takes its Status from there; other copies only
// say who is working on it. IN PROGRESS on the default branch with nothing
// working on it is flagged as likely stale (SPEC.md → v3 → Part 1, Clarify 6).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_PATHS, loadSsddConfig } from './ssdd-config.mjs';
import { OPEN_WORDS, countPlanTasks, parsePlan, parseProgress, parseSsddLedger } from './plan-parse.mjs';

const SP_DIR = '.superpowers/sdd';
const MAX_BUFFER = 256 * 1024 * 1024;

function git(cwd, args, input) {
  return spawnSync('git', ['-C', cwd, ...args], {
    encoding: input === undefined ? 'utf8' : 'buffer', input, maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
}
const gitOut = (cwd, ...args) => { const r = git(cwd, args); return r.status === 0 ? r.stdout : null; };
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const isPlanName = (name) => /^\d/.test(name) && name.endsWith('.md');
const planNum = (path) => /^(\d+[^-]*)/.exec(basename(path))?.[1] ?? basename(path, '.md');
const planSlug = (path) => basename(path, '.md').replace(/^\d+[^-]*-?/, '') || basename(path, '.md');

// ── git refs ─────────────────────────────────────────────────────────────────
const refExists = (root, ref) => git(root, ['rev-parse', '-q', '--verify', `${ref}^{commit}`]).status === 0;
const isAncestor = (root, a, b) => git(root, ['merge-base', '--is-ancestor', a, b]).status === 0;

function defaultBranch(root) {
  const remote = (gitOut(root, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD') ?? '').trim();
  let name = remote ? remote.replace(/^refs\/remotes\/origin\//, '') : '';
  if (!name) name = ['main', 'master'].find((b) => refExists(root, `refs/heads/${b}`)) ?? '';
  if (!name) name = (gitOut(root, 'symbolic-ref', '-q', '--short', 'HEAD') ?? '').trim() || 'main';
  const local = refExists(root, `refs/heads/${name}`) ? `refs/heads/${name}` : null;
  const rem = remote && refExists(root, remote) ? remote : null;
  let read = local ?? rem;
  if (local && rem) read = isAncestor(root, local, rem) ? rem : local;
  return { name, local, remote: rem, read, not: [local, rem].filter(Boolean) };
}

// `git worktree list --porcelain` → [{ dir, branch: 'refs/heads/x' | null }],
// skipping worktrees whose directory is gone.
function worktrees(root) {
  const out = [];
  let cur = null;
  for (const line of (gitOut(root, 'worktree', 'list', '--porcelain') ?? '').split('\n')) {
    if (line.startsWith('worktree ')) { cur = { dir: line.slice(9), branch: null }; out.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7);
  }
  return out.filter((w) => existsSync(w.dir));
}

// ── sources: one place a copy of the repo's files can be read ────────────────
// { label, ref?, dir?, branch?, files: Map<path, text> } — files holds plans,
// ledgers and Superpowers progress files only.
function wanted(paths, rel) {
  if (posix.dirname(rel) === paths.plans) return isPlanName(posix.basename(rel));
  if (posix.dirname(rel) === paths.ledgers) return rel.endsWith('-ledger.md');
  return /^\.superpowers\/sdd\/[^/]+\/progress\.md$/.test(rel);
}

function readBlobs(root, shas) {
  const out = new Map();
  if (!shas.length) return out;
  const r = git(root, ['cat-file', '--batch'], Buffer.from(shas.join('\n') + '\n'));
  if (r.status !== 0) return out;
  const buf = r.stdout;
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(10, i);
    if (nl < 0) break;
    const [sha, type, size] = buf.slice(i, nl).toString('utf8').split(' ');
    i = nl + 1;
    if (type === 'missing' || size === undefined) continue;
    const n = Number(size);
    out.set(sha, buf.slice(i, i + n).toString('utf8'));
    i += n + 1;
  }
  return out;
}

function refFiles(root, ref, paths) {
  const r = gitOut(root, 'ls-tree', '-r', '-z', '--full-tree', ref, '--', paths.plans, paths.ledgers, SP_DIR);
  const entries = [];
  for (const rec of (r ?? '').split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [, type, sha] = rec.slice(0, tab).split(' ');
    const path = rec.slice(tab + 1);
    if (type === 'blob' && wanted(paths, path)) entries.push({ path, sha });
  }
  return entries;
}

function diskFiles(dir, paths) {
  const files = new Map();
  const readDir = (rel, keep) => {
    let names = [];
    try { names = readdirSync(join(dir, rel)); } catch { return; }
    for (const n of names) {
      const p = `${rel}/${n}`;
      if (!keep(p)) continue;
      try { files.set(p, readFileSync(join(dir, p), 'utf8')); } catch { /* unreadable: skip */ }
    }
  };
  readDir(paths.plans, (p) => wanted(paths, p));
  readDir(paths.ledgers, (p) => wanted(paths, p));
  let sp = [];
  try { sp = readdirSync(join(dir, SP_DIR)); } catch { /* none */ }
  for (const d of sp) {
    const p = `${SP_DIR}/${d}/progress.md`;
    try { files.set(p, readFileSync(join(dir, p), 'utf8')); } catch { /* none */ }
  }
  return files;
}

function sources(root, paths, def) {
  const here = real(root);
  const wts = worktrees(root).sort((a, b) => (real(a.dir) === here ? -1 : real(b.dir) === here ? 1 : 0));
  const inWorktree = new Set(wts.map((w) => w.branch).filter(Boolean));
  const branches = (gitOut(root, 'for-each-ref', '--format=%(refname)', 'refs/heads') ?? '')
    .split('\n').filter(Boolean).filter((b) => b !== def.local && !inWorktree.has(b));
  const refs = [...new Set([def.read, ...def.not, ...wts.map((w) => w.branch), ...branches].filter(Boolean))];
  const listed = new Map(refs.map((ref) => [ref, refFiles(root, ref, paths)]));
  const blobs = readBlobs(root, [...new Set([...listed.values()].flat().map((e) => e.sha))]);
  const files = (ref) => new Map((listed.get(ref) ?? []).map((e) => [e.path, blobs.get(e.sha) ?? '']));
  const out = { def: def.read ? { label: def.name, ref: def.read, files: files(def.read) } : null, others: [] };
  const short = (ref) => ref.replace(/^refs\/heads\//, '');
  for (const w of wts) {
    const isHere = real(w.dir) === here;
    const label = isHere ? 'this checkout' : `worktree ${basename(w.dir)}${w.branch ? '' : ' (detached)'}`;
    out.others.push({ label, dir: w.dir, branch: w.branch, files: diskFiles(w.dir, paths), committed: w.branch ? files(w.branch) : new Map() });
  }
  for (const b of branches) out.others.push({ label: `branch ${short(b)}`, ref: b, branch: b, files: files(b) });
  return out;
}

// ── ledgers ──────────────────────────────────────────────────────────────────
const normPlanRef = (s, dir) => {
  let p = String(s ?? '').trim().replace(/^\.\//, '');
  if (dir && p.startsWith('/')) { const d = real(dir); const r = real(p); if (r.startsWith(d + '/')) p = r.slice(d.length + 1); }
  return p;
};

// Which SSDD plan a Superpowers ledger in `src` belongs to: the plan its first
// line names, or the SSDD plan that the file it names mentions by path.
// → { plan, info, named (that file's text) } | null.
function ledgerPlan(root, src, path, allPlans) {
  const info = parseProgress(src.files.get(path));
  const named = normPlanRef(info.plan, src.dir);
  if (!named) return null;
  if (allPlans.has(named)) return { plan: named, info, named: src.files.get(named) ?? '' };
  const text = namedFile(root, src, named) ?? '';
  const plan = [...allPlans].find((p) => text.includes(p) || text.includes(basename(p)));
  return plan ? { plan, info, named: text } : null;
}
function superpowersLedger(root, src, plan, allPlans) {
  for (const path of src.files.keys()) {
    if (!path.startsWith(`${SP_DIR}/`)) continue;
    const link = ledgerPlan(root, src, path, allPlans);
    if (link?.plan === plan) return { path, ...link };
  }
  return null;
}
function namedFile(root, src, path) {
  if (src.dir) { try { return readFileSync(join(src.dir, path), 'utf8'); } catch { return null; } }
  return src.ref ? gitOut(root, 'show', `${src.ref}:${path}`) : null;
}
function ledgerPaths(paths, plan) {
  const slug = basename(plan, '.md');
  return [`${paths.ledgers}/${slug}-ledger.md`, `${SP_DIR}/${slug}/progress.md`];
}

function progressText(root, src, plan, paths, allPlans) {
  const sp = superpowersLedger(root, src, plan, allPlans);
  if (sp) {
    const { done, inReview } = sp.info;
    const total = countPlanTasks(sp.named);
    const parts = [];
    if (done > 0) parts.push(`${done === 1 ? 'Task 1' : `Tasks 1–${done}`}${total ? ` of ${total}` : ''} done`);
    if (inReview) parts.push(`Task ${inReview} in review`);
    return parts.join(' · ');
  }
  const ssdd = src.files.get(ledgerPaths(paths, plan)[0]);
  if (!ssdd) return '';
  const l = parseSsddLedger(ssdd);
  return l.next ? `next: ${l.next}` : (l.total && l.done === l.total ? 'all tasks done' : '');
}

// "<source>:<line>: <pattern>" when git ignores relPath in dir, else null.
export function ledgerIgnoreRule(dir, relPath) {
  if (git(dir, ['check-ignore', '-q', '--no-index', relPath]).status !== 0) return null;
  const m = /^(.*?):(\d+):(.*?)\t/.exec(gitOut(dir, 'check-ignore', '-v', '--no-index', relPath) ?? '');
  // A linked worktree reports the shared .git/info/exclude by its absolute path.
  return m ? `${m[1].replace(/^.*\/(?=\.git\/)/, '')}:${m[2]}: ${m[3]}` : 'a git ignore rule';
}

// The leading upper-case words of an unknown Status ("IN REVIEW (PR #9)" →
// "IN REVIEW"), else its first word.
function statusToken(raw) {
  if (!raw) return 'NO STATUS';
  const m = /^[A-Z][A-Z0-9]*(?: [A-Z][A-Z0-9]*)*/.exec(raw);
  return m ? m[0] : (raw.split(/\s/)[0].toUpperCase() || 'NO STATUS');
}

// ── the state ────────────────────────────────────────────────────────────────
function working(root, def, notRefs, src, plan, paths) {
  const watched = [plan, ...ledgerPaths(paths, plan)];
  const differs = (a, b) => watched.some((p) => (a.get(p) ?? null) !== (b.get(p) ?? null));
  if (!differs(src.files, def.files)) return false;
  if (src.dir && differs(src.files, src.committed)) return true;
  if (!src.branch) return false;
  const r = gitOut(root, 'log', '--format=%h', '-1', src.branch, '--not', ...notRefs, '--', ...watched);
  return Boolean(r && r.trim());
}

export function collect(repo) {
  const loaded = loadSsddConfig(repo);
  if (!loaded) return null;
  const { root } = loaded;
  const paths = loaded.cfg.paths ?? DEFAULT_PATHS;
  const defInfo = defaultBranch(root);
  const { def, others } = sources(root, paths, defInfo);
  const all = [def, ...others].filter(Boolean);
  const allPlans = new Set(all.flatMap((s) => [...s.files.keys()].filter((p) => posix.dirname(p) === paths.plans)));
  const rows = []; const unknown = []; const warnings = loaded.error ? [`! ${loaded.error}`] : [];

  for (const plan of [...allPlans].sort()) {
    const onDefault = def?.files.has(plan);
    const home = onDefault ? def : others.find((s) => s.files.has(plan));
    const parsed = parsePlan(home.files.get(plan));
    const word = parsed.status.word;
    if (!word) { unknown.push(statusToken(parsed.status.raw)); continue; }
    if (!OPEN_WORDS.has(word)) continue;
    let shown = home; let flagged = false;
    if (onDefault && word === 'IN PROGRESS') {
      const busy = others.find((s) => s.files.has(plan) || ledgerPaths(paths, plan).some((p) => s.files.has(p)) ? working(root, def, defInfo.not, s, plan, paths) : false);
      if (busy) shown = busy; else flagged = true;
    }
    const p = shown.files.has(plan) ? parsePlan(shown.files.get(plan)) : parsed;
    const entries = p.criteria.filter((id) => p.entries.has(id));
    let since = '';
    if (word === 'DRAFT' && home.ref) since = (gitOut(root, 'log', '-1', '--format=%cs', home.ref, '--', plan) ?? '').trim();
    rows.push({
      path: plan, num: planNum(plan), slug: planSlug(plan), where: shown.label, status: word, statusRaw: parsed.status.raw,
      onDefault: Boolean(onDefault), flagged, since, progress: progressText(root, shown, plan, paths, allPlans),
      verified: entries.filter((id) => !p.entries.get(id).deferred).length, total: p.criteria.length,
      deferred: entries.filter((id) => p.entries.get(id).deferred).length, openQuestions: p.openQuestions,
    });
  }

  // Ledgers: unlinked ones, and ones git ignores in a worktree.
  const unlinked = new Set(); const ignored = new Set();
  for (const s of all) {
    for (const path of s.files.keys()) {
      if (!path.startsWith(`${SP_DIR}/`)) continue;
      const link = ledgerPlan(root, s, path, allPlans);
      if (!link) unlinked.add(path.split('/')[2]);
      const rule = s.dir ? ledgerIgnoreRule(s.dir, path) : null;
      if (rule) ignored.add(`! ledger for ${link ? planNum(link.plan) : path.split('/')[2]} is ignored by git (${rule})`);
    }
  }
  for (const d of [...unlinked].sort()) warnings.push(`! ledger ${d} isn't linked to an SSDD plan`);
  warnings.push(...ignored);

  // Two plans with one number, anywhere.
  const byNum = new Map();
  for (const plan of allPlans) {
    const n = planNum(plan);
    if (!byNum.has(n)) byNum.set(n, []);
    byNum.get(n).push(plan);
  }
  for (const [n, list] of [...byNum].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    if (list.length < 2) continue;
    const where = (plan) => all.find((s) => s.files.has(plan)).label;
    warnings.push(`! plans numbered ${n}: ${list.sort().map((p) => `${basename(p)} (${where(p)})`).join(', ')}`);
  }
  return { root, defaultRef: defInfo.name, plans: rows, unknown, warnings };
}

// ── rendering ────────────────────────────────────────────────────────────────
const ORDER = { 'IN PROGRESS': 0, BUILT: 1, DRAFT: 2 };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function rowLine(r, defaultRef) {
  const head = `${r.num} ${r.slug}`;
  if (r.flagged) return `${head}  IN PROGRESS on ${defaultRef}, no branch working on it → SHIPPED, BUILT, or still going?`;
  const details = [];
  if (r.progress) details.push(r.progress);
  if (r.total) details.push(`AC ${r.verified}/${r.total} verified`);
  if (r.deferred) details.push(`${r.deferred} deferred`);
  if (r.openQuestions) details.push(plural(r.openQuestions, 'open question'));
  let status = r.status;
  if (r.status === 'DRAFT' && r.since) status = `DRAFT since ${r.since}`;
  else if (!(r.onDefault && r.where === defaultRef)) status = `${r.status} (${r.where})`;
  return [`${head}  ${status}`, ...details].join(' · ');
}

export function render(state, { cap = null } = {}) {
  if (!state) return '';
  const rows = [...state.plans].sort((a, b) => (ORDER[a.status] - ORDER[b.status]) ||
    a.num.localeCompare(b.num, undefined, { numeric: true }));
  const header = `SSDD · ${rows.length ? plural(rows.length, 'open plan') : 'no open plans'}`;
  const body = rows.map((r) => `  ${rowLine(r, state.defaultRef)}`);
  if (state.unknown.length) {
    const counts = new Map();
    for (const w of state.unknown) counts.set(w, (counts.get(w) ?? 0) + 1);
    const words = [...counts].sort((a, b) => b[1] - a[1]).map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)).join(', ');
    body.push(`  ${plural(state.unknown.length, 'plan')} with a status outside the six (${words})`);
  }
  body.push(...state.warnings.map((w) => `  ${w}`));
  let lines = [header, ...body];
  if (cap) {
    const size = (ls) => Buffer.byteLength(ls.join('\n') + '\n');
    if (lines.length > cap.lines || size(lines) > cap.bytes) {
      const footer = (n) => `+${n} more: node .ssdd/hooks/work-state.mjs`;
      let keep = body.slice(0, cap.lines - 2);
      while (keep.length && size([header, ...keep, footer(body.length - keep.length)]) > cap.bytes) keep = keep.slice(0, -1);
      lines = [header, ...keep, footer(body.length - keep.length)];
    }
  }
  return lines.join('\n') + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────────────────
export const SESSION_CAP = Object.freeze({ lines: 12, bytes: 1536 });

// A session-start hook must never fail or flood the session: capped output,
// exit 0 whatever happens, and no stdin read (the payload isn't needed).
function sessionStart(repo, cursor) {
  let text;
  try { text = render(collect(repo), { cap: SESSION_CAP }); } catch (e) {
    text = `SSDD · work state unavailable (${String(e?.message ?? e).split('\n')[0].slice(0, 120)})\n`;
  }
  if (text) process.stdout.write(cursor ? JSON.stringify({ additional_context: text }) + '\n' : text);
  return 0;
}

function main(argv) {
  const repo = process.env.CLAUDE_PROJECT_DIR || process.env.SSDD_PROJECT_DIR || process.cwd();
  const start = argv.find((a) => a === '--session-start' || a.startsWith('--session-start='));
  if (start) return sessionStart(repo, start === '--session-start=cursor');
  process.stdout.write(render(collect(repo)));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(real(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
