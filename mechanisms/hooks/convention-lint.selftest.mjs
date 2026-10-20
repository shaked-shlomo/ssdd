// Regression tests for the SSDD convention lint's stdin (harness hook) mode.
// Each case builds a scratch git repo with its own .ssdd/config.json lint rule,
// writes a file, and feeds a Claude PostToolUse or Cursor afterFileEdit payload
// on stdin: exit 2 = findings (the agent self-corrects), 0 = clean.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 18.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'convention-lint.mjs');
const NODE = process.execPath;

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ssdd-lint-'));
  git(dir, 'init', '-q');
  mkdirSync(join(dir, '.ssdd'));
  writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify({
    lint: [{
      name: 'no-hardcoded-hex-colors',
      pattern: '#[0-9a-fA-F]{3,8}\\b',
      message: 'hex',
      include: '^src/.+\\.(ts|tsx)$',
    }],
  }));
  git(dir, 'add', '.ssdd/config.json');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

function lint(dir, input) {
  return spawnSync(NODE, [HOOK], {
    input,
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  }).status;
}

let dir;
beforeEach(() => { dir = makeRepo(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('convention-lint stdin', () => {
  it('flags a hex color from a Claude PostToolUse payload', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'const c = "#fff";\n');
    assert.strictEqual(lint(dir, JSON.stringify({ tool_input: { file_path: 'src/a.ts' } })), 2);
  });

  it('flags a hex color from a Cursor afterFileEdit payload', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'const c = "#fff";\n');
    assert.strictEqual(lint(dir, JSON.stringify({
      file_path: 'src/a.ts',
      hook_event_name: 'afterFileEdit',
    })), 2);
  });

  it('passes a clean file on either payload shape', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'const c = "ok";\n');
    assert.strictEqual(lint(dir, JSON.stringify({ tool_input: { file_path: 'src/a.ts' } })), 0);
    assert.strictEqual(lint(dir, JSON.stringify({ file_path: 'src/a.ts' })), 0);
  });

  it('Cursor payload cwd is the git root when CLAUDE_PROJECT_DIR is unset', () => {
    const host = mkdtempSync(join(tmpdir(), 'ssdd-lint-host-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'a.ts'), 'const c = "#fff";\n');
      const env = { ...process.env };
      delete env.CLAUDE_PROJECT_DIR;
      delete env.SSDD_PROJECT_DIR;
      const status = spawnSync(NODE, [HOOK], {
        input: JSON.stringify({
          file_path: 'src/a.ts',
          hook_event_name: 'afterFileEdit',
          cwd: dir,
        }),
        cwd: host,
        env,
        encoding: 'utf8',
      }).status;
      assert.strictEqual(status, 2);
    } finally {
      rmSync(host, { recursive: true, force: true });
    }
  });
});

describe('convention-lint config', () => {
  const staged = (d) => spawnSync(NODE, [HOOK, '--staged'], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' });

  it('invalid JSON: exit 2 as a hook, 1 with --staged, naming the problem', () => {
    writeFileSync(join(dir, '.ssdd', 'config.json'), '{ "lint": [');
    assert.strictEqual(lint(dir, JSON.stringify({ tool_input: { file_path: 'README' } })), 2);
    const r = staged(dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /config\.json can't be used/);
  });

  it('a rule whose regex does not compile is reported, not skipped', () => {
    writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify({ lint: [{ pattern: '(' }] }));
    assert.strictEqual(staged(dir).status, 1);
  });

  it('no config is still a no-op', () => {
    rmSync(join(dir, '.ssdd', 'config.json'));
    assert.strictEqual(staged(dir).status, 0);
    assert.strictEqual(lint(dir, JSON.stringify({ tool_input: { file_path: 'README' } })), 0);
  });
});

// v3.1: only the lines a change adds are linted, so an old violation isn't
// flagged again on every edit (Hatedate: 28 of 35 lint firings were old lines).
describe('only added lines', () => {
  const OLD = 'const old = "#fff";\nconst ok = 1;\n';
  const run = (d, args, input = '') => spawnSync(NODE, [HOOK, ...args], { input, cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' });
  const edit = (d, rel) => run(d, [], JSON.stringify({ tool_input: { file_path: rel } }));
  const put = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  const commitOld = () => { put('src/a.ts', OLD); git(dir, 'add', 'src/a.ts'); git(dir, 'commit', '-qm', 'old'); };

  it('an edit elsewhere passes the edit hook', () => {
    commitOld();
    put('src/a.ts', `${OLD}const clean = 2;\n`);
    assert.strictEqual(edit(dir, 'src/a.ts').status, 0);
  });

  it('a new violating line is flagged with its number', () => {
    commitOld();
    put('src/a.ts', `${OLD}const c = '#abcdef';\n`);
    const r = edit(dir, 'src/a.ts');
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /src\/a\.ts:3 /);
    assert.doesNotMatch(r.stderr, /src\/a\.ts:1 /);
  });

  it('--staged: only staged added lines', () => {
    commitOld();
    put('src/a.ts', `${OLD}const clean = 2;\n`);
    git(dir, 'add', 'src/a.ts');
    assert.strictEqual(run(dir, ['--staged']).status, 0);
    put('src/a.ts', `${OLD}const c = '#abcdef';\n`);
    git(dir, 'add', 'src/a.ts');
    const r = run(dir, ['--staged']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/a\.ts:3 /);
    assert.doesNotMatch(r.stderr, /src\/a\.ts:1 /);
  });

  it('a new file is linted whole', () => {
    put('src/b.ts', 'const b = "#fff";\n');
    const e = edit(dir, 'src/b.ts');
    assert.strictEqual(e.status, 2);
    assert.match(e.stderr, /src\/b\.ts:1 /);
    git(dir, 'add', 'src/b.ts');
    assert.strictEqual(run(dir, ['--staged']).status, 1);
  });

  it('files named on the command line are linted whole', () => {
    commitOld();
    const r = run(dir, ['src/a.ts']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/a\.ts:1 /);
  });

  it('a renamed file with an old violation passes --staged', () => {
    commitOld();
    git(dir, 'mv', 'src/a.ts', 'src/c.ts');
    assert.strictEqual(run(dir, ['--staged']).status, 0);
  });

  it('--staged judges the staged content, not the disk', () => {
    commitOld();
    put('src/a.ts', `${OLD}const c = '#abcdef';\n`);
    git(dir, 'add', 'src/a.ts');
    put('src/a.ts', OLD);
    const r = run(dir, ['--staged']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/a\.ts:3 /);
  });

  it('a path with a space and non-ASCII letters', () => {
    put('src/צבע file.ts', 'const c = "#fff";\n');
    git(dir, 'add', 'src/צבע file.ts');
    const r = run(dir, ['--staged']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/צבע file\.ts:1 /);
  });

  it('a name git C-quotes (a double quote, a tab)', () => {
    const rel = 'src/q"uo\tte é.ts';
    put(rel, 'const c = "#fff";\n');
    git(dir, 'add', rel);
    const r = run(dir, ['--staged']);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes(`${rel}:1 `), r.stderr);
  });

  it('the edit hook lints from a project dir below the repo root', () => {
    put('app/src/a.ts', OLD);
    git(dir, 'add', 'app/src/a.ts');
    git(dir, 'commit', '-qm', 'old');
    writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify({ lint: [{ name: 'hex', pattern: '#[0-9a-fA-F]{3,8}\\b', message: 'hex', include: '^app/src/' }] }));
    put('app/src/a.ts', `${OLD}const c = '#abcdef';\n`);
    const real = realpathSync(dir); // git reports /private/var for /var on macOS
    const sub = join(real, 'app');
    const r = spawnSync(NODE, [HOOK], { input: JSON.stringify({ tool_input: { file_path: join(real, 'app/src/a.ts') } }), cwd: sub, env: { ...process.env, CLAUDE_PROJECT_DIR: sub }, encoding: 'utf8' });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /app\/src\/a\.ts:3 /);
  });
});
