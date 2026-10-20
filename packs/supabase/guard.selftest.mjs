// Tests for the Supabase pack's guard, end to end through the real prod-guard
// in a scratch installed layout (test-layout.mjs). Every case runs under
// Claude Code's payload (ask) and Cursor's (deny). Hatedate's supabase-guard
// suites are ported with their decisions, except where Part 4 changed them
// (SPEC v3 Part 4, Clarify 32 and 36–38).
// Run: node --test packs/supabase/guard.selftest.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_FRAME, both, makeLayout, proofOf } from './test-layout.mjs';
import { detect } from './detect.mjs';

const WRITES = /writes to production outside the merge path/;
const UNCLEAR = /can't tell what/;

// Asserts the decision under both harnesses → Claude Code's reason.
function expectAsk(L, command, re, opts) {
  const { claude, cursor } = both(L, command, opts);
  assert.equal(claude.decision, 'ask', `${command}\n${claude.reason}`);
  assert.equal(cursor.decision, 'deny', `${command} (Cursor)`);
  if (re) assert.match(claude.reason, re, command);
  return claude.reason;
}
function expectPass(L, command, opts) {
  const { claude, cursor } = both(L, command, opts);
  assert.equal(claude.decision, 'allow', `${command}\n${claude.reason}`);
  assert.equal(cursor.decision, 'allow', `${command} (Cursor)\n${cursor.reason}`);
}

let L;
let F; // fixture files
before(() => {
  L = makeLayout({ config: { productionGuard: { supabase: { proofFrame: EXAMPLE_FRAME } } } });
  F = {
    ro: L.file('ro.sql', 'BEGIN READ ONLY;\nselect count(*) from pg_policies;\nROLLBACK;\n'),
    plain: L.file('plain.sql', "select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;\n"),
    write: L.file('seed.sql', 'BEGIN;\nINSERT INTO t VALUES (1);\nCOMMIT;\n'),
    encoding: L.file('enc.sql', "BEGIN READ ONLY;\nSELECT current_setting('client_encoding');\nROLLBACK;\n"),
    proof: L.file('p.proof.sql', proofOf('ALTER TABLE t ADD COLUMN c int;\nSELECT true AS ok;')),
    spaced: L.file('a b/q.sql', 'select 1;\n'),
    big: L.file('big.sql', 'select 1;\n' + '-- pad\n'.repeat(160000)),
  };
});
after(() => L.cleanup());

describe('the CLI (ported)', () => {
  for (const c of [
    'supabase db push',
    'supabase db push --yes',
    'npx supabase db push',
    'npx -y supabase db push',
    'npx supabase@2.111.0 db push',
    'npx -y supabase@latest functions deploy x',
    '/opt/homebrew/bin/supabase db push',
    'SUPABASE_ACCESS_TOKEN=x supabase db push',
    'cd /tmp/x && supabase db push',
    'supabase --debug db push',
    'supabase migration repair --status applied 20260924120827',
    'supabase db reset --linked',
    'supabase functions deploy send-push',
    'supabase functions delete old-fn',
    'echo start\nsupabase functions deploy x',
    'supabase migration up --linked',
    'supabase migration down --db-url postgres://u@h/db',
    'supabase migration up --linked=true',
    'supabase config push',
    'supabase secrets set FOO=bar',
    'supabase secrets unset FOO',
    'supabase storage rm ss:///bucket/x --experimental',
    'supabase storage cp ./a ss:///bucket/a',
  ]) it(`asks "writes": ${c}`, () => expectAsk(L, c, WRITES));

  for (const c of [
    'supabase db query --linked -f out.sql',
    'supabase db query -f out.sql --linked',
    'supabase db query --db-url postgres://u@h/db -f x.sql',
    'supabase db query --linked=true -f x.sql',
  ]) it(`asks "can't tell": ${c}`, () => expectAsk(L, c, UNCLEAR));

  for (const c of [
    'supabase migration list --linked',
    'supabase migration new add_col',
    'supabase functions list',
    'supabase db query -f local.sql',
    'echo "supabase db push"',
    'git commit -m "docs: supabase db push is gone"',
    "grep -n 'supabase db push' README.md",
    "git commit -F - <<'EOF'\nsupabase functions deploy\nEOF",
    'supabase migration up',
    'supabase migration down --local',
    'supabase storage ls ss:///bucket',
    'supabase storage rm ss:///bucket/x --local',
    'supabase secrets list',
    // Part 4: these asked in the source
    'supabase migration list --linked; supabase db push --dry-run',
    'supabase db reset',
    'supabase storage cp ss:///bucket/x ./x',
  ]) it(`passes: ${c}`, () => expectPass(L, c));
});

describe('wrapped and hidden invocations (ported)', () => {
  for (const c of [
    'time supabase db push',
    'time -p supabase db push',
    'env supabase db push',
    'env -i FOO=1 supabase db push',
    'command supabase db push',
    'exec supabase db push',
    'nice -n 5 supabase db push',
    'nohup supabase db push',
    '! supabase db push',
    'bunx supabase db push',
    'pnpm dlx supabase db push',
    'yarn dlx supabase@2.111.0 db push',
    'SUPABASE db push',
    "bash -c 'supabase db push'",
    "env -S 'supabase functions deploy x'",
    "echo '<<y'; supabase db push\ny",
    'echo "<<y"; supabase db push\ny',
    'cd /tmp # <<y\nsupabase db push\ny',
    'cat <<EOF; supabase db push\nbody\nEOF',
    'bash <<EOF\nsupabase db push\nEOF',
    'cat <<< x\nsupabase db push\nx',
    'out="$(supabase db push)"; echo "$out"',
    'echo "`supabase db push`"',
    'echo $((1<<2))\nsupabase db push\n2',
    'echo $(( 1 << 2 ))\nsupabase db push\n2',
    'echo $[1<<2]\nsupabase db push\n2',
    'x=$(echo $(supabase functions deploy f))',
    'cat <<EOF\n$(supabase db push)\nEOF',
    'echo `supabase db push`',
  ]) it(`asks: ${c}`, () => expectAsk(L, c, WRITES));

  for (const c of [
    "echo 'unbalanced; supabase db push",
    'echo "$(supabase db push"',
    'echo "$(supabase db query --linked -f /x.sql)"',
  ]) it(`asks "can't tell": ${c}`, () => expectAsk(L, c, UNCLEAR));

  for (const c of [
    'echo $((1<<2))',
    "git commit -m 'docs: run `supabase db push` never'",
    "git commit -F - <<'EOF'\ndocs: `supabase db push` / $(supabase db push) are gone\nEOF",
    "git commit -F - <<'EOF'\nfix: supabase db push docs\nEOF",
    'cat <<EOF\nsupabase db push\nEOF',
    'ls supabase/migrations',
    'cd supabase && ls',
    "echo 'unbalanced",
  ]) it(`passes: ${c}`, () => expectPass(L, c));
});

describe("Part 4's fixes", () => {
  for (const c of [
    'supabase db push --help',
    'supabase db push -h',
    'supabase db push --dry-run 2>&1 | tail -5',
    'supabase db push --local',
    'supabase start',
    'supabase status',
    'supabase link --project-ref abc',
    'supabase db lint --linked',
    'supabase projects list',
  ]) it(`passes: ${c}`, () => expectPass(L, c));

  for (const c of ['supabase projects delete abc', 'supabase branches create b', 'supabase backups restore --timestamp 1']) {
    it(`a management write asks: ${c}`, () => expectAsk(L, c, WRITES));
  }

  it('a heredoc commit message or PR body naming a write passes', () => {
    expectPass(L, "git commit -F - <<'EOF'\nfix: supabase db push docs\nEOF");
    expectPass(L, 'gh pr create --title t --body "$(cat <<\'EOF\'\nRun "supabase db push" (never).\nEOF\n)"');
  });

  it('a loop whose $(…) holds a parenthesis in quotes passes', () => {
    expectPass(L, 'for f in tests/db/*.sql supabase/tests/*.sql; do a=$(grep -c "get_candidates(" "$f"); echo "$f $a"; done');
  });
});

describe('db query against production, by its SQL', () => {
  it('a READ ONLY file, piped and redirected, passes', () => expectPass(L, `supabase db query --linked -f ${F.ro} -o json 2>&1 | tail -5`));
  it('a plain SELECT file passes', () => expectPass(L, `supabase --workdir /x db query --linked -f ${F.plain} -o json 2>&1 | grep -v "new version" | tail -30`));
  it('inline SQL that reads passes', () => {
    expectPass(L, 'supabase db query --linked "select 1"');
    expectPass(L, "supabase db query --linked \"select to_regprocedure('public.f(text)') is null as gone\"");
  });
  it('a local --db-url is local', () => expectPass(L, 'supabase db query --db-url postgres://u@127.0.0.1:54322/postgres "delete from t"'));
  it('a write file asks "writes"', () => assert.match(expectAsk(L, `supabase db query --linked -f ${F.write} -o json`, WRITES), /supabase db query \(INSERT statement\)/));
  it("a client_encoding file asks \"can't tell\"", () => assert.match(expectAsk(L, `supabase db query --linked -f ${F.encoding}`, UNCLEAR), /names client_encoding/));
  it('a proof in the configured frame passes', () => expectPass(L, `supabase db query --linked -f ${F.proof} -o json`));
  it('a -f path with a space, quoted, is read', () => expectPass(L, `supabase db query --linked -f "${F.spaced}"`));
  it('a relative -f path resolves against the cwd', () => {
    expectPass(L, 'supabase db query --linked -f plain.sql', { cwd: L.tmp });
    expectAsk(L, 'cd .. && supabase db query --linked -f plain.sql', /after a cd/, { cwd: L.tmp });
  });
  for (const [name, cmd, why] of [
    ['a missing file', () => `supabase db query --linked -f ${join(L.tmp, 'nope.sql')}`, /missing/],
    ['a file over 1 MiB', () => `supabase db query --linked -f ${F.big}`, /1 MiB/],
    ['a directory', () => `supabase db query --linked -f ${L.tmp}`, /regular file/],
    ['a $VAR path', () => 'S=/tmp; supabase db query --linked -f $S/q.sql', /isn't literal/],
    ['a file written in the same call', () => `cat > ${F.ro} <<'EOF'\ndelete from t;\nEOF\nsupabase db query --linked -f ${F.ro}`, /named elsewhere/],
    ['a file edited in the same call', () => `sed -i '' 's/a/b/' ${F.plain} && supabase db query --linked -f ${F.plain}`, /named elsewhere/],
    ['two SQL sources', () => `supabase db query --linked -f ${F.ro} "select 1"`, /more than one/],
    ['stdin', () => `supabase db query --linked < ${F.ro}`, /stdin/],
    ['an expansion in inline SQL', () => 'supabase db query --linked "$(cat q.sql)"', /isn't literal/],
    ['PGOPTIONS', () => `PGOPTIONS=-csearch_path=evil supabase db query --linked -f ${F.ro}`, /PGOPTIONS/],
  ]) it(`asks "can't tell": ${name}`, () => expectAsk(L, cmd(), why));
});

describe('the proof frame comes from config', () => {
  it('without one, a proof asks', () => {
    const N = makeLayout();
    try {
      const p = N.file('p.proof.sql', proofOf('ALTER TABLE t ADD COLUMN c int;'));
      expectAsk(N, `supabase db query --linked -f ${p}`, /proof frame not configured/);
    } finally { N.cleanup(); }
  });
  it('bad options ask on supabase calls only', () => {
    const N = makeLayout({ config: { productionGuard: { supabase: { proofFrame: 'x' } } } });
    try {
      expectAsk(N, 'supabase db query --linked "select 1"', /proofFrame/);
      expectPass(N, 'ls');
    } finally { N.cleanup(); }
  });
});

describe('detect', () => {
  const dirs = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const repo = (files) => {
    const d = mkdtempSync(join(tmpdir(), 'ssdd-detect-'));
    dirs.push(d);
    for (const [p, text] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), text); }
    return d;
  };
  it('supabase/config.toml', () => assert.equal(detect(repo({ 'supabase/config.toml': 'project_id = "x"' })), 'supabase/config.toml'));
  it('@supabase/supabase-js in dependencies', () =>
    assert.equal(detect(repo({ 'package.json': JSON.stringify({ dependencies: { '@supabase/supabase-js': '^2' } }) })), 'package.json: @supabase/supabase-js'));
  it('supabase in devDependencies', () =>
    assert.equal(detect(repo({ 'package.json': JSON.stringify({ devDependencies: { supabase: '^2' } }) })), 'package.json: supabase'));
  it('neither, or a broken package.json', () => {
    assert.equal(detect(repo({ 'package.json': JSON.stringify({ dependencies: { react: '1' } }) })), '');
    assert.equal(detect(repo({ 'package.json': '{ nope' })), '');
    assert.equal(detect(repo({})), '');
  });
});
