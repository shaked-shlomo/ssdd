---
name: cleanup
description: Reviews existing code and proposes a cleanup plan for a file, folder, branch or PR ("review this", "clean this up", "review PR #N"). Runs /code-review itself, adds the routed SSDD reviewers, merges the findings, and changes nothing until approved.
---

Nothing changes until the user approves the plan, unless they already ordered
review-then-act. A clean file gets "looks clean", not padding.

Arguments: a target (file, directory, branch, `PR #N`), an effort, `--comment`. They
go to the harness's review as given.

## 1. Scope

- File → that file. Directory or feature → its files and the page or route that
  composes them.
- PR → `gh pr diff N` and `gh pr checks N`, with the branch in a scratch worktree.
  Link the main checkout's dependencies (`node_modules`) into it rather than
  installing, and copy no env file in: a build there runs against whatever it names.
- Branch, or nothing given → `git diff main...HEAD --name-only`; if empty, ask.

The scope is a range or a file list. Every agent gets it and the worktree path:
subagents start in the main checkout, and a reviewer given no input answers
`NO DIFF — scope not provided`. Start the project's checks in the background now.

## 2. The harness's review

Claude Code: `/code-review <target> <effort>`, plus `--comment` if given; it verifies
its own findings. Cursor: its bug-review skill, skipping any step that checks out or
stashes in the user's checkout. Neither → say so; don't imitate one. Its findings
are the known list.

## 3. SSDD's reviewers

In parallel, the reviewers `.ssdd/config.json` routes for the scope, plus
`docs-sync-reviewer` when the scope has docs or config no route covers (the commit
gate lets those through unreviewed). Each gets the scope, the worktree and the known
list, marked "don't re-report". MCP output a reviewer needs comes from the main
session. An agent type that isn't registered → a general-purpose agent told to read
`.ssdd/reviewers/<name>.md` and adopt it.

Every dispatched agent is read-only: no edits, commits, stamps or `git stash` (a pop
silently unstages). A throwaway server only on a free port, killed by its own PID,
never `pkill -f`.

## 4. One plan

Check each SSDD reviewer's finding against the cited file and drop what the code
refutes; a claim about data is checked against the data. Dedupe against the known
list by file and mechanism, keeping the more concrete failure. Lead with the checks
and CI, then findings by file, each tagged `harness` or `ssdd`, plus Documentation Map
gaps. If the session has `ReportFindings` and the harness's review didn't call it,
call it once with the merged list. Nothing worth fixing → say so and stop. Otherwise
ask which items to apply.

## 5. After approval

Apply only the approved items and rerun the checks; if `ReportFindings` was used, call
it again with each item's outcome. The fix is a staged change no reviewer has seen:
commit it through the review gate (`.ssdd/process/SDD.md` §4). Re-check
`git status --short` before a commit that follows agent activity.

<!-- Project-specific "what to look for" (design-system primitives, stack conventions,
sanctioned exceptions) goes in a section here. -->
