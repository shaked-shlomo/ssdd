<!-- SSDD template. Every harness reads this file (Claude Code through CLAUDE.md's
`@AGENTS.md`); keep it short, detail lives in .ssdd/process/SDD.md. -->

# <Project> — instructions

<One paragraph: what this repo is, the stack, the one command that checks
everything (e.g. `npm run check`).>

## Workflow: SSDD

Non-trivial work follows `.ssdd/process/SDD.md`: a numbered plan (`/new-plan`),
acceptance criteria before code (after a clarify pass, for a multi-task plan),
a ledger per multi-task plan, and verification with real command output.
Before starting work, run `node .ssdd/hooks/work-state.mjs` to see where the work is.

- Before reporting progress, check each claim against a tool result from this
  session, and say what isn't verified yet.
- A change that trips a Documentation Map trigger updates that doc in the same commit.
- Fixing one instance of a describable bug means finding every instance, or
  fixing it at the root.

## Review gate and git

A commit touching paths routed in `.ssdd/config.json` is blocked until their
reviewers have reviewed them; the block message says what to run. Never stamp
without running the reviewers; `SSDD_REVIEW_SKIP=1` needs the user's go-ahead.
Reviews happen at the gate and in the final whole-plan review; don't start
others unless asked. Stage files by path, and commit in a separate call. No
`--no-verify`/`-n`, force-push or `core.hooksPath` changes; amend only an
unpushed commit.

Reviewers are `.ssdd/reviewers/*.md`: subagents of the same name (Claude Code's
`.claude/agents/` links to them), or checklists where there are none. Skills
live in `.agents/skills/` (`.claude/skills/` holds symlinks).

## Gotchas

<!-- The highest-value lines in this file: things that cost real time once. -->

## Documentation Map

| Doc | Purpose | When to update |
|---|---|---|
| `<docs/architecture-map.md>` | <…> | <…> |
