# The SSDD process

One lifecycle for every non-trivial piece of work. "Non-trivial" = anything
whose scope you couldn't state, verify, and revert in a single sitting; a
one-line fix doesn't need a plan, a new feature or subsystem always does.

**Folders.** Plans, specs and ledgers live where `.ssdd/config.json` →
`paths` puts them: the plans folder (`paths.plans`, default `.ssdd/plans`),
the specs folder (`paths.specs`, default `.ssdd/specs`) and the ledgers
folder (`paths.ledgers`, default `.ssdd/ledgers`). Below, `<plans>`,
`<specs>` and `<ledgers>` name them.

```
brainstorm ──▶ spec ──▶ plan (clarify pass, criteria first) ──▶ task ledger
                                                                    │
                    ┌─── per task: implement → review gate → commit ┘
                    ▼
     final whole-plan review ──▶ verification (against criteria) ──▶ sync back
```

## 0. Brainstorm

Purpose, constraints and success criteria are settled with the user, and one
of two or three approaches is chosen. Work spanning independent subsystems
gets one spec → plan → implementation cycle per subsystem.

## 1. Spec (`<specs>/NN-<slug>-spec.md`)

The validated design, written **before** the plan, from
[templates/spec-template.md](templates/spec-template.md). Its Out list
(deferred, with a reason) is what keeps plans shippable.

Small work may skip the spec and go straight to a plan; never skip the plan.

## 2. Plan (`<plans>/NN-<slug>.md`)

One numbered markdown file per plan, `NN-kebab-slug.md`. The next number
comes from `node .ssdd/hooks/work-state.mjs --next-plan`, which reads every
worktree and every ref git knows, since parallel worktrees race for the same
number. Never reuse, skip, or backfill numbers; never add unnumbered files to
the plans directory. Work this checkout can't see (an unfetched branch, another
machine) can still take the same number; the session view reports two plans
with one number, and the later one is renumbered, with its references.

**The clarify pass comes before the criteria** (required for a multi-task
plan, optional for a single-task one). List the assumptions the design
makes; the kinds that have bitten before are empty/error/loading states,
design coverage of every state, data shape and authorization, platform
differences, paid/permission gates, and degraded or offline modes.
Resolve each from a source (design file, schema, code) or ask the user, and
record it in `## Clarify pass` with that source. An unresolved assumption
goes to `## Open questions`, not into a criterion; the plan stays DRAFT while
any remain.

**Acceptance criteria are written now, before implementation.** They define
"done", and each is checkable by a command, a test, or a concrete observation.
Each gets an ID (`- **AC1** — …`) that its Verification entry cites later.

Template: [templates/plan-template.md](templates/plan-template.md).

## 3. Task ledger (`<ledgers>/NN-<slug>-ledger.md`)

For multi-task plans, the ledger is the cross-session execution record: one
line per task (commits, review verdicts, test count, fixes with their commit)
and one line per deferred Minor, which gets a home before the plan closes.
Detail goes in the commit message. Owner decisions made mid-execution go in
the ledger's **Rulings** section.

Template: [templates/task-ledger-template.md](templates/task-ledger-template.md).

## 4. Implement, task by task

- Tests first where practical; every new failure/race behavior gets a
  regression test that fails against the pre-fix code.
- Stage specific files by path (bulk staging is guard-blocked). Re-check
  `git status --short` before a commit that follows agent activity: a later
  `git add` sweeps earlier staged files along, and a `git stash`/`pop`
  silently unstages them.
- **The review gate.** A commit touching a path routed in
  `.ssdd/config.json` is blocked until every reviewer routed to each such
  file has reviewed that file's exact staged change. Stamps are per
  reviewer × per file, so after a fix only the changed files are owed again;
  unrouted files (ledgers, docs) never void a stamp. To see what the index
  owes without committing, run `node .ssdd/hooks/review-gate.mjs --check`
  (exit 1 when a commit would be blocked); never a probe commit. The
  procedure:
  1. Read the block message: per reviewer, the files it owes and why.
  2. Dispatch those reviewers in parallel. Name each one's input (the staged
     diff, a range, or a file list). For a file a reviewer stamped before,
     the message gives `git diff <stamped blob> <staged blob>`: that change
     is its input, not the whole file. A reviewer given nothing answers
     `NO DIFF — scope not provided`, and that is never stamped. Dispatched
     reviewers are read-only: no edits, commits, stamps, or `git stash`.
  3. Fix or triage the findings, re-stage, then stamp. In Claude Code with
     the subagent hooks wired, a reviewer that ends with its verdict line
     stamps all its routed staged files, whatever its input named, so name
     every file it owes (one staged or edited during its review stays owed;
     a review on a model outside `reviewGate.reviewerModels` stamps
     nothing). Otherwise:
     `node .ssdd/hooks/review-gate.mjs --stamp <reviewer,…>`, adding
     `--files <path,…>` when a reviewer re-read only those files and
     `--repo <path>` for another work tree (the message prints it). With
     `reviewGate.stamping: "hooks"` the agent can't run `--stamp`; completion
     stamps are the only way.
  4. Commit in a separate call from staging: the harness gate reads the
     index before the command runs, so it refuses `git add … && git commit`,
     `commit -a/-i/-o` and `commit <path>`. The one exception is a chained
     `git add` that names files no reviewer is routed to (a doc, a ledger),
     which can't change what the commit owes.

  **Merges.** While a merge of the default branch is stopped (a conflict,
  or `--no-commit`), a staged file equal to git's own merge of the two sides
  was reviewed on its way in and owes nothing; conflict resolutions and edits
  made during the merge are owed as usual. Merging another branch, or with
  git older than 2.38, judges every file.

  Stamping without running the reviewers is forbidden; `SSDD_REVIEW_SKIP=1`
  is for emergencies, with the user's explicit go-ahead. Over
  `reviewGate.maxRoutedFiles` routed files the gate warns: split the commit
  rather than run another round.
- **Findings are records.** Each review round's findings are collected as
  structured records (finding, reviewer(s), severity, file) and fixes are
  applied from that list. A ledger row that claims a fix ("fixed by X", "test
  added") is checked against the staged blob (`git show :path`) by an agent
  other than the one that wrote the fix, refute-by-default: it stands only
  when the staged file demonstrably contains what it claims. Other rows
  aren't re-checked. (prizma plan 24's verifier caught recorded fixes that
  had never landed.)
- **Doc coupling is same-commit, not best-effort.** The project's
  Documentation Map names each canonical doc and its update trigger; a change
  that trips a trigger updates the doc in the same commit.

## 5. Final whole-plan review

After the last task, one review pass over the plan's whole diff: cross-task
integration bugs hide in the seams between per-task reviews. Findings are
fixed and re-verified by the refute-by-default check (§4) before the plan
closes. The gate and this pass are the review rounds; don't start others
unless the user asks.

## 6. Verification

**One entry per AC ID** in the plan's Verification section:
`- **AC1** — <command> → <real output from this session>`, or, for a criterion
that can't be checked yet (an operator-gated deploy, missing credentials),
`- **AC4** — DEFERRED (operator): <what's left>` with the operator checklist.

## 7. Sync back

- Plan Status → BUILT (verified; only operator-gated criteria remain) /
  SHIPPED (PR #) / SUPERSEDED (by what) / ABANDONED (why), with date. The
  pre-commit check accepts only these words plus DRAFT and IN PROGRESS, and
  refuses BUILT or SHIPPED while an AC ID has no Verification entry or the
  plan's ledger isn't staged.
- Record **Deviations & discoveries**: what changed vs. the plan and why.
- **Promote gotchas**: anything that cost real time becomes a rule (if it must
  be enforced), a memory entry (if it's cross-session context), or a line in
  the project instructions file — so it bites once.
- Update the requirements/production checklist if the work affects readiness.
- When the instructions, skills or reviewers changed — or a new model
  generation is adopted — run Claude Code's `/doctor prompt-audit` and act on
  what it finds.

## Handover (work that crosses sessions)

When work must continue in a fresh session before it has a plan, or a plan's
next step needs a clean context, write `<specs>/HANDOVER-<slug>.md` from
[templates/handover-template.md](templates/handover-template.md). The
receiving session re-verifies before citing anything in it.

**Where the work is.** `node .ssdd/hooks/work-state.mjs` lists every open plan
across branches and worktrees (status, next task, criteria verified, open
questions, an IN PROGRESS nothing is working on). The harness hooks print it
at session start. Read it before reading plans to find your place.

**Production.** Production changes go one sanctioned way (the project's
`productionGuard.writePath`, e.g. migrations merged to `main`). The
production guard asks the owner before any other write, and the owner's OK
in chat is what approves it; reads don't ask. Read production through a
pack's read path (`node .ssdd/packs/supabase/db-read.mjs "<sql>"`) rather
than an inline query, so the database enforces the read.

## Standing principles (apply at every step)

1. **Evidence, not memory.** Before stating a fact or reporting progress,
   check it against the source or a tool result from this session; every
   number in a plan, ledger, commit or PR comes from a command. Say what
   isn't verified yet.
2. **Class-of-bug fixes cover the class.** Fixing one instance of a
   describable defect class means an inventory of every instance, or a
   root-level fix that covers them all.
3. **Failure paths have owners.** Every error/empty/loading state either
   retries via a mechanism that provably fires in that state, or renders an
   explicit state. No dead ends.
4. **Session-context budgets are real.** Keep instruction files small; move
   detail into skills and docs that load on demand.
5. **Effort follows the stakes.** High or above for brainstorming, the
   clarify pass and the final review; the session default for routine tasks;
   reviewers use the `effort` in their frontmatter. Reviewer files don't name
   a model: the harness and session choose it. A Claude Code project that
   wants a floor sets `reviewGate.reviewerModels`.
