// Tests for added-lines: the lines a `git diff -U0` adds, shared by
// convention-lint and the review gate's [pre-existing] check (spec v3.5,
// Clarify 12).
// Run: node --test mechanisms/hooks/added-lines.selftest.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, diffPath } from './added-lines.mjs';

describe('addedLines', () => {
  it("a hunk's added lines, numbered on the new side", () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -2,0 +3,2 @@',
      '+one',
      '+two',
      '@@ -9 +11 @@',
      '-old',
      '+new',
    ].join('\n');
    assert.deepEqual([...addedLines(diff)], [['src/a.ts', [[3, 'one'], [4, 'two'], [11, 'new']]]]);
  });

  it('a C-quoted path decodes', () => {
    const diff = ['+++ "b/sp\\303\\251cial \\"q\\".ts"', '@@ -0,0 +1 @@', '+x'].join('\n');
    assert.deepEqual([...addedLines(diff).keys()], ['spécial "q".ts']);
  });

  it("an added line `++ x` inside a hunk isn't a header", () => {
    const diff = ['+++ b/a.md', '@@ -0,0 +1,2 @@', '+++ x', '+y'].join('\n');
    assert.deepEqual(addedLines(diff).get('a.md'), [[1, '++ x'], [2, 'y']]);
  });

  it("gaining a final newline isn't an added line", () => {
    const diff = ['+++ b/a.txt', '@@ -1 +1 @@', '-last', '\\ No newline at end of file', '+last'].join('\n');
    assert.deepEqual(addedLines(diff).get('a.txt'), []);
  });

  it('a blob-pair diff yields one entry, keyed by the blob id', () => {
    const id = 'a'.repeat(40);
    const diff = [`diff --git a/${'b'.repeat(40)} b/${id}`, `--- a/${'b'.repeat(40)}`, `+++ b/${id}`, '@@ -1 +1 @@', '-x', '+y'].join('\n');
    assert.deepEqual([...addedLines(diff)], [[id, [[1, 'y']]]]);
  });

  it('diffPath strips b/ from a plain name', () => {
    assert.equal(diffPath('b/src/a b.ts'), 'src/a b.ts');
  });
});
