// Regression tests for the SSDD review gate. Each case builds a scratch git
// repo with its own .ssdd/config.json, stages files, and runs the gate the way
// git does: `--pre-commit` (exit 1 = blocked, 0 = passed), plus `--stamp` and
// `--check`. The pre-commit is the only gate; with no mode the script is
// inert. The stamp file lives inside the scratch repo's .git, so cases never
// see each other.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 22.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
  });
  it('blocks an unstamped routed file with exit 1', () => {
    write(dir, 'src/a.ts', 'a\n');
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /alpha/);
    assert.match(pc.stderr, /beta/);
  });
  it('SSDD_REVIEW_SKIP=1 bypasses with the banner', () => {
    write(dir, 'src/a.ts', 'a\n');
    const pc = preCommit(dir, { SSDD_REVIEW_SKIP: '1' });
    assert.strictEqual(pc.status, 0);
    assert.match(pc.stderr, /bypassed via SSDD_REVIEW_SKIP=1/);
  });
  it('a repo without .ssdd/config.json is disarmed', () => {
    const bare = makeRepo(null);
    try {
      write(bare, 'src/a.ts', 'a\n');
      assert.strictEqual(preCommit(bare).status, 0);
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
  it('refuses a file that is not changed, writing nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    const r = stamp(dir, 'beta', 'src/nope.ts');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/nope\.ts — not changed, or not routed to beta/);
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
    assert.match(r.stderr, /no changed file routes to alpha/);
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

// A reviewer can stamp before `git add`: --stamp keys the work tree through a
// scratch index, so the keys are the ones `git add` would stage.
describe('--stamp before git add', () => {
  const put = (d, path, content) => {
    mkdirSync(dirname(join(d, path)), { recursive: true });
    writeFileSync(join(d, path), content);
  };
  const commit = (d, msg = 'c') => git(d, 'commit', '-qm', msg);
  const scratchLeft = (d) => readdirSync(git(d, 'rev-parse', '--absolute-git-dir').trim()).filter((f) => f.startsWith('ssdd-stamp-index'));

  it('an unstaged edit is stamped; adding it commits with no new stamp', () => {
    write(dir, 'src/a.ts', 'a\n');
    commit(dir);
    put(dir, 'src/a.ts', 'a edited\n');
    const before = readFileSync(join(dir, '.git', 'index'));
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.deepStrictEqual(readFileSync(join(dir, '.git', 'index')), before); // the real index is untouched
    assert.deepStrictEqual(scratchLeft(dir), []);
    git(dir, 'add', 'src/a.ts');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a staged edit reverted in the work tree is not stamped; the commit stays owed', () => {
    write(dir, 'src/a.ts', 'good\n');
    commit(dir);
    write(dir, 'src/a.ts', 'EVIL\n'); // staged
    put(dir, 'src/a.ts', 'good\n'); // work tree back to what HEAD holds
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 1, s.stderr);
    assert.throws(() => readStamp(dir));
    assert.strictEqual(preCommit(dir).status, 1);
  });
  it('a staged new file deleted from the work tree is not stamped; the commit stays owed', () => {
    write(dir, 'src/b.ts', 'b\n'); // staged
    rmSync(join(dir, 'src', 'b.ts'));
    const s = stamp(dir, 'beta');
    assert.strictEqual(s.status, 1, s.stderr);
    assert.throws(() => readStamp(dir));
    assert.strictEqual(preCommit(dir).status, 1);
  });
  it('stat-dirty tracked files do not make --stamp rewrite the real index', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    commit(dir);
    const later = Date.now() / 1000 + 100;
    for (const f of ['src/a.ts', 'src/b.ts']) utimesSync(join(dir, f), later, later); // content unchanged
    put(dir, 'src/c.ts', 'c\n');
    const before = readFileSync(join(dir, '.git', 'index'));
    const s = stamp(dir, 'beta', 'src/c.ts');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.deepStrictEqual(readFileSync(join(dir, '.git', 'index')), before);
  });
  it('paths are literal pathspecs: a glob-named file does not drag in other files', () => {
    const cfg = { routing: [{ reviewer: 'beta', paths: ['^src/'], exclude: [String.raw`\.gen\.ts$`] }] };
    const r = makeRepo(cfg);
    try {
      put(r, 'src/*.ts', 'star\n'); // routed; as a glob it would match every .ts under src/
      put(r, 'src/z.gen.ts', 'only a glob would stage this\n'); // excluded: not on the path list
      const s = stamp(r, 'beta');
      assert.strictEqual(s.status, 0, s.stderr);
      assert.deepStrictEqual(Object.keys(readStamp(r).reviewers.beta), ['src/*.ts']);
      const blob = git(r, 'hash-object', 'src/z.gen.ts').trim();
      assert.throws(() => git(r, 'cat-file', '-e', blob)); // the scratch add never hashed it
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  });
  it('an untracked routed file is stamped', () => {
    put(dir, 'src/a.ts', 'new\n');
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 0, s.stderr);
    git(dir, 'add', 'src/a.ts');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a deletion not yet staged is stamped', () => {
    write(dir, 'src/a.ts', 'a\n');
    commit(dir);
    rmSync(join(dir, 'src', 'a.ts'));
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 0, s.stderr);
    git(dir, 'rm', '-q', '--cached', 'src/a.ts');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  // A staged deletion's path is in neither the index nor the work tree, so a
  // scratch `add` of it is fatal; the copied index already records it.
  const NONE = `000000:${'0'.repeat(40)}`;
  const keyOf = (d, name, f) => readStamp(d).reviewers[name][f].key;
  it('a staged deletion (git rm) is stamped, and commits', () => {
    write(dir, 'src/a.ts', 'a\n');
    commit(dir);
    git(dir, 'rm', '-q', 'src/a.ts');
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.match(keyOf(dir, 'alpha', 'src/a.ts'), new RegExp(`→${NONE}$`));
    assert.deepStrictEqual(scratchLeft(dir), []);
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a staged rename (git mv) is stamped as D + A, and commits', () => {
    write(dir, 'src/b.ts', 'b\n');
    commit(dir);
    git(dir, 'mv', 'src/b.ts', 'src/c.ts');
    const s = stamp(dir, 'beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.match(keyOf(dir, 'beta', 'src/b.ts'), new RegExp(`^100644:[0-9a-f]{40}→${NONE}$`));
    assert.match(keyOf(dir, 'beta', 'src/c.ts'), new RegExp(`^${NONE}→100644:[0-9a-f]{40}$`));
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('git rm --cached of a file now ignored is stamped as a deletion, and commits', () => {
    write(dir, 'src/b.ts', 'b\n');
    commit(dir);
    write(dir, '.gitignore', 'src/b.ts\n');
    git(dir, 'rm', '-q', '--cached', 'src/b.ts');
    const s = stamp(dir, 'beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.match(keyOf(dir, 'beta', 'src/b.ts'), new RegExp(`→${NONE}$`));
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a case-only rename on a case-insensitive filesystem is stamped as D + A, and commits', (t) => {
    write(dir, 'src/B.ts', 'b\n');
    commit(dir);
    if (!existsSync(join(dir, 'src', 'b.ts'))) return t.skip('case-sensitive filesystem');
    git(dir, 'mv', 'src/B.ts', 'src/b.ts');
    const s = stamp(dir, 'beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.match(keyOf(dir, 'beta', 'src/B.ts'), new RegExp(`→${NONE}$`));
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('an edit and a git rm in one commit are both stamped, and commit', () => {
    write(dir, 'src/a.ts', 'a\n');
    write(dir, 'src/b.ts', 'b\n');
    commit(dir);
    write(dir, 'src/a.ts', 'a edited\n');
    git(dir, 'rm', '-q', 'src/b.ts');
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.deepStrictEqual(Object.keys(readStamp(dir).reviewers.beta).sort(), ['src/a.ts', 'src/b.ts']);
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a git failure in the scratch index exits 1 with git\'s message and one line, no stack, nothing left', () => {
    // A required clean filter that fails: nothing before the scratch `add` runs filters.
    git(dir, 'config', 'filter.boom.clean', 'false');
    git(dir, 'config', 'filter.boom.required', 'true');
    put(dir, '.gitattributes', 'src/*.ts filter=boom\n');
    put(dir, 'src/a.ts', 'a\n');
    const before = readFileSync(join(dir, '.git', 'index'));
    const s = stamp(dir, 'alpha');
    assert.strictEqual(s.status, 1, s.stderr);
    assert.strictEqual(s.stderr.match(/^fatal: .*boom/gm)?.length, 1, s.stderr); // git's own, once
    assert.strictEqual(s.stderr.match(/^\[ssdd-review-gate\]/gm)?.length, 1, s.stderr);
    assert.doesNotMatch(s.stderr, /^\s+at /m);
    assert.throws(() => readStamp(dir));
    assert.deepStrictEqual(scratchLeft(dir), []);
    assert.deepStrictEqual(readFileSync(join(dir, '.git', 'index')), before);
  });
  it('symlink, exec bit and eol=lf key as git add does', () => {
    put(dir, '.gitattributes', '* text=auto eol=lf\n');
    write(dir, 'src/a.ts', 'a\n');
    git(dir, 'add', '.gitattributes');
    commit(dir);
    put(dir, 'src/c.ts', 'one\r\ntwo\r\n');
    put(dir, 'src/x.ts', 'x\n');
    chmodSync(join(dir, 'src', 'x.ts'), 0o755);
    symlinkSync('a.ts', join(dir, 'src', 'l.ts'));
    const s = stamp(dir, 'beta');
    assert.strictEqual(s.status, 0, s.stderr);
    git(dir, 'add', '-A');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('--files refuses an ignored, an unchanged and an unrouted file, writing nothing', () => {
    put(dir, '.gitignore', 'src/ignored.ts\n');
    write(dir, 'src/a.ts', 'a\n');
    git(dir, 'add', '.gitignore');
    commit(dir);
    put(dir, 'src/ignored.ts', 'i\n');
    put(dir, 'src/b.ts', 'b\n'); // changed and routed: the stamp is valid, the other files are not
    put(dir, 'docs/x.md', 'x\n');
    for (const f of ['src/ignored.ts', 'src/a.ts', 'docs/x.md']) {
      const r = stamp(dir, 'beta', f);
      assert.strictEqual(r.status, 1, f);
      assert.match(r.stderr, /not changed, or not routed to beta/, f);
      assert.throws(() => readStamp(dir), f);
    }
    assert.deepStrictEqual(scratchLeft(dir), []);
  });
  it('a file staged, then edited, is stamped on the work tree', () => {
    write(dir, 'src/a.ts', 'v1\n');
    put(dir, 'src/a.ts', 'v2\n');
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.match(s.stderr, /src\/a\.ts: stamped the work-tree copy; the staged copy differs/);
    assert.strictEqual(preCommit(dir).status, 1);
    git(dir, 'add', 'src/a.ts');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('a same-size edit in the instant of the stage is still keyed (the scratch copy must stay racy)', () => {
    // `v1` -> `v2`: same size, and the file's stat made equal to its index
    // entry's, with the index as old as the entry. Git rehashes such an entry
    // (racy-clean); a copy of the index with a newer mtime would trust the stat.
    git(dir, 'config', 'core.trustctime', 'false');
    const file = join(dir, 'src', 'a.ts');
    const t = Math.floor(Date.now() / 1000) - 5; // whole seconds: no sub-second part to differ
    put(dir, 'src/a.ts', 'v1\n');
    utimesSync(file, t, t);
    git(dir, 'add', 'src/a.ts');
    put(dir, 'src/a.ts', 'v2\n');
    utimesSync(file, t, t);
    utimesSync(join(dir, '.git', 'index'), t, t);
    const s = stamp(dir, 'alpha,beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.match(s.stderr, /src\/a\.ts: stamped the work-tree copy; the staged copy differs/);
  });
  it('--check and --pre-commit write nothing: the stamp file and the index stay byte-identical', () => {
    write(dir, 'src/a.ts', 'a\n');
    assert.strictEqual(stamp(dir, 'alpha,beta').status, 0);
    const files = [stampFile(dir), join(dir, '.git', 'index')];
    const snap = () => files.map((f) => readFileSync(f));
    const before = snap();
    run(dir, ['--check']);
    preCommit(dir);
    assert.deepStrictEqual(snap(), before);
  });
  it('paths with spaces and non-ASCII letters stamp and then commit', () => {
    put(dir, 'src/a b.ts', 'sp\n');
    put(dir, 'src/é.ts', 'e\n');
    const s = stamp(dir, 'beta');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.deepStrictEqual(Object.keys(readStamp(dir).reviewers.beta).sort(), ['src/a b.ts', 'src/é.ts']);
    git(dir, '-c', 'core.quotePath=false', 'add', '-A');
    assert.strictEqual(preCommit(dir).status, 0);
  });
  it('in a linked worktree, --stamp --repo <wt> keys the worktree\'s files', () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'ssdd-wt-parent-')));
    const wt = join(parent, 'wt');
    try {
      git(dir, 'worktree', 'add', '-q', wt, '-b', 'wt-branch');
      mkdirSync(join(wt, '.ssdd'));
      writeFileSync(join(wt, '.ssdd', 'config.json'), JSON.stringify(CONFIG));
      put(wt, 'src/a.ts', 'w\n');
      const mainIndex = readFileSync(join(dir, '.git', 'index'));
      const s = run(dir, ['--stamp', 'alpha,beta', '--repo', wt]);
      assert.strictEqual(s.status, 0, s.stderr);
      assert.deepStrictEqual(readFileSync(join(dir, '.git', 'index')), mainIndex);
      assert.deepStrictEqual(scratchLeft(wt), []);
      git(wt, 'add', 'src/a.ts');
      assert.strictEqual(preCommit(wt).status, 0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
  it('on an unborn branch, --stamp keys the first commit\'s files', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'ssdd-gate-unborn-'));
    try {
      git(fresh, 'init', '-q');
      mkdirSync(join(fresh, '.ssdd'));
      writeFileSync(join(fresh, '.ssdd', 'config.json'), JSON.stringify(CONFIG));
      put(fresh, 'src/a.ts', 'staged\n');
      git(fresh, 'add', 'src/a.ts');
      put(fresh, 'src/b.ts', 'untracked\n');
      const s = stamp(fresh, 'alpha,beta');
      assert.strictEqual(s.status, 0, s.stderr);
      assert.deepStrictEqual(scratchLeft(fresh), []);
      git(fresh, 'add', 'src/b.ts');
      assert.strictEqual(preCommit(fresh).status, 0);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

// Both reviewers cover src/lib/; alpha also covers the rest of src/ but not
// test files, and a stamp for both fits one file under src/lib/.
const LIB_CONFIG = {
  routing: [
    { reviewer: 'alpha', paths: ['^src/'], exclude: [String.raw`\.test\.ts$`] },
    { reviewer: 'beta', paths: ['^src/lib/'] },
  ],
};

describe('--repo', () => {
  it('--stamp --repo <r> from another directory unblocks that repo, and a restage voids it', () => {
    const r = makeRepo(LIB_CONFIG);
    const elsewhere = makeRepo();
    try {
      write(r, 'src/lib/a.ts', 'a\n');
      const s = run(elsewhere, ['--stamp', 'alpha,beta', '--repo', r]);
      assert.strictEqual(s.status, 0, s.stderr);
      assert.strictEqual(run(elsewhere, ['--check', '--repo', r]).status, 0);
      assert.strictEqual(preCommit(r).status, 0);
      write(r, 'src/lib/a.ts', 'changed\n');
      assert.strictEqual(preCommit(r).status, 1);
    } finally {
      for (const d of [r, elsewhere]) rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('a linked worktree', () => {
  let r; let parent; let wt;
  beforeEach(() => {
    r = makeRepo(LIB_CONFIG);
    parent = realpathSync(mkdtempSync(join(tmpdir(), 'ssdd-wt-parent-')));
    wt = join(parent, 'wt');
    git(r, 'worktree', 'add', '-q', wt, '-b', 'wt-branch');
    mkdirSync(join(wt, '.ssdd'));
    writeFileSync(join(wt, '.ssdd', 'config.json'), JSON.stringify(LIB_CONFIG));
    write(wt, 'src/lib/w.ts', 'w\n'); // staged ONLY in the worktree; the main checkout is clean
  });
  afterEach(() => { for (const d of [r, parent]) rmSync(d, { recursive: true, force: true }); });

  it('--pre-commit judges git\'s cwd, not a decoy in the env', () => {
    const pc = run(wt, ['--pre-commit'], { env: { SSDD_PROJECT_DIR: r, CLAUDE_PROJECT_DIR: r } });
    assert.strictEqual(pc.status, 1, pc.stderr);
    assert.match(pc.stderr, /src\/lib\/w\.ts/);
  });
  it('--stamp --repo <wt> from the main checkout unblocks the worktree', () => {
    const s = run(r, ['--stamp', 'alpha,beta', '--repo', wt]);
    assert.strictEqual(s.status, 0, s.stderr);
    assert.strictEqual(preCommit(wt).status, 0);
  });
});

describe('route exclude', () => {
  let r;
  beforeEach(() => { r = makeRepo(LIB_CONFIG); });
  afterEach(() => { rmSync(r, { recursive: true, force: true }); });

  it('a per-route exclude drops test files from that route', () => {
    write(r, 'src/x.test.ts', 'x\n');
    assert.strictEqual(preCommit(r).status, 0);
    const s = run(r, ['--stamp', 'alpha']);
    assert.strictEqual(s.status, 1);
    assert.match(s.stderr, /no changed file routes to alpha/);
  });
  it('an obsolete reviewGate.exclude is ignored', () => {
    const o = makeRepo({ reviewGate: { exclude: [String.raw`\.test\.ts$`] }, routing: [{ reviewer: 'alpha', paths: ['^src/'] }] });
    try {
      write(o, 'src/x.test.ts', 'x\n');
      const pc = preCommit(o);
      assert.strictEqual(pc.status, 1);
      assert.match(pc.stderr, /alpha/);
    } finally {
      rmSync(o, { recursive: true, force: true });
    }
  });
  it('everything else still routes', () => {
    write(r, 'src/z.ts', 'z\n');
    const pc = preCommit(r);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /alpha/);
    assert.doesNotMatch(pc.stderr, /beta/);
  });
});

describe('parallel --stamp', () => {
  it('runs both land', async () => {
    write(dir, 'src/a.ts', 'a\n');
    const go = (name) => new Promise((done) => {
      const c = spawn(NODE, [HOOK, '--stamp', name], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SSDD_REVIEW_SKIP: '' } });
      c.on('close', done);
    });
    await Promise.all([go('alpha'), go('beta')]);
    assert.deepStrictEqual(Object.keys(readStamp(dir).reviewers).sort(), ['alpha', 'beta']);
    assert.strictEqual(preCommit(dir).status, 0);
  });
});

describe('the triage note', () => {
  it('names a flagged file', () => {
    write(dir, 'src/a.ts', 'a\n');
    stamp(dir, 'alpha,beta');
    // Nothing in v3.6 writes `issues`: the test plays the writer.
    const s = readStamp(dir);
    s.reviewers.alpha['src/a.ts'].issues = 1;
    writeFileSync(stampFile(dir), JSON.stringify(s));
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 0, pc.stderr);
    assert.match(pc.stderr, /alpha reported 1 finding/);
  });
});

// v3.6 Decision 3: a reviewer's clean stamp holds over a comment-only edit;
// the comment reviewer still owes the file, with its delta.
describe('the comment-only carry', () => {
  const CARRY = {
    routing: [
      { reviewer: 'alpha', paths: ['^src/'] },
      { reviewer: 'docs-sync-reviewer', paths: ['^src/'] },
      { reviewer: 'beta', paths: ['^src/lib/'] },
    ],
  };
  const ALL = 'alpha,beta,docs-sync-reviewer';
  const V1 = '// greet the user\nexport const a = 1;\n';
  const V2 = '// greet the user by name\nexport const a = 1;\n';
  const CARRIED = /carried over a comment-only change: alpha, beta on src\/lib\/a\.ts/;
  const setConfig = (body) => writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify(body));
  const editStamp = (fn) => { const s = readStamp(dir); fn(s); writeFileSync(stampFile(dir), JSON.stringify(s)); };
  const check = () => run(dir, ['--check']);
  const owers = (out) => [...out.matchAll(/^ {2}• ([\w-]+)/gm)].map((m) => m[1]).sort();
  // Stage v1, stamp the reviewers on it, run `between`, stage v2: → --check.
  const edit = (path, v1, v2, between, who = ALL) => {
    write(dir, path, v1);
    const s = stamp(dir, who);
    assert.strictEqual(s.status, 0, s.stderr);
    between?.();
    write(dir, path, v2);
    return check();
  };
  const owes = (r, expected) => {
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.deepStrictEqual(owers(r.stdout), expected, r.stdout);
  };
  beforeEach(() => setConfig(CARRY));

  it('a comment-only edit keeps alpha\'s and beta\'s stamps; docs-sync owes it with a delta', () => {
    write(dir, 'src/lib/a.ts', V1);
    const was = git(dir, 'rev-parse', ':src/lib/a.ts').trim();
    assert.strictEqual(stamp(dir, ALL).status, 0);
    write(dir, 'src/lib/a.ts', V2);
    const now = git(dir, 'rev-parse', ':src/lib/a.ts').trim();
    const r = check();
    owes(r, ['docs-sync-reviewer']);
    assert.match(r.stdout, new RegExp(`• docs-sync-reviewer — owes[^\\n]*:\\n\\s+src/lib/a\\.ts[^\\n]*\\n\\s+review the change: git diff ${was} ${now}\\n`));
    assert.strictEqual(stamp(dir, 'docs-sync-reviewer').status, 0);
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 0, pc.stderr);
    assert.match(pc.stderr, CARRIED);
    const ok = check();
    assert.strictEqual(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, CARRIED);
  });

  describe('no carry: alpha owes', () => {
    it('a code edit', () => {
      owes(edit('src/lib/a.ts', V1, '// greet the user\nexport const a = 2;\n'), ['alpha', 'beta', 'docs-sync-reviewer']);
    });
    it('an edit to `// eslint-disable-next-line`', () => {
      const r = edit('src/lib/a.ts', '// eslint-disable-next-line no-console\nconsole.log(1);\n',
        '// eslint-disable-next-line no-alert\nconsole.log(1);\n');
      owes(r, ['alpha', 'beta', 'docs-sync-reviewer']);
    });
    it('the same comment edit in a .py file', () => {
      owes(edit('src/x.py', V1, V2, null, 'alpha,docs-sync-reviewer'), ['alpha', 'docs-sync-reviewer']);
    });
    it('the stamped blob pruned', () => {
      const r = edit('src/lib/a.ts', V1, V2, () => editStamp((s) => {
        s.reviewers.alpha['src/lib/a.ts'].key = s.reviewers.alpha['src/lib/a.ts'].key.replace(/[0-9a-f]{40}$/, 'ab'.repeat(20));
      }));
      owes(r, ['alpha', 'docs-sync-reviewer']); // beta's stamp still carries
      assert.match(r.stdout, /its stamped blob is gone/);
    });
    it('HEAD\'s side changed', () => {
      write(dir, 'src/lib/a.ts', 'export const a = 1;\n');
      git(dir, 'commit', '-qm', 'a');
      const r = edit('src/lib/a.ts', V1, V2, () => {
        git(dir, 'reset', '-q');
        write(dir, 'src/lib/a.ts', 'export const a = 1;\nexport const b = 2;\n');
        git(dir, 'commit', '-qm', 'another change');
      });
      owes(r, ['alpha', 'beta', 'docs-sync-reviewer']);
    });
    it('a mode change plus the comment edit', () => {
      const r = edit('src/lib/a.ts', V1, V2, () => chmodSync(join(dir, 'src', 'lib', 'a.ts'), 0o755));
      assert.match(git(dir, 'ls-files', '-s', 'src/lib/a.ts'), /^100755 /);
      owes(r, ['alpha', 'beta', 'docs-sync-reviewer']);
    });
    for (const issues of [1, '2']) {
      it(`an entry with issues: ${JSON.stringify(issues)}`, () => {
        const r = edit('src/lib/a.ts', V1, V2, () => editStamp((s) => { s.reviewers.alpha['src/lib/a.ts'].issues = issues; }));
        owes(r, ['alpha', 'docs-sync-reviewer']);
      });
    }
    it('a comment edit in a .js file that also holds an invalid UTF-8 byte', () => {
      const js = (comment) => Buffer.concat([Buffer.from(`// ${comment}\nexport const s = "`), Buffer.from([0xff]), Buffer.from('";\n')]);
      owes(edit('src/lib/a.js', js('greet'), js('greet them')), ['alpha', 'beta', 'docs-sync-reviewer']);
    });
    it('a symlink retarget that reads as a comment edit', () => {
      // `x//old.ts` → `x//new.ts` strips to `x` both times, as source would.
      const link = (target) => {
        mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
        rmSync(join(dir, 'src', 'lib', 'a.ts'), { force: true });
        symlinkSync(target, join(dir, 'src', 'lib', 'a.ts'));
        git(dir, 'add', 'src/lib/a.ts');
      };
      link('x//old.ts');
      assert.strictEqual(stamp(dir, ALL).status, 0);
      link('x//new.ts');
      assert.match(git(dir, 'ls-files', '-s', 'src/lib/a.ts'), /^120000 /);
      owes(check(), ['alpha', 'beta', 'docs-sync-reviewer']);
    });
    it('a comment reviewer routed elsewhere, not to the file', () => {
      setConfig({ routing: [CARRY.routing[0], { reviewer: 'docs-sync-reviewer', paths: ['^docs/'] }, CARRY.routing[2]] });
      owes(edit('src/lib/a.ts', V1, V2, null, 'alpha,beta'), ['alpha', 'beta']);
    });
    it('a config whose commentReviewer isn\'t routed to the file', () => {
      setConfig({ ...CARRY, reviewGate: { commentReviewer: 'nobody' } });
      owes(edit('src/lib/a.ts', V1, V2), ['alpha', 'beta', 'docs-sync-reviewer']);
    });
  });

  it('--check and --pre-commit leave the stamp file byte-identical', () => {
    write(dir, 'src/lib/a.ts', V1);
    stamp(dir, ALL);
    write(dir, 'src/lib/a.ts', V2);
    const files = [stampFile(dir), join(dir, '.git', 'index')];
    const snap = () => files.map((f) => readFileSync(f));
    let before = snap();
    assert.strictEqual(check().status, 1);
    assert.strictEqual(preCommit(dir).status, 1);
    assert.deepStrictEqual(snap(), before);
    stamp(dir, 'docs-sync-reviewer');
    before = snap();
    assert.match(check().stdout, CARRIED);
    assert.match(preCommit(dir).stderr, CARRIED);
    assert.deepStrictEqual(snap(), before);
  });

  it('on an unborn branch, a comment-only edit carries', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'ssdd-gate-unborn-'));
    try {
      git(fresh, 'init', '-q');
      mkdirSync(join(fresh, '.ssdd'));
      writeFileSync(join(fresh, '.ssdd', 'config.json'), JSON.stringify(CARRY));
      write(fresh, 'src/lib/a.ts', V1);
      assert.strictEqual(stamp(fresh, ALL).status, 0);
      write(fresh, 'src/lib/a.ts', V2);
      assert.match(readStamp(fresh).reviewers.alpha['src/lib/a.ts'].key, /^0{6}:0{40}→/);
      const r = run(fresh, ['--check']);
      assert.strictEqual(r.status, 1, r.stdout);
      assert.deepStrictEqual(owers(r.stdout), ['docs-sync-reviewer']);
      assert.strictEqual(stamp(fresh, 'docs-sync-reviewer').status, 0);
      const pc = preCommit(fresh);
      assert.strictEqual(pc.status, 0, pc.stderr);
      assert.match(pc.stderr, CARRIED);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
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
  it('--check applies it too', () => {
    conflictedMerge(dir);
    resolveA(dir);
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
    assert.doesNotMatch(r.stderr, /not changed, or not routed/);
    const both = stamp(dir, 'beta', 'src/b.ts,src/nope.ts');
    assert.strictEqual(both.status, 1);
    assert.match(both.stderr, /src\/b\.ts — matches git's own merge/);
    assert.match(both.stderr, /src\/nope\.ts — not changed, or not routed to beta/);
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

  it('a broken config blocks --pre-commit and --stamp, with the parse error', () => {
    commitConfig(dir, CONFIG);
    setConfig(dir, '{ "routing": [');
    const pc = preCommit(dir);
    assert.strictEqual(pc.status, 1);
    assert.match(pc.stderr, /\.ssdd\/config\.json is not valid JSON/);
    assert.doesNotMatch(pc.stderr, /Fix the JSON/);
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

describe('git judges what git commits', () => {
  // alpha alone, so one --stamp settles the commit.
  const ALPHA = { routing: [{ reviewer: 'alpha', paths: ['^src/a\\.ts$'] }] };
  const env = { ...process.env, SSDD_REVIEW_SKIP: '' };
  const sh = (cwd, file, args) => spawnSync(file, args, { cwd, encoding: 'utf8', env });
  let extra; // a worktree's parent directory, when a shape makes one
  afterEach(() => { if (extra) rmSync(extra, { recursive: true, force: true }); extra = null; });

  // Each shape: where git commits (`top`, as git spells it) and how the command runs.
  const topOf = (d) => git(d, 'rev-parse', '--show-toplevel').trim();
  const SHAPES = [
    ['commit -am x', (d) => ({ top: topOf(d), go: () => sh(d, 'git', ['commit', '-am', 'x']) })],
    ['commit -m x src/a.ts', (d) => ({ top: topOf(d), go: () => sh(d, 'git', ['commit', '-m', 'x', 'src/a.ts']) })],
    ['bash -c "git add src/a.ts && git commit -m x"', (d) => ({
      top: topOf(d), go: () => sh(d, 'bash', ['-c', 'git add src/a.ts && git commit -m x']),
    })],
    ['git -C <worktree> commit -m x, from the main checkout', (d) => {
      extra = realpathSync(mkdtempSync(join(tmpdir(), 'ssdd-wt-commit-')));
      const wt = join(extra, 'wt');
      git(d, 'worktree', 'add', '-q', wt, '-b', 'wt-commit');
      // core.hooksPath is relative, so the worktree finds its hooks in its own tree;
      // info/exclude is shared, and keeps them out of the index.
      cpSync(join(d, '.githooks'), join(wt, '.githooks'), { recursive: true });
      cpSync(join(d, '.ssdd'), join(wt, '.ssdd'), { recursive: true });
      write(wt, 'src/a.ts', 'a2\n');
      return { top: topOf(wt), go: () => sh(d, 'git', ['-C', wt, 'commit', '-m', 'x']) };
    }],
  ];

  for (const [name, make] of SHAPES) {
    it(`${name}: refused on what git commits, passes after --stamp`, { skip: !PRE_COMMIT }, () => {
      writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify(ALPHA));
      write(dir, 'src/a.ts', 'a1\n');
      git(dir, 'commit', '-qm', 'a1');
      armPreCommit(dir);
      writeFileSync(join(dir, 'src', 'a.ts'), 'a2\n'); // modified, not staged
      const { top, go } = make(dir);
      const head = git(top, 'rev-parse', 'HEAD');

      const blocked = go();
      assert.strictEqual(blocked.status, 1, blocked.stderr);
      assert.strictEqual(git(top, 'rev-parse', 'HEAD'), head);
      assert.match(blocked.stderr, /alpha/);
      assert.ok(blocked.stderr.includes(`--repo ${top}`), blocked.stderr);

      git(top, 'add', 'src/a.ts');
      const s = run(dir, ['--stamp', 'alpha', '--repo', top]);
      assert.strictEqual(s.status, 0, s.stderr);
      const landed = go();
      assert.strictEqual(landed.status, 0, landed.stderr);
      assert.notStrictEqual(git(top, 'rev-parse', 'HEAD'), head);
    });
  }

  it('SSDD_REVIEW_SKIP=1 git commit lands with the banner', { skip: !PRE_COMMIT }, () => {
    armPreCommit(dir);
    write(dir, 'src/a.ts', 'a\n');
    const head = git(dir, 'rev-parse', 'HEAD');
    const r = spawnSync('git', ['commit', '-m', 'x'], { cwd: dir, encoding: 'utf8', env: { ...process.env, SSDD_REVIEW_SKIP: '1' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /bypassed via SSDD_REVIEW_SKIP=1/);
    assert.notStrictEqual(git(dir, 'rev-parse', 'HEAD'), head);
  });
});

describe('stale wiring is harmless', () => {
  const noMode = (payload) => run(dir, [], { input: payload === '' ? '' : JSON.stringify(payload) });
  it('a Claude PreToolUse, SubagentStart and SubagentStop payload exit 0 and print nothing', () => {
    write(dir, 'src/a.ts', 'a\n');
    for (const payload of [
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: dir },
      { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'alpha', cwd: dir },
      { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'alpha', cwd: dir, last_assistant_message: 'CLEAN' },
      '',
    ]) {
      const r = noMode(payload);
      assert.deepStrictEqual([r.status, r.stdout, r.stderr], [0, '', ''], JSON.stringify(payload));
    }
    assert.throws(() => readStamp(dir), 'nothing stamped');
    assert.ok(!existsSync(join(dir, '.git', 'ssdd-review-dispatch')), 'nothing snapshotted');
  });
  it('a Cursor beforeShellExecution payload is allowed, so a failClosed entry cannot block shell calls', () => {
    write(dir, 'src/a.ts', 'a\n');
    const r = noMode({ command: 'git commit -m x', hook_event_name: 'beforeShellExecution', cwd: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), { permission: 'allow' });
  });
});

describe('a shell hand-off is judged by git\'s pre-commit', () => {
  it("`bash -c 'git commit -m x'` is refused by git's own hook", { skip: !PRE_COMMIT }, () => {
    armPreCommit(dir);
    write(dir, 'src/a.ts', 'a\n');
    const head = git(dir, 'rev-parse', 'HEAD');
    const r = spawnSync('bash', ['-c', 'git commit -m x'], { cwd: dir, encoding: 'utf8', env: { ...process.env, SSDD_REVIEW_SKIP: '' } });
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, /alpha/);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), head);
  });
});

describe('the pre-commit warns on lint findings', () => {
  it('a lint finding warns; the commit lands once the gate is met', { skip: !PRE_COMMIT }, () => {
    writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify({
      ...CONFIG, lint: [{ name: 'no-todo', pattern: 'TODO', message: 'no TODOs', include: '^src/' }],
    }));
    armPreCommit(dir);
    write(dir, 'src/a.ts', 'TODO\n');
    const head = git(dir, 'rev-parse', 'HEAD');
    const env = { ...process.env, SSDD_REVIEW_SKIP: '' };
    const refused = spawnSync('git', ['commit', '-m', 'x'], { cwd: dir, encoding: 'utf8', env });
    assert.strictEqual(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /\[ssdd-convention-lint\] 1 finding/);
    assert.match(refused.stderr, /alpha/);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), head);
    stamp(dir, 'alpha,beta');
    const r = spawnSync('git', ['commit', '-m', 'x'], { cwd: dir, encoding: 'utf8', env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /\[ssdd-convention-lint\] 1 finding/);
    assert.notStrictEqual(git(dir, 'rev-parse', 'HEAD'), head);
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
