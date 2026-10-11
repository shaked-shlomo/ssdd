<!-- SSDD template for the one instructions file every harness reads (Claude
Code through `@AGENTS.md` in CLAUDE.md). Keep it short: what the repo is, its
gotchas, the Documentation Map. Detail lives in .ssdd/process/SDD.md. -->

# <Project> — instructions

<One paragraph: what this repo is, the stack, the one command that checks
everything (e.g. `npm run check`).>

## Workflow: SSDD

Non-trivial work follows `.ssdd/process/SDD.md`: a numbered plan in
`.ssdd/plans/` (`/new-plan`), a clarify pass and acceptance criteria before
code, a ledger per multi-task plan, and verification that closes each
criterion with real command output.

- **Evidence:** before reporting progress, check each claim against a tool
  result from this session; say what isn't verified yet. Numbers come from
  commands, not memory.
- **Docs move with code:** a change that trips a Documentation Map trigger
  updates that doc in the same commit.
- **Class fixes cover the class:** fixing one instance of a describable bug
  means finding every instance, or fixing it at the root.

## Review gate

Commits touching paths routed in `.ssdd/config.json` are blocked until the
reviewers routed to those files have reviewed them. Routes come from the
committed config and the staged one (the stricter applies), so a config edit
takes effect once committed and can't loosen the commit that makes it. The
block message says
exactly what to run. Stamping without running the reviewers is forbidden;
`SSDD_REVIEW_SKIP=1` needs the user's go-ahead. Stage and commit in separate
calls. Reviews happen at the gate and in the final whole-plan review. Don't
start other review rounds unless asked.

## Git

Stage files by path. No `--no-verify`/`-n`, `--amend`, force-push, or
`core.hooksPath` changes (the guard blocks them and says why). The pre-commit
hook blocks while untracked files exist.

## Harnesses <!-- keep the rows for the harnesses this repo uses -->

| Harness | Instructions | Hooks | Reviewers |
|---|---|---|---|
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | `.claude/settings.json` | Agent tool, `.claude/agents/` (symlinks) |
| Cursor | `AGENTS.md`, `.cursor/rules/ssdd.mdc` | `.cursor/hooks.json` | Task tool, same names |
| Other | `AGENTS.md` | git pre-commit | `.ssdd/reviewers/*.md` as checklists |

Skills live in `.agents/skills/` only (`.claude/skills/` holds symlinks).

## Gotchas

<!-- The highest-value lines in this file: things that cost real time once. -->

## Documentation Map

| Doc | Purpose | When to update |
|---|---|---|
| `<docs/architecture-map.md>` | <…> | <…> |
