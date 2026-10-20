// Tests for the Supabase pack's guard, end to end through the real prod-guard
// in a scratch installed layout (test-layout.mjs). Every case runs under
// Claude Code's payload (ask) and Cursor's (deny). Hatedate's supabase-guard
// suites are ported with their decisions, except where Part 4 changed them
// (SPEC v3 Part 4, Clarify 32 and 36–38).
// Run: node --test packs/supabase/guard.selftest.mjs
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('MCP', () => {
  const UUID = 'ba176f8c-ba86-458b-b61a-71583c653bd4';
  const REF = 'abcdefghijklmnopqrst';
  const mcp = (tool, input = {}, server = UUID) => L.claudeMcp(`mcp__${server}__${tool}`, input);
  const expectMcp = (r, decision, re) => {
    assert.equal(r.decision, decision, r.reason);
    if (re) assert.match(r.reason, re);
  };

  it('a Supabase call is recognized by its server name, URL, tool name or project ref', () => {
    expectMcp(mcp('pause_project', {}, 'supabase-personal'), 'ask', WRITES);
    expectMcp(L.cursorMcp('pause_project', '{}', 'mine', 'https://mcp.supabase.com/mcp'), 'deny', WRITES);
    expectMcp(mcp('apply_migration', { project_id: REF, name: 'x', query: 'create table t ()' }), 'ask', /MCP apply_migration writes/);
    expectMcp(mcp('pause_project', { project_id: REF }), 'ask', WRITES);
  });

  it("Vercel's pause_project (a projectId, a UUID server) is not Supabase's", () => {
    expectMcp(mcp('pause_project', { projectId: 'prj_x' }, '639420f9-b3d0-4316-8c54-0d01f4f795f9'), 'allow');
  });

  it('known reads pass', () => {
    for (const t of ['list_tables', 'get_advisors', 'list_migrations', 'get_project_url', 'confirm_cost']) expectMcp(mcp(t, { project_id: REF }), 'allow');
    expectMcp(mcp('search_docs', { graphql_query: '{ x }' }, 'claude_ai_Supabase'), 'allow');
  });

  it('execute_sql is judged by its SQL', () => {
    expectMcp(mcp('execute_sql', { project_id: REF, query: 'select 1' }), 'allow');
    expectMcp(mcp('execute_sql', { project_id: REF, query: 'insert into t values (1)' }), 'ask', /MCP execute_sql \(INSERT statement\) writes/);
    expectMcp(mcp('execute_sql', { project_id: REF, query: 'select public.f()' }), 'ask', /can't tell what MCP execute_sql does: calls public\.f/);
    expectMcp(L.cursorMcp('execute_sql', `{"query":"select 1","project_id":"${REF}"}`, UUID), 'allow');
    expectMcp(mcp('execute_sql', { project_id: REF }), 'ask', /no query/);
  });

  it('every other tool asks', () => {
    for (const t of ['apply_migration', 'deploy_edge_function', 'merge_branch', 'create_branch', 'delete_branch', 'reset_branch', 'rebase_branch']) {
      expectMcp(mcp(t, { project_id: REF }), 'ask', WRITES);
    }
    expectMcp(mcp('restore_project', { project_id: REF }), 'ask', WRITES);
    expectMcp(mcp('brand_new_tool', { project_id: REF }), 'ask', /can't tell what MCP brand_new_tool does/);
  });
});

describe('the HTTP APIs', () => {
  for (const c of [
    "curl -s -H \"Authorization: Bearer $TOKEN\" https://api.supabase.com/v1/projects/abc/advisors/security | python3 -c 'import json,sys; json.load(sys.stdin)'",
    'for t in security performance; do curl -s -H "Authorization: Bearer $TOKEN" https://api.supabase.com/v1/projects/abc/advisors/$t; done',
    'curl -I https://abc.supabase.co/rest/v1/t',
    'curl -G -d select=id https://abc.supabase.co/rest/v1/t',
    'curl -X POST https://example.com/x -d a',
    'wget -qO- https://api.supabase.com/v1/projects',
    'grep -rn api.supabase.com docs',
    'echo https://api.supabase.com/v1/projects/abc/database/query',
  ]) it(`passes: ${c}`, () => expectPass(L, c));

  for (const c of [
    'curl -X POST https://api.supabase.com/v1/projects/abc/database/query -d \'{"query":"select 1"}\'',
    'curl -XDELETE https://api.supabase.com/v1/projects/abc/functions/f',
    'curl --request PATCH https://api.supabase.com/v1/projects/abc',
    'curl -d a=b https://abc.supabase.co/rest/v1/t',
    'curl -sd a=b https://abc.supabase.co/rest/v1/t',
    'curl --data-binary @f https://abc.supabase.co/rest/v1/t',
    "curl --json '{}' https://abc.supabase.co/functions/v1/f",
    'curl -F a=@x https://abc.supabase.co/storage/v1/object/b/x',
    'curl -T x https://abc.supabase.co/storage/v1/object/b/x',
    'wget --method=POST https://api.supabase.com/v1/x',
    'wget --post-data=x https://abc.supabase.co/rest/v1/t',
  ]) it(`asks "writes": ${c}`, () => expectAsk(L, c, WRITES));

  for (const c of [
    'curl -X POST "$SUPABASE_URL/rest/v1/t"',
    'node -e "fetch(\'https://api.supabase.com/v1/x\',{method:\'POST\'})"',
    "python3 -c 'import urllib.request; urllib.request.urlopen(\"https://abc.supabase.co/rest/v1/t\")'",
  ]) it(`asks "can't tell": ${c}`, () => expectAsk(L, c, UNCLEAR));
});

describe('psql', () => {
  const URL_ = '"postgresql://u@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"';
  it('-c reads pass, writes ask', () => {
    expectPass(L, `psql ${URL_} -c "select 1"`);
    expectAsk(L, `psql ${URL_} -c "delete from t"`, /psql \(DELETE statement\) writes/);
  });
  it('-f is judged like db query', () => {
    expectPass(L, `psql -h aws-0-eu.pooler.supabase.com -f ${F.ro}`);
    expectAsk(L, `psql -h aws-0-eu.pooler.supabase.com -f ${F.write}`, WRITES);
  });
  it('interactive or stdin use asks', () => {
    expectAsk(L, 'psql "host=db.x.supabase.co dbname=postgres"', /interactively or from stdin/);
    expectAsk(L, `psql ${URL_} < ${F.ro}`, /interactively or from stdin/);
  });
  it("a target it can't read asks", () => expectAsk(L, 'psql "$DATABASE_URL" -c "select 1"', /isn't literal/));
  it('local psql and pg_dump pass', () => {
    expectPass(L, 'psql -h localhost -c "delete from t"');
    expectPass(L, 'psql postgres -c "drop table t"');
    expectPass(L, `pg_dump ${URL_} > dump.sql`);
  });
  it('pg_restore to a Supabase host asks', () => expectAsk(L, `pg_restore -d ${URL_} dump.tar`, WRITES));
});

describe('differentials the commit review found', () => {
  it('a flag value is not a flag', () => {
    expectAsk(L, 'supabase db push --password --dry-run', WRITES);
    expectAsk(L, 'supabase db push -p -h', WRITES);
    expectAsk(L, 'supabase db reset --linked --workdir --local', WRITES);
  });
  it('a --db-url is local only when every host in it is', () => {
    for (const url of [
      'postgres://u@localhost/db?host=db.abc.supabase.co',
      'postgres://u@localhost/db?hostaddr=1.2.3.4',
      'postgres://u@localhost,db.abc.supabase.co/db',
      'postgres://u@localhost/db?service=prod',
    ]) expectAsk(L, `supabase db query --db-url "${url}" "delete from t"`, WRITES);
    expectPass(L, 'supabase db query --db-url "postgres://u@localhost:54322/postgres?sslmode=disable" "delete from t"');
  });
  it('a command before the query may change its file', () => {
    expectAsk(L, `python3 gen.py && supabase db query --linked -f ${F.ro}`, /runs before it/);
    expectAsk(L, `cp x y; supabase db query --linked -f ${F.ro}`, /runs before it/);
    expectAsk(L, `echo hi > other.txt; supabase db query --linked -f ${F.ro}`, /runs before it/);
    expectPass(L, `cd /tmp && echo start && supabase db query --linked -f ${F.ro} | tail -3`);
  });
  it('a symlinked or hard-linked -f file asks', () => {
    const link = join(L.tmp, 'link.sql');
    symlinkSync(F.ro, link);
    expectAsk(L, `supabase db query --linked -f ${link}`, /a link/);
    const hard = join(L.tmp, 'hard.sql');
    linkSync(F.plain, hard);
    expectAsk(L, `supabase db query --linked -f ${hard}`, /a link/);
  });
  it('an upload is any cp whose destination is ss://, flags or not', () => {
    expectAsk(L, 'supabase storage cp ./a ss:///b/a --content-type text/plain', WRITES);
    expectAsk(L, 'supabase storage cp -r ./dir ss:///b/dir --cache-control 3600', WRITES);
    expectPass(L, 'supabase storage cp ss:///b/a ./a --cache-control 3600');
  });
  it('a remote command that is not a known read asks', () => {
    expectAsk(L, 'supabase test db --linked', UNCLEAR);
    expectAsk(L, 'supabase brand-new thing --project-ref abc', UNCLEAR);
    expectAsk(L, 'supabase db pull', /remote migration history/);
    for (const c of [
      'supabase inspect db locks --linked',
      'supabase gen types typescript --linked',
      'supabase migration fetch --linked',
      'supabase functions download f --project-ref abc',
      'supabase db dump --linked -f schema.sql',
      'supabase test db',
    ]) expectPass(L, c);
  });
});
