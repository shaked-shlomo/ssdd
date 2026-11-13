# Claude Code adapter

Wires the SSDD mechanisms into Claude Code's hook/agent/skill system. The
review gate is the git pre-commit, the same on every harness; these hooks
add earlier checks (at tool-call time, with errors routed straight back to
the agent) and the session view. They're conveniences on the same scripts:
none adds a rule of its own, and a missing one costs only what it adds.

## Wiring (after `bin/ssdd.mjs install <repo> claude-code`)

1. **Hooks** — install seeds `.claude/settings.json` from
   [settings-hooks.json](settings-hooks.json) when none exists; otherwise
   merge its top-level `hooks` key by hand. It registers git-guard and
   prod-guard on Bash, prod-guard on every MCP tool (`mcp__.*`), and
   convention-lint after edits. On `SessionStart` (startup, resume, clear
   and compact) it runs `work-state.mjs --session-start`, so each session
   opens knowing where the work is. `status` lists the template's entries
   a seeded `.claude/settings.json` lacks, and the ones the template
   dropped as safe to remove. Hook changes take effect after a session
   reload.
2. **Reviewer agents** — `.claude/agents/<name>.md` are **symlinks** to
   `.ssdd/reviewers/<name>.md` (one source of truth; the frontmatter already
   matches Claude Code's agent format). A project domain reviewer goes in
   `.ssdd/reviewers/`, gets a route in `.ssdd/config.json`, and a symlink
   (the next `install`/`update` creates it).
3. **Skills** — the skills tree is `.agents/skills/` (harness-neutral; Cursor
   reads it natively). `.claude/skills/<name>` are symlinks to it. Invoke
   `/new-plan`, `/new-reviewer`, `/skills-audit`, `/cleanup`, `/migrate`, and the
   optional parts' `/docs-drift-audit` (`--with drift-audit`) and
   `/dependency-versioning` (`--with dependency-versioning`).
4. **Instructions** — `AGENTS.md` is canonical; `CLAUDE.md` is
   [`@AGENTS.md`](CLAUDE.md), plus any Claude-only notes the project adds.
   Put the Documentation Map and review-gate paragraph in `AGENTS.md` once.
   Keep the loaded total small — detail belongs in `.ssdd/` and skills.
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
- **Desktop-app worktree sessions** start with `--project-config-root` set
  to the **main checkout**, so agents, skills and Claude Code hooks
  (`$CLAUDE_PROJECT_DIR`) load from there, not from the worktree. Until the
  SSDD install is on the main checkout's branch, reviewers fail with "Agent
  type not found" and git-guard doesn't run; the git pre-commit hook, the
  gate, still does.
- **Reviewer models.** Reviewer files name no model; reviewers run on the
  session's model unless Claude dispatches one with a different model.
  `CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json` forces one model
  for every subagent, not only reviewers.
- **prod-guard** asks before a call that would change production outside
  the merge path (`permissionDecision: "ask"`, with a reason that says
  "writes" or "can't tell"), and prints nothing on an allow, so the
  project's own permission rules still apply. It runs on every MCP tool
  because the matcher can't follow which packs are installed; with no pack
  claiming the call it allows at once. An `ask` stops a call before it is
  sent. An Esc on a call already sent doesn't: the server may finish it.
- **Stale wiring is harmless.** A `.claude/settings.json` seeded before
  3.4.0 still calls `review-gate.mjs` on Bash, `SubagentStart` and
  `SubagentStop`, and git-guard on Edit/Write. With no mode the gate script
  exits 0 and prints nothing, and git-guard finds no command; remove the
  entries `status` lists when convenient.
- Claude Code acts on a hook's exit code (2 = block, stderr is fed back to
  the agent), so git-guard prints nothing on a plain allow; its warnings
  (bulk add, amend) arrive as `additionalContext`, the only output of an
  allowed call the model sees. The JSON permission body
  (`{"permission":"allow"|"deny",…}`) is for Cursor's `failClosed`.
  convention-lint's findings on an edit arrive as `additionalContext`
  beside the tool result; at commit they print, and the commit goes on. A
  dormant pre-commit hook is named in the `SessionStart` view and by
  `status`.
- Subagents may lack MCP access the main session has. If a reviewer's
  protocol needs MCP output (e.g. a platform's advisor/lint API), run that
  call in the MAIN session and paste the output into the reviewer's prompt.
- A reviewer's `git stash`/`pop` can silently unstage staged files — re-check
  `git status --short` before any commit that follows reviewer activity.
