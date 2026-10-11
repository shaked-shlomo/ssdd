// Tests for the shared config loader: which config a commit is judged by
// (HEAD ∪ index, working tree only as a fallback) and absent vs broken.
// Run: node --test mechanisms/hooks/ssdd-config.selftest.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it('returns null outside a repo and when no config exists anywhere', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ssdd-norepo-'));
    try { assert.equal(loadSsddConfig(outside), null); } finally { rmSync(outside, { recursive: true, force: true }); }
    commit();
    assert.equal(loadSsddConfig(dir), null);
  });

  it('falls back to the working tree only when neither HEAD nor the index has one', () => {
    putConfig({ routing: [{ reviewer: 'w', paths: ['^src/'] }] });
    const r = loadSsddConfig(dir);
    assert.deepEqual(r.sources, ['working tree']);
    assert.deepEqual(reviewers(r.cfg), ['w']);
  });

  it('first commit: the staged config alone applies; an unstaged edit is ignored', () => {
    putConfig({ routing: [{ reviewer: 'staged', paths: ['^src/'] }] });
    git('add', '.ssdd/config.json');
    putConfig({ routing: [] });
    const r = loadSsddConfig(dir);
    assert.deepEqual(r.sources, ['staged']);
    assert.deepEqual(reviewers(r.cfg), ['staged']);
  });

  it('unions HEAD and the staged config; a removed route still applies', () => {
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }, { reviewer: 'b', paths: ['^lib/'] }] });
    git('add', '.ssdd/config.json');
    commit();
    putConfig({ routing: [{ reviewer: 'b', paths: ['^lib/'] }] });
    git('add', '.ssdd/config.json');
    const r = loadSsddConfig(dir);
    assert.deepEqual(r.sources, ['HEAD', 'staged']);
    assert.deepEqual(reviewers(r.cfg), ['a', 'b', 'b']);
  });

  it('a staged deletion of the config leaves HEAD in force', () => {
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }] });
    git('add', '.ssdd/config.json');
    commit();
    git('rm', '-q', '.ssdd/config.json');
    const r = loadSsddConfig(dir);
    assert.deepEqual(r.sources, ['HEAD']);
    assert.deepEqual(reviewers(r.cfg), ['a']);
  });

  it('bakes each config\'s global exclude into its own routes only', () => {
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }], reviewGate: { exclude: ['\\.test\\.ts$'] } });
    git('add', '.ssdd/config.json');
    commit();
    putConfig({ routing: [{ reviewer: 'b', paths: ['^src/'], exclude: ['gen/'] }] });
    git('add', '.ssdd/config.json');
    const { cfg } = loadSsddConfig(dir);
    assert.deepEqual(cfg.routing.find((x) => x.reviewer === 'a').exclude, ['\\.test\\.ts$']);
    assert.deepEqual(cfg.routing.find((x) => x.reviewer === 'b').exclude, ['gen/']);
    assert.deepEqual(cfg.reviewGate.exclude, []);
  });

  it('takes the strictest stamping, guard toggles and model lists', () => {
    putConfig({
      reviewGate: { stamping: 'hooks', reviewerModels: ['opus'] },
      gitGuard: { blockAmend: false, blockNoVerify: true, extraRules: [{ pattern: 'x' }] },
    });
    git('add', '.ssdd/config.json');
    commit();
    putConfig({
      reviewGate: { stamping: 'manual', reviewerModels: ['sonnet'], maxRoutedFiles: 3 },
      gitGuard: { blockAmend: false, blockNoVerify: false, extraRules: [{ pattern: 'y' }] },
    });
    git('add', '.ssdd/config.json');
    const { cfg } = loadSsddConfig(dir);
    assert.equal(cfg.reviewGate.stamping, 'hooks');
    assert.deepEqual(cfg.reviewGate.reviewerModelSets, [['opus'], ['sonnet']]);
    assert.equal(cfg.reviewGate.maxRoutedFiles, 3);
    assert.equal(cfg.gitGuard.blockAmend, false);
    assert.equal(cfg.gitGuard.blockNoVerify, true);
    assert.equal(cfg.gitGuard.blockBulkAdd, true);
    assert.deepEqual(cfg.gitGuard.extraRules.map((r) => r.pattern), ['x', 'y']);
  });

  it('a broken staged config is an error; HEAD still applies', () => {
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }] });
    git('add', '.ssdd/config.json');
    commit();
    putConfig('{ not json');
    git('add', '.ssdd/config.json');
    const r = loadSsddConfig(dir);
    assert.match(r.error, /\.ssdd\/config\.json \(staged\) is not valid JSON/);
    assert.deepEqual(reviewers(r.cfg), ['a']);
  });

  it('a broken working-tree fallback is an error', () => {
    putConfig('[1,');
    assert.match(loadSsddConfig(dir).error, /\(working tree\) is not valid JSON/);
    putConfig('[]');
    assert.match(loadSsddConfig(dir).error, /not a JSON object/);
  });

  it('a broken HEAD config with a valid staged one is a warning, not an error', () => {
    putConfig('{ broken');
    git('add', '.ssdd/config.json');
    commit();
    putConfig({ routing: [{ reviewer: 'b', paths: ['^lib/'] }] });
    git('add', '.ssdd/config.json');
    const r = loadSsddConfig(dir);
    assert.equal(r.error, null);
    assert.match(r.warnings[0], /HEAD's \.ssdd\/config\.json is not valid JSON/);
    assert.deepEqual(reviewers(r.cfg), ['b']);
  });
});
