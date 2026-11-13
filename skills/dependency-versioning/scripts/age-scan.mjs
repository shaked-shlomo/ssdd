#!/usr/bin/env node
// The 7-day check over the whole tree: diffs package-lock.json against a git ref
// (default HEAD) and, for every package whose resolved version changed, flags a
// version published less than 7 days ago. Catches a hub bump that pulled
// transitive dependencies up to a release no command named.
//
// Usage: node .agents/skills/dependency-versioning/scripts/age-scan.mjs [ref]
// Exit:  0 all safe, 1 a version younger than 7 days or with no readable publish
//        date, 2 the ref's lockfile can't be read.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ref = process.argv[2] || 'HEAD';
const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // on or before this = safe

const packagesOf = (json) => { try { return JSON.parse(json).packages || {}; } catch { return {}; } };
const cur = packagesOf(readFileSync('package-lock.json', 'utf8'));
let base;
try { base = packagesOf(execFileSync('git', ['show', `${ref}:package-lock.json`], { maxBuffer: 1e9 }).toString()); }
catch { console.error(`could not read package-lock.json at ${ref}`); process.exit(2); }

const nameOf = (k) => k.replace(/.*node_modules\//, '');
// Keyed by name@version: nested copies of one package are each checked.
const changed = new Map(); // name@version → [name, version]
for (const k of new Set([...Object.keys(cur), ...Object.keys(base)])) {
  if (!k.includes('node_modules/')) continue;
  const was = base[k]?.version;
  const now = cur[k]?.version;
  if (now && was !== now) changed.set(`${nameOf(k)}@${now}`, [nameOf(k), now]);
}
if (!changed.size) { console.log(`no resolved-version changes vs ${ref}`); process.exit(0); }

console.log(`checking ${changed.size} changed packages (safe = on or before ${cutoff.toISOString().slice(0, 10)})\n`);
let young = 0;
let unknown = 0;
for (const [name, ver] of changed.values()) {
  let date = '';
  try {
    const t = JSON.parse(execFileSync('npm', ['view', name, 'time', '--json'], { maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    date = (t[ver] || '').slice(0, 10);
  } catch { /* unknown: printed as ? */ }
  const isYoung = date !== '' && new Date(date) > cutoff;
  if (isYoung) young++;
  if (!date) unknown++;
  console.log(`  ${name}@${ver}  ${date || '?'}  ${isYoung ? '<7 DAYS — pin the newest safe version with overrides' : date ? 'safe' : 'publish date unknown — check by hand'}`);
}
console.log(`\nyounger than 7 days: ${young}; publish date unknown: ${unknown}`);
process.exit(young || unknown ? 1 : 0);
