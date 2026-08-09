# Plan NN — <title> — task ledger

Plan: `.ssdd/plans/NN-<slug>.md`
Spec: `.ssdd/specs/NN-<slug>-spec.md`
Branch: `<branch>`. Started <YYYY-MM-DD>. BASE commit `<hash>`.

<If parts are operator-gated (credentials, deploy access), say so up front and
name the BUILD-then-DEFER boundary: which tasks build+test without them, what
the operator runs at deploy.>

## Tasks

<One line per task. The format carries: commits, review verdicts, test counts,
and TRIAGED findings — severity, what was fixed (with commit), what was
deferred (with a home). Never a bare "done".>

- [ ] Task 1 — <name> ✓ (commit `<hash>`, spec ✅, quality ✅, <N/N> tests).
      Fixed Important: <finding> (`<fix-hash>`). MINOR (deferred → final-review):
      <finding + why it can wait>.
- [ ] Task 2 — …

## Final whole-plan review

<One review pass over the plan's ENTIRE diff after the last task. Findings +
fix commits + independent re-verification. This pass exists because cross-task
integration bugs hide in the seams between per-task reviews.>

## Follow-ups

<Every deferred Minor lands here with a disposition: fixed this session /
spawned as its own task / recorded in the requirements checklist. Nothing is
silently dropped.>

## Operator-gated deploy steps

<If any: the exact ordered checklist the operator runs (secrets to set,
functions to deploy, migrations to apply), kept until executed.>
