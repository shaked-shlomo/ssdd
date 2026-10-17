// Tests for the shared config loader: the working-tree config, and absent vs broken.
// Run: node --test mechanisms/hooks/ssdd-config.selftest.mjs
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSsddConfig } from './ssdd-config.mjs';

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

  it('paths default to .ssdd/plans and .ssdd/ledgers', () => {
    putConfig({});
    assert.deepEqual(loadSsddConfig(dir).cfg.paths, { plans: '.ssdd/plans', ledgers: '.ssdd/ledgers' });
  });

  it('paths are read and normalized', () => {
    putConfig({ paths: { plans: './.claude/plans/', ledgers: 42 } });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.cfg.paths, { plans: '.claude/plans', ledgers: '.ssdd/ledgers' });
  });

  it('a non-object paths is a config error', () => {
    putConfig({ paths: 'x' });
    const r = loadSsddConfig(dir);
    assert.match(r.error, /"paths" must be an object/);
    assert.deepEqual(r.cfg.paths, { plans: '.ssdd/plans', ledgers: '.ssdd/ledgers' });
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
