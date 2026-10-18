// Tests for plan-migrate: the v3 criteria rewrite, the to-do it reports, the
// old-format test, and the check that a migration lost no text.
// Run: node --test mechanisms/hooks/plan-migrate.selftest.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { idRange, lostText, migratePlan, needsMigration, todoFor } from './plan-migrate.mjs';

const plan = (criteria, verification = [], status = 'SHIPPED — 2026-09-01') => [
  '# Plan 09', '', `**Status:** ${status}`, '', '## Acceptance criteria', '', ...criteria, '',
  '## Verification', '', ...verification, '', '## Deviations & discoveries', '', 'none', '',
].join('\n');
const criteriaOf = (text) => {
  const lines = text.split('\n');
  return lines.slice(lines.indexOf('## Acceptance criteria') + 2, lines.indexOf('## Verification') - 1);
};

describe('migratePlan', () => {
  it('checkbox forms become canonical, numbers kept', () => {
    const r = migratePlan(plan([
      '- [ ] AC1 text', '- [x] AC2 — text', '- [ ] AC3: text', '- [x] **AC4 — title.** rest',
      '- [ ] **AC5: title** rest', '- [ ] **AC6** — text', '- **AC7 — title.** rest',
    ]));
    assert.deepEqual(criteriaOf(r.text), [
      '- **AC1** — text', '- **AC2** — text', '- **AC3** — text', '- **AC4** — **title.** rest',
      '- **AC5** — **title** rest', '- **AC6** — text', '- **AC7** — **title.** rest',
    ]);
    assert.equal(r.changed, true);
    assert.ok(r.changes.includes('AC1–AC6: checkbox dropped'), r.changes.join(' | '));
    assert.ok(r.changes.includes('AC7: reformatted'), r.changes.join(' | '));
  });

  it('a bold title that wraps keeps its ID (prizma 03, 05, 26)', () => {
    const r = migratePlan(plan(['- [x] **AC6 — a.** b', '- [x] **AC7 — a lexicon outage does not break the page, and does not',
      '  hide the story.** The test.', '- [x] **AC8 — c.** d']));
    assert.deepEqual(criteriaOf(r.text), ['- **AC6** — **a.** b', '- **AC7** — **a lexicon outage does not break the page, and does not',
      '  hide the story.** The test.', '- **AC8** — **c.** d']);
    assert.ok(!r.changes.some((c) => c.startsWith('numbered')), r.changes.join(' | '));
    assert.equal(migratePlan(r.text).changed, false);
  });

  it('keeps AC8b', () => {
    const r = migratePlan(plan(['- [x] **AC8 — a.** r', '- [x] **AC8b — t.** r']));
    assert.deepEqual(criteriaOf(r.text), ['- **AC8** — **a.** r', '- **AC8b** — **t.** r']);
  });

  it('ID-less criteria numbered in order', () => {
    const r = migratePlan(plan(['**Foundations**', '', '- [ ] x one', '- [ ] x two', '', '**Screens**', '', '- [x] x three',
      '- [ ] <criterion>']));
    assert.deepEqual(criteriaOf(r.text), ['**Foundations**', '', '- **AC1** — x one', '- **AC2** — x two', '', '**Screens**', '',
      '- **AC3** — x three', '- [ ] <criterion>']);
    assert.ok(r.changes.includes('numbered AC1–AC3'), r.changes.join(' | '));
    assert.deepEqual(r.ticked, ['AC3']);
    const n = migratePlan(plan(['1. a', '2. b']));
    assert.deepEqual(criteriaOf(n.text), ['- **AC1** — a', '- **AC2** — b']);
  });

  it('mixed plan numbers after the highest', () => {
    const r = migratePlan(plan(['- [ ] AC1 a', '- [ ] AC2b b', '- [ ] c']));
    assert.deepEqual(criteriaOf(r.text), ['- **AC1** — a', '- **AC2b** — b', '- **AC3** — c']);
    assert.ok(r.changes.includes('numbered AC3 after the existing IDs'), r.changes.join(' | '));
  });

  it('sub-bullets and continuations untouched', () => {
    const before = [
      '- [ ] Migration `0008` creates `regroup_verdicts` with RLS',
      '      enabled and **no** public read policy.',
      '  - AC5\'s sub-point stays',
      '  - [ ] a nested checkbox stays',
      '```', '- [ ] fenced, not a criterion', '```',
      '- [ ] second',
    ];
    const r = migratePlan(plan(before));
    assert.deepEqual(criteriaOf(r.text), [
      '- **AC1** — Migration `0008` creates `regroup_verdicts` with RLS', before[1], before[2], before[3],
      '```', '- [ ] fenced, not a criterion', '```', '- **AC2** — second',
    ]);
  });

  it('Verification is never touched', () => {
    const ver = ['- [ ] **AC1** — ok', '- AC2 ✅ — ok', '- [x] AC3 done'];
    const r = migratePlan(plan(['- [x] AC1 a', '- [x] AC2 b', '- [x] AC3 c'], ver));
    const lines = r.text.split('\n');
    const at = lines.indexOf('## Verification');
    assert.deepEqual(lines.slice(at + 2, at + 5), ver);
  });

  it('reports ticked IDs', () => {
    assert.deepEqual(migratePlan(plan(['- [x] AC1 a', '- [ ] AC2 b', '- [~] AC3 c', '- [-] AC4 d'])).ticked, ['AC1', 'AC3']);
  });

  it('idempotent', () => {
    const once = migratePlan(plan(['**G**', '- [x] **AC1 — t.** r', '- [ ] b', '  - sub'], ['- AC1 ✅ — ok'])).text;
    const twice = migratePlan(once);
    assert.equal(twice.changed, false);
    assert.equal(twice.text, once);
    assert.deepEqual(twice.changes, []);
  });

  it('duplicate IDs are reported, not renumbered', () => {
    const r = migratePlan(plan(['- [ ] AC2 a', '- [ ] AC2 b']));
    assert.deepEqual(criteriaOf(r.text), ['- **AC2** — a', '- **AC2** — b']);
    assert.ok(r.todo.includes('duplicate criterion IDs: AC2'), r.todo.join(' | '));
  });

  it('CRLF and BOM', () => {
    const lf = plan(['- [x] AC1 a']);
    const crlf = '﻿' + lf.replace(/\n/g, '\r\n');
    const r = migratePlan(crlf);
    assert.equal(r.text, '﻿' + migratePlan(lf).text.replace(/\n/g, '\r\n'));
    assert.equal(migratePlan(r.text).changed, false);
  });
});

describe('todoFor', () => {
  it('status outside the six', () => {
    const t = todoFor(plan(['- **AC1** — a'], ['- **AC1** — ok'], 'DONE — 2026-09-11'));
    assert.ok(t.some((x) => x.startsWith('Status "DONE — 2026-09-11" isn\'t one of the six')), t.join(' | '));
  });
  it('a closed plan needs every entry', () => {
    const t = todoFor(plan(['- **AC1** — a', '- **AC2** — b', '- **AC3** — c'], ['- **AC1** — ok']));
    assert.ok(t.includes('no Verification entry: AC2–AC3'), t.join(' | '));
  });
  it('an open plan needs entries only where it claims done', () => {
    const t = todoFor(plan(['- **AC1** — a', '- **AC2** — b', '- **AC3** — c'], [], 'IN PROGRESS'), { ticked: ['AC2'] });
    assert.ok(t.includes('no Verification entry: AC2'), t.join(' | '));
    assert.ok(!t.some((x) => /AC1|AC3/.test(x)), t.join(' | '));
  });
  it('unparsed entries are named', () => {
    const t = todoFor(plan(['- **AC1** — a', '- **AC2** — b', '- **AC3** — c'], ['- AC1 ✅ — ok', '- **AC2-AC3 (both)** ok']));
    const item = t.find((x) => x.startsWith('Verification lines'));
    assert.ok(item, t.join(' | '));
    assert.match(item, /AC1, AC2-AC3/);
    assert.match(item, /- \*\*AC1\*\* — …/);
  });
  it('a clean closed plan has nothing to do', () => {
    assert.deepEqual(todoFor(plan(['- **AC1** — a'], ['- **AC1** — `cmd` → ok'])), []);
  });
});

describe('needsMigration', () => {
  it('a checkbox criterion', () => assert.equal(needsMigration(plan(['- [ ] AC1 a'], ['- **AC1** — ok'])), true));
  it('SHIPPED with a missing entry', () => assert.equal(needsMigration(plan(['- **AC1** — a', '- **AC2** — b'], ['- **AC1** — ok'])), true));
  it('a canonical SHIPPED plan with every entry', () => assert.equal(needsMigration(plan(['- **AC1** — a'], ['- **AC1** — ok'])), false));
  it('a DRAFT with an empty criteria section', () => assert.equal(needsMigration(plan([], [], 'DRAFT — 2026-08-10')), false));
  it('an IN PROGRESS plan without entries yet', () => assert.equal(needsMigration(plan(['- **AC1** — a'], [], 'IN PROGRESS')), false));
});

describe('lostText', () => {
  it('a reformatted criterion and entry lose nothing', () => {
    const before = plan(['- [x] **AC1 — title.** rest'], ['- AC1 ✅ — npm test → ok']);
    const after = plan(['- **AC1** — **title.** rest'], ['- **AC1** ✅ — npm test → ok']);
    assert.deepEqual(lostText(before, after), []);
  });
  it('a rewritten Status keeps the old text', () => {
    assert.deepEqual(lostText(plan([], [], 'DONE — 2026-09-11'), plan([], [], 'SHIPPED — migrated 2026-10-18; was: DONE — 2026-09-11')), []);
    assert.deepEqual(lostText(plan([], [], 'DONE — 2026-09-11'), plan([], [], 'SHIPPED — 2026-09-11')), ['**Status:** DONE — 2026-09-11']);
  });
  it('a split range loses nothing', () => {
    assert.deepEqual(lostText(plan([], ['- AC1-AC2 ✅ x y']), plan([], ['- **AC1** ✅ — x y', '- **AC2** ✅ — x y'])), []);
  });
  it('a deleted Verification line is returned', () => {
    assert.deepEqual(lostText(plan([], ['- **AC1** — `cmd` → 12 pass', '- **AC2** — ok']), plan([], ['- **AC2** — ok'])),
      ['- **AC1** — `cmd` → 12 pass']);
  });
  it('an added NOT RECORDED line loses nothing', () => {
    assert.deepEqual(lostText(plan([]), plan([], ["- **AC3** — NOT RECORDED (migrated 2026-10-18): the plan's Verification didn't close this."])), []);
  });
});

describe('idRange', () => {
  it('runs and singles', () => {
    assert.equal(idRange(['AC1', 'AC2', 'AC3', 'AC5']), 'AC1–AC3, AC5');
    assert.equal(idRange(['AC1', 'AC2']), 'AC1–AC2');
    assert.equal(idRange(['AC8', 'AC8b', 'AC9']), 'AC8, AC8b, AC9');
    assert.equal(idRange([]), '');
  });
});
