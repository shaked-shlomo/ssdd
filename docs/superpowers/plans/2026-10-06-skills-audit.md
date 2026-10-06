# v2.4 `/skills-audit` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/skills-audit`. It finds a repo's stack best-practice skills
in a catalog, audits them at a pinned sha against the repo's own rules, and
records verdicts in `.ssdd/skills.json`. Ship `ssdd.mjs status --skills`
with it, to report sources that moved past their recorded sha.

**Architecture:** The new-reviewer shape.
- `skills/skills-audit/SKILL.md` orchestrates. A zero-dep, read-only
  `skills-audit.mjs` beside it does the deterministic parts: stack
  detection, candidates, sha drift, name clashes, lint-rule hits in code
  samples. `catalog.json` ships in the same folder.
- `install` already copies `skills/**` to `.agents/skills/**`, so the
  catalog travels with no installer change.
- The ledger template `mechanisms/skills.example.json` is seeded as
  `.ssdd/skills.json`, which is project-owned.

**Tech Stack:** Node ≥ 18 (`node:test`, `node:child_process`, `node:fs`),
the git CLI. No npm deps.

**Spec:** `SPEC.md` → `# v2.4`. Read it with this plan.

## Global Constraints

- Zero npm dependencies; Node ≥ 18 APIs only.
- **Test files:** named `*.selftest.mjs` and placed in `bin/` or
  `mechanisms/hooks/`. No test file may match a runner's default pattern.
  Run all tests with:
  `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs`.
- **Temp dirs:** each test owns one `mkdtemp` base directory and removes
  only that.
- **Skill frontmatter:** the description is third person and at most 300
  chars, with no `": "` inside a plain YAML value.
- **Skill prose:** it points to `.ssdd/process/SDD.md` instead of restating
  it, and uses no capitals for emphasis.
- **Read-only boundary:** `skills-audit.mjs` and `status --skills` write
  nothing. The skill installs nothing without approval. Plugin installs are
  printed for the user to run.
- **`status --skills` exit code:** it never changes the exit code. Plain
  `status` output is unchanged.
- **Commit trailer** on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branch:** `v2.4-skills-audit`. Don't push or tag until Task 7 asks the
  owner.

---

### Task 1: Ledger template, seeding, and boolean CLI flags

**Files:**
- Create: `mechanisms/skills.example.json`
- Modify: `bin/ssdd.mjs`, at three places:
  - the header comment (lines 4–7)
  - arg parsing (line 44)
  - `plan()` (line ~153, after the `config.json` seed)
- Test: `bin/ssdd.selftest.mjs`, in a new `describe('skills ledger')` block

**Interfaces:**
- Produces:
  - Seeded target `.ssdd/skills.json`, with src
    `mechanisms/skills.example.json`.
  - Boolean `opt.skills` and `opt.force` (a flag no longer swallows the next
    argument).
  - Ledger shape:
    `{ version: 1, sources: { [repo]: { distribution, install, sha, date, skills: { [name]: { verdict, reason, landed? } } } } }`

- [ ] **Step 1: Write the failing tests**

Add after the `status` describe block in `bin/ssdd.selftest.mjs`:

```js
describe('skills ledger', () => {
  const LEDGER = '{\n  "version": 1,\n  "sources": {}\n}\n';
  function releaseWithLedger(tag, body = LEDGER) {
    put(src, 'mechanisms/skills.example.json', body);
    put(src, 'VERSION', `${tag.slice(1)}\n`);
    commitAll(src, tag);
    git(src, 'tag', tag);
  }

  it('install seeds .ssdd/skills.json as a project-owned file', () => {
    releaseWithLedger('v2.1.0');
    const r = ssdd('install', tgt);
    assert.equal(r.code, 0, r.out);
    assert.equal(get('.ssdd/skills.json'), LEDGER);
    const lock = JSON.parse(get('.ssdd/ssdd.lock.json'));
    assert.equal(lock.seeded['.ssdd/skills.json'].src, 'mechanisms/skills.example.json');
    assert.ok(!lock.managed['.ssdd/skills.json']);
  });

  it('update seeds a missing ledger and never rewrites an existing one', () => {
    ssdd('install', tgt);                       // v2.0.0, no ledger yet
    commitAll(tgt, 'install ssdd 2.0.0');       // update refuses dirty framework paths
    releaseWithLedger('v2.1.0');
    let r = ssdd('update', tgt);
    assert.equal(r.code, 0, r.out);
    assert.equal(get('.ssdd/skills.json'), LEDGER);
    const mine = '{ "version": 1, "sources": { "a/b": { "sha": "abc" } } }\n';
    put(tgt, '.ssdd/skills.json', mine);
    commitAll(tgt, 'ledger');
    releaseWithLedger('v2.2.0', '{\n  "version": 1,\n  "sources": {},\n  "$comment": "new"\n}\n');
    r = ssdd('update', tgt);
    assert.equal(r.code, 0, r.out);
    assert.equal(get('.ssdd/skills.json'), mine);
  });

  it('--force and --skills are flags that take no value', () => {
    ssdd('install', tgt);
    const r = ssdd('status', tgt, '--skills');   // helper appends --source <src>
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SSDD v2\.0\.0/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test --test-name-pattern='skills ledger' bin/ssdd.selftest.mjs`

Expected: FAIL.
- The seeding tests fail: there's no `.ssdd/skills.json`.
- The flag test fails because `--skills` swallows `--source`, which makes
  `SRC` wrong ("is not an ssdd git checkout").

- [ ] **Step 3: Implement**

`mechanisms/skills.example.json`:

```json
{
  "$comment": "SSDD skills ledger, written by /skills-audit. Seeded as <repo>/.ssdd/skills.json (project-owned: updates never overwrite it). One entry per upstream source, keyed by repo ('owner/repo' on GitHub, or a git URL): distribution ('plugin' or 'vendored'), install (the plugin id or the vendored path), sha (the full upstream commit that was read), date, and per skill a verdict (adopt, cherry-pick, refresh, do-not-install, skip) with its reason; cherry-picks add 'landed' (the house rule file). Rejections stay recorded. `node <ssdd>/bin/ssdd.mjs status <repo> --skills` reports sources that moved.",
  "version": 1,
  "sources": {}
}
```

In `bin/ssdd.mjs`:

```js
//   ssdd.mjs status  <target> [--skills]
```

(Replace the header line `//   ssdd.mjs status  <target>`.)

```js
  if (a === '--force' || a === '--skills') opt[a.slice(2)] = true;
```

(Replace `if (a === '--force') opt.force = true;`.)

In `usage()`, replace `| status <target>'` with `| status <target> [--skills]'`.

In the header comment, change the seeded-files list
`"Seeded" files (config.json, AGENTS.md,` to
`"Seeded" files (config.json, skills.json, AGENTS.md,`.

In `plan()`, after `add(seeded, '.ssdd/config.json', 'mechanisms/config.example.json');`:

```js
  add(seeded, '.ssdd/skills.json', 'mechanisms/skills.example.json');
```

- [ ] **Step 4: Run all installer tests**

Run: `node --test bin/ssdd.selftest.mjs`

Expected: all pass. The flag test passes because `status` ignores
`opt.skills` until Task 2.

- [ ] **Step 5: Commit**

```bash
git add mechanisms/skills.example.json bin/ssdd.mjs bin/ssdd.selftest.mjs
git commit -m "feat(install): seed .ssdd/skills.json ledger; --skills/--force are boolean flags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `ssdd.mjs status --skills`

**Files:**
- Modify: `bin/ssdd.mjs`
  - add helpers above `// ── status`
  - call them in `status()` before the final `process.exit(1)` check
- Test: `bin/ssdd.selftest.mjs`, extending `describe('skills ledger')`

**Interfaces:**
- Consumes: the ledger shape from Task 1.
- Produces: one line per ledger source,
  `  <state>  <repo>`, where `<state>` is one of:
  - `current`
  - `moved <7>→<7>`
  - `unreachable`
  - `never pinned`

  The same drift rule is re-implemented in `skills-audit.mjs` (Task 3); keep
  the two identical.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('skills ledger')`:

```js
  function bareUpstream() {
    const up = join(root, 'up.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', up]);
    const w = join(root, 'w');
    initRepo(w);
    put(w, 'skills/x/SKILL.md', '---\nname: x\n---\n');
    commitAll(w, 'one');
    git(w, 'push', '-q', up, 'HEAD:main');
    return { up, w };
  }
  const ledger = (sources) => put(tgt, '.ssdd/skills.json', JSON.stringify({ version: 1, sources }));

  it('status --skills reports current, then moved after an upstream commit', () => {
    ssdd('install', tgt);
    const { up, w } = bareUpstream();
    const pinned = git(w, 'rev-parse', 'HEAD');
    ledger({ [up]: { distribution: 'vendored', sha: pinned, date: '2026-10-06', skills: {} } });
    let r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /current\s+\S*up\.git/);
    put(w, 'skills/x/SKILL.md', '---\nname: x\n---\nmore\n');
    commitAll(w, 'two');
    git(w, 'push', '-q', up, 'HEAD:main');
    r = ssdd('status', tgt, '--skills');
    assert.match(r.out, new RegExp(`moved ${pinned.slice(0, 7)}→${git(w, 'rev-parse', 'HEAD').slice(0, 7)}`));
  });

  it('status --skills: unreachable exits 0, a null sha is never pinned, plain status is silent', () => {
    ssdd('install', tgt);
    ledger({
      [join(root, 'nope.git')]: { sha: 'a'.repeat(40), skills: {} },
      'example/unpinned': { sha: null, skills: {} },
    });
    let r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /unreachable\s+\S*nope\.git/);
    assert.match(r.out, /never pinned\s+example\/unpinned/);
    r = ssdd('status', tgt);
    assert.doesNotMatch(r.out, /skills \(|no skill sources|never pinned|unreachable/);
  });

  it('status --skills says so when the ledger is empty or missing', () => {
    ssdd('install', tgt);
    const r = ssdd('status', tgt, '--skills');
    assert.match(r.out, /no skill sources recorded/);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test --test-name-pattern='status --skills' bin/ssdd.selftest.mjs`

Expected: FAIL. No skills section is printed.

- [ ] **Step 3: Implement**

Above `// ── status ──…` in `bin/ssdd.mjs`:

```js
// ── status --skills ──────────────────────────────────────────────────────────
// Upstream skill sources recorded by /skills-audit (.ssdd/skills.json) that
// moved past their sha. Network only on request; never changes the exit code.
// skills-audit.mjs applies the same rule; keep them identical.
const remoteUrl = (repo) => (/^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}` : repo);
function remoteHead(repo) {
  try {
    const out = execFileSync('git', ['ls-remote', remoteUrl(repo), 'HEAD'], {
      encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return out.split(/\s/)[0] || null;
  } catch { return null; }
}
function drift(recorded, head) {
  if (!recorded) return 'never pinned';
  if (head === undefined) return 'not checked';
  if (!head) return 'unreachable';
  return head.startsWith(recorded) ? 'current' : `moved ${recorded.slice(0, 7)}→${head.slice(0, 7)}`;
}
function skillsDrift(target) {
  const p = join(target, '.ssdd/skills.json');
  const sources = Object.entries((existsSync(p) && JSON.parse(readFileSync(p, 'utf8')).sources) || {});
  if (!sources.length) { console.log('skills: no skill sources recorded in .ssdd/skills.json (run /skills-audit)'); return; }
  console.log(`skills (${sources.length}):`);
  for (const [repo, s] of sources) {
    const state = drift(s.sha, s.sha ? remoteHead(repo) : undefined);
    console.log(`  ${state.padEnd(20)}  ${repo}`);
  }
}
```

In `status()`, insert immediately before
`if (conflicted.length || sidecars.length) process.exit(1);`:

```js
  if (opt.skills) skillsDrift(target);
```

- [ ] **Step 4: Run all tests**

Run: `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add bin/ssdd.mjs bin/ssdd.selftest.mjs
git commit -m "feat(status): --skills reports ledger sources that moved upstream

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `skills-audit.mjs`: candidates, drift, name clashes

**Files:**
- Create: `skills/skills-audit/skills-audit.mjs`
- Create: `bin/skills-audit.selftest.mjs`. This test lives in `bin/` so the
  standard test glob runs it and it isn't installed into projects.

**Interfaces:**
- Consumes:
  - a catalog (shape below; real content in Task 5)
  - the ledger from Task 1
  - the `drift` rule from Task 2
- Produces the CLI
  `node skills-audit.mjs [--offline] [--json] [--catalog <file>]`, run with
  cwd at the repo root. Env `SSDD_HOME` overrides the home dir; tests use it.
  - `--json` prints `{ stack: { deps: string[], files: string[] }, candidates: Candidate[], clashes: Clash[] }`.
  - `Candidate`:
    `{ repo, distribution, skills: [{ name, covers, signals: string[], present: string[] }], hazards: string[], audited, ledger: {sha,date}|null, upstream: string|null, state }`.
  - `Clash`: `{ name, repos: string[] }`, for a skill name shipped by two
    or more candidate sources.
  - **Catalog shape:**
    `{ version: 1, sources: [{ repo, distribution: { plugins: string[] } | { vendored: true }, signals?: { deps?: string[], files?: string[] }, skills: [{ name, covers, signals? }], hazards?: [{ skill?, text }], audited: { sha, date, by } }] }`.
    A skill's own `signals` override its source's. `files` entries are
    regex sources tested against the repo root's entry names.

- [ ] **Step 1: Write the failing tests**

`bin/skills-audit.selftest.mjs`:

```js
// Tests for skills/skills-audit/skills-audit.mjs (the /skills-audit helper).
// Each case builds a scratch repo (and a scratch HOME for plugin lookups),
// then runs the script there. Run: node --test bin/skills-audit.selftest.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'skills-audit');
const SCRIPT = join(SKILL_DIR, 'skills-audit.mjs');
const CATALOG = join(SKILL_DIR, 'catalog.json');

let root; let repo; let home;
function put(dir, rel, content) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
}
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
function audit(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, SSDD_HOME: home },
  });
  return { code: r.status, out: r.stdout + r.stderr, json: () => JSON.parse(r.stdout) };
}
const skill = (name) => `---\nname: ${name}\ndescription: x\n---\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ssdd-skills-audit-'));
  repo = join(root, 'app');
  home = join(root, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const FIXTURE = {
  version: 1,
  sources: [
    { repo: 'a/rn', distribution: { plugins: ['rn@a'] }, signals: { deps: ['react-native'] },
      skills: [{ name: 'rn-best', covers: 'perf' }, { name: 'rn-tv', covers: 'tv', signals: { deps: ['react-native-tvos'] } }],
      hazards: [{ skill: 'rn-tv', text: 'tv only' }, { text: 'source-wide' }],
      audited: { sha: 'f'.repeat(40), date: '2026-09-08', by: 'test' } },
    { repo: 'b/rn', distribution: { vendored: true }, signals: { deps: ['react-native-reanimated'] },
      skills: [{ name: 'rn-best', covers: 'animations' }],
      audited: { sha: null, date: '2026-09-08', by: 'test' } },
    { repo: 'c/next', distribution: { vendored: true }, signals: { files: ['^next\\.config\\.(js|mjs|ts)$'] },
      skills: [{ name: 'next-best', covers: 'next' }],
      audited: { sha: null, date: '2026-09-08', by: 'test' } },
  ],
};

describe('candidates', () => {
  it('matches deps and files, filters skills by their own signals, and reports name clashes', () => {
    put(repo, 'package.json', { dependencies: { 'react-native': '0.83.0', 'react-native-reanimated': '4.2.1' } });
    put(root, 'cat.json', FIXTURE);
    const r = audit('--catalog', join(root, 'cat.json'), '--offline', '--json');
    assert.equal(r.code, 0, r.out);
    const out = r.json();
    assert.deepEqual(out.candidates.map((c) => c.repo), ['a/rn', 'b/rn']);
    const a = out.candidates[0];
    assert.deepEqual(a.skills.map((s) => s.name), ['rn-best']);
    assert.deepEqual(a.skills[0].signals, ['dep react-native']);
    assert.deepEqual(a.hazards, ['source-wide']);
    assert.equal(a.state, 'not checked');
    assert.equal(out.candidates[1].state, 'never pinned');
    assert.deepEqual(out.clashes, [{ name: 'rn-best', repos: ['a/rn', 'b/rn'] }]);
  });

  it('a Next.js repo matches by file; a repo with no signals gets no candidates', () => {
    put(root, 'cat.json', FIXTURE);
    put(repo, 'next.config.mjs', 'export default {}\n');
    let out = audit('--catalog', join(root, 'cat.json'), '--offline', '--json').json();
    assert.deepEqual(out.candidates.map((c) => c.repo), ['c/next']);
    rmSync(join(repo, 'next.config.mjs'));
    put(repo, 'package.json', { dependencies: { lodash: '4' } });
    out = audit('--catalog', join(root, 'cat.json'), '--offline', '--json').json();
    assert.deepEqual(out.candidates, []);
  });

  it('marks skills already present in .agents/skills and in enabled plugins', () => {
    put(repo, 'package.json', { dependencies: { 'react-native': '0.83.0' } });
    put(root, 'cat.json', FIXTURE);
    put(repo, '.agents/skills/rn-best/SKILL.md', skill('rn-best'));
    const pluginPath = join(home, '.claude/plugins/cache/a/rn/1.0.0');
    put(pluginPath, 'skills/rn-best/SKILL.md', skill('rn-best'));
    put(home, '.claude/plugins/installed_plugins.json', { version: 2, plugins: { 'rn@a': [{ installPath: pluginPath }] } });
    put(repo, '.claude/settings.json', { enabledPlugins: { 'rn@a': true } });
    let out = audit('--catalog', join(root, 'cat.json'), '--offline', '--json').json();
    assert.deepEqual(out.candidates[0].skills[0].present, ['.agents/skills', 'plugin rn@a']);
    put(repo, '.claude/settings.local.json', { enabledPlugins: { 'rn@a': false } });
    out = audit('--catalog', join(root, 'cat.json'), '--offline', '--json').json();
    assert.deepEqual(out.candidates[0].skills[0].present, ['.agents/skills']);
  });

  it('compares the ledger sha (over the catalog audit) with upstream HEAD', () => {
    put(repo, 'package.json', { dependencies: { 'react-native': '0.83.0' } });
    const up = join(root, 'up.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', up]);
    const w = join(root, 'w');
    mkdirSync(w);
    git(w, 'init', '-q');
    put(w, 'f', '1');
    git(w, 'add', '-A');
    git(w, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'one');
    git(w, 'push', '-q', up, 'HEAD:main');
    const head = git(w, 'rev-parse', 'HEAD');
    const cat = structuredClone(FIXTURE);
    cat.sources[0].repo = up;
    put(root, 'cat.json', cat);
    let c = audit('--catalog', join(root, 'cat.json'), '--json').json().candidates[0];
    assert.equal(c.upstream, head);
    assert.equal(c.state, `moved ${'f'.repeat(7)}→${head.slice(0, 7)}`);
    put(repo, '.ssdd/skills.json', { version: 1, sources: { [up]: { sha: head, date: '2026-10-06', skills: {} } } });
    c = audit('--catalog', join(root, 'cat.json'), '--json').json().candidates[0];
    assert.equal(c.state, 'current');
    assert.deepEqual(c.ledger, { sha: head, date: '2026-10-06' });
  });

  it('prints a readable report without --json', () => {
    put(repo, 'package.json', { dependencies: { 'react-native': '0.83.0', 'react-native-reanimated': '4' } });
    put(root, 'cat.json', FIXTURE);
    const r = audit('--catalog', join(root, 'cat.json'), '--offline');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /a\/rn\s+\[plugins rn@a\]\s+not checked/);
    assert.match(r.out, /rn-best — perf/);
    assert.match(r.out, /hazard: source-wide/);
    assert.match(r.out, /Name clashes:\s+rn-best: a\/rn, b\/rn/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test bin/skills-audit.selftest.mjs`

Expected: FAIL, because the script doesn't exist (`Cannot find module`, or a
non-zero exit).

- [ ] **Step 3: Implement `skills/skills-audit/skills-audit.mjs`**

```js
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
    const out = execFileSync('git', ['ls-remote', remoteUrl(repo), 'HEAD'], {
      encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return out.split(/\s/)[0] || null;
  } catch { return null; }
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
  const ledger = readJson(join(root, '.ssdd/skills.json'))?.sources ?? {};
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
    const recorded = rec?.sha ?? src.audited?.sha ?? null;
    const head = offline ? undefined : remoteHead(src.repo);
    out.push({
      repo: src.repo,
      distribution: src.distribution,
      skills,
      hazards: (src.hazards ?? []).filter((h) => !h.skill || names.has(h.skill)).map((h) => (h.skill ? `${h.skill}: ${h.text}` : h.text)),
      audited: src.audited ?? null,
      ledger: rec ? { sha: rec.sha, date: rec.date } : null,
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
```

Task 4 replaces the `collisions` stub and uses `statSync` and `relative`;
importing them now is harmless.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test bin/skills-audit.selftest.mjs`

Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add skills/skills-audit/skills-audit.mjs bin/skills-audit.selftest.mjs
git commit -m "feat(skills-audit): candidates, sha drift and name clashes from the catalog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `skills-audit.mjs collisions <dir>`

**Files:**
- Modify: `skills/skills-audit/skills-audit.mjs` (replace the `collisions`
  stub)
- Test: `bin/skills-audit.selftest.mjs` (new `describe('collisions')`)

**Interfaces:**
- Consumes: `.ssdd/config.json` → `lint: [{ name, pattern }]`. The
  `include`/`exclude` fields are ignored: they're repo-path filters, and
  upstream docs aren't repo paths.
- Produces: `collisions <dir> [--json]` →
  `{ hits: [{ file, line, rule, text }], houseRules: string[] }`.
  - `file` is relative to `<dir>`.
  - `line` is 1-based, in that file.
  - Only fenced code samples in `.md`/`.mdx` files are scanned.

- [ ] **Step 1: Write the failing test**

Append to `bin/skills-audit.selftest.mjs`:

```js
describe('collisions', () => {
  it('flags code samples a lint rule would block, and lists the house-rule files', () => {
    put(repo, '.ssdd/config.json', { lint: [
      { name: 'no-runOnJS', pattern: '\\brunOnJS\\b', include: '^src/' },
      { name: 'no-hex', pattern: '#[0-9a-fA-F]{3,8}\\b' },
    ] });
    put(repo, 'AGENTS.md', '# rules\n');
    put(repo, '.claude/rules/animation.md', 'rule\n');
    put(repo, '.ssdd/reviewers/performance-reviewer.md', 'r\n');
    const up = join(root, 'upstream');
    put(up, 'skills/rn/SKILL.md', [
      '# RN', '', 'runOnJS in prose is not a sample.', '',
      '```tsx', 'const a = 1;', 'runOnJS(setX)(1);', '```', '',
      '~~~css', 'color: #666;', '~~~', '',
    ].join('\n'));
    put(up, 'node_modules/x/README.md', '```js\nrunOnJS()\n```\n');
    put(up, 'skills/rn/notes.txt', '```js\nrunOnJS()\n```\n');
    const r = audit('collisions', up, '--json');
    assert.equal(r.code, 0, r.out);
    const out = r.json();
    assert.deepEqual(out.hits, [
      { file: 'skills/rn/SKILL.md', line: 7, rule: 'no-runOnJS', text: 'runOnJS(setX)(1);' },
      { file: 'skills/rn/SKILL.md', line: 11, rule: 'no-hex', text: 'color: #666;' },
    ]);
    assert.deepEqual(out.houseRules, ['AGENTS.md', '.claude/rules/animation.md', '.ssdd/reviewers/performance-reviewer.md']);
  });

  it('needs a directory', () => {
    const r = audit('collisions');
    assert.equal(r.code, 2);
    assert.match(r.out, /usage/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test --test-name-pattern=collisions bin/skills-audit.selftest.mjs`

Expected: FAIL with "collisions is added in the next task".

- [ ] **Step 3: Implement**

Replace the stub branch, and add these functions above `const mode = args[0];`:

```js
// Every .md/.mdx file under dir, skipping .git and node_modules.
function docsIn(dir) {
  return readdirSync(dir).flatMap((e) => {
    if (e === '.git' || e === 'node_modules') return [];
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return docsIn(p);
    return /\.mdx?$/.test(e) ? [p] : [];
  });
}
const mdIn = (rel) => (existsSync(join(root, rel)) ? readdirSync(join(root, rel)).filter((f) => f.endsWith('.md')).map((f) => `${rel}/${f}`) : []);

function collisions(dir) {
  const rules = (readJson(join(root, '.ssdd/config.json'))?.lint ?? []).map((r) => ({ name: r.name ?? r.pattern, re: new RegExp(r.pattern) }));
  const hits = [];
  for (const file of docsIn(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1/gm)) {
      const first = text.slice(0, m.index).split('\n').length + 1;
      m[2].split('\n').forEach((line, i) => {
        for (const r of rules) {
          if (r.re.test(line)) hits.push({ file: relative(dir, file), line: first + i, rule: r.name, text: line.trim().slice(0, 160) });
        }
      });
    }
  }
  const houseRules = [
    ...['AGENTS.md', 'CLAUDE.md'].filter((f) => existsSync(join(root, f))),
    ...mdIn('.claude/rules'),
    ...mdIn('.ssdd/reviewers'),
  ];
  return { hits, houseRules };
}

function printCollisions(r) {
  console.log(r.hits.length ? `Lint hits in code samples (${r.hits.length}):` : 'No code sample matches a lint rule.');
  for (const h of r.hits) console.log(`  ${h.file}:${h.line}  ${h.rule}  ${h.text}`);
  console.log(`\nHouse rules to read against it (${r.houseRules.length}):`);
  for (const f of r.houseRules) console.log(`  ${f}`);
}
```

```js
if (mode === 'collisions') {
  if (!args[1]) { console.error('usage: skills-audit.mjs collisions <dir> [--json]'); process.exit(2); }
  const r = collisions(args[1]);
  if (asJson) console.log(JSON.stringify(r, null, 2)); else printCollisions(r);
} else {
```

- [ ] **Step 4: Run the file's tests and confirm they pass**

Run: `node --test bin/skills-audit.selftest.mjs`

Expected: all 7 pass.

- [ ] **Step 5: Commit**

```bash
git add skills/skills-audit/skills-audit.mjs bin/skills-audit.selftest.mjs
git commit -m "feat(skills-audit): collisions mode checks code samples against lint rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The catalog (RN/Expo, Next.js/React)

**Files:**
- Create: `skills/skills-audit/catalog.json`
- Modify: `SPEC.md`, in `# v2.4`:
  - Clarify pass item 8: shas are derived from git, not null.
  - Design → Catalog: `distribution` is `{ "plugins": [...] }`.
- Test: `bin/skills-audit.selftest.mjs` (new `describe('catalog')`)

**Interfaces:**
- Consumes: the catalog shape from Task 3.
- Produces: the shipped catalog. Task 6's SKILL.md and Task 7's live runs
  read it.

**Where the shas come from.** Each is upstream HEAD on the audit date,
2026-09-08 (`git rev-list -1 --before=2026-09-08T23:59 HEAD`). Each
commit's date matches the push date the Hatedate audit states for that
source:

| Source | sha | Commit date |
|---|---|---|
| vercel-labs/agent-skills | `063bee94c3f4df8453406c830b0a7df0f2860278` | 2026-08-28 (prizma vendored the same day as the audit) |
| callstackincubator/agent-skills | `2766baa46ca0fe7c16cc5ab4d0077ccec2e95fb9` | 2026-08-07 |
| expo/skills | `170589a7ee8963156f63de8202fa96cf08a9e610` | 2026-09-08. The official marketplace pinned `80090cc` (2026-09-02); that's recorded as a hazard. |
| software-mansion-labs/skills | `fed69f566b78d3289b6f00e4bccc1d4a696ffde3` | 2026-09-02. The artifact names this sha. |

- [ ] **Step 1: Write the failing tests**

Append to `bin/skills-audit.selftest.mjs`:

```js
describe('catalog', () => {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8'));

  it('every source has the required fields', () => {
    assert.equal(cat.version, 1);
    for (const s of cat.sources) {
      assert.match(s.repo, /^[\w.-]+\/[\w.-]+$/, s.repo);
      assert.ok(s.distribution.vendored === true || (Array.isArray(s.distribution.plugins) && s.distribution.plugins.every((p) => /^[\w.-]+@[\w.-]+$/.test(p))), `${s.repo} distribution`);
      assert.ok(s.skills.length, `${s.repo} skills`);
      for (const k of s.skills) {
        assert.ok(k.name && k.covers, `${s.repo} skill fields`);
        assert.ok(k.signals ?? s.signals, `${s.repo}/${k.name} has no signals`);
      }
      for (const h of s.hazards ?? []) {
        assert.ok(h.text, `${s.repo} hazard text`);
        if (h.skill) assert.ok(s.skills.some((k) => k.name === h.skill), `${s.repo} hazard names unknown skill ${h.skill}`);
      }
      assert.ok(s.audited.sha === null || /^[0-9a-f]{40}$/.test(s.audited.sha), `${s.repo} sha`);
      assert.match(s.audited.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(s.audited.by);
    }
  });

  it('an RN/Expo repo gets all four sources and the react-native-best-practices clash', () => {
    put(repo, 'package.json', { dependencies: {
      expo: '55.0.0', 'react-native': '0.83.10', 'react-native-reanimated': '4.2.1', react: '19.2.0',
    } });
    const out = audit('--offline', '--json').json();
    assert.deepEqual(out.candidates.map((c) => c.repo).sort(), [
      'callstackincubator/agent-skills', 'expo/skills', 'software-mansion-labs/skills', 'vercel-labs/agent-skills',
    ]);
    assert.deepEqual(out.clashes.find((x) => x.name === 'react-native-best-practices')?.repos.sort(),
      ['callstackincubator/agent-skills', 'software-mansion-labs/skills']);
  });

  it('a Next.js repo gets Vercel only, without the RN skill', () => {
    put(repo, 'package.json', { dependencies: { next: '16.0.0', react: '19.2.0', 'react-dom': '19.2.0' } });
    put(repo, 'next.config.ts', 'export default {}\n');
    const out = audit('--offline', '--json').json();
    assert.deepEqual(out.candidates.map((c) => c.repo), ['vercel-labs/agent-skills']);
    assert.ok(!out.candidates[0].skills.some((s) => s.name === 'vercel-react-native-skills'));
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test --test-name-pattern=catalog bin/skills-audit.selftest.mjs`

Expected: FAIL with ENOENT on `catalog.json`.

- [ ] **Step 3: Write `skills/skills-audit/catalog.json`**

```json
{
  "$comment": "Best-practice skill sources for /skills-audit. Hazards here belong to the source itself; collisions with one repo's house rules are found per repo, never recorded here. audited.sha is the upstream commit an audit read (HEAD on its date). Sources: the HateDate RN skills audit (2026-09-08) and prizma commit 457cc0f.",
  "version": 1,
  "sources": [
    {
      "repo": "software-mansion-labs/skills",
      "distribution": { "plugins": ["skills@swmansion"] },
      "signals": { "deps": ["react-native-reanimated", "react-native-gesture-handler", "react-native-worklets", "react-native-svg"] },
      "skills": [
        { "name": "react-native-best-practices", "covers": "Reanimated, gestures, SVG, worklets and multithreading, as reference sub-skills; from the libraries' maintainers" }
      ],
      "hazards": [
        { "text": "The marketplace version string stays at 0.1.0 across commits, so the plugin manager reports up to date; track by sha" },
        { "skill": "react-native-best-practices", "text": "Callstack ships a skill with the same name on the same trigger words; keep one" },
        { "skill": "react-native-best-practices", "text": "The multithreading and enable-worklets-bundle-mode references describe worklets 0.10+ and Reanimated 4.5+; check the installed versions" }
      ],
      "audited": { "sha": "fed69f566b78d3289b6f00e4bccc1d4a696ffde3", "date": "2026-09-08", "by": "HateDate RN skills audit" }
    },
    {
      "repo": "callstackincubator/agent-skills",
      "distribution": { "plugins": ["building-react-native-apps@callstack-agent-skills", "testing-react-native-apps@callstack-agent-skills"] },
      "signals": { "deps": ["react-native"] },
      "skills": [
        { "name": "react-native-best-practices", "covers": "RN performance doctrine: measure, optimize, re-measure; bundle and startup" },
        { "name": "react-native-testing", "covers": "React Native Testing Library: queries, userEvent, matchers", "signals": { "deps": ["@testing-library/react-native"] } },
        { "name": "upgrading-react-native", "covers": "RN version upgrades for projects that own their native folders" },
        { "name": "react-navigation", "covers": "React Navigation setup and patterns", "signals": { "deps": ["@react-navigation/native"] } },
        { "name": "agent-device", "covers": "drives simulators and devices for testing" }
      ],
      "hazards": [
        { "skill": "react-native-best-practices", "text": "Same name as Software Mansion's skill on the same trigger words; keep one" },
        { "skill": "react-native-best-practices", "text": "Recommends React Compiler and Jotai, advises against useMemo/useCallback without profiling, and has a runOnJS sample and a Reanimated 3 install line" },
        { "skill": "upgrading-react-native", "text": "Edits native folders; under Expo CNG they are generated, and expo-upgrade applies instead" },
        { "skill": "agent-device", "text": "Bundled in testing-react-native-apps; it drives simulators and devices" },
        { "skill": "react-navigation", "text": "Under expo-router most of it does not apply" }
      ],
      "audited": { "sha": "2766baa46ca0fe7c16cc5ab4d0077ccec2e95fb9", "date": "2026-09-08", "by": "HateDate RN skills audit" }
    },
    {
      "repo": "expo/skills",
      "distribution": { "plugins": ["expo@claude-plugins-official", "expo@expo-plugins"] },
      "signals": { "deps": ["expo"] },
      "skills": [
        { "name": "expo-upgrade", "covers": "Expo SDK upgrades" },
        { "name": "eas-update", "covers": "OTA updates with EAS Update", "signals": { "deps": ["expo-updates"] } },
        { "name": "eas-update-insights", "covers": "OTA update adoption and health", "signals": { "deps": ["expo-updates"] } },
        { "name": "eas-workflows", "covers": "EAS Workflows CI" },
        { "name": "eas-app-stores", "covers": "store submission with EAS Submit" },
        { "name": "expo-router", "covers": "file-based routing", "signals": { "deps": ["expo-router"] } },
        { "name": "expo-animation", "covers": "motion design and Reanimated recipes", "signals": { "deps": ["react-native-reanimated"] } },
        { "name": "expo-dev-client", "covers": "development builds", "signals": { "deps": ["expo-dev-client"] } },
        { "name": "expo-data-fetching", "covers": "data fetching patterns" },
        { "name": "expo-design-system", "covers": "design tokens and theming scaffolds" },
        { "name": "expo-project-structure", "covers": "layout for new Expo projects" }
      ],
      "hazards": [
        { "skill": "expo-dev-client", "text": "Lists `eas update` as a version check; that command publishes an OTA update" },
        { "skill": "expo-upgrade", "text": "Runs `expo install expo@latest` and questions every expo.install.exclude entry; reconcile with the repo's dependency policy first" },
        { "skill": "expo-animation", "text": "Prefers .get()/.set() on shared values and Pressable plus CSS-transition press feedback; check against the repo's animation rules" },
        { "skill": "expo-router", "text": "Headline samples use NativeTabs and newer-SDK APIs; check against the installed SDK" },
        { "skill": "expo-project-structure", "text": "Written for new projects; its src/app layout can invert an existing repo's" },
        { "text": "The plugin ships hooks/hooks.json (telemetry hooks, documented opt-in); read it before enabling an update" },
        { "text": "The official marketplace pinned an older commit (80090cc, 2026-09-02) than expo/skills HEAD; compare by sha, not plugin version" }
      ],
      "audited": { "sha": "170589a7ee8963156f63de8202fa96cf08a9e610", "date": "2026-09-08", "by": "HateDate RN skills audit" }
    },
    {
      "repo": "vercel-labs/agent-skills",
      "distribution": { "vendored": true },
      "skills": [
        { "name": "vercel-react-best-practices", "covers": "React and Next.js performance rules with ids; the performance reviewer cites them", "signals": { "deps": ["react-dom", "next"] } },
        { "name": "vercel-composition-patterns", "covers": "component API design: compound components, no boolean props", "signals": { "deps": ["react-dom", "next"] } },
        { "name": "vercel-react-view-transitions", "covers": "page and shared-element transitions", "signals": { "deps": ["react-dom", "next"] } },
        { "name": "web-design-guidelines", "covers": "UI accessibility and interface-guideline review", "signals": { "deps": ["react-dom", "next"] } },
        { "name": "vercel-optimize", "covers": "Vercel cost, cache-hit rate and Core Web Vitals, metric-first", "signals": { "deps": ["next"], "files": ["^vercel\\.json$"] } },
        { "name": "deploy-to-vercel", "covers": "deploys from the CLI", "signals": { "deps": ["next"], "files": ["^vercel\\.json$"] } },
        { "name": "vercel-cli-with-tokens", "covers": "Vercel CLI with access tokens", "signals": { "deps": ["next"], "files": ["^vercel\\.json$"] } },
        { "name": "vercel-react-native-skills", "covers": "React Native rules", "signals": { "deps": ["react-native"] } }
      ],
      "hazards": [
        { "skill": "vercel-react-native-skills", "text": "Teaches runOnJS and pins Reanimated 3.16.1 as correct; some samples don't compile, and the repo's eval harness has no RN cases" },
        { "skill": "deploy-to-vercel", "text": "Encourages deploying from a laptop; skip it in a repo that ships on merge" },
        { "skill": "vercel-cli-with-tokens", "text": "Encourages CLI deploys with tokens; skip it in a repo that ships on merge" },
        { "text": "Installed with `npx skills add`; skills-lock.json's computedHash covers the upstream folder (including a metadata.json it doesn't copy), so it can't verify a local copy. Record the sha and diff against a clone" }
      ],
      "audited": { "sha": "063bee94c3f4df8453406c830b0a7df0f2860278", "date": "2026-09-08", "by": "prizma 457cc0f and the HateDate RN skills audit" }
    }
  ]
}
```

- [ ] **Step 4: Run the tests, then confirm every sha resolves upstream**

Run: `node --test bin/skills-audit.selftest.mjs`

Expected: all 10 pass.

Then run this network check (the spec's "every non-null sha resolves"):

```bash
node -e '
const c=require("./skills/skills-audit/catalog.json");const{execFileSync:x}=require("child_process");const os=require("os"),p=require("path"),fs=require("fs");
const t=fs.mkdtempSync(p.join(os.tmpdir(),"cat-"));
for(const s of c.sources){if(!s.audited.sha)continue;const d=p.join(t,s.repo.replace("/","_"));
x("git",["clone","-q","--filter=blob:none","--no-checkout","https://github.com/"+s.repo,d]);
console.log(s.repo, x("git",["-C",d,"cat-file","-t",s.audited.sha],{encoding:"utf8"}).trim());}
fs.rmSync(t,{recursive:true,force:true});'
```

Expected: four lines ending in `commit`.

Then check the real catalog's skill names against upstream. Every `name` in
`catalog.json` must equal a `name:` in that source's SKILL.md at the
audited sha. For each source:

```bash
git -C <clone> grep -h '^name:' <sha> -- '*/SKILL.md'
```

Expected: every catalog name is present.

- [ ] **Step 5: Update SPEC.md `# v2.4`**

Replace clarify item 8 with:

```markdown
8. **Audited shas are recorded, never recalled.** Each is upstream HEAD on
   the audit date (`git rev-list -1 --before=2026-09-08T23:59 HEAD`), and
   its commit date matches the push date the Hatedate audit states for that
   source: Vercel `063bee9` (2026-08-28), Callstack `2766baa` (2026-08-07),
   Expo `170589a` (2026-09-08), Software Mansion `fed69f5` (2026-09-02, as
   the artifact names it). `80090cc` is the official marketplace's older
   Expo pin, recorded as a hazard.
```

In Design → Catalog, replace the signals example "(`files`, such as
`app.json` with an `expo` key, or `next.config.*`)" with
"(`files`: regexes over the root's entries, such as `^next\.config\.`;
Expo matches by `deps: ["expo"]`)". In Design → `skills-audit.mjs`, replace
"found under `~/.claude/plugins/cache/`" with "located through
`~/.claude/plugins/installed_plugins.json`".

In Design → Catalog, replace the `distribution` bullet with:

```markdown
- **`distribution`:** `{ "plugins": ["<name>@<marketplace>", …] }`
  (Callstack and Expo ship several) or `{ "vendored": true }`. A skill may
  carry its own `signals`, overriding its source's. A hazard may name a
  skill, in which case it's shown only when that skill matches.
```

- [ ] **Step 6: Commit**

```bash
git add skills/skills-audit/catalog.json bin/skills-audit.selftest.mjs SPEC.md
git commit -m "feat(skills-audit): RN/Expo and Next.js/React catalog, pinned to the audits' shas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: SKILL.md, the reviewer links, and docs

**Files:**
- Create: `skills/skills-audit/SKILL.md`
- Modify:
  - `reviewers/performance-reviewer.md:18-22`
  - `skills/new-reviewer/SKILL.md` (the "Existing lenses" bullet)
  - `README.md`: the What's in the box Skills row, the Versioning commands
    block, and the "What deliberately stays per-project" paragraph
  - `adapters/claude-code/README.md` (step 3's skill list)
  - `bin/ssdd.mjs` (`nextSteps()`: one line pointing at `/skills-audit`)
- Test: `bin/skills-audit.selftest.mjs` (new `describe('SKILL.md')`)

**Interfaces:**
- Consumes:
  - the script modes from Tasks 3–4
  - the ledger shape from Task 1
  - the catalog from Task 5
- Produces: the `/skills-audit` skill.

- [ ] **Step 1: Write the failing test**

```js
describe('SKILL.md', () => {
  it('frontmatter has name and a plain description of at most 300 chars with no ": "', () => {
    const text = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/)[1];
    assert.match(fm, /^name: skills-audit$/m);
    const desc = fm.match(/^description: (.+)$/m)[1];
    assert.ok(desc.length <= 300, `description is ${desc.length} chars`);
    assert.ok(!desc.includes(': '), 'plain YAML value contains ": "');
    assert.doesNotMatch(desc, /^[>|]/, 'keep it a plain one-line value');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test --test-name-pattern=SKILL bin/skills-audit.selftest.mjs`

Expected: FAIL with ENOENT.

- [ ] **Step 3: Write `skills/skills-audit/SKILL.md`**

````markdown
---
name: skills-audit
description: Finds the stack's best-practice skills in the SSDD catalog, reads each source at a pinned sha, checks it against the repo's rules, hooks and reviewers, and proposes adopt, cherry-pick, refresh or skip. Installs nothing unasked and records decisions by sha. Use for "which skills should we use".
---

# Skills audit

Upstream best-practice skills are written for someone else's repo. Every
source audited so far ships rules a hook or reviewer here would block, so
none installs wholesale. This skill finds candidates, reads them at a pinned
sha, and proposes a verdict per skill. It changes nothing until the user
approves. The lifecycle it serves is in `.ssdd/process/SDD.md`.

## 1. Candidates (read-only)

`node .agents/skills/skills-audit/skills-audit.mjs` prints:

- **Stack signals:** the ones matched in `package.json` and the top-level
  files. In a workspace, read the app packages' manifests too; the script
  reads only the root.
- **Candidate sources:** each source's distribution, its matching skills,
  where each is already present, and the catalog's hazards.
- **Sha drift:** each source's recorded sha against upstream HEAD. The
  recorded sha comes from the ledger `.ssdd/skills.json`, else from the
  catalog's audit.
- **Name clashes:** skill names shipped by two or more candidates. Two
  skills with one name on the same trigger words can't coexist; pick one.

`--offline` skips the upstream check.

## 2. Read each source at a pinned sha

Clone outside the repo and check out the upstream sha step 1 printed:

```bash
git clone -q --filter=blob:none https://github.com/<repo> "$TMPDIR/skills-audit/<repo>"
git -C "$TMPDIR/skills-audit/<repo>" checkout -q <sha>
```

Read each candidate skill's SKILL.md and its references. Compare the APIs
it teaches with the versions this repo has installed (the lockfile, not the
semver range).

For a source already in the ledger,
`git diff <recorded>..<sha> -- <skill folder>` is the refresh review. Don't
use `npx skills add` to look: it writes a second copy into the repo.

## 3. Collisions

`node .agents/skills/skills-audit/skills-audit.mjs collisions <checkout>`
reports two things:

- **Lint hits:** code samples that `.ssdd/config.json` → `lint` would flag.
  A sample the skill marks as wrong doesn't count; one it recommends does.
- **House-rule files to read:** `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`
  and `.ssdd/reviewers/`. Look for what the skill would have an agent do
  that they forbid: a component or library the repo replaced, a token
  system, a command with side effects.

A divergence the repo already documents is a known trade-off. An
undocumented one is a finding, whichever side is right.

## 4. Rate and propose, then stop

Rate each skill 1–5 on these criteria. Stars don't count.

- the author's proximity to the stack (a library's own maintainers rank
  highest)
- API currency against the installed versions
- a validation harness (tests or evals that cover this skill)
- the number of hard collisions

Verdicts:

| Verdict | Meaning |
|---|---|
| adopt | install as is |
| cherry-pick | port named rules into a house rule file |
| refresh | installed, and upstream has moved |
| do-not-install | name the rule it would break |
| skip | doesn't apply here |

Present one table: skill, source, rating, collisions, verdict, and a
one-line reason. Then list any project-side findings the reading surfaced
(a deprecated API still in use, a stale doc). Ask which verdicts to apply.

## 5. Apply what's approved

- **Ledger:** write `.ssdd/skills.json`. Per source, record:
  - `distribution` and `install` (the plugin id, or `.agents/skills/<name>`)
  - the full `sha` that was read
  - `date`
  - per skill, a `verdict` and `reason`, plus `landed` for a cherry-pick

  Record `do-not-install` and `skip` too: they're the answer to "why don't
  we use X".
- **Cherry-picks:** port each rule into the named house file, with a line
  `Source: <repo>@<sha7> <path>`.
- **Plugins:** print the commands for the user to run:

  ```text
  /plugin marketplace add <owner/repo>
  /plugin install <id>
  ```

  Version strings often don't change, so the ledger sha is what tracks the
  plugin.
- **Vendored:** copy the folder into `.agents/skills/<name>`, and only
  when no enabled plugin ships the same skill.
- **Routing:** if `AGENTS.md` routes situations to skills, add the adopted
  ones there.

These edits then go through the review gate like any other change.

## 6. Automation recommender (Claude Code only)

Skip this step outside Claude Code.

- **If `claude-code-setup@claude-plugins-official` is enabled** in
  `.claude/settings.json` or `~/.claude/settings.json`: run
  `claude-code-setup:claude-automation-recommender`. Put its suggestions
  (hooks, subagents, MCP servers) through the same collision check in step
  3, then add them to the proposal.
- **Otherwise:** say it exists and how to enable it,
  `/plugin install claude-code-setup@claude-plugins-official`.
````

Then check the description length:

```bash
node -e 'const t=require("fs").readFileSync("skills/skills-audit/SKILL.md","utf8");const d=t.match(/^description: (.+)$/m)[1];console.log(d.length)'
```

Expected: at most 300. If it's longer, cut words from the end of the first
sentence and keep the trigger phrase.

Also parse the frontmatter with js-yaml:

```bash
NODE_PATH=/Users/shaked/Developer/prizma/node_modules node -e 'const y=require("js-yaml");const t=require("fs").readFileSync("skills/skills-audit/SKILL.md","utf8");console.log(y.load(t.split("---")[1]))'
```

Expected: an object with `name` and `description`.

- [ ] **Step 4: Update the links and docs**

In `reviewers/performance-reviewer.md`, replace lines 18–22 ("If the project
vendors … (data layer, jobs, database).") with:

```markdown
   If the project uses a best-practices skill for its stack (a vendored one
   under `.agents/skills/`, or a plugin; `.ssdd/skills.json` lists what
   `/skills-audit` adopted), that skill IS the rules index for those files:
   cite its rule ids in `❌` / `⚠️` lines so each fix is traceable. The
   default classes below still cover what such a skill doesn't (data layer,
   jobs, database).
```

In `skills/new-reviewer/SKILL.md`, replace

```markdown
  overlap one. Also any best-practices skill in `.agents/skills/`; the
  performance reviewer already cites those.
```

with

```markdown
  overlap one. Also any best-practices skill in `.agents/skills/` or in
  `.ssdd/skills.json`; the performance reviewer already cites those. A
  class an upstream skill already covers may only need `/skills-audit`.
```

In `README.md`:
- **What's in the box, Skills row:** the list
  `(\`new-plan\`, \`new-reviewer\`, \`cleanup\`, \`docs-drift-audit\`)`
  becomes
  `(\`new-plan\`, \`new-reviewer\`, \`skills-audit\`, \`cleanup\`, \`docs-drift-audit\`)`.
- **Versioning commands block:** add this line after the `status` line:

  ```bash
  node ~/Developer/ssdd/bin/ssdd.mjs status <repo> --skills        # also: upstream skill sources that moved past .ssdd/skills.json
  ```

- **"What deliberately stays per-project":** append this paragraph:

  ```markdown
  Third-party best-practice skills are chosen per project too. `/skills-audit`
  matches the stack against a small catalog (RN/Expo, Next.js/React), reads
  each source at a pinned sha against the repo's own rules, and records
  every verdict, rejections included, by sha in `.ssdd/skills.json`. It never
  installs anything unasked.
  ```

- **Project-owned files list** (the `update` section: "Project-owned files
  (`config.json`, `AGENTS.md`, …)"): add `skills.json`.

In `bin/ssdd.mjs` `nextSteps()`, add this step right after the
docs-drift-audit step:

```js
    'Run /skills-audit to pick the stack\'s best-practice skills (in Claude Code it also offers the automation recommender)',
```

In `README.md` → "Injecting into a project":
- Add `.ssdd/skills.json` to the "It seeds the project-owned files (…)"
  sentence.
- Add a numbered step after step 3 (Domain reviewers):

  ```markdown
  4. Best-practice skills — run `/skills-audit`: it matches the stack against
     the catalog, audits each source at a pinned sha against your rules, and
     records what you approve in `.ssdd/skills.json`.
  ```

  Then renumber the git-hook step to 5.

In `adapters/claude-code/README.md` step 3, change
"Invoke `/new-plan`, `/new-reviewer`, `/cleanup`, `/docs-drift-audit`." to
"Invoke `/new-plan`, `/new-reviewer`, `/skills-audit`, `/cleanup`, `/docs-drift-audit`."

- [ ] **Step 5: Run the whole suite**

Run: `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs`

Expected: all pass, at 396 plus the new tests.

- [ ] **Step 6: Commit**

```bash
git add skills/skills-audit/SKILL.md reviewers/performance-reviewer.md skills/new-reviewer/SKILL.md README.md adapters/claude-code/README.md bin/skills-audit.selftest.mjs bin/ssdd.mjs
git commit -m "feat(skills-audit): the /skills-audit skill; link the ledger from the reviewers and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Release verification, CHANGELOG, VERSION, tag

**Files:**
- Modify: `CHANGELOG.md`, `VERSION`, and `SPEC.md` (the `# v2.4` status
  line, acceptance checkboxes and verification note)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: CHANGELOG and VERSION**

Set `VERSION` to `2.4.0`. Insert above `## [2.3.2]` in `CHANGELOG.md`:

```markdown
## [2.4.0] — 2026-10-06

### Added
- **`/skills-audit`.** It picks the stack's best-practice skills without
  installing them blindly. A catalog (RN/Expo, Next.js/React: Software
  Mansion, Callstack, Expo, Vercel) maps stack signals to skill sources,
  with hazards that belong to the source and the sha its audit read.
  - `skills-audit.mjs` lists candidates, sha drift, name clashes and skills
    already present.
  - `collisions <dir>` checks a source's code samples against the repo's
    `lint` rules.
  - The skill reads each source at a pinned sha against the repo's rules
    and reviewers, then proposes adopt / cherry-pick / refresh /
    do-not-install / skip.
  - On approval it records each verdict by sha. It never installs a plugin
    itself; it prints the command.
  - In Claude Code it also runs `claude-automation-recommender` when
    `claude-code-setup` is enabled, and otherwise says how to enable it.
- **`.ssdd/skills.json`:** a project-owned ledger, seeded by `install` and
  never touched by `update`.
- **`status <repo> --skills`** reports ledger sources that moved upstream
  (`current`, `moved`, `unreachable`, `never pinned`). It's network on
  request only and never changes the exit code.

### Changed
- `performance-reviewer` and `/new-reviewer` look in `.ssdd/skills.json`
  too.
- `--force` and `--skills` are flags; they no longer consume the next
  argument.

### Upgrade notes (from 2.3.x)
- `update` adds `.agents/skills/skills-audit/` and seeds
  `.ssdd/skills.json`.
- If your repo already records vendored skills in `skills-lock.json` or a
  VERSIONS table, run `/skills-audit` once to move those decisions into the
  ledger by sha. The other files can stay.
- `claude-code-setup` is not enabled by the settings template. Enable it
  per repo if you want the recommender.
```

- [ ] **Step 2: Full suite**

Run: `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs`

Expected: 0 fail. Record the pass count.

- [ ] **Step 3: Commit, then check that an installed v2.3.2 repo updates cleanly**

```bash
git add CHANGELOG.md VERSION
git commit -m "v2.4.0: CHANGELOG, VERSION

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Use a scratch directory under the session scratchpad, not `/tmp`:

```bash
S=<scratchpad>/upd && rm -rf $S && mkdir -p $S && git -C $S init -q && echo app > $S/README.md && git -C $S add -A && git -C $S -c user.email=t@t -c user.name=t commit -qm init
node bin/ssdd.mjs install $S claude-code --ref v2.3.2 && git -C $S add -A && git -C $S -c user.email=t@t -c user.name=t commit -qm ssdd
node bin/ssdd.mjs update $S --to v2.4-skills-audit
node bin/ssdd.mjs status $S --skills
```

Expected:
- `update` reports `skills-audit` files added and `.ssdd/skills.json`
  seeded, with no conflicts.
- `status --skills` prints "no skill sources recorded".

Ledger preservation across `update` is covered by the Task 1 selftest.

- [ ] **Step 4: Live run 1 (proposes, writes nothing)**

Set up a scratch Expo-shaped repo under the scratchpad:

```bash
L=<scratchpad>/live && rm -rf $L && mkdir -p $L && cd $L && git init -q
cat > package.json <<'JSON'
{ "name": "live", "dependencies": { "expo": "55.0.0", "react": "19.2.0", "react-native": "0.83.10",
  "react-native-reanimated": "4.2.1", "react-native-gesture-handler": "2.30.0", "expo-updates": "55.0.0" } }
JSON
git add -A && git -c user.email=t@t -c user.name=t commit -qm init
node /Users/shaked/Developer/ssdd/bin/ssdd.mjs install $L claude-code --ref v2.4-skills-audit
git add -A && git -c user.email=t@t -c user.name=t commit -qm ssdd
```

Run it from `$L`:

```bash
env -u CLAUDECODE claude -p --model claude-sonnet-5-5 --allowedTools "Bash Read Grep Glob Skill" "/skills-audit"
git -C $L status --porcelain
```

Expected:
- The output lists all four sources and the `react-native-best-practices`
  clash.
- It ends with a verdict table and a question.
- `git status --porcelain` is empty: nothing written in the repo.
- Note whether step 6 ran `claude-code-setup:claude-automation-recommender`
  (it's enabled at user scope on this machine) and the exact skill name it
  used.

Bash is allowed broadly: steps 2–3 clone into `$TMPDIR` with `mkdir`, `ls`
and the like. The "writes nothing" check is `git status`, not the allowlist.
If `"/skills-audit"` doesn't trigger the skill in print mode, retry with
`"Use the skills-audit skill on this repo"`, and record which form worked
in the verification note.

- [ ] **Step 5: Live run 2 (records on approval)**

```bash
env -u CLAUDECODE claude -p --model claude-sonnet-5-5 --allowedTools "Bash Read Grep Glob Skill Edit Write" \
  "/skills-audit — I approve: record software-mansion-labs/skills react-native-best-practices as adopt (plugin skills@swmansion) and callstackincubator/agent-skills react-native-best-practices as do-not-install (name clash). Apply only the ledger; no cherry-picks, no installs."
git -C $L status --porcelain
cat $L/.ssdd/skills.json
```

Expected:
- `git status` shows only ` M .ssdd/skills.json`.
- The ledger has two sources, each with a 40-hex `sha`, a `date`, and the
  two verdicts with reasons.
- If the run writes anything else, it's a SKILL.md bug. Fix the wording,
  re-run, and note it.

- [ ] **Step 6: SPEC verification note**

In `SPEC.md` `# v2.4`:
- Set the status to `**Status:** shipped (v2.4)`.
- Tick each acceptance box that passed.
- Append the verification note:

```markdown
*Verified 2026-10-06:*
- `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs` → <N> pass, 0 fail (Node 24.15.0).
- The catalog's four shas resolve upstream; every catalog skill name matches a SKILL.md `name:` at its sha.
- An installed v2.3.2 repo updates cleanly: skills-audit added, `.ssdd/skills.json` seeded, no conflicts.
- Live run 1 (`claude -p --model claude-sonnet-5-5`, scratch Expo repo): <candidates, clash, verdict table; working tree clean; recommender: <ran as … | offered>>.
- Live run 2: only `.ssdd/skills.json` changed; <its contents in one line>.
```

Fill in each `<…>` with the actual output from Steps 2–5. Don't write a
number or result that wasn't observed.

- [ ] **Step 7: Commit, tag, and ask before pushing**

```bash
git add SPEC.md
git commit -m "docs(spec): v2.4 verification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag -a v2.4.0 -m "v2.4.0: /skills-audit, skills ledger, status --skills"
```

Ask the owner before running:

```bash
git push origin v2.4-skills-audit --follow-tags
```

Afterwards the owner fast-forwards `main` with
`git push origin v2.4-skills-audit:main`.
