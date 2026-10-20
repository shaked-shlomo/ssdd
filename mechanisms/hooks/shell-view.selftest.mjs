// Tests for shell-view.mjs: every simple command a shell string would run,
// nested ones included, and the texts it can't read.
// Run: node --test mechanisms/hooks/shell-view.selftest.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shellCommands } from './shell-view.mjs';

const lines = (cmd) => shellCommands(cmd).commands.map((w) => w.join(' '));
const runs = (cmd, text) => lines(cmd).includes(text);
const startsSupabase = (cmd) => shellCommands(cmd).commands.some((w) => w[0] === 'supabase');
const via = (cmd, text) => shellCommands(cmd).commands.find((w) => w.join(' ') === text)?.via;

describe('shellCommands', () => {
  it('top-level commands', () => {
    const cmd = 'cd /tmp && supabase db push | tail -5';
    assert.ok(runs(cmd, 'cd /tmp'));
    assert.ok(runs(cmd, 'supabase db push'));
    assert.ok(runs(cmd, 'tail -5'));
    assert.equal(via(cmd, 'supabase db push'), 'top');
    assert.deepEqual(shellCommands(cmd).unparsed, []);
  });

  it('a -c script, env -S and eval are commands', () => {
    assert.equal(via("bash -c 'supabase db push'", 'supabase db push'), '-c');
    assert.equal(via('sh -c "supabase functions deploy x"', 'supabase functions deploy x'), '-c');
    assert.equal(via("bash -lc 'supabase db push'", 'supabase db push'), '-c');
    assert.equal(via("env -S 'supabase functions deploy x'", 'supabase functions deploy x'), '-c');
    assert.equal(via("eval 'supabase db push'", 'supabase db push'), 'eval');
  });

  it('substitutions are commands', () => {
    assert.equal(via('out="$(supabase db push)"; echo "$out"', 'supabase db push'), 'subst');
    assert.equal(via('echo "`supabase db push`"', 'supabase db push'), 'subst');
    assert.ok(runs('x=$(echo $(supabase functions deploy f))', 'supabase functions deploy f'));
    assert.equal(via('cat <<EOF\n$(supabase db push)\nEOF', 'supabase db push'), 'subst');
    assert.equal(via('echo `supabase db push`', 'supabase db push'), 'subst');
  });

  it('a heredoc fed to a shell is commands', () => {
    assert.equal(via('bash <<EOF\nsupabase db push\nEOF', 'supabase db push'), 'heredoc');
    assert.equal(via("sh -s <<'X'\nsupabase db push\nX", 'supabase db push'), 'heredoc');
  });

  it('data heredocs are not commands', () => {
    for (const cmd of [
      "git commit -F - <<'EOF'\nfix: supabase db push docs\nEOF",
      "cat <<'EOF'\n$(supabase db push)\nEOF",
      'cat <<EOF\nsupabase db push\nEOF',
      "git commit -F - <<'EOF'\ndocs: `supabase db push` / $(supabase db push) are gone\nEOF",
    ]) {
      assert.equal(startsSupabase(cmd), false, cmd);
      assert.deepEqual(shellCommands(cmd).unparsed, [], cmd);
    }
  });

  it('a PR body inside "$(cat <<EOF …)" is data, quotes and parentheses included', () => {
    const cmd = 'gh pr create --title t --body "$(cat <<\'EOF\'\n## Why\nThe guard said "run supabase db push (prod)" and it\'s wrong.\nEOF\n)"';
    assert.equal(startsSupabase(cmd), false);
    assert.deepEqual(shellCommands(cmd).unparsed, []);
    assert.ok(runs(cmd, "gh pr create --title t --body $(cat <<'EOF'\n## Why\nThe guard said \"run supabase db push (prod)\" and it's wrong.\nEOF\n)"));
  });

  it('quoted text is data', () => {
    assert.equal(startsSupabase('git commit -m "supabase db push is gone"'), false);
    assert.equal(startsSupabase("grep -n 'supabase db push' README.md"), false);
    assert.ok(runs('git commit -m "supabase db push is gone"', 'git commit -m supabase db push is gone'));
  });

  it('keeps < inside quotes and marks quoted words', () => {
    const [w] = shellCommands('supabase db query --linked "select 1 where a << 2 and b < c"').commands;
    assert.equal(w[4], 'select 1 where a << 2 and b < c');
    assert.deepEqual(w.quoted, [false, false, false, false, true]);
  });

  it('a parenthesis inside quotes in $(…) is read', () => {
    const cmd = 'for f in a b; do x=$(grep -c "f(" "$f"); echo $x supabase; done';
    assert.deepEqual(shellCommands(cmd).unparsed, []);
    assert.ok(runs(cmd, 'grep -c f( $f'));
  });

  it('arithmetic is not a heredoc', () => {
    const cmd = 'echo $((1<<2))\nsupabase db push\n2';
    assert.ok(runs(cmd, 'supabase db push'));
    assert.deepEqual(shellCommands(cmd).unparsed, []);
    assert.ok(runs('echo $[1<<2]\nsupabase db push\n2', 'supabase db push'));
  });

  it('a here-string is not a heredoc', () => {
    assert.ok(runs('cat <<< x\nsupabase db push\nx', 'supabase db push'));
  });

  it('comments are dropped, and a << in one is no heredoc', () => {
    const cmd = 'cd /tmp # <<y\nsupabase db push\ny';
    assert.ok(runs(cmd, 'supabase db push'));
    assert.equal(lines(cmd).some((l) => l.includes('#')), false);
  });

  it('a fake << in quotes is no heredoc', () => {
    assert.ok(runs("echo '<<y'; supabase db push\ny", 'supabase db push'));
    assert.ok(runs('echo "<<y"; supabase db push\ny', 'supabase db push'));
  });

  it('a substitution keeps its text in the word', () => {
    const [w] = shellCommands('supabase db query --linked "$(cat q.sql)"').commands;
    assert.equal(w[4], '$(cat q.sql)');
  });

  it('what it cannot read is unparsed', () => {
    for (const cmd of ["echo 'unbalanced; supabase db push", 'echo "$(supabase db push"', 'cat <<EOF\nno end', 'echo `x']) {
      assert.equal(shellCommands(cmd).unparsed.length, 1, cmd);
    }
  });

  it('nesting past maxDepth is unparsed', () => {
    let cmd = 'supabase db push';
    for (let i = 0; i < 6; i++) cmd = `bash -c ${JSON.stringify(cmd)}`;
    const { unparsed } = shellCommands(cmd);
    assert.equal(unparsed.length, 1);
    assert.match(unparsed[0], /supabase db push/);
  });

  it('never throws', () => {
    for (const cmd of ['', '\\', '"', "'", '$(', '`', '<<', '<<-', '$((', ')', 'a\\\nb', null, undefined, 42]) {
      assert.doesNotThrow(() => shellCommands(cmd), String(cmd));
    }
  });
});
