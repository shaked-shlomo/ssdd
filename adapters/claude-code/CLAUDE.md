@AGENTS.md

## Claude Code harness

Project instructions are `AGENTS.md`; this file exists because Claude Code
reads `CLAUDE.md`, and the `@AGENTS.md` import is the bridge (not a symlink).

Hooks: `.claude/settings.json` registers PreToolUse (Bash) and PostToolUse
(Edit|Write) onto `.ssdd/hooks/`. Reviewer dispatch: Agent tool →
`.claude/agents/*.md` (symlinks to `.ssdd/reviewers/`). Skills:
`.claude/skills/<name>` → `.agents/skills/<name>`.
