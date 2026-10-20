#!/usr/bin/env node
// SSDD production guard — production changes go one sanctioned way (the
// project's writePath, by default migrations on merge to main). Anything else
// that would change production asks a person first, with an accurate reason;
// reads don't ask. Runs on Claude Code PreToolUse (Bash and mcp__.*) and on
// Cursor beforeShellExecution / beforeMCPExecution (.cursor/hooks.json).
//
// What it judges:
//   - each simple command of a Bash call (shell-view.mjs: nested ones too —
//     `bash -c`, `eval`, `$(…)`, a heredoc fed to a shell), never the call's
//     shape: `| tail`, `2>&1` and `> file` beside a production command change
//     nothing
//   - productionGuard.extraRules in .ssdd/config.json: {match, decision:
//     ask|deny, reason}, tested against each command with each quoted word
//     that holds whitespace blanked (a commit message that mentions a command
//     isn't the command; a quoted `"vercel"` or `'--prod'` is still read), or
//     against an MCP call as `mcp__<server>__<tool>` under both harnesses
//     (Cursor's server is mcp_server_name, else the URL's host) or as the
//     bare tool name. A
//     rule that matches text the shell view can't parse asks.
//   - every pack installed beside this file (../packs/<name>/guard.mjs), with
//     its options from productionGuard.<name>. A pack exports name,
//     validate(options) → '' | error, mentions(text) → boolean,
//     judgeShell(ctx) → Verdict[] and judgeMcp(call, ctx) → Verdict | null,
//     and optionally claims(call) → boolean (an MCP call it judges, whatever
//     its server is called; a broken option or a guard error then asks),
//     where Verdict = { decision: 'ask'|'deny', kind: 'writes'|'unclear'|
//     'personal', what, why? }.
//
// Output: Claude Code gets hookSpecificOutput.permissionDecision ask/deny, and
// nothing at all on an allow (an "allow" would approve the call past the
// user's own permission rules). Cursor gets {"permission": …} every time, and
// an ask becomes deny: Cursor's hooks don't enforce ask (SPEC v3 Part 4,
// Clarify 28), so the owner runs the command in their own terminal.
//
// Failing closed (a PreToolUse hook that throws exits 1, which Claude Code
// reads as allow): a config that can't be read, or a bad productionGuard,
// asks on every call; a pack that won't load asks on every call; a pack with
// bad options asks on the calls it would judge; a guard error asks when the
// call names a marker a pack or rule claims, and allows otherwise (a bug
// mustn't ask on every `ls`); an unreadable payload is refused with exit 2,
// which both harnesses read as a block. Read-only; never mutates.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  hookCommand, hookHarness, hookMcpCall, hookPermissionBody, parseHookStdin, resolveHookRepo,
} from './stdin-payload.mjs';
import { DEFAULT_WRITE_PATH, loadSsddConfig } from './ssdd-config.mjs';
import { shellCommands } from './shell-view.mjs';

const PREFIX = '[ssdd-prod-guard] ';
const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'packs');
const RANK = { allow: 0, ask: 1, deny: 2 };

const write = (body) => process.stdout.write(JSON.stringify(body) + '\n');

function reasonText(v, writePath) {
  switch (v.kind) {
    case 'writes': return `${v.what} writes to production outside the merge path (${writePath}).`;
    case 'personal': return `${v.what} reads personal data: ${v.why}.`;
    case 'rule': return `${v.what}: ${v.why} (productionGuard.extraRules).`;
    case 'broken': return `${v.why} — prod-guard can't judge this call until that's fixed.`;
    default: return `can't tell what ${v.what} does: ${v.why}.`;
  }
}

function emit(harness, verdicts, writePath) {
  const decision = verdicts.reduce((d, v) => (RANK[v.decision] > RANK[d] ? v.decision : d), 'allow');
  if (decision === 'allow') {
    if (harness === 'cursor') write(hookPermissionBody('allow'));
    return;
  }
  const texts = [...new Set(verdicts.filter((v) => v.decision === decision).map((v) => reasonText(v, writePath)))];
  const reason = PREFIX + texts.slice(0, 3).join(' ') + (texts.length > 3 ? ` (+${texts.length - 3} more)` : '');
  if (harness === 'claude') {
    const suffix = decision === 'ask' ? " Approve only if the owner OK'd it." : '';
    write({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason + suffix } });
  } else {
    const msg = reason + (decision === 'ask' ? " Cursor can't ask, so this is refused: the owner runs it in their own terminal." : '');
    write(hookPermissionBody('deny', { agentMessage: msg, userMessage: msg }));
  }
}

// Every pack beside this file → [{ name, mod }]. Throws { pack, error } for
// one that won't load or doesn't export the contract.
async function loadPacks() {
  if (!existsSync(PACKS)) return [];
  const names = readdirSync(PACKS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PACKS, e.name, 'guard.mjs'))).map((e) => e.name).sort();
  const packs = [];
  for (const name of names) {
    let mod;
    try { mod = await import(pathToFileURL(join(PACKS, name, 'guard.mjs')).href); } catch (error) { throw { pack: name, error }; }
    for (const fn of ['validate', 'mentions', 'judgeShell', 'judgeMcp']) {
      if (typeof mod[fn] !== 'function') throw { pack: name, error: new Error(`no ${fn}()`) };
    }
    packs.push({ name, mod });
  }
  return packs;
}

const tryRegex = (src) => { try { return new RegExp(src); } catch { return null; } };
// Does a pack claim this call? An MCP call it says it judges (a connector
// named by a UUID never mentions the stack), or a call naming its markers.
const claimed = (mod, call, subject) =>
  Boolean((call && typeof mod.claims === 'function' && mod.claims(call)) || mod.mentions(subject));
// A command's text for project rules: a quoted word with whitespace in it is
// a message or a script, not part of the command, so it's blanked. A quoted
// single word (`"vercel"`, `'--prod'`) is read as the shell reads it.
const ruleText = (words) => words.map((w, i) => (words.quoted?.[i] && /\s/.test(w) ? '""' : w)).join(' ');

async function main() {
  const payload = parseHookStdin(readFileSync(0, 'utf8'));
  if (payload === null || typeof payload !== 'object') {
    const msg = `${PREFIX}can't read the hook payload, so this call is refused.`;
    write(hookPermissionBody('deny', { agentMessage: msg, userMessage: msg }));
    process.stderr.write(msg + '\n');
    process.exitCode = 2;
    return;
  }
  const harness = hookHarness(payload);
  let writePath = DEFAULT_WRITE_PATH;
  let subject = '';
  let packs = [];
  let rules = [];
  try {
    const call = hookMcpCall(payload);
    const command = call ? '' : String(hookCommand(payload) ?? '');
    const mcpName = call ? `mcp__${call.server}__${call.tool}` : '';
    subject = call ? `${mcpName} ${JSON.stringify(call.input ?? payload.tool_input ?? '')}` : command;
    if (!call && !command.trim()) return emit(harness, [], writePath);

    const loaded = loadSsddConfig(resolveHookRepo(payload));
    const pg = loaded?.cfg?.productionGuard ?? { writePath, extraRules: [] };
    writePath = pg.writePath ?? writePath;
    if (loaded?.error && (!loaded.sectionErrors || loaded.sectionErrors.productionGuard)) {
      return emit(harness, [{ decision: 'ask', kind: 'broken', why: loaded.error }], writePath);
    }
    rules = pg.extraRules ?? [];
    try {
      packs = await loadPacks();
    } catch ({ pack, error }) {
      return emit(harness, [{ decision: 'ask', kind: 'broken', why: `the ${pack} pack can't load (${error?.message ?? error})` }], writePath);
    }

    const verdicts = [];
    const ctx = { raw: call ? '' : command, cwd: payload.cwd || loaded?.root || process.cwd(), root: loaded?.root ?? null, commands: [], unparsed: [] };
    if (call) {
      if (call.inputError) verdicts.push({ decision: 'ask', kind: 'unclear', what: `MCP ${call.tool}`, why: call.inputError });
      for (const r of rules) {
        const re = tryRegex(r.match);
        if (re?.test(mcpName) || re?.test(call.tool)) {
          verdicts.push({ decision: r.decision, kind: 'rule', what: `MCP ${call.tool}`, why: r.reason ?? `matches /${r.match}/` });
        }
      }
    } else {
      Object.assign(ctx, shellCommands(command));
      for (const r of rules) {
        const re = tryRegex(r.match);
        for (const words of ctx.commands) {
          if (re?.test(ruleText(words))) verdicts.push({ decision: r.decision, kind: 'rule', what: words.join(' '), why: r.reason ?? `matches /${r.match}/` });
        }
        for (const text of ctx.unparsed) {
          if (re?.test(text)) verdicts.push({ decision: 'ask', kind: 'unclear', what: 'this command', why: `it can't be parsed, and it matches productionGuard.extraRules /${r.match}/` });
        }
      }
    }
    for (const { name, mod } of packs) {
      const options = pg[name] ?? {};
      const bad = mod.validate(options);
      if (bad) {
        if (claimed(mod, call, subject)) verdicts.push({ decision: 'ask', kind: 'broken', why: `productionGuard.${name}: ${bad}` });
        continue;
      }
      const packCtx = { ...ctx, options, packDir: join(PACKS, name) };
      if (call) {
        if (call.inputError) continue;
        const v = mod.judgeMcp(call, packCtx);
        if (v) verdicts.push(v);
      } else {
        verdicts.push(...(mod.judgeShell(packCtx) ?? []));
      }
    }
    return emit(harness, verdicts, writePath);
  } catch (e) {
    let named = rules.some((r) => tryRegex(r.match)?.test(subject));
    let call = null;
    try { call = hookMcpCall(payload); } catch { /* judged by text alone */ }
    for (const { mod } of packs) { try { named ||= claimed(mod, call, subject); } catch { named = true; } }
    const verdicts = named ? [{ decision: 'ask', kind: 'unclear', what: 'this call', why: `guard error: ${e?.message ?? e}` }] : [];
    return emit(harness, verdicts, writePath);
  }
}

main().catch((e) => {
  // Only reached if writing the verdict itself failed: refuse, as for an unreadable payload.
  process.stderr.write(`${PREFIX}guard error: ${e?.message ?? e}\n`);
  process.exitCode = 2;
});
