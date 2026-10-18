# Handover — <title>

Written <YYYY-MM-DD> at `<commit>` (<branch / after PR #_ merged>). Paste this
whole file as the opening prompt of a fresh session. Everything below was
verified against that commit; re-verify line numbers before citing them.

---

You are picking up <what> in <project>. Read the project instructions file and
`.ssdd/process/SDD.md` first. This is <a spec → plan piece of work | a plan's
next task | a drive-by fix>, because <why>. <Use a git worktree if the checkout
is shared.> The next free numbers are spec `NN` and plan `NN` — check
the specs folder (`paths.specs` in `.ssdd/config.json`, default `.ssdd/specs`),
the plans folder (`paths.plans`, default `.ssdd/plans`) and open branches
before taking them; `node .ssdd/hooks/work-state.mjs --next-plan` gives the
plan number.

## The problem

<What is wrong or wanted, with file:line evidence for every claim. Separate
what is measured from what is inferred.>

## What is decided

<Owner rulings and constraints already settled — with where they were made.>

## What is open

<The questions this session must answer (from a source, or by asking).>

## Out of scope

<Adjacent work NOT to do here, and where it is tracked.>

## Done looks like

<The acceptance criteria as far as they are known, or "write them in the
plan's clarify pass".>
