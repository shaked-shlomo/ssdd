#!/usr/bin/env node
// Review-gate coverage for /new-reviewer (zero deps, run from the repo root).
//   node .agents/skills/new-reviewer/coverage.mjs            tracked files no reviewer covers, by directory
//   node .agents/skills/new-reviewer/coverage.mjs <regex>…   files a candidate route's path regexes would match
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('.ssdd/config.json', 'utf8'));
const rx = (list) => (list ?? []).map((p) => new RegExp(p));
const global = rx(cfg.reviewGate?.exclude);
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

const candidate = process.argv.slice(2);
if (candidate.length) {
  const res = rx(candidate);
  const hit = files.filter((f) => res.some((re) => re.test(f)) && !global.some((re) => re.test(f)));
  console.log(`${hit.length} tracked file(s) match:`);
  for (const f of hit.slice(0, 40)) console.log(`  ${f}`);
  if (hit.length > 40) console.log(`  … ${hit.length - 40} more`);
  process.exit(0);
}

const routed = (f) => (cfg.routing ?? []).some((r) =>
  rx(r.paths).some((re) => re.test(f)) && ![...global, ...rx(r.exclude)].some((re) => re.test(f)));
const byDir = new Map();
for (const f of files.filter((f) => !routed(f))) {
  const dir = f.includes('/') ? f.split('/').slice(0, 2).join('/') : '(root)';
  byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
}
const total = [...byDir.values()].reduce((a, b) => a + b, 0);
console.log(`${total} of ${files.length} tracked files route to no reviewer:`);
for (const [dir, n] of [...byDir].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${dir}`);
