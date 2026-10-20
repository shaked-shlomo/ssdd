// Tests for prod-guard.mjs: the payloads it reads, the output each harness
// gets, project rules, packs, and failing closed. Packs here are test packs
// written into a scratch "installed layout" (<repo>/.ssdd/hooks + .ssdd/packs);
// the Supabase pack has its own tests in packs/supabase/.
// Run: node --test mechanisms/hooks/prod-guard.selftest.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const HOOKS = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const FAKE = `
export const name = 'fake';
export function validate(o) { return o.bad ? 'bad option' : ''; }
export function mentions(t) { return /\\bprod/.test(t); }
export function judgeShell(ctx) {
  const out = [];
  for (const w of ctx.commands) {
    if (w[0] === 'prodwrite') out.push({ decision: 'ask', kind: 'writes', what: w.slice(0, 2).join(' ') });
    if (w[0] === 'prodmaybe') out.push({ decision: 'ask', kind: 'unclear', what: 'prodmaybe', why: 'a test' });
    if (w[0] === 'prodthrow') throw new Error('boom');
  }
  return out;
}
export function claims(call) { return call.tool.startsWith('fake_'); }
export function judgeMcp(call) {
  if (call.tool === 'fake_throw') throw new Error('mcp boom');
  return call.tool === 'fake_write' ? { decision: 'ask', kind: 'writes', what: 'MCP ' + call.tool } : null;
}
`;
const THROWER = `
export const name = 'thrower';
export function validate() { return ''; }
export function mentions() { return false; }
export function judgeShell() { throw new Error('always'); }
export function judgeMcp() { throw new Error('always'); }
`;

// A git repo whose .ssdd/hooks is a copy of this directory's hooks, with the
// given packs and config. → the repo path (real, for macOS's /private/var).
function layout({ packs = { fake: FAKE }, config } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ssdd-prodguard-')));
  dirs.push(root);
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, '.ssdd', 'hooks'), { recursive: true });
  for (const f of readdirSync(HOOKS)) if (f.endsWith('.mjs') && !f.includes('.selftest.')) copyFileSync(join(HOOKS, f), join(root, '.ssdd', 'hooks', f));
  for (const [name, src] of Object.entries(packs)) {
    mkdirSync(join(root, '.ssdd', 'packs', name), { recursive: true });
    writeFileSync(join(root, '.ssdd', 'packs', name, 'guard.mjs'), src);
  }
  if (config !== undefined) writeFileSync(join(root, '.ssdd', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return root;
}

function run(repo, payload, { hook = join(repo, '.ssdd', 'hooks', 'prod-guard.mjs'), env = {} } = {}) {
  const r = spawnSync(NODE, [hook], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    cwd: repo,
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', SSDD_PROJECT_DIR: '', ...env },
    encoding: 'utf8',
  });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { out = { unparsable: r.stdout }; }
  return { status: r.status, out, stdout: r.stdout, stderr: r.stderr };
}
const claude = (repo, command, opts) =>
  run(repo, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: repo }, { ...opts, env: { CLAUDE_PROJECT_DIR: repo } });
const cursor = (repo, command, opts) => run(repo, { hook_event_name: 'beforeShellExecution', command, cwd: repo }, opts);
const claudeMcp = (repo, tool, input = {}) =>
  run(repo, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: repo }, { env: { CLAUDE_PROJECT_DIR: repo } });
const cursorMcp = (repo, tool, input, server = 'x') =>
  run(repo, { hook_event_name: 'beforeMCPExecution', tool_name: tool, tool_input: input, mcp_server_name: server, workspace_roots: [repo] });

// The verdict either harness printed: 'allow' | 'ask' | 'deny', and the reason.
function verdict(r) {
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  if (r.out === null) return { decision: 'allow', reason: '' };
  if (r.out.hookSpecificOutput) {
    assert.equal(r.out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(r.out.permission, undefined, 'Claude Code gets its own shape only');
    return { decision: r.out.hookSpecificOutput.permissionDecision, reason: r.out.hookSpecificOutput.permissionDecisionReason };
  }
  return { decision: r.out.permission, reason: r.out.agent_message ?? '' };
}
const ASK_CLAUDE = "[ssdd-prod-guard] prodwrite x writes to production outside the merge path (migrations on merge to main). Approve only if the owner OK'd it.";

describe('prod-guard', () => {
  it('no rule, no pack: a command passes', () => {
    const repo = layout({ packs: {} });
    const c = claude(repo, 'ls', { hook: join(HOOKS, 'prod-guard.mjs') });
    assert.equal(c.status, 0);
    assert.equal(c.stdout, '', 'an allow prints nothing in Claude Code');
    assert.deepEqual(cursor(repo, 'ls', { hook: join(HOOKS, 'prod-guard.mjs') }).out, { permission: 'allow' });
  });

  it("a pack's ask, beside pipes and redirections", () => {
    const repo = layout();
    const c = verdict(claude(repo, 'prodwrite x 2>&1 | tail -5 > out.txt'));
    assert.deepEqual(c, { decision: 'ask', reason: ASK_CLAUDE });
    const r = cursor(repo, 'prodwrite x 2>&1 | tail -5');
    const v = verdict(r);
    assert.equal(v.decision, 'deny');
    assert.equal(r.out.user_message, r.out.agent_message);
    assert.match(v.reason, /^\[ssdd-prod-guard\] prodwrite x writes to production outside the merge path/);
    assert.match(v.reason, /Cursor can't ask, so this is refused: the owner runs it in their own terminal\.$/);
  });

  it('a call no pack claims passes', () => {
    const repo = layout();
    assert.equal(claude(repo, 'grep -rn prod docs | jq . > x').stdout, '');
    assert.deepEqual(cursor(repo, 'ls').out, { permission: 'allow' });
  });

  it('an unclear reason says so', () => {
    const repo = layout();
    const v = verdict(claude(repo, 'prodmaybe'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /^\[ssdd-prod-guard\] can't tell what prodmaybe does: a test\./);
  });

  it('writePath appears in the reason', () => {
    const repo = layout({ config: { productionGuard: { writePath: 'the CI deploy' } } });
    assert.match(verdict(claude(repo, 'prodwrite x')).reason, /\(the CI deploy\)/);
  });

  it("a project rule asks; a mention doesn't", () => {
    const rule = { match: '\\bvercel\\s+deploy\\b.*--prod\\b', decision: 'ask', reason: 'deploys to production' };
    const repo = layout({ packs: {}, config: { productionGuard: { extraRules: [rule] } } });
    const v = verdict(claude(repo, 'npx vercel deploy --prod'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /deploys to production/);
    assert.equal(verdict(cursor(repo, 'npx vercel deploy --prod')).decision, 'deny');
    for (const cmd of ['git commit -m "vercel deploy --prod"', "echo 'vercel deploy --prod'", 'vercel deploy',
      'echo vercel deploy --prod', "printf '%s\\n' run vercel deploy --prod"]) {
      assert.equal(verdict(claude(repo, cmd)).decision, 'allow', cmd);
    }
  });

  it('a quoted command name or option still matches a rule', () => {
    const rule = { match: '\\bvercel\\s+deploy\\b.*--prod\\b', decision: 'ask', reason: 'deploys to production' };
    const repo = layout({ packs: {}, config: { productionGuard: { extraRules: [rule] } } });
    for (const cmd of ['"vercel" deploy --prod', "vercel deploy '--prod'", 'vercel "deploy" --prod']) {
      assert.equal(verdict(claude(repo, cmd)).decision, 'ask', cmd);
    }
    assert.equal(verdict(claude(repo, 'git commit -m "vercel deploy --prod"')).decision, 'allow');
  });

  it("a rule sees a command it can't parse", () => {
    const rule = { match: '\\bvercel\\s+deploy\\b.*--prod\\b', decision: 'deny', reason: 'deploys to production' };
    const repo = layout({ packs: {}, config: { productionGuard: { extraRules: [rule] } } });
    const v = verdict(claude(repo, "vercel deploy --prod 'unbalanced"));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /can't be parsed/);
  });

  it('an MCP rule matches the same name under both harnesses', () => {
    const repo = layout({ packs: {}, config: { productionGuard: { extraRules: [{ match: '^mcp__srv__deploy$', decision: 'ask', reason: 'deploys' }] } } });
    assert.equal(verdict(claudeMcp(repo, 'mcp__srv__deploy')).decision, 'ask');
    assert.equal(verdict(cursorMcp(repo, 'deploy', '{}', 'srv')).decision, 'deny');
    assert.equal(verdict(cursorMcp(repo, 'deploy', '{}', 'other')).decision, 'allow');
  });

  it('an MCP rule may name the bare tool, and Cursor without a server name uses the URL host', () => {
    const repo = layout({ packs: {}, config: { productionGuard: { extraRules: [
      { match: '^deploy$', decision: 'ask', reason: 'deploys' },
      { match: '^mcp__mcp\\.example\\.com__push$', decision: 'ask', reason: 'pushes' },
    ] } } });
    assert.equal(verdict(claudeMcp(repo, 'mcp__srv__deploy')).decision, 'ask');
    assert.equal(verdict(cursorMcp(repo, 'deploy', '{}', 'srv')).decision, 'deny');
    const noName = run(repo, { hook_event_name: 'beforeMCPExecution', tool_name: 'push', tool_input: '{}', url: 'https://mcp.example.com/mcp', workspace_roots: [repo] });
    assert.equal(verdict(noName).decision, 'deny');
  });

  it('a deny rule denies', () => {
    const repo = layout({ packs: {}, config: { productionGuard: { extraRules: [{ match: '^rm -rf /$', decision: 'deny', reason: 'no' }] } } });
    const v = verdict(claude(repo, 'rm -rf /'));
    assert.equal(v.decision, 'deny');
    assert.doesNotMatch(v.reason, /Approve only/);
  });

  it("a rule matches an MCP call by its tool name", () => {
    const repo = layout({ packs: {}, config: { productionGuard: { extraRules: [{ match: '__deploy$', decision: 'ask', reason: 'deploys' }] } } });
    assert.equal(verdict(claudeMcp(repo, 'mcp__x__deploy')).decision, 'ask');
    assert.equal(verdict(claudeMcp(repo, 'mcp__x__list')).decision, 'allow');
  });

  it('a bad productionGuard asks on every call, naming the error', () => {
    const repo = layout({ config: { productionGuard: { extraRules: [{ match: '(' }] } } });
    const v = verdict(claude(repo, 'ls'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /productionGuard/);
    assert.equal(verdict(cursor(repo, 'ls')).decision, 'deny');
    assert.equal(verdict(claudeMcp(repo, 'mcp__x__list')).decision, 'ask');
  });

  it('a config that is not JSON asks on every call', () => {
    const repo = layout({ config: '{ not json' });
    assert.match(verdict(claude(repo, 'ls')).reason, /config\.json/);
  });

  it("another section's error doesn't", () => {
    const repo = layout({ config: { routing: 'x' } });
    assert.equal(verdict(claude(repo, 'ls')).decision, 'allow');
    assert.equal(verdict(claude(repo, 'prodwrite x')).decision, 'ask');
  });

  it('a guard error asks when the call names a pack marker', () => {
    const repo = layout();
    const v = verdict(claude(repo, 'prodthrow now'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /guard error: boom/);
    assert.equal(verdict(cursor(repo, 'prodthrow now')).decision, 'deny');
  });

  it("…and allows when it doesn't", () => {
    const repo = layout({ packs: { thrower: THROWER } });
    assert.equal(verdict(claude(repo, 'ls')).decision, 'allow');
    assert.equal(verdict(claudeMcp(repo, 'mcp__x__y')).decision, 'allow');
  });

  it("a pack that won't load asks on every call, naming it", () => {
    const repo = layout({ packs: { fake: FAKE, broken: 'export const = ;' } });
    const v = verdict(claude(repo, 'ls'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /broken/);
  });

  it("a pack's bad options ask on what it judges", () => {
    const repo = layout({ config: { productionGuard: { fake: { bad: true } } } });
    const v = verdict(claude(repo, 'prodwrite x'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /bad option/);
    assert.equal(verdict(claude(repo, 'ls')).decision, 'allow');
  });

  it("…including an MCP call the pack claims on a server whose name doesn't say so", () => {
    const repo = layout({ config: { productionGuard: { fake: { bad: true } } } });
    const v = verdict(claudeMcp(repo, 'mcp__ba176f8c-ba86-458b-b61a-71583c653bd4__fake_write'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /bad option/);
    assert.equal(verdict(claudeMcp(repo, 'mcp__ba176f8c-ba86-458b-b61a-71583c653bd4__other')).decision, 'allow');
  });

  it('a guard error on an MCP call the pack claims asks', () => {
    const repo = layout();
    const v = verdict(claudeMcp(repo, 'mcp__ba176f8c-ba86-458b-b61a-71583c653bd4__fake_throw'));
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /guard error: mcp boom/);
  });

  it('an unreadable payload is refused with exit 2', () => {
    const repo = layout();
    const r = run(repo, 'not json');
    assert.equal(r.status, 2);
    assert.equal(r.out.permission, 'deny');
    assert.match(r.stderr, /can't read the hook payload/);
  });

  it("Cursor's MCP payload: tool_input is a JSON string", () => {
    const repo = layout();
    assert.equal(verdict(cursorMcp(repo, 'fake_write', '{"a":1}')).decision, 'deny');
    assert.equal(verdict(cursorMcp(repo, 'fake_read', '{"a":1}')).decision, 'allow');
    const v = verdict(cursorMcp(repo, 'fake_read', '{'));
    assert.equal(v.decision, 'deny');
    assert.match(v.reason, /can't tell what MCP fake_read does: its input isn't JSON/);
  });

  it("Claude Code's MCP payload", () => {
    const repo = layout();
    assert.equal(verdict(claudeMcp(repo, 'mcp__srv__fake_write', { a: 1 })).decision, 'ask');
    assert.equal(claudeMcp(repo, 'mcp__srv__list_things').stdout, '');
  });

  it('a payload without hook_event_name: tool_input nested is Claude Code', () => {
    const repo = layout();
    const r = run(repo, { tool_input: { command: 'prodwrite x' } }, { env: { CLAUDE_PROJECT_DIR: repo } });
    assert.equal(verdict(r).decision, 'ask');
    assert.ok(r.out.hookSpecificOutput);
    const c = run(repo, { command: 'prodwrite x', cwd: repo });
    assert.equal(c.out.permission, 'deny');
  });
});
