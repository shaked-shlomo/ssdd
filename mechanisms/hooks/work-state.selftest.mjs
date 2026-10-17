// Tests for work-state: the view across branches and worktrees, the stale-status
// rule, ledgers, warnings, and the session-start and close-check modes.
// Run: node --test mechanisms/hooks/work-state.selftest.mjs
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'work-state.mjs');
// The portable hook: mechanisms/hooks/pre-commit in the source tree,
// .githooks/pre-commit in an installed repo (.ssdd/hooks/ is two levels down).
const PRE_COMMIT = [join(HERE, 'pre-commit'), join(HERE, '..', '..', '.githooks', 'pre-commit')].find((p) => existsSync(p));

let base; let dir;
const env = () => {
  const e = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };
  delete e.CLAUDE_PROJECT_DIR; delete e.SSDD_PROJECT_DIR;
  return e;
};
function sh(cwd, args, input) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: env(), input });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const git = (...args) => sh(dir, args);
function put(rel, text, root = dir) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
const commitAll = (msg = 'c', root = dir) => { sh(root, ['add', '-A']); sh(root, ['-c', 'commit.gpgsign=false', 'commit', '-qm', msg]); };
function initRepo(root) {
  mkdirSync(root, { recursive: true });
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.email', 't@t']);
  sh(root, ['config', 'user.name', 't']);
}
function run(args = [], { cwd = dir, extraEnv = {} } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...env(), ...extraEnv } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
// A plan in SSDD's format. status: the Status line text; ac: criteria IDs;
// done: IDs with a Verification entry; deferred: IDs whose entry is DEFERRED.
function planText({ status = 'DRAFT', ac = [], done = [], deferred = [], open = [] } = {}) {
  return [
    '# Plan', '', `**Status:** ${status}`, '', '## Open questions', ...open.map((q, i) => `${i + 1}. ${q}`), '',
    '## Acceptance criteria', ...ac.map((id) => `- **${id}** — criterion ${id}`), '',
    '## Verification', ...done.map((id) => `- **${id}** — \`cmd\` → ok`), ...deferred.map((id) => `- **${id}** — DEFERRED (operator): later`), '',
  ].join('\n');
}
// Counts the git processes a run spawns, through a PATH shim in front of git.
function countGit(args, opts = {}) {
  const shim = join(base, 'shim');
  const log = join(base, 'git-calls.log');
  mkdirSync(shim, { recursive: true });
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(shim, 'git'), `#!/bin/sh\necho x >> "${log}"\nexec "${realGit}" "$@"\n`);
  chmodSync(join(shim, 'git'), 0o755);
  rmSync(log, { force: true });
  const r = run(args, { ...opts, extraEnv: { PATH: `${shim}:${process.env.PATH}` } });
  return { ...r, calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0 };
}
const progress = (planPath, lines) => [`# SDD ledger — plan: ${planPath}`, '', ...lines, ''].join('\n');

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ssdd-ws-'));
  dir = join(base, 'repo');
  initRepo(dir);
  put('.ssdd/config.json', '{}\n');
  put('README.md', 'x\n');
  commitAll('init');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

// Two plans IN PROGRESS on main, worked on a branch that then lands one way or another.
function inProgressOnBranch(branch = 'b') {
  put('.ssdd/plans/11-billing.md', planText({ status: 'IN PROGRESS' }));
  commitAll('plan 11');
  git('switch', '-q', '-c', branch);
  put('.ssdd/plans/11-billing.md', planText({ status: 'IN PROGRESS', ac: ['AC1'] }));
  put('src.txt', 'work\n');
  commitAll('work on 11');
  git('switch', '-q', 'main');
}

describe('view', () => {
  it('lists open plans across main, a branch and a worktree', () => {
    put('.ssdd/plans/07-pricing.md', planText({ status: 'DRAFT', open: ['Which bucket?'] }));
    commitAll('draft');
    git('branch', 'b');
    const wt = join(base, 'step-2');
    git('worktree', 'add', '-q', wt, 'b');
    put('.ssdd/plans/12-onboarding.md', planText({ status: 'IN PROGRESS', ac: ['AC1', 'AC2', 'AC3'], done: ['AC1'] }), wt);
    put('.superpowers/sdd/12-onboarding/progress.md',
      progress('.ssdd/plans/12-onboarding.md', ['Task 1: complete (x)', 'Task 2: complete (y)']), wt);
    const { code, out } = run();
    assert.equal(code, 0);
    assert.match(out, /^SSDD · 2 open plans/m);
    assert.match(out, /12 onboarding\s+IN PROGRESS \(worktree step-2\).*Tasks 1–2 done.*AC 1\/3 verified/);
    assert.match(out, /07 pricing\s+DRAFT since \d{4}-\d{2}-\d{2} · 1 open question\b/);
  });

  it('a DRAFT on main worked on in a worktree shows that work, from either checkout', () => {
    put('.ssdd/plans/12-onboarding.md', planText({ status: 'DRAFT', ac: ['AC1', 'AC2'], open: ['q'] }));
    commitAll('draft');
    const wt = join(base, 'step-2');
    git('worktree', 'add', '-q', '-b', 'b', wt);
    put('.ssdd/plans/12-onboarding.md', planText({ status: 'IN PROGRESS', ac: ['AC1', 'AC2'], done: ['AC1'] }), wt);
    put('.superpowers/sdd/12-onboarding/progress.md',
      progress('.ssdd/plans/12-onboarding.md', ['Task 1: complete (a)', 'Task 2: complete (b)', 'Task 3: complete (c)']), wt);
    for (const cwd of [dir, wt]) {
      const { out } = run([], { cwd });
      assert.match(out, /12 onboarding\s+IN PROGRESS \((worktree step-2|this checkout)\) · Tasks 1–3 done · AC 1\/2 verified/, out);
    }
  });

  it('git calls stay bounded with many tracked ledgers', () => {
    for (let i = 1; i <= 20; i++) {
      const n = String(i).padStart(2, '0');
      put(`.ssdd/plans/${n}-p.md`, planText({ status: 'SHIPPED' }));
      put(`.superpowers/sdd/${n}-p/progress.md`, progress(`.ssdd/plans/${n}-p.md`, ['Task 1: complete (x)']));
    }
    for (let i = 21; i <= 30; i++) {
      put(`.ssdd/plans/${i}-q.md`, planText({ status: 'SHIPPED' }));
      put(`docs/superpowers/plans/${i}-q.md`, `SSDD plan: .ssdd/plans/${i}-q.md\n`);
      put(`.superpowers/sdd/sp-${i}/progress.md`, progress(`docs/superpowers/plans/${i}-q.md`, ['Task 1: complete (x)']));
    }
    commitAll('many');
    for (const b of ['b1', 'b2', 'b3', 'b4']) git('branch', b);
    git('worktree', 'add', '-q', '-b', 'w1', join(base, 'w1'));
    git('worktree', 'add', '-q', '-b', 'w2', join(base, 'w2'));
    const view = countGit([]);
    assert.equal(view.code, 0, view.err);
    assert.ok(view.calls <= 40, `${view.calls} git calls for the view`);
    const staged = countGit(['--staged']);
    assert.equal(staged.code, 0, staged.err);
    assert.ok(staged.calls <= 12, `${staged.calls} git calls for the close check`);
  });

  it('SSDD ledger next task', () => {
    put('.ssdd/plans/03-docs.md', planText({ status: 'BUILT', ac: ['AC1'], deferred: ['AC1'] }));
    put('.ssdd/ledgers/03-docs-ledger.md', '## Tasks\n\n- [x] Task 1 — parse\n- [ ] Task 2 — docs\n');
    commitAll('plan 3');
    const { out } = run();
    assert.match(out, /03 docs\s+BUILT.*next: Task 2 — docs.*1 deferred/);
  });

  it('unlinked ledger is warned once', () => {
    put('.superpowers/sdd/ghost/progress.md', progress('docs/plans/ghost.md', ['Task 1: complete (x)']));
    commitAll('ghost');
    const wt = join(base, 'wt2');
    git('worktree', 'add', '-q', '-b', 'w', wt);
    const { out } = run();
    assert.equal(out.match(/! ledger ghost isn't linked to an SSDD plan/g)?.length, 1, out);
  });

  it('a ledger linked through the Superpowers plan that names it', () => {
    put('.ssdd/plans/14-guard.md', planText({ status: 'IN PROGRESS' }));
    commitAll('plan 14');
    git('switch', '-q', '-c', 'g');
    put('docs/superpowers/plans/2026-10-17-guard.md', 'SSDD plan: .ssdd/plans/14-guard.md\n\n### Task 1: a\n### Task 2: b\n### Task 3: c\n');
    put('.superpowers/sdd/2026-10-17-guard/progress.md', progress('docs/superpowers/plans/2026-10-17-guard.md', ['Task 1: complete (x)', 'Task 2: fix round 1/5 (y)']));
    put('.ssdd/plans/14-guard.md', planText({ status: 'IN PROGRESS', ac: ['AC1'] }));
    commitAll('guard work');
    git('switch', '-q', 'main');
    const { out } = run();
    assert.match(out, /14 guard\s+IN PROGRESS \(branch g\).*Task 1 of 3 done · Task 2 in review/);
    assert.doesNotMatch(out, /isn't linked/);
  });

  it('unknown statuses grouped', () => {
    put('.ssdd/plans/01-a.md', planText({ status: 'DONE — 2026-08-01' }));
    put('.ssdd/plans/02-b.md', planText({ status: 'DONE on branch x' }));
    put('.ssdd/plans/03-c.md', planText({ status: 'CLOSED' }));
    put('.ssdd/plans/04-d.md', planText({ status: 'IN REVIEW (PR #9)' }));
    put('.ssdd/plans/05-e.md', planText({ status: 'READY TO CLOSE — 2026-10-01' }));
    commitAll('legacy');
    const { out } = run();
    assert.match(out, /5 plans with a status outside the six \(DONE ×2, CLOSED, IN REVIEW, READY TO CLOSE\)/);
    assert.match(out, /^SSDD · no open plans/m);
  });

  it('duplicate numbers warned', () => {
    put('.ssdd/plans/29-a.md', planText({ status: 'SHIPPED' }));
    commitAll('29a');
    git('switch', '-q', '-c', 'x');
    put('.ssdd/plans/29-b.md', planText({ status: 'DRAFT' }));
    commitAll('29b');
    git('switch', '-q', 'main');
    const { out } = run();
    assert.match(out, /! plans numbered 29: 29-a\.md \(main\), 29-b\.md \(branch x\)/);
  });

  it('ignored ledger is warned', () => {
    put('.gitignore', '.superpowers/\n');
    put('.ssdd/plans/05-x.md', planText({ status: 'IN PROGRESS' }));
    commitAll('ignore');
    put('.superpowers/sdd/05-x/progress.md', progress('.ssdd/plans/05-x.md', ['Task 1: complete (x)']));
    const { out } = run();
    assert.match(out, /! ledger for 05 is ignored by git \(\.gitignore:1: \.superpowers\/\)/);
  });

  it('an ignore rule in .git/info/exclude is named repo-relative, from a linked worktree', () => {
    put('.ssdd/plans/05-x.md', planText({ status: 'IN PROGRESS' }));
    commitAll('x');
    put('.git/info/exclude', '.superpowers/\n');
    const wt = join(base, 'wt-x');
    git('worktree', 'add', '-q', '-b', 'wx', wt);
    put('.superpowers/sdd/05-x/progress.md', progress('.ssdd/plans/05-x.md', ['Task 1: complete (x)']), wt);
    assert.match(run().out, /! ledger for 05 is ignored by git \(\.git\/info\/exclude:1: \.superpowers\/\)/);
  });

  it('paths.plans honored', () => {
    put('.ssdd/config.json', JSON.stringify({ paths: { plans: '.claude/plans' } }));
    put('.claude/plans/62-trims.md', planText({ status: 'DRAFT' }));
    put('.ssdd/plans/01-elsewhere.md', planText({ status: 'DRAFT' }));
    commitAll('claude plans');
    const { out } = run();
    assert.match(out, /62 trims\s+DRAFT/);
    assert.doesNotMatch(out, /elsewhere/);
  });

  it('fresh repo with no commits', () => {
    const fresh = join(base, 'fresh');
    initRepo(fresh);
    put('.ssdd/config.json', '{}\n', fresh);
    put('.ssdd/plans/01-start.md', planText({ status: 'DRAFT' }), fresh);
    const { code, out } = run([], { cwd: fresh });
    assert.equal(code, 0);
    assert.match(out, /01 start\s+DRAFT/);
  });

  it('path with a space and non-ASCII', () => {
    put('.ssdd/plans/07-עמוד מחיר.md', planText({ status: 'DRAFT' }));
    commitAll('hebrew');
    const { out } = run();
    assert.match(out, /07 עמוד מחיר\s+DRAFT/);
  });

  it('detached and missing worktrees', () => {
    put('.ssdd/plans/08-d.md', planText({ status: 'DRAFT' }));
    commitAll('d');
    const det = join(base, 'det');
    git('worktree', 'add', '-q', '--detach', det);
    put('.ssdd/plans/09-wip.md', planText({ status: 'IN PROGRESS' }), det);
    const gone = join(base, 'gone');
    git('worktree', 'add', '-q', '-b', 'gone', gone);
    rmSync(gone, { recursive: true, force: true });
    const { code, out } = run();
    assert.equal(code, 0);
    assert.match(out, /09 wip\s+IN PROGRESS \(worktree det \(detached\)\)/);
  });

  it('no config prints nothing', () => {
    git('rm', '-q', '.ssdd/config.json');
    commitAll('no config');
    const { code, out } = run();
    assert.equal(code, 0);
    assert.equal(out, '');
  });
});

describe('stale status', () => {
  it('merge commit', () => {
    inProgressOnBranch();
    git('-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '-m', 'merge b', 'b');
    assert.match(run().out, /11 billing\s+IN PROGRESS on main, no branch working on it → SHIPPED, BUILT, or still going\?/);
  });

  it('squash merge', () => {
    inProgressOnBranch();
    git('merge', '-q', '--squash', 'b');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'squash b');
    assert.match(run().out, /11 billing\s+IN PROGRESS on main, no branch working on it/);
  });

  it('deleted branch', () => {
    inProgressOnBranch();
    git('branch', '-q', '-D', 'b');
    assert.match(run().out, /11 billing\s+IN PROGRESS on main, no branch working on it/);
  });

  it('active branch is not flagged', () => {
    inProgressOnBranch();
    const { out } = run();
    assert.match(out, /11 billing\s+IN PROGRESS \(branch b\)/);
    assert.doesNotMatch(out, /no branch working on it/);
  });

  it('merged on the remote but not pulled is flagged', () => {
    const bare = join(base, 'origin.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { env: env() });
    git('remote', 'add', 'origin', bare);
    inProgressOnBranch();
    git('push', '-q', 'origin', 'main', 'b');
    git('remote', 'set-head', 'origin', 'main');
    const other = join(base, 'other');
    spawnSync('git', ['clone', '-q', bare, other], { env: env() });
    sh(other, ['config', 'user.email', 't@t']);
    sh(other, ['config', 'user.name', 't']);
    sh(other, ['-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '-m', 'merge b', 'origin/b']);
    sh(other, ['push', '-q', 'origin', 'main']);
    git('fetch', '-q', 'origin');
    assert.notEqual(git('rev-parse', 'main'), git('rev-parse', 'origin/main'));
    assert.match(run().out, /11 billing\s+IN PROGRESS on main, no branch working on it/);
  });

  it('a branch advancing only an indirectly linked ledger counts as working', () => {
    put('.ssdd/plans/14-guard.md', planText({ status: 'IN PROGRESS' }));
    put('docs/superpowers/plans/2026-10-17-guard.md', 'SSDD plan: .ssdd/plans/14-guard.md\n\n### Task 1: a\n### Task 2: b\n');
    put('.superpowers/sdd/2026-10-17-guard/progress.md', progress('docs/superpowers/plans/2026-10-17-guard.md', ['Task 1: complete (x)']));
    commitAll('guard');
    git('switch', '-q', '-c', 'g');
    put('.superpowers/sdd/2026-10-17-guard/progress.md',
      progress('docs/superpowers/plans/2026-10-17-guard.md', ['Task 1: complete (x)', 'Task 2: complete (y)']));
    commitAll('task 2');
    git('switch', '-q', 'main');
    const { out } = run();
    assert.match(out, /14 guard\s+IN PROGRESS \(branch g\) · Tasks 1–2 of 2 done/);
    assert.doesNotMatch(out, /no branch working on it/);
  });

  it("a clean detached worktree at an old commit doesn't count as working", () => {
    put('.ssdd/plans/11-billing.md', planText({ status: 'IN PROGRESS' }));
    commitAll('a');
    const old = git('rev-parse', 'HEAD');
    put('.ssdd/plans/11-billing.md', planText({ status: 'IN PROGRESS', ac: ['AC1'], done: ['AC1'] }));
    commitAll('b');
    git('worktree', 'add', '-q', '--detach', join(base, 'review'), old);
    assert.match(run().out, /11 billing\s+IN PROGRESS on main, no branch working on it/);
  });

  it('BUILT and DRAFT never flagged; closed plans not listed', () => {
    put('.ssdd/plans/20-built.md', planText({ status: 'BUILT (operator steps remain)' }));
    put('.ssdd/plans/21-draft.md', planText({ status: 'DRAFT' }));
    put('.ssdd/plans/22-shipped.md', planText({ status: 'SHIPPED (PR #9)' }));
    put('.ssdd/plans/23-gone.md', planText({ status: 'SUPERSEDED (by 24)' }));
    put('.ssdd/plans/24-stop.md', planText({ status: 'ABANDONED (no longer needed)' }));
    commitAll('mix');
    const { out } = run();
    assert.doesNotMatch(out, /no branch working on it/);
    assert.match(out, /20 built\s+BUILT/);
    assert.match(out, /21 draft\s+DRAFT/);
    assert.doesNotMatch(out, /shipped|gone|stop/);
  });

  it('a ledger-only change on a branch counts as working on it', () => {
    put('.ssdd/plans/30-x.md', planText({ status: 'IN PROGRESS' }));
    commitAll('30');
    git('switch', '-q', '-c', 'r2');
    put('.ssdd/ledgers/30-x-ledger.md', '- [x] Task 1 — a\n- [ ] Task 2 — b\n');
    commitAll('ledger');
    git('switch', '-q', 'main');
    const { out } = run();
    assert.match(out, /30 x\s+IN PROGRESS \(branch r2\).*next: Task 2 — b/);
  });
});

describe('session start', () => {
  it('capped', () => {
    for (let i = 1; i <= 40; i++) put(`.ssdd/plans/${String(i).padStart(2, '0')}-plan-with-a-longish-name.md`, planText({ status: 'DRAFT', open: ['q'] }));
    commitAll('40 drafts');
    const { code, out } = run(['--session-start']);
    assert.equal(code, 0);
    const lines = out.trimEnd().split('\n');
    assert.ok(lines.length <= 12, `${lines.length} lines`);
    assert.ok(Buffer.byteLength(out) <= 1536, `${Buffer.byteLength(out)} bytes`);
    assert.match(lines.at(-1), /^\+\d+ more: node \.ssdd\/hooks\/work-state\.mjs$/);
    assert.match(lines[0], /^SSDD · 40 open plans/);
  });

  it('warnings survive the cap', () => {
    for (let i = 1; i <= 15; i++) put(`.ssdd/plans/${String(i).padStart(2, '0')}-p.md`, planText({ status: 'DRAFT' }));
    put('.ssdd/plans/03-dup.md', planText({ status: 'DRAFT' }));
    commitAll('many');
    const { out } = run(['--session-start']);
    assert.ok(out.trimEnd().split('\n').length <= 12, out);
    assert.match(out, /! plans numbered 03: 03-dup\.md \(main\), 03-p\.md \(main\)/);
    assert.match(out, /\+\d+ more: node \.ssdd\/hooks\/work-state\.mjs\n$/);
  });

  it('broken config and corrupt plan exit 0', () => {
    put('.ssdd/plans/01-junk.md', Buffer.from([0, 255, 254, 0, 10, 13, 0]));
    commitAll('junk');
    assert.equal(run(['--session-start']).code, 0);
    put('.ssdd/config.json', '{ not json');
    const { code, out } = run(['--session-start']);
    assert.equal(code, 0);
    assert.match(out, /! \.ssdd\/config\.json is not valid JSON/);
  });

  it('a missing project directory prints nothing and exits 0', () => {
    const { code, out } = run(['--session-start'], { extraEnv: { SSDD_PROJECT_DIR: join(base, 'missing-dir') } });
    assert.equal(code, 0);
    assert.equal(out, '');
  });

  it('no config prints nothing', () => {
    git('rm', '-q', '.ssdd/config.json');
    commitAll('no config');
    assert.deepEqual([run(['--session-start']).out, run(['--session-start=cursor']).out], ['', '']);
  });

  it('session-start=cursor prints JSON', () => {
    put('.ssdd/plans/01-a.md', planText({ status: 'DRAFT' }));
    commitAll('a');
    const { code, out } = run(['--session-start=cursor']);
    assert.equal(code, 0);
    assert.match(JSON.parse(out).additional_context, /^SSDD · 1 open plan\b/);
  });

  it('reads the project from CLAUDE_PROJECT_DIR, not the cwd', () => {
    put('.ssdd/plans/01-a.md', planText({ status: 'DRAFT' }));
    commitAll('a');
    const { out } = run(['--session-start'], { cwd: base, extraEnv: { CLAUDE_PROJECT_DIR: dir } });
    assert.match(out, /01 a\s+DRAFT/);
  });
});

describe('close check (--staged)', () => {
  const stage = (...p) => git('add', '--', ...p);
  const shipLedger = '.superpowers/sdd/12-x/progress.md';

  it('BUILT with a missing entry is blocked', () => {
    put('.ssdd/plans/12-x.md', planText({ status: 'BUILT', ac: ['AC1', 'AC2'], done: ['AC1'] }));
    stage('.ssdd/plans/12-x.md');
    const { code, err } = run(['--staged']);
    assert.equal(code, 1);
    assert.match(err, /\[ssdd-work-state\] \.ssdd\/plans\/12-x\.md: AC2 has no Verification entry/);
  });

  it('a DEFERRED entry passes', () => {
    put('.ssdd/plans/12-x.md', planText({ status: 'BUILT', ac: ['AC1', 'AC2'], done: ['AC1'], deferred: ['AC2'] }));
    stage('.ssdd/plans/12-x.md');
    assert.equal(run(['--staged']).code, 0);
  });

  it('both entry forms parse', () => {
    put('.ssdd/plans/12-x.md', ['**Status:** SHIPPED (PR #1)', '## Acceptance criteria', '- **AC1** — a', '- [ ] AC2 b',
      '## Verification', '- **AC1** — `cmd` → ok', '- **AC2 ✅ — measured', ''].join('\n'));
    stage('.ssdd/plans/12-x.md');
    const { code, err } = run(['--staged']);
    assert.equal(code, 0, err);
  });

  it('Status DONE is blocked with the allowed words', () => {
    put('.ssdd/plans/12-x.md', planText({ status: 'DONE — 2026-10-01' }));
    stage('.ssdd/plans/12-x.md');
    const { code, err } = run(['--staged']);
    assert.equal(code, 1);
    assert.match(err, /Status "DONE — 2026-10-01" isn't one of DRAFT, IN PROGRESS, BUILT, SHIPPED, SUPERSEDED, ABANDONED/);
  });

  it('an unstaged DONE plan blocks nothing', () => {
    put('.ssdd/plans/01-old.md', planText({ status: 'DONE' }));
    commitAll('legacy');
    put('README.md', 'y\n');
    stage('README.md');
    assert.equal(run(['--staged']).code, 0);
  });

  it('BUILT with no IDs passes with a note', () => {
    put('.ssdd/plans/12-x.md', planText({ status: 'BUILT' }));
    stage('.ssdd/plans/12-x.md');
    const { code, err } = run(['--staged']);
    assert.equal(code, 0);
    assert.match(err, /no AC IDs — close check skipped/);
  });

  it('SHIPPED with an unstaged Superpowers ledger is blocked, and passes once staged', () => {
    put('.ssdd/plans/12-x.md', planText({ status: 'SHIPPED', ac: ['AC1'], done: ['AC1'] }));
    put(shipLedger, progress('.ssdd/plans/12-x.md', ['Task 1: complete (x)']));
    stage('.ssdd/plans/12-x.md');
    const first = run(['--staged']);
    assert.equal(first.code, 1);
    assert.match(first.err, /ledger \.superpowers\/sdd\/12-x\/progress\.md isn't staged: git add \.superpowers\/sdd\/12-x\/progress\.md/);
    stage(shipLedger);
    assert.equal(run(['--staged']).code, 0);
    put(shipLedger, progress('.ssdd/plans/12-x.md', ['Task 1: complete (x)', 'Task 2: complete (y)']));
    assert.equal(run(['--staged']).code, 1, 'an unstaged edit to a tracked ledger blocks too');
  });

  it('an ignored ledger passes with a warning naming the rule', () => {
    put('.gitignore', '.superpowers/\n');
    commitAll('ignore');
    put('.ssdd/plans/12-x.md', planText({ status: 'SHIPPED', ac: ['AC1'], done: ['AC1'] }));
    put(shipLedger, progress('.ssdd/plans/12-x.md', ['Task 1: complete (x)']));
    stage('.ssdd/plans/12-x.md');
    const { code, err } = run(['--staged']);
    assert.equal(code, 0, err);
    assert.match(err, /ignored by git \(\.gitignore:1: \.superpowers\/\)/);
  });

  it('paths.plans honored by the close check', () => {
    put('.ssdd/config.json', JSON.stringify({ paths: { plans: '.claude/plans' } }));
    put('.claude/plans/62-trims.md', planText({ status: 'SHIPPED', ac: ['AC1'] }));
    stage('.ssdd/config.json', '.claude/plans/62-trims.md');
    const { code, err } = run(['--staged']);
    assert.equal(code, 1);
    assert.match(err, /\.claude\/plans\/62-trims\.md: AC1 has no Verification entry/);
  });

  it('a merge bringing plans from main is not blocked by them', () => {
    put('.ssdd/plans/01-old.md', planText({ status: 'DONE — legacy' }));
    put('.ssdd/plans/02-built.md', planText({ status: 'BUILT', ac: ['AC1'] }));
    commitAll('legacy');
    git('switch', '-q', '-c', 'f');
    put('feature.txt', 'f\n');
    commitAll('feature');
    git('switch', '-q', 'main');
    put('.ssdd/plans/01-old.md', planText({ status: 'DONE — legacy', open: ['typo fixed'] }));
    put('.ssdd/plans/02-built.md', planText({ status: 'BUILT', ac: ['AC1'], open: ['x'] }));
    put('.ssdd/plans/03-new.md', planText({ status: 'CLOSED' }));
    commitAll('main edits');
    git('switch', '-q', 'f');
    git('-c', 'commit.gpgsign=false', 'merge', '-q', '--no-commit', '--no-ff', 'main');
    const clean = run(['--staged']);
    assert.equal(clean.code, 0, clean.err);
    put('.ssdd/plans/03-new.md', planText({ status: 'CLOSED again' }));
    stage('.ssdd/plans/03-new.md');
    const edited = run(['--staged']);
    assert.equal(edited.code, 1, 'a plan the merge resolution edits is still checked');
    assert.match(edited.err, /03-new\.md: Status "CLOSED again"/);
  });

  it('judges the repo at the cwd, not SSDD_PROJECT_DIR or CLAUDE_PROJECT_DIR', () => {
    put('.ssdd/plans/12-x.md', planText({ status: 'BUILT', ac: ['AC1'] }));
    stage('.ssdd/plans/12-x.md');
    const other = join(base, 'other');
    initRepo(other);
    const r = run(['--staged'], { extraEnv: { SSDD_PROJECT_DIR: other, CLAUDE_PROJECT_DIR: other } });
    assert.equal(r.code, 1, r.err);
  });

  it('reminds to stage a Superpowers ledger on every run', () => {
    put('.superpowers/sdd/p/progress.md', progress('.ssdd/plans/01-p.md', ['Task 1: complete (x)']));
    const { code, err } = run(['--staged']);
    assert.equal(code, 0);
    assert.match(err, /\[ssdd-work-state\] reminder: git add \.superpowers\/sdd\/p\/progress\.md/);
  });

  function armPreCommit() {
    mkdirSync(join(dir, '.githooks'));
    writeFileSync(join(dir, '.githooks', 'pre-commit'), readFileSync(PRE_COMMIT, 'utf8'));
    chmodSync(join(dir, '.githooks', 'pre-commit'), 0o755);
    mkdirSync(join(dir, '.ssdd', 'hooks'));
    for (const f of readdirSync(HERE)) {
      if (f.endsWith('.mjs') && !f.endsWith('.selftest.mjs')) copyFileSync(join(HERE, f), join(dir, '.ssdd', 'hooks', f));
    }
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '.githooks/\n.ssdd/hooks/\n');
    git('config', 'core.hooksPath', '.githooks');
  }
  const commit = (msg) => spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', msg], { cwd: dir, encoding: 'utf8', env: env() });

  it('pre-commit: a ledger with a non-ASCII name is exempt too', { skip: !PRE_COMMIT }, () => {
    armPreCommit();
    put('.superpowers/sdd/07-עמוד מחיר/progress.md', progress('.ssdd/plans/07-עמוד מחיר.md', ['Task 1: complete (x)']));
    put('README.md', 'z\n');
    stage('README.md');
    const ok = commit('x');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /reminder: git add \.superpowers\/sdd\/07-עמוד מחיר\/progress\.md/);
  });

  it('pre-commit: ledger exempt from the untracked block', { skip: !PRE_COMMIT }, () => {
    armPreCommit();
    put('.superpowers/sdd/p/progress.md', progress('.ssdd/plans/01-p.md', ['Task 1: complete (x)']));
    put('README.md', 'z\n');
    stage('README.md');
    const ok = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'x'], { cwd: dir, encoding: 'utf8', env: env() });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /reminder: git add \.superpowers\/sdd\/p\/progress\.md/);
    put('notes.txt', 'stray\n');
    put('README.md', 'w\n');
    stage('README.md');
    const blocked = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'y'], { cwd: dir, encoding: 'utf8', env: env() });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /untracked files exist[\s\S]*notes\.txt/);
    assert.doesNotMatch(blocked.stderr, /• \.superpowers/);
  });
});
