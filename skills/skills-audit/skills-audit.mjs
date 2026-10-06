#!/usr/bin/env node
// /skills-audit helper (zero deps, read-only; run from the repo root).
//   node .agents/skills/skills-audit/skills-audit.mjs [--offline] [--json]
//       stack signals, catalog candidates, recorded vs upstream sha, name clashes
//   node .agents/skills/skills-audit/skills-audit.mjs collisions <dir> [--json]
//       lint-rule hits in a checked-out source's code samples; the house-rule files to read
// --catalog <file> and SSDD_HOME (default: the home dir) exist for tests.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function take(flag, withValue = false) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const [, value] = args.splice(i, withValue ? 2 : 1);
  return withValue ? value : true;
}
const asJson = take('--json') !== null;
const offline = take('--offline') !== null;
const catalogPath = take('--catalog', true) ?? join(dirname(fileURLToPath(import.meta.url)), 'catalog.json');
const home = process.env.SSDD_HOME || homedir();
const root = process.cwd();
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

// Same rule as `ssdd.mjs status --skills`; keep them identical.
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
// A bad ledger must never block the audit: warn and treat it as empty.
function readLedger() {
  try {
    const sources = readJson(join(root, '.ssdd/skills.json'))?.sources;
    return sources && typeof sources === 'object' && !Array.isArray(sources) ? sources : {};
  } catch (e) {
    console.error(`skills-audit: unreadable .ssdd/skills.json (${e.message})`);
    return {};
  }
}
function drift(recorded, head) {
  if (!recorded) return 'never pinned';
  if (head === undefined) return 'not checked';
  if (!head) return 'unreachable';
  return head.startsWith(recorded) ? 'current' : `moved ${recorded.slice(0, 7)}→${head.slice(0, 7)}`;
}

// Skill folders directly under dir; the name comes from frontmatter, else the folder.
function skillsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((d) => {
    const f = join(dir, d, 'SKILL.md');
    if (!existsSync(f)) return [];
    const m = readFileSync(f, 'utf8').match(/^name:\s*["']?(.+?)["']?\s*$/m);
    return [m ? m[1] : d];
  });
}

// Skill name → where it already lives: the repo's skill trees and enabled plugins.
// Plugin enablement follows Claude Code's precedence: user, then project, then local.
function presentSkills() {
  const where = new Map();
  const add = (name, at) => { if (!where.get(name)?.includes(at)) where.set(name, [...(where.get(name) ?? []), at]); };
  for (const n of skillsIn(join(root, '.agents/skills'))) add(n, '.agents/skills');
  for (const n of skillsIn(join(root, '.claude/skills'))) if (!where.has(n)) add(n, '.claude/skills');
  const enabled = {};
  for (const s of [join(home, '.claude/settings.json'), join(root, '.claude/settings.json'), join(root, '.claude/settings.local.json')]) {
    Object.assign(enabled, readJson(s)?.enabledPlugins ?? {});
  }
  const installed = readJson(join(home, '.claude/plugins/installed_plugins.json'))?.plugins ?? {};
  for (const [id, on] of Object.entries(enabled)) {
    const path = on && installed[id]?.[0]?.installPath;
    if (path) for (const n of skillsIn(join(path, 'skills'))) add(n, `plugin ${id}`);
  }
  return where;
}

function stackOf() {
  const pkg = readJson(join(root, 'package.json')) ?? {};
  const deps = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }));
  return { deps, files: readdirSync(root) };
}
function signalHits(signals = {}, stack) {
  return [
    ...(signals.deps ?? []).filter((d) => stack.deps.has(d)).map((d) => `dep ${d}`),
    ...(signals.files ?? []).flatMap((re) => stack.files.filter((f) => new RegExp(re).test(f)).map((f) => `file ${f}`)),
  ];
}

function candidates() {
  const catalog = readJson(catalogPath);
  if (!catalog) { console.error(`skills-audit: no catalog at ${catalogPath}`); process.exit(2); }
  const ledger = readLedger();
  const stack = stackOf();
  const present = presentSkills();
  const matched = new Set();
  const out = [];
  for (const src of catalog.sources) {
    const skills = src.skills
      .map((s) => ({ name: s.name, covers: s.covers, signals: signalHits(s.signals ?? src.signals, stack) }))
      .filter((s) => s.signals.length)
      .map((s) => ({ ...s, present: present.get(s.name) ?? [] }));
    if (!skills.length) continue;
    skills.forEach((s) => s.signals.forEach((h) => matched.add(h)));
    const names = new Set(skills.map((s) => s.name));
    const rec = ledger[src.repo];
    const recSha = typeof rec?.sha === 'string' ? rec.sha : null;
    const recorded = recSha ?? src.audited?.sha ?? null;
    const head = offline ? undefined : remoteHead(src.repo);
    out.push({
      repo: src.repo,
      distribution: src.distribution,
      skills,
      hazards: (src.hazards ?? []).filter((h) => !h.skill || names.has(h.skill)).map((h) => (h.skill ? `${h.skill}: ${h.text}` : h.text)),
      audited: src.audited ?? null,
      ledger: rec ? { sha: recSha, date: rec.date } : null,
      upstream: head ?? null,
      state: drift(recorded, head),
    });
  }
  const byName = new Map();
  for (const c of out) for (const s of c.skills) byName.set(s.name, [...(byName.get(s.name) ?? []), c.repo]);
  const clashes = [...byName].filter(([, repos]) => repos.length > 1).map(([name, repos]) => ({ name, repos }));
  const deps = [...matched].filter((h) => h.startsWith('dep ')).map((h) => h.slice(4));
  const files = [...matched].filter((h) => h.startsWith('file ')).map((h) => h.slice(5));
  return { stack: { deps, files }, candidates: out, clashes };
}

function printCandidates(r) {
  console.log(`Stack signals: ${[...r.stack.deps, ...r.stack.files].join(', ') || 'none in the catalog'}`);
  if (!r.candidates.length) { console.log('No catalog source matches this repo.'); return; }
  console.log(`Candidates (${r.candidates.length}):`);
  for (const c of r.candidates) {
    const dist = c.distribution.plugins ? `plugins ${c.distribution.plugins.join(', ')}` : 'vendored';
    const shas = `recorded ${(c.ledger?.sha ?? c.audited?.sha ?? '-').slice(0, 7)}${c.ledger ? ' (ledger)' : ' (catalog audit)'}, upstream ${(c.upstream ?? '-').slice(0, 7)}`;
    console.log(`\n  ${c.repo}  [${dist}]  ${c.state}  — ${shas}`);
    for (const s of c.skills) {
      console.log(`    ${s.name} — ${s.covers}  (${s.signals.join(', ')})${s.present.length ? `  present: ${s.present.join(', ')}` : ''}`);
    }
    for (const h of c.hazards) console.log(`    hazard: ${h}`);
  }
  if (r.clashes.length) {
    console.log('\nName clashes:');
    for (const x of r.clashes) console.log(`  ${x.name}: ${x.repos.join(', ')}`);
  }
}

const mode = args[0];
if (mode === 'collisions') {
  console.error('skills-audit: collisions is added in the next task'); process.exit(2);
} else {
  const r = candidates();
  if (asJson) console.log(JSON.stringify(r, null, 2)); else printCandidates(r);
}
