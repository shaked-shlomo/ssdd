# Claude Code adapter

Wires the SSDD mechanisms into Claude Code's hook/agent/skill system so
enforcement fires **earlier** than the git layer (at tool-call time, with
errors routed straight back to the agent). The portable git pre-commit hook
stays installed regardless — this adapter is sugar on the same scripts, not a
replacement.

## Wiring (after `inject.sh <repo> claude-code`)

1. **Hooks** — merge [settings-hooks.json](settings-hooks.json) into
   `<repo>/.claude/settings.json` (top-level `hooks` key). Hook changes take
   effect after a session reload.
2. **Reviewer agents** — inject.sh copies `reviewers/*.md` (minus the domain
   template) into `<repo>/.claude/agents/`; the frontmatter already matches
   Claude Code's agent format. Add project domain reviewers there too, and
   route them in `.ssdd/config.json`.
3. **Skill** — inject.sh copies `skills/new-plan/` into
   `<repo>/.claude/skills/`; invoke it as `/new-plan` when a plan is approved.
4. **Instructions file** — add to the project's CLAUDE.md:
   - a pointer to `.ssdd/process/SDD.md` as the workflow contract,
   - the **Documentation Map** table (doc / purpose / when-to-update),
   - the review-gate paragraph: dispatch missing reviewers in parallel via
     the Agent tool, fix/triage, re-stage, `--stamp`, retry; stamping without
     running them is forbidden; `SSDD_REVIEW_SKIP=1` needs the user's
     explicit go-ahead in chat.
   Keep CLAUDE.md under its session-load budget (~25KB / 200 lines in some
   clients) — detail belongs in `.ssdd/` and scoped rules, not inline.
5. Commit the whole setup — the framework travels with the repo.

## Notes

- The PreToolUse gate and the git pre-commit hook are idempotent together:
  whichever fires first blocks; stamps satisfy both (same stamp file).
- Subagents may lack MCP access the main session has. If a reviewer's
  protocol needs MCP output (e.g. a platform's advisor/lint API), run that
  call in the MAIN session and paste the output into the reviewer's prompt.
- A reviewer's `git stash`/`pop` can silently unstage staged files — re-check
  `git status --short` before any commit that follows reviewer activity.
