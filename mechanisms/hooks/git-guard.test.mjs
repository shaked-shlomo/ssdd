// Regression tests for the SSDD git guard. Each case feeds a PreToolUse(Bash)
// payload on stdin and asserts the exit code: 2 = blocked, 0 = allowed.
//
// The guard runs against a scratch git repo with its own .ssdd/config.json, so
// the extraRules cases (force push) pin the framework's shipped pattern rather
// than whatever a host project happens to configure. The block is embedded
// (install copies this file into a project's .ssdd/hooks/, where
// config.example.json is not a sibling); when it IS a sibling — in the
// framework repo — one case checks the embedded copy has not drifted from it.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 18.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const hooksDir = dirname(fileURLToPath(import.meta.url));
const HOOK = join(hooksDir, 'git-guard.mjs');
const EXAMPLE_CONFIG = join(hooksDir, '..', 'config.example.json');
const NODE = process.execPath;

// Mirrors mechanisms/config.example.json → gitGuard (minus $comment keys).
const GIT_GUARD = {
  blockBulkAdd: true,
  blockNoVerify: true,
  blockAmend: true,
  blockHooksPath: true,
  extraRules: [
    {
      // --force (not --force-with-lease / --force-if-includes), bundled short -f, +refspec.
      pattern: String.raw`\bgit\s+push\b[^\n]*(\s--force(?![-\w])|\s-[a-zA-Z]*f[a-zA-Z]*(?=\s|$)|\s\+[^\s+])`,
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
  ['bulk add -A', 'git add -A'],
  ['bulk add .', 'git add .'],
  ['bulk add --all', 'git add --all'],
  ['commit --no-verify', 'git commit -m x --no-verify'],
  ['commit --amend', 'git commit --amend'],
  ['force push', 'git push origin main --force'],
  // Bypasses via tokens between `git`/subcommand/flag — the class this suite pins.
  ['global flag before add', 'git -C /tmp/x add -A'],
  ['-c config before add', 'git -c user.name=x add --all'],
  ['--git-dir=<p> before add', 'git --git-dir=/tmp/x/.git add .'],
  ['--work-tree <p> before add', 'git --work-tree /tmp/x add -A'],
  ['--git-dir <p> before add', 'git --git-dir /tmp/x/g add --all'],
  ['stacked global flags before add', 'git --no-pager -c a=b --work-tree /tmp/x add -A'],
  ['flag between add and -A', 'git add --force -A'],
  ['bundled short flags', 'git add -vA'],
  ['bundled short flags reversed', 'git add -Av'],
  ['global flag before commit --amend', 'git -C /tmp/x commit --amend'],
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
];

describe('git-guard', () => {
  it('the embedded gitGuard block matches config.example.json', { skip: !existsSync(EXAMPLE_CONFIG) }, () => {
    const { gitGuard } = JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8'));
    for (const toggle of ['blockBulkAdd', 'blockNoVerify', 'blockAmend', 'blockHooksPath']) {
      assert.strictEqual(gitGuard[toggle], GIT_GUARD[toggle], toggle);
    }
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

  it('strips a UTF-8 BOM on Cursor stdin', () => {
    assert.strictEqual(cursorGuard('git add -A', { bom: true }), 2);
    assert.strictEqual(cursorGuard('git add src/foo.ts', { bom: true }), 0);
  });

  it('deny JSON includes Cursor snake_case keys and keeps camelCase', () => {
    const { status, stdout } = spawnSync(NODE, [HOOK], {
      input: JSON.stringify({ tool_input: { command: 'git add -A' } }),
      cwd: REPO,
      env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
      encoding: 'utf8',
    });
    assert.strictEqual(status, 2);
    const out = JSON.parse(stdout);
    assert.strictEqual(out.permission, 'deny');
    assert.match(out.agentMessage, /git add -A/);
    assert.strictEqual(out.agent_message, out.agentMessage);
    assert.strictEqual(out.user_message, out.userMessage);
  });
});
