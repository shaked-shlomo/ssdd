// The Hatedate replay as a test (SPEC v3 Part 4, AC36). replay.fixture.json
// holds every call the source project's supabase-guard asked on from
// 2026-09-28 to 2026-10-17, redacted to command shapes and SQL statement
// kinds (Clarify 31), with the pack's decision on the real command. Each case
// builds SQL from the recorded kinds, checks the classifier gives it the
// recorded verdict, rebuilds the command, and runs it through the installed
// hook. Calls whose -f file is gone are counted, not judged.
// Run: node --test packs/supabase/replay.selftest.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_FRAME, PACK_DIR, makeLayout, proofOf } from './test-layout.mjs';
import { classifySql } from './sql-readonly.mjs';

const FIXTURE = JSON.parse(readFileSync(join(PACK_DIR, 'replay.fixture.json'), 'utf8'));
const OPTS = { proofFrame: EXAMPLE_FRAME, liveExtensions: FIXTURE.options.liveExtensions };
const REF = 'abcdefghijklmnopqrst';

// One statement per recorded kind.
const STATEMENT = {
  SELECT: 'SELECT 1', WITH: 'WITH x AS (SELECT 1) SELECT * FROM x', TABLE: 'TABLE t', VALUES: 'VALUES (1)',
  SHOW: 'SHOW search_path', EXPLAIN: 'EXPLAIN SELECT 1', BEGIN: 'BEGIN', 'BEGIN READ ONLY': 'BEGIN READ ONLY',
  'START TRANSACTION READ ONLY': 'START TRANSACTION READ ONLY', ROLLBACK: 'ROLLBACK', COMMIT: 'COMMIT', END: 'END',
  INSERT: 'INSERT INTO t VALUES (1)', UPDATE: 'UPDATE t SET a = 1', DELETE: 'DELETE FROM t',
  ALTER: 'ALTER POLICY p ON t TO authenticated', CREATE: 'CREATE TABLE t2 (a int)', DROP: 'DROP TABLE t2', TRUNCATE: 'TRUNCATE t',
};
function synthesize({ kinds, verdict, rule }) {
  if (verdict === 'proof') return proofOf('SELECT 1');
  const names = /^names (\w+)$/.exec(rule);
  if (verdict === 'unclear' && names) return `BEGIN READ ONLY;\nSELECT current_setting('${names[1]}');\nROLLBACK;\n`;
  return kinds.map((k) => {
    if (!(k in STATEMENT)) throw new Error(`no statement for kind ${k}`);
    return STATEMENT[k];
  }).join(';\n') + ';\n';
}
const dq = (s) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

let L;
let SP;
let REPO;
before(() => {
  L = makeLayout({ config: { productionGuard: { supabase: OPTS } } });
  SP = join(L.tmp, 'sp');
  REPO = join(L.tmp, 'repo');
  mkdirSync(SP, { recursive: true });
  mkdirSync(join(REPO, 'w'), { recursive: true });
});
after(() => L.cleanup());

function run(entry) {
  const sql = {};
  for (const s of entry.sql) {
    if (s.lost) continue;
    const text = synthesize(s);
    const c = classifySql(text, OPTS);
    assert.deepEqual({ verdict: c.verdict, rule: c.rule }, { verdict: s.verdict, rule: s.rule }, `${entry.id} ${s.ref}: synthetic SQL`);
    sql[s.ref] = text;
    const file = /^file:(.+)$/.exec(s.ref)?.[1];
    if (file) for (const dir of [SP, join(REPO, 'w')]) writeFileSync(join(dir, file), text);
  }
  if (entry.tool === 'mcp') {
    return L.claudeMcp(`mcp__supabase__${entry.mcpTool}`, { project_id: REF, query: sql.query });
  }
  const command = entry.command
    .replace(/<SQL:(\d+)>/g, (m, n) => dq(sql[`inline:${n}`]))
    .replace(/<SP>/g, SP).replace(/<REPO>/g, REPO).replace(/<TMP>/g, L.tmp).replace(/<REF>/g, REF).replace(/<SHA>/g, 'abc1234');
  return L.claude(command);
}

describe('the Hatedate replay', () => {
  for (const entry of FIXTURE.entries) {
    if (entry.unreplayable) continue;
    it(`${entry.id} ${entry.date}: ${entry.expect}${entry.kind ? ` (${entry.kind})` : ''}`, () => {
      const r = run(entry);
      assert.equal(r.decision, entry.expect, `${entry.id}: ${r.reason}`);
      if (entry.kind === 'writes') assert.match(r.reason, /writes to production outside the merge path/);
      if (entry.kind === 'unclear') assert.match(r.reason, /can't tell what/);
      if (entry.why) {
        // the whole reason, with the file's name where the fixture says "the file"
        const why = entry.why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/the file/g, '\\S+');
        assert.match(r.reason.replace(/^\[ssdd-prod-guard\] /, ''), new RegExp(`^${why}`), entry.id);
      }
    });
  }

  it('the fixture keeps only shapes: no paths, refs, ids, printed text or search patterns', () => {
    const text = JSON.stringify(FIXTURE.entries);
    assert.doesNotMatch(text, /\/Users\/|\/private\/|\/home\//, 'a real path');
    assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/, 'a UUID');
    assert.doesNotMatch(text, /(?<![\w<])[a-z]{20}(?![\w>])/, 'a project ref');
    for (const e of FIXTURE.entries) {
      for (const m of String(e.command ?? '').matchAll(/\becho\b([^;&|\n>]*)/g)) {
        assert.match(m[1].trim(), /^(?:-[ne]\s+)?(?:x|"x"|'x')?$/, `${e.id}: echo prints only x`);
      }
      for (const m of String(e.command ?? '').matchAll(/\bgrep((?:\s+-[A-Za-z]+\d*(?:\s+\d+)?)*)\s+([^\s;&|)]+)/g)) {
        assert.match(m[2], /^(?:x|"x"|'x')$/, `${e.id}: grep searches only for x`);
      }
    }
  });

  it('asks on exactly the 2 writes, the 2 rollback probes and the calls it can\'t tell', () => {
    const judged = FIXTURE.entries.filter((e) => !e.unreplayable);
    const asks = judged.filter((e) => e.expect === 'ask');
    const writes = asks.filter((e) => e.kind === 'writes');
    const probes = asks.filter((e) => /rollback probe/.test(e.note ?? ''));
    assert.equal(FIXTURE.entries.length, 88);
    assert.equal(writes.length, 2);
    assert.ok(writes.every((e) => e.sql.some((s) => /^(INSERT|DELETE) statement$/.test(s.rule))));
    assert.equal(probes.length, 2);
    assert.ok(probes.every((e) => e.kind === 'unclear' && e.sql.some((s) => /^rolled back ALTER statement$/.test(s.rule))));
    assert.equal(asks.filter((e) => e.kind === 'unclear').length, 20);
    assert.equal(judged.filter((e) => e.expect === 'allow').length, 46);
    assert.ok(judged.filter((e) => e.expect === 'allow').every((e) => e.sql.every((s) => s.lost || s.verdict === 'read' || s.verdict === 'proof')),
      'everything that passes is a read or a proof');
    assert.equal(FIXTURE.entries.filter((e) => e.unreplayable).length, 20);
  });
});
