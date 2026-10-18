#!/usr/bin/env node
// SSDD work state: where each plan stands, read from plans, ledgers and git.
//
//   node .ssdd/hooks/work-state.mjs                    the full view
//   node .ssdd/hooks/work-state.mjs --session-start    capped, for a session-start hook
//   node .ssdd/hooks/work-state.mjs --session-start=cursor   the same, as Cursor JSON
//   node .ssdd/hooks/work-state.mjs --staged           the close check (pre-commit)
//   node .ssdd/hooks/work-state.mjs --migrate          rewrite this checkout's plans for v3
//   node .ssdd/hooks/work-state.mjs --migrate-check <ref>   what the migration lost or left
//
// Sources: the default branch (origin/HEAD as last fetched, else main, else
// master, else the current branch), every other local branch (git objects),
// and every worktree (its files on disk, uncommitted edits included). Never
// fetches, and edits plans only under --migrate. No .ssdd/config.json → the
// view prints nothing.
//
// A plan on the default branch takes its Status from there; other copies only
// say who is working on it. IN PROGRESS on the default branch with nothing
// working on it is flagged as likely stale (SPEC.md → v3 → Part 1, Clarify 6).
//
// Git calls stay constant per ref and per worktree: one ls-tree per ref, one
// cat-file --batch for every blob and every file a ledger names, one
// check-ignore per worktree; only the stale rule adds a log per busy copy.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_PATHS, loadSsddConfig, skillsAudited } from './ssdd-config.mjs';
import { OPEN_WORDS, countPlanTasks, parsePlan, parseProgress, parseSsddLedger } from './plan-parse.mjs';
import { idRange, lostText, migratePlan, needsMigration, todoFor } from './plan-migrate.mjs';

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
const isLedger = (p) => p.startsWith(`${SP_DIR}/`);
const planNum = (path) => /^(\d+[^-]*)/.exec(basename(path))?.[1] ?? basename(path, '.md');
const planSlug = (path) => basename(path, '.md').replace(/^\d+[^-]*-?/, '') || basename(path, '.md');
const ssddLedger = (paths, plan) => `${paths.ledgers}/${basename(plan, '.md')}-ledger.md`;

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

// `git worktree list --porcelain` → [{ dir, branch, head }], skipping
// worktrees whose directory is gone.
function worktrees(root) {
  const out = [];
  let cur = null;
  for (const line of (gitOut(root, 'worktree', 'list', '--porcelain') ?? '').split('\n')) {
    if (line.startsWith('worktree ')) { cur = { dir: line.slice(9), branch: null, head: null }; out.push(cur); }
    else if (cur && line.startsWith('HEAD ')) cur.head = /^[0-9a-f]{7,}$/.test(line.slice(5)) && !/^0+$/.test(line.slice(5)) ? line.slice(5) : null;
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7);
  }
  return out.filter((w) => existsSync(w.dir));
}

// One `git cat-file --batch` for many object names (a sha, `<ref>:<path>`,
// `:<path>`) → their texts in input order, null where missing.
function catBatch(root, names) {
  if (!names.length) return [];
  const r = git(root, ['cat-file', '--batch'], Buffer.from(names.join('\n') + '\n'));
  const out = [];
  if (r.status !== 0) return names.map(() => null);
  const buf = r.stdout;
  let i = 0;
  while (i < buf.length && out.length < names.length) {
    const nl = buf.indexOf(10, i);
    if (nl < 0) break;
    const head = buf.slice(i, nl).toString('utf8');
    i = nl + 1;
    const m = /^[0-9a-f]+ \S+ (\d+)$/.exec(head);
    if (!m) { out.push(null); continue; }
    const n = Number(m[1]);
    out.push(buf.slice(i, i + n).toString('utf8'));
    i += n + 1;
  }
  while (out.length < names.length) out.push(null);
  return out;
}

// `git ls-tree -r -z` (or `ls-files -s -z`) records → Map<path, sha>.
function shaMap(text) {
  const map = new Map();
  for (const rec of (text ?? '').split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).split(' ');
    if (meta[1] === 'blob' || /^\d+$/.test(meta[2] ?? '')) map.set(rec.slice(tab + 1), meta[1] === 'blob' ? meta[2] : meta[1]);
  }
  return map;
}

// "<source>:<line>: <pattern>" per path git ignores in dir, one call for all.
function ignoreRules(dir, rels) {
  const out = new Map(rels.map((p) => [p, null]));
  if (!rels.length) return out;
  const r = git(dir, ['check-ignore', '--no-index', '-v', '-n', '-z', '--stdin'], Buffer.from(rels.join('\0') + '\0'));
  if (r.status !== 0 && r.status !== 1) return out;
  const f = r.stdout.toString('utf8').split('\0');
  for (let i = 0; i + 3 < f.length; i += 4) {
    const [src, line, pattern, path] = f.slice(i, i + 4);
    // A linked worktree reports the shared .git/info/exclude by its absolute path.
    if (pattern && !pattern.startsWith('!')) out.set(path, `${src.replace(/^.*\/(?=\.git\/)/, '')}:${line}: ${pattern}`);
  }
  return out;
}
export const ledgerIgnoreRule = (dir, relPath) => ignoreRules(dir, [relPath]).get(relPath);

// ── sources: one place a copy of the repo's files can be read ────────────────
// { label, ref? | dir?, commit, files: Map<path, text>, named: Map<path, text>,
//   committed? (a worktree's branch or HEAD copy), links (set by collect) }.
// files holds plans, SSDD ledgers and Superpowers progress files only.
function wanted(paths, rel) {
  if (posix.dirname(rel) === paths.plans) return isPlanName(posix.basename(rel));
  if (posix.dirname(rel) === paths.ledgers) return rel.endsWith('-ledger.md');
  return /^\.superpowers\/sdd\/[^/]+\/progress\.md$/.test(rel);
}

function diskFiles(dir, paths) {
  const files = new Map();
  const readDir = (rel) => {
    let names = [];
    try { names = readdirSync(join(dir, rel)); } catch { return; }
    for (const n of names) {
      const p = `${rel}/${n}`;
      if (!wanted(paths, p)) continue;
      try { files.set(p, readFileSync(join(dir, p), 'utf8')); } catch { /* unreadable: skip */ }
    }
  };
  readDir(paths.plans);
  readDir(paths.ledgers);
  let sp = [];
  try { sp = readdirSync(join(dir, SP_DIR)); } catch { /* none */ }
  for (const d of sp) {
    const p = `${SP_DIR}/${d}/progress.md`;
    try { files.set(p, readFileSync(join(dir, p), 'utf8')); } catch { /* none */ }
  }
  return files;
}

const normPlanRef = (s, dir) => {
  let p = String(s ?? '').trim().replace(/^\.\//, '');
  if (dir && p.startsWith('/')) { const d = real(dir); const r = real(p); if (r.startsWith(d + '/')) p = r.slice(d.length + 1); }
  return p;
};
// The repo-relative files a source's Superpowers ledgers name, when they
// aren't already among its files.
const namedPaths = (src) => [...new Set([...src.files].filter(([p]) => isLedger(p))
  .map(([, text]) => normPlanRef(parseProgress(text).plan, src.dir))
  .filter((p) => p && !p.startsWith('/') && !src.files.has(p)))];

function sources(root, paths, def) {
  const here = real(root);
  const wts = worktrees(root).sort((a, b) => (real(a.dir) === here ? -1 : real(b.dir) === here ? 1 : 0));
  const inWorktree = new Set(wts.map((w) => w.branch).filter(Boolean));
  const branches = (gitOut(root, 'for-each-ref', '--format=%(refname)', 'refs/heads') ?? '')
    .split('\n').filter(Boolean).filter((b) => b !== def.local && !inWorktree.has(b));
  const refs = [...new Set([def.read, ...def.not, ...wts.map((w) => w.branch ?? w.head), ...branches].filter(Boolean))];
  const listed = new Map(refs.map((ref) => [ref, shaMap(gitOut(root, 'ls-tree', '-r', '-z', '--full-tree', ref, '--',
    paths.plans, paths.ledgers, SP_DIR))]));
  for (const [ref, m] of listed) for (const p of [...m.keys()]) if (!wanted(paths, p)) listed.get(ref).delete(p);
  const shas = [...new Set([...listed.values()].flatMap((m) => [...m.values()]))];
  const texts = new Map(shas.map((s, i) => [s, null])); catBatch(root, shas).forEach((t, i) => texts.set(shas[i], t ?? ''));
  const files = (ref) => new Map([...(listed.get(ref) ?? [])].map(([p, s]) => [p, texts.get(s) ?? '']));
  const short = (ref) => ref.replace(/^refs\/heads\//, '');
  const out = { def: def.read ? { label: def.name, ref: def.read, commit: def.read, files: files(def.read) } : null, others: [] };
  for (const w of wts) {
    const label = real(w.dir) === here ? 'this checkout' : `worktree ${basename(w.dir)}${w.branch ? '' : ' (detached)'}`;
    const commit = w.branch ?? w.head;
    out.others.push({ label, dir: w.dir, commit, files: diskFiles(w.dir, paths), committed: commit ? files(commit) : new Map() });
  }
  for (const b of branches) out.others.push({ label: `branch ${short(b)}`, ref: b, commit: b, files: files(b) });

  // The files Superpowers ledgers name: one batch for every ref source, disk for worktrees.
  const all = [out.def, ...out.others].filter(Boolean);
  const asks = all.filter((s) => s.ref).flatMap((s) => namedPaths(s).map((p) => [s, p]));
  const got = catBatch(root, asks.map(([s, p]) => `${s.ref}:${p}`));
  for (const s of all) s.named = new Map();
  asks.forEach(([s, p], i) => { if (got[i] !== null) s.named.set(p, got[i]); });
  for (const s of all.filter((x) => x.dir)) {
    for (const p of namedPaths(s)) { try { s.named.set(p, readFileSync(join(s.dir, p), 'utf8')); } catch { /* none */ } }
  }
  return out;
}

// ── ledgers ──────────────────────────────────────────────────────────────────
// Which SSDD plan each Superpowers ledger in `src` belongs to: the plan its
// first line names, or the SSDD plan that the file it names mentions by path.
// → Map<ledgerPath, { plan, info, named (that file's text) } | null>.
function linkLedgers(src, allPlans) {
  const links = new Map();
  for (const [path, text] of src.files) {
    if (!isLedger(path)) continue;
    const info = parseProgress(text);
    const named = normPlanRef(info.plan, src.dir);
    let link = null;
    if (named && allPlans.has(named)) link = { plan: named, info, named: src.files.get(named) ?? '' };
    else if (named) {
      const t = src.named.get(named) ?? '';
      const plan = [...allPlans].find((p) => t.includes(p) || t.includes(basename(p)));
      if (plan) link = { plan, info, named: t };
    }
    links.set(path, link);
  }
  return links;
}
const linkedLedgers = (src, plan) => [...(src?.links ?? [])].filter(([, l]) => l?.plan === plan).map(([p]) => p);
function superpowersLedger(src, plan) {
  const path = linkedLedgers(src, plan)[0];
  return path ? { path, ...src.links.get(path) } : null;
}

function progressText(src, plan, paths) {
  const sp = superpowersLedger(src, plan);
  if (sp) {
    const { done, inReview } = sp.info;
    const total = countPlanTasks(sp.named);
    const parts = [];
    if (done > 0) parts.push(`${done === 1 ? 'Task 1' : `Tasks 1–${done}`}${total ? ` of ${total}` : ''} done`);
    if (inReview) parts.push(`Task ${inReview} in review`);
    return parts.join(' · ');
  }
  const ssdd = src.files.get(ssddLedger(paths, plan));
  if (!ssdd) return '';
  const l = parseSsddLedger(ssdd);
  return l.next ? `next: ${l.next}` : (l.total && l.done === l.total ? 'all tasks done' : '');
}

// The leading upper-case words of an unknown Status ("IN REVIEW (PR #9)" →
// "IN REVIEW"), else its first word.
function statusToken(raw) {
  if (!raw) return 'NO STATUS';
  const m = /^[A-Z][A-Z0-9]*(?: [A-Z][A-Z0-9]*)*/.exec(raw);
  return m ? m[0] : (raw.split(/\s/)[0].toUpperCase() || 'NO STATUS');
}

// ── the state ────────────────────────────────────────────────────────────────
// A source works on a plan when its copy of the plan or of a ledger linked to
// it differs from the default branch's, and that difference is its own:
// uncommitted in a worktree, or commits on neither default ref.
function working(root, def, notRefs, src, plan, paths) {
  const watched = [...new Set([plan, ssddLedger(paths, plan), ...linkedLedgers(def, plan), ...linkedLedgers(src, plan)])];
  const differs = (a, b) => watched.some((p) => (a.get(p) ?? null) !== (b.get(p) ?? null));
  if (!differs(src.files, def.files)) return false;
  if (src.dir && differs(src.files, src.committed)) return true;
  if (!src.commit) return false;
  const r = gitOut(root, 'log', '--format=%h', '-1', src.commit, '--not', ...notRefs, '--', ...watched);
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
  for (const s of all) s.links = linkLedgers(s, allPlans);
  const rows = []; const unknown = []; const warnings = loaded.error ? [`! ${loaded.error}`] : [];
  let oldFormat = 0;

  for (const plan of [...allPlans].sort()) {
    const onDefault = def?.files.has(plan);
    const home = onDefault ? def : others.find((s) => s.files.has(plan));
    const parsed = parsePlan(home.files.get(plan));
    if (needsMigration(home.files.get(plan))) oldFormat++;
    const word = parsed.status.word;
    if (!word) { unknown.push(statusToken(parsed.status.raw)); continue; }
    if (!OPEN_WORDS.has(word)) continue;
    // The default branch's Status decides the listing; a source working on the
    // plan supplies what's shown. Only IN PROGRESS with nobody on it is flagged.
    const busy = onDefault ? others.find((s) => working(root, def, defInfo.not, s, plan, paths)) : null;
    const shown = busy ?? home;
    const p = shown.files.has(plan) ? parsePlan(shown.files.get(plan)) : parsed;
    const status = (busy && p.status.word) || word;
    const entries = p.criteria.filter((id) => p.entries.has(id));
    let since = '';
    if (!busy && word === 'DRAFT' && home.ref) since = (gitOut(root, 'log', '-1', '--format=%cs', home.ref, '--', plan) ?? '').trim();
    rows.push({
      path: plan, num: planNum(plan), slug: planSlug(plan), where: shown.label, status, statusRaw: parsed.status.raw,
      onDefault: Boolean(onDefault) && !busy, flagged: onDefault && word === 'IN PROGRESS' && !busy, since,
      progress: progressText(shown, plan, paths),
      verified: entries.filter((id) => !p.entries.get(id).deferred && !p.entries.get(id).notRecorded).length, total: p.criteria.length,
      deferred: entries.filter((id) => p.entries.get(id).deferred).length,
      notRecorded: entries.filter((id) => p.entries.get(id).notRecorded).length, openQuestions: p.openQuestions,
    });
  }

  // Ledgers: unlinked ones, and ones git ignores in a worktree.
  const unlinked = new Set(); const ignored = new Set();
  for (const s of all) {
    const rules = s.dir ? ignoreRules(s.dir, [...s.links.keys()]) : new Map();
    for (const [path, link] of s.links) {
      if (!link) unlinked.add(path.split('/')[2]);
      const rule = rules.get(path);
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

  // Onboarding steps still open (SPEC.md → v3 → Part 2); `update` and
  // `status` print the same lines.
  const onboarding = [];
  if (oldFormat) onboarding.push(`${plural(oldFormat, 'plan')} in the old format: run /migrate-plans`);
  if (!skillsAudited(root)) onboarding.push("/skills-audit hasn't run here");
  warnings.push(...onboarding.map((l) => `! ${l}`));
  return { root, defaultRef: defInfo.name, plans: rows, unknown, warnings, onboarding };
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
  if (r.notRecorded) details.push(`${r.notRecorded} not recorded`);
  if (r.openQuestions) details.push(plural(r.openQuestions, 'open question'));
  let status = r.status;
  if (r.status === 'DRAFT' && r.since) status = `DRAFT since ${r.since}`;
  else if (!(r.onDefault && r.where === defaultRef)) status = `${r.status} (${r.where})`;
  return [`${head}  ${status}`, ...details].join(' · ');
}

export function render(state, { cap = null } = {}) {
  if (!state) return '';
  const rows = [...state.plans].sort((a, b) => ((ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)) ||
    a.num.localeCompare(b.num, undefined, { numeric: true }));
  const header = `SSDD · ${rows.length ? plural(rows.length, 'open plan') : 'no open plans'}`;
  const body = rows.map((r) => `  ${rowLine(r, state.defaultRef)}`);
  if (state.unknown.length) {
    const counts = new Map();
    for (const w of state.unknown) counts.set(w, (counts.get(w) ?? 0) + 1);
    const words = [...counts].sort((a, b) => b[1] - a[1]).map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)).join(', ');
    body.push(`  ${plural(state.unknown.length, 'plan')} with a status outside the six (${words})`);
  }
  const notes = state.warnings.map((w) => `  ${w}`);
  let lines = [header, ...body, ...notes];
  if (cap) {
    const size = (ls) => Buffer.byteLength(ls.join('\n') + '\n');
    if (lines.length > cap.lines || size(lines) > cap.bytes) {
      // Warnings outrank rows: keep up to all but one of the free lines for them.
      const footer = (n) => `+${n} more: node .ssdd/hooks/work-state.mjs`;
      const room = cap.lines - 2;
      let keepNotes = notes.slice(0, Math.max(0, room - 1));
      let keepBody = body.slice(0, room - keepNotes.length);
      const build = () => [header, ...keepBody, ...keepNotes, footer(body.length + notes.length - keepBody.length - keepNotes.length)];
      while (size(build()) > cap.bytes && keepBody.length) keepBody = keepBody.slice(0, -1);
      while (size(build()) > cap.bytes && keepNotes.length) keepNotes = keepNotes.slice(0, -1);
      lines = build();
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

// ── the close check ──────────────────────────────────────────────────────────
// Run by the pre-commit hook, on the repo git runs it in. A staged plan's
// Status must be one of the six; a plan marked BUILT or SHIPPED needs a
// Verification entry per AC ID and its ledger staged. A plan a merge brings in
// unchanged was judged where it was committed, so it's skipped. Every run
// reminds to stage a Superpowers ledger that git would track. Exit 1 blocks.
const ALLOWED = 'DRAFT, IN PROGRESS, BUILT, SHIPPED, SUPERSEDED, ABANDONED';

// `git status --porcelain -z` → Set of paths that are untracked or have
// unstaged changes.
function needsAdd(root, pathspecs) {
  const out = new Set();
  const r = gitOut(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...pathspecs) ?? '';
  const recs = r.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the source path follows a rename
    if (xy === '??' || xy[1] !== ' ') out.add(rec.slice(3));
  }
  return out;
}

function stagedCheck(repo) {
  const loaded = loadSsddConfig(repo);
  if (!loaded) return 0;
  const { root } = loaded;
  const paths = loaded.cfg.paths ?? DEFAULT_PATHS;
  const z = gitOut(root, 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR', '--', paths.plans) ?? '';
  let staged = z.split('\0').filter((p) => p && posix.dirname(p) === paths.plans && isPlanName(posix.basename(p)));
  const mergeFile = (gitOut(root, 'rev-parse', '--git-path', 'MERGE_HEAD') ?? '').trim();
  let heads = [];
  try { heads = readFileSync(resolve(root, mergeFile), 'utf8').split('\n').filter((l) => /^[0-9a-f]{7,}$/.test(l)); } catch { /* not merging */ }
  if (staged.length && heads.length) {
    const index = shaMap(gitOut(root, 'ls-files', '-s', '-z', '--', ...staged));
    const fromMerge = heads.map((h) => shaMap(gitOut(root, 'ls-tree', '-r', '-z', h, '--', ...staged)));
    staged = staged.filter((p) => !fromMerge.some((m) => m.get(p) && m.get(p) === index.get(p)));
  }
  const src = { dir: root, files: diskFiles(root, paths), named: new Map() };
  for (const p of namedPaths(src)) { try { src.named.set(p, readFileSync(join(root, p), 'utf8')); } catch { /* none */ } }
  const allPlans = new Set([...staged, ...[...src.files.keys()].filter((p) => posix.dirname(p) === paths.plans)]);
  src.links = linkLedgers(src, allPlans);
  const ledgersOnDisk = [...src.files.keys()].filter((p) => isLedger(p) || posix.dirname(p) === paths.ledgers);
  const rules = ignoreRules(root, ledgersOnDisk);
  const pending = needsAdd(root, [SP_DIR, paths.ledgers]);
  const texts = catBatch(root, staged.map((p) => `:${p}`));
  let blocked = false;
  const handled = new Set();
  staged.forEach((plan, i) => {
    const p = parsePlan(texts[i] ?? '');
    if (!p.status.word) {
      blocked = true;
      say(`${plan}: Status "${(p.status.raw ?? '').slice(0, 30)}" isn't one of ${ALLOWED}`);
      return;
    }
    if (p.status.word !== 'BUILT' && p.status.word !== 'SHIPPED') return;
    if (!p.criteria.length) say(`${plan}: no AC IDs — close check skipped`);
    const missing = p.criteria.filter((id) => !p.entries.has(id));
    if (missing.length) {
      blocked = true;
      say(`${plan}: ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no Verification entry ` +
        '(an entry may be "DEFERRED (operator): <reason>")');
    }
    for (const l of [superpowersLedger(src, plan)?.path, ssddLedger(paths, plan)].filter((x) => x && src.files.has(x))) {
      handled.add(l);
      if (rules.get(l)) say(`${plan}: its ledger ${l} is ignored by git (${rules.get(l)}), so it can't be committed`);
      else if (pending.has(l)) { blocked = true; say(`${plan}: ledger ${l} isn't staged: git add ${l}`); }
    }
  });
  for (const l of src.files.keys()) {
    if (isLedger(l) && !handled.has(l) && !rules.get(l) && pending.has(l)) say(`reminder: git add ${l}`);
  }
  return blocked ? 1 : 0;
}

// ── the migration ────────────────────────────────────────────────────────────
// `--migrate` rewrites this checkout's plans for v3 (SPEC.md → v3 → Part 2,
// Clarify 15) and prints what each still needs from the agent pass.
// `--migrate-check <ref>` is that pass's floor: every line removed since <ref>
// survives as text, and nothing is left to do. Exit 2: no config, a config
// error, or a bad ref.
const say = (m) => process.stderr.write(`[ssdd-work-state] ${m}\n`);
function migrationRepo(repo) {
  const loaded = loadSsddConfig(repo);
  if (!loaded) { say('no .ssdd/config.json here: not an SSDD repo'); return null; }
  if (loaded.error) { say(`${loaded.error} — fix it first`); return null; }
  return { root: loaded.root, paths: loaded.cfg.paths ?? DEFAULT_PATHS };
}
const plansIn = (files, paths) => [...files.keys()].filter((p) => posix.dirname(p) === paths.plans).sort();

function migrate(repo) {
  const r = migrationRepo(repo);
  if (!r) return 2;
  const files = diskFiles(r.root, r.paths);
  const plans = plansIn(files, r.paths);
  const out = [`SSDD migrate · ${r.paths.plans} · ${plural(plans.length, 'plan')}`];
  let changed = 0;
  for (const p of plans) {
    const m = migratePlan(files.get(p));
    if (m.changed) { writeFileSync(join(r.root, p), m.text); changed++; }
    out.push(`  ${basename(p)}: ${m.changed ? m.changes.join('; ') : 'unchanged'}`, ...m.todo.map((t) => `    to do: ${t}`));
  }
  out.push(`${changed} changed, ${plans.length - changed} unchanged. Next: the agent pass in /migrate-plans.`);
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

function migrateCheck(repo, ref) {
  if (!ref || ref.startsWith('-')) { say('usage: --migrate-check <ref>'); return 2; }
  const r = migrationRepo(repo);
  if (!r) return 2;
  if (!refExists(r.root, ref)) { say(`unknown ref "${ref}"`); return 2; }
  const listed = shaMap(gitOut(r.root, 'ls-tree', '-r', '-z', '--full-tree', ref, '--', r.paths.plans));
  const old = [...listed.keys()].filter((p) => posix.dirname(p) === r.paths.plans && isPlanName(posix.basename(p)));
  const before = new Map(catBatch(r.root, old.map((p) => listed.get(p))).map((t, i) => [old[i], t ?? '']));
  const disk = diskFiles(r.root, r.paths);
  const out = [`SSDD migrate-check · ${r.paths.plans} against ${ref}`];
  let problems = 0;
  for (const p of [...new Set([...old, ...plansIn(disk, r.paths)])].sort()) {
    const now = disk.get(p);
    const lines = [];
    if (now === undefined) { lines.push('    deleted'); problems++; } else {
      const was = before.get(p);
      const lost = was === undefined ? [] : lostText(was, now);
      const todo = todoFor(now, { ticked: was === undefined ? [] : migratePlan(was).ticked });
      if (migratePlan(now).changed) todo.push('criteria still in the old format: run --migrate');
      lines.push(...lost.map((l) => `    lost: ${l.trim()}`), ...todo.map((t) => `    to do: ${t}`));
      problems += lost.length + todo.length;
      const nr = [...parsePlan(now).entries].filter(([, e]) => e.notRecorded).map(([id]) => id);
      if (nr.length) lines.push(`    not recorded: ${idRange(nr)}`);
    }
    if (lines.length) out.push(`  ${basename(p)}`, ...lines);
  }
  out.push(problems ? `migrate-check: ${plural(problems, 'problem')}` : 'migrate-check: ok');
  process.stdout.write(out.join('\n') + '\n');
  return problems ? 1 : 0;
}

function main(argv) {
  const start = argv.find((a) => a === '--session-start' || a.startsWith('--session-start='));
  // The close check and the migration act on the repo git runs in (the cwd),
  // never an environment variable: a hook in a linked worktree must read that
  // index, and a rewrite must land in the checkout it was run in.
  if (argv.includes('--staged')) return stagedCheck(process.cwd());
  if (argv.includes('--migrate')) return migrate(process.cwd());
  const check = argv.indexOf('--migrate-check');
  if (check >= 0) return migrateCheck(process.cwd(), argv[check + 1]);
  const repo = process.env.CLAUDE_PROJECT_DIR || process.env.SSDD_PROJECT_DIR || process.cwd();
  if (start) return sessionStart(repo, start === '--session-start=cursor');
  process.stdout.write(render(collect(repo)));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(real(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
