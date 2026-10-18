// Tests for plan-parse: status words, criteria, Verification entries, ledgers.
// Run: node --test mechanisms/hooks/plan-parse.selftest.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_WORDS, STATUS_WORDS, countPlanTasks, parsePlan, parseProgress, parseSsddLedger, parseStatus,
} from './plan-parse.mjs';

const plan = (parts) => parts.join('\n') + '\n';
// The plan template: process/templates in the source tree, .ssdd/process/templates installed.
const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = [join(HERE, '..', '..', 'process', 'templates', 'plan-template.md'),
  join(HERE, '..', 'process', 'templates', 'plan-template.md')].find((f) => existsSync(f));

describe('parseStatus', () => {
  it('template line', () => {
    assert.equal(parseStatus('**Status:** DRAFT | IN PROGRESS | BUILT | SHIPPED — <date>\n').word, 'DRAFT');
  });
  it('case and blockquote', () => {
    const s = parseStatus('# Plan 34\n\n> **Status:** In progress (PR #63 open) — 2026-09-17\n');
    assert.equal(s.word, 'IN PROGRESS');
    assert.equal(s.raw, 'In progress (PR #63 open) — 2026-09-17');
  });
  it('unknown words', () => {
    const done = parseStatus('**Status:** DONE on branch x\n');
    assert.equal(done.word, null);
    assert.match(done.raw, /^DONE/);
    assert.equal(parseStatus('**Status:** AC6 FAILED — 2026-10-17\n').word, null);
  });
  it('no status line', () => {
    assert.deepEqual(parseStatus('# Plan\n\nno status here\n'), { raw: null, word: null });
  });
  it('the six words, and the open ones', () => {
    assert.deepEqual(STATUS_WORDS, ['IN PROGRESS', 'DRAFT', 'BUILT', 'SHIPPED', 'SUPERSEDED', 'ABANDONED']);
    assert.deepEqual([...OPEN_WORDS].sort(), ['BUILT', 'DRAFT', 'IN PROGRESS']);
  });
});

describe('parsePlan', () => {
  it('prizma checkbox form', () => {
    const p = parsePlan(plan(['## Acceptance criteria', '- [ ] AC1 `npm run x` writes 16 files.', '- [x] AC2 Every MP4 is H.264.']));
    assert.deepEqual(p.criteria, ['AC1', 'AC2']);
  });
  it('SSDD form', () => {
    const p = parsePlan(plan(['## Acceptance criteria', '- **AC1** — the view', '  continued line', '- **AC3 — The view.** In a scratch repo']));
    assert.deepEqual(p.criteria, ['AC1', 'AC3']);
  });
  it('entries', () => {
    const p = parsePlan(plan([
      '## Acceptance criteria', '- **AC1** — a', '- **AC2** — b', '- **AC3** — c',
      '## Verification', '- **AC1** — `cmd` → 16', '- **AC2 ✅ — V3 baseline', '- **AC3** — DEFERRED (operator): deploy first',
      '## Deviations & discoveries', '- **AC9** — not an entry',
    ]));
    assert.deepEqual([...p.entries.keys()], ['AC1', 'AC2', 'AC3']);
    assert.equal(p.entries.get('AC3').deferred, true);
    assert.equal(p.entries.get('AC1').deferred, false);
  });
  it('a criterion line is not an entry', () => {
    assert.equal(parsePlan(plan(['## Acceptance criteria', '- **AC1** — a'])).entries.size, 0);
  });
  it('open questions', () => {
    const p = parsePlan(plan([
      '## Open questions', '<From the clarify pass. Must be EMPTY before implementation starts.>',
      '1. Which bucket?', '- none', '- n/a', '', '## Acceptance criteria',
    ]));
    assert.equal(p.openQuestions, 1);
  });
  it("the plan template's example lines are not Verification entries", { skip: !TEMPLATE }, () => {
    const t = parsePlan(readFileSync(TEMPLATE, 'utf8'));
    assert.equal(t.entries.size, 0, [...t.entries.keys()].join(','));
    assert.deepEqual(t.criteria, ['AC1', 'AC2']);
  });

  it('CRLF and BOM', () => {
    const lf = plan(['**Status:** BUILT — 2026-10-17', '## Acceptance criteria', '- **AC1** — a', '## Open questions', '1. q?',
      '## Verification', '- **AC1** — DEFERRED (operator): x']);
    const crlf = '﻿' + lf.replace(/\n/g, '\r\n');
    assert.deepEqual(parsePlan(crlf), parsePlan(lf));
    assert.equal(parsePlan(crlf).status.word, 'BUILT');
  });
  it('section headings match by prefix, any case', () => {
    const p = parsePlan(plan(['## ACCEPTANCE CRITERIA (written first)', '- **AC1** — a', '## verification', '- **AC1** — ok']));
    assert.deepEqual(p.criteria, ['AC1']);
    assert.equal(p.entries.size, 1);
  });
  it('duplicate IDs are listed once', () => {
    assert.deepEqual(parsePlan(plan(['## Acceptance criteria', '- **AC1** — a', '- **AC1** — again'])).criteria, ['AC1']);
  });
  it('suffix IDs and every checkbox parse', () => {
    const p = parsePlan(plan([
      '## Acceptance criteria', '- [~] **AC10 — x.** y', '- [x] AC6b — z', '- [-] AC2 q',
      '## Verification', '- [x] **AC8b** — ok', '- [~] **AC10** — half',
    ]));
    assert.deepEqual(p.criteria, ['AC10', 'AC6b', 'AC2']);
    assert.ok(p.entries.has('AC8b'));
    assert.ok(p.entries.has('AC10'));
  });
  it('an unticked or dropped Verification checkbox is no entry', () => {
    const p = parsePlan(plan(['## Acceptance criteria', '- **AC1** — a', '- **AC2** — b',
      '## Verification', '- [ ] **AC1** — run the e2e suite', '- [-] **AC2** — check prod']));
    assert.equal(p.entries.size, 0);
  });
  it('NOT RECORDED is an entry, flagged', () => {
    const p = parsePlan(plan(['## Acceptance criteria', '- **AC3** — c', '## Verification',
      "- **AC3** — NOT RECORDED (migrated 2026-10-18): the plan's Verification didn't close this."]));
    assert.deepEqual(p.entries.get('AC3'), { deferred: false, notRecorded: true });
  });
  it('a range head is no ID\'s entry; the per-ID lines after it are', () => {
    const p = parsePlan(plan(['## Acceptance criteria', '- **AC8** — a', '- **AC9** — b', '- **AC10** — c',
      '## Verification', '- [ ] **AC8–AC9, AC10** release 2.', '- **AC1–AC3 (unit) — 2026-09-14**',
      '- **AC8** — DEFERRED (operator): release 2', '- **AC9** — see "release 2" above.']));
    assert.deepEqual([...p.entries.keys()], ['AC8', 'AC9']);
    assert.equal(p.entries.get('AC8').deferred, true);
  });
  it('AC1 is not AC10', () => {
    assert.deepEqual(parsePlan(plan(['## Acceptance criteria', '- **AC10** — x'])).criteria, ['AC10']);
  });
});

describe('parseSsddLedger', () => {
  it('done, total, next; milestone rows ignored', () => {
    const l = parseSsddLedger(plan(['## Tasks', '- [x] Task 1 — parse ✓', '- [X] Task 2 — view ✓', '- [ ] — PR 1 ships —',
      '- [ ] Task 3 — wire hooks', '- [ ] Task 4 — docs']));
    assert.deepEqual(l, { done: 2, total: 4, next: 'Task 3 — wire hooks' });
  });
  it('a long row is cut at a word boundary', () => {
    const l = parseSsddLedger('- [ ] Task 7 — ' + 'word '.repeat(30) + '\n');
    assert.ok(l.next.length <= 60, l.next);
    assert.match(l.next, /^Task 7 — word/);
    assert.doesNotMatch(l.next, /\s$/);
  });
  it('markdown emphasis is dropped from next', () => {
    assert.equal(parseSsddLedger('- [ ] Task 5 — **Rewritten for Vercel.** The `ECR` part\n').next, 'Task 5 — Rewritten for Vercel. The ECR part');
  });
    it('nothing left', () => {
    assert.deepEqual(parseSsddLedger('- [x] Task 1 — a\n'), { done: 1, total: 1, next: null });
  });
});

describe('parseProgress', () => {
  it('plan, done, in review', () => {
    const p = parseProgress(plan(['# SDD ledger — plan: .ssdd/plans/12-x.md', '', 'Task 1: complete (commits a..b)',
      'Task 2: complete (commits b..c)', 'Task 3: fix round 1/5 (2 addressed, 0 open; commits c..d)', '']));
    assert.deepEqual(p, { plan: '.ssdd/plans/12-x.md', done: 2, inReview: 3 });
  });
  it('not in review once the task completes', () => {
    const p = parseProgress(plan(['# SDD ledger — plan: p.md', 'Task 1: fix round 1/5 (x)', 'Task 1: complete (y)']));
    assert.deepEqual(p, { plan: 'p.md', done: 1, inReview: null });
  });
  it('no identity line', () => {
    assert.equal(parseProgress('Task 1: complete\n').plan, null);
  });
});

describe('countPlanTasks', () => {
  it('counts ### Task headings', () => {
    assert.equal(countPlanTasks(plan(['### Task 1: A', 'text', '### Task 2: B', '#### Task 3 is not a heading here'])), 2);
  });
});
