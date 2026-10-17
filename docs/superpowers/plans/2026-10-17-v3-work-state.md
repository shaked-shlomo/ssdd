# v3 Part 1 — Work State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SSDD knows where the work is. One script reads plans, ledgers and
git and reports where each plan stands. It runs when a session starts, and
it checks a plan before the plan can be marked BUILT or SHIPPED.

**Architecture:**
- `plan-parse.mjs` holds pure functions that turn plan and ledger text into
  data.
- `work-state.mjs` gathers plan copies from every local branch, every
  worktree and the default branch.
- Three modes share that one data model:
  - the bare command: the full view
  - `--session-start`: a capped view
  - `--staged`: the close check, run by the pre-commit hook
- Config gains a `paths` section. The installer ships a
  `.superpowers/sdd/.gitignore` that tracks Superpowers' `progress.md`
  ledgers.

**Tech Stack:** Node ≥ 18, ES modules, zero dependencies, the git CLI,
`node:test`.

**Spec:** `SPEC.md` → v3 → Part 1 (Clarify 1–14, Design, Scope, AC1–AC12).

## Global Constraints

- Zero npm dependencies. Node 18 must run every file, so use no API newer
  than Node 18.0 (no `fs.globSync`, no `Array.prototype.toSorted`).
- Tests are `*.selftest.mjs`, run by
  `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs`. CI runs
  on Node 18 and 24.
- The status words are exactly, in this order of matching: `IN PROGRESS`,
  `DRAFT`, `BUILT`, `SHIPPED`, `SUPERSEDED`, `ABANDONED`. "Open" means
  DRAFT, IN PROGRESS or BUILT.
- The default paths are `paths.plans = ".ssdd/plans"` and
  `paths.ledgers = ".ssdd/ledgers"`.
- A plan file is a `.md` in the plans folder whose name starts with a
  digit. Its number is the part before the first `-`.
- The Superpowers ledger is `.superpowers/sdd/<dir>/progress.md`. Its first
  line is `# SDD ledger — plan: <path>`. Completion lines are
  `Task <N>: complete …`; fix rounds are `Task <N>: fix round <R>/5 …`.
- `--session-start` always exits 0. It prints at most 12 lines and 1536
  bytes, ending with `+N more: node .ssdd/hooks/work-state.mjs` when it
  cuts. With no `.ssdd/config.json` it prints nothing.
- The script never fetches and never makes a network call. It never edits
  a plan.
- The default branch is the target of `refs/remotes/origin/HEAD`, else
  local `main`, else `master`, else the current branch.
- Output prefixes: `[ssdd-work-state]` for close-check messages, and
  `SSDD ·` for the view header.
- Run git with `-z` or `--porcelain` wherever paths are parsed, so paths
  with spaces or non-ASCII characters survive.

## Review Focus

1. **A repo with no commits, no remote, or no `main`.** The view still
   prints from what's on disk, and never throws. (Task 3:
   `view: fresh repo with no commits`.)
2. **CRLF line endings or a UTF-8 BOM in a plan.** These come from Windows
   or Cursor. Status, criteria and entries must parse the same. (Task 2:
   `parsePlan: CRLF and BOM`.)
3. **A plan path with a space or Hebrew characters.** Without `-z`, git
   quotes such paths and the parse breaks. (Task 3:
   `view: path with a space and non-ASCII`.)
4. **A prunable worktree, or one in detached HEAD.** It's skipped or shown
   by path, and never crashes the view. (Task 3:
   `view: detached and missing worktrees`.)
5. **Status written in any case** (`**Status:** In progress`), and
   `> **Status:**` blockquote lines. Both are recognized. (Task 2:
   `parseStatus: case and blockquote`.)

---

### Task 1: `paths` in the config loader

**Files:**
- Modify: `mechanisms/hooks/ssdd-config.mjs` (`SECTIONS`, `build`)
- Modify: `mechanisms/config.example.json` (add `paths` with a `$comment`)
- Test: `mechanisms/hooks/ssdd-config.selftest.mjs`

**Interfaces:**
- Produces: `cfg.paths = { plans: string, ledgers: string }`, always set
  and repo-relative, with no leading `./` and no trailing `/`. A missing
  key or one that isn't a string gets the default. If `paths` itself
  isn't an object, the loader returns `error` the same way it does for
  `routing`.

- [ ] **Step 1: Write the failing tests:**
  - `it('paths default to .ssdd/plans and .ssdd/ledgers')`: `{}` gives
    `cfg.paths` deep-equal to `{ plans: '.ssdd/plans', ledgers: '.ssdd/ledgers' }`.
  - `it('paths are read and normalized')`:
    `{ paths: { plans: './.claude/plans/' } }` gives `cfg.paths.plans`
    equal to `'.claude/plans'`, and `ledgers` keeps its default.
  - `it('a non-object paths is a config error')`: `{ paths: 'x' }` sets
    `error` to a message matching `/"paths" must be an object/`, and
    `cfg.paths` is still the defaults.
- [ ] **Step 2: Run** `node --test mechanisms/hooks/ssdd-config.selftest.mjs`.
  Expect the 3 new tests to FAIL.
- [ ] **Step 3: Implement.** Add `['paths', isObject, 'an object']` to
  `SECTIONS`. In `build`, set `paths` from the defaults plus the string
  overrides, normalized.
- [ ] **Step 4: Run the tests.** Expect all to PASS.
- [ ] **Step 5: Commit:** `feat(config): paths.plans / paths.ledgers, with defaults`.

### Task 2: `plan-parse.mjs`, pure parsing

**Files:**
- Create: `mechanisms/hooks/plan-parse.mjs`
- Test: `mechanisms/hooks/plan-parse.selftest.mjs`

**Interfaces:**
- Produces:
  - `STATUS_WORDS: string[]`, as in Global Constraints.
  - `OPEN_WORDS = new Set(['DRAFT','IN PROGRESS','BUILT'])`.
  - `parseStatus(text) → { raw: string|null, word: string|null }`.
    - It reads the first line matching
      `^\s*(?:>\s*)?\*\*Status:\*\*\s*(.*)$`, case-insensitive on the
      word only.
    - `word` is the first entry of `STATUS_WORDS` that the trimmed,
      upper-cased `raw` starts with.
  - `parsePlan(text) → { status: {raw, word}, criteria: string[], entries: Map<string, {deferred: boolean}>, openQuestions: number }`.
    - `criteria` are IDs like `'AC1'` from the `## Acceptance criteria`
      section, in order, with no duplicates. A line counts when it's a
      list item whose text starts, optionally after `[ ]` or `[x]` and
      optionally inside `**`, with `AC<digits>`.
    - `entries` come from the `## Verification` section: list items
      starting with `**AC<digits>`, which covers both `**AC1** —` and
      `**AC1 ✅ —`. `deferred` is true when the line contains `DEFERRED`.
    - `openQuestions` counts the list items under `## Open questions`,
      skipping lines that start with `<` and lines that are just "none" or
      "n/a".
    - Section headings match case-insensitively by prefix. A BOM is
      stripped and CRLF is normalized first.
  - `parseSsddLedger(text) → { done: number, total: number, next: string|null }`.
    - It reads rows matching `^\s*-\s+\[( |x|X)\]\s+Task\s+(\d+)`.
    - `next` is the first unchecked row's text from `Task`, cut at 60
      characters at a word boundary.
  - `parseProgress(text) → { plan: string|null, done: number, inReview: number|null }`.
    - `plan` comes from the first line, `# SDD ledger — plan: <path>`,
      trimmed.
    - `done` is the highest `<N>` on a `Task <N>: complete` line.
    - `inReview` is `<N>` when the last non-blank line is
      `Task <N>: fix round`.
  - `countPlanTasks(text) → number`: the number of `### Task <N>`
    headings.

- [ ] **Step 1: Write the failing tests** (`describe` per function):
  - `parseStatus: template line`: `**Status:** DRAFT | IN PROGRESS | BUILT …`
    gives word `'DRAFT'`.
  - `parseStatus: case and blockquote`: `> **Status:** In progress (PR #63 open) — 2026-09-17`
    gives `'IN PROGRESS'`.
  - `parseStatus: unknown`: `**Status:** DONE on branch x` gives word
    `null` and raw starting `'DONE'`. `**Status:** AC6 FAILED` gives
    `null`.
  - `parsePlan: prizma checkbox form`: `- [ ] AC1 \`npm run x\`` and
    `- [x] AC2 …` give criteria `['AC1','AC2']`.
  - `parsePlan: SSDD form`: `- **AC1** — …` and `- **AC3 — The view.**`
    give `['AC1','AC3']`.
  - `parsePlan: entries`: `- **AC1** — cmd → 16`, `- **AC2 ✅ — …` and
    `- **AC3** — DEFERRED (operator): …` give 3 entries, with
    `deferred === true` only for AC3. A criterion line outside
    Verification isn't an entry.
  - `parsePlan: open questions`: a template placeholder `<From the clarify…>`
    plus `1. Which bucket?` plus `- none` gives `1`.
  - `parsePlan: CRLF and BOM`: the same plan with `\r\n` and a leading
    `﻿` parses equal to the LF version.
  - `parseSsddLedger`: three rows (`[x] Task 1`, `[x] Task 2`,
    `[ ] Task 3 — wire hooks`) give `{done:2,total:3,next:'Task 3 — wire hooks'}`.
    A milestone row `- [ ] — PR 1 ships —` is ignored.
  - `parseProgress`: a ledger with first line
    `# SDD ledger — plan: .ssdd/plans/12-x.md`, then `Task 1: complete (…)`,
    `Task 2: complete (…)` and a last line `Task 3: fix round 1/5 (…)`,
    gives `{plan:'.ssdd/plans/12-x.md', done:2, inReview:3}`.
  - `countPlanTasks`: `### Task 1: A` and `### Task 2: B` give `2`.
- [ ] **Step 2: Run** `node --test mechanisms/hooks/plan-parse.selftest.mjs`.
  Expect FAIL (the module is missing).
- [ ] **Step 3: Implement** the functions above. Use no I/O.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit:** `feat(work-state): plan-parse — status, criteria, entries, ledgers`.

### Task 3: `work-state.mjs`, collection and the full view

**Files:**
- Create: `mechanisms/hooks/work-state.mjs`
- Test: `mechanisms/hooks/work-state.selftest.mjs`

**Interfaces:**
- Consumes: `loadSsddConfig(repo)` (with `cfg.paths` from Task 1) and
  everything in Task 2.
- Produces, exported for Tasks 4–6:
  - `collect(repo) → State | null`. It returns null when there's no
    config. `State` is:
    ```
    { root, defaultRef, plans: Row[], unknown: string[],
      warnings: string[], ledgers: LedgerInfo[] }
    ```
  - A `Row` is:
    ```
    { path, num, where, status, statusRaw, flagged, since,
      progress, verified, total, deferred, openQuestions }
    ```
    - `where` is `'main'`, `'branch <b>'`, `'worktree <name>'` or
      `'branch <b> (worktree <name>)'`.
    - `flagged` is true when the stale rule fired.
    - `since` is `YYYY-MM-DD` for a DRAFT.
    - `progress` is a short string or `''`.
  - `render(state, { cap }) → string`. With a cap of
    `{ lines: 12, bytes: 1536 }` it truncates and appends
    `+N more: node .ssdd/hooks/work-state.mjs`.
  - `ledgerIgnoreRule(dir, relPath) → string|null`.
    - It returns `"<source>:<line>: <pattern>"` when
      `git check-ignore -q --no-index` says the path is ignored, and null
      otherwise.
    - It gets the rule text from `git check-ignore -v --no-index`.
- The CLI with no flags prints `render(collect(repo), { cap: null })` and
  exits 0.

The rules, from the spec, that the implementer can't infer:
- **Sources.**
  - The default branch (Global Constraints), read from git objects.
    Status comes from whichever of local and remote contains the other,
    or from local if they've diverged.
  - Every local branch other than the default, read from git objects.
  - Every worktree from `git worktree list --porcelain`, read from disk.
  - Read plan blobs with one `git ls-tree -rz <ref> -- <plans>` per ref
    and one `git cat-file --batch` in total.
- **Rows.**
  - A plan present on the default branch takes its Status from there.
  - A plan only on branches or worktrees takes the Status of the first
    one that has it. The current worktree goes first, then the other
    worktrees, then branches.
  - Closed plans (SHIPPED, SUPERSEDED, ABANDONED) aren't rows.
  - An unknown word goes into `unknown`, which renders as one line:
    `N plans with a status outside the six (DONE ×5, CLOSED …)`.
- **Stale rule (IN PROGRESS on the default branch only).** A source counts
  as working on the plan when both hold:
  - its copy of the plan differs from the default branch's copy
  - it has commits not on either default ref touching the plan file or its
    ledger (`git log --format=%h -1 <ref> --not <defaults> -- <plan> <ledger>`),
    or, for a worktree, the disk copy differs from its branch's blob

  If nothing is working on it, `flagged` is true, and the row says
  `IN PROGRESS on main, no branch working on it → SHIPPED, BUILT, or still going?`.
  If something is, `where` names it, and progress, verified and total come
  from that copy.
- **Ledger link.**
  - A Superpowers `progress.md` belongs to plan P when its `plan` field
    equals P's repo-relative path.
  - Otherwise, it belongs to P when the file it names, read from the same
    source, contains P's path or P's basename.
  - A ledger linked to no plan gives one warning:
    `! ledger <dir> isn't linked to an SSDD plan`.
  - Superpowers wins over the SSDD ledger when both exist.
  - Progress text:
    - `Tasks 1–3 of 6 done` (the total comes from `countPlanTasks` on the
      linked file), or `Tasks 1–3 done` when there's no total.
    - `Task 4 in review` when a fix round is in progress.
    - From an SSDD ledger: `next: <next>`.
- **Warnings** (`! …`, after the rows):
  - a ledger on disk in a worktree that's ignored by a rule:
    `! ledger for <num> is ignored by git (<rule>)`
  - two or more distinct plan paths sharing a number:
    `! plans numbered <num>: <file> (<where>), …`
- **DRAFT `since`** is the date of the last commit touching the file on
  the ref it came from (`git log -1 --format=%cs`), or omitted for a plan
  that's only on disk.

- [ ] **Step 1: Write the failing tests** with scratch repos (helpers as
  in `ssdd-config.selftest.mjs`; a config with `{}` turns the repo into an
  SSDD repo):
  - `view: lists open plans across main, a branch and a worktree`. This is
    AC1.
    - One plan IN PROGRESS on branch `b` checked out in a worktree, with
      an uncommitted Superpowers `progress.md` naming it and 2 tasks
      complete.
    - One DRAFT on main with one open question.
    - The output contains `Tasks 1–2` and `(worktree`, plus
      `DRAFT since` and `1 open question`.
  - `view: SSDD ledger next task`: `.ssdd/ledgers/<slug>-ledger.md` with
    `[x] Task 1` and `[ ] Task 2 — docs` gives `next: Task 2 — docs`.
  - `view: unlinked ledger is warned once`.
  - `stale: merge commit` / `squash merge` / `deleted branch`, each
    flagged. This is AC2.
    - In each case the plan is IN PROGRESS on main.
    - Its branch is merged with `--no-ff` / squashed with
      `merge --squash` and committed / deleted.
    - Each output matches `/no branch working on it/`.
  - `stale: active branch is not flagged`: the branch has an unmerged
    commit changing the plan.
  - `stale: merged on the remote but not pulled is flagged`:
    - Set up a bare `origin` and push. Merge the branch into
      `origin/main` through a second clone, then `git fetch` in the first
      clone. Local `main` stays behind.
    - The plan is flagged.
  - `stale: BUILT and DRAFT never flagged; closed plans not listed`.
  - `view: unknown statuses grouped`: two `DONE` plans give one line
    containing `DONE ×2`.
  - `view: duplicate numbers warned`: `29-a.md` on main and `29-b.md` on
    branch `x` give `! plans numbered 29`. This is AC9.
  - `view: ignored ledger is warned`: the root `.gitignore` has
    `.superpowers/`, and a ledger on disk gives `.gitignore:1: .superpowers/`.
  - `view: paths.plans honored`: `{ paths: { plans: '.claude/plans' } }`
    finds a plan there. This is AC8, the view half.
  - `view: fresh repo with no commits`: a plan on disk only is listed, and
    the exit code is 0. (Review Focus 1)
  - `view: path with a space and non-ASCII`: `.ssdd/plans/07-עמוד מחיר.md`
    is listed. (Review Focus 3)
  - `view: detached and missing worktrees`: a worktree in detached HEAD,
    and one whose directory was deleted (prunable). The exit code is 0,
    and the detached one is shown by its path. (Review Focus 4)
  - `view: no config prints nothing`.
- [ ] **Step 2: Run** `node --test mechanisms/hooks/work-state.selftest.mjs`.
  Expect FAIL.
- [ ] **Step 3: Implement** `collect`, `render`, `ledgerIgnoreRule` and
  the bare CLI. Keep git calls to a constant number per ref: `ls-tree`,
  one `log` for the stale rule, and one `log` for `since`.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit:** `feat(work-state): the view — plans across branches and worktrees, stale status, ledgers`.

### Task 4: `--session-start`

**Files:**
- Modify: `mechanisms/hooks/work-state.mjs`
- Test: `mechanisms/hooks/work-state.selftest.mjs`

**Interfaces:**
- Consumes: `collect` and `render` (Task 3).
- Produces two flags:
  - `--session-start`: plain text on stdout (Claude Code adds it to the
    session's context).
  - `--session-start=cursor`: one JSON object,
    `{"additional_context":"<text>"}`.

  Both modes:
  - Never read stdin.
  - Find the repo from `CLAUDE_PROJECT_DIR`, then `SSDD_PROJECT_DIR`,
    then the cwd.
  - Exit 0 in every case. Any thrown error prints at most one line,
    `SSDD · work state unavailable (<message>)`.

- [ ] **Step 1: Write the failing tests** (AC4, the selftest half):
  - `session-start: capped`: 40 open plans give at most 12 lines and at
    most 1536 bytes. The last line matches
    `/^\+\d+ more: node \.ssdd\/hooks\/work-state\.mjs$/`.
  - `session-start: broken config and corrupt plan exit 0`: an invalid
    `config.json` exits 0 with at most one line. A plan file that is
    binary junk exits 0.
  - `session-start: no config prints nothing`.
  - `session-start=cursor prints JSON`: the output parses, and
    `additional_context` contains `SSDD ·`.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement** the two flags around `collect` and `render`.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit:** `feat(work-state): --session-start, capped, never fails a session`.

### Task 5: The close check and the pre-commit wiring

**Files:**
- Modify: `mechanisms/hooks/work-state.mjs` (`--staged`)
- Modify: `mechanisms/hooks/pre-commit`
- Test: `mechanisms/hooks/work-state.selftest.mjs`

**Interfaces:**
- Consumes: `parsePlan`, `ledgerIgnoreRule`, `cfg.paths`.
- Produces `--staged`. It exits 1 on a block and 0 otherwise. Blocks print
  `[ssdd-work-state] <file>: …` to stderr. Reminders print
  `[ssdd-work-state] reminder: git add <path>` and don't change the exit
  code.

The rules:
- **Staged plans:** `git diff --cached --name-only -z --diff-filter=ACMR -- <plans>`,
  keeping only plan files. Each one's content is read with `git show :<path>`.
- **Status word:** if it's null, block with:
  `Status "<raw first 30 chars>" isn't one of DRAFT, IN PROGRESS, BUILT, SHIPPED, SUPERSEDED, ABANDONED`.
- **Criteria, for BUILT or SHIPPED:**
  - With IDs, block naming each ID that has no entry:
    `AC2, AC5 have no Verification entry (an entry may be "DEFERRED (operator): <reason>")`.
  - With no IDs, print the note `no AC IDs — close check skipped` and
    don't block.
- **The ledger, for BUILT or SHIPPED:** look in this worktree for a
  Superpowers ledger linked to the plan, or its SSDD ledger.
  - If git ignores it, warn and name the rule.
  - If it's untracked, or has unstaged changes
    (`git ls-files --error-unmatch`, `git diff --quiet --`), block with
    `ledger <path> isn't staged: git add <path>`.
- **Every run:** for each `.superpowers/sdd/*/progress.md` on disk that
  git doesn't ignore and that is untracked or unstaged, print the
  reminder.
- **pre-commit:**
  - The untracked list drops lines matching
    `^\.superpowers/sdd/[^/]*/progress\.md$` before it decides.
  - A new step after convention-lint:
    `node "$ROOT/.ssdd/hooks/work-state.mjs" --staged`.

- [ ] **Step 1: Write the failing tests** (AC6, plus AC7's pre-commit half):
  - `staged: BUILT with a missing entry is blocked`. The exit code is 1,
    and stderr names `AC2`.
  - `staged: a DEFERRED entry passes`.
  - `staged: both entry forms parse` (`- **AC1** —` / `- **AC1 ✅ —`).
  - `staged: Status DONE is blocked with the allowed words`.
  - `staged: an unstaged DONE plan blocks nothing`.
  - `staged: BUILT with no IDs passes with a note`.
  - `staged: SHIPPED with an unstaged Superpowers ledger is blocked, and passes once staged`.
  - `staged: an ignored ledger passes with a warning naming the rule`.
  - `pre-commit: ledger exempt from the untracked block`.
    - Copy the real `mechanisms/hooks/pre-commit` and the needed `.mjs`
      files into a scratch repo's `.githooks` / `.ssdd/hooks`, and set
      `core.hooksPath`.
    - An untracked `.superpowers/sdd/p/progress.md` doesn't block
      `git commit`, and prints the reminder.
    - An untracked `notes.txt` still blocks.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement** `--staged` and edit `pre-commit`.
- [ ] **Step 4: Run** `node --test mechanisms/hooks/*.selftest.mjs`. Expect
  PASS, including the existing pre-commit backstop test in
  `review-gate.selftest.mjs`.
- [ ] **Step 5: Commit:** `feat(work-state): close check in pre-commit; Superpowers ledger exempt from the untracked block`.

### Task 6: The installer — the ledger's `.gitignore` and the status warning

**Files:**
- Create: `mechanisms/superpowers-sdd.gitignore`, with exactly the spec's
  five lines: the `# SSDD:` comment, `*`, `!.gitignore`, `!*/`,
  `!*/progress.md`.
- Modify: `bin/ssdd.mjs`:
  - `plan()`: add a managed mapping,
    `.superpowers/sdd/.gitignore` ← `mechanisms/superpowers-sdd.gitignore`.
  - `install`: drop that target from the clash list when the existing file
    is Superpowers' default.
  - `update`: in the `base === null` branch, replace Superpowers' default
    instead of writing a sidecar. Report it as
    `added (replaced Superpowers' default)`.
  - `status`: add the warning to `gateWarnings`.
- Test: `bin/ssdd.selftest.mjs`

**Interfaces:**
- Consumes: `ledgerIgnoreRule` (Task 3), imported from
  `../mechanisms/hooks/work-state.mjs`.
- Produces:
  - `isSuperpowersDefault(buf) → boolean`: true when the trimmed text is
    exactly `*`.
  - The status line:
    `WARNING: git ignores Superpowers ledgers here (<rule>) — remove that rule so .superpowers/sdd/*/progress.md is tracked`.
    It's printed when `ledgerIgnoreRule(target, '.superpowers/sdd/_/progress.md')`
    is set.

- [ ] **Step 1: Write the failing tests.** In `buildSource()`, add the
  `.gitignore` source to v2.0.0, so the existing fixtures keep their
  meaning.
  - `install writes .superpowers/sdd/.gitignore and replaces a "*"-only one`.
  - `install leaves an edited .superpowers/sdd/.gitignore and reports the clash`.
    This follows the existing clash behavior.
  - `update replaces Superpowers' default instead of a sidecar`.
  - `status warns when a parent rule ignores the ledgers`.
- [ ] **Step 2: Run** `node --test bin/ssdd.selftest.mjs`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite. Expect PASS.
- [ ] **Step 5: Commit:** `feat(install): ship the Superpowers ledger .gitignore; status names a parent ignore`.

### Task 7: Adapter wiring

**Files:**
- Modify: `adapters/claude-code/settings-hooks.json`: add
  `"SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.ssdd/hooks/work-state.mjs\" --session-start" }] }]`,
  with no matcher.
- Modify: `adapters/cursor/hooks.json`: add
  `"sessionStart": [{ "command": "node .ssdd/hooks/work-state.mjs --session-start=cursor" }]`,
  without `failClosed`.
- Modify: `adapters/cursor/rules/ssdd.mdc` and
  `adapters/generic/AGENTS.md`: add one line,
  `Before starting work, run \`node .ssdd/hooks/work-state.mjs\` to see where the work is.`
- Modify: `adapters/claude-code/README.md` and `adapters/cursor/README.md`:
  one line each on the hook, plus Cursor's delivery caveat (spec Clarify 7).
- Test: `bin/ssdd.selftest.mjs`, next to the existing template check at
  about line 507.

- [ ] **Step 1: Write the failing tests:**
  - `the Claude Code template has a SessionStart work-state hook without a matcher`.
  - `the Cursor template has sessionStart without failClosed`.
  - `ssdd.mdc and the AGENTS template carry the run-the-script line`.

  These read the real files under `adapters/`. This is AC5.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Edit the four files.**
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit:** `feat(adapters): run the work-state view at session start`.

### Task 8: Templates, process docs, and this repo's own ledger

**Files:**
- Modify: `process/templates/plan-template.md`:
  - Status line: the six words.
  - Criteria: `- **AC1** — <criterion>`, with no checkbox.
  - Verification: both forms, `- **AC1** — <command> → <real output>` and
    `- **AC1** — DEFERRED (operator): <what's left>`.
- Modify: `process/templates/task-ledger-template.md`: the finished example
  row becomes `- [x] Task 1 — …`.
- Modify: `process/SDD.md`:
  - §2: criteria get IDs.
  - §6: one entry per ID, and the DEFERRED form.
  - §7: the close check runs when Status becomes BUILT or SHIPPED.
  - A short "Where the work is" note under Handover, naming
    `node .ssdd/hooks/work-state.mjs`.
- Modify: `skills/new-plan/SKILL.md`: Syncing back points at the close
  check.
- Modify:
  - `README.md`: a short "Where the work is" section.
  - `CHANGELOG.md`: a `## [3.0.0] — unreleased` entry, Part 1 lines only.
  - `docs/BACKLOG.md`: Plan 1 marked done.
- Replace: this repo's `.superpowers/sdd/.gitignore` with
  `mechanisms/superpowers-sdd.gitignore`, and commit it. That makes this
  plan's own `progress.md` the first tracked ledger.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Check them** (AC10):
  - `git grep -n "\- \[ \] <criterion>"` lists only SPEC.md and
    CHANGELOG.md.
  - `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs`
    passes.
- [ ] **Step 3: Commit:** `docs: AC IDs and Verification forms in the templates; SDD.md close check; README`.

### Task 9: Verification against the spec

Nothing new gets built in this task. Fill in `SPEC.md` → v3 → Part 1 →
`### Verification`, with one `- **ACn** —` entry per criterion. Each entry
holds the command and the real output from this session.

- [ ] **AC3:** run read-only in prizma:
  `cd ~/Developer/prizma && time node ~/Developer/ssdd/mechanisms/hooks/work-state.mjs`.
  - Plan 34 is flagged, 02 shows its age, and the unknown statuses come
    out as one line.
  - Compare against the Clarify 6 probe set, recording any difference with
    the commit that explains it.
  - It runs in under 1 s.
- [ ] **AC4, live:** in a scratch repo with the template hooks, run
  `claude -p --model sonnet "say exactly what the SSDD line in your context says"`,
  then confirm the view text shows up in the answer. If `claude -p` can't
  run here, the entry says `DEFERRED (operator)` with the exact command
  to run.
- [ ] **AC11:** in a scratch repo installed at `v2.7.0`, run
  `update --to <this branch's HEAD>`. Expect no conflicts,
  `.claude/settings.json` untouched, and the `SessionStart` diff printed.
- [ ] **AC12:** run the full suite on Node 24 (and Node 18 if one is
  available locally; otherwise CI).
- [ ] **AC1, AC2, AC5–AC10:** cite the named selftests with their pass
  counts.
- [ ] **Commit:** `docs(spec): v3 Part 1 verification`.
