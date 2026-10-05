<!-- SSDD shared instructions template — the ONE instructions file every
harness reads. inject.sh seeds it as AGENTS.ssdd.md for every adapter: merge
it into the project's AGENTS.md and fill the <placeholders>. Claude Code reads
it through a two-line CLAUDE.md (`@AGENTS.md`); Cursor, Codex and others read
AGENTS.md natively. Don't fork a second full copy per harness. The mechanical
backstop is the git pre-commit hook (works everywhere); this file is the
behavioral contract the hooks enforce the tail end of. -->

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
  review verdicts, test counts, triaged findings. Never a bare "done". Ledger
  rows that claim a fix are checked against the staged file before they are
  written.

## Review gate (mechanically enforced)

Commits whose staged diff touches paths routed in `.ssdd/config.json` are
blocked (git pre-commit hook, plus the harness hook where one is wired) until
every reviewer routed to each such file has run against that file's exact
staged change. Stamps are per reviewer, per routed file: a changed file must
be re-reviewed by every reviewer routed to it; an unchanged file keeps its
stamps; an unrouted file (ledger, doc) voids nothing.

1. The block message names, per reviewer, the files it still owes. Run each
   checklist in `.ssdd/reviewers/<name>.md` against those files — in parallel
   if your harness has subagents — and tell each reviewer its input (the
   staged diff, a range, or a file list).
2. Fix or explicitly triage every finding; re-stage.
3. Attest: `node .ssdd/hooks/review-gate.mjs --stamp <name,…>` (add
   `--files <path,…>` when a reviewer re-read only those files).
4. Retry the commit.

**Stamping without actually running the named reviewers is forbidden.**
`SSDD_REVIEW_SKIP=1` is for emergencies and requires the user's explicit
go-ahead. A diff over `reviewGate.maxRoutedFiles` routed files gets a warning:
split it per task rather than review it whole.

## Harnesses

<!-- Keep one row per harness this repo is driven from; delete the rest. -->

| Harness | Instructions | Hooks | Reviewer dispatch |
|---|---|---|---|
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | `.claude/settings.json` (PreToolUse / PostToolUse) | Agent tool → `.claude/agents/*.md` (symlinks to `.ssdd/reviewers/`) |
| Cursor | `AGENTS.md` natively; glue in `.cursor/rules/ssdd.mdc` | `.cursor/hooks.json` | Task tool, same reviewer names |
| Other | `AGENTS.md` | git pre-commit only | Run `.ssdd/reviewers/*.md` as checklists |

Skills live in one tree, `.agents/skills/`; `.claude/skills/<name>` entries
are symlinks to it. Don't add a second copy for another harness.

## Git rules

- Never `git add -A` / `git add .` — stage specific files by path.
- Never `--no-verify`, never `--amend`, never force-push (`--force-with-lease`
  only with the user's go-ahead).
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
