@AGENTS.md

## Claude Code harness

Project instructions are `AGENTS.md`; this file exists because Claude Code
reads `CLAUDE.md`, and the `@AGENTS.md` import is the bridge (not a symlink).

Hooks: `.claude/settings.json` registers SessionStart (the work-state view),
PreToolUse (Bash, mcp__.*, Edit|Write), PostToolUse (Edit|Write) and
SubagentStart/Stop onto `.ssdd/hooks/`; a
reviewer that finishes with its verdict line stamps its own files. Reviewer dispatch: Agent tool →
`.claude/agents/*.md` (symlinks to `.ssdd/reviewers/`). Skills:
`.claude/skills/<name>` → `.agents/skills/<name>`.
