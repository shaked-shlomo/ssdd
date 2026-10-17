# Claude Code adapter

Wires the SSDD mechanisms into Claude Code's hook/agent/skill system so
enforcement fires **earlier** than the git layer (at tool-call time, with
errors routed straight back to the agent). The portable git pre-commit hook
stays installed regardless — this adapter is sugar on the same scripts, not a
replacement.

## Wiring (after `bin/ssdd.mjs install <repo> claude-code`)

1. **Hooks** — install seeds `.claude/settings.json` from
   [settings-hooks.json](settings-hooks.json) when none exists; otherwise
   merge its top-level `hooks` key by hand. It registers git-guard and the
   review gate on Bash, git-guard on Edit/Write (the gate's state files are
   off limits), convention-lint after edits, and the review gate on
   `SubagentStart` / `SubagentStop` (completion stamps). Hook changes take
   effect after a session reload.
2. **Reviewer agents** — `.claude/agents/<name>.md` are **symlinks** to
   `.ssdd/reviewers/<name>.md` (one source of truth; the frontmatter already
   matches Claude Code's agent format). A project domain reviewer goes in
   `.ssdd/reviewers/`, gets a route in `.ssdd/config.json`, and a symlink
   (the next `install`/`update` creates it).
3. **Skills** — the skills tree is `.agents/skills/` (harness-neutral; Cursor
   reads it natively). `.claude/skills/<name>` are symlinks to it. Invoke
   `/new-plan`, `/new-reviewer`, `/skills-audit`, `/cleanup`, `/docs-drift-audit`.
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
  source project since 2026-09. If a release stops loading them,
  `linkAll` in `bin/ssdd.mjs` is the one place to switch back to copies.
- A *copied* agent or skill where a symlink belongs (v1 layout) is replaced
  automatically when it's identical to its source; an edited copy gets a
  warning — move its edits into the source file, then link it.
- **Completion stamps.** A routed reviewer's `SubagentStart` snapshots the
  staged keys of its files; its `SubagentStop` stamps the unchanged ones if
  its final report ends with a verdict and every turn ran on a model in
  `reviewGate.reviewerModels` (read from the subagent transcript, because a
  spawn can override the frontmatter `model`). `reviewGate.stamping: "hooks"`
  makes them the only way the agent can stamp. They cover the repo at the
  session's cwd (a worktree session has its own). A refused stamp shows up
  in the gate's block message (`! <reviewer>: …`). In the desktop app a
  subagent ends by calling `SubagentHandback`; its `message` is the final
  report, so the verdict is read from it (from the transcript) and the
  hook's `last_assistant_message`, empty there, is the CLI fallback.
- **Desktop-app worktree sessions** start with `--project-config-root` set
  to the **main checkout**, so agents, skills and Claude Code hooks
  (`$CLAUDE_PROJECT_DIR`) load from there, not from the worktree. Until the
  SSDD install is on the main checkout's branch, reviewers fail with "Agent
  type not found" and git-guard and the stamping hooks don't run; only the
  git pre-commit hook does.
- **Reviewer models.** Reviewer files name no model; reviewers run on the
  session's model unless Claude dispatches one with a different model. To
  enforce a floor, set `reviewGate.reviewerModels` in the project's config,
  e.g. `["opus>=5.5", "sonnet>=5.5"]`. Only this hook can check it, so it
  never affects Cursor. Pick the session model by full id, or on a current
  CLI: an older CLI resolved the alias `sonnet` to `claude-sonnet-5`, below a
  5.5 floor. `CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json` forces
  one model for every subagent, not only reviewers.
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
