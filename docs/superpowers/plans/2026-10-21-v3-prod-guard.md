# v3 Part 4 — The Production Guard and the Supabase Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anything that would change production outside the merge path asks a
person first, with an accurate reason; reads don't ask; Supabase knowledge
ships as a pack installed only where Supabase is used.

**Architecture:**
- `mechanisms/hooks/prod-guard.mjs` is the hook: Claude Code PreToolUse on
  `Bash` and `mcp__.*`, Cursor `beforeShellExecution` and
  `beforeMCPExecution`. It reads the payload, the config's
  `productionGuard`, and every pack beside it (`../packs/*/guard.mjs`),
  collects verdicts, and prints the harness's own output.
- `mechanisms/hooks/shell-view.mjs` lists every simple command a shell
  string would run, nested ones included (`bash -c`, `eval`, `$(…)`,
  backticks, a heredoc fed to a shell), ported from Hatedate's `shellView`.
- `packs/supabase/` holds the pack: `guard.mjs` (judges commands and MCP
  calls), `sql-lex.mjs` and `sql-readonly.mjs` (ported classifier),
  `detect.mjs`, `db-read.mjs`, a README, selftests and the replay fixture.
  It installs as managed files in `.ssdd/packs/supabase/`.
- `bin/ssdd.mjs` detects packs on `install`, records them in the lock, keeps
  them on `update`, and reports new matches in `status`.

**Tech Stack:** Node ≥ 18, ES modules, zero dependencies, the git CLI,
`node:test`.

**Spec:** `SPEC.md` → v3 → Part 4 (Goal, Evidence, Owner rulings, Design,
Clarify 28–43, AC26–AC38).

## Global Constraints

- Zero npm dependencies; nothing newer than Node 18.0 (no `toSorted`,
  `findLast`, `Object.groupBy`, `Set.prototype.union`, `fs.globSync`,
  `Array.fromAsync`, `.at(`).
- Tests are `*.selftest.mjs`. The suite command becomes
  `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs`
  (835 at `v3.1.1`). CI runs Node 18 and 24 on Linux; a git config key may
  be unset there. On macOS, compare temp paths through `realpathSync`.
- Every path to a verdict runs inside a `try`: a PreToolUse hook that
  throws exits 1, and Claude Code reads that as allow.
- Claude Code: an allow prints **nothing** (a `permissionDecision: "allow"`
  would approve the call past the user's own rules). Ask/deny print
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":…,"permissionDecisionReason":…}}`,
  exit 0.
- Cursor: always `{"permission":"allow"|"deny","user_message":…,"agent_message":…}`,
  exit 0; an ask becomes `deny` (Clarify 28).
- Reason text, exactly (prefix `[ssdd-prod-guard] `):
  - writes: `<what> writes to production outside the merge path (<writePath>).`
  - unclear: `can't tell what <what> does: <why>.`
  - personal: `<what> reads personal data: <names>.`
  - Claude suffix: ` Approve only if the owner OK'd it.`
  - Cursor suffix: ` Cursor can't ask, so this is refused: the owner runs it in their own terminal.`
  - `writePath` default: `migrations on merge to main`.
- Pack modules import only their own siblings; the hook passes the shell
  grammar in `ctx`.
- Never write to `~/Developer/prizma` or `~/Developer/Hatedate`. Real data
  runs in the scratchpad; transcripts are read-only. No real Supabase call.
- The committed replay fixture carries command shapes and SQL statement
  kinds only (Clarify 31): no private path, project ref, SQL text, commit
  text or token.

## Review Focus

- **A heredoc commit message or PR body naming `supabase db push`**
  (`git commit -F - <<'EOF'`, `gh pr create --body "$(cat <<'EOF' … EOF)"`)
  must pass → test in Task 5.
- **`supabase db query --linked -f <READ ONLY file> -o json 2>&1 | tail -5`**,
  the shape behind 26 of Hatedate's false positives, must pass → Task 5.
- **A `-f` path with a space, quoted** (`-f "/tmp/a b/q.sql"`) must be read,
  not refused → Task 5.
- **Cursor's MCP payload** (`tool_input` a JSON string, or a malformed one)
  is judged, or fails closed with a reason → Task 6.
- **`$(…)` with a parenthesis inside quotes** (`x=$(grep -c "f(" "$f")` in a
  loop that names supabase) must not ask: Hatedate's unparseable rule fired
  39 times, never on a write → Tasks 2 and 5.

---

### Task 1: `productionGuard` in the config

**Files:**
- Modify: `mechanisms/hooks/ssdd-config.mjs` (SECTIONS, a `productionGuardError`, `build`, header comment)
- Modify: `mechanisms/config.example.json` (a `productionGuard` section)
- Test: `mechanisms/hooks/ssdd-config.selftest.mjs`

**Interfaces:**
- Produces: `loadSsddConfig(repo)` → `{ root, cfg, error?, sectionErrors? }`.
  `sectionErrors` is `{ <section>: message }` for section-scoped errors;
  absent when the whole file is unreadable or not JSON (then `error` alone).
  `cfg.productionGuard` → `{ writePath: string, extraRules: Array<{match: string, decision: 'ask'|'deny', reason: string}>, ...packSections }`;
  `writePath` defaults to `'migrations on merge to main'`.
  A bad `productionGuard` is dropped from `cfg` (the defaults apply) and
  reported in both `error` and `sectionErrors.productionGuard`.

- [ ] **Step 1: Write the failing tests** in `ssdd-config.selftest.mjs`, `describe('productionGuard')`:
  - "defaults": no section → `cfg.productionGuard` deep-equals `{ writePath: 'migrations on merge to main', extraRules: [] }`, no `error`.
  - "keeps a valid section": `{ writePath: 'the CI deploy', extraRules: [{ match: '\\bvercel\\b.*--prod', decision: 'ask', reason: 'deploys' }], supabase: { liveExtensions: ['pg_net'] } }` → kept as given; no error.
  - "a bad section is a config error" — each of: `productionGuard: 'x'`; `writePath: 3`; `extraRules: {}`; an entry with `match: '('`; `decision: 'allow'`; `reason: 5`; `supabase: []` → `error` matches `/productionGuard/`, `sectionErrors.productionGuard` set, and `cfg.productionGuard.extraRules` is `[]`.
  - "another section's error doesn't name productionGuard": `routing: 'x'` → `sectionErrors.routing` set, `sectionErrors.productionGuard` undefined.
  - "an unreadable file has no sectionErrors": invalid JSON → `error` set, `sectionErrors` undefined.
  - "config.example.json's productionGuard is valid": load the example's section (source tree only; skip when absent, as the existing example test does).

- [ ] **Step 2: Run, expect FAIL**: `node --test mechanisms/hooks/ssdd-config.selftest.mjs`.

- [ ] **Step 3: Implement.** Add `['productionGuard', isObject, 'an object']` to SECTIONS; add `productionGuardError(pg)` → `''` or the first problem (`writePath` not a string; `extraRules` not a list of objects; `match` not a string that compiles; `decision` not `ask`/`deny`; `reason` present and not a string; any other key not an object — pack sections are validated by their pack). Collect section errors into `sectionErrors` alongside `errors`. In `build`, `productionGuard: { ...pg, writePath: typeof pg?.writePath === 'string' && pg.writePath.trim() ? pg.writePath.trim() : 'migrations on merge to main', extraRules: Array.isArray(pg?.extraRules) ? pg.extraRules : [] }`. Example config gets:

```json
"productionGuard": {
  "$comment": "prod-guard (.ssdd/hooks/prod-guard.mjs) asks before anything that would change production outside writePath. extraRules: {match (regex source, tested against each shell command with quoted words blanked, or an MCP call's tool name), decision: ask|deny, reason}. A pack's options sit under its name (see .ssdd/packs/<name>/README.md).",
  "writePath": "migrations on merge to main",
  "extraRules": []
}
```

- [ ] **Step 4: Run, expect PASS**, plus `node --test mechanisms/hooks/*.selftest.mjs` (no regression: git-guard and review-gate read `error` as before).

- [ ] **Step 5: Commit** `feat(config): productionGuard section, validated`.

---

### Task 2: `shell-view.mjs` — every command a shell string runs

**Files:**
- Create: `mechanisms/hooks/shell-view.mjs`
- Test: `mechanisms/hooks/shell-view.selftest.mjs`

**Interfaces:**
- Consumes: `splitCommands(cmd)` from `git-cmd.mjs`.
- Produces: `shellCommands(cmd: string, { maxDepth = 4 } = {})` →
  `{ commands: Array<string[] & { quoted: boolean[], depth: number, via: 'top'|'-c'|'eval'|'subst'|'heredoc' }>, unparsed: string[] }`.
  `unparsed` holds each text (top level or nested) that couldn't be read:
  an unbalanced quote, an unterminated heredoc or `$(`/backtick, or nesting
  past `maxDepth`. Callers decide whether an unparsed text matters.
- Produces: `heredocBodies(cmd)` is not exported; data heredocs never become commands.

- [ ] **Step 1: Write the failing tests.** A helper `names(cmd)` = the commands joined by spaces. Cases (from Hatedate's "wrapped / hidden invocations" suite):
  - top level: `"cd /tmp && supabase db push | tail -5"` → contains `supabase db push`, `tail -5`, `cd /tmp`.
  - `-c`: `"bash -c 'supabase db push'"`, `"sh -c \"supabase functions deploy x\""`, `"env -S 'supabase functions deploy x'"` → a command `supabase …` with `via: '-c'`.
  - eval: `"eval 'supabase db push'"` → `via: 'eval'`.
  - substitution: `'out="$(supabase db push)"'`, ``'echo "`supabase db push`"'``, `"x=$(echo $(supabase functions deploy f))"`, `'cat <<EOF\n$(supabase db push)\nEOF'` (unquoted delimiter expands) → `via: 'subst'`.
  - shell-fed heredoc: `"bash <<EOF\nsupabase db push\nEOF"` → `via: 'heredoc'`.
  - **data heredocs are not commands:** `"git commit -F - <<'EOF'\nfix: supabase db push docs\nEOF"`, `"cat <<'EOF'\n$(supabase db push)\nEOF"` (quoted delimiter), `"cat <<EOF\nsupabase db push\nEOF"` → no command starts `supabase`.
  - quotes are data: `'git commit -m "supabase db push is gone"'`, `"grep -n 'supabase db push' README.md"` → no `supabase` command.
  - **parentheses inside quotes:** `'for f in a b; do x=$(grep -c "f(" "$f"); echo $x supabase; done'` → `unparsed` is empty.
  - arithmetic isn't a heredoc: `"echo $((1<<2))\nsupabase db push\n2"` → contains `supabase db push`, `unparsed` empty.
  - comments: `"cd /tmp # <<y\nsupabase db push\ny"` → contains `supabase db push`.
  - unparsed: `"echo 'unbalanced; supabase db push"`, `'echo "$(supabase db push"'`, `"cat <<EOF\nno end"` → `unparsed.length === 1`.
  - depth: 6 nested `bash -c` levels → `unparsed` holds the innermost text.

- [ ] **Step 2: Run, expect FAIL** (`node --test mechanisms/hooks/shell-view.selftest.mjs`).

- [ ] **Step 3: Implement.** Port Hatedate's `shellView(s)` (comments dropped, quotes kept, real heredocs replaced by `__HEREDOC_n__` with `bodies[n]` and `expands[n]`, arithmetic copied, `null` when unbalanced) and `substitutions(s)` (inner texts of `$(…)` and backticks outside single quotes; `null` when unterminated). Then: `splitCommands(view.text)` gives the top-level commands; for each command, a shell (`bash sh zsh dash ksh fish`, by basename) with `-c` recurses on the word after `-c`; `env -S` recurses on its string; `eval` recurses on its remaining words joined; a shell command holding a `__HEREDOC_n__` word recurses on `bodies[n]`; every substitution in `view.text` and in each expanding body recurses with `via: 'subst'`. A heredoc fed to anything else is data. Depth counts recursion levels.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `feat(hooks): shell-view lists every command a shell string runs`.

---

### Task 3: `prod-guard.mjs` — the hook, rules, outputs, fail-closed

**Files:**
- Create: `mechanisms/hooks/prod-guard.mjs`
- Modify: `mechanisms/hooks/stdin-payload.mjs` (`hookHarness`, `hookMcpCall`)
- Test: `mechanisms/hooks/prod-guard.selftest.mjs`

**Interfaces:**
- Consumes: Task 1's `cfg.productionGuard` / `sectionErrors`; Task 2's `shellCommands`.
- Produces in `stdin-payload.mjs`:
  - `hookHarness(payload)` → `'claude'` when `hook_event_name === 'PreToolUse'`, or when it's absent and `tool_input` is an object; else `'cursor'`.
  - `hookMcpCall(payload)` → `null` for a shell call, else `{ server: string, tool: string, input: object|null, url: string, inputError: string }`. Claude: `tool_name` `mcp__<server>__<tool>` (tool = after the last `__`). Cursor: `tool_name` (bare, or prefixed: strip it), `mcp_server_name`, `url ?? mcp_server_url ?? ''`, and `tool_input` parsed from its JSON string (a parse failure sets `inputError`).
- Produces: the pack contract prod-guard loads from `<dir of prod-guard.mjs>/../packs/<name>/guard.mjs`:
  ```
  export const name: string
  export function validate(options: object): string            // '' when fine
  export function mentions(text: string): boolean              // the pack's markers, for fail-closed
  export function judgeShell(ctx): Verdict[]                    // [] when the pack claims nothing
  export function judgeMcp(call, ctx): Verdict | null
  Verdict = { decision: 'ask'|'deny', kind: 'writes'|'unclear'|'personal', what: string, why?: string }
  ctx = { raw: string, cwd: string, root: string|null, options: object, commands, unparsed, packDir: string }
  ```
  `options` is `cfg.productionGuard[name] ?? {}`. `cwd` is the payload's `cwd`, else the repo root, else `process.cwd()`.

- [ ] **Step 1: Write the failing tests.** Helpers: `claude(command, repo)` sends `{ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: repo }` with `CLAUDE_PROJECT_DIR=repo`; `cursor(command, repo)` sends `{ hook_event_name: 'beforeShellExecution', command, cwd: repo }`; `claudeMcp(tool, input)` / `cursorMcp(tool, input, server, url)` likewise. `run()` returns `{ status, out: parsed stdout or null, stderr }`. A scratch "installed layout" is built per suite: `<tmp>/repo/.ssdd/hooks/` gets a copy of every `mechanisms/hooks/*.mjs`, and `<tmp>/repo/.ssdd/packs/fake/guard.mjs` a test pack whose `judgeShell` asks `writes` on a command whose first word is `prodwrite`, asks `unclear` on `prodmaybe`, throws on `prodthrow`, and whose `mentions(t)` is `/\bprod/.test(t)`; `judgeMcp` asks on tool `fake_write`. Cases, each under both harnesses unless named:
  - "no rule, no pack: a command passes" — source-tree hook, `ls` → Claude: exit 0, **empty stdout**; Cursor: `{"permission":"allow"}`.
  - "a pack's ask" — `prodwrite x 2>&1 | tail -5` → Claude `permissionDecision: 'ask'`, reason `=== "[ssdd-prod-guard] prodwrite x writes to production outside the merge path (migrations on merge to main). Approve only if the owner OK'd it."` (`what` from the pack); Cursor `permission: 'deny'`, `agent_message` ends with `the owner runs it in their own terminal.`
  - "unclear reason" — `prodmaybe` → reason starts `[ssdd-prod-guard] can't tell what prodmaybe does:`.
  - "writePath appears" — config `writePath: 'the CI deploy'` → reason contains `(the CI deploy)`.
  - "a project rule asks; a mention doesn't" — rule `{ match: '\\bvercel\\s+deploy\\b.*--prod\\b', decision: 'ask', reason: 'deploys to production' }`: `vercel deploy --prod` asks; `git commit -m "vercel deploy --prod"` and `echo 'vercel deploy --prod'` pass.
  - "a deny rule denies" — Claude `permissionDecision: 'deny'`.
  - "a rule matches an MCP tool name" — rule `match: '__deploy$'`, `claudeMcp('mcp__x__deploy', {})` asks.
  - "a bad productionGuard asks on every call" — `extraRules: [{ match: '(' }]` → `ls` asks (Cursor denies), reason contains `productionGuard`.
  - "another section's error doesn't" — `routing: 'x'` → `ls` passes.
  - "a guard error asks when the call names a pack marker" — `prodthrow` → ask, reason contains `guard error`; exit 0.
  - "…and allows when it doesn't" — force an error on a plain call through a pack whose `judgeShell` always throws and `mentions` is false → `ls` passes, exit 0.
  - "a pack that won't load asks on every call" — `packs/broken/guard.mjs` with a syntax error → `ls` asks, reason names `broken`.
  - "a pack's bad options ask on what it judges" — `validate` returns `'bad'` for `{ bad: true }`; `prodwrite`… asks with `bad`; `ls` passes.
  - "an unreadable payload is refused" — stdin `not json` → stdout `{"permission":"deny",…}`, the reason on stderr, **exit 2**: the harness can't be told, and both read exit 2 as a block (Claude Code ignores stdout then; Cursor documents exit 2 as `deny`).
  - "Cursor MCP payload, tool_input as a string" — `cursorMcp('fake_write', '{"a":1}')` → deny; malformed `'{'` → deny with `can't tell`, reason mentions the input.
  - "Claude MCP, no pack claims it" — `mcp__x__list_things` → empty stdout.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `prod-guard.mjs`.** One top-level `try` around everything; the `catch` decides with `mentions` over the raw input (any loaded pack) or a rule's match, asking `unclear` with `why: 'guard error: <message>'`, else allows. Steps: parse payload (`parseHookStdin`; `null` → the both-keys ask); `harness = hookHarness(p)`; `call = hookMcpCall(p)`; `loaded = loadSsddConfig(resolveHookRepo(p))`; a `loaded.error` with no `sectionErrors`, or with `sectionErrors.productionGuard`, asks on everything with `why: <error>`; load packs with `readdirSync` + `await import(pathToFileURL(...))` (a load failure asks on everything); per pack, `validate(options)`, and a non-empty result makes that pack's claimed calls (its `mentions` over the raw text) ask with that error. Shell: `shellCommands(raw)`; extraRules run per command on `words.map((w, i) => (words.quoted[i] ? '""' : w)).join(' ')`; packs' `judgeShell(ctx)`. MCP: extraRules on `p.tool_name`; packs' `judgeMcp(call, ctx)`. Any `deny` → deny; else any `ask` → ask; reasons in order, deduped, the first three joined by a space. Header comment in git-guard's style.

- [ ] **Step 4: Run, expect PASS**, plus the whole hooks suite.

- [ ] **Step 5: Commit** `feat(hooks): prod-guard — ask before production writes outside the merge path`.

---

### Task 4: The Supabase pack's SQL classifier

**Files:**
- Create: `packs/supabase/sql-lex.mjs` (Hatedate's `lib/sql-lex.mjs`, verbatim but the header)
- Create: `packs/supabase/sql-readonly.mjs`
- Test: `packs/supabase/sql.selftest.mjs`

**Interfaces:**
- Produces: `classifySql(raw: string, opts = {})` →
  `{ verdict: 'read'|'proof'|'writes'|'unclear', rule: string, personal?: string[] }`.
  `opts = { proofFrame?: { prologue: string[], epilogue: string[] }, liveExtensions?: string[], personalReads?: { tables?: string[], columns?: string[] } }`.
  Rules (the `rule` string): `'read-only transaction'`, `'static read'`, `'proof frame'`, `'<KIND> statement'` for writes (e.g. `'INSERT statement'`, `'rolled back ALTER statement'` inside a `BEGIN … ROLLBACK`), and for unclear the reason (`'names client_encoding'`, `'calls public.f'`, `'unterminated string'`, `'proof frame not configured'`, `'SET statement'`, `'no statements'`).
- Produces: `statementKinds(raw)` → `string[]`, one per top-level statement: its leading keyword, upper case, with `BEGIN READ ONLY` / `START TRANSACTION READ ONLY` kept whole (for the replay fixture).

- [ ] **Step 1: Write the failing tests.** Port Hatedate's two suites as unit tests on `classifySql` (they carry no private data): every "allows (SKILL shape)" and "no prompt" case → `verdict` `read` or `proof`; every "asks -f" / "still asks" case → not `read`/`proof`. The helper-built proof becomes a fixture string: `opts.proofFrame` = Hatedate's `PROOF_PROLOGUE` / `PROOF_EPILOGUE` arrays, copied into the test (the frame text is generic). New cases:
  - "a static read passes without READ ONLY": `select 1`, `select count(*) from pg_policies; select has_table_privilege('a','public.users','DELETE');`, `BEGIN; SELECT 1; ROLLBACK;` → `{ verdict: 'read', rule: 'static read' }`.
  - "lookups the corpus uses": `select to_regprocedure('public.f(text)') is null`, `select to_regclass('public.t')`, `select (aclexplode(relacl)).privilege_type from pg_class`, `select enum_range(null::t)` → `read`.
  - "writes are named": `BEGIN; INSERT INTO t VALUES (1); COMMIT;` → `{ verdict: 'writes', rule: 'INSERT statement' }`; `BEGIN; ALTER POLICY p ON t TO authenticated; UPDATE t SET a = 1; ROLLBACK;` → `writes`, rule starts `rolled back`; `truncate table t` → `writes`.
  - "unclear, with the rule": `SELECT current_setting('client_encoding')` → `{ verdict: 'unclear', rule: 'names client_encoding' }`; `select public.f()` → rule `calls public.f`; `select set_config('a','b',true)` → `unclear`; `SET search_path = x; select 1` → `unclear`.
  - "a proof without a configured frame is unclear": the helper proof with no `opts.proofFrame` → `{ verdict: 'unclear', rule: 'proof frame not configured' }`.
  - "live extensions come from opts": `CREATE EXTENSION IF NOT EXISTS pg_net` inside a framed proof → `proof` with `liveExtensions: ['pg_net']`, `unclear` without.
  - "personalReads": `opts.personalReads = { tables: ['auth.users'], columns: ['phone'] }` — `select email, phone from auth.users` → `{ verdict: 'read', personal: ['auth.users', 'phone'] }`; `select count(*) from public.matches` → no `personal`; a name inside a string (`select 'phone'`) → no `personal`.
  - `statementKinds('BEGIN READ ONLY; select 1; with x as (select 1) select * from x; ROLLBACK;')` → `['BEGIN READ ONLY', 'SELECT', 'WITH', 'ROLLBACK']`.

- [ ] **Step 2: Run, expect FAIL** (`node --test packs/supabase/sql.selftest.mjs`).

- [ ] **Step 3: Implement.** Port Hatedate's `sql-readonly.mjs`; `helperFramed` reads `opts.proofFrame` (head = prologue lines joined `\n` + `\n`, tail = `\n` + epilogue lines joined), and the timeout-name check keeps Hatedate's `TIMEOUTS` regex (`lock_timeout|statement_timeout|idle_in_transaction_session_timeout`) as a pack constant. `LIVE_EXTENSIONS` comes from `opts.liveExtensions` (plus `plpgsql`, always present). The static read: an optional first `BEGIN`/`START TRANSACTION` with modes but never `READ WRITE`, and a last `ROLLBACK`/`COMMIT`/`END`/`ABORT` only when a begin was stripped; every remaining statement meets rule (a)'s `RO_FIRST` / `FORBIDDEN` / `callsAllowed`, with the same `set_config`, out-of-band and lex-mode refusals. `READ ONLY` + `ROLLBACK` keeps the rule name `read-only transaction`. Writes: the first statement whose leading keyword is in the FORBIDDEN write set (not `SET`/`RESET`, which are unclear), or a data-modifying CTE. Extend `READ_ONLY_FNS` with the lookups and pure functions the corpus calls (Task 10 adds any it finds; each is a lookup or pure computation per the Postgres docs). `personalReads` matches table names (`schema.table` or bare) and column names as whole identifiers in the `names` channel, case-insensitive, quoted identifiers unquoted.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `feat(packs): the Supabase pack's SQL classifier, ported`.

---

### Task 5: The Supabase pack: the CLI, `db query`, detection

**Files:**
- Create: `packs/supabase/guard.mjs` (`name`, `validate`, `mentions`, `judgeShell`; `judgeMcp` returns `null` until Task 6)
- Create: `packs/supabase/detect.mjs`
- Create: `packs/supabase/guard.selftest.mjs` (an installed-layout scratch repo, as in Task 3)
- Create: `packs/supabase/test-layout.mjs` (test helper, imported by the pack's selftests: builds `<tmp>/repo/.ssdd/hooks` from the hook dir it finds — `../../hooks` when installed, `../../mechanisms/hooks` in the source tree — and links `.ssdd/packs/supabase` to the pack dir; returns `{ repo, claude, cursor, claudeMcp, cursorMcp, config(obj) }`)

**Interfaces:**
- Consumes: Task 3's contract; Task 4's `classifySql`.
- Produces: `detect(root: string)` → `string` (the evidence, e.g. `'supabase/config.toml'`, `'package.json: @supabase/supabase-js'`), `''` when none.
- Produces: `validate(options)` checks `proofFrame` (`{prologue: string[], epilogue: string[]}`), `liveExtensions` (string[]), `personalReads` (`{tables?: string[], columns?: string[]}`); any other key is an error.
- Produces: `mentions(t)` → `/supabase/i.test(t)`.

- [ ] **Step 1: Write the failing tests** (both harnesses; `ASK` / `PASS` tables like git-guard's):
  - **Hatedate's Bash and wrapped suites, ported** with their decisions, except: `supabase db reset` alone, `supabase storage cp ss:///b/x ./x`, the shape-only refusals of its strict path (`| jq`, `2>&1`, `cd /tmp &&`, `-o yaml`, `--debug`, `time`, a relative `-f` that is a read) now PASS when the SQL is a read; inline SQL that's a read PASSes.
  - **PASS:** `supabase db push --help`, `supabase db push -h`, `supabase db push --dry-run 2>&1 | tail -5`, `supabase db push --local`, `supabase db reset`, `supabase start`, `supabase status`, `supabase link --project-ref abc`, `supabase migration list --linked`, `supabase db lint --linked`, `supabase projects list`, `supabase storage ls ss:///b`, `git commit -F - <<'EOF'\nfix: supabase db push docs\nEOF`, `gh pr create --title t --body "$(cat <<'EOF'\nRun supabase db push\nEOF\n)"`, the Review Focus `$(…)` loop.
  - **ASK writes:** `supabase db push`, `supabase db reset --linked`, `supabase migration repair --status applied 1`, `supabase migration up --db-url postgres://u@db.abc.supabase.co/postgres`, `supabase functions deploy f`, `supabase config push`, `supabase secrets set A=b`, `supabase storage rm ss:///b/x`, `supabase storage cp ./a ss:///b/a`, `supabase projects delete abc`, `supabase branches create b`; each reason contains `writes to production outside the merge path`.
  - **`db query` against a remote:** a READ ONLY file `-o json 2>&1 | tail -5` PASS; a plain SELECT file PASS; inline `"select 1"` PASS; `--db-url postgres://u@127.0.0.1:54322/postgres "delete from t"` PASS (local); a write file asks `writes`; a `client_encoding` file asks `can't tell`; the framed proof PASS with `supabase.proofFrame` set and asks `can't tell … proof frame not configured` without; `-f "<dir with space>/q.sql"` (a read) PASS; a missing file, a 2 MB file, a directory, `-f $S/q.sql`, and `cat > q.sql <<'EOF' … EOF; supabase db query --linked -f q.sql` ask `can't tell`; a relative `-f q.sql` resolves against the payload `cwd` and passes when it's a read and no `cd` precedes it.
  - **Unparsed:** `echo 'unbalanced; supabase db push` asks `can't tell`; `echo 'unbalanced` (no supabase) passes.
  - **Bad options:** `supabase: { proofFrame: 'x' }` → `supabase db query --linked "select 1"` asks naming `proofFrame`; `ls` passes.
  - **detect:** a dir with `supabase/config.toml` → `'supabase/config.toml'`; `package.json` with `@supabase/supabase-js` in `dependencies` → `'package.json: @supabase/supabase-js'`; `supabase` in `devDependencies` → `'package.json: supabase'`; neither, or a broken `package.json` → `''`.

- [ ] **Step 2: Run, expect FAIL** (`node --test packs/supabase/guard.selftest.mjs`).

- [ ] **Step 3: Implement `judgeShell(ctx)`.** For each command in `ctx.commands`: find a word whose basename, lower-cased with `@version` cut, is `supabase` (Hatedate's rule, so runners and package runners need no list). Positionals after it skip flags and the values of `--workdir --profile -o --output --db-url -f --file -p --password --project-ref --network-id --dns-resolver`. `--help`/`-h` → nothing. Remote = `--linked`, `--linked=…`, or `--db-url` whose host isn't `localhost`/`127.0.0.1`/`::1`/`host.docker.internal`. `--local` → nothing. Write list and remote-only list per Clarify 38; management write verbs `create delete update remove add activate restore pause unpause set unset reverify` under any other top-level command. `db query` on a remote: the SQL is the `-f`/`--file` file or the first positional; both or neither → unclear (`'no SQL found'` / `'stdin'` when a `<` redirect follows). File rules: a literal path (no `$`, backtick, glob, leading `~`); relative only against `ctx.cwd` when no earlier command is `cd`/`pushd`/`popd`; regular, ≤ 1 MiB; its path and basename not elsewhere in `ctx.raw`. Verdicts: `classifySql(sql, ctx.options)` read/proof → nothing (personal → Task 7's ask), writes → ask `writes` (`what`: `supabase db query (<rule>)`), unclear → ask `unclear` (`why`: the rule). Any `ctx.unparsed` text with `mentions` → ask unclear `'the command can't be parsed'`. `detect(root)` reads `supabase/config.toml` and the root `package.json` (`dependencies`, `devDependencies`).

- [ ] **Step 4: Run, expect PASS**, plus Task 3's suite.

- [ ] **Step 5: Commit** `feat(packs): the Supabase pack judges the CLI and db query by what they do`.

---

### Task 6: The Supabase pack: MCP, HTTP, psql

**Files:**
- Modify: `packs/supabase/guard.mjs` (`judgeMcp`; HTTP and psql in `judgeShell`)
- Test: `packs/supabase/guard.selftest.mjs` (new `describe` blocks)

**Interfaces:**
- Consumes: `call = { server, tool, input, url, inputError }` (Task 3).
- Produces: pack constants `SUPABASE_ONLY_TOOLS`, `READ_TOOLS` (exported for the README's list and the tests).
  - `READ_TOOLS`: `confirm_cost generate_typescript_types get_advisors get_anon_key get_cost get_edge_function get_logs get_organization get_project get_project_url get_publishable_keys get_storage_config list_branches list_edge_functions list_extensions list_migrations list_organizations list_projects list_storage_buckets list_tables query_logs search_docs`.
  - `SUPABASE_ONLY_TOOLS`: `apply_migration execute_sql deploy_edge_function create_branch delete_branch merge_branch reset_branch rebase_branch list_branches list_migrations list_extensions list_tables list_edge_functions get_edge_function generate_typescript_types get_advisors get_publishable_keys get_anon_key get_project_url confirm_cost get_cost list_storage_buckets get_storage_config update_storage_config`.

- [ ] **Step 1: Write the failing tests** (Claude `mcp__<server>__<tool>`, Cursor `beforeMCPExecution`):
  - "recognized by": server `supabase-personal` with tool `pause_project`; Cursor `url: 'https://mcp.supabase.com/mcp'`; tool `apply_migration` on server `ba176f8c-ba86-458b-b61a-71583c653bd4`; `pause_project` with `{ project_id: 'abcdefghijklmnopqrst' }` on a UUID server → all ask.
  - "not Supabase": `pause_project` with `{ projectId: 'prj_x' }` on a UUID server → passes.
  - "known reads pass": `list_tables`, `get_advisors`, `search_docs`, `confirm_cost`.
  - "execute_sql": `select 1` passes; `insert into t values (1)` asks `writes`; `select public.f()` asks `can't tell`; Cursor's string input `'{"query":"select 1","project_id":"abcdefghijklmnopqrst"}'` passes; a missing `query` asks `can't tell`.
  - "every other tool asks": `apply_migration`, `deploy_edge_function`, `merge_branch`, `create_branch`, `delete_branch`, `restore_project`, and `brand_new_tool` with a project ref → ask; named writes say `writes`, an unknown tool says `can't tell what MCP brand_new_tool does`.
  - **HTTP:** `curl -s -H "Authorization: Bearer $TOKEN" https://api.supabase.com/v1/projects/abc/advisors/security | python3 -c 'import json'` passes; `curl -I https://abc.supabase.co/rest/v1/t` passes; `curl -X POST https://api.supabase.com/v1/projects/abc/database/query -d '{}'` asks `writes`; also `-XDELETE`, `--request PATCH`, `-d`, `--data-binary @f`, `--json '{}'`, `-F a=b`, `-T f`, `wget --method=POST`, `wget --post-data=x` against those hosts ask; `curl -X POST https://example.com` passes; `curl -X POST "$SUPABASE_URL/rest/v1/t"` asks `can't tell`; `node -e "fetch('https://api.supabase.com/v1/x',{method:'POST'})"` asks `can't tell`; `grep -rn api.supabase.com docs` passes.
  - **psql:** `psql "postgresql://u@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" -c "select 1"` passes; `-c "delete from t"` asks `writes`; `psql -h aws-0-eu.pooler.supabase.com -f q.sql` (a read file) passes; `psql "host=db.x.supabase.co" ` with no `-c`/`-f` asks `can't tell`; `psql "$DATABASE_URL" -c "select 1"` asks `can't tell`; `psql -h localhost -c "delete from t"` passes; `pg_dump "postgresql://…supabase.co/postgres"` passes.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** `isSupabaseCall(call)` per Clarify 34 (server `/supabase/i`, url host ends `supabase.com` or `supabase.co`, `SUPABASE_ONLY_TOOLS`, `input.project_id` matching `/^[a-z]{20}$/`). `judgeMcp`: not Supabase → `null`; `inputError` → unclear; `READ_TOOLS` → `null`; `execute_sql` → classify `input.query` (a non-string → unclear `'no query'`); named writes (`apply_migration deploy_edge_function merge_branch reset_branch rebase_branch create_branch delete_branch pause_project restore_project create_project update_storage_config`) → `writes` with `what: 'MCP <tool>'`; else unclear. HTTP: for a command whose word basename is `curl` or `wget`, the method is GET unless `-X`/`--request`/`-XM`, data/form/upload/json flags, `--method`, `--post-data`/`--post-file`; `-I`/`--head` is HEAD; `-G`/`--get` keeps GET. URL words: a literal host `api.supabase.com` or `*.supabase.co` → judged; a non-literal host in a word mentioning `supabase` → unclear when the method isn't GET/HEAD. Interpreters (`node deno bun python python3 ruby perl php` by basename) whose other words mention those hosts → unclear. psql per Clarify 35 (targets: a `postgres://`/`postgresql://` URL word, `-h`/`--host` value, a `host=` conninfo word, or `PGHOST=` in the command's assignments; Supabase host = ends `.supabase.co` or `.supabase.com`; a target word with `$` → unclear); `-c` values and `-f` files are judged as in `db query`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `feat(packs): the Supabase pack judges MCP calls, the HTTP APIs and psql`.

---

### Task 7: `db-read` and `personalReads`

**Files:**
- Create: `packs/supabase/db-read.mjs`
- Modify: `packs/supabase/guard.mjs` (the helper passes; personal asks)
- Test: `packs/supabase/db-read.selftest.mjs`, `packs/supabase/guard.selftest.mjs`

**Interfaces:**
- Produces: `node .ssdd/packs/supabase/db-read.mjs [--personal] [-o json|table|csv] [--workdir <dir>] "<sql>"`. Exit 2 with a one-line reason when the SQL isn't a read (nothing runs); otherwise spawns `supabase db query --linked -f <tmp> [-o fmt] [--workdir dir]`, inherits stdio, removes the temp dir, and exits with the CLI's status. The CLI is `process.env.SSDD_SUPABASE_BIN || 'supabase'`. The config's `supabase` options come from the repo of `cwd` via `loadSsddConfig`, imported as `../../hooks/ssdd-config.mjs` when installed, else `../../mechanisms/hooks/ssdd-config.mjs` (the one cross-dir import, resolved by existence; documented in the file header).

- [ ] **Step 1: Write the failing tests.** A fake CLI script (`#!/bin/sh`, writes its args and the `-f` file's content to `$OUT`) via `SSDD_SUPABASE_BIN`:
  - "a read runs wrapped": `db-read.mjs "select 1"` → exit 0; recorded args `db query --linked -f <tmp> `; the file is `BEGIN READ ONLY;\nselect 1;\nROLLBACK;\n`; the temp file is gone after.
  - "-o and --workdir pass through".
  - "a write is refused, nothing runs": `"delete from t"` → exit 2, stderr names `INSERT`/`DELETE statement`, `$OUT` absent.
  - "a COMMIT can't break out": `"select 1; commit; delete from t"` → exit 2.
  - "personal reads need --personal": with `personalReads.columns: ['phone']`, `"select phone from users"` → exit 2 naming `phone`; with `--personal` → exit 0.
  - guard: `node .ssdd/packs/supabase/db-read.mjs "select 1"` PASS under both harnesses, `node /abs/.ssdd/packs/supabase/db-read.mjs …` PASS, with `--personal` → ask `personal`; a `db query --linked "select phone from users"` with `personalReads` → ask `reads personal data: phone`; MCP `execute_sql` of the same → ask `personal`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** the helper (wrap = `BEGIN READ ONLY;\n` + sql trimmed with one trailing `;` + `\nROLLBACK;\n`; classify the wrapped text; require `rule === 'read-only transaction'`; `mkdtempSync` + `writeFileSync(…, { mode: 0o600 })`; `spawnSync` with `stdio: 'inherit'`; `rmSync` in `finally`). In `judgeShell`, a command whose word basename is `node` followed by a path ending `packs/supabase/db-read.mjs` → nothing, or `personal` when `--personal` is among its words. In both `db query` and `execute_sql`, a `read`/`proof` verdict with `personal` → ask `personal` (`why`: the names).

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `feat(packs): db-read, the read path that never asks; personalReads`.

---

### Task 8: Packs in `install`, `update` and `status`

**Files:**
- Modify: `bin/ssdd.mjs` (`plan`, `lockFrom`, `install`, `update`, `status`, arg docs, header; top-level `await run(target)`)
- Test: `bin/ssdd.selftest.mjs`

**Interfaces:**
- Produces: `packsIn(tree)` → sorted names of `tree/packs/*/` holding `guard.mjs`; `detectPacks(tree, target)` → `Array<{ name, evidence }>` (await-imports each `detect.mjs` from the exported tree); `parsePacks(value, tree)` → names (`'none'` → `[]`; an unknown name → `die`). `plan(tree, adapters, packs)` adds `packs/<n>/<f>` → `.ssdd/packs/<n>/<f>`. The lock gains `"packs": [...]`; a lock without it reads as `[]`.

- [ ] **Step 1: Write the failing tests** (the file's existing fixtures: an SSDD source repo with tagged commits; add `packs/supabase/{guard.mjs,detect.mjs}` stubs to a new tag):
  - "install detects supabase/config.toml" → stdout names `packs: supabase (supabase/config.toml)`; lock `packs` = `['supabase']`; `.ssdd/packs/supabase/guard.mjs` exists and is in `lock.managed`.
  - "install detects @supabase/supabase-js" — same through `package.json`.
  - "a repo without Supabase gets no pack" → `packs: []`, no `.ssdd/packs`.
  - "--packs none / --packs supabase override detection"; "--packs nope is an error" (exit 2, names `nope`).
  - "update keeps the lock's packs and never detects": install without Supabase, commit, add `supabase/config.toml`, commit, `update` → still `[]`; `update --packs supabase` → added; then `update --packs none` → the pack files removed.
  - "status names a pack the repo now matches" → stdout contains `matches the supabase pack (supabase/config.toml)` and `--packs supabase`.
  - "a lock from before packs updates with none" — a lock with no `packs` key → `update` → `packs: []`.

- [ ] **Step 2: Run, expect FAIL** (`node --test bin/ssdd.selftest.mjs`).

- [ ] **Step 3: Implement** per the Interfaces. `install` prints `packs: <names with evidence>` or `packs: none detected`; `--packs` beats detection. `update` uses `parsePacks(opt.packs)` when given, else `lock.packs ?? []`, filtered to `packsIn(newTree)` with a warning for a missing one. `status` prints `packs: …` from the lock, then runs `detectPacks` on the newest tag's tree for packs not installed, printing `NOTE: this repo matches the <n> pack (<evidence>), which isn't installed — run: update '<target>' --packs <current,n>`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `feat(installer): packs — detected at install, kept by the lock, reported by status`.

---

### Task 9: Wiring, end to end

**Files:**
- Modify: `adapters/claude-code/settings-hooks.json`, `adapters/cursor/hooks.json`, `adapters/claude-code/README.md`, `adapters/cursor/README.md`
- Modify: `.github/workflows/test.yml`, `README.md` (Development command), `bin/ssdd.mjs` (`nextSteps`' selftest line includes the packs)
- Test: `packs/supabase/guard.selftest.mjs` (`describe('installed by bin/ssdd.mjs')`)

**Interfaces:**
- Consumes: Task 8's install.

- [ ] **Step 1: Write the failing tests.**
  - "the adapters wire prod-guard": `settings-hooks.json` has `node "$CLAUDE_PROJECT_DIR/.ssdd/hooks/prod-guard.mjs"` under the `Bash` matcher and under a `mcp__.*` matcher; Cursor's `hooks.json` has `node .ssdd/hooks/prod-guard.mjs` with `failClosed: true` under `beforeShellExecution` and `beforeMCPExecution` (source tree only).
  - "installed end to end": `node bin/ssdd.mjs install <tmp repo with supabase/config.toml> claude-code,cursor --ref <this branch's HEAD>` (skip when not in the source tree); then, through `<repo>/.ssdd/hooks/prod-guard.mjs`: `supabase db push` asks (Claude) and is denied (Cursor); a READ ONLY file `-o json 2>&1 | tail -5` passes both; `mcp__x__apply_migration` asks.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Claude: add the prod-guard hook to the `Bash` entry and a new `{ "matcher": "mcp__.*", "hooks": [prod-guard] }`. Cursor: add to `beforeShellExecution`, and a `beforeMCPExecution` list. READMEs: one paragraph each on prod-guard (Cursor: `ask` isn't enforced, so it denies). CI and README's command add `packs/*/*.selftest.mjs`; `nextSteps` prints `node --test .ssdd/hooks/*.selftest.mjs .ssdd/packs/*/*.selftest.mjs` when packs are installed.

- [ ] **Step 4: Run, expect PASS**, then the whole suite.

- [ ] **Step 5: Commit** `feat(adapters): wire prod-guard in Claude Code and Cursor`.

---

### Task 10: The replay

**Files:**
- Create: `packs/supabase/replay.fixture.json`
- Create: `packs/supabase/replay.selftest.mjs`
- Modify: `packs/supabase/sql-readonly.mjs` (allowlist additions the replay finds, each with a test in `sql.selftest.mjs`)
- Scratch only (never committed): the builder and the real-SQL run, `<scratchpad>/replay/`.

**Interfaces:**
- Fixture: `{ "$comment", "source", "entries": [{ "id", "date", "tool": "Bash" | "mcp", "mcpTool"?, "command"?, "sql": [{ "ref": "file:<name>" | "inline:<n>" | "query", "kinds": string[], "verdict": "read"|"proof"|"writes"|"unclear", "rule": string }], "owner": "approved"|"rejected", "expect": "allow"|"ask", "kind"?: "writes"|"unclear", "unreplayable"?: string }] }`. Command placeholders: `<SP>` scratch dir, `<REPO>` project dir, `<REF>` project ref, `<SQL:n>` inline SQL, `<BODY>` a data heredoc's text.

- [ ] **Step 1: Build the corpus in the scratchpad.** Extend the clarify scripts: every entry of Clarify 30 (minus the self-test), each SQL's real verdict from Task 4's `classifySql` with Hatedate's frame and live extensions as the options, and the guard's real decision on the real command, run through an installed scratch layout. Write the redacted fixture; review it by eye for anything private (paths, refs, names, literals, commit text).
- [ ] **Step 2: Write the test**, expected to fail until Step 1's fixture lands: for each entry without `unreplayable`, build synthetic SQL from `kinds` + `rule` (a table in the test: `SELECT` → `SELECT 1`, `WITH` → `WITH x AS (SELECT 1) SELECT * FROM x`, `INSERT` → `INSERT INTO t VALUES (1)`, rule `names client_encoding` → `SELECT current_setting('client_encoding')` …), assert `classifySql` gives the recorded `verdict`, materialize the command, run the installed hook, and assert `expect`/`kind`. Then assert the totals: asks = the 2 writes + the 2 probes + the listed unclear ones; unreplayable count.
- [ ] **Step 3: Run on the real SQL** (scratch) and record per-entry results in the ledger; any read the allowlist misses gets a function added only if it's a lookup or pure (with a `sql.selftest.mjs` case), else stays an ask.
- [ ] **Step 4: prizma** — replay its 96 `execute_sql` calls through `judgeMcp` (scratch); record pass / writes / unclear. The 10 writes must ask `writes`.
- [ ] **Step 5: Commit** `test(packs): the Hatedate replay as a fixture`.

---

### Task 11: Docs and the pack's README

**Files:**
- Create: `packs/supabase/README.md` (what it judges, the options, `db-read`, the read-tool list, residues)
- Modify: `README.md` (How it works paragraph, What's in the box row `packs/`, Quick start step, Known limitations), `process/SDD.md` (where it names the hooks), `CHANGELOG.md` (`## [3.2.0] — unreleased` with `### Upgrade`: merge the new `.claude/settings.json` entries), `docs/BACKLOG.md` (Part 4 row gone; the "ask" item retired), `SPEC.md` (v3 table: Plan 4 path)

- [ ] **Step 1:** Write them; every claim matches a test or a Verification line.
- [ ] **Step 2:** `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs` → all pass.
- [ ] **Step 3: Commit** `docs: Part 4 — the production guard and the Supabase pack`.
