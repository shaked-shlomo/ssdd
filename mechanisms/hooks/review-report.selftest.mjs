// Tests for review-report: a reviewer's reply → its verdict, findings and
// answers (spec v3.5, Decision 2, Clarify 2).
// Run: node --test mechanisms/hooks/review-report.selftest.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, parseVerdict, sameFinding } from './review-report.mjs';

const ROOT = '/abs/root';
const parse = (text) => parseReport(text, { root: ROOT });
const one = (line, verdict = '1 ISSUE(S)') => {
  const r = parse(`${line}\n\n${verdict}`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.findings.length, 1, `findings of ${JSON.stringify(line)}`);
  return r.findings[0];
};

describe('the verdict', () => {
  for (const [name, text, want] of [
    ['CLEAN', '✅ naming\nCLEAN', { verdict: 'CLEAN', issues: 0 }],
    ['SECURE', 'SECURE', { verdict: 'SECURE', issues: 0 }],
    ['bold N ISSUE(S)', 'x\n**3 ISSUE(S)**', { verdict: 'ISSUES', issues: 3 }],
    ['Verdict: 2 RISKS', 'Verdict: 2 RISKS', { verdict: 'RISKS', issues: 2 }],
    ['1 ISSUE', '1 ISSUE', { verdict: 'ISSUES', issues: 1 }],
    ['within the last three non-empty lines', 'CLEAN\n\nnote one\nnote two', { verdict: 'CLEAN', issues: 0 }],
  ]) {
    it(name, () => {
      assert.deepEqual(parseVerdict(text), want);
      const r = parse(text);
      assert.equal(r.verdict, want.verdict);
      assert.equal(r.issues, want.issues);
    });
  }
  it('NO DIFF is an error', () => {
    assert.equal(parseVerdict('NO DIFF — scope not provided'), null);
    assert.match(parse('NO DIFF — scope not provided').error, /NO DIFF/);
  });
  it('no verdict is an error', () => {
    assert.match(parse('❌ a — src/a.ts:1 — b\nlooks fine to me').error, /no verdict/);
    assert.match(parse('CLEAN\none\ntwo\nthree').error, /no verdict/);
  });
  it('a sentence starting with "Clean" is not a verdict', () => {
    assert.equal(parseVerdict('❌ race — src/a.ts:1\nClean up later.'), null);
  });
  it('an empty report is an error', () => {
    assert.match(parse('').error, /empty/);
    assert.match(parse(' \n\n').error, /empty/);
  });
});

describe('the documented forms', () => {
  it("convention's", () => {
    assert.deepEqual(one('❌ tokens — src/a.ts:12 — use the color token'),
      { kind: '❌', tag: null, path: 'src/a.ts', line: [12, 12], text: 'tokens — src/a.ts:12 — use the color token' });
  });
  it("security's, severity and a range", () => {
    const f = one('❌ Critical secret in client — src/a.ts:3-9 — move it server-side', '1 RISK(S)');
    assert.equal(f.path, 'src/a.ts');
    assert.deepEqual(f.line, [3, 9]);
    assert.match(f.text, /^Critical secret/);
  });
  it("docs-sync's doc citation: a path, no line", () => {
    const f = one('❌ README install — the new flag is missing — docs/usage.md § Install');
    assert.equal(f.path, 'docs/usage.md');
    assert.equal(f.line, null);
  });
  it("gate's", () => {
    const f = one('❌ routing — .ssdd/config.json:14 — what loosened, and the go-ahead it needs');
    assert.equal(f.path, '.ssdd/config.json');
    assert.deepEqual(f.line, [14, 14]);
  });
  it('⚠️ is a finding of its own kind', () => {
    assert.equal(one('⚠️ judgment — src/a.ts:2 — maybe', 'CLEAN').kind, '⚠️');
  });
});

describe('markup', () => {
  for (const line of [
    '### ❌ tokens — src/a.ts:4 — fix',
    '**❌ 1. tokens — src/a.ts:4 — fix**',
    '1. ❌ **tokens** — src/a.ts:4 — fix',
    '- ❌ tokens — src/a.ts:4 — fix',
    '`❌ tokens — src/a.ts:4` — fix',
    '| ❌ tokens | src/a.ts:4 | fix |',
    '> ❌ tokens — `src/a.ts:4` — fix',
  ]) {
    it(JSON.stringify(line), () => {
      const f = one(line);
      assert.equal(f.kind, '❌');
      assert.equal(f.path, 'src/a.ts');
      assert.deepEqual(f.line, [4, 4]);
      assert.doesNotMatch(f.text, /\*\*|`/);
    });
  }
  it('⚠ without U+FE0F', () => {
    assert.equal(one('⚠ judgment — src/a.ts:2', 'CLEAN').kind, '⚠️');
  });
});

describe('places', () => {
  it('an absolute path under the root becomes relative', () => {
    const f = one('❌ race — /abs/root/src/a.ts:7 — guard it');
    assert.equal(f.path, 'src/a.ts');
    assert.deepEqual(f.line, [7, 7]);
  });
  it('a path outside the root is kept as written', () => {
    assert.equal(one('❌ race — /elsewhere/x.ts:7 — guard it').path, '/elsewhere/x.ts');
  });
  it('the path on the line after the finding', () => {
    const r = parse('**❌ Orphaned continuation mutates a latch**\nThe store at `src/store.ts:196` resets it.\n\n1 ISSUE(S)');
    assert.equal(r.findings[0].path, 'src/store.ts');
    assert.deepEqual(r.findings[0].line, [196, 196]);
    assert.equal(r.findings[0].text, 'Orphaned continuation mutates a latch');
  });
  it('none before the next finding or a blank line', () => {
    const r = parse('❌ first, no place\n❌ second — src/b.ts:2\n❌ third\n\nsrc/c.ts:9 is unrelated\n\n3 ISSUE(S)');
    assert.deepEqual(r.findings.map((f) => f.path), [null, 'src/b.ts', null]);
  });
  it('a time or a version is not a place', () => {
    const f = one('❌ ran at 10:30 on v3.5 — no file');
    assert.equal(f.path, null);
  });
  it('a path with a space inside backticks', () => {
    const f = one('❌ naming — `src/my file.ts:3` — rename');
    assert.equal(f.path, 'src/my file.ts');
  });
});

describe('not findings', () => {
  it('counts in prose, the verdict line, a clean dimension', () => {
    const r = parse('✅ naming\nWhy ⚠️ not ❌ — the guard holds.\n**4 ISSUE(S)** (1 ❌, 3 ⚠️)');
    assert.deepEqual(r.findings, []);
    assert.equal(r.issues, 4);
  });
});

describe('tags and answers', () => {
  it('[pre-existing] is a tag', () => {
    const f = one('❌ [pre-existing] Critical leak — src/a.ts:2 — fix', '1 RISK(S)');
    assert.equal(f.tag, 'pre-existing');
    assert.match(f.text, /^Critical leak/);
  });
  it('✅ [F3] fixed and ✅ [F3] close F3', () => {
    assert.deepEqual(parse('✅ [F3] fixed\n- ✅ **[F4]**\nCLEAN').answers, [{ id: 'F3', fixed: true }, { id: 'F4', fixed: true }]);
  });
  it('❌ [F3] keeps F3 open and makes no new finding', () => {
    const r = parse('❌ [F3] still racy — the guard reads stale state\n\n1 ISSUE(S)');
    assert.deepEqual(r.answers, [{ id: 'F3', fixed: false }]);
    assert.deepEqual(r.findings, []);
  });
});

describe('text', () => {
  it('is capped at 300 characters', () => {
    assert.equal(one(`❌ ${'x'.repeat(400)}`).text.length, 300);
  });
});

describe('sameFinding', () => {
  it('markup and case aside', () => {
    assert.equal(sameFinding('**Missing timeout** — `src/a.ts:1`', 'missing  timeout — src/a.ts:1'), true);
    assert.equal(sameFinding('Missing timeout', 'Missing retry'), false);
  });
});
