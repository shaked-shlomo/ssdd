---
name: new-plan
description: Creates the next numbered SSDD plan in .ssdd/plans/ from the template, or syncs a finished one back. Use when a plan is approved (e.g. leaving plan mode), when starting numbered work, or when the user says "sync the plan".
---

# New plan / plan sync

Plans are the repo's cross-session record: one file per plan,
`.ssdd/plans/NN-kebab-slug.md`. The harness's plan UI (if any) is where a plan
is approved; this skill writes it to the repo and keeps it in sync. What a
plan must contain, and why, is `.ssdd/process/SDD.md` §2.

## Creating

1. **Number** = highest existing `NN-` + 1, counting open branches too
   (`git fetch` first):
   `{ ls .ssdd/plans/; git log --all --name-only --format= -- .ssdd/plans/; } | sed 's|.*/||' | grep -oE '^[0-9]+' | sort -n | tail -1`
   Never reuse, skip or backfill a number.
2. **Strays:** a file in `.ssdd/plans/` that isn't `NN-*.md` breaks the
   convention. Point it out (number it or fold it in); don't add more.
3. **Write** `.ssdd/plans/NN-<slug>.md` from
   `.ssdd/process/templates/plan-template.md`: run the clarify pass (SDD.md §2),
   then write the acceptance criteria, each with an `AC<n>` ID, before any code.
4. For a multi-task plan, start the ledger from
   `.ssdd/process/templates/task-ledger-template.md`.
5. Stage the plan with the work's first commit (the pre-commit hook blocks on
   untracked files).

## Syncing back

- **Status:** BUILT / SHIPPED (PR #) / SUPERSEDED / ABANDONED, with the date.
- **Verification:** one entry per AC ID (`- **AC1** — <command> → <output>`,
  or `DEFERRED (operator): <what's left>`). The pre-commit close check refuses
  BUILT or SHIPPED while an ID has no entry or the plan's ledger isn't staged.
- **Deviations & discoveries:** record what changed and why, and promote the
  gotchas (SDD.md §7).
- If the plan changed in the harness's plan UI mid-flight, mirror that here
  in the same commit as the code it drove. Coupled docs keep their own
  same-commit rules.
