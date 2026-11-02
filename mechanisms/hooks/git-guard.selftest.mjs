// Regression tests for the SSDD git guard. Each case feeds a PreToolUse(Bash)
// payload on stdin and asserts the exit code: 2 = blocked, 0 = allowed (a
// warning is an allow that carries a message).
//
// The guard runs against a scratch git repo with its own .ssdd/config.json, so
// the extraRules cases (force push) pin the framework's shipped pattern rather
// than whatever a host project happens to configure. The block is embedded
// (install copies this file into a project's .ssdd/hooks/, where
// config.example.json is not a sibling); when it IS a sibling — in the
// framework repo — one case checks the embedded copy has not drifted from it.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 22.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const hooksDir = dirname(fileURLToPath(import.meta.url));
const HOOK = join(hooksDir, 'git-guard.mjs');
const EXAMPLE_CONFIG = join(hooksDir, '..', 'config.example.json');
const NODE = process.execPath;

// Mirrors mechanisms/config.example.json → gitGuard (minus $comment keys).
const GIT_GUARD = {
  extraRules: [
    {
      // --force (not --force-with-lease / --force-if-includes), bundled short -f, +refspec.
      pattern: String.raw`\bgit\s+push\b[^;&|\n]*(\s--force(?![-\w])|\s-[a-zA-Z]*f[a-zA-Z]*(?=\s|$)|\s\+[^\s+])`,
      message: "Blocked: force push (--force, -f, or +refspec). Use --force-with-lease, and only after the user's explicit go-ahead.",
    },
  ],
};

// One scratch repo for the whole file: the guard is read-only, so cases can share it.
let REPO;
before(() => {
  REPO = mkdtempSync(join(tmpdir(), 'ssdd-guard-'));
  const r = spawnSync('git', ['-C', REPO, 'init', '-q'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git init: ${r.stderr}`);
  mkdirSync(join(REPO, '.ssdd'));
  writeFileSync(join(REPO, '.ssdd', 'config.json'), JSON.stringify({ gitGuard: GIT_GUARD }));
});
after(() => { rmSync(REPO, { recursive: true, force: true }); });

function guard(command) {
  const { status } = spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    cwd: REPO,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
    encoding: 'utf8',
  });
  return status;
}

// A warning is an allow with a message: Claude Code gets it as
// hookSpecificOutput.additionalContext, Cursor as agent_message on the body.
function runGuard(command, harness = 'claude') {
  const payload = harness === 'cursor'
    ? { command, hook_event_name: 'beforeShellExecution' }
    : { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } };
  return spawnSync(NODE, [HOOK], {
    input: JSON.stringify(payload), cwd: REPO, env: { ...process.env, CLAUDE_PROJECT_DIR: REPO }, encoding: 'utf8',
  });
}

function cursorGuard(command, { bom = false } = {}) {
  const json = JSON.stringify({
    command,
    hook_event_name: 'beforeShellExecution',
  });
  const { status } = spawnSync(NODE, [HOOK], {
    input: bom ? `﻿${json}` : json,
    cwd: REPO,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
    encoding: 'utf8',
  });
  return status;
}

const BLOCKED = [
  ['commit --no-verify', 'git commit -m x --no-verify'],
  ['force push', 'git push origin main --force'],
  // Bypasses via tokens between `git`/subcommand/flag — the class this suite pins.
  ['global flag before commit --no-verify', 'git -c core.hooksPath=/dev/null commit --no-verify'],
  // extraRules from .ssdd/config.json get the same normalization for free.
  ['global flag before force push', 'git -C /tmp/x push origin main --force'],
  // The shipped force-push extraRule: --force, short -f (alone or bundled), +refspec.
  ['force push, --force before the remote', 'git push --force origin main'],
  ['force push, bare --force', 'git push --force'],
  ['force push, short -f', 'git push -f origin main'],
  ['force push, trailing -f', 'git push origin main -f'],
  ['force push, bundled -uf', 'git push -uf origin main'],
  ['force push, bundled -fu', 'git push -fu origin main'],
  ['force push, +refspec', 'git push origin +main'],
  ['force push, +src:dst refspec', 'git push origin +HEAD:main'],
  ['global flag before short -f push', 'git -C /tmp/x push -f origin main'],
  // `-n` is git's short --no-verify; with -a it skipped every gate.
  ['commit -n bundled with -a and -m', 'git commit -anm x'],
  ['commit -n before -am', 'git commit -n -am x'],
  ['commit -n after -a', 'git commit -a -n'],
  ['commit -nm', 'git commit -nm x'],
  ['global flag before commit -n', 'git -C /tmp/x commit -nm x'],
  ['commit -uno (known false positive: use --untracked-files=no)', 'git commit -uno -m x'],
  ['--no-verify still blocked when chained', 'git commit -m x --no-verify && git push'],
  // Re-pointing or unsetting core.hooksPath disables the pre-commit gate.
  ['-c core.hooksPath before commit', 'git -c core.hooksPath=/dev/null commit -am x'],
  ['quoted -c core.hooksPath', "git -c 'core.hooksPath=/x' commit -am x"],
  ['git config core.hooksPath', 'git config core.hooksPath /tmp'],
  ['git config --local core.hooksPath', 'git config --local core.hooksPath x'],
  ['git config --unset core.hooksPath', 'git config --unset core.hooksPath'],
  // v2.1 — ported from the source project's hardened guard.
  ['-C before commit -n', 'git -C /tmp/wt commit -n'],
  ['double-quoted -c core.hooksPath', 'git -c "core.hooksPath=/dev/null" commit -m "x"'],
  ['lower-case core.hookspath', 'git -c core.hookspath=/dev/null commit -m "x"'],
  ['git config core.hooksPath chained before commit', 'git config core.hooksPath /dev/null && git commit -m "x"'],
  ['-c core.hooksPath on the second commit', 'git commit -m "x" && git -c core.hooksPath=/dev/null commit -m "y"'],
  ['VAR=value before git -c core.hooksPath', 'X=1 git -c core.hooksPath=/x commit -m x'],
  // v2.1.1 — runner prefixes are still seen through.
  ['git by absolute path', '/usr/bin/git commit -nm x'],
  ['env -i before git -c core.hooksPath', 'env -i git -c core.hooksPath=/x commit -m x'],
  ['sudo before git config core.hooksPath', 'sudo git config core.hooksPath /x'],
  // v3.1 — a git config with a value or a write option is a write; reads pass (ALLOWED).
  ['an empty value', 'git config core.hooksPath ""'],
  ['a quoted value', "git config core.hooksPath '/dev/null'"],
  ['--unset-all', 'git config --unset-all core.hooksPath'],
  ['--add', 'git config --add core.hooksPath /x'],
  ['--replace-all', 'git config --replace-all core.hooksPath /x'],
  ['-e', 'git config -e core.hooksPath'],
  ['--edit', 'git config --edit core.hooksPath'],
  ['the set subcommand', 'git config set core.hooksPath /x'],
  ['the unset subcommand', 'git config unset core.hooksPath'],
  ['a read, then a write', 'git config --get core.hooksPath && git config core.hooksPath /x'],
  ['Hatedate 08-09: read in $(…), write on the next line', `echo "hooksPath = '$(git config core.hooksPath)'"\ngit config core.hooksPath .githooks`],
  ['arming is a write too', 'git config core.hooksPath .githooks'],
  // Anything after the key that isn't an exact redirection is a value.
  ['a value after 2>&1', 'git config core.hooksPath 2>&1 /dev/null'],
  ['a value after >&2', 'git config core.hooksPath >&2 /x'],
  ['a process substitution is a value', 'git config core.hooksPath <(true)'],
  ['a quoted write option', "git config '--unset' core.hooksPath"],
  ['get after an option is not the subcommand', 'git config --file .git/config get core.hooksPath /x'],
  ['a read flag quoted inside an option value', 'git config --comment "x --get" core.hooksPath /x'],
  ['a read flag as an option value', 'git config --comment --get core.hooksPath /x'],
];

const WARNED = [
  ['git add -A', 'git add -A', /stage/],
  ['git add .', 'git add .', /stage/],
  ['git add --all', 'git add --all', /stage/],
  ['git add -Av', 'git add -Av', /stage/],
  ['git commit --amend', 'git commit --amend', /amend/],
  ['git commit --amend --no-edit', 'git commit --amend --no-edit', /amend/],
  // The bypass shapes the bulk-add block pinned still reach the warning.
  ['a global flag before add', 'git -C /tmp/x add -A', /stage/],
  ['-c config before add', 'git -c user.name=x add --all', /stage/],
  ['--git-dir=<p> before add', 'git --git-dir=/tmp/x/.git add .', /stage/],
  ['--work-tree <p> before add', 'git --work-tree /tmp/x add -A', /stage/],
  ['--git-dir <p> before add', 'git --git-dir /tmp/x/g add --all', /stage/],
  ['stacked global flags before add', 'git --no-pager -c a=b --work-tree /tmp/x add -A', /stage/],
  ['a flag between add and -A', 'git add --force -A', /stage/],
  ['bundled short flags', 'git add -vA', /stage/],
  ['-fA cluster', 'git add -fA', /stage/],
  ['a global flag before --amend', 'git -C /tmp/x commit --amend', /amend/],
];

const ALLOWED = [
  ['add by path', 'git add src/foo.ts'],
  ['add relative path', 'git add ./src/foo.ts'],
  ['add several paths', 'git add src/a.ts src/b.ts'],
  ['plain commit', 'git commit -m "message"'],
  ['blocked pattern quoted in a commit message', 'git commit -m "revert git add -A change"'],
  ['blocked pattern in a heredoc body', 'cat <<EOF\ngit add -A\nEOF'],
  ['grep -A after the word add', 'git log --oneline | grep add -A 3'],
  ['grep -A with a global flag', 'git --no-pager log | grep add -A 3'],
  ['unrelated command', 'npm run check'],
  // The shipped force-push extraRule must leave the safe forms alone.
  ['plain push', 'git push origin main'],
  ['push with bundled short flags but no -f', 'git push -u origin main'],
  ['push --force-with-lease', 'git push --force-with-lease'],
  ['push --force-with-lease before the remote', 'git push --force-with-lease origin main'],
  ['push --force-with-lease=<ref>', 'git push --force-with-lease=main origin main'],
  ['push --force-if-includes --force-with-lease', 'git push --force-if-includes --force-with-lease origin main'],
  ['reading core.hooksPath', 'git config --get core.hooksPath'],
  ['-n and core.hooksPath quoted in a commit message', "git commit -m 'mention git config core.hooksPath and -n'"],
  ['-n on a later command in the chain', 'git commit -m x && ls -n'],
  ['git log -n', 'git log -n 3'],
  ['commit -am with a global flag', 'git -C . commit -am x'],
  // v2.1 — a flag on a LATER chained command belongs to that command.
  ['add -p by path', 'git add -p src/app/foo.ts'],
  ['add ./dir', 'git add ./src'],
  ['commit then git log -n', 'git commit -m "x" && git log --oneline -n 3'],
  ['commit then grep -rn', 'git commit -m "x"; grep -rn foo src'],
  ['add by path then ls -A', 'git add src/app/foo.ts && ls -A'],
  ['push then echo +done', 'git push origin main && echo +done'],
  ['commit, push, grep -n', 'git commit -m "x" && git push origin main && grep -n foo bar'],
  ['push --follow-tags', 'git push --follow-tags'],
  ['core.hooksPath quoted in a commit message', 'git commit -m "docs: never git -c core.hooksPath=x"'],
  ['core.hooksPath in a heredoc body', "cat > x.md <<'EOF'\ngit -c core.hooksPath=/dev/null commit\nEOF"],
  ['--amend in a heredoc message', "git commit -F - <<'EOF'\nnever run git commit --amend\nEOF"],
  // v2.6: shell hand-offs aren't unwrapped; the pre-commit layer is the backstop.
  ['bash -c wrapping commit -n', "bash -c 'git commit -anm x'"],
  ['sh -c wrapping a bulk add', 'sh -c "git add -A && git commit -m x"'],
  ['eval wrapping commit -n', 'eval "git commit -anm x"'],
  ['zsh -lc wrapping core.hooksPath', "zsh -lc 'git -c core.hooksPath=/dev/null commit -am x'"],
  ['a heredoc script fed to bash', "bash <<'EOF'\ngit commit -anm x\nEOF"],
  ['a script piped to bash', "echo 'git commit -anm x' | bash"],
  ['nested wrappers', `bash -c "sh -c 'git commit -n'"`],
  ['a shell without git', "bash -lc 'echo hi'"],
  ['a wrapper quoted inside a commit message', `git commit -m 'use bash -c "git commit -n"'`],
  ['a shell running a script file', 'bash scripts/release.sh'],
  ['"| sh" inside a quoted string', 'echo "hi | sh"'],
  // v3.1 — a git config with no value and no write option reads core.hooksPath.
  ['git config core.hooksPath (a read)', 'git config core.hooksPath'],
  ['read with a scope flag', 'git config --local core.hooksPath'],
  ['read with --global', 'git config --global core.hooksPath'],
  ['read with --show-origin', 'git config --show-origin core.hooksPath'],
  ['read with --type=path', 'git config --type=path core.hooksPath'],
  ['the get subcommand', 'git config get core.hooksPath'],
  ['read, stderr redirected', 'git config core.hooksPath 2>/dev/null'],
  ['read, 2>&1', 'git config core.hooksPath 2>&1'],
  ['read, || fallback', 'git config core.hooksPath || echo unset'],
  ['read, then another command', 'git config core.hooksPath; ls .githooks'],
  ['read inside $(…) in a string', `echo "hooksPath = '$(git config core.hooksPath)'"`],
  // v3.4 — the env route and the shell-expanded options are the pre-commit layer's, not the guard's.
  ['GIT_CONFIG_PARAMETERS naming core.hooksPath', `GIT_CONFIG_PARAMETERS="'core.hooksPath=/dev/null'" git commit -m x`],
  ['GIT_CONFIG_KEY_<n> naming core.hooksPath', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git commit -m x'],
  ['an abbreviated option (--unset-a)', 'git config --unset-a core.hooksPath'],
  ['an abbreviated option (--rep)', 'git config --rep core.hooksPath'],
  ['an option from a variable', 'git config $OP core.hooksPath'],
  ['an option from a command substitution', 'git config `echo --unset` core.hooksPath'],
  ['an option from a brace expansion', 'git config --unset{,-all} core.hooksPath'],
  ['an option from a zsh glob group', 'git config --(unset) core.hooksPath'],
  ['Hatedate 07-11: a plain read after a cat', 'cat .githooks/pre-commit 2>/dev/null || ls .githooks/ .git/hooks/ 2>/dev/null; git config core.hooksPath'],
];

describe('git-guard', () => {
  it('the embedded gitGuard block matches config.example.json', { skip: !existsSync(EXAMPLE_CONFIG) }, () => {
    const { gitGuard } = JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8'));
    assert.deepStrictEqual(Object.keys(gitGuard).filter((k) => k !== '$comment'), ['extraRules']);
    assert.deepStrictEqual(
      gitGuard.extraRules.map(({ pattern, message }) => ({ pattern, message })),
      GIT_GUARD.extraRules,
    );
  });

  for (const [name, command] of BLOCKED) {
    it(`blocks ${name}`, () => {
      assert.strictEqual(guard(command), 2);
    });
  }

  for (const [name, command] of ALLOWED) {
    it(`allows ${name}`, () => {
      assert.strictEqual(guard(command), 0);
    });
  }

  for (const [name, command, re] of WARNED) {
    it(`warns on ${name}`, () => {
      const c = runGuard(command);
      assert.strictEqual(c.status, 0, c.stderr);
      const out = JSON.parse(c.stdout);
      assert.deepStrictEqual(Object.keys(out), ['hookSpecificOutput']);
      assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
      assert.match(out.hookSpecificOutput.additionalContext, re);
      assert.match(out.hookSpecificOutput.additionalContext, /^\[ssdd-git-guard\] /);
      const u = runGuard(command, 'cursor');
      assert.strictEqual(u.status, 0, u.stderr);
      const body = JSON.parse(u.stdout);
      assert.strictEqual(body.permission, 'allow');
      assert.match(body.agent_message, re);
    });
  }

  it('two warnings in one call join with a newline', () => {
    const c = runGuard('git add -A && git commit --amend');
    assert.strictEqual(c.status, 0);
    const lines = JSON.parse(c.stdout).hookSpecificOutput.additionalContext.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.match(lines[0], /stage/);
    assert.match(lines[1], /amend/);
  });

  it('a block wins over a warning in the same call, with no warning printed', () => {
    for (const command of ['git add -A && git commit -n -m x', 'git add -A && git push --force']) {
      const c = runGuard(command);
      assert.strictEqual(c.status, 2, command);
      assert.strictEqual(JSON.parse(c.stdout).permission, 'deny');
      assert.doesNotMatch(c.stdout, /additionalContext/);
    }
  });

  it('a warning names nothing it should not: a quoted mention and a path add stay silent', () => {
    for (const command of ['git commit -m "revert git add -A"', 'git add src/a.ts', "git commit -F - <<'EOF'\nnever run git commit --amend\nEOF"]) {
      const c = runGuard(command);
      assert.deepEqual([c.status, c.stdout], [0, ''], command);
    }
  });

  for (const [name, command] of BLOCKED) {
    it(`blocks Cursor payload: ${name}`, () => {
      assert.strictEqual(cursorGuard(command), 2);
    });
  }

  for (const [name, command] of ALLOWED) {
    it(`allows Cursor payload: ${name}`, () => {
      assert.strictEqual(cursorGuard(command), 0);
    });
  }

  it('a wrong-type section elsewhere keeps extraRules on', () => {
    const file = join(REPO, '.ssdd', 'config.json');
    writeFileSync(file, JSON.stringify({ routing: {}, gitGuard: GIT_GUARD }));
    try {
      assert.strictEqual(guard('git push --force origin main'), 2);
    } finally {
      writeFileSync(file, JSON.stringify({ gitGuard: GIT_GUARD }));
    }
  });

  it('strips a UTF-8 BOM on Cursor stdin', () => {
    assert.strictEqual(cursorGuard('git commit --no-verify', { bom: true }), 2);
    assert.strictEqual(cursorGuard('git add src/foo.ts', { bom: true }), 0);
  });

  it('an allow prints nothing under Claude Code, a permission body under Cursor', () => {
    const out = (payload) => spawnSync(NODE, [HOOK], {
      input: JSON.stringify(payload), cwd: REPO, env: { ...process.env, CLAUDE_PROJECT_DIR: REPO }, encoding: 'utf8',
    });
    for (const p of [{ tool_input: { command: 'ls' } }, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } },
      { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(REPO, 'src/a.ts') } }]) {
      const r = out(p);
      assert.deepEqual([r.status, r.stdout], [0, ''], JSON.stringify(p));
    }
    const c = out({ command: 'git status', hook_event_name: 'beforeShellExecution' });
    assert.strictEqual(c.status, 0);
    assert.strictEqual(JSON.parse(c.stdout).permission, 'allow');
  });

  it('deny JSON includes Cursor snake_case keys and keeps camelCase', () => {
    const { status, stdout } = spawnSync(NODE, [HOOK], {
      input: JSON.stringify({ tool_input: { command: 'git commit --no-verify' } }),
      cwd: REPO,
      env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
      encoding: 'utf8',
    });
    assert.strictEqual(status, 2);
    const out = JSON.parse(stdout);
    assert.strictEqual(out.permission, 'deny');
    assert.match(out.agentMessage, /--no-verify/);
    assert.strictEqual(out.agent_message, out.agentMessage);
    assert.strictEqual(out.user_message, out.userMessage);
  });
});

// The guard follows the working-tree config, and only extraRules is in it.
describe('git-guard: the working-tree config', () => {
  let base; let repo;
  const makeRepo = (extra = {}) => {
    base = mkdtempSync(join(tmpdir(), 'ssdd-guard-cfg-'));
    repo = join(base, 'repo');
    mkdirSync(join(repo, '.ssdd'), { recursive: true });
    const g = (...args) => {
      const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    };
    g('init', '-q');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('config', 'commit.gpgsign', 'false');
    // HEAD holds the config; the cases below edit the working-tree copy.
    writeFileSync(join(repo, '.ssdd', 'config.json'), JSON.stringify({ routing, ...extra }));
    writeFileSync(join(repo, 'README'), 'base\n');
    g('add', 'README', '.ssdd/config.json');
    g('commit', '-qm', 'base');
  };
  const setConfig = (body) => writeFileSync(join(repo, '.ssdd', 'config.json'), JSON.stringify(body));
  const routing = [{ reviewer: 'alpha-reviewer', paths: ['^src/'] }];
  const hook = (payload) => spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ ...payload, cwd: repo }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  const bash = (command) => hook({ tool_input: { command } });
  const warning = (r) => JSON.parse(r.stdout).hookSpecificOutput?.additionalContext;
  afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); base = null; });

  it('an unstaged extraRules entry takes effect', () => {
    makeRepo();
    assert.strictEqual(bash('make deploy').status, 0);
    setConfig({ routing, gitGuard: { extraRules: [{ pattern: '\\bmake\\s+deploy\\b', message: 'Blocked: no deploys from here.' }] } });
    const r = bash('make deploy');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /no deploys from here/);
  });

  it('a broken config keeps --no-verify blocked and warns on add -A', () => {
    makeRepo();
    writeFileSync(join(repo, '.ssdd', 'config.json'), '{ nope');
    assert.strictEqual(bash('git commit --no-verify').status, 2);
    assert.strictEqual(bash('git add .').status, 0);
    assert.match(warning(bash('git add -A')), /stage/);
    assert.match(warning(bash('git commit --amend')), /amend/);
  });

  it('blockNoVerify: false no longer turns the block off', () => {
    makeRepo();
    // Every key the guard used to read, set the way that used to change it.
    const old = {
      routing,
      gitGuard: { blockNoVerify: false, blockAmend: true, blockBulkAdd: false, blockHooksPath: false },
      reviewGate: { stamping: 'hooks' },
    };
    for (const where of ['working tree', 'HEAD']) {
      if (where === 'HEAD') {
        spawnSync('git', ['-C', repo, 'commit', '-qam', 'old keys'], { encoding: 'utf8' });
      } else setConfig(old);
      assert.strictEqual(bash('git commit -n -m x').status, 2, where);
      assert.strictEqual(bash('git -c core.hooksPath=/dev/null commit -m x').status, 2, where);
      assert.strictEqual(bash('git config core.hooksPath /x').status, 2, where);
      assert.match(warning(bash('git add -A')), /stage/, where);
      const amend = bash('git commit --amend');
      assert.strictEqual(amend.status, 0, where);   // blockAmend: true blocks nothing now
      assert.match(warning(amend), /amend/, where);
      // reviewGate.stamping "hooks" no longer guards --stamp or the stamp files.
      for (const command of ['node .ssdd/hooks/review-gate.mjs --stamp alpha-reviewer', 'echo {} > .git/ssdd-review-stamp.json', 'rm -rf .git/ssdd-review-dispatch']) {
        const r = bash(command);
        assert.deepEqual([r.status, r.stdout], [0, ''], `${where}: ${command}`);
      }
    }
  });

  it('an Edit payload on .git/ssdd-review-stamp.json is allowed (stale wiring is harmless)', () => {
    makeRepo();
    for (const tool_name of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      const r = hook({ hook_event_name: 'PreToolUse', tool_name, tool_input: { file_path: join(repo, '.git/ssdd-review-stamp.json'), content: '{}' } });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], tool_name);
    }
    const cursor = hook({ hook_event_name: 'afterFileEdit', file_path: join(repo, '.git/ssdd-review-stamp.json') });
    assert.strictEqual(cursor.status, 0);
  });
});
