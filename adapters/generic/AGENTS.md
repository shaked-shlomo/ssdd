<!-- SSDD generic adapter — template AGENTS.md section for harnesses without a
hook system (Codex, Cursor, aider, a human in a terminal, …). Paste into the
project's AGENTS.md / instructions file and fill the <placeholders>. The
mechanical backstop is the git pre-commit hook (works everywhere); everything
here is the behavioral contract the hook enforces the tail end of. -->

# Engineering workflow (SSDD)

This project follows the SSDD process — the full contract is
`.ssdd/process/SDD.md`. The short version you must actually follow:

## Plans before code

- Non-trivial work gets a numbered plan in `.ssdd/plans/NN-<slug>.md` (next
  number = highest existing + 1; check with a command). Use
  `.ssdd/process/templates/plan-template.md`.
- Run the **clarify pass** first: list every assumption; resolve each from a
  source or ask; unresolved ones go to `## Open questions` and the plan stays
  DRAFT while any remain. **Acceptance criteria are written before any code.**
- Multi-task plans keep a ledger (`.ssdd/ledgers/`) — per task: commit hashes,
  review verdicts, test counts, triaged findings. Never a bare "done".

## Review gate (mechanically enforced)

The git pre-commit hook blocks any commit whose staged diff touches gated
paths (routing: `.ssdd/config.json`) until the required reviewers have run
against that exact diff:

1. It names the missing reviewers. For each, execute the checklist in
   `.ssdd/reviewers/<name>.md` against the staged diff.
2. Fix or explicitly triage every finding; re-stage.
3. Attest: `node .ssdd/hooks/review-gate.mjs --stamp <name,name>` (the stamp
   is keyed to the staged-diff hash — a changed diff invalidates it).
4. Retry the commit.

**Stamping without actually running the named reviewers is forbidden.**
`SSDD_REVIEW_SKIP=1` is for emergencies and requires the user's explicit
go-ahead. Docs/config-only commits pass ungated.

## Git rules

- Never `git add -A` / `git add .` — stage specific files by path.
- Never `--no-verify`, never `--amend`, never force-push.
- The pre-commit hook blocks while ANY untracked file exists — stage or clean
  up strays first. Re-check `git status --short` before any commit that
  follows other tooling activity.

## Standing principles

- **Never assume — verify first.** Confirm against the actual source before
  stating a fact or acting on a claim.
- **Reported numbers come from command output run in this session** — never
  from memory.
- **Evidence before completion claims**: say "done/fixed/passing" only after
  running the verifying command and reading its output.
- **Doc coupling is same-commit**: the Documentation Map below names each
  canonical doc and its update trigger; a change that trips a trigger updates
  the doc in the same commit.
- **Class-of-bug fixes cover the class** — inventory every instance or fix at
  the root.

## Documentation Map

<!-- Fill in: | Doc | Purpose | When to update | — one row per canonical doc.
Include at minimum: architecture map(s), version ledger, secret/key
inventory, requirements/production checklist. -->

| Doc | Purpose | When to update |
|---|---|---|
| `<docs/architecture-map.md>` | <…> | <…> |
