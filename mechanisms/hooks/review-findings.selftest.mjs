// Tests for the review gate's findings (spec v3.5): `--stamp <reviewer>
// --report <file>` records a review's findings in the stamp file; a re-review
// is handed the open ones and answers each by ID; a [pre-existing] finding
// isn't held open; rounds warn at reviewGate.maxRounds; the triage note names
// open findings by ID. Each case builds a scratch repo, as review-gate's do.
//
// Zero-dependency: Node's built-in test runner (`node --test`), Node >= 22.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'review-gate.mjs');
const NODE = process.execPath;

// alpha covers src/a.ts only; beta covers all of src/.
const CONFIG = {
  routing: [
    { reviewer: 'alpha', paths: ['^src/a\\.ts$'] },
    { reviewer: 'beta', paths: ['^src/'] },
  ],
};

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function makeRepo(config = CONFIG) {
  const dir = mkdtempSync(join(tmpdir(), 'ssdd-findings-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.ssdd'));
  writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'README'), 'base\n');
  git(dir, 'add', 'README', '.ssdd/config.json');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

function put(dir, path, content, { stage = true } = {}) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  if (stage) git(dir, 'add', path);
}

function run(dir, args, { input } = {}) {
  const r = spawnSync(NODE, [HOOK, ...args], {
    input: input ?? '', cwd: dir, encoding: 'utf8',
    env: { ...process.env, SSDD_REVIEW_SKIP: '' },
  });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}
const preCommit = (dir) => run(dir, ['--pre-commit']);
const check = (dir) => run(dir, ['--check']);
const stamp = (dir, reviewers) => run(dir, ['--stamp', reviewers]);
let reportDir;
let reportN = 0;
// The orchestrator's step: save the reviewer's reply outside the work tree, then stamp.
function report(dir, reviewer, text, extra = []) {
  const file = join(reportDir, `r${++reportN}.md`);
  writeFileSync(file, text);
  return run(dir, ['--stamp', reviewer, '--report', file, ...extra]);
}
const stampFile = (dir) => join(dir, '.git', 'ssdd-review-stamp.json');
const readStamp = (dir) => JSON.parse(readFileSync(stampFile(dir), 'utf8'));
const reviews = (dir) => Object.values(readStamp(dir).reviews ?? {});
const finding = (dir, id) => {
  for (const r of reviews(dir)) if (r.findings?.[id]) return r.findings[id];
  return undefined;
};
const ok = (r) => { assert.strictEqual(r.status, 0, r.stdout + r.stderr); return r; };

const FIVE = 'l1\nl2\nl3\nl4\nl5\n';

let dir;
beforeEach(() => { dir = makeRepo(); reportDir = mkdtempSync(join(tmpdir(), 'ssdd-reports-')); });
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(reportDir, { recursive: true, force: true });
});

describe('--stamp --report', () => {
  it('records the findings with new IDs', () => {
    put(dir, 'src/a.ts', 'a\n');
    const r = ok(report(dir, 'alpha', '❌ race — src/a.ts:1 — guard it\n❌ timeout — src/a.ts:1 — add one\n⚠️ naming — src/a.ts:1\n\n2 ISSUE(S)'));
    const rs = reviews(dir);
    assert.equal(rs.length, 1);
    assert.equal(rs[0].reviewer, 'alpha');
    assert.equal(rs[0].verdict, 'ISSUES');
    assert.equal(rs[0].issues, 2);
    assert.deepEqual(Object.keys(rs[0].files), ['src/a.ts']);
    const ids = Object.keys(rs[0].findings);
    assert.equal(ids.length, 3);
    assert.ok(ids.every((id) => /^F\d+$/.test(id)));
    const f = rs[0].findings[ids[0]];
    assert.deepEqual([f.kind, f.path, f.line, f.text], ['❌', 'src/a.ts', [1, 1], 'race — src/a.ts:1 — guard it']);
    const entry = readStamp(dir).reviewers.alpha['src/a.ts'];
    assert.ok(readStamp(dir).reviews[entry.review]);
    for (const id of ids) assert.match(r.stdout, new RegExp(`\\b${id}\\b`));
    assert.strictEqual(preCommit(dir).status, 1); // beta still owes
  });

  it('`-` reads stdin', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(run(dir, ['--stamp', 'alpha', '--report', '-'], { input: '❌ race — src/a.ts:1\n\n1 ISSUE(S)' }));
    assert.equal(reviews(dir).length, 1);
  });

  it('refused, writing nothing', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(stamp(dir, 'beta'));
    const before = readFileSync(stampFile(dir), 'utf8');
    for (const [name, args, input, want] of [
      ['no verdict', null, '❌ race — src/a.ts:1\nlooks fine', /no verdict/],
      ['NO DIFF', null, 'NO DIFF — scope not provided', /NO DIFF/],
      ['a missing file', ['--stamp', 'alpha', '--report', join(reportDir, 'nope.md')], '', /can't read/],
      ['an empty stdin', ['--stamp', 'alpha', '--report', '-'], '', /empty/],
      ['--report with two reviewers', ['--stamp', 'alpha,beta', '--report', '-'], 'CLEAN', /usage/],
      ['--report with no file', ['--stamp', 'alpha', '--report'], '', /usage/],
    ]) {
      const r = args ? run(dir, args, { input }) : report(dir, 'alpha', input);
      assert.strictEqual(r.status, 1, name);
      assert.match(r.stderr, want, name);
      assert.strictEqual(readFileSync(stampFile(dir), 'utf8'), before, name);
    }
  });

  it("a count that doesn't match N stamps and says so", () => {
    put(dir, 'src/a.ts', 'a\n');
    const r = ok(report(dir, 'alpha', '❌ race — src/a.ts:1\n❌ leak — src/a.ts:1\n\n3 ISSUE(S)'));
    assert.match(r.stdout, /says 3.*2 ❌/);
  });

  it('without --report: stamped, no findings, one-line note', () => {
    put(dir, 'src/a.ts', 'a\n');
    const r = ok(stamp(dir, 'alpha'));
    assert.match(r.stdout, /no findings recorded/);
    assert.equal(readStamp(dir).reviews, undefined);
  });

  it('`✅ [F1] fixed` closes F1, by the review that said so; an unmentioned one stays open', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', '❌ race — src/a.ts:1\n❌ leak — src/a.ts:1\n\n2 ISSUE(S)'));
    const [f1, f2] = Object.keys(reviews(dir)[0].findings);
    put(dir, 'src/a.ts', 'a2\n');
    const r = ok(report(dir, 'alpha', `✅ [${f1}] fixed\n\nCLEAN`));
    assert.equal(finding(dir, f1).outcome, 'fixed');
    assert.ok(readStamp(dir).reviews[finding(dir, f1).by]);
    assert.equal(finding(dir, f2).outcome, undefined);
    assert.match(r.stdout, new RegExp(`${f1} fixed`));
  });

  it('`❌ [F1] …` keeps F1 open and makes no new finding', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', '❌ race — src/a.ts:1\n\n1 ISSUE(S)'));
    const [f1] = Object.keys(reviews(dir)[0].findings);
    put(dir, 'src/a.ts', 'a2\n');
    const r = ok(report(dir, 'alpha', `❌ [${f1}] still racy\n\n1 ISSUE(S)`));
    assert.equal(finding(dir, f1).outcome, undefined);
    assert.equal(reviews(dir).reduce((n, rv) => n + Object.keys(rv.findings).length, 0), 1);
    assert.doesNotMatch(r.stdout, /says/);
  });

  it("another reviewer's ID is ignored, with a note", () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', '❌ race — src/a.ts:1\n\n1 ISSUE(S)'));
    const [f1] = Object.keys(reviews(dir)[0].findings);
    const r = ok(report(dir, 'beta', `✅ [${f1}] fixed\n\nCLEAN`));
    assert.equal(finding(dir, f1).outcome, undefined);
    assert.match(r.stdout, new RegExp(`${f1}.*alpha`));
  });

  it('a repeated finding keeps its ID', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', '❌ race — src/a.ts:1\n\n1 ISSUE(S)'));
    put(dir, 'src/a.ts', 'a2\n');
    const r = ok(report(dir, 'alpha', '**❌ Race — `src/a.ts:1`**\n\n1 ISSUE(S)'));
    assert.equal(reviews(dir).reduce((n, rv) => n + Object.keys(rv.findings).length, 0), 1);
    assert.match(r.stdout, /repeated/);
  });

  it('a stale review is dropped on the next stamp', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', '❌ race — src/a.ts:1\n\n1 ISSUE(S)'));
    ok(stamp(dir, 'beta'));
    git(dir, 'commit', '-qm', 'a');
    put(dir, 'src/a.ts', 'a2\n');
    ok(stamp(dir, 'alpha'));
    assert.deepEqual(readStamp(dir).reviews, {});
  });

  it('a partial commit leaves a review current through its other file', () => {
    put(dir, 'src/a.ts', 'a\n');
    put(dir, 'src/b.ts', 'b\n');
    ok(report(dir, 'beta', '❌ race — src/b.ts:1\n\n1 ISSUE(S)'));
    ok(stamp(dir, 'alpha'));
    git(dir, 'commit', '-qm', 'a only', '--', 'src/a.ts');
    put(dir, 'src/c.ts', 'c\n');
    ok(stamp(dir, 'beta'));
    assert.equal(reviews(dir).length, 1);
    assert.match(check(dir).stdout, /\[F\d+\] beta — src\/b\.ts:1/);
  });

  it('two stamps in parallel get distinct IDs', async () => {
    put(dir, 'src/a.ts', 'a\n');
    const fa = join(reportDir, 'pa.md');
    const fb = join(reportDir, 'pb.md');
    writeFileSync(fa, '❌ one — src/a.ts:1\n❌ two — src/a.ts:1\n\n2 ISSUE(S)');
    writeFileSync(fb, '❌ three — src/a.ts:1\n❌ four — src/a.ts:1\n\n2 ISSUE(S)');
    const go = (who, file) => new Promise((res) => {
      const p = spawn(NODE, [HOOK, '--stamp', who, '--report', file], { cwd: dir, env: { ...process.env, SSDD_REVIEW_SKIP: '' } });
      p.on('close', res);
    });
    assert.deepEqual(await Promise.all([go('alpha', fa), go('beta', fb)]), [0, 0]);
    const ids = reviews(dir).flatMap((r) => Object.keys(r.findings));
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, 4);
  });

  it('unknown top-level keys survive a stamp without --report', () => {
    put(dir, 'src/a.ts', 'a\n');
    writeFileSync(stampFile(dir), JSON.stringify({ version: 2, reviewers: {}, later: { x: 1 } }));
    ok(stamp(dir, 'alpha'));
    assert.deepEqual(readStamp(dir).later, { x: 1 });
    assert.equal(readStamp(dir).version, 2);
  });

  it('a stamp file without reviews gates as before', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(stamp(dir, 'alpha,beta'));
    assert.strictEqual(preCommit(dir).status, 0);
    put(dir, 'src/a.ts', 'a2\n');
    assert.strictEqual(preCommit(dir).status, 1);
  });
});

describe('[pre-existing]', () => {
  beforeEach(() => {
    put(dir, 'src/a.ts', FIVE);
    git(dir, 'commit', '-qm', 'five');
    put(dir, 'src/a.ts', 'l1\nl2\nl3\nl4\nl5 changed\n');
  });
  const tagged = (cite) => {
    const r = ok(report(dir, 'alpha', `❌ [pre-existing] old bug — ${cite} — fix\n\n1 ISSUE(S)`));
    const [id] = Object.keys(reviews(dir)[0].findings);
    return { r, f: finding(dir, id), id };
  };

  it('an unchanged line keeps the tag, and the finding is not listed', () => {
    const { f, id } = tagged('src/a.ts:2');
    assert.equal(f.outcome, 'pre-existing');
    put(dir, 'src/a.ts', 'l1\nl2\nl3\nl4\nl5 changed again\n');
    assert.doesNotMatch(check(dir).stdout, new RegExp(`\\[${id}\\]`));
  });

  it('an added line drops the tag', () => {
    const { r, f } = tagged('src/a.ts:5');
    assert.equal(f.outcome, undefined);
    assert.match(r.stdout, /pre-existing.*dropped|dropped.*pre-existing/);
  });

  it('a range touching an added line drops the tag', () => {
    assert.equal(tagged('src/a.ts:4-5').f.outcome, undefined);
  });

  it('a new file drops the tag, line or not', () => {
    git(dir, 'rm', '-qf', '--cached', 'src/a.ts');
    git(dir, 'commit', '-qm', 'drop');
    put(dir, 'src/a.ts', 'brand new\n');
    assert.equal(tagged('src/a.ts:1').f.outcome, undefined);
  });

  it('no line on a changed file keeps the tag', () => {
    assert.equal(tagged('`src/a.ts`').f.outcome, 'pre-existing');
  });

  it('a cited file outside the change keeps the tag', () => {
    put(dir, 'src/z.ts', 'z\n', { stage: false });
    git(dir, 'add', 'src/z.ts');
    git(dir, 'commit', '-qm', 'z', '--', 'src/z.ts');
    assert.equal(tagged('src/z.ts:1').f.outcome, 'pre-existing');
  });

  it('an unrouted file the change edits: its added lines count too', () => {
    put(dir, 'docs/x.md', 'one\n', { stage: false });
    git(dir, 'add', 'docs/x.md');
    git(dir, 'commit', '-qm', 'x', '--', 'docs/x.md');
    put(dir, 'docs/x.md', 'one\ntwo\n', { stage: false });
    assert.equal(tagged('docs/x.md:2').f.outcome, undefined);
  });

  it('an unstaged change is diffed as reviewed', () => {
    put(dir, 'src/a.ts', 'l1\nl2 edited\nl3\nl4\nl5 changed\n', { stage: false });
    assert.equal(tagged('src/a.ts:2').f.outcome, undefined);
  });

  it("a pre-existing finding doesn't make the next stamp a round", () => {
    tagged('src/a.ts:2');
    put(dir, 'src/a.ts', 'l1\nl2\nl3\nl4\nl5 again\n');
    ok(stamp(dir, 'alpha'));
    assert.equal(readStamp(dir).reviewers.alpha['src/a.ts'].round, 1);
  });
});

describe('the re-review list', () => {
  const openOne = (text = '❌ race — src/a.ts:1 — guard it\n⚠️ naming — src/a.ts:1\n\n1 ISSUE(S)') => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', text));
    ok(stamp(dir, 'beta'));
    return Object.keys(reviews(dir)[0].findings);
  };

  it("an owing reviewer's open findings are listed with the delta", () => {
    const [f1] = openOne();
    put(dir, 'src/a.ts', 'a2\n');
    const out = preCommit(dir).stderr;
    const alpha = out.slice(out.indexOf('• alpha'), out.indexOf('• beta'));
    assert.match(alpha, /review the change: git diff /);
    assert.match(alpha, new RegExp(`\\[${f1}\\] ❌ src/a\\.ts:1 — race — src/a\\.ts:1 — guard it`));
    assert.match(alpha, /answer each ✅ \[<id>\] fixed or ❌ \[<id>\]/);
  });

  it('a finding citing another file is listed too', () => {
    const [f1] = openOne('❌ retry owner — src/other.ts:9\n\n1 ISSUE(S)');
    put(dir, 'src/a.ts', 'a2\n');
    assert.match(preCommit(dir).stderr, new RegExp(`\\[${f1}\\] ❌ src/other\\.ts:9`));
  });

  it('⚠️ is listed as already noted', () => {
    const [, f2] = openOne();
    put(dir, 'src/a.ts', 'a2\n');
    assert.match(preCommit(dir).stderr, new RegExp(`already noted[^\\n]*\\n\\s+\\[${f2}\\] ⚠️`));
  });

  it("a fixed or pre-existing finding isn't listed", () => {
    const [f1] = openOne();
    put(dir, 'src/a.ts', 'a2\n');
    ok(report(dir, 'alpha', `✅ [${f1}] fixed\n\nCLEAN`));
    put(dir, 'src/a.ts', 'a3\n');
    assert.doesNotMatch(preCommit(dir).stderr, new RegExp(`\\[${f1}\\]`));
  });

  it('--check prints the same list', () => {
    const [f1] = openOne();
    put(dir, 'src/a.ts', 'a2\n');
    assert.match(check(dir).stdout, new RegExp(`\\[${f1}\\] ❌`));
  });

  it('one stamp line per owing reviewer, each with --report', () => {
    put(dir, 'src/a.ts', 'a\n');
    const err = preCommit(dir).stderr;
    assert.match(err, /--stamp alpha --report <its reply> --repo /);
    assert.match(err, /--stamp beta --report <its reply> --repo /);
  });

  it('a reviewer with no findings gets no list', () => {
    openOne();
    put(dir, 'src/a.ts', 'a2\n');
    const out = preCommit(dir).stderr;
    assert.doesNotMatch(out.slice(out.indexOf('• beta'), out.indexOf('Run each')), /open findings/);
  });

  it("a hand-edited findings entry doesn't throw", () => {
    openOne();
    const s = readStamp(dir);
    const id = Object.keys(s.reviews)[0];
    s.reviews[id].findings = { F9: 'not an object', F10: { kind: '❌', line: 'x', text: 5 } };
    s.reviews.junk = 'string';
    writeFileSync(stampFile(dir), JSON.stringify(s));
    put(dir, 'src/a.ts', 'a2\n');
    const r = preCommit(dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /• alpha/);
  });
});

describe('rounds', () => {
  const loop = (n) => {
    let open;
    for (let i = 1; i <= n; i++) {
      put(dir, 'src/a.ts', `a${i}\n`);
      ok(report(dir, 'alpha', open ? `❌ [${open}] still\n\n1 ISSUE(S)` : '❌ race — src/a.ts:1\n\n1 ISSUE(S)'));
      open ??= Object.keys(reviews(dir)[0].findings)[0];
    }
    ok(stamp(dir, 'beta'));
    put(dir, 'src/a.ts', 'next\n');
    return open;
  };
  const WARN = /round 3 of reviewGate\.maxRounds \(3\)[^\n]*don't dispatch another round/;

  it('three stamps leaving a ❌ open reach round 3, and the message warns', () => {
    loop(3);
    assert.equal(readStamp(dir).reviewers.alpha['src/a.ts'].round, 3);
    const r = preCommit(dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, WARN);
    assert.match(r.stderr, /to the user and ask whether to rethink the approach or triage them/);
  });

  it('two rounds: no warning yet', () => {
    loop(2);
    assert.doesNotMatch(preCommit(dir).stderr, /maxRounds/);
  });

  it('maxRounds: 2 warns a round earlier', () => {
    writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify({ ...CONFIG, reviewGate: { maxRounds: 2 } }));
    loop(2);
    assert.match(preCommit(dir).stderr, /round 2 of reviewGate\.maxRounds \(2\)/);
  });

  it('a stamp after every ❌ is fixed: the next is round 1', () => {
    const f1 = loop(2);
    ok(report(dir, 'alpha', `✅ [${f1}] fixed\n\nCLEAN`));
    put(dir, 'src/a.ts', 'after\n');
    ok(stamp(dir, 'alpha'));
    assert.equal(readStamp(dir).reviewers.alpha['src/a.ts'].round, 1);
  });

  it('a stamp without --report counts as a round while R has an open ❌', () => {
    loop(1);
    ok(stamp(dir, 'alpha'));
    assert.equal(readStamp(dir).reviewers.alpha['src/a.ts'].round, 2);
  });

  it('a commit starts the count again', () => {
    loop(2);
    ok(stamp(dir, 'alpha,beta'));
    git(dir, 'commit', '-qm', 'x');
    put(dir, 'src/a.ts', 'later\n');
    ok(stamp(dir, 'alpha'));
    assert.equal(readStamp(dir).reviewers.alpha['src/a.ts'].round, 1);
  });

  const EXAMPLE = join(dirname(HOOK), '..', 'config.example.json');
  it('config.example.json sets maxRounds 3', { skip: !existsSync(EXAMPLE) }, () => {
    const example = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
    assert.equal(example.reviewGate.maxRounds, 3);
  });

  it("a ⚠️-only review isn't a round", () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', '⚠️ naming — src/a.ts:1\n\nCLEAN'));
    put(dir, 'src/a.ts', 'a2\n');
    ok(stamp(dir, 'alpha'));
    assert.equal(readStamp(dir).reviewers.alpha['src/a.ts'].round, 1);
  });
});

describe('the triage note', () => {
  it('committing with an open ❌ passes and names it', () => {
    put(dir, 'src/a.ts', 'a\n');
    put(dir, 'src/b.ts', 'b\n');
    ok(report(dir, 'alpha', '❌ race — src/a.ts:1 — guard it\n⚠️ naming — src/a.ts:1\n\n1 ISSUE(S)'));
    ok(stamp(dir, 'beta'));
    const [f1, f2] = Object.keys(reviews(dir)[0].findings);
    const r = preCommit(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`\\[${f1}\\] alpha — src/a\\.ts:1 — race`));
    assert.doesNotMatch(r.stderr, new RegExp(`\\[${f2}\\]`));
    assert.doesNotMatch(r.stderr, /src\/b\.ts/);
    assert.doesNotMatch(r.stderr, /reported \d+ finding/);
    assert.match(check(dir).stdout, new RegExp(`\\[${f1}\\] alpha`));
  });

  it('a finding with no place says so', () => {
    put(dir, 'src/a.ts', 'a\n');
    ok(report(dir, 'alpha', '❌ something off\n\n1 ISSUE(S)'));
    ok(stamp(dir, 'beta'));
    assert.match(preCommit(dir).stderr, /alpha — \(no place cited\) — something off/);
  });
});

describe('the comment-only carry and open findings', () => {
  const CARRY = {
    routing: [
      { reviewer: 'alpha', paths: ['^src/'] },
      { reviewer: 'docs-sync-reviewer', paths: ['^src/'] },
    ],
  };
  const owers = (out) => [...out.matchAll(/^ {2}• ([\w-]+)/gm)].map((m) => m[1]).sort();

  it("an open ❌ on F doesn't carry; once fixed, the next comment edit does", () => {
    writeFileSync(join(dir, '.ssdd', 'config.json'), JSON.stringify(CARRY));
    put(dir, 'src/a.ts', '// one\nexport const a = 1;\n');
    ok(report(dir, 'alpha', '❌ wrong value — src/a.ts:2\n\n1 ISSUE(S)'));
    ok(stamp(dir, 'docs-sync-reviewer'));
    const [f1] = Object.keys(reviews(dir)[0].findings);
    put(dir, 'src/a.ts', '// two\nexport const a = 1;\n');
    assert.deepEqual(owers(check(dir).stdout), ['alpha', 'docs-sync-reviewer']);
    put(dir, 'src/a.ts', '// two\nexport const a = 2;\n');
    ok(report(dir, 'alpha', `✅ [${f1}] fixed\n\nCLEAN`));
    ok(stamp(dir, 'docs-sync-reviewer'));
    put(dir, 'src/a.ts', '// three\nexport const a = 2;\n');
    assert.deepEqual(owers(check(dir).stdout), ['docs-sync-reviewer']);
  });
});
