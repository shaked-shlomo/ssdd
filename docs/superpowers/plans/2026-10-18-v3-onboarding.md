# v3 Part 2 — Onboarding Existing Repos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repo that already has plans, or keeps them somewhere else, gets
the v3 format and v3's behavior from its first injection, and SSDD knows
which onboarding steps are still open.

**Architecture:**
- `plan-migrate.mjs` (new, pure) turns an old plan's criteria into the v3
  form, says whether a plan still needs that, and checks that a migration
  only added or reformatted text.
- `work-state.mjs` gains three CLI modes on the checkout git runs in:
  `--migrate` (rewrite + per-plan to-do), `--migrate-check <ref>` (the
  verifier's mechanical floor) and `--next-plan` (numbering that reads
  `paths.plans`). Its view gains two onboarding `!` lines and a
  not-recorded count.
- `skills/migrate-plans/SKILL.md` is the agent pass. `skills-audit.mjs
  record` writes `"audited"`. `bin/ssdd.mjs` `update`/`status` print the
  same onboarding lines as the view, and `update` prints the CHANGELOG's
  Upgrade sections for the versions it crosses.
- Docs, templates and skills name `paths.*` instead of `.ssdd/plans`.

**Tech Stack:** Node ≥ 18, ES modules, zero dependencies, the git CLI,
`node:test`.

**Spec:** `SPEC.md` → v3 → Part 2 (Clarify 15–17, Design, Scope,
AC13–AC16). Part 1's "Deviations & discoveries" and its code
(`mechanisms/hooks/work-state.mjs`, `plan-parse.mjs`, `ssdd-config.mjs`)
are the base.

## Global Constraints

- Zero npm dependencies; nothing newer than Node 18.0 (no `toSorted`,
  `findLast`, `fs.globSync`).
- Tests are `*.selftest.mjs`:
  `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs`. CI runs
  Node 18 and 24.
- The six status words, in matching order: `IN PROGRESS`, `DRAFT`, `BUILT`,
  `SHIPPED`, `SUPERSEDED`, `ABANDONED`. Closed-with-evidence means BUILT or
  SHIPPED.
- A criterion ID is `AC<digits>` plus an optional lower-case letter
  (`AC8b`). A checkbox is `[ ]`, `[x]`, `[X]`, `[~]` or `[-]`.
- The canonical criterion and entry form is `- **AC1** — <text>`. The
  not-recorded entry is exactly
  `- **AC3** — NOT RECORDED (migrated <YYYY-MM-DD>): the plan's Verification didn't close this.`
- The two onboarding lines, verbatim:
  `! N plans in the old format: run /migrate-plans` (singular "1 plan")
  and `! /skills-audit hasn't run here`.
- `paths` defaults: `plans` `.ssdd/plans`, `specs` `.ssdd/specs`,
  `ledgers` `.ssdd/ledgers`. Prose names the setting: "the plans folder
  (`paths.plans`, default `.ssdd/plans`)".
- `--migrate`, `--migrate-check` and `--next-plan` act on the checkout git
  runs in (`process.cwd()`), never `CLAUDE_PROJECT_DIR`/`SSDD_PROJECT_DIR`
  (Part 1 deviation: the close check's rule). They refuse (exit 2) with no
  `.ssdd/config.json` or a config error.
- The migration never touches a `## Verification` section mechanically,
  never deletes text, and never fetches.
- VERSION stays `2.7.0`; no tag, no push, no PR (owner's go-ahead).
- AC14 runs on a scratch clone of `~/Developer/prizma` at `2712ab0`
  (its `origin/main`); the real prizma is read-only and Hatedate untouched.

## Review Focus

1. **Real prizma shapes the Part 1 parser misses.** `AC8b`/`AC6b`/`AC1b`
   (plans 20, 24, 32) and `[~]` (plan 20) are invisible to `CRITERION`
   today, and Verification entries written `- [ ] **AC1** — …` (plans 08,
   13, 21, 37, 38) to `ENTRY`. A suffix ID must survive migration
   unrenumbered. (Task 1: "suffix IDs and every checkbox parse"; Task 2:
   "keeps AC8b".)
2. **Nested lists and continuation lines.** prizma 23, 37, 39, 40, 43 have
   indented sub-bullets under criteria, and 09's criteria wrap onto
   6-space continuation lines. Only top-level items (the section's minimum
   list indent, outside fences) are criteria; nothing else moves. (Task 2:
   "sub-bullets and continuations untouched".)
3. **The checkbox state is evidence.** `[x]`/`[~]` is the only machine
   signal of which criteria a plan claimed met. Dropping it must carry it
   into the to-do, and `--migrate-check` must re-read it from the base
   ref. (Task 2: "reports ticked IDs"; Task 3: "ticked at base, no entry".)
4. **A second run, and a run over already-migrated plans, changes no
   byte.** (Task 3: "run twice: byte-equal".)
5. **The new view lines don't break the cap.** 40 plans plus both
   onboarding lines still fit 12 lines / 1536 bytes, and the onboarding
   lines survive. (Task 4: "onboarding lines survive the cap".)

## Decisions made in planning

- **`plan-migrate.mjs`, not `plan-parse.mjs`.** The transform is ~100 lines
  with its own tests; `plan-parse` stays the reader. The installer maps every
  `mechanisms/hooks/*.mjs` to `.ssdd/hooks/`, so it ships with no installer
  change.
- **`--migrate-check <ref>` is added.** AC14 says "`git diff --stat` shows
  no Verification line removed", but `--stat` can't tell a reformat from a
  deletion, and the spec lets the agent reformat a Verification line to cite
  its ID. The check strips formatting from every removed line and requires
  its text in the new file. It also re-runs the to-do against the base, so
  the verifier has a floor. Recorded as a deviation in SPEC Part 2.
- **"Old format"** = `migratePlan` would change the criteria, or the plan is
  BUILT/SHIPPED with an ID lacking a Verification entry. Status words
  outside the six already have their own grouped line.
- **Upgrade steps come from the CHANGELOG.** Its header already says
  upgrade steps live there, and VERSION stays 2.7.0 so a "crossed into 3.x"
  test would never fire on a dev commit. `update` prints each crossed
  version's `### Upgrade…` subsection last; for a `+sha` target it also
  counts sections headed `unreleased` (that commit contains them).
- **`paths.specs` is one string.** Hatedate's three spec folders still get
  their references updated: `/migrate-plans` searches the whole repo with
  `git grep`, not only `paths.specs`.
- **`skills-audit.mjs record`** writes `"audited"`, so AC15's write is a
  command, not hand-edited JSON. The script's header changes from
  "read-only" to "read-only except `record`".
- **NOT RECORDED goes only where a plan claims done.** Every ID of a plan
  that ends BUILT/SHIPPED, and in an open plan only IDs that were ticked or
  that the plan says are met. An unticked criterion of open work stays
  without an entry: it isn't done yet.

## File Structure

- Create `mechanisms/hooks/plan-migrate.mjs` + `plan-migrate.selftest.mjs`
- Modify `mechanisms/hooks/plan-parse.mjs` (+ selftest): ID grammar,
  checkboxes, `notRecorded`
- Modify `mechanisms/hooks/work-state.mjs` (+ selftest): view lines, three
  modes
- Modify `mechanisms/hooks/ssdd-config.mjs` (+ selftest): `paths.specs`,
  `skillsAudited`
- Modify `skills/skills-audit/skills-audit.mjs`, `SKILL.md`,
  `mechanisms/skills.example.json` (+ `bin/skills-audit.selftest.mjs`)
- Modify `bin/ssdd.mjs` (+ selftest): onboarding lines, Upgrade sections,
  install dirs from config
- Create `skills/migrate-plans/SKILL.md`
- Modify docs: `process/SDD.md`, `process/templates/*.md`,
  `skills/new-plan/SKILL.md`, `adapters/generic/AGENTS.md`,
  `mechanisms/config.example.json`, `README.md`, `CHANGELOG.md`,
  `SPEC.md`, `docs/BACKLOG.md`

---

### Task 1: The parser reads prizma's real IDs, checkboxes and NOT RECORDED

**Files:**
- Modify: `mechanisms/hooks/plan-parse.mjs:42-63`
- Modify: `mechanisms/hooks/work-state.mjs:296-347` (row counts, `rowLine`)
- Test: `mechanisms/hooks/plan-parse.selftest.mjs`, `work-state.selftest.mjs`

**Interfaces:**
- Produces: `export const AC_ID = 'AC\\d+[a-z]?'` (regex source) and
  `export const CHECKBOX = '\\[[ xX~-]\\]'` from `plan-parse.mjs`.
  `parsePlan(text).entries: Map<id, { deferred: boolean, notRecorded: boolean }>`.
  View rows gain `notRecorded: number`; `verified` excludes deferred and
  not-recorded.

- [ ] **Step 1: Failing tests** in `plan-parse.selftest.mjs`, describe
  `parsePlan`:
  - "suffix IDs and every checkbox parse": criteria `- [~] **AC10 — x.** y`,
    `- [x] AC6b — z`, `- [-] AC2 q` → `criteria` deep-equals
    `['AC10', 'AC6b', 'AC2']`; entry `- [ ] **AC8b** — ok` → `entries.has('AC8b')`.
  - "NOT RECORDED is an entry, flagged": `- **AC3** — NOT RECORDED (migrated 2026-10-18): the plan's Verification didn't close this.`
    → `entries.get('AC3')` deep-equals `{ deferred: false, notRecorded: true }`.
  - "AC1 is not AC10": criterion `- **AC10** — x` → `criteria` is `['AC10']`.
  In `work-state.selftest.mjs`, describe `view`: "open plans show their
  not-recorded count": IN PROGRESS plan, criteria AC1–AC3, entries AC1
  verified and AC2 NOT RECORDED → row matches
  `/AC 1\/3 verified · 1 not recorded/`.
- [ ] **Step 2: Run** `node --test mechanisms/hooks/plan-parse.selftest.mjs mechanisms/hooks/work-state.selftest.mjs` → the four new tests FAIL.
- [ ] **Step 3: Implement.** `CRITERION` and `ENTRY` built from `AC_ID` and
  `CHECKBOX` (`ENTRY` = optional checkbox, then `**` + ID, ending at a
  non-word char). `notRecorded: /\bNOT RECORDED\b/.test(line)`. In
  `collect()`, `verified` filters out `deferred || notRecorded`, add
  `notRecorded` count; `rowLine` adds `${n} not recorded` after the
  deferred count.
- [ ] **Step 4: Run** the same command → all PASS.
- [ ] **Step 5: Commit** `feat(plan-parse): suffix IDs, every checkbox, NOT RECORDED entries`.

### Task 2: `plan-migrate.mjs`, the pure transform

**Files:**
- Create: `mechanisms/hooks/plan-migrate.mjs`
- Test: `mechanisms/hooks/plan-migrate.selftest.mjs`

**Interfaces:**
- Consumes: `AC_ID`, `CHECKBOX`, `parsePlan`, `STATUS_WORDS` from Task 1.
- Produces:
  - `migratePlan(text: string) → { text: string, changed: boolean, changes: string[], ticked: string[], todo: string[] }`.
    `changes`: e.g. `"AC1–AC8: checkbox dropped"`, `"numbered AC1–AC28"`,
    `"numbered AC9–AC10 after the existing IDs"`. `ticked`: IDs whose old
    checkbox was `[x]`, `[X]` or `[~]`. `todo`: see Step 3.
  - `needsMigration(text) → boolean` ("old format", Decisions).
  - `lostText(oldText, newText) → string[]`: removed lines whose stripped
    text isn't in the new file.
  - `idRange(ids: string[]) → string`: `['AC1','AC2','AC3','AC5']` →
    `'AC1–AC3, AC5'`.
  - `todoFor(text, { ticked = [] } = {}) → string[]`.

- [ ] **Step 1: Failing tests**, describe `migratePlan`, each on a fixture
  with `## Acceptance criteria` and a `## Verification` section:
  - "checkbox forms become canonical, numbers kept":
    `- [ ] AC1 text` → `- **AC1** — text`; `- [x] AC2 — text` →
    `- **AC2** — text`; `- [ ] AC3: text` → `- **AC3** — text`;
    `- [x] **AC4 — title.** rest` → `- **AC4** — **title.** rest`;
    `- [ ] **AC5: title** rest` → `- **AC5** — **title** rest`;
    `- [ ] **AC6** — text` → `- **AC6** — text`;
    `- **AC7 — title.** rest` → `- **AC7** — **title.** rest`.
  - "keeps AC8b": `- [x] **AC8b — t.** r` → `- **AC8b** — **t.** r`.
  - "ID-less criteria numbered in order": three `- [ ] x` items under two
    bold group headers → `- **AC1** — x` … `- **AC3** — x`; headers
    unchanged; `changes` includes `numbered AC1–AC3`. Numbered list
    `1. a` / `2. b` → `- **AC1** — a` / `- **AC2** — b`.
  - "mixed plan numbers after the highest": items `AC1`, `AC2b`, ID-less →
    the ID-less one becomes `AC3`; `changes` names
    `numbered AC3 after the existing IDs`.
  - "sub-bullets and continuations untouched": a criterion with 6-space
    continuation lines and 2-space sub-bullets (one starting `AC5's`);
    only the top line changes; a fenced block's `- [ ] x` is untouched.
  - "Verification is never touched": its `- [ ] **AC1** — ok` and
    `- AC2 ✅ — ok` lines byte-equal after.
  - "reports ticked IDs": `[x] AC1`, `[ ] AC2`, `[~] AC3` → `ticked`
    deep-equals `['AC1', 'AC3']`.
  - "idempotent": `migratePlan(migratePlan(t).text)` → `changed: false`,
    text byte-equal.
  - "duplicate IDs are reported, not renumbered": two `- [ ] AC2` items →
    both become `- **AC2** — …`; `todo` contains `duplicate criterion IDs: AC2`.
  - "CRLF and BOM": a CRLF plan migrates and keeps its CRLF endings.
  Describe `todoFor`:
  - "status outside the six": `**Status:** DONE — 2026-09-11` → an item
    starting `Status "DONE — 2026-09-11" isn't one of the six`.
  - "a closed plan needs every entry": SHIPPED, AC1–AC3, entry AC1 →
    `no Verification entry: AC2–AC3`.
  - "an open plan needs entries only where it claims done": IN PROGRESS,
    AC1–AC3, no entries, ticked `['AC2']` → `no Verification entry: AC2`
    (ticked), and nothing for AC1/AC3.
  - "unparsed entries are named": Verification `- AC1 ✅ — ok` and
    `- **AC2-AC3 (both)** ok` → an item naming `AC1, AC2-AC3` and the form
    `- **AC1** — …`.
  Describe `needsMigration`: true for a checkbox criterion; true for SHIPPED
  with a missing entry; false for a canonical SHIPPED plan with all
  entries; false for a DRAFT with an empty criteria section.
  Describe `lostText`: a reformatted criterion and a reformatted entry
  (`- AC1 ✅ — npm test → ok` → `- **AC1** ✅ — npm test → ok`) lose
  nothing; a status rewritten as
  `**Status:** SHIPPED — migrated 2026-10-18; was: DONE — 2026-09-11` loses
  nothing; a split range (`- AC1-AC2 ✅ x` → two lines each ending `x`)
  loses nothing; a deleted Verification line is returned.
- [ ] **Step 2: Run** `node --test mechanisms/hooks/plan-migrate.selftest.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** `plan-migrate.mjs`. Rules the tests don't fully
  pin:
  - Sections are found like `plan-parse` (`## ` name starting `acceptance
    criteria` / `verification`); fenced blocks (```` ``` ````/`~~~`) are
    skipped; a top-level item is a list line (`-`, `*`, `N.`/`N)`) at the
    section's minimum list indent.
  - The head of an item, after the checkbox, is matched in this order:
    `**<ID> — title**` / `**<ID>: title**` (bold wraps ID and title) →
    `**<ID>** — **title**`; `**<ID>**` then an optional `—`/`:`/`.`; bare
    `<ID>` then an optional `—`/`:`/`.`. The rest is kept byte for byte.
    The marker becomes `- `, the indent stays.
  - `todoFor` items, in order: status; duplicates; missing entries
    (closed: all IDs; else ticked IDs); unparsed entry lines (a
    Verification list line whose head, after an optional checkbox and
    `**`, is an ID but `ENTRY` doesn't match); for an ID-less item that
    was numbered, `"criteria were unnumbered: references like 'criterion 3' may need the ID"`.
  - `lostText` strips, per line: leading space and `>`, the list marker,
    the checkbox, every `**`, a leading `Status:`, leading ID tokens with
    `–`/`-`/`/`/`,`/`&` between them, `✅❌☐`, a leading `—`/`:`/`.`, then
    collapses whitespace. A line is removed when its count drops between
    old and new; it is lost when its stripped text is non-empty and not a
    substring of the new file's stripped lines joined by one space.
- [ ] **Step 4: Run** → PASS. Then `node --test mechanisms/hooks/*.selftest.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(plan-migrate): the mechanical v3 plan migration, pure`.

### Task 3: `--migrate` and `--migrate-check <ref>`

**Files:**
- Modify: `mechanisms/hooks/work-state.mjs` (new "the migration" section, `main`)
- Test: `mechanisms/hooks/work-state.selftest.mjs`

**Interfaces:**
- Consumes: `migratePlan`, `todoFor`, `lostText`, `idRange` (Task 2);
  `diskFiles`, `catBatch`, `shaMap` (existing).
- Produces: CLI modes. `--migrate`: exit 0, stdout
  `SSDD migrate · <paths.plans> · <N> plans`, one line per plan
  (`  <file>: <changes joined by '; '>` or `  <file>: unchanged`), each
  to-do on `    to do: <item>`, last line
  `<C> changed, <U> unchanged. Next: the agent pass in /migrate-plans.`
  `--migrate-check <ref>`: per changed plan, `lost:`, `to do:` and
  `not recorded:` lines; last line `migrate-check: ok` (exit 0) or
  `migrate-check: <n> problems` (exit 1); no ref or a bad one → exit 2.

- [ ] **Step 1: Failing tests**, describe `migrate`:
  - "rewrites fixture plans and prints the to-do": three plans (prizma-like
    `- [x] **AC1 — t.** r`; ID-less `- [ ] x` ×2; canonical) →
    files rewritten, stdout matches `/01-a\.md: AC1: checkbox dropped/`,
    `/02-b\.md: numbered AC1–AC2/`, `/03-c\.md: unchanged/`,
    `/2 changed, 1 unchanged/`, and a `to do:` line for 01's ticked AC1.
  - "run twice: byte-equal": snapshot every plan's bytes after run 1; run 2
    exits 0, prints `0 changed, 3 unchanged`, bytes equal.
  - "paths.plans honored": config `{"paths":{"plans":".claude/plans"}}`,
    plan there → rewritten.
  - "acts on the cwd, refuses without config": `CLAUDE_PROJECT_DIR` set to
    another repo → the cwd's plan is the one rewritten; no config → exit 2;
    `{ not json` → exit 2, stderr names the config error, file untouched.
  Describe `migrate-check`:
  - "a pure reformat passes": commit old plans, run `--migrate`, then
    `--migrate-check HEAD` on a closed plan whose entries are all present →
    exit 0, `migrate-check: ok`.
  - "a deleted Verification line fails": delete one entry line → exit 1,
    stdout has `lost:` with that line's text.
  - "ticked at base, no entry": base has `- [x] AC2 …` in an IN PROGRESS
    plan, no entry after migrating → `to do: no Verification entry: AC2`, exit 1.
  - "lists NOT RECORDED entries": add one → `not recorded: AC3` under that
    plan, exit 0 when nothing else is wrong.
  - "bad ref exits 2".
- [ ] **Step 2: Run** `node --test mechanisms/hooks/work-state.selftest.mjs` → new tests FAIL.
- [ ] **Step 3: Implement.** `--migrate` reads `paths.plans` on disk
  (`diskFiles`), writes only changed files, prints the report from
  `migratePlan`. `--migrate-check <ref>` lists the plans in `<ref>`
  (`ls-tree` + one `catBatch`), compares each with disk: `lostText`,
  `todoFor(new, { ticked: migratePlan(old).ticked })`, criteria still
  needing migration (`migratePlan(new).changed` → `to do: criteria still in the old format`),
  NOT RECORDED IDs from `parsePlan(new)`. A plan missing on disk is a
  problem. Problems = lost lines + to-do items.
- [ ] **Step 4: Run** → PASS; full hooks suite PASS.
- [ ] **Step 5: Commit** `feat(work-state): --migrate and --migrate-check`.

### Task 4: The view's onboarding lines

**Files:**
- Modify: `mechanisms/hooks/ssdd-config.mjs` (export `skillsAudited`)
- Modify: `mechanisms/hooks/work-state.mjs` (`collect`)
- Test: `ssdd-config.selftest.mjs`, `work-state.selftest.mjs`

**Interfaces:**
- Produces: `skillsAudited(root: string) → string | null` (the `audited`
  value when `.ssdd/skills.json` is a JSON object with a non-empty string
  `audited`, else null; never throws). `collect(repo).onboarding: string[]`
  — the onboarding lines without `! `, also appended to `warnings` with it.

- [ ] **Step 1: Failing tests.** `ssdd-config.selftest.mjs`: "skillsAudited
  reads the date, null otherwise" (absent file, `{ not json`, `[]`,
  `{"audited":""}` → null; `{"audited":"2026-10-18"}` → `'2026-10-18'`).
  `work-state.selftest.mjs`: the `beforeEach` fixture gains
  `.ssdd/skills.json` `{"version":1,"sources":{},"audited":"2026-10-18"}`,
  so existing outputs don't change. New, describe `onboarding`:
  - "old-format plans are counted": two committed checkbox plans, one
    canonical → `! 2 plans in the old format: run /migrate-plans`; one →
    `! 1 plan in the old format…`; none → no such line.
  - "a SHIPPED plan with a missing entry counts".
  - "skills-audit reminder until audited": remove `audited` →
    `! /skills-audit hasn't run here`; set it → gone.
  - Describe `session start`: "onboarding lines survive the cap": 40
    checkbox plans, no `audited` → ≤ 12 lines, ≤ 1536 bytes, both lines
    present.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In `collect`'s plan loop, before the status
  `continue`s, count `needsMigration(home.files.get(plan))`. After the
  duplicate-number warnings, append the two lines when due.
- [ ] **Step 4: Run** → PASS; full hooks suite PASS.
- [ ] **Step 5: Commit** `feat(work-state): onboarding lines for the migration and /skills-audit`.

### Task 5: `/skills-audit` records its runs

**Files:**
- Modify: `skills/skills-audit/skills-audit.mjs` (header, `record`)
- Modify: `skills/skills-audit/SKILL.md` (new final step), `mechanisms/skills.example.json` (`$comment`)
- Test: `bin/skills-audit.selftest.mjs`

**Interfaces:**
- Produces: `node .agents/skills/skills-audit/skills-audit.mjs record` →
  sets `audited` to today (`YYYY-MM-DD`, local date) in `.ssdd/skills.json`
  (cwd), creating `{"version":1,"sources":{}}` first when missing; keeps
  every other key; 2-space JSON + newline; prints
  `recorded: audited <date> in .ssdd/skills.json`. An unreadable ledger →
  exit 1, unchanged.

- [ ] **Step 1: Failing tests**, describe `record`: "creates the ledger
  and sets audited" (no file → `version` 1, `sources` `{}`, `audited`
  matches `/^\d{4}-\d{2}-\d{2}$/`); "keeps sources and overwrites an older
  date"; "refuses an unreadable ledger" (`{ not json` → exit 1, file
  byte-equal). Describe `SKILL.md`: "the last step records the run, even
  an empty one" — text matches `/skills-audit\.mjs record/` and
  `/even (one|a run) that (matched|found) nothing/`.
- [ ] **Step 2: Run** `node --test bin/skills-audit.selftest.mjs` → FAIL.
- [ ] **Step 3: Implement** `record`; add SKILL.md step 7 "Record the
  run" (after step 6; also reached when step 1 finds no candidates or the
  user approves nothing); the example's `$comment` names `audited`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(skills-audit): record each run as "audited"`.

### Task 6: `update` and `status`: Upgrade steps and onboarding lines

**Files:**
- Modify: `bin/ssdd.mjs` (`changelogBetween`, new `upgradeSteps`, `update`, `status`)
- Test: `bin/ssdd.selftest.mjs`

**Interfaces:**
- Consumes: `collect` from `work-state.mjs` (its `onboarding`).
- Produces: `update` ends with
  `── Upgrade steps (manual), from the CHANGELOG:` then per version
  `v<x.y.z>:` and that version's `### Upgrade…` subsection body, then
  `onboarding: <line>` per onboarding line. `status` prints
  `onboarding: <line>` after the gate warnings.

- [ ] **Step 1: Failing tests**, new describe `upgrade steps and onboarding`
  with a helper that adds a v3.0.0 release whose CHANGELOG has
  `## [3.0.0]` with `### Upgrade` → `- Run /migrate-plans once.`:
  - "update across 3.0.0 prints its Upgrade section": install v2.0.0,
    update → output matches `/Upgrade steps \(manual\)[\s\S]*v3\.0\.0:[\s\S]*Run \/migrate-plans once/`.
  - "an update within a version prints no Upgrade block".
  - "a +sha target counts an unreleased section": source VERSION `2.0.0`
    plus CHANGELOG `## [3.0.0] — unreleased` with an Upgrade section, an
    untagged commit, `update --to <sha>` → the block includes it.
  - "status and update print the onboarding lines": target with
    `.ssdd/plans/01-a.md` in the old format, no `audited` → both outputs
    match `/onboarding: 1 plan in the old format: run \/migrate-plans/` and
    `/onboarding: \/skills-audit hasn't run here/`; after
    `audited` is set and the plan is canonical → neither line.
- [ ] **Step 2: Run** `node --test bin/ssdd.selftest.mjs` → FAIL.
- [ ] **Step 3: Implement.** `changelogBetween` keeps its range and adds
  sections whose heading contains `unreleased` when `to` contains `+`.
  `upgradeSteps` extracts `### Upgrade…` bodies (to the next `##`/`###`)
  from the same sections. Onboarding via `collect(target)` in a
  `try/catch` (no lines on error or no config).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ssdd): update prints Upgrade steps; update and status print onboarding lines`.

### Task 7: `paths` everywhere

**Files:**
- Modify: `mechanisms/hooks/ssdd-config.mjs` (`DEFAULT_PATHS.specs`),
  `mechanisms/config.example.json`
- Modify: `mechanisms/hooks/work-state.mjs` (`--next-plan`)
- Modify: `bin/ssdd.mjs:308` (dirs from the config)
- Modify: `process/SDD.md`, `process/templates/task-ledger-template.md`,
  `process/templates/handover-template.md`, `skills/new-plan/SKILL.md`,
  `adapters/generic/AGENTS.md`
- Test: `ssdd-config.selftest.mjs`, `work-state.selftest.mjs`, `bin/ssdd.selftest.mjs`

**Interfaces:**
- Produces: `DEFAULT_PATHS = { plans, specs, ledgers }`.
  `--next-plan` prints `next plan: <paths.plans>/<NN>-<slug>.md` (NN = the
  highest number found + 1, at least 2 digits) and one
  `stray in <paths.plans>: <name> (not NN-*.md)` per stray file. Numbers
  come from every worktree's plans folder on disk and
  `git log --all --name-only --format= -- <paths.plans>`.

- [ ] **Step 1: Failing tests.** `ssdd-config`: "paths default…" expects
  `specs: '.ssdd/specs'`; "paths are read and normalized" covers
  `specs: './docs/specs/'` → `docs/specs`. `work-state`, describe
  `next plan`: "reads paths.plans and counts other branches": config
  `.claude/plans`, plans `03-a` on main and `07-b` only on branch `x`,
  `notes.md` on disk → `next plan: .claude/plans/08-<slug>.md` and
  `stray in .claude/plans: notes.md`; default config, no plans → `01`.
  `bin/ssdd`: "install creates the folders the config names" (pre-seeded
  config with `paths.plans` `.claude/plans` → that dir exists after
  install); "docs name the paths setting": every line under
  `process/`, `skills/`, `adapters/` (read from this repo's tree) that
  contains `.ssdd/plans`, `.ssdd/specs` or `.ssdd/ledgers` also contains
  `default`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the code, then the docs: SDD.md gains a
  "Folders" paragraph naming the three settings with their defaults, and
  §1–§3 and Handover say `<specs>/…`, `<plans>/…`, `<ledgers>/…`;
  templates and AGENTS.md say "the plans folder (`paths.plans`, default
  `.ssdd/plans`)"; new-plan's description and steps use the folder name
  and step 1 becomes `node .ssdd/hooks/work-state.mjs --next-plan`
  (`git fetch` first) with its strays line replacing the old step 2's
  check; `config.example.json` gains `"specs": ".ssdd/specs"`.
- [ ] **Step 4: Run** → PASS; `git grep -n "\.ssdd/plans" -- process skills adapters` → only lines with "default".
- [ ] **Step 5: Commit** `feat(paths): paths.specs, --next-plan, and docs that name the setting`.

### Task 8: `/migrate-plans` and the release notes

**Files:**
- Create: `skills/migrate-plans/SKILL.md`
- Modify: `CHANGELOG.md` (3.0.0 unreleased: Added, Upgrade), `README.md`,
  `docs/BACKLOG.md`, `SPEC.md` (Part 2's plan link)
- Test: `bin/ssdd.selftest.mjs` (skill text and the real CHANGELOG)

- [ ] **Step 1: Failing tests**, describe `migrate-plans skill`:
  - "frontmatter": `name: migrate-plans`; description ≤ 300 chars, no
    `": "`, and says it runs once (`/once/`).
  - "names the procedure": text has `--migrate`, `--migrate-check HEAD`,
    `NOT RECORDED (migrated`, `refute-by-default`, `one commit`,
    `paths.plans`, `paths.specs`, `paths.ledgers`, `git grep`.
  - "the real CHANGELOG's 3.0.0 Upgrade section names both steps":
    `upgradeSteps`-style extraction of `CHANGELOG.md` → matches
    `/\/migrate-plans/` and `/SessionStart/`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the skill.** Steps:
  1. Preconditions: a clean tree on a branch; never in a repo the user
     didn't name.
  2. `node .ssdd/hooks/work-state.mjs --migrate`, saving its output to the
     scratchpad (the ticked IDs are in it, and the next run won't have
     them).
  3. The agent pass, per plan (fan out per batch of plans when there are
     many, each agent given the rules and its plans' report lines):
     - **Status:** one of the six, checked against git (`git log
       --oneline <default> -- <plan>`, the commits/PRs the plan names,
       `git branch -a --contains`): merged and nothing left → SHIPPED;
       merged with operator steps or DEFERRED left → BUILT; not merged →
       IN PROGRESS; replaced → SUPERSEDED; dropped → ABANDONED. Pick the
       least-done word the evidence supports. Write
       `**Status:** <WORD> — migrated <date>; was: <old text verbatim>`.
     - **Entries:** reformat a Verification line that already cites an ID
       to `- **ACn** — …`, keeping its text; split `AC1–AC3`/`AC1/AC2`
       into one line per ID, each keeping the text; for prose that closes
       a criterion without citing it, add `- **ACn** — see above: <the
       evidence's first words>`; never move or delete a line.
     - **NOT RECORDED:** for each ID the plan claims done (every ID once
       it's BUILT/SHIPPED; ticked or "met" ones when open) with no
       matching evidence, add the exact NOT RECORDED line. Never write
       evidence the plan doesn't have.
     - **References:** `git grep -n` the whole repo's markdown (ledgers in
       `paths.ledgers` and `.superpowers/sdd`, specs in `paths.specs`,
       handovers, other plans) for "criterion 3", "plan 09's fourth check"
       and the like; add the ID beside it. Commit messages and memory
       outside the repo are out of reach.
  4. A second agent, refute-by-default (SDD.md §4, "Findings are
     records"), checks each plan's mapping and Status against
     `git show HEAD:<plan>` and git; a mapping stands only when the old
     text demonstrably supports it. Fix what it refutes.
  5. `node .ssdd/hooks/work-state.mjs --migrate-check HEAD` must end
     `migrate-check: ok`.
  6. One commit, staged by path, whose message lists every NOT RECORDED
     entry (plan file + ID) from step 5's output.
  7. `node .ssdd/hooks/work-state.mjs` shows no old-format or
     unknown-status line.
  CHANGELOG 3.0.0: an Added entry for the migration, onboarding lines,
  `record`, `paths.specs`, `--next-plan`, the parser's suffix IDs; the
  `### Upgrade` section gains "Run `/migrate-plans` once" before the
  SessionStart line. README: the migration under the v3 section. BACKLOG:
  Part 2's line. SPEC.md: Part 2's plan link in the v3 table.
- [ ] **Step 4: Run** `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(skills): /migrate-plans; CHANGELOG, README, SPEC`.

### Task 9: Verification against the spec

**Files:**
- Modify: `SPEC.md` (Part 2 `### Verification`, `### Deviations & discoveries`, status line)

- [ ] **Step 1: AC13** — `node --test mechanisms/hooks/plan-migrate.selftest.mjs mechanisms/hooks/work-state.selftest.mjs`, record the named cases.
- [ ] **Step 2: AC14** — scratch clone:
  `git clone -q ~/Developer/prizma <scratch>/prizma && git -C <scratch>/prizma checkout -q -B main 2712ab0 && git -C <scratch>/prizma update-ref refs/remotes/origin/main 2712ab0`.
  prizma is v1.0.1, so run this worktree's scripts by path. Run
  `/migrate-plans` there (the agent pass fanned out, then the verifier),
  then record: every plan's IDs and Status (one script over the plans);
  `--migrate-check HEAD~1` ok; the commit message's NOT RECORDED list
  against the check's; 5 plans checked by hand (01, 09, 24, 32, 40); the
  view's lines. A plan with no criteria (02, a DRAFT) is recorded as such,
  not given invented ones. `git -C ~/Developer/prizma status` unchanged.
- [ ] **Step 3: AC15** — a scratch repo installed from this branch (`install
  … --ref HEAD`): `status`, `update --to HEAD` and the view each print
  the reminder; `skills-audit.mjs` finds nothing; `record`; all three
  quiet.
- [ ] **Step 4: AC16** — the `next plan` selftest and the `git grep` run.
- [ ] **Step 5:** full suite; write Verification and Deviations; commit
  `docs(spec): v3 Part 2 verification`.

Then the final whole-branch review by a fresh reviewer; Critical and
Important findings fixed test-first, one commit each, ledgered.
