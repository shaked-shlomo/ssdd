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
existing `NN-` prefix + 1 (check with a command, not memory) — across `main`
**and open branches/PRs**, since parallel worktrees race for the same number.
Never reuse, skip, or backfill numbers; never add unnumbered files to the
plans directory.

**The clarify pass — interrogate the plan BEFORE criteria are written.** List
every assumption the approved design makes: UX behavior (empty/error/loading
states), design coverage (a mock for every state? motion/interaction specified,
not guessed?), data (schema/authorization/query shape), platform differences,
permission and monetization gates, edge cases (offline, degraded, suspended
user, free-vs-paid). For each: **resolve it from a source** (the design file,
the schema, the code — never assume, verify first) **or ask the user**. An
unresolved assumption must NOT silently become an acceptance criterion — park
it in `## Open questions`. **The plan stays DRAFT while any remain.** Resolved
items are kept in `## Clarify pass`, each with the source that resolved it —
the record of what was checked, not just what was decided.

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
checklist) before the plan closes. A row that claims a fix is verified
against the staged file before it is written — §4, "Findings are records".
Owner decisions made mid-execution go in the ledger's **Rulings** section.

Template: [templates/task-ledger-template.md](templates/task-ledger-template.md).

## 4. Implement, task by task

- Tests first where practical; every new failure/race behavior gets a
  regression test that fails against the pre-fix code.
- Stage specific files by path — never bulk-stage (`git add -A` / `.` is
  guard-blocked). Re-check `git status --short` before any commit that follows
  reviewer/agent activity: a later `git add` sweeps previously staged files
  along, and a reviewer's `git stash/pop` can silently unstage a staged wave.
- **The review gate**: committing a diff that touches a routed path is blocked
  until every reviewer routed to each such file has run **against that file's
  exact staged change**. A stamp is per reviewer × per routed file × that
  file's `HEAD→index` blob pair: a file whose staged change differs from what
  a reviewer stamped must be re-reviewed by every reviewer routed to it —
  edit, deletion, mode change, or the same content on a different base; a
  file that did not change keeps its stamps, and a file no reviewer is routed
  to (a ledger, a doc) never enters a key, so editing one voids nothing. The
  block message names, per reviewer, the files it still owes and why
  (`changed since its last stamp` / `never stamped`). Dispatch the owing
  reviewers in parallel against the files they owe, fix or triage findings,
  re-stage, stamp — `--stamp <reviewer,…>` for every routed file the reviewer
  covers, `--files <path,…>` when it re-read only those — and retry.
  **Stamping without actually running the named reviewers is forbidden**; the
  bypass env var is for emergencies and requires the user's explicit
  go-ahead. The gate warns when a diff exceeds `reviewGate.maxRoutedFiles`
  routed files (default 10): that is the per-task rule being skipped, and the
  remedy is to split the commit, not to run another round. *(Why per file: in
  the source project a whole-diff stamp made one plan run six full rounds over
  29 files — each round's findings were on the previous round's fixes — and it
  shipped on the bypass.)*
- **Tell every reviewer what it is reviewing.** Reviewers default to
  `git diff --staged`; on a PR or branch nothing is staged, so a reviewer not
  handed its input (a range like `main...HEAD`, or an explicit file list)
  would review an empty diff — it answers `NO DIFF — scope not provided`, and
  that is never stamped.
- **Stage and commit in separate tool calls.** The harness gate reads the
  index before the command runs, so it refuses `git add … && git commit`,
  `commit -a/-i/-o` and `commit <pathspec>`; for a commit in another work
  tree, stamp with `--repo <path>` (the block message prints it). Dispatched reviewers are
  read-only: no edits, no commits, no stamping, no `git stash` (a stash/pop
  silently unstages the wave under review).
- **Findings are records; ledger rows are verified before they are written.**
  Each review round's findings are collected as structured records (finding,
  reviewer(s), severity, file), fixes are applied from that list, and then
  every intended ledger row — "fixed by X", "test added", "doc says Y" — is
  checked against the staged blob (`git show :path`) by an agent other than
  the one that wrote the fix, refute-by-default: a row stands only when the
  staged file demonstrably contains what it claims. Only then is the ledger
  section written. *(Source-project precedent: two review rounds recorded
  fixes that had not landed — an aborted batch edit, then rows written from
  intention; the verified method then refuted 2 of 22 rows before they were
  written, one a real bug in a fix.)*
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

- Plan Status → BUILT (verified; only operator-gated criteria remain) /
  SHIPPED (PR #) / SUPERSEDED (by what) / ABANDONED (why), with date.
- Record **Deviations & discoveries**: what changed vs. the plan and why.
- **Promote gotchas**: anything that cost real time becomes a rule (if it must
  be enforced), a memory entry (if it's cross-session context), or a line in
  the project instructions file — so it bites once.
- Update the requirements/production checklist if the work affects readiness.

## Handover (work that crosses sessions)

When work must continue in a fresh session before it has a plan — or a plan's
next step needs a clean context — write `.ssdd/specs/HANDOVER-<slug>.md` from
[templates/handover-template.md](templates/handover-template.md): a
self-contained opening prompt, verified against a named commit, that states
the problem with file:line evidence, what is decided, what is not, and the
next free spec/plan numbers to check. The receiving session re-verifies before
citing anything in it.

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
