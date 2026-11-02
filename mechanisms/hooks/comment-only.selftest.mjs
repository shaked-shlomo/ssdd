// Tests for comment-only: what a comment-only change is, and what is reviewed.
// Run: node --test mechanisms/hooks/comment-only.selftest.mjs
// The safety corpus is the old tokenizer's (comment-strip, spec v3.4 Deviations):
// each pair it reviewed, each comment a tool reads, each text it couldn't classify
// with its comment edited, must still be reviewed. Pairs it carried may be reviewed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMENT_EXTS, commentOnly } from './comment-only.mjs';

const [LS, PS, ZWSP, NEL] = [0x2028, 0x2029, 0x200b, 0x85].map((c) => String.fromCharCode(c));
const NEXT_LINE = /next|@ts-expect-error|@ts-ignore|(prettier|biome|lint|fmt|dprint)-ignore/i;
// Every `//` run and block comment rewritten: the edit a false carry would hide.
const edit = (t) => t.replace(/\/\/[^\n]*/g, '// edited').replace(/\/\*[\s\S]*?\*\//g, '/* edited */');

// Texts the old scanner couldn't classify that hold a comment, [name, ext, input].
const UNCLASSIFIED = [
  ['division across a newline: null', '.js', 'x = a\n/re/.test(s) // c'],
  ['division across a newline hides a regex body: null', '.js', 'x = a\n/re// 2'],
  ['a block comment holding the line break: null', '.js', 'x = a/*\n*/ /re/.test(s)'],
  ['x! then a line break and /: null', '.ts', 'y = x!\n/ 2 // c'],
  ['less-than after a line break in .tsx: null (R17)', '.tsx', 'ok = a\n  < b // c'],
];

// Comments a tool reads, [name, ext, input]: editing or dropping one is reviewed, and
// so is a comment line put below one that targets the next line.
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
  ['deno-coverage-ignore', '.ts', 'x() // deno-coverage-ignore'],
  ['deno-coverage-ignore-next', '.ts', '// deno-coverage-ignore-next\nx()'],
  ['deno-coverage-ignore-start', '.ts', '// deno-coverage-ignore-start\nx()'],
  ['deno-coverage-ignore-stop', '.ts', 'x()\n// deno-coverage-ignore-stop'],
  ['DENO-COVERAGE-IGNORE-NEXT in capitals', '.ts', '// DENO-COVERAGE-IGNORE-NEXT\nx()'],
  ['BIOME-IGNORE in capitals', '.ts', '// BIOME-IGNORE lint: x\nx()'],
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

// [name, path, a, b, expected commentOnly]. The old scanner's pairs: a false stays false;
// the trailing-comment, block-comment and JSX-line edits it carried are reviewed now.
const PAIRS = [
  ['a // edit', 'src/a.ts', 'x() // old\n', 'x() // new\n', false],
  ['a comment added on its own line', 'a.ts', 'a()\nb()\n', 'a()\n// why\nb()\n', true],
  ['a comment moved', 'a.ts', '// c\na()\nb()\n', 'a()\n// c\nb()\n', true],
  ['a block comment edited', 'lib/a.mjs', '/** Hello. */\nlet a', '/** Bye. */\nlet a', false],
  ['a code edit', 'a.ts', 'const a = 1\n', 'const a = 2\n', false],
  ['a code edit beside a comment', 'a.ts', 'x = 1 // c\n', 'x = 2 // c\n', false],
  ['a comment glued two tokens', 'a.js', 'a/**/b', 'ab', false],
  ['an eslint-disable-next-line edit', 'a.ts', '// eslint-disable-next-line a\nx()', '// eslint-disable-next-line b\nx()', false],
  ['a JSDoc type edit in .mjs', 'a.mjs', '/** @type {string} */\nlet a', '/** @type {number} */\nlet a', false],
  ['a JSDoc type edit in .ts', 'a.ts', '/** @type {string} */\nlet a', '/** @type {number} */\nlet a', false],
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
  ['a BOM on both sides', 'a.ts', '\uFEFFx() // old\n', '\uFEFFx() // new\n', false],
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
  // Review round 3.
  ...[
    // R20: after `extends`, a `<` may open TS type parameters, not JSX.
    ['extends <U>() => U, then "</U>//" and code', 'f.tsx', 'type A<T> = T extends <U>() => U ? 1 : 2; s = "</U>//"; Q\n'],
    ["extends <U>, then '{/*Q*/}' and // </U>", 'f.tsx', "type X<T> = T extends <U>() => U ? 1 : 2; s = '{/*Q*/}'; // </U>\n"],
    ["extends <U>, a line break, then '{/*Q*/}'", 'f.tsx', "type X<T> = T extends <U>() => U ? 1 : 2\ns = '{/*Q*/}' // </U>\n"],
    ["extends <U>(a: '{/*Q*/}') in a conditional type", 'f.tsx', "type X<T> = T extends <U>(a: '{/*Q*/}') => void // </U>\n? 1 : 2\n"],
    ["extends <U>(a: '{/*Q*/}') in a function's type parameters", 'f.tsx', "function f<T extends <U>(a: '{/*Q*/}') => void // </U>\n>() {}\n"],
    ["extends <U>(a: '{/*Q*/}') in an interface's type parameters", 'f.tsx', "interface I<T extends <U>(a: '{/*Q*/}') => void // </U>\n> {}\n"],
    ['extends <U>() => U> in a function, then code', 'f.tsx', 'function f<T extends <U>() => U>() { s = "</U>//"; Q }\n'],
    // R21: any `ignore next N` counts lines; Deno's coverage comments are kept.
    ['node:coverage ignore next 2, comment line in the range', 'f.js', '/* node:coverage ignore next 2 */\na()\n// Q\nb()\nc()\n',
      '/* node:coverage ignore next 2 */\na()\nb()\nc()\n'],
    ['node:coverage ignore next 2, blank line in the range', 'f.js', '/* node:coverage ignore next 2 */\na()\n\nb()\nc()\n',
      '/* node:coverage ignore next 2 */\na()\nb()\nc()\n'],
    ['node:coverage ignore next 2 in .tsx', 'f.tsx', '/* node:coverage ignore next 2 */\na()\n// Q\nb()\n',
      '/* node:coverage ignore next 2 */\na()\nb()\n'],
    ['C8 IGNORE NEXT 2 in capitals, comment line in the range', 'f.tsx', '/* C8 IGNORE NEXT 2 */\na()\n// Q\nb()\n',
      '/* C8 IGNORE NEXT 2 */\na()\nb()\n'],
    ['deno-coverage-ignore-next, comment line between', 'f.ts', '// deno-coverage-ignore-next\n// Q\na()\n', '// deno-coverage-ignore-next\na()\n'],
    ['deno-coverage-ignore-next, blank line between', 'f.tsx', '// deno-coverage-ignore-next\n\na()\n', '// deno-coverage-ignore-next\na()\n'],
    ['deno-coverage-ignore-next removed', 'f.ts', '// deno-coverage-ignore-next\na()\n', 'a()\n'],
    ['deno-coverage-ignore-next added', 'f.tsx', 'a()\n', '// deno-coverage-ignore-next\na()\n'],
    ['deno-coverage-ignore removed', 'f.ts', 'a() // deno-coverage-ignore\n', 'a()\n'],
    ['deno-coverage-ignore-start/stop removed', 'f.tsx', '// deno-coverage-ignore-start\na()\n// deno-coverage-ignore-stop\n', 'a()\n'],
    ['deno-coverage-ignore-stop added', 'f.ts', '// deno-coverage-ignore-start\na()\n', '// deno-coverage-ignore-start\na()\n// deno-coverage-ignore-stop\n'],
  ].map(([name, path, a, b]) => [`R3: ${name}`, path, a, b ?? a.split('Q').join('good()'), false]),
  // Review round 4 (R22): in .tsx a generic function type or arrow is not JSX.
  ...[
    ['= <U>() => U', 'type F = <U>() => U; s = "</U>//"; Q\n'],
    [': <U>() => U', 'let f: <U>() => U; s = "</U>//"; Q\n'],
    ['( <U>() => U', 'type X<T> = T extends (<U>() => U) ? 1 : 2; s = "</U>//"; f(Q,\n)\n'],
    ['[ <U>() => U', 'type X<T> = T extends [<U>() => U] ? 1 : 2; s = "</U>//"; f([Q,\n])\n'],
    ['| <U>() => U', 'type F = A | <U>() => U; s = "</U>//"; Q\n'],
    ['a parameter type <U>() => U', 'function g(a: <U>() => U) {} s = "</U>//"; Q\n'],
    ['as <U>() => U', 'let f = x as <U>() => U; s = "</U>//"; Q\n'],
    ['new <U>() => U', 'type C = new <U>() => U; s = "</U>//"; Q\n'],
    ['<U> /* c */ (', 'type F = <U> /* c */ () => U; s = "</U>//"; Q\n'],
    ['<U>, a line break, (', 'type F = <U>\n() => U; s = "</U>//"; Q\n'],
    ['return <U>(x: U) => x', 'function f() { return <U>(x: U) => x; s = "</U>//"; Q }\n'],
    ['<T,>(x: T) => x', 'const f = <T,>(x: T) => x; s = "</T>//"; Q\n'],
    ['<T extends X>(x) => x', 'const f = <T extends X>(x) => x; s = "</T>//"; Q\n'],
    ['<T = D>(x) => x', 'const f = <T = D>(x) => x; s = "</T>//"; Q\n'],
    ['<T extends X = D>(x) => x', 'const f = <T extends X = D>(x) => x; s = "</T>//"; Q\n'],
  ].map(([name, a]) => [`R4: ${name}`, 'f.tsx', a, a.split('Q').join('good()'), false]),
  ...[
    ['Deno caps, comment line between', 'f.ts', '// DENO-COVERAGE-IGNORE-NEXT\n// Q\na()\n', '// DENO-COVERAGE-IGNORE-NEXT\na()\n'],
    ['Deno caps removed', 'f.tsx', '// DENO-COVERAGE-IGNORE-NEXT\na()\n', 'a()\n'],
  ].map(([name, path, a, b]) => [`R4: ${name}`, path, a, b, false]),
  // Review round 5 (R23): in .tsx a `\` in a JSX attribute string may be a TS escape.
  ...[
    ['= <const U = "a\\">x">', 'type F = <const U = "a\\">x">() => U; s = "</const>//"; Q\n'],
    ["= <const U = 'a\\'>x'>", "type F = <const U = 'a\\'>x'>() => U; s = \"</const>//\"; Q\n"],
    [': <const U = "a\\">x">', 'let f: <const U = "a\\">x">() => U; s = "</const>//"; Q\n'],
    ['new <const U = "a\\">x">', 'type C = new <const U = "a\\">x">() => U; s = "</const>//"; Q\n'],
    ['<const T = "a\\">x",>(x: T)', 'let f = <const T = "a\\">x",>(x: T) => x; s = "</const>//"; Q\n'],
    ['<const T = "a\\">x">(x: T)', 'let f = <const T = "a\\">x">(x: T) => x; s = "</const>//"; Q\n'],
  ].map(([name, a]) => [`R5: ${name}`, 'f.tsx', a, a.split('Q').join('good()'), false]),
  ['.tsx JSX with an attribute: a comment edit', 'a.tsx', 'x = <a href="x">t</a> // old\n', 'x = <a href="x">t</a> // new\n', false],
  ['.jsx JSX attribute with a backslash: a comment edit', 'a.jsx', 'x = <a b="\\">t</a> // old\n', 'x = <a b="\\">t</a> // new\n', false],
  // Still comment-only after round 4.
  ['ordinary JSX with an attribute: a comment edit', 'a.tsx', 'x = <a href="x">t</a> // old\n', 'x = <a href="x">t</a> // new\n', false],
  ['nested JSX with an expression: a comment edit', 'a.tsx', 'x = <a><b>{y}</b> t</a> // old\n', 'x = <a><b>{y}</b> t</a> // new\n', false],
  ['.ts generic function type: a comment edit', 'a.ts', 'type F = <U>() => U // old\n', 'type F = <U>() => U // new\n', false],
  ['.jsx text starting with (: a comment edit', 'a.jsx', 'x = <b>(x)</b> // old\n', 'x = <b>(x)</b> // new\n', false],
  // Still comment-only after round 3.
  ['class A extends /re/: a later comment edit', 'a.tsx', 'class A extends /x/.constructor {} // old\nf()\n', 'class A extends /x/.constructor {} // new\nf()\n', false],
  ['class A extends /re/ in .js: a later comment edit', 'a.js', 'class A extends /[//]/.constructor {}\nx = 1 // old\n', 'class A extends /[//]/.constructor {}\nx = 1 // new\n', false],
  ['.ts T extends <U>() => U: a comment edit', 'a.ts', 'type X<T> = T extends <U>() => U ? 1 : 2 // old\n', 'type X<T> = T extends <U>() => U ? 1 : 2 // new\n', false],
  // Still comment-only after round 2.
  ['an a < b line with a comment edit (.tsx)', 'a.tsx', 'ok = a < b // old\n', 'ok = a < b // new\n', false],
  ['an a < b line with a comment edit (.jsx)', 'a.jsx', 'ok = a < b // old\n', 'ok = a < b // new\n', false],
  ['<< after a line break, comment edit (.tsx)', 'a.tsx', 'x = a\n  << 2 // old\n', 'x = a\n  << 2 // new\n', false],
  ['<= after a line break, comment edit (.jsx)', 'a.jsx', 'ok = a\n  <= b // old\n', 'ok = a\n  <= b // new\n', false],
  ['a trailing comment edit below a next-line directive', 'a.ts', '// @ts-ignore\nx() // old\n', '// @ts-ignore\nx() // new\n', false],
  ['c8 ignore next, comment edit on a code line', 'a.js', '/* c8 ignore next 2 */\na() // old\nb()\n', '/* c8 ignore next 2 */\na() // new\nb()\n', false],
  ['c8 ignore start/stop is not counted: a comment line removed', 'a.js', '/* c8 ignore start */\na()\n// c\nb()\n/* c8 ignore stop */\n',
    '/* c8 ignore start */\na()\nb()\n/* c8 ignore stop */\n', true],
];

// The line check's own guards, [name, path, a, b, expected].
const LINES = [
  ['a comment line edited', 'a.ts', '// old\nexport const a = 1\n', '// new\nexport const a = 1\n', true],
  ['a blank line added', 'a.js', 'a()\nb()\n', 'a()\n\nb()\n', true],
  ['trailing whitespace on a code line', 'a.js', 'a()  \nb()\n', 'a()\nb()\n', true],
  ['a comment above a template', 'a.js', '// old\nx = `a`\n', '// new\nx = `a`\n', true],
  ['a comment below the last template', 'a.js', 'x = `a`\n// old\n', 'x = `a`\n// new\n', true],
  ['a comment holding backticks', 'a.js', 'a()\n// use `b`\n', 'a()\n// use `c`\n', true],
  ['a comment below a < with no JSX closer after', 'a.js', 'y = a < b\n// old\nz()\n', 'y = a < b\n// new\nz()\n', true],
  ['.ts has no JSX', 'a.ts', 'let a: Array<string> = []\n// old\nf(<T>a)\n', 'let a: Array<string> = []\n// new\nf(<T>a)\n', true],
  ['a code line becomes a comment', 'a.js', 'x()\n', '// x()\n', false],
  ['a comment line inside a template', 'a.js', 'x = `a\n// old\n`\n', 'x = `a\n// new\n`\n', false],
  ['a blank line added inside a template', 'a.js', 'x = `a\nb`\n', 'x = `a\n\nb`\n', false],
  ['a template closed on a comment-looking line', 'a.js', 'x = `\n// old\n// end`\ny()\n', 'x = `\n// new\n// end`\ny()\n', false],
  ['trailing spaces on a line opening a template', 'a.js', 'x = `a  \nb`\n', 'x = `a\nb`\n', false],
  ['an odd backtick count', 'a.js', '// it`s\nx = 1\n', '// it`s\nx = 1\n// new\n', false],
  ['a string continued with \\', 'a.js', "x = 'a\\\n// old\n'\n", "x = 'a\\\n// new\n'\n", false],
  ['trailing whitespace after a \\', 'a.js', "x = 'a\\\nb'\n", "x = 'a\\  \nb'\n", false],
  ['a // line inside a block comment', 'a.js', '/*\n// old\n*/\nx()\n', '/*\n// new\n*/\nx()\n', false],
  ['a block comment after a string holding /*', 'a.js', 's = "/*"; /* a\n// old\n*/\n', 's = "/*"; /* a\n// new\n*/\n', false],
  ['*/* hiding an opener', 'a.js', 's = "/*"; y = a */* b\n// old\n*/\n', 's = "/*"; y = a */* b\n// new\n*/\n', false],
  ['JSX text far from its tags', 'a.jsx', 'x = <div>\n  {a}\n  // old\n  {b}\n</div>\n', 'x = <div>\n  {a}\n  // new\n  {b}\n</div>\n', false],
  ['JSX text in .js', 'a.js', 'x = <p>\n// old\n</p>\n', 'x = <p>\n// new\n</p>\n', false],
  ['JSX text closed with spaces', 'a.mjs', 'x = <p>\n// old\n< /p>\n', 'x = <p>\n// new\n< /p>\n', false],
  ['a multi-line JSX attribute string', 'a.tsx', 'x = <a b="\n// old\n" />\n', 'x = <a b="\n// new\n" />\n', false],
  ['ignore next N far above', 'a.js', '/* c8 ignore next 9 */\na()\nb()\n// old\n', '/* c8 ignore next 9 */\na()\nb()\n// new\n', false],
  ['a wrapped block directive above', 'a.js', '/* istanbul ignore\n   next */\nrisky()\n', '/* istanbul ignore\n   next */\n// new\nrisky()\n', false],
  ['a directive on the code line above', 'a.ts', 'x() /* prettier-ignore */\n', 'x() /* prettier-ignore */\n// new\n', false],
  ['a comment naming a tool', 'a.ts', '// old\nx()\n', '// see the eslint docs\nx()\n', false],
  ['/// is a TS reference', 'a.ts', 'x()\n', '/// <reference types="a" />\nx()\n', false],
  // Review of the line check (2026-11-01): each was a wrong true.
  ['a line put above a hashbang', 'a.mjs', '#!/usr/bin/env node\nx()\n', '\n#!/usr/bin/env node\nx()\n', false],
  ['a comment put above a hashbang', 'a.js', '#!/usr/bin/env node\nx()\n', '// hi\n#!/usr/bin/env node\nx()\n', false],
  ['a CR after a hashbang', 'a.mjs', '#!/usr/bin/env node\nx()\n', '#!/usr/bin/env node\r\nx()\n', false],
  ['a JSX attribute closed by / // c then >', 'a.jsx', 'const x = <a b="1\n" / // c\n>;\n', 'const x = <a b="1\n// y\n" / // c\n>;\n', false],
  ['a JSX attribute closed by / /* c */ >', 'a.tsx', 'const x = <a b="1\n" / /* c */ >;\n', 'const x = <a b="1\n// y\n" / /* c */ >;\n', false],
  ['U+2028 after a next-line directive', 'f.js', '// eslint-disable-next-line no-eval\neval(x)\n', `// eslint-disable-next-line no-eval${LS}\neval(x)\n`, false],
  ['CR then a space after a next-line directive', 'f.js', '// eslint-disable-next-line no-eval\neval(x)\n', '// eslint-disable-next-line no-eval\r \neval(x)\n', false],
  ['$FlowFixMe', 'a.js', '// @flow\nconst b = 1;\nconst a: number = "s";\n', '// @flow\nconst b = 1;\n// $FlowFixMe\nconst a: number = "s";\n', false],
  ['// falls through', 'a.js', 'switch (a) {\n  case 1: f();\n  case 2: g();\n}\n', 'switch (a) {\n  case 1: f();\n  // falls through\n  case 2: g();\n}\n', false],
  ['// no default', 'a.js', 'switch (a) {\n  case 1: f();\n}\n', 'switch (a) {\n  case 1: f();\n  // no default\n}\n', false],
  ['// nosemgrep', 'a.ts', 'a()\nrisky()\n', 'a()\n// nosemgrep\nrisky()\n', false],
  ['// NOSONAR', 'a.ts', 'a()\nrisky()\n', 'a()\n// NOSONAR\nrisky()\n', false],
  ['// codeql[js/x]', 'a.ts', 'a()\nrisky()\n', 'a()\n// codeql[js/x]\nrisky()\n', false],
  ['// skipcq', 'a.js', 'a()\nrisky()\n', 'a()\n// skipcq: JS-0001\nrisky()\n', false],
  ['a comment above a Jest docblock', 'a.ts', '/**\n * @jest-environment jsdom\n */\ntest()\n', '// note\n/**\n * @jest-environment jsdom\n */\ntest()\n', false],
  ['a comment above // @flow', 'a.js', '// @flow\nx()\n', '// note\n// @flow\nx()\n', false],
  ['a comment below // @flow', 'a.js', '// @flow\nx()\n', '// @flow\nx()\n// note\n', true],
  ['CRLF after a code line still carries', 'a.ts', 'a()\nb()\n', 'a()\r\nb()\n', true],
  ['U+2028 in a comment line', 'a.js', 'a()\n// old\n', `a()\n// new${LS}b()\n`, false],
  ['a lone CR in a comment line', 'a.js', 'a()\n// old\n', 'a()\n// new\rb()\n', false],
  // Re-review of the line check (2026-11-01): each was a wrong true.
  ...[LS, PS, '\r'].map((t) => [`a JSX attribute closed by / // c, U+${t.charCodeAt(0).toString(16)}, >`, 'a.tsx',
    `x = <a b="1\n" / //c${t}>;\n`, `x = <a b="1\n// y\n" / //c${t}>;\n`, false]),
  ...[ZWSP, NEL].map((w) => [`a JSX attribute closed by / U+${w.charCodeAt(0).toString(16)} >`, 'a.tsx',
    `x = <a b="1\n" /${w}>;\n`, `x = <a b="1\n// y\n" /${w}>;\n`, false]),
  ['a directive in <!-- above', 'f.cjs', '<!-- eslint-disable-next-line no-eval\n// note\neval(x)\n', '<!-- eslint-disable-next-line no-eval\neval(x)\n', false],
  ['a directive in --> above', 'f.cjs', 'x = 1\n--> eslint-disable-next-line no-eval\n\neval(x)\n', 'x = 1\n--> eslint-disable-next-line no-eval\neval(x)\n', false],
  ['a trailing <!-- directive above', 'f.cjs', 'f() <!-- eslint-disable-next-line no-eval\n\neval(x)\n', 'f() <!-- eslint-disable-next-line no-eval\neval(x)\n', false],
  ['<!-- falls through', 'f.cjs', 'switch (a) {\n  case 1: f();\n  <!-- falls through\n  // note\n  case 2: g();\n}\n', 'switch (a) {\n  case 1: f();\n  <!-- falls through\n  case 2: g();\n}\n', false],
];

describe('COMMENT_EXTS', () => {
  it('is the JS/TS family', () => {
    assert.deepEqual([...COMMENT_EXTS].sort(), ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
  });
});

describe('commentOnly', () => {
  for (const [name, path, a, b, want] of [...PAIRS, ...LINES]) {
    it(name, () => assert.equal(commentOnly(a, b, path), want));
  }
});

describe('the safety corpus is reviewed', () => {
  for (const [name, ext, t] of UNCLASSIFIED) {
    it(`unclassified, comment edited: ${name}`, () => assert.equal(commentOnly(t, edit(t), `f${ext}`), false));
  }
  for (const [name, ext, t] of TOOL_READ) {
    const variants = { edited: edit(t), dropped: t.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#![^\n]*/, '') };
    if (NEXT_LINE.test(t)) variants['moved off its line'] = t.replace('\n', '\n// Q\n');
    for (const [how, b] of Object.entries(variants)) {
      if (b !== t) it(`a tool-read comment ${how}: ${name}`, () => assert.equal(commentOnly(t, b, `f${ext}`), false));
    }
  }
});

describe('nothing throws', () => {
  it('non-string input', () => {
    assert.equal(commentOnly(null, 'x()', 'a.js'), false);
    assert.equal(commentOnly(Buffer.from('x()'), 'x()\n', 'a.js'), false);
    assert.equal(commentOnly('x()', 'y()', null), false);
  });
  it('a non-UTF-8 blob decoded with replacement characters', () => {
    const bin = Buffer.from([0xff, 0xfe, 0x2f, 0x2f, 0x80, 0x0a, 0x00, 0xc3]).toString('utf8');
    assert.equal(commentOnly(bin, bin + '\n// c', 'a.js'), false);
  });
  it('a JSX closer behind a long comment chain stays linear', () => {
    // A `/` then comments and no `>`: a backtracking regex took seconds on 26.
    const a = `x = <p>\n// old\n/ ${'/*a*/ '.repeat(100000)}\n`;
    const t = Date.now();
    assert.equal(commentOnly(a, a.replace('// old', '// new'), 'a.jsx'), true);
    assert.ok(Date.now() - t < 2000, `${Date.now() - t} ms`);
  });
  it('a large file with many edits stays linear', () => {
    const a = Array.from({ length: 50000 }, (_, i) => (i % 2 ? `// old ${i}` : `/* x */ x${i}()`)).join('\n');
    const t = Date.now();
    assert.equal(commentOnly(a, a.replaceAll('// old', '// new'), 'a.js'), true);
    assert.ok(Date.now() - t < 2000, `${Date.now() - t} ms`);
  });
});
