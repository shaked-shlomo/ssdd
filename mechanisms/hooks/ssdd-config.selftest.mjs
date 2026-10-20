// Tests for the shared config loader: the working-tree config, and absent vs broken.
// Run: node --test mechanisms/hooks/ssdd-config.selftest.mjs
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSsddConfig, skillsAudited } from './ssdd-config.mjs';

let dir;
function git(...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const putConfig = (body) => {
  mkdirSync(join(dir, '.ssdd'), { recursive: true });
  writeFileSync(join(dir, '.ssdd', 'config.json'), typeof body === 'string' ? body : JSON.stringify(body));
};
const commit = (msg = 'c') => git('-c', 'commit.gpgsign=false', 'commit', '-qm', msg, '--allow-empty');
const reviewers = (cfg) => cfg.routing.map((r) => r.reviewer).sort();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssdd-cfg-'));
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadSsddConfig', () => {
  it('returns null outside a repo and when no config exists', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ssdd-norepo-'));
    try { assert.equal(loadSsddConfig(outside), null); } finally { rmSync(outside, { recursive: true, force: true }); }
    commit();
    assert.equal(loadSsddConfig(dir), null);
  });

  it('reads the working-tree file, committed or not', () => {
    putConfig({ routing: [{ reviewer: 'w', paths: ['^src/'] }] });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(reviewers(r.cfg), ['w']);
  });

  it('an unstaged edit applies', () => {
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }] });
    git('add', '.ssdd/config.json');
    commit();
    putConfig({ routing: [{ reviewer: 'b', paths: ['^lib/'] }] });
    assert.deepEqual(reviewers(loadSsddConfig(dir).cfg), ['b']);
  });

  it('bakes the global exclude into each route', () => {
    putConfig({
      routing: [{ reviewer: 'a', paths: ['^src/'] }, { reviewer: 'b', paths: ['^src/'], exclude: ['gen/'] }],
      reviewGate: { exclude: ['\\.test\\.ts$'] },
    });
    const { cfg } = loadSsddConfig(dir);
    assert.deepEqual(cfg.routing.find((x) => x.reviewer === 'a').exclude, ['\\.test\\.ts$']);
    assert.deepEqual(cfg.routing.find((x) => x.reviewer === 'b').exclude, ['\\.test\\.ts$', 'gen/']);
    assert.deepEqual(cfg.reviewGate.exclude, []);
  });

  it('returns the settings as given; guard toggles default on', () => {
    putConfig({
      reviewGate: { stamping: 'hooks', reviewerModels: ['opus'], maxRoutedFiles: 3 },
      gitGuard: { blockAmend: false, extraRules: [{ pattern: 'x' }] },
    });
    const { cfg } = loadSsddConfig(dir);
    assert.equal(cfg.reviewGate.stamping, 'hooks');
    assert.deepEqual(cfg.reviewGate.reviewerModels, ['opus']);
    assert.deepEqual(cfg.reviewGate.reviewerModelSets, [['opus']]);
    assert.equal(cfg.reviewGate.maxRoutedFiles, 3);
    assert.equal(cfg.gitGuard.blockAmend, false);
    for (const k of ['blockBulkAdd', 'blockNoVerify', 'blockHooksPath']) assert.equal(cfg.gitGuard[k], true);
    assert.deepEqual(cfg.gitGuard.extraRules.map((r) => r.pattern), ['x']);
  });

  it('defaults: manual stamping, no model sets, no extra rules', () => {
    putConfig({});
    const { cfg } = loadSsddConfig(dir);
    assert.equal(cfg.reviewGate.stamping, 'manual');
    assert.deepEqual(cfg.reviewGate.reviewerModelSets, []);
    assert.deepEqual(cfg.gitGuard.extraRules, []);
    assert.deepEqual(cfg.routing, []);
  });

  it('a broken config is an error', () => {
    putConfig('{ not json');
    assert.match(loadSsddConfig(dir).error, /\.ssdd\/config\.json is not valid JSON/);
    putConfig('[]');
    assert.match(loadSsddConfig(dir).error, /not a JSON object/);
  });

  it('a section of the wrong type is an error', () => {
    const cases = [['reviewGate', 'x'], ['gitGuard', 42], ['routing', {}], ['reviewGate', null], ['gitGuard', []],
      ['routing', ['^src/']], ['routing', [null]]];
    for (const [key, value] of cases) {
      putConfig({ [key]: value });
      const r = loadSsddConfig(dir);
      assert.match(r.error ?? '', new RegExp(`\\.ssdd/config\\.json: "${key}" must be`), `${key}: ${JSON.stringify(value)}`);
      assert.equal(r.cfg.root, r.root);
    }
  });

  it('a wrong-type section is dropped; the rest still loads', () => {
    putConfig({ routing: {}, gitGuard: { extraRules: [{ pattern: 'x' }] } });
    const r = loadSsddConfig(dir);
    assert.match(r.error, /"routing" must be/);
    assert.deepEqual(r.cfg.routing, []);
    assert.deepEqual(r.cfg.gitGuard.extraRules.map((x) => x.pattern), ['x']);
  });

  it('paths default to .ssdd/plans, .ssdd/specs and .ssdd/ledgers', () => {
    putConfig({});
    assert.deepEqual(loadSsddConfig(dir).cfg.paths, { plans: '.ssdd/plans', specs: '.ssdd/specs', ledgers: '.ssdd/ledgers' });
  });

  it('paths are read and normalized', () => {
    putConfig({ paths: { plans: './.claude/plans/', specs: './docs/specs/', ledgers: 42 } });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.cfg.paths, { plans: '.claude/plans', specs: 'docs/specs', ledgers: '.ssdd/ledgers' });
  });

  it('a non-object paths is a config error', () => {
    putConfig({ paths: 'x' });
    const r = loadSsddConfig(dir);
    assert.match(r.error, /"paths" must be an object/);
    assert.deepEqual(r.cfg.paths, { plans: '.ssdd/plans', specs: '.ssdd/specs', ledgers: '.ssdd/ledgers' });
  });

  it('a route that is not a reviewer with a list of regex sources is a config error', () => {
    const bad = [
      [{ reviewer: 'a', paths: '^src/' }, /routing\[0\]: "paths" must be a list of regex sources/],
      [{ reviewer: 'a', paths: ['src/[a'] }, /routing\[0\]: "src\/\[a" isn't a valid regex/],
      [{ reviewer: 'a', paths: ['^src/'], exclude: [42] }, /routing\[0\]: "exclude" must be a list of regex sources/],
      [{ paths: ['^src/'] }, /routing\[0\]: "reviewer" must be a name/],
    ];
    for (const [route, why] of bad) {
      putConfig({ routing: [{ reviewer: 'ok', paths: ['^lib/'] }, route].reverse() });
      const r = loadSsddConfig(dir);
      assert.match(r.error ?? '', why, JSON.stringify(route));
      assert.deepEqual(r.cfg.routing, []);
    }
  });

  it('a reviewGate.exclude that is not a list of regex sources is a config error', () => {
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }], reviewGate: { exclude: ['('] } });
    const r = loadSsddConfig(dir);
    assert.match(r.error, /reviewGate\.exclude: "\(" isn't a valid regex/);
    assert.deepEqual(r.cfg.routing.map((x) => x.exclude), [[]]);
  });

  it('preCommit.blockUntracked defaults to false and reads true', () => {
    putConfig({});
    assert.deepEqual(loadSsddConfig(dir).cfg.preCommit, { blockUntracked: false });
    putConfig({ preCommit: { blockUntracked: true } });
    assert.deepEqual(loadSsddConfig(dir).cfg.preCommit, { blockUntracked: true });
    putConfig({ preCommit: { blockUntracked: 'yes' } });
    assert.equal(loadSsddConfig(dir).cfg.preCommit.blockUntracked, false);
  });

  it('a non-object preCommit is a config error', () => {
    putConfig({ preCommit: true });
    const r = loadSsddConfig(dir);
    assert.match(r.error, /"preCommit" must be an object/);
    assert.equal(r.cfg.preCommit.blockUntracked, false);
  });

  it('a "root" key does not move the repo root', () => {
    putConfig({ root: '/elsewhere' });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.equal(r.cfg.root, r.root);
  });

  it('an unreadable config is an error, not absent', (t) => {
    putConfig({});
    const file = join(dir, '.ssdd', 'config.json');
    chmodSync(file, 0o000);
    // root, Windows and some filesystems read it anyway.
    try { readFileSync(file); return t.skip('chmod 000 does not block reads here'); } catch { /* unreadable, as wanted */ }
    const r = loadSsddConfig(dir);
    assert.notEqual(r, null);
    assert.match(r.error, /\.ssdd\/config\.json can't be read/);
    assert.equal(r.cfg.root, r.root);
  });
});

describe('productionGuard', () => {
  const DEFAULTS = { writePath: 'migrations on merge to main', extraRules: [] };

  it('defaults', () => {
    putConfig({});
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.cfg.productionGuard, DEFAULTS);
  });

  it('keeps a valid section', () => {
    const pg = {
      writePath: 'the CI deploy',
      extraRules: [{ match: '\\bvercel\\b.*--prod', decision: 'ask', reason: 'deploys' }],
      supabase: { liveExtensions: ['pg_net'] },
    };
    putConfig({ productionGuard: pg });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.equal(r.sectionErrors, undefined);
    assert.deepEqual(r.cfg.productionGuard, pg);
  });

  it('a bad section is a config error', () => {
    const rule = { match: 'x', decision: 'ask', reason: 'r' };
    for (const pg of [
      'x',
      { writePath: 3 },
      { extraRules: {} },
      { extraRules: ['x'] },
      { extraRules: [{ ...rule, match: '(' }] },
      { extraRules: [{ ...rule, match: 5 }] },
      { extraRules: [{ ...rule, decision: 'allow' }] },
      { extraRules: [{ ...rule, reason: 5 }] },
      { supabase: [] },
    ]) {
      putConfig({ productionGuard: pg });
      const r = loadSsddConfig(dir);
      const what = JSON.stringify(pg);
      assert.match(r.error ?? '', /productionGuard/, what);
      assert.ok(r.sectionErrors?.productionGuard, what);
      assert.deepEqual(r.cfg.productionGuard, DEFAULTS, what);
    }
  });

  it("another section's error doesn't name productionGuard", () => {
    putConfig({ routing: 'x', productionGuard: { writePath: 'w' } });
    const r = loadSsddConfig(dir);
    assert.ok(r.sectionErrors?.routing);
    assert.equal(r.sectionErrors.productionGuard, undefined);
    assert.equal(r.cfg.productionGuard.writePath, 'w');
  });

  it('an unreadable file has no sectionErrors', () => {
    putConfig('{ not json');
    const r = loadSsddConfig(dir);
    assert.ok(r.error);
    assert.equal(r.sectionErrors, undefined);
  });

  const EXAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'config.example.json');
  it("config.example.json's productionGuard is valid", { skip: !existsSync(EXAMPLE) }, () => {
    const { productionGuard } = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
    assert.ok(productionGuard, 'the example has a productionGuard section');
    putConfig({ productionGuard });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.equal(r.cfg.productionGuard.writePath, 'migrations on merge to main');
  });
});

describe('skillsAudited', () => {
  it('reads the date, null otherwise', () => {
    const put = (body) => { mkdirSync(join(dir, '.ssdd'), { recursive: true }); writeFileSync(join(dir, '.ssdd', 'skills.json'), body); };
    assert.equal(skillsAudited(dir), null);
    for (const body of ['{ not json', '[]', '{"audited":""}', '{"audited":7}', '{"version":1,"sources":{}}']) {
      put(body);
      assert.equal(skillsAudited(dir), null, body);
    }
    put('{"version":1,"sources":{},"audited":"2026-10-18"}');
    assert.equal(skillsAudited(dir), '2026-10-18');
  });
});
