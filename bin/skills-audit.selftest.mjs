// Tests for skills/skills-audit/skills-audit.mjs (the /skills-audit helper).
// Each case builds a scratch repo (and a scratch HOME for plugin lookups),
// then runs the script there. Run: node --test bin/skills-audit.selftest.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  return { code: r.status, out: r.stdout + r.stderr, err: r.stderr, json: () => JSON.parse(r.stdout) };
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

describe('hardening', () => {
  it('tolerates a malformed .ssdd/skills.json: warns, treats the ledger as empty, still lists candidates', () => {
    put(repo, 'package.json', { dependencies: { 'react-native': '0.83.0', 'react-native-reanimated': '4' } });
    put(root, 'cat.json', FIXTURE);
    put(repo, '.ssdd/skills.json', '{ not json');
    const r = audit('--catalog', join(root, 'cat.json'), '--offline', '--json');
    assert.equal(r.code, 0, r.out);
    assert.match(r.err, /skills-audit: unreadable \.ssdd\/skills\.json/);
    const out = r.json();
    assert.deepEqual(out.candidates.map((c) => c.repo), ['a/rn', 'b/rn']);
    assert.equal(out.candidates[0].ledger, null);
  });

  it('never lets a catalog repo string act as a git option (--upload-pack)', () => {
    put(repo, 'package.json', { dependencies: { 'react-native': '0.83.0' } });
    const cat = structuredClone(FIXTURE);
    cat.sources[0].repo = `--upload-pack=touch ${join(root, 'pwned')}`;
    put(root, 'cat.json', cat);
    const r = audit('--catalog', join(root, 'cat.json'), '--json');
    assert.equal(r.code, 0, r.out);
    assert.equal(existsSync(join(root, 'pwned')), false);
    assert.equal(r.json().candidates[0].state, 'unreachable');
  });

  it('treats malformed package.json and .claude/settings.json as absent', () => {
    put(root, 'cat.json', FIXTURE);
    put(repo, 'package.json', '{ nope');
    put(repo, '.claude/settings.json', '{ nope');
    put(repo, '.claude/settings.local.json', '{ nope');
    put(home, '.claude/settings.json', '{ nope');
    put(home, '.claude/plugins/installed_plugins.json', '{ nope');
    const r = audit('--catalog', join(root, 'cat.json'), '--offline', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.json().candidates, []);
  });

  it('an empty ledger sha falls back to the catalog audit sha', () => {
    put(repo, 'package.json', { dependencies: { 'react-native': '0.83.0' } });
    put(root, 'cat.json', FIXTURE);
    put(repo, '.ssdd/skills.json', { version: 1, sources: { 'a/rn': { sha: '', date: '2026-10-06', skills: {} } } });
    const r = audit('--catalog', join(root, 'cat.json'), '--offline', '--json');
    assert.equal(r.json().candidates[0].state, 'not checked');
  });

  it('keeps the drift helpers identical to bin/ssdd.mjs', () => {
    const grab = (file) => {
      const t = readFileSync(file, 'utf8');
      const url = t.match(/^const remoteUrl = .*$/m)[0];
      const fn = (name) => t.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, 'm'))[0];
      return [url, fn('remoteHead'), fn('drift')].join('\n');
    };
    assert.equal(grab(SCRIPT), grab(join(SKILL_DIR, '..', '..', 'bin', 'ssdd.mjs')));
  });
});

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

  it('a malformed .ssdd/config.json means no lint rules plus a stderr note', () => {
    put(repo, '.ssdd/config.json', '{ nope');
    const up = join(root, 'upstream');
    put(up, 'a.md', '```js\nrunOnJS()\n```\n');
    const r = audit('collisions', up, '--json');
    assert.equal(r.code, 0, r.out);
    assert.match(r.err, /skills-audit: unreadable \.ssdd\/config\.json/);
    assert.deepEqual(r.json().hits, []);
  });
});

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
