# Plan NN — <title> — task ledger

Plan: `<plans>/NN-<slug>.md` (the plans folder: `paths.plans`, default `.ssdd/plans`)
Spec: `<specs>/NN-<slug>-spec.md` (the specs folder: `paths.specs`, default `.ssdd/specs`)
Branch: `<branch>`. Started <YYYY-MM-DD>. BASE commit `<hash>`.
Execution: <inline | subagent-driven>; per task <who reviews: spec+quality
reviewer, plus every reviewer the gate names>.

<If parts are operator-gated (credentials, deploy access), say so up front and
name the BUILD-then-DEFER boundary: which tasks build+test without them, what
the operator runs at deploy.>

## Tasks

<One line per task: commits, review verdicts, test count, fixes with their
commit. Detail goes in the commit message. Tick a row when its task is done:
the work-state view reads the first unticked `Task` row as what's next. Work
run by Superpowers keeps its ledger in `.superpowers/sdd/<plan>/progress.md`
instead, and git tracks it.>

- [x] Task 1 — <name> (`<hash>`; spec ✅ quality ✅; <N/N> tests; fixed <finding> `<fix-hash>`)
- [ ] Task 2 — …
- [ ] — PR 1 ships; <operator-gated criterion, e.g. a ≥24 h production measurement> —
- [ ] Task 3 — … *(a milestone row like the one above splits a plan into releases)*

## Rulings

<Owner decisions made mid-execution that change or settle the plan: numbered,
dated, one line each. A finding declined as out of scope needs no ruling.>

## Final whole-plan review

<One pass over the plan's whole diff after the last task: findings, fix
commits, and the refute-by-default re-check of each fix.>

## Follow-ups

<One line per deferred Minor with its home: fixed this session / its own task /
the requirements checklist. Nothing is silently dropped.>

## Operator-gated deploy steps

<If any: the exact ordered checklist the operator runs (secrets to set,
functions to deploy, migrations to apply), kept until executed.>
