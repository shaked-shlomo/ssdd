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

// Which harness sent the payload. Claude Code names the event PreToolUse;
// Cursor names its own (beforeShellExecution, beforeMCPExecution). Without
// a name, Claude Code is the one that nests tool_input as an object.
export function hookHarness(payload) {
  const event = payload?.hook_event_name;
  if (event === 'PreToolUse') return 'claude';
  if (event) return 'cursor';
  return payload?.tool_input !== null && typeof payload?.tool_input === 'object' ? 'claude' : 'cursor';
}

// An MCP call → { server, tool, input, url, inputError }, or null for any
// other tool. Claude Code: tool_name `mcp__<server>__<tool>`, tool_input an
// object. Cursor (beforeMCPExecution): the bare tool name, the server in
// mcp_server_name / url, and tool_input as a JSON *string*; one that won't
// parse sets inputError. Without mcp_server_name, the server is the URL's host.
export function hookMcpCall(payload) {
  const name = String(payload?.tool_name ?? '');
  const parts = name.split('__');
  const prefixed = parts.length >= 3 && parts[0] === 'mcp';
  const cursor = payload?.hook_event_name === 'beforeMCPExecution';
  if (!prefixed && !cursor) return null;
  const tool = prefixed ? parts[parts.length - 1] : name;
  const url = String(payload?.url ?? payload?.mcp_server_url ?? '');
  let server = cursor ? String(payload?.mcp_server_name ?? '') : parts.slice(1, -1).join('__');
  if (!server && url) { try { server = new URL(url).hostname; } catch { /* not a URL: no server name */ } }
  let input = payload?.tool_input ?? null;
  let inputError = '';
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = null; inputError = "its input isn't JSON"; }
  }
  if (input !== null && typeof input !== 'object') { input = null; inputError = "its input isn't a JSON object"; }
  return { server, tool, input, url, inputError };
}

// Cursor deny output is snake_case; keep camelCase so existing Claude-side
// tests and any reader of agentMessage still see the same keys.
export function hookPermissionBody(permission, extra = {}) {
  const body = { permission, ...extra };
  if (body.agentMessage != null) body.agent_message ??= body.agentMessage;
  if (body.userMessage != null) body.user_message ??= body.userMessage;
  return body;
}
