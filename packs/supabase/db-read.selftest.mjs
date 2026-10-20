// Tests for db-read.mjs, the read path that never asks, and for
// personalReads through the guard. The Supabase CLI is a fake that records
// its arguments and the SQL file it was given (SSDD_SUPABASE_BIN).
// Run: node --test packs/supabase/db-read.selftest.mjs
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { both, makeLayout } from './test-layout.mjs';

const PERSONAL = { tables: ['auth.users'], columns: ['phone'] };
let L;
let FAKE;
let OUT;
before(() => {
  L = makeLayout({ config: { productionGuard: { supabase: { personalReads: PERSONAL } } } });
  OUT = join(L.tmp, 'cli.json');
  FAKE = join(L.tmp, 'fake-supabase');
  writeFileSync(FAKE, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const f = args[args.indexOf('-f') + 1];
fs.writeFileSync(${JSON.stringify(OUT)}, JSON.stringify({ args, sql: fs.readFileSync(f, 'utf8'), file: f }));
process.exit(Number(process.env.FAKE_STATUS ?? 0));
`);
  chmodSync(FAKE, 0o755);
});
after(() => L.cleanup());

function dbRead(args, env = {}) {
  try { writeFileSync(OUT, ''); } catch { /* first run */ }
  const r = spawnSync(process.execPath, [join(L.repo, '.ssdd', 'packs', 'supabase', 'db-read.mjs'), ...args], {
    cwd: L.repo, encoding: 'utf8', env: { ...process.env, SSDD_SUPABASE_BIN: FAKE, ...env },
  });
  const text = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  return { status: r.status, stderr: r.stderr, cli: text ? JSON.parse(text) : null };
}

describe('db-read', () => {
  it('a read runs wrapped in READ ONLY … ROLLBACK, and its temp file is removed', () => {
    const r = dbRead(['select 1']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.cli.args.slice(0, 3), ['db', 'query', '--linked']);
    assert.equal(r.cli.args[3], '-f');
    assert.equal(r.cli.sql, 'BEGIN READ ONLY;\nselect 1;\nROLLBACK;\n');
    assert.equal(existsSync(r.cli.file), false);
  });

  it('-o and --workdir pass through; the CLI status is returned', () => {
    const r = dbRead(['-o', 'json', '--workdir', '/w', 'select 1;'], { FAKE_STATUS: '3' });
    assert.equal(r.status, 3);
    assert.deepEqual(r.cli.args.slice(5), ['-o', 'json', '--workdir', '/w']);
  });

  it('a write is refused and nothing runs', () => {
    const r = dbRead(['delete from t']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /DELETE statement/);
    assert.equal(r.cli, null);
  });

  it("a COMMIT can't break out", () => {
    const r = dbRead(['select 1; commit; delete from t']);
    assert.equal(r.status, 2);
    assert.equal(r.cli, null);
  });

  it('SQL the classifier can\'t read is refused with its reason', () => {
    const r = dbRead(['select public.f()']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /calls public\.f/);
  });

  it('no SQL is a usage error', () => {
    const r = dbRead([]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
  });

  it('personal reads need --personal', () => {
    const r = dbRead(['select phone from auth.users']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /personal data.*phone/);
    assert.equal(r.cli, null);
    const ok = dbRead(['--personal', 'select phone from auth.users']);
    assert.equal(ok.status, 0, ok.stderr);
  });
});

describe('the guard and db-read', () => {
  it('db-read passes without asking', () => {
    for (const c of [
      'node .ssdd/packs/supabase/db-read.mjs "select 1"',
      `node ${join(L.repo, '.ssdd/packs/supabase/db-read.mjs')} -o json "select count(*) from supabase_migrations.schema_migrations"`,
    ]) {
      const { claude, cursor } = both(L, c);
      assert.equal(claude.decision, 'allow', `${c}\n${claude.reason}`);
      assert.equal(cursor.decision, 'allow', c);
    }
  });

  it('only the installed db-read, with nothing set on it, is the read path', () => {
    const set = L.claude('SSDD_SUPABASE_BIN=/tmp/x node .ssdd/packs/supabase/db-read.mjs "select 1"');
    assert.equal(set.decision, 'ask');
    assert.match(set.reason, /a variable set on it/);
    assert.equal(L.claude('NODE_OPTIONS=--require=/tmp/x.js node .ssdd/packs/supabase/db-read.mjs "select 1"').decision, 'ask');
    // a look-alike elsewhere is just a node script: judged like one
    const fake = L.claude('node /tmp/elsewhere/packs/supabase/db-read.mjs "https://api.supabase.com/v1/x"');
    assert.equal(fake.decision, 'ask');
    assert.match(fake.reason, /Supabase API host/);
  });

  it('--personal asks', () => {
    const { claude, cursor } = both(L, 'node .ssdd/packs/supabase/db-read.mjs --personal "select phone from auth.users"');
    assert.equal(claude.decision, 'ask');
    assert.match(claude.reason, /reads personal data/);
    assert.equal(cursor.decision, 'deny');
  });

  it('personalReads asks through db query and MCP', () => {
    const q = L.claude('supabase db query --linked "select email, phone from auth.users"');
    assert.equal(q.decision, 'ask');
    assert.match(q.reason, /supabase db query reads personal data: auth\.users, phone\./);
    assert.equal(L.claude('supabase db query --linked "select count(*) from public.matches"').decision, 'allow');
    const m = L.claudeMcp('mcp__supabase__execute_sql', { project_id: 'abcdefghijklmnopqrst', query: 'select phone from auth.users' });
    assert.equal(m.decision, 'ask');
    assert.match(m.reason, /MCP execute_sql reads personal data: auth\.users, phone/);
  });
});

describe('db-read paths the guard must still read (final review)', () => {
  it('--personal asks however the path is spelled; a variable path still passes a plain read', () => {
    for (const c of [
      'cd tmp && node ../.ssdd/packs/supabase/db-read.mjs --personal "select phone from auth.users"',
      'node $PWD/.ssdd/packs/supabase/db-read.mjs --personal "select phone from auth.users"',
    ]) {
      const r = L.claude(c);
      assert.equal(r.decision, 'ask', c);
      assert.match(r.reason, /personal/);
    }
    assert.equal(L.claude('node $PWD/.ssdd/packs/supabase/db-read.mjs "select 1"').decision, 'allow');
  });
});
