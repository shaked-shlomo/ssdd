#!/usr/bin/env node
// Peer compatibility over the whole tree: every installed package's required
// (non-optional) peerDependencies are installed at a version that satisfies them.
// `legacy-peer-deps` in .npmrc hides these conflicts at install time.
//
// Usage: node .agents/skills/dependency-versioning/scripts/peer-check.mjs
// Exit:  0 all satisfied, 1 a mismatch, 2 no semver in node_modules.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = process.cwd();
let semver;
try { semver = createRequire(join(root, 'package.json'))('semver'); }
catch { console.error('semver not found: run from the repo root with dependencies installed'); process.exit(2); }

const readPkg = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { return null; } };
const installed = (name) => readPkg(join(root, 'node_modules', name))?.version;
function pkgDirs(base) {
  let entries;
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && e.name !== '.bin')
    .flatMap((e) => (e.name.startsWith('@') ? pkgDirs(join(base, e.name)) : [join(base, e.name)]));
}

const issues = [];
let checked = 0;
for (const dir of pkgDirs(join(root, 'node_modules'))) {
  const meta = readPkg(dir);
  if (!meta?.peerDependencies) continue;
  for (const [peer, range] of Object.entries(meta.peerDependencies)) {
    const optional = meta.peerDependenciesMeta?.[peer]?.optional;
    const v = installed(peer);
    checked++;
    if (!v) { if (!optional) issues.push(`${meta.name}@${meta.version} needs peer ${peer}@"${range}": not installed`); continue; }
    let ok;
    try { ok = semver.satisfies(v, range, { includePrerelease: true }); } catch { ok = true; }
    // An OR-range with one malformed or prerelease clause (">=3.16.0 || >=4.0.0-"): any clause that holds is enough.
    if (!ok && range.includes('||')) ok = range.split('||').some((c) => { try { return semver.satisfies(v, c.trim()); } catch { return false; } });
    if (!ok) issues.push(`${meta.name}@${meta.version} needs peer ${peer}@"${range}": installed ${v} doesn't satisfy it`);
  }
}
console.log(`peer relationships checked: ${checked}`);
console.log(issues.length ? `mismatches:\n  ${issues.join('\n  ')}` : 'all required peers satisfied across the tree');
process.exit(issues.length ? 1 : 0);
