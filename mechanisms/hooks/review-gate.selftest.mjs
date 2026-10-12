// Regression tests for the SSDD review gate. Each case builds a scratch git
// repo with its own .ssdd/config.json, stages files, and runs the gate the way
// git and Claude Code do: `--pre-commit` (exit 1 = blocked, 0 = passed) and
// stdin PreToolUse mode (exit 2 = blocked). The stamp file lives inside the
// scratch repo's .git, so cases never see each other.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 18.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'review-gate.mjs');
const NODE = process.execPath;

// alpha covers src/a.ts only; beta covers all of src/; docs/ routes nowhere.
const CONFIG = {
  routing: [
    { reviewer: 'alpha', paths: ['^src/a\\.ts$'] },
    { reviewer: 'beta', paths: ['^src/'] },
  ],
};

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function makeRepo(config = CONFIG) {
  const dir = mkdtempSync(join(tmpdir(), 'ssdd-gate-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.fileMode', 'true');
  if (config) {
    mkdirSync(join(dir, '.ssdd'));
    writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify(config));
  }
  writeFileSync(join(dir, 'README'), 'base\n');
  git(dir, 'add', 'README');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  git(dir, 'add', path);
}

function run(dir, args, { input, env } = {}) {
  const r = spawnSync(NODE, [HOOK, ...args], {
    input: input ?? '',
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SSDD_REVIEW_SKIP: '', ...env },
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}
const preCommit = (dir, env) => run(dir, ['--pre-commit'], { env });
const hook = (dir, command, env) =>
  run(dir, [], { input: JSON.stringify({ tool_input: { command } }), env });
const cursorHook = (dir, command, env) =>
  run(dir, [], {
    input: JSON.stringify({ command, hook_event_name: 'beforeShellExecution' }),
    env,
  });
const stamp = (dir, reviewers, files) =>
  run(dir, ['--stamp', reviewers, ...(files ? ['--files', files] : [])]);
const stampFile = (dir) => join(dir, '.git', 'ssdd-review-stamp.json');
const readStamp = (dir) => JSON.parse(readFileSync(stampFile(dir), 'utf8'));

let dir;
beforeEach(() => { dir = makeRepo(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('modes', () => {
  it('passes a clean index', () => {
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('passes when only unrouted files are staged', () => {
    write(dir, 'docs/x.md', 'x\n');
    assert.strictEqual(preCommit(dir).status, 0);
    assert.strictEqual(hook(dir, 'git commit -m x').status, 0);
  });
  it('blocks an unstamped routed file: exit 1 in --pre-commit, exit 2 under PreToolUse', () => {
    write(dir, 'src/a.ts', 'a\n');
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /alpha/);
    assert.match(pc.stderr, /beta/);
    assert.strictEqual(hook(dir, 'git commit -m x').status, 2);
    assert.strictEqual(cursorHook(dir, 'git commit -m x').status, 2);
  });
  it('ignores a non-commit command under PreToolUse', () => {
    write(dir, 'src/a.ts', 'a\n');
    assert.strictEqual(hook(dir, 'git status').status, 0);
    assert.strictEqual(hook(dir, 'git commit -m x').status, 2);
  });
  it('a commit MESSAGE mentioning the bypass token does not bypass', () => {
    write(dir, 'src/a.ts', 'a\n');
    assert.strictEqual(hook(dir, 'git commit -m "set SSDD_REVIEW_SKIP=1 never"').status, 2);
  });
  it('SSDD_REVIEW_SKIP=1 bypasses with the banner, in both modes', () => {
    write(dir, 'src/a.ts', 'a\n');
    const pc = preCommit(dir, { SSDD_REVIEW_SKIP: '1' });
    assert.strictEqual(pc.status, 0);
    assert.match(pc.stderr, /bypassed via SSDD_REVIEW_SKIP=1/);
    const h = hook(dir, 'SSDD_REVIEW_SKIP=1 git commit -m x');
    assert.strictEqual(h.status, 0);
    assert.match(h.stderr, /bypassed via SSDD_REVIEW_SKIP=1/);
  });
  it('a repo without .ssdd/config.json is disarmed', () => {
    const bare = makeRepo(null);
    try {
      write(bare, 'src/a.ts', 'a\n');
      assert.strictEqual(preCommit(bare).status, 0);
      assert.strictEqual(hook(bare, 'git commit -m x').status, 0);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('stamps are per reviewer, per routed file', () => {
  it('a full stamp unblocks the commit', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    assert.strictEqual(stamp(dir, 'alpha,beta').status, 0);
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('editing an unrouted staged file leaves every routed stamp valid', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'docs/x.md', 'v1\n');
    stamp(dir, 'alpha,beta');
    write(dir, 'docs/x.md', 'v2 — the ledger row that used to void everything\n');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('adding a NEW unrouted file after the stamp also leaves it valid', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    write(dir, '.ssdd/ledgers/01-demo-ledger.md', 'row\n');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a fix to one file re-blocks only the reviewers routed to it, and only for it', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    stamp(dir, 'alpha,beta');
    write(dir, 'src/b.ts', 'b2\n');
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /beta/);
    assert.doesNotMatch(pc.stderr, /alpha/);
    // Re-stamping beta on b alone is enough: a is still covered by the old stamp.
    assert.strictEqual(stamp(dir, 'beta', 'src/b.ts').status, 0);
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a changed routed file never passes on an old stamp', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    write(dir, 'src/a.ts', 'a2\n');
    assert.strictEqual(preCommit(dir).status, 1);
  });
  it('a re-stage that changes nothing textually keeps the stamp', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    git(dir, 'reset', '-q');
    write(dir, 'src/a.ts', 'a\n');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('deleting a stamped file is a change', () => {
    write(dir, 'src/a.ts', 'a\n');
    git(dir, 'commit', '-qm', 'land a');
    write(dir, 'src/a.ts', 'a2\n');
    stamp(dir, 'alpha,beta');
    git(dir, 'rm', '-qf', 'src/a.ts');
    assert.strictEqual(preCommit(dir).status, 1);
  });
  it('a mode-only change (chmod +x) is a change, and the message shows the modes', () => {
    write(dir, 'src/a.ts', 'a\n');
    git(dir, 'commit', '-qm', 'land a');
    chmodSync(join(dir, 'src', 'a.ts'), 0o755);
    git(dir, 'add', 'src/a.ts');
    stamp(dir, 'alpha,beta');
    assert.strictEqual(preCommit(dir).status, 0);
    chmodSync(join(dir, 'src', 'a.ts'), 0o644);
    git(dir, 'add', 'src/a.ts');
    // Back to the base mode: nothing is staged for a.ts at all, so nothing is owed…
    assert.strictEqual(preCommit(dir).status, 0);
    // …and a content edit on top shows the previous mode-only key with its modes.
    write(dir, 'src/a.ts', 'a2\n');
    const { status, stderr } = preCommit(dir);
    assert.strictEqual(status, 1);
    assert.match(stderr, /was 100644:[0-9a-f]{7}→100755:[0-9a-f]{7}/);
  });
  it('a mode-only change on a stamped file is a change', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    chmodSync(join(dir, 'src', 'a.ts'), 0o755);
    git(dir, 'add', 'src/a.ts');
    assert.strictEqual(preCommit(dir).status, 1);
  });
  it('a stamp on the same content against a DIFFERENT base does not carry', () => {
    write(dir, 'src/a.ts', 'a2\n');
    stamp(dir, 'alpha,beta');
    // Land a different a.ts underneath, then stage the same a2 blob on top of it.
    git(dir, 'reset', '-q');
    write(dir, 'src/a.ts', 'a1\n');
    git(dir, 'commit', '-qm', 'a1');
    write(dir, 'src/a.ts', 'a2\n');
    assert.strictEqual(preCommit(dir).status, 1);
  });
  it('a corrupt (non-JSON) stamp file counts as no stamp, without crashing', () => {
    write(dir, 'src/a.ts', 'a\n');
    writeFileSync(stampFile(dir), '{"version": 2, "reviewers": {');
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /never stamped on this diff/);
    assert.strictEqual(hook(dir, 'git commit -m x').status, 2);
  });
  it('a malformed key in a stamp file is echoed, not thrown on — the gate stays closed', () => {
    write(dir, 'src/a.ts', 'a\n');
    writeFileSync(stampFile(dir), JSON.stringify({
      version: 2, reviewers: { alpha: { 'src/a.ts': { key: 'garbage', at: 'x' } }, beta: { 'src/a.ts': { key: 42 } } },
    }));
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /src\/a\.ts\s+changed since its last stamp \(was garbage\)/);
    assert.match(pc.stderr, /\(was 42\)/);
    const h = hook(dir, 'git commit -m x');
    assert.strictEqual(h.status, 2);
    assert.match(h.stderr, /was garbage/);
  });
  it('a version-1 stamp file (whole-diff hash) counts as no stamp', () => {
    write(dir, 'src/a.ts', 'a\n');
    writeFileSync(stampFile(dir), JSON.stringify({ reviewers: { alpha: 'deadbeef', beta: 'deadbeef' } }));
    assert.strictEqual(preCommit(dir).status, 1);
  });
  it('a stamp names the reviewer, the file and the per-file key', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha');
    const s = readStamp(dir);
    assert.strictEqual(s.version, 2);
    assert.deepStrictEqual(Object.keys(s.reviewers), ['alpha']);
    assert.deepStrictEqual(Object.keys(s.reviewers.alpha), ['src/a.ts']);
    assert.match(s.reviewers.alpha['src/a.ts'].key, /^\d{6}:0{40}→\d{6}:[0-9a-f]{40}$/);
  });
  it('paths with spaces round-trip', () => {
    write(dir, 'src/sp ace.ts', 'a\n');
    assert.strictEqual(stamp(dir, 'beta').status, 0);
    assert.deepStrictEqual(Object.keys(readStamp(dir).reviewers.beta), ['src/sp ace.ts']);
    assert.strictEqual(preCommit(dir).status, 0);
  });
});

describe('--stamp --files', () => {
  it('stamps only the named files; the rest stay owed', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    assert.strictEqual(stamp(dir, 'beta', 'src/b.ts').status, 0);
    assert.deepStrictEqual(Object.keys(readStamp(dir).reviewers.beta), ['src/b.ts']);
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /alpha/);
    assert.match(pc.stderr, /beta/);
  });
  it('refuses a file not routed to the named reviewer, writing nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    const r = stamp(dir, 'alpha', 'src/b.ts');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/b\.ts/);
    assert.throws(() => readStamp(dir));
  });
  it('refuses a file that is not staged, writing nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    const r = stamp(dir, 'beta', 'src/nope.ts');
    assert.strictEqual(r.status, 1);
    assert.throws(() => readStamp(dir));
  });
  it('refuses an unrouted file, writing nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'docs/x.md', 'x\n');
    assert.strictEqual(stamp(dir, 'beta', 'docs/x.md').status, 1);
    assert.throws(() => readStamp(dir));
  });
  it('refuses a known reviewer that has no routed staged file, writing nothing', () => {
    write(dir, 'src/b.ts', 'b\n');
    const r = stamp(dir, 'beta,alpha'); // alpha covers src/a.ts only
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /no staged file routes to alpha/);
    assert.throws(() => readStamp(dir));
  });
  it('refuses a reviewer name the routing table does not know, writing nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    const r = stamp(dir, 'alpha,gamma');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /gamma/);
    assert.throws(() => readStamp(dir));
  });
  it('--files without a reviewer list is a usage error, writing nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    const r = run(dir, ['--stamp', '--files', 'src/a.ts']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /usage/);
    assert.throws(() => readStamp(dir));
  });
  it('one refused file in a multi-reviewer stamp writes nothing for anyone', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    assert.strictEqual(stamp(dir, 'beta,alpha', 'src/b.ts').status, 1);
    assert.throws(() => readStamp(dir));
  });
});

describe('the block message names the delta', () => {
  it('after a full stamp, one changed file is named under its reviewers with "changed since"', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    stamp(dir, 'alpha,beta');
    write(dir, 'src/b.ts', 'b2\n');
    const { stderr } = preCommit(dir);
    assert.match(stderr, /• beta — owes 1 of 2 routed file\(s\):\n\s+src\/b\.ts\s+changed since its last stamp/);
    assert.doesNotMatch(stderr, /src\/a\.ts/);
    assert.doesNotMatch(stderr, /never stamped/);
  });
  it('a reviewer with no stamp at all is headed "never stamped on this diff" and lists every file', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    stamp(dir, 'alpha');
    const { stderr } = preCommit(dir);
    assert.match(stderr, /• beta — never stamped on this diff \(2 routed file\(s\)\):\n\s+src\/a\.ts\n\s+src\/b\.ts/);
    assert.doesNotMatch(stderr, /• alpha/);
  });
  it('a file added after a partial stamp is "never stamped" under a reviewer that owes only it', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    write(dir, 'src/c.ts', 'c\n');
    const { stderr } = preCommit(dir);
    assert.match(stderr, /• beta — owes 1 of 2 routed file\(s\):\n\s+src\/c\.ts\s+never stamped/);
    assert.doesNotMatch(stderr, /• alpha/);
  });
  it('lists the unrouted staged files once, as context', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'docs/x.md', 'x\n');
    write(dir, '.ssdd/ledgers/01-demo-ledger.md', 'l\n');
    const { stderr } = preCommit(dir);
    assert.match(stderr, /also staged, routed to no reviewer: \.ssdd\/ledgers\/01-demo-ledger\.md, docs\/x\.md/);
  });
  it('PreToolUse mode prints the same delta and warning on stderr with exit 2', () => {
    const d = makeRepo({ ...CONFIG, reviewGate: { maxRoutedFiles: 1 } });
    try {
      write(d, 'src/a.ts', 'a\n');
      write(d, 'src/b.ts', 'b\n');
      stamp(d, 'alpha,beta');
      write(d, 'src/b.ts', 'b2\n');
      const h = hook(d, 'git commit -m x');
      assert.strictEqual(h.status, 2);
      assert.match(h.stderr, /WARNING: 2 routed file\(s\) staged \(limit 1\)/);
      assert.match(h.stderr, /• beta — owes 1 of 2 routed file\(s\):\n\s+src\/b\.ts\s+changed since its last stamp/);
      assert.doesNotMatch(h.stderr, /• alpha/);
      const out = JSON.parse(h.stdout);
      assert.strictEqual(out.permission, 'deny');
      assert.match(out.agentMessage, /• beta — owes 1 of 2/);
      assert.strictEqual(out.agent_message, out.agentMessage);
      assert.strictEqual(out.user_message, out.userMessage);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('Cursor payload cwd is the git root when CLAUDE_PROJECT_DIR is unset', () => {
    const host = makeRepo();
    try {
      write(dir, 'src/a.ts', 'a\n');
      const env = { ...process.env, SSDD_REVIEW_SKIP: '' };
      delete env.CLAUDE_PROJECT_DIR;
      delete env.SSDD_PROJECT_DIR;
      const h = spawnSync(NODE, [HOOK], {
        input: JSON.stringify({
          command: 'git commit -m x',
          hook_event_name: 'beforeShellExecution',
          cwd: dir,
        }),
        cwd: host,
        env,
        encoding: 'utf8',
      });
      assert.strictEqual(h.status, 2);
      assert.match(h.stderr, /alpha/);
      const out = JSON.parse(h.stdout);
      assert.strictEqual(out.permission, 'deny');
      assert.strictEqual(out.agent_message, out.agentMessage);
    } finally {
      rmSync(host, { recursive: true, force: true });
    }
  });
  it('the payload cwd wins over CLAUDE_PROJECT_DIR (the Bash call runs there)', () => {
    // v2.0 judged CLAUDE_PROJECT_DIR's index, so a commit run from another
    // work tree was checked against the wrong (often empty) index.
    const dirty = makeRepo();
    try {
      write(dirty, 'src/a.ts', 'a\n');
      const h = run(dir, [], {
        input: JSON.stringify({
          tool_input: { command: 'git commit -m x' },
          cwd: dirty,
        }),
      });
      assert.strictEqual(h.status, 2);
      assert.match(h.stderr, /--repo /);
    } finally {
      rmSync(dirty, { recursive: true, force: true });
    }
  });
  it('the --stamp command it prints names exactly the owing reviewers', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    stamp(dir, 'alpha');
    assert.match(preCommit(dir).stderr, /--stamp beta\b/);
    assert.doesNotMatch(preCommit(dir).stderr, /--stamp alpha/);
  });
});

describe('the oversize warning', () => {
  const routed = (n) => { for (let i = 0; i < n; i++) write(dir, `src/f${i}.ts`, `${i}\n`); };
  const WARN = /WARNING: (\d+) routed file\(s\) staged \(limit (\d+)\)[^]*SDD\.md §4/;
  it('fires above the configured limit and cites SDD.md §4, before the reviewer list', () => {
    const d = makeRepo({ ...CONFIG, reviewGate: { maxRoutedFiles: 2 } });
    try {
      for (let i = 0; i < 3; i++) write(d, `src/f${i}.ts`, `${i}\n`);
      const { status, stderr } = preCommit(d);
      assert.strictEqual(status, 1);
      assert.match(stderr, WARN);
      assert.deepStrictEqual(stderr.match(WARN).slice(1), ['3', '2']);
      assert.ok(
        stderr.indexOf('WARNING') < stderr.indexOf('• beta'),
        `expected the WARNING before the reviewer list:\n${stderr}`,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('does not fire AT the limit', () => {
    const d = makeRepo({ ...CONFIG, reviewGate: { maxRoutedFiles: 2 } });
    try {
      for (let i = 0; i < 2; i++) write(d, `src/f${i}.ts`, `${i}\n`);
      assert.doesNotMatch(preCommit(d).stderr, /WARNING/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('defaults to 10 routed files when config.json has no reviewGate block', () => {
    routed(10);
    assert.doesNotMatch(preCommit(dir).stderr, /WARNING/);
    write(dir, 'src/f10.ts', '10\n');
    assert.match(preCommit(dir).stderr, /WARNING: 11 routed file\(s\) staged \(limit 10\)/);
  });
  it('counts routed files only — unrouted files in the same commit are the per-task rule working', () => {
    const d = makeRepo({ ...CONFIG, reviewGate: { maxRoutedFiles: 2 } });
    try {
      for (let i = 0; i < 2; i++) write(d, `src/f${i}.ts`, `${i}\n`);
      for (let i = 0; i < 5; i++) write(d, `docs/d${i}.md`, `${i}\n`);
      assert.doesNotMatch(preCommit(d).stderr, /WARNING/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('is a warning, not a block: a fully stamped oversize diff passes, warning on stderr', () => {
    routed(11);
    assert.strictEqual(stamp(dir, 'beta').status, 0);
    const { status, stderr } = preCommit(dir);
    assert.strictEqual(status, 0);
    assert.match(stderr, WARN);
  });
  it('is printed by --stamp too, the moment the orchestrator acts on the diff', () => {
    routed(11);
    const r = stamp(dir, 'beta');
    assert.strictEqual(r.status, 0);
    assert.match(r.stderr, WARN);
  });
});

// The gate judges a commit by the working-tree config.
describe('the config a commit is judged by', () => {
  const cfgPath = (d) => join(d, '.ssdd', 'config.json');
  const setConfig = (d, body) => writeFileSync(cfgPath(d), typeof body === 'string' ? body : JSON.stringify(body));
  const commitConfig = (d, body) => {
    setConfig(d, body);
    git(d, 'add', '.ssdd/config.json');
    git(d, 'commit', '-qm', 'config');
  };

  it('a broken config blocks every mode, with the parse error', () => {
    commitConfig(dir, CONFIG);
    setConfig(dir, '{ "routing": [');
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /\.ssdd\/config\.json is not valid JSON/);
    const h = hook(dir, 'git commit -m x');
    assert.strictEqual(h.status, 2);
    assert.match(h.stderr, /not valid JSON/);
    write(dir, 'src/a.ts', 'a\n');
    const s = stamp(dir, 'alpha');
    assert.strictEqual(s.status, 1);
    assert.match(s.stderr, /not valid JSON/);
  });

  it('an unstaged route edit applies to the next commit', () => {
    commitConfig(dir, CONFIG);
    setConfig(dir, { routing: [{ reviewer: 'beta', paths: ['^src/'] }] });
    write(dir, 'src/a.ts', 'a\n');
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /beta/);
    assert.doesNotMatch(pc.stderr, /alpha/);
  });

  it('HEAD\'s routes stop applying once the working-tree config drops them', () => {
    commitConfig(dir, CONFIG);
    setConfig(dir, { routing: [] });
    write(dir, 'src/a.ts', 'a\n');
    assert.strictEqual(preCommit(dir).status, 0);
    assert.strictEqual(hook(dir, 'git commit -m x').status, 0);
  });
});

describe('dormant pre-commit hook', () => {
  const armable = (d) => {
    mkdirSync(join(d, '.githooks'), { recursive: true });
    writeFileSync(join(d, '.githooks', 'pre-commit'), '#!/bin/sh\n');
  };
  const NOTE = /pre-commit hook is dormant in this repo \(core\.hooksPath is unset\)[\s\S]*git config core\.hooksPath \.githooks/;

  it('a blocked and an allowed commit both carry the note while core.hooksPath is unset', () => {
    armable(dir);
    write(dir, 'docs/x.md', 'x\n');
    const ok = hook(dir, 'git commit -m x');
    assert.strictEqual(ok.status, 0);
    assert.match(ok.stderr, NOTE);
    assert.match(JSON.parse(ok.stdout).hookSpecificOutput.additionalContext, NOTE);
    write(dir, 'src/a.ts', 'a\n');
    const blocked = hook(dir, 'git commit -m x');
    assert.strictEqual(blocked.status, 2);
    assert.match(blocked.stderr, NOTE);
  });

  it('names a wrong value, and is silent once it points at .githooks', () => {
    armable(dir);
    write(dir, 'src/a.ts', 'a\n');
    git(dir, 'config', 'core.hooksPath', '.git/hooks');
    assert.match(hook(dir, 'git commit -m x').stderr, /core\.hooksPath is "\.git\/hooks"/);
    git(dir, 'config', 'core.hooksPath', '.githooks/');
    assert.doesNotMatch(hook(dir, 'git commit -m x').stderr, /dormant/);
    write(dir, 'src/a.ts', 'b\n');
    git(dir, 'config', 'core.hooksPath', join(dir, '.githooks'));
    const r = hook(dir, 'git commit -m x');
    assert.strictEqual(r.status, 2);
    assert.doesNotMatch(r.stderr, /dormant/);
  });

  it('a repo without .githooks/pre-commit gets no note', () => {
    write(dir, 'src/a.ts', 'a\n');
    assert.doesNotMatch(hook(dir, 'git commit -m x').stderr, /dormant/);
  });
});

describe('the pre-commit layer is the backstop for shell hand-offs', () => {
  it("`bash -c 'git commit -m x'` is not unwrapped by the harness hook, and git's own hook refuses it", () => {
    // Arm the portable hook the way install does: pre-commit in .githooks/,
    // the hook scripts in .ssdd/hooks/, core.hooksPath pointing at it.
    const here = dirname(HOOK);
    mkdirSync(join(dir, '.githooks'));
    writeFileSync(join(dir, '.githooks', 'pre-commit'), readFileSync(join(here, 'pre-commit'), 'utf8'));
    chmodSync(join(dir, '.githooks', 'pre-commit'), 0o755);
    mkdirSync(join(dir, '.ssdd', 'hooks'));
    for (const f of readdirSync(here)) {
      if (f.endsWith('.mjs') && !f.endsWith('.selftest.mjs')) copyFileSync(join(here, f), join(dir, '.ssdd', 'hooks', f));
    }
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '.githooks/\n.ssdd/hooks/\n');
    git(dir, 'config', 'core.hooksPath', '.githooks');
    git(dir, 'add', '.ssdd/config.json'); // the hook refuses while anything is untracked
    write(dir, 'src/a.ts', 'a\n');
    const head = git(dir, 'rev-parse', 'HEAD');

    // The harness hook does not see inside the shell string.
    assert.strictEqual(hook(dir, "bash -c 'git commit -m x'").status, 0);

    // Run for real, the commit is refused by git's pre-commit.
    const r = spawnSync('bash', ['-c', 'git commit -m x'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, /alpha/);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), head);
  });
});
