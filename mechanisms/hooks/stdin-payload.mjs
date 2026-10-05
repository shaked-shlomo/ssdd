// Shared stdin parse for Claude Code PreToolUse/PostToolUse and Cursor hooks.
// Cursor payloads put `command` / `file_path` at the top level and may prefix
// JSON with a UTF-8 BOM (Windows pipe). Claude puts them under `tool_input`.
export function parseHookStdin(raw) {
  try {
    return JSON.parse(String(raw).replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

export function hookCommand(payload) {
  return payload?.tool_input?.command ?? payload?.command ?? '';
}

export function hookFilePath(payload) {
  return payload?.tool_input?.file_path ?? payload?.file_path ?? '';
}

// Claude Code sets CLAUDE_PROJECT_DIR and must keep winning. Cursor
// beforeShellExecution does not; it puts the shell directory on `cwd`
// (workspace_roots as fallback). Prefer env, then those, then process.cwd().
export function resolveHookRepo(payload) {
  return process.env.CLAUDE_PROJECT_DIR
    || process.env.SSDD_PROJECT_DIR
    || payload?.cwd
    || payload?.workspace_roots?.[0]
    || process.cwd();
}

// Cursor deny output is snake_case; keep camelCase so existing Claude-side
// tests and any reader of agentMessage still see the same keys.
export function hookPermissionBody(permission, extra = {}) {
  const body = { permission, ...extra };
  if (body.agentMessage != null) body.agent_message ??= body.agentMessage;
  if (body.userMessage != null) body.user_message ??= body.userMessage;
  return body;
}
