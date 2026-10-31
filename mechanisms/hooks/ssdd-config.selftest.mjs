// Tests for the shared config loader: the working-tree config, and absent vs broken.
// Run: node --test mechanisms/hooks/ssdd-config.selftest.mjs
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OBSOLETE_KEYS, dormantHook, dormantHookDetail, foreignHook, loadSsddConfig, skillsAudited } from './ssdd-config.mjs';

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

  it('the nine removed keys are ignored and named', () => {
    putConfig({
      routing: [{ reviewer: 'a', paths: ['^src/'], exclude: ['gen/'] }],
      reviewGate: { stamping: 'hooks', reviewerModels: ['opus'], exclude: ['\\.test\\.ts$'], maxRoutedFiles: 3 },
      preCommit: { blockUntracked: true },
      gitGuard: { blockBulkAdd: false, blockNoVerify: false, blockAmend: true, blockHooksPath: false, extraRules: [{ pattern: 'x' }] },
      modelReview: { generation: 6 },
    });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.obsolete, OBSOLETE_KEYS);
    assert.equal(OBSOLETE_KEYS.length, 9);
    assert.deepEqual(r.cfg.routing[0].exclude, ['gen/']);
    assert.equal(r.cfg.reviewGate.maxRoutedFiles, 3);
    assert.deepEqual(r.cfg.gitGuard.extraRules.map((x) => x.pattern), ['x']);
  });

  it('only the removed keys the file holds are named, in the same order', () => {
    putConfig({ gitGuard: { blockAmend: true }, reviewGate: { stamping: 'manual' }, modelReview: { generation: 5 } });
    assert.deepEqual(loadSsddConfig(dir).obsolete, ['reviewGate.stamping', 'gitGuard.blockAmend', 'modelReview.generation']);
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }] });
    assert.deepEqual(loadSsddConfig(dir).obsolete, []);
  });

  it("a wrong-typed removed section isn't an error", () => {
    putConfig({ modelReview: 'x', preCommit: 1 });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.obsolete, []);
  });

  it('a malformed removed key is not an error either', () => {
    putConfig({ routing: [{ reviewer: 'a', paths: ['^src/'] }], reviewGate: { exclude: ['('], reviewerModels: 'x' }, modelReview: { generation: 0 } });
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.obsolete, ['reviewGate.reviewerModels', 'reviewGate.exclude', 'modelReview.generation']);
    assert.deepEqual(r.cfg.routing.map((x) => x.exclude), [[]]);
  });

  it('returns the settings as given', () => {
    putConfig({ reviewGate: { maxRoutedFiles: 3 }, gitGuard: { extraRules: [{ pattern: 'x' }] } });
    const { cfg } = loadSsddConfig(dir);
    assert.equal(cfg.reviewGate.maxRoutedFiles, 3);
    assert.deepEqual(cfg.gitGuard.extraRules.map((r) => r.pattern), ['x']);
  });

  it('defaults: no extra rules, no routes', () => {
    putConfig({});
    const r = loadSsddConfig(dir);
    assert.deepEqual(r.cfg.gitGuard, { extraRules: [] });
    assert.deepEqual(r.cfg.routing, []);
    assert.deepEqual(r.obsolete, []);
  });

  it('commentReviewer defaults to docs-sync-reviewer', () => {
    putConfig({});
    assert.equal(loadSsddConfig(dir).cfg.reviewGate.commentReviewer, 'docs-sync-reviewer');
    putConfig({ reviewGate: { commentReviewer: 'doc-reviewer' } });
    assert.equal(loadSsddConfig(dir).cfg.reviewGate.commentReviewer, 'doc-reviewer');
    for (const v of ['', '  ', 7, null, ['x'], {}]) {
      putConfig({ reviewGate: { commentReviewer: v } });
      const r = loadSsddConfig(dir);
      assert.equal(r.error, undefined, JSON.stringify(v));
      assert.equal(r.cfg.reviewGate.commentReviewer, 'docs-sync-reviewer', JSON.stringify(v));
    }
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
  it('config.example.json holds none of the removed keys and loads clean', { skip: !existsSync(EXAMPLE) }, () => {
    putConfig(readFileSync(EXAMPLE, 'utf8'));
    const r = loadSsddConfig(dir);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.obsolete, []);
    assert.deepEqual(Object.keys(r.cfg.gitGuard), ['extraRules']);
    assert.ok(r.cfg.routing.length && r.cfg.routing.every((x) => x.exclude.includes('\\.test\\.')), 'each route excludes test files');
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

describe('dormantHook: armed means the pre-commit runs the gate', () => {
  const GATE = 'node "$ROOT/.ssdd/hooks/review-gate.mjs" --pre-commit';
  const preCommit = (where, body) => {
    mkdirSync(join(where, '.githooks'), { recursive: true });
    writeFileSync(join(where, '.githooks', 'pre-commit'), body);
    chmodSync(join(where, '.githooks', 'pre-commit'), 0o755);
  };

  it('a pre-commit that does not call the gate is dormant', () => {
    preCommit(dir, '#!/bin/sh\necho hi\n');
    git('config', 'core.hooksPath', '.githooks');
    assert.equal(dormantHook(dir), `its pre-commit (${join(dir, '.githooks', 'pre-commit')}) doesn't run the review gate`);
    assert.equal(foreignHook(dir), '', 'a pre-commit without the gate is not a foreign one that "still runs"');
  });

  it('a pre-commit that names the gate without --pre-commit is dormant', () => {
    preCommit(dir, '#!/bin/sh\nnode "$ROOT/.ssdd/hooks/review-gate.mjs" --check\n');
    git('config', 'core.hooksPath', '.githooks');
    assert.match(dormantHook(dir), /doesn't run the review gate/);
  });

  it('a pre-commit whose only gate line is commented out is dormant', () => {
    preCommit(dir, `#!/bin/sh\n# ${GATE}\n  #${GATE}\n`);
    git('config', 'core.hooksPath', '.githooks');
    assert.match(dormantHook(dir), /doesn't run the review gate/);
  });

  it('dormantHookDetail names the fix: the arming command, or the line to add', () => {
    preCommit(dir, '#!/bin/sh\necho hi\n');
    assert.deepEqual(dormantHookDetail(dir), { reason: 'core.hooksPath is unset', command: 'git config core.hooksPath .githooks' });
    git('config', 'core.hooksPath', '.githooks');
    const file = join(dir, '.githooks', 'pre-commit');
    assert.deepEqual(dormantHookDetail(dir).edit, { file, line: GATE, managed: false });
    assert.equal(dormantHookDetail(dir).command, '');
    putConfig('{}');
    writeFileSync(join(dir, '.ssdd', 'ssdd.lock.json'), JSON.stringify({ managed: { '.githooks/pre-commit': { src: 'x', sha256: 'y' } } }));
    assert.equal(dormantHookDetail(dir).edit.managed, true);
    preCommit(dir, `#!/bin/sh\n${GATE}\n`);
    assert.equal(dormantHookDetail(dir), null);
  });

  it('a customized pre-commit that calls the gate is armed', () => {
    preCommit(dir, `#!/bin/sh\nROOT="$(git rev-parse --show-toplevel)"\nnpm run lint || exit 1\n${GATE} || exit 1\necho done\n`);
    git('config', 'core.hooksPath', '.githooks');
    assert.equal(dormantHook(dir), '');
  });

  it('an unset core.hooksPath is still dormant, with its own wording', () => {
    preCommit(dir, `#!/bin/sh\n${GATE}\n`);
    assert.equal(dormantHook(dir), 'core.hooksPath is unset');
  });

  it('an absolute path to another checkout\'s .githooks that calls the gate is armed', () => {
    const other = mkdtempSync(join(tmpdir(), 'ssdd-cfg-other-'));
    try {
      preCommit(dir, `#!/bin/sh\n${GATE}\n`);
      preCommit(other, `#!/bin/sh\n# shared\n${GATE}\n`);
      git('config', 'core.hooksPath', join(other, '.githooks'));
      assert.equal(dormantHook(dir), '');
      assert.equal(foreignHook(dir), join(other, '.githooks'));
      // The same path, with a pre-commit that skips the gate, is dormant.
      preCommit(other, '#!/bin/sh\nexit 0\n');
      assert.equal(dormantHook(dir), `its pre-commit (${join(other, '.githooks', 'pre-commit')}) doesn't run the review gate`);
      assert.equal(foreignHook(dir), '');
    } finally { rmSync(other, { recursive: true, force: true }); }
  });
});
