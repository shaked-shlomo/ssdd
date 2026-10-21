---
name: new-plan
description: Creates the next numbered SSDD plan from the template, or syncs a finished one back. Use when a plan is approved (e.g. leaving plan mode), when starting numbered work, or for "sync the plan".
---

# New plan / plan sync

The plans folder is `paths.plans` in `.ssdd/config.json` (default `.ssdd/plans`);
the ledgers folder is `paths.ledgers` (default `.ssdd/ledgers`). What a plan
holds, and why: `.ssdd/process/SDD.md` §2.

## Creating

1. `git fetch`, then `node .ssdd/hooks/work-state.mjs --next-plan`. It prints
   `next plan: <plans>/NN-<slug>.md` across every worktree and ref. A
   `stray in <plans>` line names a file that isn't `NN-*.md`: point it out.
2. Write the plan from `.ssdd/process/templates/plan-template.md`: the clarify
   pass, then the acceptance criteria (`- **AC<n>** — …`), before any code.
3. A multi-task plan gets `<ledgers>/NN-<slug>-ledger.md` from
   `.ssdd/process/templates/task-ledger-template.md`.
4. Stage the plan with the work's first commit (the pre-commit hook blocks on
   untracked files).

## Syncing back

Status, Verification and Deviations as SDD.md §6–7 say. A plan changed in the
harness's plan UI mid-flight is mirrored here in the same commit as the code
it drove.
