---
name: cleanup
description: >-
  Reviews existing code and proposes a cleanup plan: a pre-merge review, an audit of a file,
  folder, branch or open PR ("review this", "clean this up", "review PR #N"). Runs the harness's
  code review, then the SSDD reviewers, verifies their findings, and changes nothing until approved.
---

Review code for real problems and present a cleanup plan. A clean file gets "looks clean",
not padding. Change nothing until the user approves the plan — unless the user already
ordered a review-then-act workflow, or passed `--fix`.

Arguments: a target (file, directory, branch, `PR #N`), optional effort (`low` / `medium` /
`high`, default `medium`), `--fix` (apply every confirmed item), `--comment` (post findings
as inline PR comments).

## 1. Scope → one review input

- File → that file. Directory/feature → its files plus the page/route that composes them.
- PR → `gh pr diff N` and `gh pr checks N`; check the branch out in a scratch worktree so
  reviewers read real files and checks run against the branch.
- Branch or nothing given → `git diff main...HEAD --name-only`; if empty, ask.

Every scope resolves to **a range** or **a file list**, and every agent is told which.
Reviewers default to `git diff --staged`; on a PR nothing is staged, so a reviewer not handed
its input has nothing to review (it answers `NO DIFF — scope not provided`; don't stamp that).

Start the project's check/lint commands in the background now; fold results into the plan.

## 2. Find

Small scope (≤5 files, no diff): check it yourself, tag items `direct`.

Otherwise two passes, in order:

1. **Generic pass** — the harness's own code-review tool on the same target (Claude Code:
   the `code-review` skill/plugin; Cursor: its bug-review skill). If none is available, say
   so and skip it; don't imitate it. Its confirmed items are the **known list**.
2. **Domain pass** — dispatch the reviewers `.ssdd/config.json` routes for the changed
   paths, in parallel. Each prompt names the review input, the worktree to run in, and the
   known list ("do not re-report"). If a reviewer's agent type isn't registered, spawn a
   general-purpose agent told to read `.ssdd/reviewers/<name>.md` and adopt it.

Every dispatched agent is read-only: no edits, commits, stamping, or `git stash`; a
throwaway server only on a free port, killed by its own PID.

## 3. Verify the domain pass

For each domain finding that doesn't quote the line and a concrete trigger, dispatch a
verifier with the diff, the file and the claim; it returns **CONFIRMED** (inputs → wrong
output, quoting the line), **PLAUSIBLE** (mechanism real, trigger uncertain), or
**REFUTED** (quoting the proving line). Drop REFUTED; dedup against the known list by file
and mechanism.

## 4. Plan

Lead with check/lint and CI state, then findings grouped by file, each with its verdict and
source pass (`generic` / `domain` / `direct`). Include doc-coupling gaps per the
Documentation Map. If nothing is worth fixing, say so and stop. Otherwise end with:
"Apply all of these, or pick specific items?"

## 5. Execute (after approval)

Apply only approved items, then rerun the checks. Phase 2 earns no stamps: the staged
change is now the fix, which no reviewer has seen. Commit through the review gate as
SDD.md §4 describes.

<!-- Project-specific "what to look for" (design-system primitives, stack conventions,
sanctioned exceptions) goes in a section here. -->
