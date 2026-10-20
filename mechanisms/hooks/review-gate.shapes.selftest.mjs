// v2.1 regression suite for the review gate's harness mode, ported from the
// source project's hardened hooks: commits whose content the hook can't see
// are refused, and the gate judges the repo a commit really targets (cd / -C /
// worktrees), failing closed when it can't tell. Every command-shape case runs
// as a Claude and a Cursor payload.
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'review-gate.mjs');
const CONFIG = {
  routing: [
    { reviewer: 'alpha', paths: ['^src/'], exclude: [String.raw`\.test\.ts$`] },
    { reviewer: 'beta', paths: ['^src/lib/'] },
  ],
  reviewGate: { exclude: ['^src/gen/'] },
};

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
function makeRepo(config = CONFIG) {
  const dir = tmp('ssdd-shape-');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.ssdd'));
  writeFileSync(join(dir, '.ssdd/config.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'README'), 'base\n');
  git(dir, 'add', 'README', '.ssdd/config.json');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}
function stage(dir, path, content = 'x\n') {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  git(dir, 'add', path);
}
function run(args, { input, cwd, env } = {}) {
  const r = spawnSync(process.execPath, [HOOK, ...args], {
    input: input ?? '', cwd, encoding: 'utf8',
    env: { ...process.env, SSDD_REVIEW_SKIP: '', SSDD_PROJECT_DIR: '', ...env },
  });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}
// Claude: { tool_input: { command }, cwd } with CLAUDE_PROJECT_DIR set.
// Cursor: { command, cwd } with no CLAUDE_PROJECT_DIR.
const claude = (command, cwd, projectDir = cwd) =>
  run([], { input: JSON.stringify({ tool_input: { command }, cwd }), cwd: projectDir, env: { CLAUDE_PROJECT_DIR: projectDir } });
const cursor = (command, cwd, projectDir = cwd) =>
  run([], { input: JSON.stringify({ command, cwd, hook_event_name: 'beforeShellExecution' }), cwd: projectDir, env: { CLAUDE_PROJECT_DIR: '' } });
const BOTH = [['Claude', claude], ['Cursor', cursor]];

let repo; let elsewhere;
beforeEach(() => { repo = makeRepo(); elsewhere = makeRepo(); });
afterEach(() => { for (const d of [repo, elsewhere]) rmSync(d, { recursive: true, force: true }); });

describe('un-evaluable commits are refused before anything is judged', () => {
  const refused = [
    ['bare pathspec', 'git commit foo.ts', /pathspec `foo\.ts`/],
    ['pathspec after -m', 'git commit -m "x" foo.ts', /pathspec/],
    ['pathspec on a continuation line', 'git commit -m "x" \\\n  foo.ts', /pathspec/],
    ['pathspec after --', 'git commit -m x -- foo.ts', /after --/],
    ['-am', 'git commit -am "x"', /`-am`/],
    ['-a -m', 'git commit -a -m x', /`-a`/],
    ['--all', 'git commit --all -m x', /`--all`/],
    ['-i with a path', 'git commit -i -m x foo.ts', /`-i`/],
    ['--only', 'git commit --only -m x foo.ts', /`--only`/],
    ['pathspec with a heredoc message', "git commit -F - foo.ts <<'EOF'\nmsg\nEOF", /pathspec/],
    ['add chained before commit', 'git add src/x.ts && git commit -m "x"', /`git add` chained[\s\S]*`src\/x\.ts`, routed to alpha/],
    ['rm chained before commit', 'git rm x.ts; git commit -m x', /`git rm` chained/],
    ['-C add chained before -C commit', 'git -C . add src/a.ts && git -C . commit -m x', /chained/],
    // v3.1: a chained `git add` passes only when it names unrouted files.
    ['a chained add of a directory', 'git add docs && git commit -m x', /`git add` chained[\s\S]*a directory `docs`/],
    ['a chained add of .', 'git add . && git commit -m x', /`git add` chained[\s\S]*a directory `\.`/],
    ['a chained add of a glob', "git add 'docs/*.md' && git commit -m x", /`git add` chained[\s\S]*a glob `docs\/\*\.md`/],
    ['a chained add of $X', 'git add $X && git commit -m x', /`git add` chained[\s\S]*`\$X` can't be read before it runs/],
    ['a chained add outside the repo', 'git add ../outside.md && git commit -m x', /`git add` chained[\s\S]*`\.\.\/outside\.md` is outside the repo/],
    ['a chained add -A', 'git add -A && git commit -m x', /`git add` chained[\s\S]*`-A`/],
    ['a chained add -u', 'git add -u && git commit -m x', /`git add` chained[\s\S]*`-u`/],
    ['a chained add -p', 'git add -p docs/notes.md && git commit -m x', /`git add` chained[\s\S]*`-p`/],
    ['a chained add of a path an earlier command makes', 'mkdir docs/new && git add docs/new && git commit -m x', /`git add` chained[\s\S]*`mkdir` runs in the same call/],
    ['a chained add of a path that does not exist', 'git add docs/new.md && git commit -m x', /`git add` chained[\s\S]*`docs\/new\.md` doesn't exist yet/],
    ['a quoted word that looks like a redirection', "git add '2>' src/a.ts && git commit -m x", /`git add` chained[\s\S]*`2>`/],
    ['pushd before a chained add', 'pushd src && git add a.ts && git commit -m x', /cannot resolve the repo/],
    ['cd with an option before a chained add', 'cd -P src && git add a.ts && git commit -m x', /cannot resolve the repo/],
    ['a quoted redirection word with a real one elsewhere', "git add '2>' src/a.ts 2>/dev/null && git commit -m x", /`git add` chained[\s\S]*`2>`/],
    ['builtin cd before a chained add', 'builtin cd src && git add a.ts && git commit -m x', /cannot resolve the repo/],
    ['another command before a chained add', 'rm -f docs/notes.md && git add docs/notes.md && git commit -m x', /`git add` chained[\s\S]*`rm` runs in the same call/],
    ['a command between the add and the commit', 'git add docs/notes.md && git stash pop && git commit -m x', /`git add` chained[\s\S]*`git stash` runs in the same call/],
    ['a subshell around a chained add', '(cd docs) && git add notes.md && git commit -m x', /`git add` chained[\s\S]*a subshell/],
    ['mv chained before commit', 'git mv docs/notes.md docs/n2.md && git commit -m x', /`git mv` chained/],
    ['restore chained before commit', 'git restore --staged docs/notes.md && git commit -m x', /`git restore` chained/],
    ['update-index chained before commit', 'git update-index --add docs/notes.md && git commit -m x', /`git update-index` chained/],
    // v2.1.1 — every commit in the call, runners.
    ['a second commit with -a', 'git commit -m x; git commit -am y', /`-am`/],
    ['sudo git commit -am', 'sudo git commit -am x', /`-am`/],
  ];
  for (const [label, command, why] of refused) {
    for (const [name, h] of BOTH) {
      it(`${name}: ${label}`, () => {
        mkdirSync(join(repo, 'docs'), { recursive: true });
        writeFileSync(join(repo, 'docs', 'notes.md'), 'n\n');
        const r = h(command, repo);
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, why);
        assert.equal(JSON.parse(r.stdout).permission, 'deny');
      });
    }
  }
});

describe('a visible chained git add passes', () => {
  const passes = [
    'git add docs/notes.md && git commit -m x',
    'git add -- docs/notes.md && git commit -m x',
    'git add -f docs/notes.md && git commit -m x',
    'cd docs && git add notes.md && git commit -m x',
    'git add "docs/my notes é.md" docs/notes.md && git commit -m x',
    'git add docs/notes.md 2>&1 && git commit -m x',
    'git status --short && git add docs/notes.md && git commit -m x',
    "git add docs/notes.md && git commit -m \"$(cat <<'EOF'\ndocs: notes\nEOF\n)\"",
  ];
  const docs = () => {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'notes.md'), 'n\n');
    writeFileSync(join(repo, 'docs', 'my notes é.md'), 'n\n');
  };
  for (const command of passes) {
    for (const [name, h] of BOTH) {
      it(`${name}: ${JSON.stringify(command)}`, () => {
        docs();
        const r = h(command, repo);
        assert.equal(r.status, 0, r.stderr);
      });
    }
  }
  for (const [name, h] of BOTH) {
    it(`${name}: the staged routed files are still judged`, () => {
      docs();
      stage(repo, 'src/a.ts');
      const r = h('git add docs/notes.md && git commit -m x', repo);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /alpha — never stamped/);
    });
  }
  for (const [name, h] of BOTH) {
    it(`${name}: staging the deletion of a tracked unrouted file passes`, () => {
      docs();
      git(repo, 'add', 'docs/notes.md');
      git(repo, 'commit', '-qm', 'notes');
      rmSync(join(repo, 'docs', 'notes.md'));
      const r = h('git add docs/notes.md && git commit -m x', repo);
      assert.equal(r.status, 0, r.stderr);
    });
  }
  it('a routed file named in another case is routed by its spelling on disk', () => {
    if (git(repo, 'config', '--bool', 'core.ignorecase') !== 'true') return; // case-sensitive disk
    stage(repo, 'src/lib/a.ts');
    git(repo, 'reset', '-q');
    const r = claude('git add SRC/lib/a.ts && git commit -m x', repo);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /routed to alpha/);
  });
});

describe('a repo without .ssdd/config.json judges no shapes', () => {
  let plain;
  beforeEach(() => {
    plain = tmp('ssdd-plain-');
    git(plain, 'init', '-q');
    writeFileSync(join(plain, 'x'), 'x\n');
  });
  afterEach(() => rmSync(plain, { recursive: true, force: true }));
  const passes = ['git commit -am x', 'git commit x -m y', 'git add x && git commit -m y', 'git rm x && git commit -m y'];
  for (const command of passes) {
    for (const [name, h] of BOTH) {
      it(`${name}: ${JSON.stringify(command)} passes`, () => {
        const r = h(command, plain);
        assert.equal(r.status, 0, r.stderr);
      });
    }
  }
  for (const [name, h] of BOTH) {
    it(`${name}: an unresolvable target still fails closed`, () => {
      const r = h('cd $X && git commit -m y', plain);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /cannot resolve the repo/);
    });
  }
});

describe('shapes that pass the checks (nothing staged → allowed)', () => {
  const passes = [
    "git commit -F - <<'EOF'\nmsg\nEOF\ngit log --oneline -1; git status -sb",
    "git commit -F - <<'EOF'\nmsg\nEOF",
    'git commit -m "x"; git log',
    'git commit -m "x"\ngit log',
    'git commit -sm wip',
    'git commit -m x 2>&1',
    'git commit -m x > /dev/null',
    'git commit -m "x" && git add later.ts',
    'git commit -m "mention git add -A; cd /nope && git -C /x commit"',
    'git commit --allow-empty -m x',
    'git commit --date "2026-01-01 10:00" -m x',
    "bash -lc 'echo hi'",
    `git commit -m 'use bash -c "git commit -am x"'`,
    // v2.6: shell hand-offs aren't unwrapped; the pre-commit layer is the backstop.
    "bash -c 'git commit -am x'",
    'eval "git add x.ts && git commit -m y"',
    "bash <<'EOF'\ngit commit -m x foo.ts\nEOF",
    "echo 'git commit -a -m x' | sh",
  ];
  for (const command of passes) {
    for (const [name, h] of BOTH) {
      it(`${name}: ${JSON.stringify(command)}`, () => {
        const r = h(command, repo);
        assert.equal(r.status, 0, r.stderr);
      });
    }
  }
});

describe('commit detection', () => {
  it('`git log | grep commit` is not a commit (v2.0 treated it as one)', () => {
    stage(repo, 'src/lib/a.ts');
    assert.equal(claude('git log --oneline | grep commit', repo).status, 0);
    assert.equal(claude('git commit -m x', repo).status, 2);
  });
});

describe('the gate judges the repo the commit targets', () => {
  const shapes = [
    ['git -C <r> commit', (r) => `git -C ${r} commit -m "x"`],
    ['cd <r> && git commit', (r) => `cd ${r} && git commit -m "x"`],
    ['cd "<r>" && git commit', (r) => `cd "${r}" && git commit -m "x"`],
    ['cd <r> <newline> git commit', (r) => `cd ${r}\ngit commit -m "x"`],
    ['(cd <r> && git commit)', (r) => `(cd ${r} && git commit -m "x")`],
    ['cd <r>; git commit', (r) => `cd ${r}; git commit -m "x"`],
    ['cd /tmp && cd <r> && git commit', (r) => `cd /tmp && cd ${r} && git commit -m "x"`],
    ['cd <r> && git -C . commit', (r) => `cd ${r} && git -C . commit -m "x"`],
  ];
  for (const [label, f] of shapes) {
    for (const [name, h] of BOTH) {
      it(`${name}: ${label} — from another repo with nothing staged`, () => {
        stage(repo, 'src/lib/a.ts');
        const r = h(f(repo), elsewhere);
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /alpha — never stamped/);
        assert.ok(r.stderr.includes(`--repo ${repo}`), r.stderr);
      });
    }
  }

  it('one call committing to two repos is refused', () => {
    stage(repo, 'src/lib/a.ts');
    const r = claude(`git commit -m x; git -C ${elsewhere} commit -m y`, repo);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /commit to one repo per call/);
  });

  it('a message that mentions -C / cd does not move the target', () => {
    stage(repo, 'src/lib/a.ts');
    assert.equal(claude(`git commit -m "see git -C ${elsewhere}; cd /tmp"`, repo).status, 2);
    assert.equal(claude(`git commit -m "see git -C ${repo}"`, elsewhere).status, 0);
  });

  const unresolvable = [
    'git -C "$WT" commit -m "x"',
    'cd $WT && git commit -m "x"',
    'cd ~/does-not-exist-ssdd && git commit -m "x"',
    'cd /does-not-exist-ssdd; git commit -m "x"',
    'git -C "$(git rev-parse --show-toplevel)" commit -m "x"',
    'cd - && git commit -m "x"',
  ];
  for (const command of unresolvable) {
    for (const [name, h] of BOTH) {
      it(`${name}: fails closed on ${JSON.stringify(command)}`, () => {
        const r = h(command, repo);
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /cannot resolve the repo/);
      });
    }
  }

  it('--stamp … --repo <path> unblocks that repo from anywhere', () => {
    stage(repo, 'src/lib/a.ts');
    const s = run(['--stamp', 'alpha,beta', '--repo', repo], { cwd: elsewhere });
    assert.equal(s.status, 0, s.stderr);
    assert.equal(claude(`git -C ${repo} commit -m x`, elsewhere).status, 0);
    stage(repo, 'src/lib/a.ts', 'changed\n');
    assert.equal(claude(`git -C ${repo} commit -m x`, elsewhere).status, 2);
  });

  it('a repo without .ssdd/config.json is not gated', () => {
    const plain = tmp('ssdd-plain-');
    try {
      git(plain, 'init', '-q');
      stage(plain, 'src/lib/a.ts');
      assert.equal(claude(`git -C ${plain} commit -m x`, repo).status, 0);
    } finally { rmSync(plain, { recursive: true, force: true }); }
  });
});

describe('a real worktree', () => {
  let wt;
  before(() => {});
  beforeEach(() => {
    wt = join(tmp('ssdd-wt-parent-'), 'wt');
    git(repo, 'worktree', 'add', '-q', wt);
    stage(wt, 'src/lib/w.ts'); // staged ONLY in the worktree; the main checkout is clean
  });
  afterEach(() => rmSync(dirname(wt), { recursive: true, force: true }));
  after(() => {});

  for (const [name, h] of BOTH) {
    it(`${name}: git -C <wt> commit from the main checkout is judged against the worktree`, () => {
      const r = h(`git -C ${wt} commit -m x`, repo);
      assert.equal(r.status, 2, r.stderr);
      assert.ok(r.stderr.includes(`--repo ${wt}`), r.stderr);
    });
    it(`${name}: cd <wt> && git commit is judged against the worktree`, () => {
      assert.equal(h(`cd ${wt} && git commit -m x`, repo).status, 2);
    });
  }

  it('--stamp --repo <wt> unblocks both shapes', () => {
    assert.equal(run(['--stamp', 'alpha,beta', '--repo', wt], { cwd: repo }).status, 0);
    assert.equal(claude(`git -C ${wt} commit -m x`, repo).status, 0);
    assert.equal(claude(`cd ${wt} && git commit -m x`, repo).status, 0);
  });

  it('--pre-commit judges git\'s cwd, not a decoy in the env', () => {
    const r = run(['--pre-commit'], { cwd: wt, env: { SSDD_PROJECT_DIR: repo, CLAUDE_PROJECT_DIR: repo } });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /src\/lib\/w\.ts/);
  });
});

describe('route exclude', () => {
  it('a per-route exclude drops test files from that route', () => {
    stage(repo, 'src/x.test.ts');
    assert.equal(run(['--pre-commit'], { cwd: repo }).status, 0);
    const s = run(['--stamp', 'alpha'], { cwd: repo });
    assert.equal(s.status, 1);
    assert.match(s.stderr, /no staged file routes to alpha/);
  });
  it('reviewGate.exclude applies to every route', () => {
    stage(repo, 'src/gen/lib/y.ts');
    assert.equal(run(['--pre-commit'], { cwd: repo }).status, 0);
  });
  it('everything else still routes', () => {
    stage(repo, 'src/z.ts');
    const r = run(['--pre-commit'], { cwd: repo });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /alpha/);
    assert.doesNotMatch(r.stderr, /beta/);
  });
});
