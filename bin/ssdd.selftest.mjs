// Tests for the SSDD installer/updater. Each case builds a fake ssdd source
// repo with three releases and a scratch target repo, then drives bin/ssdd.mjs
// the way a user would. Run: node --test bin/ssdd.selftest.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'ssdd.mjs');
const lines = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';
const edit = (text, lineNo, value) => text.split('\n').map((l, i) => (i === lineNo - 1 ? value : l)).join('\n');

let root; let src; let tgt;
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
function put(dir, rel, content, mode) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  if (mode) execFileSync('chmod', [mode, p]);
}
const get = (rel) => readFileSync(join(tgt, rel), 'utf8');
function ssdd(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--source', src], { encoding: 'utf8', cwd: root });
  return { code: r.status, out: r.stdout + r.stderr };
}
function commitAll(dir, msg) {
  git(dir, 'add', '-A');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', msg);
}
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
}

// v1.0.0: legacy layout (skill under adapters/claude-code/skills/, no VERSION).
// v1.1.0: current layout. v2.0.0: upstream edits, an add, a removal, a new template.
function buildSource() {
  initRepo(src);
  put(src, 'process/SDD.md', lines(20, 'sdd'));
  put(src, 'process/templates/plan-template.md', lines(5, 'plan'));
  put(src, 'reviewers/alpha-reviewer.md', lines(10, 'alpha'));
  put(src, 'reviewers/domain-reviewer-template.md', 'template\n');
  put(src, 'mechanisms/hooks/review-gate.mjs', 'gate v1\n');
  put(src, 'mechanisms/hooks/pre-commit', '#!/bin/sh\nexit 0\n', '755');
  put(src, 'mechanisms/drift-audit.md', 'audit\n');
  put(src, 'mechanisms/config.example.json', '{\n  "routing": []\n}\n');
  put(src, 'adapters/generic/AGENTS.md', 'agents template\n');
  put(src, 'adapters/claude-code/settings-hooks.json', '{}\n');
  put(src, 'adapters/claude-code/CLAUDE.md', '@AGENTS.md\n');
  put(src, 'adapters/claude-code/skills/new-plan/SKILL.md', lines(6, 'skill'));
  commitAll(src, 'v1.0.0');
  git(src, 'tag', 'v1.0.0');

  mkdirSync(join(src, 'skills'));
  git(src, 'mv', 'adapters/claude-code/skills/new-plan', 'skills/new-plan');
  put(src, 'VERSION', '1.1.0\n');
  put(src, 'adapters/cursor/hooks.json', '{"version":1}\n');
  commitAll(src, 'v1.1.0');
  git(src, 'tag', 'v1.1.0');

  put(src, 'process/SDD.md', edit(lines(20, 'sdd'), 18, 'sdd 18 UPSTREAM'));
  put(src, 'reviewers/alpha-reviewer.md', edit(lines(10, 'alpha'), 3, 'alpha 3 UPSTREAM'));
  put(src, 'mechanisms/hooks/review-gate.mjs', 'gate v2\n');
  put(src, 'mechanisms/hooks/review-gate.selftest.mjs', 'upstream test\n');
  put(src, 'reviewers/beta-reviewer.md', 'beta\n');
  rmSync(join(src, 'mechanisms/drift-audit.md'));
  put(src, 'skills/new-plan/SKILL.md', edit(lines(6, 'skill'), 6, 'skill 6 UPSTREAM'));
  put(src, 'mechanisms/config.example.json', '{\n  "routing": [],\n  "reviewGate": { "maxRoutedFiles": 10 }\n}\n');
  put(src, 'VERSION', '2.0.0\n');
  put(src, 'CHANGELOG.md', '# Changelog\n\n## [2.0.0]\n\n- per-file stamps\n\n## [1.1.0]\n\n- moved skills\n');
  commitAll(src, 'v2.0.0');
  git(src, 'tag', 'v2.0.0');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ssdd-test-'));
  src = join(root, 'src');
  tgt = join(root, 'app');
  buildSource();
  initRepo(tgt);
  put(tgt, 'README.md', 'app\n');
  commitAll(tgt, 'init');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('install', () => {
  it('installs the newest tag by default, writes the lock, seeds and links', () => {
    const r = ssdd('install', tgt, 'claude-code,cursor');
    assert.equal(r.code, 0, r.out);
    const lock = JSON.parse(get('.ssdd/ssdd.lock.json'));
    assert.equal(lock.ssdd, '2.0.0');
    assert.equal(lock.commit, git(src, 'rev-parse', 'v2.0.0'));
    assert.deepEqual(lock.adapters, ['claude-code', 'cursor']);
    assert.equal(lock.managed['.agents/skills/new-plan/SKILL.md'].src, 'skills/new-plan/SKILL.md');
    assert.ok(lock.managed['.cursor/hooks.json']);
    assert.ok(lock.seeded['.ssdd/config.json']);
    assert.equal(get('.ssdd/hooks/review-gate.mjs'), 'gate v2\n');
    assert.ok(statSync(join(tgt, '.githooks/pre-commit')).mode & 0o100, 'pre-commit keeps its exec bit');
    assert.equal(readlinkSync(join(tgt, '.claude/agents/alpha-reviewer.md')), '../../.ssdd/reviewers/alpha-reviewer.md');
    assert.equal(readlinkSync(join(tgt, '.claude/skills/new-plan')), '../../.agents/skills/new-plan');
    assert.ok(!existsSync(join(tgt, '.claude/agents/domain-reviewer-template.md')));
    assert.equal(get('AGENTS.md'), 'agents template\n');
    assert.equal(get('CLAUDE.md'), '@AGENTS.md\n');
  });

  it('installs a named ref and reads the version from its tag when VERSION is absent', () => {
    const r = ssdd('install', tgt, '--ref', 'v1.0.0');
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(get('.ssdd/ssdd.lock.json')).ssdd, '1.0.0');
  });

  it('marks an untagged commit as <VERSION>+<sha7>', () => {
    put(src, 'process/SDD.md', 'dev\n');
    commitAll(src, 'dev commit');
    assert.equal(ssdd('install', tgt, '--ref', 'HEAD').code, 0);
    assert.equal(JSON.parse(get('.ssdd/ssdd.lock.json')).ssdd, `2.0.0+${git(src, 'rev-parse', '--short=7', 'HEAD')}`);
  });

  it('writes AGENTS.ssdd.md when the project already has an AGENTS.md', () => {
    put(tgt, 'AGENTS.md', 'project agents\n');
    assert.equal(ssdd('install', tgt).code, 0);
    assert.equal(get('AGENTS.md'), 'project agents\n');
    assert.equal(get('AGENTS.ssdd.md'), 'agents template\n');
  });

  it('refuses to overwrite differing framework files and points at adopt', () => {
    put(tgt, '.ssdd/process/SDD.md', 'project version\n');
    const r = ssdd('install', tgt);
    assert.equal(r.code, 2);
    assert.match(r.out, /adopt/);
    assert.equal(get('.ssdd/process/SDD.md'), 'project version\n');
  });

  it('refuses a second install', () => {
    ssdd('install', tgt);
    const r = ssdd('install', tgt);
    assert.equal(r.code, 2);
    assert.match(r.out, /already installed \(v2\.0\.0\)/);
  });
});

describe('update', () => {
  beforeEach(() => {
    assert.equal(ssdd('install', tgt, 'claude-code', '--ref', 'v1.1.0').code, 0);
    commitAll(tgt, 'install ssdd 1.1.0');
  });

  it('merges project edits with upstream changes, file by file', () => {
    put(tgt, '.ssdd/process/SDD.md', edit(get('.ssdd/process/SDD.md'), 2, 'sdd 2 PROJECT'));
    put(tgt, '.ssdd/reviewers/alpha-reviewer.md', edit(get('.ssdd/reviewers/alpha-reviewer.md'), 3, 'alpha 3 PROJECT'));
    put(tgt, '.ssdd/process/templates/plan-template.md', edit(get('.ssdd/process/templates/plan-template.md'), 1, 'plan 1 PROJECT'));
    put(tgt, '.ssdd/hooks/review-gate.selftest.mjs', 'project test\n');
    put(tgt, '.ssdd/config.json', '{ "routing": [{ "reviewer": "alpha-reviewer", "paths": ["^src/"] }] }\n');
    commitAll(tgt, 'project edits');

    const r = ssdd('update', tgt);
    assert.equal(r.code, 1, 'conflicts and sidecars exit 1');

    // edits on different lines → clean merge, both kept
    const sdd = get('.ssdd/process/SDD.md');
    assert.match(sdd, /sdd 2 PROJECT/);
    assert.match(sdd, /sdd 18 UPSTREAM/);
    assert.match(r.out, /merged \(project edits kept\)[\s\S]*\.ssdd\/process\/SDD\.md/);
    // same line edited on both sides → conflict markers
    const alpha = get('.ssdd/reviewers/alpha-reviewer.md');
    assert.match(alpha, /^<{7} \.ssdd\/reviewers\/alpha-reviewer\.md \(project\)$/m);
    assert.match(alpha, /alpha 3 PROJECT[\s\S]*alpha 3 UPSTREAM/);
    assert.match(r.out, /CONFLICT[\s\S]*alpha-reviewer\.md \(1 hunk/);
    // untouched locally, changed upstream → updated
    assert.equal(get('.ssdd/hooks/review-gate.mjs'), 'gate v2\n');
    // changed locally, unchanged upstream → kept
    assert.match(get('.ssdd/process/templates/plan-template.md'), /plan 1 PROJECT/);
    // both added with different content → sidecar
    assert.equal(get('.ssdd/hooks/review-gate.selftest.mjs'), 'project test\n');
    assert.equal(get('.ssdd/hooks/review-gate.selftest.mjs.ssdd-new'), 'upstream test\n');
    // removed upstream, unmodified locally → removed
    assert.ok(!existsSync(join(tgt, '.ssdd/drift-audit.md')));
    // added upstream → added and linked
    assert.equal(get('.ssdd/reviewers/beta-reviewer.md'), 'beta\n');
    assert.ok(lstatSync(join(tgt, '.claude/agents/beta-reviewer.md')).isSymbolicLink());
    // seeded files untouched; template diff printed
    assert.match(get('.ssdd/config.json'), /alpha-reviewer/);
    assert.match(r.out, /template for \.ssdd\/config\.json changed[\s\S]*\+\s+"reviewGate"/);
    // changelog between versions, lock moved
    assert.match(r.out, /CHANGELOG since v1\.1\.0:[\s\S]*per-file stamps/);
    assert.doesNotMatch(r.out, /moved skills/);
    const lock = JSON.parse(get('.ssdd/ssdd.lock.json'));
    assert.equal(lock.ssdd, '2.0.0');
    assert.ok(!lock.managed['.ssdd/drift-audit.md']);
  });

  it('is a clean fast-forward when nothing was customized', () => {
    const r = ssdd('update', tgt);
    assert.equal(r.code, 0, r.out);
    assert.match(get('.agents/skills/new-plan/SKILL.md'), /skill 6 UPSTREAM/);
    assert.doesNotMatch(r.out, /CONFLICT|NEW VERSION/);
  });

  it('refuses when managed paths have uncommitted changes, unless --force', () => {
    put(tgt, '.ssdd/process/SDD.md', 'wip\n');
    const r = ssdd('update', tgt);
    assert.equal(r.code, 2);
    assert.match(r.out, /uncommitted changes/);
    assert.equal(JSON.parse(get('.ssdd/ssdd.lock.json')).ssdd, '1.1.0');
    assert.notEqual(ssdd('update', tgt, '--force').code, 2);
  });

  it('can target an older or specific ref with --to', () => {
    const r = ssdd('update', tgt, '--to', 'v1.1.0');
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(get('.ssdd/ssdd.lock.json')).ssdd, '1.1.0');
  });

  it('treats JSON that differs only in formatting as the same file', () => {
    put(tgt, '.cursor/hooks.json', '{\n  "version": 1\n}\n');
    commitAll(tgt, 'project cursor hooks');
    const r = ssdd('update', tgt, '--adapters', 'claude-code,cursor');
    assert.equal(r.code, 0, r.out);
    assert.ok(!existsSync(join(tgt, '.cursor/hooks.json.ssdd-new')));
    assert.equal(get('.cursor/hooks.json'), '{\n  "version": 1\n}\n');
  });

  it('seeds an adapter added at update time', () => {
    const r = ssdd('update', tgt, '--adapters', 'claude-code,cursor');
    assert.equal(r.code, 0, r.out);
    assert.equal(get('.cursor/hooks.json'), '{"version":1}\n');
    assert.deepEqual(JSON.parse(get('.ssdd/ssdd.lock.json')).adapters, ['claude-code', 'cursor']);
  });
});

describe('status', () => {
  it('reports customized files, conflicts, and an available update', () => {
    ssdd('install', tgt, '--ref', 'v1.1.0');
    put(tgt, '.ssdd/process/SDD.md', 'mine\n');
    let r = ssdd('status', tgt);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SSDD v1\.1\.0/);
    assert.match(r.out, /customized in this project \(1\):\s+\.ssdd\/process\/SDD\.md/);
    assert.match(r.out, /update available: v2\.0\.0/);
    put(tgt, '.ssdd/process/SDD.md', '<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n');
    r = ssdd('status', tgt);
    assert.equal(r.code, 1);
    assert.match(r.out, /UNRESOLVED CONFLICT MARKERS/);
  });
});

describe('status: is the gate armed?', () => {
  const GATE_ROUTE = JSON.parse(readFileSync(join(dirname(SCRIPT), '..', 'mechanisms', 'config.example.json'), 'utf8'))
    .routing.find((r) => r.reviewer === 'gate-reviewer');

  it('lists unrouted gate files and a dormant hook; exit code unchanged', () => {
    ssdd('install', tgt, '--ref', 'v2.0.0');
    commitAll(tgt, 'ssdd');
    const r = ssdd('status', tgt);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /gate files routed to no reviewer \(\d+\)/);
    assert.match(r.out, /^  \.ssdd\/config\.json$/m);
    assert.match(r.out, /^  \.githooks\/ \(1 of 1 files\)$/m);
    assert.match(r.out, /^  AGENTS\.md$/m);
    assert.match(r.out, /WARNING: the pre-commit hook is dormant \(core\.hooksPath is unset\)/);
  });

  it('is silent once the gate route is in the committed config and the hook is armed', () => {
    ssdd('install', tgt, '--ref', 'v2.0.0');
    put(tgt, '.ssdd/config.json', JSON.stringify({ routing: [GATE_ROUTE] }));
    commitAll(tgt, 'ssdd');
    git(tgt, 'config', 'core.hooksPath', '.githooks');
    const r = ssdd('status', tgt);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /routed to no reviewer|dormant/);
  });

  it('a broken config is named', () => {
    ssdd('install', tgt, '--ref', 'v2.0.0');
    put(tgt, '.ssdd/config.json', '{ "routing": [');
    const r = ssdd('status', tgt);
    assert.match(r.out, /WARNING: \.ssdd\/config\.json is not valid JSON/);
  });

  it('install suggests a prepare script only when the target has a package.json', () => {
    let r = ssdd('install', tgt, '--ref', 'v2.0.0');
    assert.doesNotMatch(r.out, /"prepare"/);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    buildSource();
    initRepo(tgt);
    put(tgt, 'package.json', '{}\n');
    commitAll(tgt, 'init');
    r = ssdd('install', tgt, '--ref', 'v2.0.0');
    assert.match(r.out, /Optional: add "prepare": "git config core\.hooksPath \.githooks" to package\.json scripts/);
  });
});

describe('skills ledger', () => {
  const LEDGER = '{\n  "version": 1,\n  "sources": {}\n}\n';
  function releaseWithLedger(tag, body = LEDGER) {
    put(src, 'mechanisms/skills.example.json', body);
    put(src, 'VERSION', `${tag.slice(1)}\n`);
    commitAll(src, tag);
    git(src, 'tag', tag);
  }

  it('install seeds .ssdd/skills.json as a project-owned file', () => {
    releaseWithLedger('v2.1.0');
    const r = ssdd('install', tgt);
    assert.equal(r.code, 0, r.out);
    assert.equal(get('.ssdd/skills.json'), LEDGER);
    const lock = JSON.parse(get('.ssdd/ssdd.lock.json'));
    assert.equal(lock.seeded['.ssdd/skills.json'].src, 'mechanisms/skills.example.json');
    assert.ok(!lock.managed['.ssdd/skills.json']);
  });

  it('update seeds a missing ledger and never rewrites an existing one', () => {
    ssdd('install', tgt);                       // v2.0.0, no ledger yet
    commitAll(tgt, 'install ssdd 2.0.0');       // update refuses dirty framework paths
    releaseWithLedger('v2.1.0');
    let r = ssdd('update', tgt);
    assert.equal(r.code, 0, r.out);
    assert.equal(get('.ssdd/skills.json'), LEDGER);
    const mine = '{ "version": 1, "sources": { "a/b": { "sha": "abc" } } }\n';
    put(tgt, '.ssdd/skills.json', mine);
    commitAll(tgt, 'ledger');
    releaseWithLedger('v2.2.0', '{\n  "version": 1,\n  "sources": {},\n  "$comment": "new"\n}\n');
    r = ssdd('update', tgt);
    assert.equal(r.code, 0, r.out);
    assert.equal(get('.ssdd/skills.json'), mine);
  });

  it('--force and --skills are flags that take no value', () => {
    ssdd('install', tgt);
    const r = ssdd('status', tgt, '--skills');   // helper appends --source <src>
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SSDD v2\.0\.0/);
    assert.ok(r.out.includes(`newest release in ${src}`), r.out);   // --source was not swallowed
  });

  function bareUpstream() {
    const up = join(root, 'up.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', up]);
    const w = join(root, 'w');
    initRepo(w);
    put(w, 'skills/x/SKILL.md', '---\nname: x\n---\n');
    commitAll(w, 'one');
    git(w, 'push', '-q', up, 'HEAD:main');
    return { up, w };
  }
  const ledger = (sources) => put(tgt, '.ssdd/skills.json', JSON.stringify({ version: 1, sources }));

  it('status --skills reports current, then moved after an upstream commit', () => {
    ssdd('install', tgt);
    const { up, w } = bareUpstream();
    const pinned = git(w, 'rev-parse', 'HEAD');
    ledger({ [up]: { distribution: 'vendored', sha: pinned, date: '2026-10-06', skills: {} } });
    let r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /current\s+\S*up\.git/);
    put(w, 'skills/x/SKILL.md', '---\nname: x\n---\nmore\n');
    commitAll(w, 'two');
    git(w, 'push', '-q', up, 'HEAD:main');
    r = ssdd('status', tgt, '--skills');
    assert.match(r.out, new RegExp(`moved ${pinned.slice(0, 7)}→${git(w, 'rev-parse', 'HEAD').slice(0, 7)}`));
  });

  it('status --skills: unreachable exits 0, a null sha is never pinned, plain status is silent', () => {
    ssdd('install', tgt);
    ledger({
      [join(root, 'nope.git')]: { sha: 'a'.repeat(40), skills: {} },
      'example/unpinned': { sha: null, skills: {} },
    });
    let r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /unreachable\s+\S*nope\.git/);
    assert.match(r.out, /never pinned\s+example\/unpinned/);
    r = ssdd('status', tgt);
    assert.doesNotMatch(r.out, /skills \(|no skill sources|never pinned|unreachable/);
  });

  it('status --skills: a recorded value that is not a hex sha is never pinned', () => {
    ssdd('install', tgt);
    ledger({ 'example/short': { sha: 'a', skills: {} } });
    const r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /never pinned\s+example\/short/);
  });

  it('status --skills survives an unreadable ledger or odd entries with exit 0', () => {
    ssdd('install', tgt);
    put(tgt, '.ssdd/skills.json', '{ not json');
    let r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /skills: unreadable \.ssdd\/skills\.json \(/);
    put(tgt, '.ssdd/skills.json', JSON.stringify({ version: 1, sources: ['a/b'] }));
    r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no skill sources recorded/);
    put(tgt, '.ssdd/skills.json', JSON.stringify({ version: 1, sources: { 'a/null': null } }));
    r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /never pinned\s+a\/null/);
  });

  it('status --skills never lets a ledger key act as a git option', () => {
    ssdd('install', tgt);
    const pwned = join(root, 'pwned');
    ledger({ [`--upload-pack=touch ${pwned}`]: { sha: 'a'.repeat(40), skills: {} } });
    const r = ssdd('status', tgt, '--skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /unreachable/);
    assert.ok(!existsSync(pwned));
  });

  it('status --skills says so when the ledger is empty or missing', () => {
    ssdd('install', tgt);
    const r = ssdd('status', tgt, '--skills');
    assert.match(r.out, /no skill sources recorded/);
  });
});

describe('adopt (pre-lock install)', () => {
  it('traces a v1-layout install to its base, then updates it with merges', () => {
    // Simulate what the old copy-based inject.sh produced from v1.0.0.
    const v1 = join(root, 'v1');
    execFileSync('sh', ['-c', `mkdir -p "${v1}" && git -C "${src}" archive v1.0.0 | tar -x -C "${v1}"`]);
    cpSync(join(v1, 'process'), join(tgt, '.ssdd/process'), { recursive: true });
    cpSync(join(v1, 'reviewers'), join(tgt, '.ssdd/reviewers'), { recursive: true });
    put(tgt, '.ssdd/hooks/review-gate.mjs', 'gate v1\n');
    put(tgt, '.ssdd/drift-audit.md', 'audit\n');
    put(tgt, '.ssdd/config.json', '{ "routing": ["project"] }\n');
    put(tgt, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n', '755');
    cpSync(join(v1, 'adapters/claude-code/skills/new-plan'), join(tgt, '.claude/skills/new-plan'), { recursive: true });
    cpSync(join(v1, 'reviewers/alpha-reviewer.md'), join(tgt, '.claude/agents/alpha-reviewer.md'));
    put(tgt, '.ssdd/process/SDD.md', edit(get('.ssdd/process/SDD.md'), 1, 'sdd 1 PROJECT'));
    commitAll(tgt, 'v1 copy install + project edit');

    let r = ssdd('adopt', tgt, '--base', 'v1.0.0', '--adapters', 'claude-code');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /moved\s+\.claude\/skills\/new-plan → \.agents\/skills\/new-plan/);
    const lock = JSON.parse(get('.ssdd/ssdd.lock.json'));
    assert.equal(lock.ssdd, '1.0.0');
    assert.equal(lock.managed['.agents/skills/new-plan/SKILL.md'].src, 'adapters/claude-code/skills/new-plan/SKILL.md');
    commitAll(tgt, 'adopt');

    r = ssdd('update', tgt);
    assert.equal(r.code, 0, r.out);
    assert.match(get('.ssdd/process/SDD.md'), /sdd 1 PROJECT[\s\S]*sdd 18 UPSTREAM/);
    assert.match(get('.agents/skills/new-plan/SKILL.md'), /skill 6 UPSTREAM/);
    assert.ok(lstatSync(join(tgt, '.claude/skills/new-plan')).isSymbolicLink());
    // the v1 agent copy was identical to its source → relinked
    assert.ok(lstatSync(join(tgt, '.claude/agents/alpha-reviewer.md')).isSymbolicLink());
    assert.match(get('.ssdd/config.json'), /project/);
    assert.equal(JSON.parse(get('.ssdd/ssdd.lock.json')).ssdd, '2.0.0');
  });

  it('requires --base', () => {
    const r = ssdd('adopt', tgt);
    assert.equal(r.code, 2);
    assert.match(r.out, /--base/);
  });
});

describe('framework files', () => {
  // SSDD installs mechanisms/hooks/*.mjs into every project's .ssdd/hooks/.
  // Its own tests use node:test, so a project runner that collects them by
  // default fails (prizma's vitest did). No file there may match the default
  // patterns of vitest/jest/playwright, node --test, bun or deno.
  const DEFAULT_TEST_PATTERNS = [
    /\.(test|spec)\.[cm]?[jt]sx?$/, // vitest, jest, playwright, bun, deno (.test.)
    /[-_]test\.[cm]?[jt]s$/,        // node --test (*-test), bun/deno (*_test)
    /[-_]spec\.[cm]?[jt]s$/,        // bun (*_spec)
    /^test[-.]/,                    // node --test (test-*, test.mjs)
  ];
  it('config.example.json routes every gate file to gate-reviewer', () => {
    const cfg = JSON.parse(readFileSync(join(dirname(SCRIPT), '..', 'mechanisms', 'config.example.json'), 'utf8'));
    const gate = cfg.routing.filter((r) => r.reviewer === 'gate-reviewer').flatMap((r) => r.paths.map((p) => new RegExp(p)));
    const files = ['.ssdd/config.json', '.ssdd/hooks/review-gate.mjs', '.ssdd/reviewers/gate-reviewer.md',
      '.ssdd/process/SDD.md', '.githooks/pre-commit', '.claude/settings.json', '.claude/agents/gate-reviewer.md', '.claude/rules/git.md',
      '.cursor/hooks.json', '.cursor/rules/ssdd.mdc', 'AGENTS.md', 'CLAUDE.md'];
    assert.deepEqual(files.filter((f) => !gate.some((re) => re.test(f))), []);
    assert.ok(existsSync(join(dirname(SCRIPT), '..', 'reviewers', 'gate-reviewer.md')));
  });
  it('no installed hook file matches a test runner\'s default pattern', () => {
    const dir = join(dirname(SCRIPT), '..', 'mechanisms', 'hooks');
    const hits = readdirSync(dir).filter((f) => DEFAULT_TEST_PATTERNS.some((re) => re.test(f)));
    assert.deepEqual(hits, []);
  });
});
