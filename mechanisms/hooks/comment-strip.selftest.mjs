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
  // A value, a line break, then `/`: ASI may or may not end the statement (R13).
  ['division across a newline: null', '.js', 'x = a\n/re/.test(s) // c', null],
  ['division across a newline hides a regex body: null', '.js', 'x = a\n/re// 2', null],
  ['a block comment holding the line break: null', '.js', 'x = a/*\n*/ /re/.test(s)', null],
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
  ['.default then division', '.js', 'x = {default: 1}.default / 2 // c', 'x = {default: 1}.default / 2'],
  ['default: then a regex', '.js', 'switch (a) { default: /a/.test(b) }', 'switch (a) { default: /a/.test(b) }'],
  ['! after a line break, no /', '.ts', 'a\n!b // c', 'a\n!b'],
  ['x! then a line break and /: null', '.ts', 'y = x!\n/ 2 // c', null],
  ['an operator, a line break, then a regex', '.js', 'x = a ||\n/re/.test(s) // c', 'x = a ||\n/re/.test(s)'],
  ['return, a line break, then a regex', '.js', 'return\n/re/.test(s) // c', 'return\n/re/.test(s)'],
  ['a regex at a line start after ;', '.js', 'x = a;\n/re/.test(s) // c', 'x = a;\n/re/.test(s)'],
  ['a regex at the start', '.js', '/re/.test(s) // c', '/re/.test(s)'],
  ['JSX after ( and a line break', '.tsx', 'return (\n  <p>hi</p> // c\n)', 'return (\n  <p>hi</p>\n)'],
  ['less-than after a line break in .tsx: null (R17)', '.tsx', 'ok = a\n  < b // c', null],
  ['less-than after a line break in .ts', '.ts', 'ok = a\n  < b // c', 'ok = a\n  < b'],
  ['less-than on one line in .tsx', '.tsx', 'ok = a < b // c', 'ok = a < b'],
  ['<< after a line break in .tsx', '.tsx', 'x = a\n  << 2 // c', 'x = a\n  << 2'],
  ['<= after a line break in .jsx', '.jsx', 'ok = a\n  <= b // c', 'ok = a\n  <= b'],
  ['extends then a regex', '.js', 'class A extends /x/.constructor {} // c', 'class A extends /x/.constructor {}'],
  ['extends then a name', '.ts', 'class A extends B {} // c', 'class A extends B {}'],
  ['x.extends then division', '.js', 'n = x.extends / 2 // c', 'n = x.extends / 2'],
  ['of as a keyword, then a value', '.js', 'for (const x of xs) f(x) // c', 'for (const x of xs) f(x)'],
  ['/ after of: null', '.js', 'for (const x of /a/g.exec(s)) f(x)', null],
  ['/ after await: null', '.mjs', 'await /a/.test(s)', null],
  ['await then a value', '.mjs', 'await f(x) / 2 // c', 'await f(x) / 2'],
  ['TS > then /: null', '.ts', 'x = y as A<B> / 2', null],
  ['TS void then /: null', '.ts', 'x = y as () => void / 2', null],
  ['TS => then a regex', '.ts', 'f = (s: string) => /a/.test(s) // c', 'f = (s: string) => /a/.test(s)'],
  ['TS >= then a regex', '.ts', 'ok = a >= /a/.source.length // c', 'ok = a >= /a/.source.length'],
  ['JS > then a regex', '.js', 'ok = a > /a/.source.length // c', 'ok = a > /a/.source.length'],
  ['JS void then a regex', '.js', 'void /a/.test(s) // c', 'void /a/.test(s)'],
  ['x-- > y is not -->', '.js', 'while (x-- > 0) f() // c', 'while (x-- > 0) f()'],
  ['<!-- in a string', '.js', 'x = "<!--" // c', 'x = "<!--"'],
  ['--> in a string at a line start', '.js', 'x = [\n"-->"] // c', 'x = [\n"-->"]'],
  ['<!--: null', '.js', 'x = a <!-- b', null],
  ['--> at a line start: null', '.js', 'x = a\n--> b', null],
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
  ['a line comment ends at U+2028', '.js', 'a() // c\u2028b()', 'a() \u2028b()'],
  ['a line comment ends at U+2029', '.js', 'a() // c\u2029b()', 'a() \u2029b()'],
  ['CR is trailing whitespace', '.js', 'a()\r\nb() // c\r\n', 'a()\nb()'],
  ['indent is kept', '.ts', '  a()\n', '  a()'],
  ['a real NUL in a string', '.tsx', 'x = a.join("\0") // c', 'x = a.join("\0")'],
  ['an escaped NUL in a string', '.tsx', 'x = a.join("\\0") // c', 'x = a.join("\\0")'],
  ['a BOM is kept', '.js', '\uFEFFx() // c', '\uFEFFx()'],
  ['U+FFFD: null', '.js', 'x = "\uFFFD" // c', null],
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
  ['Flow /*: T */', '.js', 'let a /*: string */ = 1'],
  ['Flow /*:: */', '.js', '/*:: type T = string; */\nx()'],
  ['JSDoc @constructor in .js', '.js', '/** @constructor */\nfunction F() {}'],
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
  ['division across a newline, then a comment', 'a.js', 'x = a\n/b// c/', 'x = a\n/b// d/', false],
  ['an indent change', 'a.ts', 'a()\n', '  a()\n', false],
  ['a missing final newline', 'a.ts', 'a()\n', 'a()', true],
  ['CRLF vs LF', 'a.ts', 'a()\r\nb()\r\n', 'a()\nb()\n', true],
  ['the same edit in .py', 'a.py', 'x() // old\n', 'x() // new\n', false],
  ['no extension', 'Makefile', 'x() // old\n', 'x() // new\n', false],
  ['a dotted directory, no extension', 'a.js/run', 'x() // old\n', 'x() // new\n', false],
  ['identical texts', 'a.ts', 'x() // c\n', 'x() // c\n', false],
  ['one side unclassifiable', 'a.js', 'x = {} / 2 // a', 'x = {} / 2 // b', false],
  ['a BOM on both sides', 'a.ts', '\uFEFFx() // old\n', '\uFEFFx() // new\n', true],
  ['a BOM added', 'a.ts', 'x()\n', '\uFEFFx()\n', false],
  ['U+FFFD on both sides', 'a.ts', '\uFFFD() // old\n', '\uFFFD() // new\n', false],
  // Review round 1: each shape was a wrong true. b is a with Q replaced by good()
  // unless given; a's Q is a comment in one reading and code in the other.
  ...[
    // R13: ASI after a value and a line break.
    ['let x', 'f.js', 'let x\n/x//Q\n'],
    ['var x = 1, y', 'f.ts', 'var x = 1, y\n/x//Q\n'],
    ['var y, regex class', 'f.js', 'var y\n/[//]/.test(Q)\n'],
    ['import a from', 'f.mjs', "import a from 'a'\n/x//Q\n"],
    ['import "a"', 'f.mjs', 'import "a"\n/x//Q\n'],
    ['export * from', 'f.mjs', 'export * from "a"\n/x//Q\n'],
    ['debugger', 'f.js', 'debugger\n/x//Q\n'],
    ['break', 'f.js', 'while (a) { break\n/x//Q\n}'],
    ['continue', 'f.js', 'while (a) { continue\n/x//Q\n}'],
    ['let x: number', 'f.ts', 'let x: number\n/x//Q\n'],
    ['type A = string', 'f.ts', 'type A = string\n/x//Q\n'],
    ['let y: string[]', 'f.mts', 'let y: string[]\n/x//Q\n'],
    ['declare const', 'f.ts', 'declare const d: D\n/x//Q\n'],
    ['declare function', 'f.cts', 'declare function f()\n/x//Q\n'],
    ['a block comment before the /', 'f.ts', 'let x\n/**/ /x//Q\n'],
    ['/ 2 after let', 'f.ts', 'let x\n/ 2 // Q\n'],
    ['JSX after let (.jsx)', 'f.jsx', 'let x\n<p>// {Q}</p>\n'],
    ['JSX after let (.tsx)', 'f.tsx', 'let x\n<p>// {Q}</p>\n'],
    ['JSX after let x: number (.tsx)', 'f.tsx', 'let x: number\n<p>// {Q}</p>\n'],
    // R14: HTML-like comments.
    ['<!-- after code', 'f.cjs', 'x = 1 <!-- /*\nQ\n--> */\n'],
    ['--> at a line start', 'f.js', 'x = 1\n--> /*\nQ\n--> */\n'],
    ['--> at the start', 'f.js', '--> /*\nQ\n--> */\n'],
    ['--> after a block comment on its line', 'f.js', 'x = 1\n/* c */ --> /*\nQ\n--> */\n'],
    ['<!-- in .ts', 'f.ts', 'x = 1 <!-- /*\nQ\n--> */\n'],
    // R15: of, yield, await as identifiers.
    ['of', 'f.js', 'var of = 4\nn = of / "/ //" + Q\n'],
    ['x = of, then a line break', 'f.ts', 'x = of\n/ "/ //" + Q\n'],
    ['yield (sloppy)', 'f.cjs', 'var yield = 4\nn = yield / "/ //" + Q\n'],
    ['yield, then a line break', 'f.ts', 'yield\n/ "/ //" + Q\n'],
    ['await (script)', 'f.cjs', 'var await = 4\nn = await / "/ //" + Q\n'],
    ['of then JSX', 'f.jsx', "var of = 1\nx = of <a b='\\' /* Q */ c='x'></a>\n"],
    // TS type arguments and void before `/` (found in this round).
    ['as A<B> /', 'f.ts', 'x = y as A<B> /"/ + 1 // Q"\n'],
    ['satisfies A<B> /', 'f.ts', 'x = y satisfies A<B> /"/ + 1 // Q"\n'],
    ['as A<B<C>> /', 'f.ts', 'x = y as A<B<C>> /"/ + 1 // Q"\n'],
    ['as () => void /', 'f.ts', 'x = y as () => void /"/ + 1 // Q"\n'],
    ['f<T> /', 'f.ts', 'x = f<T> /"/ + 1 // Q"\n'],
    ['as A<B> / in .tsx', 'f.tsx', 'x = y as A<B> /"/ + 1 // Q"\n'],
    ['as A<B> then JSX in .tsx', 'f.tsx', "x = y as A<B> <a b='\\' /* Q */ c='x'></a>\n"],
    // R16: a next-line directive whose target moves.
    ['eslint-disable-next-line, comment line between', 'f.js', '// eslint-disable-next-line no-eval\n// Q\neval(x)\n',
      '// eslint-disable-next-line no-eval\neval(x)\n'],
    ['c8 ignore next, blank line between', 'f.js', '/* c8 ignore next */\n\nrisky()\n', '/* c8 ignore next */\nrisky()\n'],
    ['@ts-expect-error, comment line between', 'f.ts', '// @ts-expect-error\n// Q\nx()\n', '// @ts-expect-error\nx()\n'],
    ['@ts-ignore, blank line between', 'f.ts', '// @ts-ignore\n\nx()\n', '// @ts-ignore\nx()\n'],
    ['prettier-ignore, block comment between', 'f.ts', '// prettier-ignore\n/* Q */\nx()\n', '// prettier-ignore\nx()\n'],
    ['biome-ignore, blank line between', 'f.ts', '// biome-ignore lint: x\n\nx()\n', '// biome-ignore lint: x\nx()\n'],
    ['deno-lint-ignore, comment between', 'f.ts', '// deno-lint-ignore no-x\n// Q\nx()\n', '// deno-lint-ignore no-x\nx()\n'],
    ['istanbul ignore next, blank line between', 'f.js', '/* istanbul ignore next */\n\nx()\n', '/* istanbul ignore next */\nx()\n'],
    ['v8 ignore next, comment between', 'f.ts', '/* v8 ignore next */\n// Q\nx()\n', '/* v8 ignore next */\nx()\n'],
    // Flow comment types and checkJs tags the first list missed.
    ['Flow /*: T */', 'f.js', '// @flow\nlet a /*: Q */ = 1\n'],
    ['Flow /*:: */', 'f.js', '// @flow\n/*:: type T = Q; */\nx()\n'],
    ['JSDoc @constructor', 'f.js', '/** @constructor Q */\nfunction F() {}\n', 'function F() {}\n'],
    ['JSDoc @class', 'f.mjs', '/** @class Q */\nfunction F() {}\n', 'function F() {}\n'],
  ].map(([name, path, a, b]) => [`R1: ${name}`, path, a, b ?? a.split('Q').join('good()'), false]),
  // Review round 2.
  ...[
    // R17: a `<` that could open JSX (space or a comment may follow it) where
    // no expression can start: after an ambiguous token...
    ...['.js', '.jsx', '.tsx'].flatMap((e) => [
      ['yield < b>', `f${e}`, 'function* g() { yield < b>// {Q}</b>\n}\n'],
      ['await < b>', `f${e}`, 'async function g() { await < b>// {Q}</b>\n}\n'],
      ['top-level await < b>', `f${e}`, 'await < b>// {Q}</b>\n'],
      ['of < b>', `f${e}`, 'for (const x of < b>// {Q}</b>\n) f(x)\n'],
      ['yield <\\nb>', `f${e}`, 'function* g() { yield <\nb>// {Q}</b>\n}\n'],
      ['yield </**/b>', `f${e}`, 'function* g() { yield </**/b>// {Q}</b>\n}\n'],
      ['yield <b>', `f${e}`, 'function* g() { yield <b>// {Q}</b>\n}\n'],
    ]),
    ['void < b> (.tsx)', 'f.tsx', 'x = void < b>// {Q}</b>\n'],
    ['f<T> < b> (.tsx)', 'f.tsx', 'x = f<T> < b>// {Q}</b>\n'],
    ['a > < b> (.tsx)', 'f.tsx', 'x = a > < b>// {Q}</b>\n'],
    ['a\\n> < b> (.tsx)', 'f.tsx', 'x = a\n> < b>// {Q}</b>\n'],
    // ...after a value and a line break, and after `}`.
    ['let x\\n< b> (.jsx)', 'f.jsx', 'let x\n< b>// {Q}</b>\n'],
    ['let x\\n< b> (.tsx)', 'f.tsx', 'let x\n< b>// {Q}</b>\n'],
    ['let x: number\\n< b> (.tsx)', 'f.tsx', 'let x: number\n< b>// {Q}</b>\n'],
    ['let x\\n</**/b> (.jsx)', 'f.jsx', 'let x\n</**/b>// {Q}</b>\n'],
    ['let x\\n<\\nb> (.jsx)', 'f.jsx', 'let x\n<\nb>// {Q}</b>\n'],
    ['} then < b> (.jsx)', 'f.jsx', 'function f() {}\n< b>// {Q}</b>\n'],
    ['} then < b> (.tsx)', 'f.tsx', 'function f() {}\n< b>// {Q}</b>\n'],
    ['} then </**/b> (.jsx)', 'f.jsx', 'function f() {}\n</**/b>// {Q}</b>\n'],
    ['} then <\\nb> (.tsx)', 'f.tsx', 'function f() {}\n<\nb>// {Q}</b>\n'],
    // R18: an expression starts after `extends`.
    ...['.js', '.mjs', '.ts', '.tsx'].flatMap((e) => [
      ['class A extends /re/', `f${e}`, 'class A extends /[//]/.constructor {}; x = [Q\n]\n'],
      ['class extends /re/', `f${e}`, 'x = class extends /[//]/.constructor {}; y = [Q\n]\n'],
    ]),
    // R19: `ignore next N` counts physical lines.
    ['c8 ignore next 3, comment inside the range', 'f.js', '/* c8 ignore next 3 */\na()\n// Q\nb()\nc()\n',
      '/* c8 ignore next 3 */\na()\nb()\nc()\n'],
    ['c8 ignore next 2, blank line inside the range', 'f.js', '/* c8 ignore next 2 */\na()\n\nb()\nc()\n',
      '/* c8 ignore next 2 */\na()\nb()\nc()\n'],
    ['v8 ignore next 2, comment after the range', 'f.ts', '/* v8 ignore next 2 */\na()\nb()\n// Q\nc()\n',
      '/* v8 ignore next 2 */\na()\nb()\nc()\n'],
    ['a kept directive between a next-line directive and a removed comment', 'f.js',
      '// eslint-disable-next-line no-eval\n// eslint-disable no-x\n// Q\neval(x)\n',
      '// eslint-disable-next-line no-eval\n// eslint-disable no-x\neval(x)\n'],
    ['<!-- right after <', 'f.cjs', 'x = a <<!-- /*\nQ\n--> */\n'],
    ['istanbul ignore next 2, block comment inside', 'f.js', '/* istanbul ignore next 2 */\na()\n/* Q\n*/\nb()\n',
      '/* istanbul ignore next 2 */\na()\nb()\n'],
  ].map(([name, path, a, b]) => [`R2: ${name}`, path, a, b ?? a.split('Q').join('good()'), false]),
  // Still comment-only after round 2.
  ['an a < b line with a comment edit (.tsx)', 'a.tsx', 'ok = a < b // old\n', 'ok = a < b // new\n', true],
  ['an a < b line with a comment edit (.jsx)', 'a.jsx', 'ok = a < b // old\n', 'ok = a < b // new\n', true],
  ['<< after a line break, comment edit (.tsx)', 'a.tsx', 'x = a\n  << 2 // old\n', 'x = a\n  << 2 // new\n', true],
  ['<= after a line break, comment edit (.jsx)', 'a.jsx', 'ok = a\n  <= b // old\n', 'ok = a\n  <= b // new\n', true],
  ['a trailing comment edit below a next-line directive', 'a.ts', '// @ts-ignore\nx() // old\n', '// @ts-ignore\nx() // new\n', true],
  ['c8 ignore next, comment edit on a code line', 'a.js', '/* c8 ignore next 2 */\na() // old\nb()\n', '/* c8 ignore next 2 */\na() // new\nb()\n', true],
  ['c8 ignore start/stop is not counted: a comment line removed', 'a.js', '/* c8 ignore start */\na()\n// c\nb()\n/* c8 ignore stop */\n',
    '/* c8 ignore start */\na()\nb()\n/* c8 ignore stop */\n', true],
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
  it('a next-line directive right above its code still classifies', () => {
    const t = 'a() // c\n// eslint-disable-next-line no-eval\neval(x) // d\n';
    assert.equal(stripComments(t, '.js'), 'a()\n// eslint-disable-next-line no-eval\neval(x)');
  });
  it('a file-level directive followed by a blank line still classifies', () => {
    assert.equal(stripComments('// @ts-nocheck\n\n// c\nx()\n', '.ts'), '// @ts-nocheck\nx()');
    assert.equal(stripComments('/* istanbul ignore file */\n\nx()\n', '.js'), '/* istanbul ignore file */\nx()');
    assert.equal(stripComments('// deno-lint-ignore-file\n\nx()\n', '.ts'), '// deno-lint-ignore-file\nx()');
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
