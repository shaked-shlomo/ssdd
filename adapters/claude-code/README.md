# Claude Code adapter

Wires the SSDD mechanisms into Claude Code's hook/agent/skill system so
enforcement fires **earlier** than the git layer (at tool-call time, with
errors routed straight back to the agent). The portable git pre-commit hook
stays installed regardless — this adapter is sugar on the same scripts, not a
replacement.

## Wiring (after `inject.sh <repo> claude-code`)

1. **Hooks** — inject.sh seeds `.claude/settings.json` from
   [settings-hooks.json](settings-hooks.json) when none exists; otherwise
   merge its top-level `hooks` key by hand. Hook changes take effect after a
   session reload.
2. **Reviewer agents** — `.claude/agents/<name>.md` are **symlinks** to
   `.ssdd/reviewers/<name>.md` (one source of truth; the frontmatter already
   matches Claude Code's agent format). A project domain reviewer goes in
   `.ssdd/reviewers/`, gets a route in `.ssdd/config.json`, and a symlink
   (re-running inject.sh creates it).
3. **Skills** — the skills tree is `.agents/skills/` (harness-neutral; Cursor
   reads it natively). `.claude/skills/<name>` are symlinks to it. Invoke
   `/new-plan`, `/cleanup`, `/docs-drift-audit`.
4. **Instructions** — `AGENTS.md` is canonical; `CLAUDE.md` is
   [`@AGENTS.md` plus Claude-only harness notes](CLAUDE.md). Put the
   Documentation Map and review-gate paragraph in `AGENTS.md` once. Keep the
   loaded total small — detail belongs in `.ssdd/` and skills.
5. Commit the whole setup — the framework travels with the repo.

## Notes

- **Symlinks on Windows** need `git config core.symlinks true` (and Developer
  Mode); without it git checks them out as text files holding the path.
- Claude Code documents symlinked **skill** folders as supported. Symlinked
  **agent** files aren't documented either way, but they have worked in the
  source project since 2026-09. If a release stops loading them, inject.sh's
  `link` step is the one place to switch back to copies.
- inject.sh warns when it finds a *copied* agent or skill where a symlink
  belongs (v1 layout): diff it against its source, keep the project's edits
  in the source file, then replace the copy with the symlink.
- The PreToolUse gate and the git pre-commit hook are idempotent together:
  whichever fires first blocks; stamps satisfy both (same stamp file).
- Hook stdout is a JSON permission body (`{"permission":"allow"|"deny",…}`)
  for Cursor's `failClosed`; Claude Code acts on the exit code (2 = block,
  stderr is fed back to the agent).
- Subagents may lack MCP access the main session has. If a reviewer's
  protocol needs MCP output (e.g. a platform's advisor/lint API), run that
  call in the MAIN session and paste the output into the reviewer's prompt.
- A reviewer's `git stash`/`pop` can silently unstage staged files — re-check
  `git status --short` before any commit that follows reviewer activity.
