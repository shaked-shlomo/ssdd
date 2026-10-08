// Regression tests for the SSDD convention lint's stdin (harness hook) mode.
// Each case builds a scratch git repo with its own .ssdd/config.json lint rule,
// writes a file, and feeds a Claude PostToolUse or Cursor afterFileEdit payload
// on stdin: exit 2 = findings (the agent self-corrects), 0 = clean.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 18.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
