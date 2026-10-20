# Cursor adapter

Wires the same `.ssdd/hooks/` scripts into Cursor's hook system. Cursor reads
`AGENTS.md` and `.agents/skills/` natively, so the adapter is only glue.

## Wiring (after `bin/ssdd.mjs install <repo> cursor`)

1. `.cursor/hooks.json` — seeded from [hooks.json](hooks.json): git-guard,
   review-gate and prod-guard on `beforeShellExecution`, prod-guard on
   `beforeMCPExecution` (all `failClosed`), convention-lint on
   `afterFileEdit`, and the work-state view on `sessionStart` (as
   `additional_context`). Forum reports say Cursor often drops that context
   before it reaches the agent, so `ssdd.mdc` (always applied) also tells the
   agent to run `node .ssdd/hooks/work-state.mjs` itself.
2. `.cursor/rules/ssdd.mdc` — always-on glue pointing at `AGENTS.md`. Not a
   second Documentation Map.
3. Fill `AGENTS.md` (or merge `AGENTS.ssdd.md` into it); `install` already set `core.hooksPath` (else it printed the command).

## Gotchas (each cost a session in the source project)

- Hook `command` paths resolve against the **workspace cwd**, not
  `.cursor/`. Use `node .ssdd/hooks/…`; `../.ssdd/…` looks one level above
  the repo and, with `failClosed`, blocks every shell call.
- `failClosed: true` treats missing or invalid stdout JSON as a block, so the
  scripts always print `{"permission":"allow"|"deny",…}` before exiting.
- Cursor payloads put `command` / `file_path` at the top level (Claude nests
  them under `tool_input`), may carry a UTF-8 BOM, and don't set
  `CLAUDE_PROJECT_DIR` — `stdin-payload.mjs` handles all three (repo root
  from `cwd` / `workspace_roots[0]`).
- **Cursor ignores `ask`.** Its staff confirmed (forum, 2026-03-21) that
  hooks' `ask` isn't enforced on shell or MCP calls; the call just runs. So
  where Claude Code would ask, prod-guard returns `deny` with the same
  reason, and the owner runs the command in their own terminal. Recheck
  when Cursor's changelog says `ask` works, and switch it back.
- `beforeMCPExecution` sends `tool_input` as a JSON string and names the
  server in `mcp_server_name` / `url`; `stdin-payload.mjs` reads both.
- Don't add `.cursor/skills/`: Cursor already reads `.agents/skills/`, and a
  second tree double-lists every skill.
