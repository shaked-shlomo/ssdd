// Completion stamps (v2.3): SubagentStart snapshots a routed reviewer's
// staged files, SubagentStop stamps the ones unchanged since — if the review
// ended with a verdict and ran on an allowed model. Payload shapes follow a
// live probe of Claude Code 2.1.263. Plus hooks-mode enforcement in git-guard.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = dirname(fileURLToPath(import.meta.url));
const GATE = join(HOOKS, 'review-gate.mjs');
const GUARD = join(HOOKS, 'git-guard.mjs');
const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-4-5-20251001';

let base; // one temp dir per test: the repo and its transcripts live inside it
let repo;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function makeRepo(reviewGate = {}) {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'ssdd-stamp-')));
  repo = join(base, 'repo');
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, '.ssdd'));
  writeFileSync(join(repo, '.ssdd/config.json'), JSON.stringify({
    routing: [
      { reviewer: 'alpha-reviewer', paths: ['^src/'] },
      { reviewer: 'beta-reviewer', paths: ['^src/lib/'] },
    ],
    reviewGate: { reviewerModels: ['opus>=5.5', 'sonnet>=5.5'], ...reviewGate },
  }));
  writeFileSync(join(repo, 'README'), 'base\n');
  git('add', 'README', '.ssdd/config.json');
  git('commit', '-qm', 'base');
}
function stage(path, content = 'x\n') {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
  git('add', path);
}
function transcript(models) {
  const p = join(base, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(p, models.map((m) => JSON.stringify({ type: 'assistant', message: { model: m, content: [] } })).join('\n') + '\n');
  return p;
}
const hook = (payload, script = GATE) =>
  spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
const start = (id, type) => hook({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: type, cwd: repo });
const stop = (id, type, text, models = [OPUS]) =>
  hook({ hook_event_name: 'SubagentStop', agent_id: id, agent_type: type, cwd: repo, last_assistant_message: text, agent_transcript_path: transcript(models), stop_hook_active: false });
const stamp = () => {
  const p = join(repo, '.git', 'ssdd-review-stamp.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { version: 2, reviewers: {} };
};
const preCommit = () => spawnSync(process.execPath, [GATE, '--pre-commit'], { cwd: repo, encoding: 'utf8', env: { ...process.env, SSDD_REVIEW_SKIP: '' } });
const commitHook = () => hook({ tool_input: { command: 'git commit -m x' }, cwd: repo });

afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); base = null; });

describe('completion stamps', () => {
  beforeEach(() => { makeRepo(); stage('src/lib/a.ts'); stage('src/b.ts'); });

  it('a CLEAN reviewer stamps its routed files, marked by: hook', () => {
    assert.equal(start('a1', 'alpha-reviewer').status, 0);
    assert.ok(existsSync(join(repo, '.git/ssdd-review-dispatch/a1.json')));
    const r = stop('a1', 'alpha-reviewer', 'Findings…\n✅ naming\n\n**CLEAN**');
    assert.equal(r.status, 0, r.stderr);
    const s = stamp().reviewers['alpha-reviewer'];
    assert.deepEqual(Object.keys(s).sort(), ['src/b.ts', 'src/lib/a.ts']);
    assert.equal(s['src/b.ts'].by, 'hook');
    assert.equal(s['src/b.ts'].verdict, 'CLEAN');
    assert.equal(s['src/b.ts'].model, OPUS);
    assert.ok(!existsSync(join(repo, '.git/ssdd-review-dispatch/a1.json')), 'dispatch record is consumed');
    const g = preCommit();
    assert.equal(g.status, 1);
    assert.match(g.stderr, /beta-reviewer/);
    assert.doesNotMatch(g.stderr, /alpha-reviewer —/);
  });

  it('a file edited during the review stays owed', () => {
    start('a2', 'alpha-reviewer');
    stage('src/b.ts', 'changed mid-review\n');
    const r = stop('a2', 'alpha-reviewer', '2 ISSUE(S)');
    assert.match(r.stderr, /still owed, changed during review: src\/b\.ts/);
    const s = stamp().reviewers['alpha-reviewer'];
    assert.ok(s['src/lib/a.ts']);
    assert.equal(s['src/b.ts'], undefined);
    assert.equal(s['src/lib/a.ts'].issues, 2);
  });

  for (const [label, text] of [['NO DIFF', 'NO DIFF — scope not provided'], ['no verdict line', 'I looked at things.'], ['a verdict buried early', 'CLEAN\nbut then\nmore\nlines\nhere']]) {
    it(`${label} stamps nothing`, () => {
      start('a3', 'alpha-reviewer');
      const r = stop('a3', 'alpha-reviewer', text);
      assert.match(r.stderr, /nothing stamped/);
      assert.deepEqual(stamp().reviewers, {});
      assert.match(preCommit().stderr, /! alpha-reviewer: its last review ended without a verdict/);
    });
  }

  it('a review that ran on a disallowed model stamps nothing, and the block message says why', () => {
    start('a4', 'alpha-reviewer');
    const r = stop('a4', 'alpha-reviewer', 'CLEAN', [HAIKU]);
    assert.match(r.stderr, /ran on claude-haiku/);
    assert.deepEqual(stamp().reviewers, {});
    const g = preCommit();
    assert.equal(g.status, 1);
    assert.match(g.stderr, /! alpha-reviewer: its last review ran on claude-haiku/);
    // a later good review clears the refusal
    start('a4b', 'alpha-reviewer'); stop('a4b', 'alpha-reviewer', 'CLEAN');
    assert.equal(stamp().refused['alpha-reviewer'], undefined);
    assert.doesNotMatch(preCommit().stderr, /! alpha-reviewer/);
  });

  for (const [model, ok] of [
    ['claude-opus-5-5', true], ['claude-sonnet-5-5', true], ['claude-sonnet-5-5-20261001', true],
    ['claude-opus-6', true], ['claude-sonnet-6-1', true],
    ['claude-sonnet-5', false], ['claude-opus-4-8', false], ['claude-sonnet-4-6', false],
    ['claude-3-5-sonnet-20241022', false], [HAIKU, false], ['claude-fable-5-1', false], ['claude-mythos-5', false],
  ]) {
    it(`${model} ${ok ? 'may' : 'may not'} stamp under ["opus>=5.5","sonnet>=5.5"]`, () => {
      start('v1', 'alpha-reviewer');
      stop('v1', 'alpha-reviewer', 'CLEAN', [model]);
      assert.equal(Boolean(stamp().reviewers['alpha-reviewer']), ok);
    });
  }

  it('with reviewerModels unset, the harness decides: any model stamps', () => {
    writeFileSync(join(repo, '.ssdd/config.json'), JSON.stringify({
      routing: [{ reviewer: 'alpha-reviewer', paths: ['^src/'] }],
    }));
    git('commit', '-qm', 'unset reviewerModels', '--', '.ssdd/config.json'); // the src files stay staged
    start('u1', 'alpha-reviewer');
    stop('u1', 'alpha-reviewer', 'CLEAN', ['grok-4-7']);
    assert.equal(stamp().reviewers['alpha-reviewer']['src/b.ts'].model, 'grok-4-7');
  });

  it('unsetting reviewerModels in the working tree lifts the model check', () => {
    writeFileSync(join(repo, '.ssdd/config.json'), JSON.stringify({
      routing: [{ reviewer: 'alpha-reviewer', paths: ['^src/'] }],
    }));
    start('u2', 'alpha-reviewer');
    stop('u2', 'alpha-reviewer', 'CLEAN', ['grok-4-7']);
    assert.deepEqual(Object.keys(stamp().reviewers['alpha-reviewer']).sort(), ['src/b.ts', 'src/lib/a.ts']);
    assert.equal(stamp().refused?.['alpha-reviewer'], undefined);
  });

  it('a reviewer the working-tree config no longer routes gets no completion stamp', () => {
    writeFileSync(join(repo, '.ssdd/config.json'), JSON.stringify({
      routing: [{ reviewer: 'alpha-reviewer', paths: ['^src/'] }],
    }));
    start('h1', 'beta-reviewer');
    stop('h1', 'beta-reviewer', 'CLEAN');
    assert.equal(stamp().reviewers['beta-reviewer'], undefined);
  });

  it('a broken config skips the completion stamp with a stderr line', () => {
    writeFileSync(join(repo, '.ssdd/config.json'), '{ nope');
    assert.equal(start('b1', 'alpha-reviewer').status, 0);
    const r = stop('b1', 'alpha-reviewer', 'CLEAN');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /completion stamp skipped: \.ssdd\/config\.json is not valid JSON/);
    assert.equal(stamp().reviewers['alpha-reviewer'], undefined);
  });

  it('a review that mixed models (one turn on a disallowed one) stamps nothing', () => {
    start('a5', 'alpha-reviewer');
    stop('a5', 'alpha-reviewer', 'CLEAN', [OPUS, HAIKU]);
    assert.deepEqual(stamp().reviewers, {});
  });

  it('a non-reviewer agent is a no-op, and a stop without a start is too', () => {
    assert.equal(start('e1', 'Explore').status, 0);
    assert.ok(!existsSync(join(repo, '.git/ssdd-review-dispatch')));
    assert.equal(stop('nostart', 'alpha-reviewer', 'CLEAN').status, 0);
    assert.deepEqual(stamp().reviewers, {});
  });

  it('a plugin-scoped agent name resolves to the reviewer', () => {
    start('p1', 'ssdd:beta-reviewer');
    stop('p1', 'ssdd:beta-reviewer', 'SECURE');
    assert.ok(stamp().reviewers['beta-reviewer']['src/lib/a.ts']);
  });

  it('two reviewers finishing at once both land', async () => {
    start('c1', 'alpha-reviewer');
    start('c2', 'beta-reviewer');
    const run = (id, type) => new Promise((res) => {
      const c = spawn(process.execPath, [GATE], { env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
      c.on('close', res);
      c.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: id, agent_type: type, cwd: repo, last_assistant_message: 'CLEAN', agent_transcript_path: transcript([OPUS]) }));
    });
    await Promise.all([run('c1', 'alpha-reviewer'), run('c2', 'beta-reviewer')]);
    const r = stamp().reviewers;
    assert.ok(r['alpha-reviewer'] && r['beta-reviewer']);
    assert.equal(preCommit().status, 0);
  });

  it('manual stamps made earlier survive a completion stamp', () => {
    spawnSync(process.execPath, [GATE, '--stamp', 'beta-reviewer'], { cwd: repo, env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
    start('m1', 'alpha-reviewer');
    stop('m1', 'alpha-reviewer', 'CLEAN');
    const r = stamp();
    assert.equal(r.version, 2);
    assert.ok(r.reviewers['beta-reviewer']['src/lib/a.ts'].key);
    assert.equal(r.reviewers['beta-reviewer']['src/lib/a.ts'].by, undefined);
  });

  it('committing files a reviewer flagged, unchanged since, carries a triage note', () => {
    start('t1', 'alpha-reviewer'); stop('t1', 'alpha-reviewer', '1 ISSUE(S)');
    start('t2', 'beta-reviewer'); stop('t2', 'beta-reviewer', 'CLEAN');
    const h = commitHook();
    assert.equal(h.status, 0, h.stderr);
    const out = JSON.parse(h.stdout);
    assert.equal(out.permission, 'allow');
    assert.match(out.hookSpecificOutput.additionalContext, /alpha-reviewer reported 1 finding/);
    assert.match(preCommit().stderr, /triaged/);
  });
});

describe('stamping: "hooks"', () => {
  beforeEach(() => { makeRepo({ stamping: 'hooks' }); stage('src/lib/a.ts'); });
  const bash = (command) => hook({ tool_input: { command }, cwd: repo }, GUARD);
  const edit = (file_path) => hook({ tool_name: 'Write', tool_input: { file_path, content: '{}' }, cwd: repo }, GUARD);

  for (const command of [
    'node .ssdd/hooks/review-gate.mjs --stamp alpha-reviewer,beta-reviewer',
    "bash -c 'node .ssdd/hooks/review-gate.mjs --stamp alpha-reviewer'",
    'echo {} > .git/ssdd-review-stamp.json',
    'rm -rf .git/ssdd-review-dispatch',
  ]) {
    it(`the guard denies ${JSON.stringify(command)}`, () => {
      const r = bash(command);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /completion stamps/);
    });
  }

  it('the Edit/Write tools are denied on the stamp file', () => {
    const r = edit(join(repo, '.git/ssdd-review-stamp.json'));
    assert.equal(r.status, 2);
    assert.equal(edit(join(repo, 'src/lib/a.ts')).status, 0);
  });

  it('the block message says to dispatch reviewers, not to run --stamp', () => {
    const h = commitHook();
    assert.equal(h.status, 2);
    assert.match(h.stderr, /Dispatch each owing reviewer with the Agent tool/);
    assert.doesNotMatch(h.stderr, /--stamp alpha/);
  });

  it('completion stamps unblock the commit', () => {
    start('h1', 'alpha-reviewer'); stop('h1', 'alpha-reviewer', 'CLEAN');
    start('h2', 'beta-reviewer'); stop('h2', 'beta-reviewer', 'CLEAN');
    assert.equal(commitHook().status, 0);
  });
});

describe('stamping: "manual" (default)', () => {
  beforeEach(() => { makeRepo(); stage('src/lib/a.ts'); });
  it('the guard still allows --stamp, and the Edit/Write tools are still denied on the stamp file', () => {
    assert.equal(hook({ tool_input: { command: 'node .ssdd/hooks/review-gate.mjs --stamp alpha-reviewer' }, cwd: repo }, GUARD).status, 0);
    assert.equal(hook({ tool_name: 'Edit', tool_input: { file_path: join(repo, '.git/ssdd-review-stamp.json') }, cwd: repo }, GUARD).status, 2);
  });
});

// The guard reads the working-tree config, like the gate.
describe('the guard follows the working-tree config', () => {
  const guard = (command) => hook({ tool_input: { command }, cwd: repo }, GUARD);
  const setConfig = (body) => writeFileSync(join(repo, '.ssdd/config.json'), JSON.stringify(body));
  const routing = [{ reviewer: 'alpha-reviewer', paths: ['^src/'] }];

  it('HEAD says "hooks", the unstaged file says "manual": --stamp is allowed', () => {
    makeRepo({ stamping: 'hooks' });
    assert.equal(guard('node .ssdd/hooks/review-gate.mjs --stamp alpha-reviewer').status, 2);
    setConfig({ routing, reviewGate: { stamping: 'manual' } });
    assert.equal(guard('node .ssdd/hooks/review-gate.mjs --stamp alpha-reviewer').status, 0);
  });

  it('an unstaged blockNoVerify:false takes effect', () => {
    makeRepo();
    assert.equal(guard('git commit -n -m x').status, 2);
    setConfig({ routing, gitGuard: { blockNoVerify: false } });
    assert.equal(guard('git commit -n -m x').status, 0);
  });

  it('a broken config leaves every default block on', () => {
    makeRepo();
    writeFileSync(join(repo, '.ssdd/config.json'), '{ nope');
    assert.equal(guard('git add -A').status, 2);
    assert.equal(guard('git commit --amend').status, 2);
  });
});
