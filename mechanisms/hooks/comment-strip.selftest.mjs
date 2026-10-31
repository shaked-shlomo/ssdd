// Tests for comment-strip: what a comment-only change is, and what can't be classified.
// Run: node --test mechanisms/hooks/comment-strip.selftest.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMENT_EXTS, commentOnly, stripComments } from './comment-strip.mjs';

// [name, ext, input, expected stripComments output (null: can't classify)]
const STRIP = [
  // Division and regex.
  ['division chain', '.js', 'x = a / b / c // c', 'x = a / b / c'],
  ['regex at expression start', '.js', 'x = /b/g.test(c) // c', 'x = /b/g.test(c)'],
  ['division across a newline', '.js', 'x = a\n/re/.test(s) // c', 'x = a\n/re/.test(s)'],
  ['division across a newline hides a regex body', '.js', 'x = a\n/re// 2', 'x = a\n/re'],
  ['regex after if (...)', '.js', 'if (x) /\\/\\//.test(y) // c', 'if (x) /\\/\\//.test(y)'],
  ['regex after while (...)', '.js', 'while (x) /a/.test(y)', 'while (x) /a/.test(y)'],
  ['regex after for await (...)', '.js', 'for await (x of y) /a/.test(x)', 'for await (x of y) /a/.test(x)'],
  ['division after a call', '.js', 'f(x) / 2 // c', 'f(x) / 2'],
  ['x.return is a property, so division', '.js', 'a = x.return / 2 // c', 'a = x.return / 2'],
  ['x?.return is a property, so division', '.js', 'a = x?.return / 2 // c', 'a = x?.return / 2'],
  ['regex after return', '.js', "return /a'/.source // c", "return /a'/.source"],
  ['regex after typeof', '.js', 'typeof /x/', 'typeof /x/'],
  ['regex after export default', '.js', 'export default /[//]/ // c', 'export default /[//]/'],
  ['regex after =>', '.js', 'f = (s) => /a/.test(s) // c', 'f = (s) => /a/.test(s)'],
  ['} then a regex: null', '.js', 'function f() {}\n/re/.test(s)', null],
  ['} then division: null', '.js', 'x = {} / 2', null],
  ['++ then /: null', '.js', 'a++ / 2', null],
  ['-- then /: null', '.js', 'a-- / 2', null],
  ['} then a line comment', '.js', 'if (a) {} // c\nb()', 'if (a) {}\nb()'],
  ['} then a block comment', '.js', 'if (a) {} /* c */ b()', 'if (a) {} b()'],
  ['TS x! then division', '.ts', 'y = x! / 2 // c', 'y = x! / 2'],
  ['! after a line break is an operator', '.js', 'a\n!/[//]/.test(x) // c', 'a\n!/[//]/.test(x)'],
  ['x != y', '.ts', 'ok = x != y // c', 'ok = x != y'],
  // Strings, templates, regex.
  ['nested template', '.js', 'x = `a ${ `nested ${x} // no` } /* no */` // yes', 'x = `a ${ `nested ${x} // no` } /* no */`'],
  ['template with an object in ${}', '.js', 'x = `${ {a: 1}.a }`', 'x = `${ {a: 1}.a }`'],
  ['comment markers in strings', '.js', "x = '//' + \"/*\" // c", "x = '//' + \"/*\""],
  ['URL in a string', '.js', 'u = "https://x.y/z" /* c */', 'u = "https://x.y/z"'],
  ['string escapes', '.js', "x = 'it\\'s // no' // yes", "x = 'it\\'s // no'"],
  ['regex with \\/\\*', '.js', 'r = /\\/\\*/ // c', 'r = /\\/\\*/'],
  ['regex class holding /', '.js', 'r = /[/]/ // c', 'r = /[/]/'],
  ['regex class holding //', '.js', 'r = /[//]x/g // c', 'r = /[//]x/g'],
  ['template keeps its spaces and blank line', '.js', 'x = `a  \n\n  b` // c', 'x = `a  \n\n  b`'],
  ['unterminated string', '.js', "x = 'abc\n'", null],
  ['unterminated double-quoted string', '.js', 'x = "abc', null],
  ['unterminated regex', '.js', 'r = /abc\n', null],
  ['unterminated template', '.js', 'x = `abc ${y}', null],
  ['unterminated ${', '.js', 'x = `abc ${y`', null],
  ['unterminated block comment', '.js', 'x() /* c', null],
  ['mismatched bracket', '.js', 'f(a]', null],
  ['bracket left open', '.js', 'f(a', null],
  ['stray closer', '.js', 'a)', null],
  // JSX.
  ['JSX text is code', '.jsx', 'x = <a href="//x">// text</a> // c', 'x = <a href="//x">// text</a>'],
  ['JSX {/* c */} becomes {}', '.jsx', '<p>{/* c */}hi</p>', '<p>{}hi</p>'],
  ['JSX {/* c */} after =', '.jsx', 'x = <p>{/* c */}hi</p>', 'x = <p>{}hi</p>'],
  ['JSX comment between attributes', '.tsx', '<a /* c */ b="1" />', '<a b="1" />'],
  ['JSX attribute string has no escapes', '.jsx', 'x = <a b="\\" c="//">t</a>', 'x = <a b="\\" c="//">t</a>'],
  ['JSX nested, fragments, spread', '.tsx', 'x = <><A {...p} b={() => {/* c */}}><B.C/></A></> // c',
    'x = <><A {...p} b={() => {}}><B.C/></A></>'],
  ['JSX in a .js file', '.js', 'return <p>// hi</p>', 'return <p>// hi</p>'],
  ['JSX close mismatch', '.jsx', 'x = <a></b>', null],
  ['JSX element left open', '.jsx', 'x = <a>hi', null],
  ['.tsx generic arrow <T,>: null', '.tsx', 'const f = <T,>() => {}', null],
  ['.tsx generic arrow <T extends>: null', '.tsx', 'const f = <T extends X>(a: T) => a', null],
  ['.ts generic arrow <T,>', '.ts', 'const f = <T,>() => {} // c', 'const f = <T,>() => {}'],
  ['a < b > c in .ts', '.ts', 'x = a < b > c // c', 'x = a < b > c'],
  ['Array<string> in .tsx', '.tsx', 'let x: Array<string> = [] // c', 'let x: Array<string> = []'],
  ['generic call in .tsx', '.tsx', 'useState<string>("") // c', 'useState<string>("")'],
  ['<< is one operator in .tsx', '.tsx', 'x = (1 << 24) | 0 // c', 'x = (1 << 24) | 0'],
  ['<< is one operator in .js', '.js', 'i = BigInt(o)<<BigInt(32)', 'i = BigInt(o)<<BigInt(32)'],
  ['<= in .tsx', '.tsx', 'ok = a <= b // c', 'ok = a <= b'],
  // Whitespace.
  ['a comment between tokens leaves a space', '.js', 'a/**/b', 'a b'],
  ['a comment takes the spaces on one side', '.js', 'f(a, /* x */ b)', 'f(a, b)'],
  ['no space beside a separator', '.js', 'f(/* x */a)', 'f(a)'],
  ['a comment holding a line break leaves one', '.js', 'return/*\n*/x', 'return\nx'],
  ['comment lines, blank lines and trailing spaces go', '.js', 'a()\n\n  // c\n  /* d\n  e */\nb()  \n', 'a()\nb()'],
  ['a line comment ends at U+2028', '.js', 'a() // c b()', 'a()  b()'],
  ['a line comment ends at U+2029', '.js', 'a() // c b()', 'a()  b()'],
  ['CR is trailing whitespace', '.js', 'a()\r\nb() // c\r\n', 'a()\nb()'],
  ['indent is kept', '.ts', '  a()\n', '  a()'],
  ['a real NUL in a string', '.tsx', 'x = a.join("\0") // c', 'x = a.join("\0")'],
  ['an escaped NUL in a string', '.tsx', 'x = a.join("\\0") // c', 'x = a.join("\\0")'],
  ['a BOM is kept', '.js', '﻿x() // c', '﻿x()'],
  ['U+FFFD: null', '.js', 'x = "�" // c', null],
  ['empty text', '.js', '', ''],
  ['only comments', '.ts', '// a\n/* b */\n', ''],
  // Extensions.
  ['.mjs', '.mjs', 'a() // c', 'a()'],
  ['.cjs', '.cjs', 'a() // c', 'a()'],
  ['.mts', '.mts', 'a() // c', 'a()'],
  ['.cts', '.cts', 'a() // c', 'a()'],
  ['.py is not in the list', '.py', 'a() # c', null],
  ['.JS is not in the list', '.JS', 'a() // c', null],
  ['no extension', '', 'a() // c', null],
];

// Comments a tool reads: each is kept as code, [name, ext, input].
const TOOL_READ = [
  ['shebang', '.js', '#!/usr/bin/env node\nx()'],
  ['eslint-disable', '.ts', '// eslint-disable-next-line no-x\nx()'],
  ['eslint-enable', '.js', '/* eslint-enable no-x */\nx()'],
  ['eslint-env', '.js', '/* eslint-env node */\nx()'],
  ['eslint config', '.js', '/* eslint no-console: off */\nx()'],
  ['global', '.js', '/* global foo */\nx()'],
  ['globals', '.js', '/* globals foo, bar */\nx()'],
  ['exported', '.js', '/* exported foo */\nx()'],
  ['jshint', '.js', '/* jshint esversion: 6 */\nx()'],
  ['jslint', '.js', '/* jslint node */\nx()'],
  ['@ts-expect-error', '.ts', '// @ts-expect-error\nx()'],
  ['@ts-nocheck', '.ts', '// @ts-nocheck\nx()'],
  ['prettier-ignore', '.ts', '// prettier-ignore\nx()'],
  ['c8 ignore', '.js', '/* c8 ignore next */\nx()'],
  ['istanbul ignore', '.js', '/* istanbul ignore next */\nx()'],
  ['v8 ignore', '.ts', '/* v8 ignore next */\nx()'],
  ['node:coverage', '.js', '/* node:coverage ignore next */\nx()'],
  ['#__PURE__', '.js', 'x = /*#__PURE__*/ f()'],
  ['@__PURE__', '.js', 'x = /* @__PURE__ */ f()'],
  ['__NO_SIDE_EFFECTS__', '.js', '/*#__NO_SIDE_EFFECTS__*/\nfunction f() {}'],
  ['/// <reference', '.ts', '/// <reference types="node" />\nx()'],
  ['sourceMappingURL', '.js', 'x()\n//# sourceMappingURL=x.js.map'],
  ['sourceURL', '.js', 'x()\n//# sourceURL=x.js'],
  ['//@ sourceMappingURL', '.js', 'x()\n//@ sourceMappingURL=x.js.map'],
  ['@jsx', '.jsx', '/** @jsx h */\nx()'],
  ['@jsxImportSource', '.tsx', '/** @jsxImportSource preact */\nx()'],
  ['@flow', '.js', '// @flow\nx()'],
  ['@noflow', '.js', '// @noflow\nx()'],
  ['webpack magic', '.js', 'import(/* webpackChunkName: "a" */ "./a")'],
  ['turbopack magic', '.js', 'import(/* turbopackIgnore: true */ u)'],
  ['@vite-ignore', '.js', 'import(/* @vite-ignore */ u)'],
  ['/*! legal */', '.js', '/*! (c) x */\nx()'],
  ['@license', '.ts', '/** @license MIT */\nx()'],
  ['@preserve', '.ts', '/* @preserve keep */\nx()'],
  ['biome-ignore', '.ts', '// biome-ignore lint: why\nx()'],
  ['deno-lint-ignore', '.ts', '// deno-lint-ignore no-explicit-any\nx()'],
  ['deno-fmt-ignore', '.ts', '// deno-fmt-ignore\nx()'],
  ['dprint-ignore', '.ts', '// dprint-ignore\nx()'],
  ['oxlint-', '.ts', '// oxlint-disable-next-line no-x\nx()'],
  ['tslint:', '.ts', '// tslint:disable-next-line\nx()'],
  ['@refresh', '.tsx', '// @refresh reset\nx()'],
  ['@vitest-environment', '.ts', '// @vitest-environment jsdom\nx()'],
  ['@jest-environment', '.ts', '/** @jest-environment jsdom */\nx()'],
  ['@format', '.js', '/** @format */\nx()'],
  ['@prettier', '.js', '/** @prettier */\nx()'],
  ['ssdd-lint-ignore', '.ts', 'const c = "#f00"; // ssdd-lint-ignore: logo'],
  ['JSDoc @param {type} in .js', '.js', '/** @param {string} a */\nf(a)'],
  ['JSDoc @type {type} in .mjs', '.mjs', '/** @type {number} */\nlet a'],
  ['JSDoc @returns {type} in .cjs', '.cjs', '/** @returns {void} */\nfunction f() {}'],
  ['JSDoc @typedef in .js', '.js', '/** @typedef Foo */\nx()'],
  ['JSDoc @template in .jsx', '.jsx', '/** @template T */\nx()'],
  ['JSDoc @import in .mjs', '.mjs', '/** @import { A } from "./a.js" */\nx()'],
];

// [name, path, a, b, expected commentOnly]
const PAIRS = [
  ['a // edit', 'src/a.ts', 'x() // old\n', 'x() // new\n', true],
  ['a comment added on its own line', 'a.ts', 'a()\nb()\n', 'a()\n// why\nb()\n', true],
  ['a comment moved', 'a.ts', '// c\na()\nb()\n', 'a()\n// c\nb()\n', true],
  ['a block comment edited', 'lib/a.mjs', '/** Hello. */\nlet a', '/** Bye. */\nlet a', true],
  ['a code edit', 'a.ts', 'const a = 1\n', 'const a = 2\n', false],
  ['a code edit beside a comment', 'a.ts', 'x = 1 // c\n', 'x = 2 // c\n', false],
  ['a comment glued two tokens', 'a.js', 'a/**/b', 'ab', false],
  ['an eslint-disable-next-line edit', 'a.ts', '// eslint-disable-next-line a\nx()', '// eslint-disable-next-line b\nx()', false],
  ['a JSDoc type edit in .mjs', 'a.mjs', '/** @type {string} */\nlet a', '/** @type {number} */\nlet a', false],
  ['a JSDoc type edit in .ts', 'a.ts', '/** @type {string} */\nlet a', '/** @type {number} */\nlet a', true],
  ['template trailing spaces', 'a.js', 'x = `a  \nb`', 'x = `a\nb`', false],
  ['JSX text // edit', 'a.tsx', 'x = <p>// a</p>', 'x = <p>// b</p>', false],
  ['a string // edit', 'a.js', 'x = "a // b"', 'x = "a // c"', false],
  ['division then a real comment', 'a.js', 'x = a\n/b// c/', 'x = a\n/b// d/', true],
  ['an indent change', 'a.ts', 'a()\n', '  a()\n', false],
  ['a missing final newline', 'a.ts', 'a()\n', 'a()', true],
  ['CRLF vs LF', 'a.ts', 'a()\r\nb()\r\n', 'a()\nb()\n', true],
  ['the same edit in .py', 'a.py', 'x() // old\n', 'x() // new\n', false],
  ['no extension', 'Makefile', 'x() // old\n', 'x() // new\n', false],
  ['a dotted directory, no extension', 'a.js/run', 'x() // old\n', 'x() // new\n', false],
  ['identical texts', 'a.ts', 'x() // c\n', 'x() // c\n', false],
  ['one side unclassifiable', 'a.js', 'x = {} / 2 // a', 'x = {} / 2 // b', false],
  ['a BOM on both sides', 'a.ts', '﻿x() // old\n', '﻿x() // new\n', true],
  ['a BOM added', 'a.ts', 'x()\n', '﻿x()\n', false],
  ['U+FFFD on both sides', 'a.ts', '�() // old\n', '�() // new\n', false],
];

describe('COMMENT_EXTS', () => {
  it('is the JS/TS family', () => {
    assert.deepEqual([...COMMENT_EXTS].sort(), ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
  });
});

describe('stripComments', () => {
  for (const [name, ext, input, want] of STRIP) {
    it(`${name} (${ext || 'none'})`, () => assert.equal(stripComments(input, ext), want));
  }
});

describe('comments a tool reads are kept', () => {
  for (const [name, ext, input] of TOOL_READ) {
    it(`${name} (${ext})`, () => assert.equal(stripComments(input, ext), input));
  }
  it('a JSDoc type block in .ts is stripped', () => {
    assert.equal(stripComments('/** @param {string} a */\nf(a)', '.ts'), 'f(a)');
  });
  it('a JSDoc @param with no type in .mjs is stripped', () => {
    assert.equal(stripComments('/** @param a the thing */\nf(a)', '.mjs'), 'f(a)');
  });
  it('a // global in a line comment is prose', () => {
    assert.equal(stripComments('// global state below\nx()', '.js'), 'x()');
  });
});

describe('commentOnly', () => {
  for (const [name, path, a, b, want] of PAIRS) {
    it(name, () => assert.equal(commentOnly(a, b, path), want));
  }
});

describe('nothing throws', () => {
  it('non-string input', () => {
    assert.equal(stripComments(undefined, '.js'), null);
    assert.equal(stripComments(Buffer.from('x()'), '.js'), null);
    assert.equal(stripComments('x()', undefined), null);
    assert.equal(commentOnly(null, 'x()', 'a.js'), false);
    assert.equal(commentOnly('x()', 'y()', null), false);
  });
  it('deep nesting is null, not a RangeError', () => {
    const deep = '`${'.repeat(20000) + '}`'.repeat(20000);
    assert.equal(stripComments(deep, '.js'), null);
    assert.equal(commentOnly(deep, deep + ' ', 'a.js'), false);
  });
  it('a non-UTF-8 blob decoded with replacement characters', () => {
    const bin = Buffer.from([0xff, 0xfe, 0x2f, 0x2f, 0x80, 0x0a, 0x00, 0xc3]).toString('utf8');
    assert.doesNotThrow(() => stripComments(bin, '.js'));
    assert.equal(commentOnly(bin, bin + '// c', 'a.js'), false);
  });
});
