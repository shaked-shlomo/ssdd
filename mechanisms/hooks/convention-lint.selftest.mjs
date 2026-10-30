// Regression tests for the SSDD convention lint. Each case builds a scratch
// git repo with its own .ssdd/config.json lint rule, writes a file, and feeds a
// Claude PostToolUse or Cursor afterFileEdit payload on stdin, or runs
// --staged. Claude: findings are a warning (exit 0, additionalContext on
// stdout). Cursor: exit 2, stderr. --staged and named files: exit 1.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 22.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
// What a Claude Code run told the agent: additionalContext, or '' (silent).
function warning(r) {
  assert.strictEqual(r.status, 0, r.stderr);
  if (!r.stdout) return '';
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.strictEqual(out.hookEventName, 'PostToolUse');
  return out.additionalContext;
}

let dir;
beforeEach(() => { dir = makeRepo(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('convention-lint stdin', () => {
  it('flags a hex color from a Claude PostToolUse payload, as a warning', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'const c = "#fff";\n');
    for (const p of [{}, { hook_event_name: 'PostToolUse', tool_name: 'Edit' }]) {
      const r = spawnSync(NODE, [HOOK], { input: JSON.stringify({ ...p, tool_input: { file_path: 'src/a.ts' } }), cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
      assert.match(warning(r), /src\/a\.ts:1 \[no-hardcoded-hex-colors\]/);
      assert.strictEqual(r.stderr, '');
    }
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

  it('invalid JSON: a warning under Claude, exit 2 under Cursor, 1 with --staged, naming the problem', () => {
    writeFileSync(join(dir, '.ssdd', 'config.json'), '{ "lint": [');
    const w = spawnSync(NODE, [HOOK], { input: JSON.stringify({ tool_input: { file_path: 'README' } }), cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
    assert.match(warning(w), /config\.json can't be used/);
    assert.strictEqual(lint(dir, JSON.stringify({ file_path: 'README', hook_event_name: 'afterFileEdit' })), 2);
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
    assert.strictEqual(warning(edit(dir, 'src/a.ts')), '');
  });

  it('a new violating line is flagged with its number', () => {
    commitOld();
    put('src/a.ts', `${OLD}const c = '#abcdef';\n`);
    const w = warning(edit(dir, 'src/a.ts'));
    assert.match(w, /src\/a\.ts:3 /);
    assert.doesNotMatch(w, /src\/a\.ts:1 /);
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
    assert.match(warning(edit(dir, 'src/b.ts')), /src\/b\.ts:1 /);
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

  it('an added line that starts with "++ " is a line, not a file header', () => {
    put('src/a.ts', 'line1\n');
    git(dir, 'add', 'src/a.ts');
    git(dir, 'commit', '-qm', 'old');
    put('src/a.ts', 'line1\n++ counter;\nconst c = "#abcdef";\n');
    git(dir, 'add', 'src/a.ts');
    const r = run(dir, ['--staged']);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, /src\/a\.ts:3 /);
  });

  describe('a change to the final newline', () => {
    const LAST = 'const ok = 1;\nconst old = "#fff";'; // the old violation is the last line
    const commit = (text) => { put('src/a.ts', text); git(dir, 'add', 'src/a.ts'); git(dir, 'commit', '-qm', 'old'); };

    it('dropping it does not re-lint the last line', () => {
      commit(`${LAST}\n`);
      put('src/a.ts', LAST);
      assert.strictEqual(warning(edit(dir, 'src/a.ts')), '');
      git(dir, 'add', 'src/a.ts');
      assert.strictEqual(run(dir, ['--staged']).status, 0);
    });
    it('adding it does not re-lint the last line', () => {
      commit(LAST);
      put('src/a.ts', `${LAST}\n`);
      assert.strictEqual(warning(edit(dir, 'src/a.ts')), '');
      git(dir, 'add', 'src/a.ts');
      assert.strictEqual(run(dir, ['--staged']).status, 0);
    });
    it('a real edit to the last line is still linted', () => {
      commit(LAST);
      put('src/a.ts', 'const ok = 1;\nconst old = "#abc";\n');
      assert.match(warning(edit(dir, 'src/a.ts')), /src\/a\.ts:2 /);
    });
    it('a line inserted before the last as it drops is linted; the last is not', () => {
      commit(`${LAST}\n`);
      put('src/a.ts', 'const ok = 1;\nconst c = "#abcdef";\nconst old = "#fff";');
      const w = warning(edit(dir, 'src/a.ts'));
      assert.match(w, /src\/a\.ts:2 /);
      assert.doesNotMatch(w, /src\/a\.ts:3 /);
    });
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
    assert.match(warning(r), /app\/src\/a\.ts:3 /);
  });
});

// v3.3.2: the edit hook lints the lines THIS edit added, read from the
// payload, so an earlier uncommitted violation isn't re-reported on every
// unrelated edit.
describe('the lines this edit added', () => {
  // File-tool paths arrive absolute; git reports /private/var for /var on macOS.
  const put = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  const hook = (payload) => spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', ...payload }), cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8',
  });
  const STALE = 'const old = "#fff";\n'; // uncommitted, from an earlier edit
  const editOf = (old_string, new_string, extra = {}) =>
    ({ tool_name: 'Edit', tool_input: { file_path: join(realpathSync(dir), 'src/a.ts'), old_string, new_string, ...extra } });
  beforeEach(() => { put('src/a.ts', 'const ok = 1;\n'); git(dir, 'add', 'src/a.ts'); git(dir, 'commit', '-qm', 'clean'); });

  it('an Edit that adds a clean line passes, though the file holds an uncommitted violation', () => {
    put('src/a.ts', `const ok = 1;\n${STALE}const two = 2;\n`);
    assert.strictEqual(warning(hook(editOf('const old = "#fff";\n', 'const old = "#fff";\nconst two = 2;\n'))), '');
    // The pre-v3.3.2 hook diffed against HEAD, and re-reported the stale line.
    assert.match(warning(hook({ tool_input: { file_path: join(realpathSync(dir), 'src/a.ts') } })), /src\/a\.ts:2 /);
  });

  it('an Edit that adds a violation is flagged at its line, not the stale one', () => {
    put('src/a.ts', `const ok = 1;\n${STALE}const c = "#abcdef";\n`);
    const w = warning(hook(editOf('const ok = 1;\nconst old = "#fff";\n', 'const ok = 1;\nconst old = "#fff";\nconst c = "#abcdef";\n')));
    assert.match(w, /src\/a\.ts:3 /);
    assert.doesNotMatch(w, /src\/a\.ts:2 /);
    assert.match(w, /lines this edit added/);
  });

  it('an Edit inside a line re-lints that line only', () => {
    put('src/a.ts', `const ok = 1;\n${STALE}const c = "#abc"; const d = 4;\n`);
    const w = warning(hook(editOf('d = 3', 'd = 4')));
    assert.match(w, /src\/a\.ts:3 /);
    assert.doesNotMatch(w, /src\/a\.ts:2 /);
  });

  it('replace_all and MultiEdit edits are each undone', () => {
    put('src/a.ts', `const ok = 1;\n${STALE}const x = "#abc";\nconst x = "#abc";\n`);
    const w = warning(hook(editOf('const y = 0;', 'const x = "#abc";', { replace_all: true })));
    assert.match(w, /src\/a\.ts:3 /);
    assert.match(w, /src\/a\.ts:4 /);
    assert.doesNotMatch(w, /src\/a\.ts:2 /);
    const m = warning(hook({ tool_name: 'MultiEdit', tool_input: { file_path: join(realpathSync(dir), 'src/a.ts'), edits: [
      { old_string: 'const y = 1;', new_string: 'const x = "#abc";' }, { old_string: 'const z = 1;', new_string: 'const ok = 1;' },
    ] } }));
    assert.match(m, /src\/a\.ts:3 /);
    assert.doesNotMatch(m, /src\/a\.ts:2 /);
  });

  it('a Write is diffed against originalFile when the response has it, else HEAD', () => {
    const content = `const ok = 1;\n${STALE}const c = "#abcdef";\n`;
    put('src/a.ts', content);
    const write = (tool_response) => warning(hook({ tool_name: 'Write', tool_input: { file_path: join(realpathSync(dir), 'src/a.ts'), content }, tool_response }));
    const w = write({ type: 'update', originalFile: `const ok = 1;\n${STALE}` });
    assert.match(w, /src\/a\.ts:3 /);
    assert.doesNotMatch(w, /src\/a\.ts:2 /);
    const head = write({ type: 'update' });
    assert.match(head, /src\/a\.ts:2 /);
    assert.match(head, /src\/a\.ts:3 /);
  });

  it('a Write that creates a file lints it whole', () => {
    put('src/b.ts', 'const b = "#fff";\n');
    const w = warning(hook({ tool_name: 'Write', tool_input: { file_path: join(realpathSync(dir), 'src/b.ts'), content: 'const b = "#fff";\n' }, tool_response: { type: 'create' } }));
    assert.match(w, /src\/b\.ts:1 /);
  });

  it('Cursor afterFileEdit edits are read too; it still exits 2', () => {
    put('src/a.ts', `const ok = 1;\n${STALE}const two = 2;\n`);
    const clean = hook({ hook_event_name: 'afterFileEdit', file_path: 'src/a.ts', edits: [{ old_string: '', new_string: 'const two = 2;\n' }] });
    // An insertion with an empty old_string: undone, nothing new but `two`.
    assert.strictEqual(clean.status, 0, clean.stderr);
    put('src/a.ts', `const ok = 1;\n${STALE}const c = "#abc";\n`);
    const r = hook({ hook_event_name: 'afterFileEdit', file_path: 'src/a.ts', edits: [{ old_string: 'const two = 2;', new_string: 'const c = "#abc";' }] });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /src\/a\.ts:3 /);
    assert.doesNotMatch(r.stderr, /src\/a\.ts:2 /);
  });
});

describe('ssdd-lint-ignore', () => {
  it('a marked line passes --staged; an unmarked one in the same change still blocks', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'const brand = "#ff0000"; // ssdd-lint-ignore: the logo colour\n');
    git(dir, 'add', 'src/a.ts');
    const staged = () => spawnSync(NODE, [HOOK, '--staged'], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
    assert.strictEqual(staged().status, 0, staged().stderr);
    writeFileSync(join(dir, 'src', 'a.ts'), 'const brand = "#ff0000"; // ssdd-lint-ignore: the logo colour\nconst c = "#abc";\n');
    git(dir, 'add', 'src/a.ts');
    const r = staged();
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/a\.ts:2 /);
    assert.doesNotMatch(r.stderr, /src\/a\.ts:1 /);
    assert.match(r.stderr, /ssdd-lint-ignore/);
  });
});

describe('the example hex-colour rule', () => {
  const rule = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'config.example.json'), 'utf8')).lint
    .find((r) => r.name === 'no-hardcoded-hex-colors');
  const re = new RegExp(rule.pattern);
  it('matches a colour in code', () => {
    for (const l of ['const c = "#fff";', "const c = '#abcdef';", 'color: #333,', 'border: "1px solid #ccc"', 'bg: "#ff000080"']) assert.ok(re.test(l), l);
  });
  it('skips comments and issue references', () => {
    for (const l of ['// fixes #1234', 'const x = 1; // see #123, #fff', ' * TODO(#4521) #abc', '/* #fff */', 'const s = "see #1234";', 'a&#123;']) assert.ok(!re.test(l), l);
  });
});
