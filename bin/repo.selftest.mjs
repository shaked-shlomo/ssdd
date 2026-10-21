// SSDD's own invariants: the spec index, links and citations between its docs.
// Not installed into injected repos (bin/ never ships).
// Run: node --test bin/repo.selftest.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
// The repo's files: tracked, plus new ones git doesn't ignore.
const tracked = () => execFileSync('git', ['-C', REPO, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter((p) => p && existsSync(join(REPO, p)));
// GitHub's heading anchor.
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
const headings = (text) => text.replace(/^```[\s\S]*?^```/gm, '').match(/^#{1,6} .+$/gm)?.map((h) => h.replace(/^#+ /, '')) ?? [];
// Markdown links and HTML href/src/srcset outside code: → [{ target, anchor }]. URLs are skipped.
function links(text) {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
  const raw = [
    ...[...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]),
    ...[...prose.matchAll(/\b(?:href|src|srcset)="([^"]+)"/g)].map((m) => m[1]),
  ];
  return raw.filter((t) => !/^[a-z][a-z+.-]*:/i.test(t)).map((t) => {
    const [target, anchor] = t.split('#');
    return { target, anchor };
  });
}

describe('the spec index', () => {
  const index = read('SPEC.md');
  const rows = [...index.matchAll(/^\| (v[\d.]+) \| \[[^\]]+\]\((docs\/specs\/[^)]+)\)/gm)].map((m) => [m[1], m[2]]);
  const files = () => readdirSync(join(REPO, 'docs/specs')).filter((f) => f.endsWith('.md')).map((f) => `docs/specs/${f}`);

  it('SPEC.md is an index of docs/specs/', () => {
    assert.ok(index.split('\n').length <= 60, `SPEC.md is ${index.split('\n').length} lines`);
    assert.deepEqual(rows.map(([, f]) => f).sort(), files().sort(), 'one row per file');
    for (const [, f] of rows) assert.match(read(f), /^# /, `${f} starts with its heading`);
  });

  it('every SPEC.md citation resolves', () => {
    const byVersion = new Map(rows);
    const re = /SPEC\.md`?\s*(?:→|,)?\s*(?:`#\s*|")?(v\d+(?:\.\d+)?)\b(?:[^\n]{0,20}?(?:→|,)\s*Part (\d+))?/g;
    const bad = []; let checked = 0;
    for (const f of tracked().filter((p) => /\.(md|mjs)$/.test(p))) {
      for (const m of read(f).matchAll(re)) {
        checked++;
        const file = byVersion.get(m[1]);
        if (!file) bad.push(`${f}: ${m[0]} — no ${m[1]} in the index`);
        else if (m[2] && !new RegExp(`^## Part ${m[2]}\\b`, 'm').test(read(file))) bad.push(`${f}: ${m[0]} — no Part ${m[2]} in ${file}`);
      }
    }
    assert.deepEqual(bad, []);
    assert.ok(checked >= 30, `only ${checked} citations found`);
  });
});

describe('links', () => {
  it('every relative link resolves', () => {
    const docs = ['SPEC.md', 'README.md', ...tracked().filter((p) => /^docs\/.*\.md$/.test(p) && !p.startsWith('docs/superpowers/'))];
    const bad = [];
    for (const f of docs) {
      for (const { target, anchor } of links(read(f))) {
        const rel = target ? normalize(join(dirname(f), target)) : f;
        if (!existsSync(join(REPO, rel))) { bad.push(`${f}: ${target} — missing`); continue; }
        if (anchor && rel.endsWith('.md') && !headings(read(rel)).some((h) => slug(h) === anchor)) bad.push(`${f}: ${target}#${anchor} — no such heading`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe('Node floor', () => {
  // History keeps the floors it shipped with.
  const HISTORY = /^(CHANGELOG\.md$|docs\/specs\/|docs\/superpowers\/|docs\/handovers\/|\.superpowers\/)/;

  it('CI runs Node 22 and 24', () => {
    assert.match(read('.github/workflows/test.yml'), /^\s+node: \[22, 24\]$/m);
  });

  it('the README says 22', () => {
    const readme = read('README.md');
    assert.ok(readme.includes('node-%E2%89%A5%2022'), 'badge');
    assert.ok(readme.includes('Node ≥ 22'), 'text');
  });

  it('nothing outside history says an older floor', () => {
    const older = [/\bnode\b[^\n]{0,12}?(?:>=|≥|%E2%89%A5%20)\s*(?:1\d|20)\b/i, /\bNode (?:18|20)\b/, /node: \[18/];
    const bad = [];
    for (const f of tracked().filter((p) => !HISTORY.test(p) && !/\.(svg|png|jpg)$/.test(p))) {
      read(f).split('\n').forEach((line, i) => { if (older.some((re) => re.test(line))) bad.push(`${f}:${i + 1}: ${line.trim()}`); });
    }
    assert.deepEqual(bad, []);
  });
});

// → { name, description, block } from a skill's or reviewer's frontmatter.
function frontmatter(rel) {
  const fm = read(rel).match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const desc = fm.match(/^description:(.*)$/m)?.[1].trim() ?? '';
  return { name: fm.match(/^name: (.+)$/m)?.[1], description: desc, block: /^[>|]/.test(desc) };
}

describe('cleanup skill', () => {
  const FILE = 'skills/cleanup/SKILL.md';

  it('thin', () => {
    const bytes = Buffer.byteLength(read(FILE));
    assert.ok(bytes <= 3500, `${bytes} bytes`);
    const { name, description, block } = frontmatter(FILE);
    assert.equal(name, 'cleanup');
    assert.ok(!block, 'a plain one-line description');
    assert.ok(description.length <= 300, `description is ${description.length} chars`);
    assert.ok(!description.includes(': '), 'plain YAML value contains ": "');
    assert.ok(description.includes('/code-review'));
  });

  it('keeps what SSDD adds', () => {
    const text = read(FILE).replace(/\s+/g, ' ');
    for (const s of ['/code-review', 'effort', '--comment', '.ssdd/config.json', 'known list', 'docs-sync-reviewer',
      'ReportFindings', 'pkill -f', 'git stash', 'worktree', 'approve', 'NO DIFF']) assert.ok(text.includes(s), s);
  });

  it('every step it cites exists', () => {
    const text = read(FILE);
    // "step 3" needs "## 3."; "Phase 3" needs "## Phase 3". (§ is SDD.md's.)
    for (const m of text.matchAll(/\b(Phase|step) (\d+)/gi)) {
      const heading = /^phase$/i.test(m[1]) ? `^## Phase ${m[2]}\\b` : `^## ${m[2]}\\.`;
      assert.match(text, new RegExp(heading, 'm'), m[0]);
    }
  });
});

describe('text budgets', () => {
  const bytes = (rel) => Buffer.byteLength(read(rel));
  const skills = () => readdirSync(join(REPO, 'skills')).map((d) => `skills/${d}/SKILL.md`).filter((f) => existsSync(join(REPO, f)));
  const reviewers = () => readdirSync(join(REPO, 'reviewers')).filter((f) => f.endsWith('.md')).map((f) => `reviewers/${f}`);

  it('every skill and reviewer description is short and plain', () => {
    const bad = [];
    for (const f of [...skills(), ...reviewers()]) {
      const { description, block } = frontmatter(f);
      if (block || !description) bad.push(`${f}: not a one-line description`);
      else if (description.length > 300) bad.push(`${f}: ${description.length} chars`);
      else if (description.includes(': ')) bad.push(`${f}: ": " in a plain YAML value`);
    }
    assert.deepEqual(bad, []);
  });

  it('skills-audit fits 6,200 bytes, SDD.md 11,000', () => {
    assert.ok(bytes('skills/skills-audit/SKILL.md') <= 6200, `skills-audit is ${bytes('skills/skills-audit/SKILL.md')}`);
    assert.ok(bytes('process/SDD.md') <= 11000, `SDD.md is ${bytes('process/SDD.md')}`);
  });
});
