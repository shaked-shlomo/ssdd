// Regression tests for the SSDD review gate. Each case builds a scratch git
// repo with its own .ssdd/config.json, stages files, and runs the gate the way
// git and Claude Code do: `--pre-commit` (exit 1 = blocked, 0 = passed) and
// stdin PreToolUse mode (exit 2 = blocked). The stamp file lives inside the
// scratch repo's .git, so cases never see each other.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 22.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

// v3.1: a reviewer's stamp names the blob it saw, so a re-review is handed
// the change since then instead of the whole file.
describe('the delta since the last stamp', () => {
  const deltaUnder = (stderr, name) =>
    new RegExp(`• ${name} — owes[^\\n]*:\\n\\s+src\\/a\\.ts[^\\n]*\\n\\s+review the change: (git diff \\S+ \\S+)`).exec(stderr)?.[1];
  const diffBody = (d, cmd) =>
    git(d, ...cmd.split(' ').slice(1)).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  const setKey = (d, reviewer, path, key) => {
    const s = readStamp(d);
    s.reviewers[reviewer][path].key = key;
    writeFileSync(stampFile(d), JSON.stringify(s));
  };

  it('after a full stamp, an edit gives git diff <stamped> <staged>, which prints exactly the edit', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    write(dir, 'src/a.ts', 'a\nb\n');
    const { status, stderr } = preCommit(dir);
    assert.strictEqual(status, 1);
    const a = deltaUnder(stderr, 'alpha');
    assert.ok(a, stderr);
    assert.strictEqual(deltaUnder(stderr, 'beta'), a);
    assert.deepStrictEqual(diffBody(dir, a), ['+b']);
    assert.match(stderr, /that diff is its input/);
    assert.doesNotMatch(stderr, /base moved/);
  });
  it('the delta names the full blob ids', () => {
    write(dir, 'src/a.ts', 'a\n');
    const was = git(dir, 'rev-parse', ':src/a.ts').trim();
    stamp(dir, 'alpha,beta');
    write(dir, 'src/a.ts', 'a\nb\n');
    const now = git(dir, 'rev-parse', ':src/a.ts').trim();
    assert.match(was, /^[0-9a-f]{40}$/);
    assert.strictEqual(deltaUnder(preCommit(dir).stderr, 'alpha'), `git diff ${was} ${now}`);
  });
  it('hooks mode gives the same delta line', () => {
    const d = makeRepo({ ...CONFIG, reviewGate: { stamping: 'hooks' } });
    try {
      write(d, 'src/a.ts', 'a\n');
      stamp(d, 'alpha,beta');
      write(d, 'src/a.ts', 'a\nb\n');
      const { stderr } = preCommit(d);
      assert.deepStrictEqual(diffBody(d, deltaUnder(stderr, 'alpha')), ['+b']);
      assert.match(stderr, /Dispatch each owing reviewer/);
      assert.match(stderr, /that diff is its input/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('no delta for a never-stamped file or a deletion', () => {
    write(dir, 'src/a.ts', 'a\n');
    assert.doesNotMatch(preCommit(dir).stderr, /git diff /);
    git(dir, 'commit', '-qm', 'land a');
    write(dir, 'src/a.ts', 'a2\n');
    stamp(dir, 'alpha,beta');
    git(dir, 'rm', '-qf', 'src/a.ts');
    const { status, stderr } = preCommit(dir);
    assert.strictEqual(status, 1);
    assert.doesNotMatch(stderr, /git diff /);
  });
  it('a stamped blob that is gone owes the whole change', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    setKey(dir, 'alpha', 'src/a.ts', `000000:${'0'.repeat(40)}→100644:${'1'.repeat(40)}`);
    const { status, stderr } = preCommit(dir);
    assert.strictEqual(status, 1);
    assert.match(stderr, /• alpha — owes[^\n]*:\n\s+src\/a\.ts[^\n]*\n\s+its stamped blob is gone: review the whole change/);
    assert.doesNotMatch(stderr, /git diff /);
  });
  it('a moved base is named', () => {
    write(dir, 'src/a.ts', 'base\n');
    git(dir, 'commit', '-qm', 'base');
    write(dir, 'src/a.ts', 'base\nx\n');
    stamp(dir, 'alpha,beta');
    git(dir, 'reset', '-q');
    write(dir, 'src/a.ts', 'base2\n');
    git(dir, 'commit', '-qm', 'base2');
    write(dir, 'src/a.ts', 'base2\nx\n');
    const { stderr } = preCommit(dir);
    assert.match(stderr, /review the change: git diff \S+ \S+ \(its base moved too\)/);
  });
  it('a stamped change that was then committed is not a moved base', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    git(dir, 'commit', '-qm', 'land a');
    write(dir, 'src/a.ts', 'a\nb\n');
    const { stderr } = preCommit(dir);
    assert.deepStrictEqual(diffBody(dir, deltaUnder(stderr, 'alpha')), ['+b']);
    assert.doesNotMatch(stderr, /base moved/);
  });
  it('a hand-edited key builds no delta and does not throw', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    setKey(dir, 'alpha', 'src/a.ts', 'garbage');
    const { status, stderr } = preCommit(dir);
    assert.strictEqual(status, 1);
    assert.match(stderr, /\(was garbage\)/);
    assert.doesNotMatch(stderr, /git diff /);
  });
  it('after the re-stamp the key names the new blob', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    write(dir, 'src/a.ts', 'a\nb\n');
    stamp(dir, 'alpha');
    const blob = git(dir, 'ls-files', '-s', 'src/a.ts').split(/\s+/)[1];
    assert.ok(readStamp(dir).reviewers.alpha['src/a.ts'].key.endsWith(`:${blob}`));
  });
});

// v3.1: --check answers "what's owed?" without a probe commit.
describe('--check', () => {
  const check = (d, extra = [], opts = {}) => run(d, ['--check', ...extra], opts);
  it('prints the owed list and exits 1', () => {
    write(dir, 'src/a.ts', 'a\n');
    const r = check(dir);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stdout, /• alpha/);
    assert.match(r.stdout, /• beta/);
  });
  it('prints nothing owed and exits 0', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    const r = check(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /nothing owed/);
  });
  it('writes nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    stamp(dir, 'alpha');
    const before = [readFileSync(stampFile(dir)), readFileSync(join(dir, '.git', 'index'))];
    assert.strictEqual(check(dir).status, 1);
    stamp(dir, 'beta');
    const mid = [readFileSync(stampFile(dir)), readFileSync(join(dir, '.git', 'index'))];
    assert.strictEqual(check(dir).status, 0);
    assert.ok(readFileSync(stampFile(dir)).equals(mid[0]));
    assert.ok(readFileSync(join(dir, '.git', 'index')).equals(mid[1]));
    assert.ok(!before[0].equals(mid[0]), 'the second stamp changed the file, so the comparison has teeth');
  });
  it('--repo works from another directory', () => {
    write(dir, 'src/a.ts', 'a\n');
    const elsewhere = mkdtempSync(join(tmpdir(), 'ssdd-check-cwd-'));
    try {
      const r = spawnSync(NODE, [HOOK, '--check', '--repo', dir], { cwd: elsewhere, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', SSDD_PROJECT_DIR: '' } });
      assert.strictEqual(r.status, 1, r.stderr);
      assert.match(r.stdout, /• alpha/);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
  it('outside an SSDD repo it exits 0; a broken config exits 1', () => {
    const bare = makeRepo(null);
    try {
      const r = check(bare);
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /not gated/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
    writeFileSync(join(dir, '.ssdd', 'config.json'), '{ nope');
    const b = check(dir);
    assert.strictEqual(b.status, 1);
    assert.match(b.stderr, /not valid JSON/);
  });
  it('the block message names --check', () => {
    write(dir, 'src/a.ts', 'a\n');
    assert.match(preCommit(dir).stderr, /review-gate\.mjs --check/);
  });
});

// v3.1: during a stopped merge of the default branch, a staged path equal to
// git's own merge of the two sides was reviewed on its way in; only
// resolutions and edits owe. Merging anything else is judged in full.
describe('merges', () => {
  // base: a.ts (3 lines) and b.ts on main; main then edits a.ts line 1 and
  // b.ts, and branch feat edits a.ts line 1 too, so `git merge main` on feat
  // stops on a.ts and merges b.ts cleanly.
  function conflictedMerge(d, from = 'main') {
    git(d, 'branch', '-M', 'main');
    write(d, 'src/a.ts', 'a1\na2\na3\n');
    write(d, 'src/b.ts', 'b\n');
    git(d, 'commit', '-qm', 'base');
    git(d, 'branch', 'feat');
    git(d, 'branch', 'side');
    for (const b of from === 'main' ? ['main'] : ['side']) {
      git(d, 'checkout', '-q', b);
      write(d, 'src/a.ts', 'upstream\na2\na3\n');
      write(d, 'src/b.ts', 'b upstream\n');
      git(d, 'commit', '-qm', 'upstream');
    }
    git(d, 'checkout', '-q', 'feat');
    write(d, 'src/a.ts', 'feat\na2\na3\n');
    git(d, 'commit', '-qm', 'feat');
    const m = spawnSync('git', ['-C', d, 'merge', '-q', from], { encoding: 'utf8' });
    assert.strictEqual(m.status, 1, 'the merge stops on the conflict');
  }
  const resolveA = (d) => write(d, 'src/a.ts', 'both\na2\na3\n');
  const owesB = (text) => /src\/b\.ts/.test(text.replace(/^ {2}merge:.*$/m, ''));

  it('a path equal to git\'s merge of the default branch owes nothing', () => {
    conflictedMerge(dir);
    resolveA(dir);
    const { status, stderr } = preCommit(dir);
    assert.strictEqual(status, 1);
    assert.match(stderr, /• beta[^\n]*\n\s+src\/a\.ts/);
    assert.ok(!owesB(stderr), stderr);
    assert.match(stderr, /merge: 1 staged path\(s\) match git's own merge with [0-9a-f]{7} — owed by no one/);
  });
  it('the harness hook and --check apply it too', () => {
    conflictedMerge(dir);
    resolveA(dir);
    const h = hook(dir, 'git commit -m m');
    assert.strictEqual(h.status, 2);
    assert.ok(!owesB(h.stderr), h.stderr);
    const c = run(dir, ['--check']);
    assert.strictEqual(c.status, 1);
    assert.match(c.stdout, /src\/a\.ts/);
    assert.ok(!owesB(c.stdout), c.stdout);
  });
  it('an edit made during the merge is owed', () => {
    conflictedMerge(dir);
    resolveA(dir);
    write(dir, 'src/b.ts', 'b edited\n');
    assert.ok(owesB(preCommit(dir).stderr));
  });
  it('--stamp --files on a merge-clean path says it is owed by no one, writing nothing', () => {
    conflictedMerge(dir);
    resolveA(dir);
    const r = stamp(dir, 'beta', 'src/b.ts');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/b\.ts — matches git's own merge with [0-9a-f]{7}, so it is owed by no one/);
    assert.doesNotMatch(r.stderr, /not staged, or not routed/);
    const both = stamp(dir, 'beta', 'src/b.ts,src/nope.ts');
    assert.strictEqual(both.status, 1);
    assert.match(both.stderr, /src\/b\.ts — matches git's own merge/);
    assert.match(both.stderr, /src\/nope\.ts — not staged, or not routed to beta/);
    assert.throws(() => readStamp(dir));
  });
  it('once the resolution is stamped, the merge commits', () => {
    conflictedMerge(dir);
    resolveA(dir);
    assert.strictEqual(stamp(dir, 'alpha,beta').status, 0);
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('merging a branch that is not on the default branch is judged in full', () => {
    conflictedMerge(dir, 'side');
    resolveA(dir);
    const { stderr } = preCommit(dir);
    assert.ok(owesB(stderr), stderr);
    assert.doesNotMatch(stderr, /merge: /);
  });
  it('merging a commit no ref holds (git stash create) is judged in full', () => {
    git(dir, 'branch', '-M', 'main');
    write(dir, 'src/a.ts', 'a\n');
    git(dir, 'commit', '-qm', 'base');
    write(dir, 'src/b.ts', 'unreviewed\n');
    const dangling = git(dir, 'stash', 'create').trim();
    git(dir, 'reset', '-q', '--hard');
    assert.strictEqual(spawnSync('git', ['-C', dir, 'merge', '-q', '--no-commit', '--no-ff', dangling], { encoding: 'utf8' }).status, 0);
    assert.ok(owesB(preCommit(dir).stderr));
  });
  it('an octopus merge is judged as today', () => {
    conflictedMerge(dir);
    resolveA(dir);
    const mh = join(dir, '.git', 'MERGE_HEAD');
    writeFileSync(mh, readFileSync(mh, 'utf8') + git(dir, 'rev-parse', 'HEAD~1'));
    assert.ok(owesB(preCommit(dir).stderr));
  });
  it('a git without merge-tree --write-tree is judged as today', () => {
    conflictedMerge(dir);
    resolveA(dir);
    const shim = mkdtempSync(join(tmpdir(), 'ssdd-oldgit-'));
    try {
      const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      writeFileSync(join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = merge-tree ] && { echo "usage: git merge-tree" >&2; exit 129; }; done\nexec "${real}" "$@"\n`);
      chmodSync(join(shim, 'git'), 0o755);
      const { status, stderr } = preCommit(dir, { PATH: `${shim}:${process.env.PATH}` });
      assert.strictEqual(status, 1);
      assert.ok(owesB(stderr), stderr);
      assert.doesNotMatch(stderr, /merge: /);
    } finally {
      rmSync(shim, { recursive: true, force: true });
    }
  });
  it('--check mid-conflict lists the conflicted path', () => {
    conflictedMerge(dir);
    const c = run(dir, ['--check']);
    assert.strictEqual(c.status, 1, c.stderr);
    assert.match(c.stdout, /src\/a\.ts/);
    assert.doesNotMatch(c.stderr, /Error/);
  });
  it('in a linked worktree', () => {
    git(dir, 'branch', '-M', 'main');
    write(dir, 'src/a.ts', 'a1\na2\na3\n');
    write(dir, 'src/b.ts', 'b\n');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'branch', 'feat');
    write(dir, 'src/a.ts', 'upstream\na2\na3\n');
    write(dir, 'src/b.ts', 'b upstream\n');
    git(dir, 'commit', '-qm', 'upstream');
    const wt = mkdtempSync(join(tmpdir(), 'ssdd-merge-wt-'));
    const w = join(wt, 'w');
    try {
      git(dir, 'worktree', 'add', '-q', w, 'feat');
      write(w, 'src/a.ts', 'feat\na2\na3\n');
      git(w, 'commit', '-qm', 'feat');
      assert.strictEqual(spawnSync('git', ['-C', w, 'merge', '-q', 'main'], { encoding: 'utf8' }).status, 1);
      mkdirSync(join(w, '.ssdd'), { recursive: true });
      writeFileSync(join(w, '.ssdd', 'config.json'), JSON.stringify(CONFIG));
      write(w, 'src/a.ts', 'both\na2\na3\n');
      const { status, stderr } = preCommit(w);
      assert.strictEqual(status, 1);
      assert.match(stderr, /src\/a\.ts/);
      assert.ok(!owesB(stderr), stderr);
    } finally {
      git(dir, 'worktree', 'remove', '--force', w);
      rmSync(wt, { recursive: true, force: true });
    }
  });
  it('a merge of origin/main counts, though local main is behind', () => {
    const origin = makeRepo();
    try {
      git(origin, 'branch', '-M', 'main');
      write(origin, 'src/b.ts', 'b\n');
      git(origin, 'commit', '-qm', 'base');
      git(dir, 'remote', 'add', 'origin', origin);
      git(dir, 'fetch', '-q', 'origin');
      git(dir, 'checkout', '-qb', 'feat', 'origin/main');
      git(dir, 'remote', 'set-head', 'origin', 'main');
      write(dir, 'src/a.ts', 'feat\n');
      git(dir, 'commit', '-qm', 'feat');
      write(origin, 'src/b.ts', 'b upstream\n');
      git(origin, 'commit', '-qm', 'upstream');
      git(dir, 'fetch', '-q', 'origin');
      assert.strictEqual(spawnSync('git', ['-C', dir, 'merge', '-q', '--no-commit', '--no-ff', 'origin/main'], { encoding: 'utf8' }).status, 0);
      const { status, stderr } = preCommit(dir);
      assert.strictEqual(status, 0, stderr);
    } finally {
      rmSync(origin, { recursive: true, force: true });
    }
  });
  it('--check names the merge when nothing is owed', () => {
    git(dir, 'branch', '-M', 'main');
    git(dir, 'branch', 'feat');
    write(dir, 'src/b.ts', 'b\n');
    git(dir, 'commit', '-qm', 'main');
    git(dir, 'checkout', '-q', 'feat');
    write(dir, 'docs/feat.md', 'f\n');
    git(dir, 'commit', '-qm', 'feat');
    assert.strictEqual(spawnSync('git', ['-C', dir, 'merge', '-q', '--no-commit', '--no-ff', 'main'], { encoding: 'utf8' }).status, 0);
    const c = run(dir, ['--check']);
    assert.strictEqual(c.status, 0, c.stdout + c.stderr);
    assert.match(c.stdout, /nothing owed/);
    assert.match(c.stdout, /merge: 1 staged path\(s\) match git's own merge with [0-9a-f]{7} — owed by no one/);
  });
  it('the oversize warning doesn\'t count merged paths', () => {
    const d = makeRepo({ ...CONFIG, reviewGate: { maxRoutedFiles: 1 } });
    try {
      git(d, 'branch', '-M', 'main');
      git(d, 'branch', 'feat');
      for (const f of ['x', 'y', 'z']) write(d, `src/${f}.ts`, `${f}\n`);
      git(d, 'commit', '-qm', 'main');
      git(d, 'checkout', '-q', 'feat');
      write(d, 'docs/feat.md', 'f\n');
      git(d, 'commit', '-qm', 'feat');
      assert.strictEqual(spawnSync('git', ['-C', d, 'merge', '-q', '--no-commit', '--no-ff', 'main'], { encoding: 'utf8' }).status, 0);
      const { status, stderr } = preCommit(d);
      assert.strictEqual(status, 0, stderr);
      assert.doesNotMatch(stderr, /WARNING/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
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
    assert.doesNotMatch(h.stderr, /Fix the JSON/);
    assert.match(JSON.parse(h.stdout).userMessage, /\.ssdd\/config\.json can't be used/);
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

  it('an absolute path to another directory\'s pre-commit (a worktree on the main checkout\'s) is not dormant', () => {
    armable(dir);
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'ssdd-main-')));
    try {
      armable(other);
      write(dir, 'src/a.ts', 'a\n');
      git(dir, 'config', 'core.hooksPath', join(other, '.githooks'));
      const r = hook(dir, 'git commit -m x');
      assert.strictEqual(r.status, 2);
      assert.doesNotMatch(r.stderr, /dormant/);
    } finally { rmSync(other, { recursive: true, force: true }); }
  });

  it('a repo without .githooks/pre-commit gets no note', () => {
    write(dir, 'src/a.ts', 'a\n');
    assert.doesNotMatch(hook(dir, 'git commit -m x').stderr, /dormant/);
  });
});

// The portable hook: mechanisms/hooks/pre-commit in the source tree,
// .githooks/pre-commit in an installed repo (.ssdd/hooks/ is two levels down).
const PRE_COMMIT = [join(dirname(HOOK), 'pre-commit'), join(dirname(HOOK), '..', '..', '.githooks', 'pre-commit')].find((p) => existsSync(p));

// Arm the portable hook the way install does: pre-commit in .githooks/, the
// hook scripts in .ssdd/hooks/, core.hooksPath pointing at it.
function armPreCommit(d) {
  const here = dirname(HOOK);
  mkdirSync(join(d, '.githooks'));
  writeFileSync(join(d, '.githooks', 'pre-commit'), readFileSync(PRE_COMMIT, 'utf8'));
  chmodSync(join(d, '.githooks', 'pre-commit'), 0o755);
  mkdirSync(join(d, '.ssdd', 'hooks'));
  for (const f of readdirSync(here)) {
    if (f.endsWith('.mjs') && !f.endsWith('.selftest.mjs')) copyFileSync(join(here, f), join(d, '.ssdd', 'hooks', f));
  }
  writeFileSync(join(d, '.git', 'info', 'exclude'), '.githooks/\n.ssdd/hooks/\n');
  git(d, 'config', 'core.hooksPath', '.githooks');
  git(d, 'add', '.ssdd/config.json');
}

describe('the pre-commit layer is the backstop for shell hand-offs', () => {
  it("`bash -c 'git commit -m x'` is not unwrapped by the harness hook, and git's own hook refuses it", { skip: !PRE_COMMIT }, () => {
    armPreCommit(dir);
    write(dir, 'src/a.ts', 'a\n');
    const head = git(dir, 'rev-parse', 'HEAD');

    // The harness hook does not see inside the shell string.
    assert.strictEqual(hook(dir, "bash -c 'git commit -m x'").status, 0);

    // Run for real, the commit is refused by git's pre-commit.
    const r = spawnSync('bash', ['-c', 'git commit -m x'], { cwd: dir, encoding: 'utf8', env: { ...process.env, SSDD_REVIEW_SKIP: '' } });
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, /alpha/);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), head);
  });
});

describe('the pre-commit runs every step', () => {
  it('a lint finding does not hide what the review gate owes', { skip: !PRE_COMMIT }, () => {
    writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify({
      ...CONFIG, lint: [{ name: 'no-todo', pattern: 'TODO', message: 'no TODOs', include: '^src/' }],
    }));
    armPreCommit(dir);
    write(dir, 'src/a.ts', 'TODO\n');
    const head = git(dir, 'rev-parse', 'HEAD');
    const r = spawnSync('git', ['commit', '-m', 'x'], { cwd: dir, encoding: 'utf8', env: { ...process.env, SSDD_REVIEW_SKIP: '' } });
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, /\[ssdd-convention-lint\] 1 finding/);
    assert.match(r.stderr, /alpha/);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), head);
  });
});

// v3.3.2: the seeded config sends a typical source file to one or two
// reviewers, not five, and test files to none.
describe('the example config routes narrowly', () => {
  const EXAMPLE = join(dirname(HOOK), '..', 'config.example.json');
  const owed = (path) => {
    const d = makeRepo(JSON.parse(readFileSync(EXAMPLE, 'utf8')));
    try {
      write(d, path, 'x\n');
      return [...run(d, ['--check']).stdout.matchAll(/^ {2}• ([\w-]+)/gm)].map((m) => m[1]).sort();
    } finally { rmSync(d, { recursive: true, force: true }); }
  };
  it('a component or store goes to one or two reviewers', () => {
    assert.deepEqual(owed('src/components/Button.tsx'), ['convention-compliance-reviewer', 'performance-reviewer']);
    assert.deepEqual(owed('src/stores/cart.ts'), ['convention-compliance-reviewer', 'resilience-reviewer']);
    assert.deepEqual(owed('src/utils/format.ts'), ['convention-compliance-reviewer']);
  });
  it('a service adds security only; docs-sync and performance stay out', () => {
    assert.deepEqual(owed('src/services/api.ts'), ['convention-compliance-reviewer', 'resilience-reviewer', 'security-reviewer']);
  });
  it('test files route nowhere', () => {
    assert.deepEqual(owed('src/services/api.test.ts'), []);
    assert.deepEqual(owed('src/components/__tests__/Button.tsx'), []);
  });
});
