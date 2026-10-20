# v3 Part 3 — A Cheaper Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every block that catches a real mistake and stop charging for
the ones that don't: clean merges, whole-file re-reviews, probe commits,
docs-only chained staging, untracked files, `core.hooksPath` reads and old
lint lines.

**Architecture:**
- `review-gate.mjs` gains the merge rule (`stagedOwed()`), the delta line in
  the block message, a `--check` mode, and a harness flow that resolves the
  target repo and its config *before* judging a command's shape, so a
  visible chained `git add` of unrouted files can pass.
- `git-guard.mjs` classifies each `git config … core.hooksPath` as a read or
  a write.
- The untracked-file check moves from the `pre-commit` shell into
  `work-state.mjs --staged`, and reads `preCommit.blockUntracked` through
  `ssdd-config.mjs`.
- `convention-lint.mjs` lints the lines a change adds.

**Tech Stack:** Node ≥ 18, ES modules, zero dependencies, the git CLI,
`node:test`.

**Spec:** `SPEC.md` → v3 → Part 3 (Evidence, Decisions 1–8, Clarify 18–27,
AC17–AC25).

## Global Constraints

- Zero npm dependencies; nothing newer than Node 18.0 (no `toSorted`,
  `findLast`, `Object.groupBy`, `Set.prototype.union`, `fs.globSync`).
  `fs.realpathSync.native` is fine (Node 9.2).
- Tests are `*.selftest.mjs`:
  `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs` (631 at
  `v3.0.0`). CI runs Node 18 and 24.
- The stamp format doesn't change: `.git/ssdd-review-stamp.json`, version 2,
  key `srcMode:srcBlob→dstMode:dstBlob`.
- The merge rule needs `git merge-tree --write-tree` (git ≥ 2.38). Any
  failure (exit other than 0 or 1, or no tree id on the first line) judges
  the merge as today. No new git floor.
- The harness hook must never throw on the way to a verdict: a throw exits
  1, which PreToolUse reads as "allow".
- Every refusal message keeps today's leading text where a test or a user
  matches it (`` `git add` chained before `git commit` ``, `untracked files
  exist`).
- Never write to `~/Developer/prizma` or `~/Developer/Hatedate`. Real-data
  runs use scratch clones in the session scratchpad.

## Review Focus

- **A path with a space or non-ASCII letters** in a chained `git add`, a
  lint diff header (`+++ b/…` is C-quoted for some names), or a merge's
  clean list → tests in Tasks 3 and 7.
- **A linked worktree during a merge:** `MERGE_HEAD` lives under the
  worktree's git dir, found with `rev-parse --git-path` → test in Task 6.
- **`--check` mid-conflict,** with unmerged index entries → prints the owed
  list, doesn't crash → test in Task 6.
- **A hand-edited stamp key** must not throw while the delta line is built →
  test in Task 4.
- **A hooksPath read followed by a write in one call** must stay blocked (the
  scan looks at every match, not the first) → test in Task 1.

---

### Task 1: git-guard — `core.hooksPath` reads pass

**Files:**
- Modify: `mechanisms/hooks/git-guard.mjs` (the `blockHooksPath` block, header comment)
- Test: `mechanisms/hooks/git-guard.selftest.mjs` (`BLOCKED` / `ALLOWED` tables)

**Interfaces:** none shared.

- [ ] **Step 1: Add the failing cases to the tables.**

`ALLOWED` gains:
```js
['git config core.hooksPath (a read)', 'git config core.hooksPath'],
['read with a scope flag', 'git config --local core.hooksPath'],
['read with --global', 'git config --global core.hooksPath'],
['read with --show-origin', 'git config --show-origin core.hooksPath'],
['read with --type=path', 'git config --type=path core.hooksPath'],
['the get subcommand', 'git config get core.hooksPath'],
['read, stderr redirected', 'git config core.hooksPath 2>/dev/null'],
['read, 2>&1', 'git config core.hooksPath 2>&1'],
['read, || fallback', 'git config core.hooksPath || echo unset'],
['read, then another command', 'git config core.hooksPath; ls .githooks'],
['read inside $(…) in a string', `echo "hooksPath = '$(git config core.hooksPath)'"`],
['Hatedate 07-11: a plain read after a cat', 'cat .githooks/pre-commit 2>/dev/null || ls .githooks/ .git/hooks/ 2>/dev/null; git config core.hooksPath'],
```
`BLOCKED` gains:
```js
['an empty value', 'git config core.hooksPath ""'],
['a quoted value', "git config core.hooksPath '/dev/null'"],
['--unset-all', 'git config --unset-all core.hooksPath'],
['--add', 'git config --add core.hooksPath /x'],
['--replace-all', 'git config --replace-all core.hooksPath /x'],
['the set subcommand', 'git config set core.hooksPath /x'],
['the unset subcommand', 'git config unset core.hooksPath'],
['a read, then a write', 'git config --get core.hooksPath && git config core.hooksPath /x'],
['Hatedate 08-09: read in $(…), write on the next line', `echo "hooksPath = '$(git config core.hooksPath)'"\ngit config core.hooksPath .githooks`],
['arming is a write too', 'git config core.hooksPath .githooks'],
```

- [ ] **Step 2: Run, expect the new `ALLOWED` reads and `a read, then a write` to fail.**

Run: `node --test mechanisms/hooks/git-guard.selftest.mjs`

- [ ] **Step 3: Classify every match.**

`viaConfig` becomes global and captures the text after the key, stopping
at `)` and the command separators. For each match:
- **read** when the text before the key has `--get`, `--get-all`,
  `--get-regexp`, `--list`, `-l`, or a bare `get` / `list` word;
- otherwise **write** when the text before the key has `--unset`,
  `--unset-all`, `--add`, `--replace-all`, `-e`, `--edit`, or a bare `set`
  / `unset` word;
- otherwise **read** only when the text after the key is empty once
  redirections are dropped (`2>/dev/null`, `>file`, a bare `>` or `2>` and
  its target, `<`). A quote right after the key is a value.

Any write → deny with today's message. `viaFlag` and `viaEnv` are
unchanged. The header comment says reads are allowed and how a read is told
from a write.

- [ ] **Step 4: Run, expect all pass.** `node --test mechanisms/hooks/git-guard.selftest.mjs`

- [ ] **Step 5: Commit** `feat(git-guard): a git config read of core.hooksPath passes`

---

### Task 2: the untracked check becomes a warning

**Files:**
- Modify: `mechanisms/hooks/ssdd-config.mjs` (`SECTIONS`, `build`, header)
- Modify: `mechanisms/config.example.json` (a `preCommit` block)
- Modify: `mechanisms/hooks/work-state.mjs` (`stagedCheck`)
- Modify: `mechanisms/hooks/pre-commit` (drop step 1; step 2b's comment)
- Test: `mechanisms/hooks/ssdd-config.selftest.mjs`, `mechanisms/hooks/work-state.selftest.mjs`
- Modify: `mechanisms/hooks/review-gate.selftest.mjs:605` (the comment "the hook refuses while anything is untracked" is no longer true; keep the `git add`)

**Interfaces:**
- Produces: `cfg.preCommit.blockUntracked: boolean` (true only when the
  config says `true`). A present `preCommit` that isn't an object is a
  config error, like `paths`.

- [ ] **Step 1: Failing tests.**

`ssdd-config.selftest.mjs`:
- `preCommit.blockUntracked defaults to false and reads true` →
  `cfg.preCommit` deep-equals `{ blockUntracked: false }` with no section,
  `{ blockUntracked: true }` with `{ preCommit: { blockUntracked: true } }`,
  and `false` for `"yes"`.
- `a non-object preCommit is a config error` → `error` matches
  `/"preCommit" must be an object/`.

`work-state.selftest.mjs` (the `armPreCommit` helper, real `pre-commit`):
- Rewrite `pre-commit: ledger exempt from the untracked block` as
  `pre-commit: an untracked file is a warning; the commit lands`: with
  `notes.txt` untracked, `commit('y').status === 0`, stderr matches
  `/1 untracked file isn't in this commit[\s\S]*• notes\.txt/` and
  `/preCommit\.blockUntracked/`, and the ledger is not listed with `•`.
- `pre-commit: preCommit.blockUntracked restores the block` → status 1,
  stderr matches `/untracked files exist[\s\S]*notes\.txt/`; the ledger is
  still exempt.
- `the untracked list stops at 10` → 12 untracked files: 10 `•` lines and
  `+2 more`.

- [ ] **Step 2: Run, expect failures.** `node --test mechanisms/hooks/ssdd-config.selftest.mjs mechanisms/hooks/work-state.selftest.mjs`

- [ ] **Step 3: Implement.**
- `ssdd-config.mjs`: `['preCommit', isObject, 'an object']` in `SECTIONS`;
  `build` returns `preCommit: { ...(config.preCommit ?? {}), blockUntracked: config.preCommit?.blockUntracked === true }`.
- `work-state.mjs`, `stagedCheck(repo)`, before the plan checks:
  `git ls-files --others --exclude-standard -z` in `root`, minus
  `/^\.superpowers\/sdd\/[^/]*\/progress\.md$/`.
  - Block (`blockUntracked`): `[ssdd-pre-commit] untracked files exist —
    stage them or clean up before committing (preCommit.blockUntracked):`
    then the list; the check returns 1.
  - Warning: `[ssdd-pre-commit] note: <N> untracked file(s) isn't/aren't in
    this commit (preCommit.blockUntracked: true refuses this):` then the
    list. Exact form for N = 1: `1 untracked file isn't in this commit`.
  - The list: `  • <path>`, at most 10, then `  +<n> more`.
- `pre-commit`: step 1 is deleted; step 2b's comment says it also lists
  untracked files (a warning, or a block with `preCommit.blockUntracked`).
- `config.example.json`: `"preCommit": { "$comment": "blockUntracked: refuse a commit while an untracked file exists (Superpowers ledgers excepted). Default false: the files are listed as a warning.", "blockUntracked": false }`.

- [ ] **Step 4: Run, expect all pass.** Same command, plus `node --test mechanisms/hooks/review-gate.selftest.mjs`.

- [ ] **Step 5: Commit** `feat(pre-commit): untracked files are a warning; preCommit.blockUntracked blocks`

---

### Task 3: convention-lint lints added lines

**Files:**
- Modify: `mechanisms/hooks/convention-lint.mjs`
- Test: `mechanisms/hooks/convention-lint.selftest.mjs`

**Interfaces:**
- Internal: `addedLines(diffText) → Map<path, Array<[lineNo, text]>>`
  parses `git diff -U0` output: `+++ b/<path>` (C-quoted when it starts
  with `"`; unquote `\\ \" \t \n` and octal escapes, then strip `b/`),
  `@@ -a,b +c,d @@` sets the next new-line number to `c`, each `+` line
  takes it and advances; `-` and `\ No newline` lines don't.

- [ ] **Step 1: Failing tests** (a new `describe('only added lines')`; the
repo's config lints `#[0-9a-fA-F]{3,8}` in `^src/`; a helper commits
`src/a.ts` with an old violation on line 1).
- `an edit elsewhere passes the edit hook` → append a clean line on disk,
  PostToolUse payload for `src/a.ts` → exit 0.
- `a new violating line is flagged with its number` → append `const c =
  '#abcdef';` as line 3 → exit 2, stderr matches `/src\/a\.ts:3 /`, not
  `/src\/a\.ts:1 /`.
- `--staged: only staged added lines` → same two cases through
  `--staged` (exit 0, then exit 1 naming `:3`).
- `a new file is linted whole` → untracked `src/b.ts` with a violation on
  line 1 → edit hook exit 2; staged → `--staged` exit 1.
- `files named on the command line are linted whole` → `node
  convention-lint.mjs src/a.ts` exits 1 naming `:1`.
- `a renamed file with an old violation passes --staged` → `git mv src/a.ts
  src/c.ts` → `--staged` exit 0.
- `--staged judges the staged content` → stage a new violating line, then
  remove it on disk → `--staged` exit 1.
- `a path with a space and non-ASCII letters` → `src/צבע file.ts` staged
  with a violation → `--staged` exit 1 naming that path.

- [ ] **Step 2: Run, expect failures.** `node --test mechanisms/hooks/convention-lint.selftest.mjs`

- [ ] **Step 3: Implement.**
- `lintLines(relPath, lines)` holds the rule loop; `lintFile` reads the disk
  file and calls it with every line.
- `--staged`: `git -c core.quotePath=false diff --staged -U0 -M
  --diff-filter=d --no-color --no-ext-diff`, through `addedLines`, then
  `lintLines` per file.
- Edit hook: if `git cat-file -e HEAD:<rel>` fails, `lintFile(rel)`;
  otherwise `addedLines` of `git -c core.quotePath=false diff -U0
  --no-color --no-ext-diff HEAD -- <rel>`.
- Header comment: which lines each mode lints, and why.

- [ ] **Step 4: Run, expect all pass.** `node --test mechanisms/hooks/convention-lint.selftest.mjs`

- [ ] **Step 5: Commit** `feat(convention-lint): lint the lines a change adds`

---

### Task 4: review-gate — the block message gives the delta

**Files:**
- Modify: `mechanisms/hooks/review-gate.mjs` (`judge`, `blockMessage`, header)
- Modify: `process/SDD.md` §4 step 2 (a delta is the reviewer's input)
- Test: `mechanisms/hooks/review-gate.selftest.mjs` (`describe('the block message names the delta')`)

**Interfaces:**
- Produces: each `judge(cfg).owed[i].missing[j]` is `{ path, prev, now,
  delta }`, where `now` is the staged key and `delta` is
  `{ cmd: 'git diff <old12> <new12>', baseMoved: boolean }`, `'gone'`
  (stamped blob missing), or `null` (no delta: never stamped, a deletion on
  either side, same blob, or an unparseable key).

- [ ] **Step 1: Failing tests.**
- `after a full stamp, an edit gives git diff <stamped> <staged>, and that
  command prints exactly the edit` → stamp `alpha,beta` on `src/a.ts`
  (`a\n`), stage `a\nb\n`; stderr has `git diff <x> <y>` under both
  `alpha` and `beta`; running it in the repo prints a patch whose only
  `+`/`-` body line is `+b`.
- `hooks mode gives the same delta line` → `reviewGate.stamping: "hooks"`,
  same setup; the delta line appears and the text says the diff is the
  reviewer's input.
- `no delta for a never-stamped file or a deletion` → no `git diff` line.
- `a stamped blob that is gone owes the whole change` → write a stamp whose
  key names `1111…` (40 chars) as the old blob; the line says the blob is
  gone and has no `git diff`.
- `a moved base is named` → stamp `src/a.ts` while it's a new file (key
  `000000:0…→100644:X`), commit it, stage an edit (`100644:X→100644:Y`) →
  the line has `git diff X Y` and `(its base moved too)`.
- `a hand-edited key builds no delta and doesn't throw` → key `"garbage"`
  → status 1, the old `(was garbage)` text, no `git diff`.
- `after the re-stamp the key names the new blob` → `--stamp alpha` →
  `readStamp(dir).reviewers.alpha['src/a.ts'].key` ends with the staged
  blob from `git ls-files -s src/a.ts`.

- [ ] **Step 2: Run, expect failures.** `node --test mechanisms/hooks/review-gate.selftest.mjs`

- [ ] **Step 3: Implement.**
- `judge`: for each missing file, `delta = deltaFor(prev, now)`, where
  `deltaFor` parses both keys with the `short()` regex, returns `null` per
  the Interfaces list, checks the old blob with `git cat-file -e`
  (try/catch → `'gone'`), and sets `baseMoved` when the src blobs differ.
- `blockMessage` keeps its lines and adds, under a file with a delta,
  `        review the change: git diff <old12> <new12>` (plus `  (its base
  moved too)`), or `        that stamped blob is gone: review the whole
  change`.
- Both modes' closing text adds: for a file with a `git diff` line, that
  diff is the reviewer's input.
- SDD.md §4 step 2: "For a file a reviewer stamped before, the block message
  gives `git diff <stamped> <staged>`; that delta is its input."

- [ ] **Step 4: Run, expect all pass.** `node --test mechanisms/hooks/review-gate.selftest.mjs mechanisms/hooks/review-stamp.selftest.mjs`

- [ ] **Step 5: Commit** `feat(review-gate): a re-review gets the delta since its stamp`

---

### Task 5: review-gate — `--check`

**Files:**
- Modify: `mechanisms/hooks/review-gate.mjs` (a `--check` mode before `--pre-commit`; header; `blockMessage`'s closing text names `--check`)
- Modify: `process/SDD.md` §4 (step 0: `--check` instead of a probe commit)
- Test: `mechanisms/hooks/review-gate.selftest.mjs` (new `describe('--check')`), `mechanisms/hooks/git-guard.selftest.mjs` (hooks-mode case)

**Interfaces:**
- Produces: `review-gate.mjs --check [--repo <path>]`: stdout, exit 0
  (`[ssdd-review-gate] nothing owed` plus any oversize warning or triage
  note) or 1 (the block message's text, owed list and deltas). No config →
  `[ssdd-review-gate] no .ssdd/config.json — not gated`, exit 0. A broken
  config → `brokenMessage`, exit 1. The repo is `--repo`, else git's cwd.

- [ ] **Step 1: Failing tests.**
- `--check prints the owed list and exits 1` → `src/a.ts` staged → status
  1, stdout matches `/alpha/` and `/beta/`.
- `--check prints nothing owed and exits 0` → after `--stamp alpha,beta`.
- `--check writes nothing` → stamp file bytes and `.git/index` bytes equal
  before and after (owed and not owed).
- `--check --repo works from another directory` → run with cwd = a fresh
  tmpdir and `--repo dir` → status 1.
- `--check outside an SSDD repo exits 0` and `a broken config exits 1`.
- git-guard: `ALLOWED`-style case under a `stamping: "hooks"` config:
  `node .ssdd/hooks/review-gate.mjs --check` → exit 0 (one new `it` with
  its own scratch repo, since the shared repo has no `reviewGate`).

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement** the mode; the closing text of both block
  messages gains `Check what's owed without committing: node
  .ssdd/hooks/review-gate.mjs --check`.

- [ ] **Step 4: Run, expect all pass.** `node --test mechanisms/hooks/review-gate.selftest.mjs mechanisms/hooks/git-guard.selftest.mjs`

- [ ] **Step 5: Commit** `feat(review-gate): --check prints what the index owes`

---

### Task 6: review-gate — a clean merge owes nothing

**Files:**
- Modify: `mechanisms/hooks/review-gate.mjs` (`stagedOwed`, used by `judge`, `triageNote`, `--stamp`, and the subagent hooks; a context line in `blockMessage`)
- Modify: `process/SDD.md` §4 (merges)
- Test: `mechanisms/hooks/review-gate.selftest.mjs` (new `describe('merges')`)

**Interfaces:**
- Produces: `mergeClean() → { head: string, paths: Set<string> } | null` —
  null unless `MERGE_HEAD` (`git rev-parse --git-path MERGE_HEAD`, resolved
  against the repo) holds exactly one commit and `git merge-tree
  --write-tree HEAD <head>` exits 0 or 1 with a hex tree id on line 1.
  `paths` = staged paths absent from `git diff --cached --raw --no-renames
  -z <tree>`.
- `stagedOwed() → { staged: Map<path,key>, merged: Set<path> }`: the staged
  map minus `merged`. Every caller that decides what's owed uses it.
- `judge(cfg)` adds `merged: { head, count }` or `null`; `blockMessage`
  prints `  merge: <n> staged path(s) match git's own merge with <head7> —
  owed by no one` when `count > 0`.

- [ ] **Step 1: Failing tests** (a helper builds: `src/a.ts` and
`src/b.ts` on base; branch `side` changes both; `main` changes `src/a.ts`
in a conflicting line; `git merge side` stops on the conflict; the test
resolves `src/a.ts` and stages it).
- `a path equal to git's merge owes nothing` → `--pre-commit` stderr names
  `src/a.ts`, not `src/b.ts`; the `merge:` line says 1 path.
- `the harness hook and --check apply it too` → same verdicts through
  `hook(dir, 'git commit -m m')` and `--check`.
- `an edit made during the merge is owed` → also edit and stage `src/b.ts`
  → both owed.
- `once the resolution is stamped, the merge commits` → `--stamp
  alpha,beta`, then `--pre-commit` exit 0.
- `an octopus merge is judged as today` → write two heads into
  `MERGE_HEAD` → `src/b.ts` owed.
- `a git without merge-tree --write-tree is judged as today` → put a
  `git` shim first on `PATH` that exits 129 for `merge-tree` and execs the
  real git otherwise → `src/b.ts` owed.
- `--check mid-conflict lists the conflicted path` → before resolving,
  `--check` exits 1 naming `src/a.ts`, no throw.
- `in a linked worktree` → the same merge inside `git worktree add`, run
  from the worktree → `src/b.ts` not owed.
- `the oversize warning doesn't count merged paths` → `maxRoutedFiles: 1`,
  a merge bringing 3 routed files cleanly → no `WARNING`.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement** `mergeClean` and `stagedOwed`; replace the
  direct `stagedChanges()` calls in `judge`, `triageNote`, `--stamp` and
  `subagentHook` (start and stop). The header comment describes the rule
  and its fallbacks.

- [ ] **Step 4: Run, expect all pass.** `node --test mechanisms/hooks/review-gate.selftest.mjs mechanisms/hooks/review-stamp.selftest.mjs mechanisms/hooks/review-gate.shapes.selftest.mjs`

- [ ] **Step 5: Commit** `feat(review-gate): a staged path equal to git's own merge owes nothing`

---

### Task 7: review-gate — shapes judged in SSDD repos; a visible chained `git add`

**Files:**
- Modify: `mechanisms/hooks/review-gate.mjs` (harness flow; header)
- Modify: `process/SDD.md` §4 step 4
- Test: `mechanisms/hooks/review-gate.shapes.selftest.mjs`

**Interfaces:**
- Internal: `walk(commands, start) → { steps: Array<{ inv, dir }>, bad }`
  — every git invocation with its effective directory (`cd` moves, `-C`
  composes, `~` expands), and the first unresolvable `cd` / `-C`.
- Internal: `chainedAddReason(inv, dir, root, routeOf) → string` — `''`
  when the add is visible and unrouted, else why not (`` `-A` ``,
  `` a directory `docs` ``, `` a glob `*.md` ``, `` `src/a.ts`, routed to
  beta ``, `` `../x` is outside the repo ``).
- Harness order: skeleton/skip checks → `walk` → resolve the commit's repo
  (unresolvable / several repos → deny, as today) → load config (none →
  allow; broken → deny) → shape checks → judge.

- [ ] **Step 1: Failing tests.**
- In `describe('un-evaluable commits are refused…')`: `add chained before
  commit` uses a routed path (the shapes repo routes `^src/`; use `git add
  src/x.ts && …`). New refused cases (both payloads), each matching
  `` /`git add` chained/ `` and its reason: a directory (`git add docs &&
  git commit -m x` with `docs/` existing), `.`, a glob (`git add 'docs/*.md'
  && …`), `$X`, `../outside.md`, `-A`, `-u`, `-p`, `git mv a b && git
  commit`, `git restore --staged x && git commit`, and a routed file named
  with different case when the disk is case-insensitive (skip the case
  unless `core.ignorecase` is true in the repo).
- New `describe('a visible chained git add passes')` (both payloads, with
  `docs/notes.md` and `docs/my notes é.md` on disk): `git add docs/notes.md
  && git commit -m x`, `git add -- docs/notes.md && git commit -m x`, `git
  add -f docs/notes.md && git commit -m x`, `cd docs && git add notes.md &&
  git commit -m x`, `git add "docs/my notes é.md" && git commit -m x` → exit
  0 when nothing routed is staged; and with `src/a.ts` staged and unstamped,
  `git add docs/notes.md && git commit -m x` → exit 2 naming the owed
  reviewer (the judge still runs).
- New `describe('a repo without .ssdd/config.json judges no shapes')` (both
  payloads): `git commit -am x`, `git commit x.ts -m y`, `git add x &&
  git commit -m y`, `git rm x && git commit -m y` → exit 0; `cd $X && git
  commit -m y` → exit 2 (cannot resolve).

- [ ] **Step 2: Run, expect failures.** `node --test mechanisms/hooks/review-gate.shapes.selftest.mjs`

- [ ] **Step 3: Implement** in the harness section.
- `chainedAddReason`: options other than `-f`, `--force`, `-v`,
  `--verbose` are refused; `--` ends options; redirections are skipped as
  in the commit scan. Per path: a `*?[` character → glob; a leading `:` →
  magic; `$` or a backtick → unresolvable; resolve against `dir` (`~`
  expanded), then `realpathSync.native` (for a path that doesn't exist,
  the real parent plus the basename); relative to the real `root`: empty
  or a directory on disk → directory; `..`-leading or absolute → outside;
  then the first route that matches the POSIX relative path → routed.
- The staging check runs only on staging commands *before* the commit in
  the chain, as today. `rm`, `mv`, `restore`, `update-index` keep today's
  message.
- The refusal reads: `` [ssdd-review-gate] `git add` chained before `git
  commit` in ONE call: <reason>. `` + today's explanation + `A chained
  add passes only when it names files no reviewer is routed to.`

- [ ] **Step 4: Run, expect all pass.** `node --test mechanisms/hooks/*.selftest.mjs`

- [ ] **Step 5: Commit** `feat(review-gate): shapes judged only in SSDD repos; a visible chained git add of unrouted files passes`

---

### Task 8: real-data runs

No repo code unless a run finds a bug; a bug is fixed test-first in the
task that owns the code, and ledgered. Scripts and outputs stay in the
scratchpad (they hold private paths and commit text).

- [ ] **Step 1: prizma's merges (AC17).** In the scratch clone, for each of
  `ebbd494 60da710 5597881 1aa4cc6`: `git checkout -q --detach <c>^1`,
  `git merge --no-commit <c>^2` (it stops), `git read-tree --reset -u <c>`
  (the real resolution; `MERGE_HEAD` stays), then `node <branch>/review-gate.mjs
  --check` and the same with `v3.0.0`'s `review-gate.mjs` in `--pre-commit`
  mode. Expected: owed routed files 0, 0, 1, 0 (today: 37, 25, 46, 12).
  `git merge --abort` between merges.
- [ ] **Step 2: Hatedate's chains (AC20).** In the scratch clone of
  Hatedate, an SSDD `.ssdd/config.json` carrying Hatedate's routing table
  (its gate's `ROUTES`, test files excluded). Replay each of the 209
  commands through the new hook with `cwd` = the clone (paths under
  `/Users/shaked/Developer/Hatedate` mapped to the clone). Expected: none of
  the 78 that add a routed file passes; record how many pass in total.
- [ ] **Step 3: Hatedate's hooksPath commands (AC22).** Run the 4 through
  `git-guard.mjs` at `v3.0.0` and on the branch: the plain read flips to
  allow; the others keep their outcome.
- [ ] **Step 4: Ledger** each run's numbers and any finding.

---

### Task 9: release notes and docs

**Files:**
- Modify: `CHANGELOG.md` (`## [3.1.0] — unreleased`), `README.md` (How it
  works paragraph on the gate; Known limitations: chained staging, merges,
  `--check`), `docs/BACKLOG.md` (Part 3 row → plan written / shipped
  unreleased; remove the open decision bullet), `process/SDD.md` §2 (a
  duplicate number: renumber the later plan and its references).
- Test: `bin/ssdd.selftest.mjs` only if a doc test asserts on these files.

- [ ] **Step 1:** Write the entries. The CHANGELOG lists, under Changed: the
  merge rule, the delta, `--check`, chained `git add`, shapes only in SSDD
  repos, the untracked warning and `preCommit.blockUntracked`,
  `core.hooksPath` reads, lint on added lines. No `### Upgrade` section: a
  repo that wants the untracked block sets `preCommit.blockUntracked`
  (said under Changed).
- [ ] **Step 2:** `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs` → all pass.
- [ ] **Step 3: Commit** `docs: Part 3 in the CHANGELOG, README, BACKLOG and SDD.md`

---

Close (after the final review): SPEC Part 3 gets `### Verification` (AC17–AC25
with real output) and `### Deviations & discoveries`; an `update` from a
`v3.0.0` install to this branch and the installed layout's selftests are
run for AC25.
