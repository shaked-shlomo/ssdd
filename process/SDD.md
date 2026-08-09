# The SSDD process

One lifecycle for every non-trivial piece of work. "Non-trivial" = anything
whose scope you couldn't state, verify, and revert in a single sitting; a
one-line fix doesn't need a plan, a new feature or subsystem always does.

```
brainstorm ──▶ spec ──▶ plan (clarify pass, criteria first) ──▶ task ledger
                                                                    │
                    ┌─── per task: implement → review gate → commit ┘
                    ▼
     final whole-plan review ──▶ verification (against criteria) ──▶ sync back
```

## 0. Brainstorm

Dialogue before design. Understand purpose, constraints, and success criteria;
propose 2–3 approaches with trade-offs; converge on one. For work spanning
multiple independent subsystems, decompose first — each sub-project gets its
own spec → plan → implementation cycle.

## 1. Spec (`.ssdd/specs/NN-<slug>-spec.md`)

The validated design, written **before** the plan, from
[templates/spec-template.md](templates/spec-template.md). The load-bearing
section is **Scope: In / Out** — the Out list ("deferred", with a reason) is
what keeps plans shippable. Specs record *decisions* ("chosen over X to avoid
Y"), not just outcomes.

Small work may skip the spec and go straight to a plan; never skip the plan.

## 2. Plan (`.ssdd/plans/NN-<slug>.md`)

One numbered markdown file per plan, `NN-kebab-slug.md`. Next number = highest
existing `NN-` prefix + 1 (check with a command, not memory). Never reuse,
skip, or backfill numbers; never add unnumbered files to the plans directory.

**The clarify pass — interrogate the plan BEFORE criteria are written.** List
every assumption the approved design makes: UX behavior (empty/error/loading
states), design coverage (a mock for every state? motion/interaction specified,
not guessed?), data (schema/authorization/query shape), platform differences,
permission and monetization gates, edge cases (offline, degraded, suspended
user, free-vs-paid). For each: **resolve it from a source** (the design file,
the schema, the code — never assume, verify first) **or ask the user**. An
unresolved assumption must NOT silently become an acceptance criterion — park
it in `## Open questions`. **The plan stays DRAFT while any remain.**

**Acceptance criteria are written now, before implementation.** They define
"done"; Verification later closes against them, not against vibes. Each
criterion must be checkable by a command, a test, or a concrete observation.

Template: [templates/plan-template.md](templates/plan-template.md).

## 3. Task ledger (`.ssdd/ledgers/NN-<slug>-ledger.md`)

For multi-task plans, the ledger is the cross-session execution record — one
checkbox line per task carrying: the commit hash(es), spec-compliance ✅,
quality-review ✅, test counts, and **triaged findings** (Critical/Important
fixed inline with the fix commit; Minor recorded with an explicit
fix-now / defer / final-review decision — never silently dropped). Deferred
items get a home (a follow-up section, a spawned task, or the requirements
checklist) before the plan closes.

Template: [templates/task-ledger-template.md](templates/task-ledger-template.md).

## 4. Implement, task by task

- Tests first where practical; every new failure/race behavior gets a
  regression test that fails against the pre-fix code.
- Stage specific files by path — never bulk-stage (`git add -A` / `.` is
  guard-blocked). Re-check `git status --short` before any commit that follows
  reviewer/agent activity: a later `git add` sweeps previously staged files
  along, and a reviewer's `git stash/pop` can silently unstage a staged wave.
- **The review gate**: committing a diff that touches a routed path is blocked
  until the required reviewers have run **against that exact staged diff**
  (stamps are keyed to the staged-diff hash — a changed diff invalidates
  them). Dispatch the missing reviewers in parallel, fix or triage findings,
  re-stage, stamp, retry. **Stamping without actually running the named
  reviewers is forbidden**; the bypass env var is for emergencies and requires
  the user's explicit go-ahead.
- **Doc coupling is same-commit, not best-effort.** The project's
  Documentation Map names each canonical doc and its update trigger; a change
  that trips a trigger updates the doc in the same commit. A stale map
  actively misleads.

## 5. Final whole-plan review

After the last task, one review pass over the plan's ENTIRE diff (not just the
last task's) — cross-task integration bugs hide in the seams. In the source
project this pass regularly found Criticals that per-task reviews missed.
Findings are fixed and independently re-verified before the plan closes.

## 6. Verification

Fill the plan's Verification section: **one entry per acceptance criterion**,
each closed with the command/check actually run and its **real output pasted
from this session** — never from memory. If a criterion can't be verified
(operator-gated deploy, missing credentials), it stays open and says so
explicitly ("BUILD-then-DEFER"), with the operator checklist recorded.

## 7. Sync back

- Plan Status → SHIPPED (PR #) / ABANDONED (why), with date.
- Record **Deviations & discoveries**: what changed vs. the plan and why.
- **Promote gotchas**: anything that cost real time becomes a rule (if it must
  be enforced), a memory entry (if it's cross-session context), or a line in
  the project instructions file — so it bites once.
- Update the requirements/production checklist if the work affects readiness.

## Standing principles (apply at every step)

1. **Never assume — verify first.** Before stating a fact, recommending a
   value, or acting on a claim, confirm it against the actual source. "I
   think" / "probably" are signals to go verify, not to proceed.
2. **Reported numbers come from command output, not memory.** Every count in a
   plan, ledger, commit message, or PR body was copied from a command run in
   that session.
3. **Evidence before completion claims.** "Done" / "fixed" / "passing" is
   said only after the verifying command ran and its output was read.
4. **Class-of-bug fixes cover the class.** Fixing one instance of a
   describable defect class obligates an inventory of every instance — or a
   root-level fix that covers them all.
5. **Failure paths have owners.** Every error/empty/loading state either
   retries via a mechanism that provably fires in that state, or renders an
   explicit state. No dead ends.
6. **Session-context budgets are real.** Keep instruction files small; move
   detail into scoped rules/docs that load on demand.
