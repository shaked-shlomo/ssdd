// Tests for sync-check.mjs's pure parts (the CLI needs a linked project).
// Ported from the source project's suite, plus the 4-digit sequence format.
// Run: node --test packs/supabase/sync-check.selftest.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { declaredEarly, evaluate, parseRows, widthOf } from './sync-check.mjs';

const ASCII = `
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   \`20260101000000\` | \`20260101000000\` | 2026-01-01 00:00:00
   \`20260201000000\` |                | 2026-02-01 00:00:00
                  | \`20260301000000\` | 2026-03-01 00:00:00
`;
const BOX = `
   LOCAL          │ REMOTE         │ TIME (UTC)
  ────────────────┼────────────────┼─────────────────────
   20260101000000 │ 20260101000000 │ 2026-01-01 00:00:00
   20260201000000 │                │ 2026-02-01 00:00:00
`;
// The CLI prints a sequence-numbered history the same way (shape assumed, not captured).
const SEQ = `
   Local  | Remote | Time (UTC)
  --------|--------|-----------
   \`0001\` | \`0001\` | 0001
   \`0002\` |        | 0002
`;

describe('parseRows', () => {
  it('reads both separator styles', () => {
    assert.deepEqual(parseRows(ASCII), [
      { local: '20260101000000', remote: '20260101000000' },
      { local: '20260201000000', remote: '' },
      { local: '', remote: '20260301000000' },
    ]);
    assert.equal(parseRows(BOX).length, 2);
    assert.equal(parseRows('Connecting to remote database...\n').length, 0);
  });
  it('keeps the leading zeros of a sequence', () => {
    assert.deepEqual(parseRows(SEQ), [{ local: '0001', remote: '0001' }, { local: '0002', remote: '' }]);
  });
  it('parses a version of any width, so evaluate can fail it', () => {
    assert.deepEqual(parseRows('   `2026100312` |  | t\n'), [{ local: '2026100312', remote: '' }]);
  });
});

describe('widthOf', () => {
  it("is the oldest applied version's digit count", () => {
    assert.equal(widthOf(['20260201000000', '20260101000000']), 14);
    assert.equal(widthOf(['0002', '0001']), 4);
    assert.equal(widthOf([]), 0);
  });
});

describe('declaredEarly', () => {
  it('is strict and fails closed', () => {
    assert.deepEqual([...declaredEarly('x\napplied-early: 20260101000000 20260102000000\n', 14)], ['20260101000000', '20260102000000']);
    assert.equal(declaredEarly('applied-early: 2026010100000', 14).size, 0); // 13 digits
    assert.equal(declaredEarly('note: applied-early: 20260101000000', 14).size, 0); // prose on the line
    assert.equal(declaredEarly(undefined, 14).size, 0);
  });
  it('takes the history width', () => {
    assert.deepEqual([...declaredEarly('applied-early: 0007', 4)], ['0007']);
    assert.equal(declaredEarly('applied-early: 07', 4).size, 0);
    assert.equal(declaredEarly('applied-early: 20260101000000', 4).size, 0);
  });
});

const ts = (o = {}) => ({
  remote: ['20260101000000', '20260201000000'],
  local: ['20260101000000', '20260201000000'],
  onBase: new Set(['20260101000000', '20260201000000']),
  added: new Set(),
  modified: new Set(),
  declared: new Set(),
  digits: 14,
  ...o,
});
const seq = (o = {}) => ({
  remote: ['0001', '0002'],
  local: ['0001', '0002'],
  onBase: new Set(['0001', '0002']),
  added: new Set(),
  modified: new Set(),
  declared: new Set(),
  digits: 4,
  ...o,
});

for (const [label, base, next, older] of [
  ['timestamps', ts, '20260301000000', '20260115000000'],
  ['a sequence', seq, '0003', '0001'],
]) {
  describe(`evaluate (${label})`, () => {
    it('clean history passes; a new newest file is pending', () => {
      assert.deepEqual(evaluate(base()).errors, []);
      const v = evaluate(base({ local: [...base().local, next], added: new Set([next]) }));
      assert.deepEqual(v.errors, []);
      assert.deepEqual(v.pending, [next]);
    });

    it('remote-only: out of band vs branch behind the base', () => {
      assert.match(evaluate(base({ remote: [...base().remote, next] })).errors[0], /OUT-OF-BAND/);
      const behind = evaluate(base({ remote: [...base().remote, next], onBase: new Set([...base().onBase, next]) }));
      assert.match(behind.errors[0], /merge the base branch in/);
    });

    it('added-but-applied fails unless declared applied-early', () => {
      const o = { remote: [...base().remote, next], local: [...base().local, next], added: new Set([next]) };
      assert.match(evaluate(base(o)).errors[0], /ADDS migrations already applied/);
      const ok = evaluate(base({ ...o, declared: new Set([next]) }));
      assert.deepEqual(ok.errors, []);
      assert.deepEqual(ok.early, [next]);
    });

    it('editing an applied migration fails', () => {
      assert.match(evaluate(base({ modified: new Set([base().remote[0]]) })).errors[0], /EDITS applied/);
    });

    it('stuck: on the base, unapplied, not added here', () => {
      assert.deepEqual(evaluate(base({ onBase: new Set([...base().onBase, next]) })).stuck, [next]);
      const v = evaluate(base({ local: [...base().local, next], onBase: new Set([...base().onBase, next]) }));
      assert.deepEqual(v.stuck, [next]);
    });

    it('a pending file older than the newest applied fails', () => {
      if (label === 'a sequence') {
        // 0003 was applied first (out of band, say), so a pending 0002 can never apply in order
        const v = evaluate(base({ remote: ['0001', '0003'], local: ['0001', '0002', '0003'], onBase: new Set(['0001', '0003']), added: new Set(['0002']) }));
        assert.match(v.errors[0], /older than the newest applied/);
        return;
      }
      const v = evaluate(base({ local: [...base().local, older], added: new Set([older]) }));
      assert.match(v.errors[0], /older than the newest applied/);
    });
  });
}

describe('evaluate: version width', () => {
  it('a version of another width fails, on either side', () => {
    const v = evaluate(ts({ local: [...ts().local, '2026100312'], added: new Set(['2026100312']) }));
    assert.match(v.errors.join('\n'), /not 14 digits/);
    assert.match(evaluate(ts({ remote: [...ts().remote, '99'] })).errors.join('\n'), /not 14 digits/);
  });
  it('a timestamp file in a sequence history fails, and the advice fits the format', () => {
    const v = evaluate(seq({ local: [...seq().local, '20260301000000'], added: new Set(['20260301000000']) }));
    assert.match(v.errors.join('\n'), /not 4 digits: 20260301000000/);
    assert.match(v.errors.join('\n'), /the next 4-digit number/);
    assert.doesNotMatch(v.errors.join('\n'), /migration new/);
  });
  it('a 3-digit file in a sequence history fails', () => {
    const v = evaluate(seq({ local: [...seq().local, '003'], added: new Set(['003']) }));
    assert.match(v.errors.join('\n'), /not 4 digits: 003/);
  });
});
