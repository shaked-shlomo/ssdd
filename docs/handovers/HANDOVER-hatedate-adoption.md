# Handover — Hatedate: adopt SSDD, tune its production guard

Written 2026-10-17 from SSDD `v3` (before Plan 1 landed), against Hatedate
`8563f3cd` on `main` (2026-10-15, "Merge pull request #133"). Paste this whole
file as the opening prompt of a fresh session **in the Hatedate repo**, once
the owner says to start. Every number below came from a read-only survey of
the repo, its git history and its Claude Code transcripts on 2026-10-17.
Re-verify line numbers before citing them.

**Status: parked.** The owner ruled on 2026-10-17: don't touch Hatedate yet.

---

You are adopting SSDD into Hatedate (`~/Developer/Hatedate`, React Native +
Expo + Supabase) and tuning its production guard. Read `CLAUDE.md`, then
SSDD's `SPEC.md` → v3 (work state, the production guard and the Supabase
pack), then `docs/BACKLOG.md` in `~/Developer/ssdd`. Hatedate has never
adopted SSDD. Its gate, guards and routing are its own originals, which SSDD
was extracted from. This is a spec → plan piece of work. Use a git worktree:
the main checkout is shared with other sessions. The next free plan number
is the highest `NN-` in `.claude/plans/` plus 1, counting open branches. Plan
63 existed only on the step-2 branch on 2026-10-17.

## The problem

### 1. supabase-guard prompts on reads

`.claude/hooks/supabase-guard.mjs`, with `lib/sql-lex.mjs` and
`lib/sql-readonly.mjs`, returns `permissionDecision: "ask"` for anything
that could write to the live Supabase project.

**The numbers, 09-28 to 10-17** (from transcripts, deduped by tool-use id):
- **79 asks:**
  - 76 on Bash: 74 `db query (remote)`, 1 `db push --dry-run`, 1
    unparseable `$(…)`.
  - 3 on MCP `execute_sql`, all reads.
  - 0 on MCP `apply_migration` or `deploy_edge_function`.
- **Only 2 were real writes.** Both were the 10-15 fixture seed and
  cleanup, which the owner had already approved in chat.
- **The other 77 were false positives:**
  - 53 reads
  - 17 helper proofs (`BEGIN … ROLLBACK`)
  - 2 hand-written rollback probes. These have no timeout frame and take
    locks, so asking on them is correct.
  - 3 MCP reads
  - 1 dry run
  - 1 local grep loop
- **The owner approved 74 of the 79.**
- **Since PR #131 (10-14):** 20 asks, 18 of them false positives. 17 of
  those 18 pass the SQL content check and asked only because of the
  command's shape: `2>&1 | grep/tail/sed`, `| python3 -c`, `> out.json`.
- **Re-checked live on 2026-10-17:** the same read-only file passes alone
  and asks once `| tail -5` is added.
- **More false positives:** `supabase db push --help` asks. The prompt text
  says the command "writes to the PRODUCTION Supabase project" even for a
  read.
- **Of the 77 false positives, today's guard still asks on 68:**
  - 26 asked only because of the command's shape
  - 24 were plain SELECT files without a `READ ONLY` wrapper
  - 9 were inline SQL
  - 3 were MCP reads
  - 2 were rollback probes
  - 2 were `client_encoding` probes
  - 1 was a dry run
  - 1 was the grep loop
- **The unparseable and command-substitution rules** would fire 39 times
  across the transcripts, never on a write. They fire on commit messages
  and PR bodies that mention supabase.
- **Cost:**
  - The median wait per ask was 72 s, and 24 waits ran over 5 min.
  - There were two streaks of 8 asks within minutes (10-12, 10-15).
  - 3 prompts died at about 610 s.
  - The owner complained on 10-08, 10-12 and twice on 10-13.
  - Agents pre-checked a command against the guard about 45 times, then
    ran a different, piped command that asked anyway.

### 2. The covered paths don't miss, but other paths are unguarded

- **The covered paths have no misses.** Since 09-28, no write through a
  path the guard covers ran without an ask. Before the guard (July to
  09-27): 31 MCP `apply_migration`, 7 MCP `deploy_edge_function`, 8
  `supabase storage cp/rm` and at least 2 CLI `functions deploy` went
  straight to production. That was the drift that led to Plan 60.
- **The uncovered path:** agents read the Supabase CLI's access token from
  the macOS Keychain and call the Management API with curl or node. This
  happened 13 times between 09-08 and 10-17, all GETs. The recipe is saved
  in memory as `supabase-advisors-via-cli-token.md`. The same token can
  POST `/database/query` or deploy functions, and the guard never sees it.
- **Personal data:** 18 agent queries against production selected from
  user tables, and 7 of those named personal columns (phone, birthday,
  bio). A read-only `SELECT email, phone FROM auth.users` passes silently
  (re-checked 2026-10-17). "Counts, never rows" is only an instruction, and
  only for proofs.
- **A possible gap:** a memory note from 07-27 (Plan 42, older connector)
  says an `apply_migration` rejected in the UI still ran. That led to
  duplicate `schema_migrations` rows, deleted by hand. The evidence is thin.
  Test it once, on purpose.

### 3. The git and commit hooks

Transcripts from 07-01 to 10-17; TP = true positive, FP = false positive.

| Rule | Fired | TP | FP | Notes |
|---|---|---|---|---|
| git-guard `add -A` / `.` | 2 | 1 | 1 | The FP was `git add -A -- <paths>`, which is scoped. `git add -u` (21 times) and directory adds (about 12) aren't caught; one staged 121 files. |
| git-guard `--no-verify` / `--amend` / force | 0 | – | – | They cost nothing. With no branch protection, the force-push rule is the only one. |
| git-guard `core.hooksPath` | 6 | 0 | 6 | All 6 were read-only queries. |
| review-gate, reviewers owed | 19 | 4 | 4 | 9 were deliberate `-m "probe"` commits, used as a routing query. |
| review-gate, chained staging | 14 | 2 | 12 | 8 were docs-only and 4 were in scratch repos. |
| review-gate, pathspec / unresolvable | 5 | 0 | 5 | Tokenizer bugs on `2>` and heredocs. One retry landed on `main` (08-10). |
| convention-lint (all rules) | 35 | ≤7 | 28 | Old lines flagged again on every edit, and 9 on `signOut.ts`, which the rule itself exempts. |
| pre-commit, untracked files | 10 | 2 | 7 | The workarounds stashed other sessions' work. Its firings stop after worktrees came in (07-27). |
| pre-commit, color literals | 4 | 1 | 3 | 3 were in comments. |
| pre-commit, asset / spring / console.log / `.env` | 0 | – | – | – |

**Review-gate cost since 07-30:**
- 162 commits, 67 of them reviewed.
- 43% needed 2–4 rounds.
- 31% of the 391 reviewer runs were repeats, because the stamp is a hash of
  the whole diff.
- Re-review took about 9% of active session time. That's an upper bound.
- `REVIEW_GATE_SKIP` was never used.

**Misses:**
- 08-08: the v0.3.0 release commit passed on a clean index and was pushed
  straight to `main`.
- 08-10: a chained add+commit of code got through the gate. The fix,
  `50207a0`, came the same day.
- 07-21: `commit && commit` swept already-staged code into a docs commit.

### 4. What full SSDD adoption still needs (from SSDD's survey)

- Plans live in `.claude/plans` (90 files, 01–62 plus sub-numbers). Their
  Status is free text and often stale: plan 22 still says IN PROGRESS but
  shipped as `68634bb`; plan 62 says "PR pending" but #128 merged.
- Ledgers are in Superpowers' format under the gitignored `.superpowers/`,
  so they vanish with their worktrees.
- Specs are spread over 3 folders.
- The gate is v1: a whole-diff stamp in `.git/claude-review-stamp.json`,
  routing hardcoded in JS, and `REVIEW_GATE_SKIP`.
- `.githooks/pre-commit` runs 6 lint checks and never calls the gate.
- Always-loaded context is about 54 KB: CLAUDE.md about 24 KB, MEMORY
  about 18 KB, `performance.md`, plus agent and skill descriptions.
  `CLAUDE.md:26` sends every session to a 290 KB REQUIREMENTS file.
- "No production writes without an OK in chat" is written in six places.

## What is decided

All owner rulings from 2026-10-17:

1. **Writes reach production only through migrations on merge to `main`.**
   That's the Supabase GitHub integration. Any other write is an edge case
   that needs the owner's explicit approval. supabase-guard exists to be
   that approval step and workflow, not a hard block.
2. **Pushing or merging to `main` stays unguarded until launch.** After
   launch, the project moves to Supabase Pro branching.
3. **Tests that only read are approved,** psql included. Tests that write
   (the realtime RLS harness inserts rows; the delete-account integration
   calls the live function) are the approval-needing edge cases.
4. **No strict guards on releases** (`eas update --channel production`,
   `eas submit`, tags).
5. **Reads of personal data become a rule at launch, not now:** reads of
   personal columns from user tables ask first. Production may hold only
   test accounts before launch; check that rather than assume it.
6. **Don't touch Hatedate until the owner says so.** SSDD v3 Part 1 (work
   state) ships first.
7. **SSDD gets a production guard and a Supabase pack.** The pack is
   injected only into repos that use Supabase (SPEC.md v3, Part 4).
   Hatedate's guard is the source. SSDD builds the fixed version (the fix
   below), and Hatedate adopts that pack instead of fixing its own copy.
   That's the agent's call in SPEC.md v3 Part 4, made so Hatedate stays
   untouched. If SSDD's Part 4 hasn't shipped when this session starts,
   ask the owner whether to wait for it or fix Hatedate's copy first.

## The fix for supabase-guard (proposed, verify it in a plan)

1. **Judge only the part of the command that reaches the database.** Split
   the command into its pipeline and chain pieces. Judge each piece that
   touches production (supabase CLI, psql with a remote URL, curl to the
   Management API) by what it does, and let local pieces through (`grep`,
   `tail`, `jq`, `> file`). This removes the 26 shape-only false positives
   without a list of allowed filters to maintain.
2. **One read path that never asks.** A small helper, for example
   `scripts/db-read "<sql>"`, wraps any SQL in `BEGIN READ ONLY … ROLLBACK`
   so Postgres refuses writes, and runs the existing classifier so the SQL
   can't break out (`COMMIT`, a second transaction). The 24 unwrapped
   SELECTs and 9 inline-SQL asks go through it.
3. **Accurate reasons.** "This writes to production" or "I can't tell what
   this does", never "writes" for a read.
4. **Ask on Management API calls that aren't GET**, and decide what to do
   about the saved Keychain-token recipe in memory.
5. **Narrow the unparseable and `$(…)` rules.** Skip heredocs that are
   commit messages or PR bodies, and fix how `$(…)` handles parentheses
   inside quotes. Exempt `--help` and `db push --dry-run`.
6. **Keep:**
   - the MCP `apply_migration` and `deploy_edge_function` asks
   - the CLI write subcommands
   - the `client_encoding` / `U&` / `set_config` refusals
   - the proof allowance
7. **Measure after:** ask count and approval rate over two weeks. A prompt
   that's approved 9 times out of 10 means the guard needs fixing.

## The git and commit hooks (proposed)

- **git-guard:** block only *writes* to `core.hooksPath`; allow
  `add -A -- <paths>`; decide on `add -u` and directory adds.
- **review-gate:**
  - Move to SSDD's per-file stamps (v2+), so a fix re-reviews only the
    files that changed.
  - Add a `--check` dry run instead of probe commits.
  - Skip scratch repos outside the project and its worktrees.
  - Allow chained staging when no staged path has a reviewer routed to it.
  - Fix the `2>` and heredoc tokenizer.
- **Pre-commit untracked-files block:** drop it or make it a warning.
- **convention-lint:** lint only the lines that changed; exempt
  `signOut.ts`.
- **Color literals:** exempting comment lines is the owner's call.

## What is open

- Whether production holds only test accounts today (ruling 5).
- Whether a rejected MCP `apply_migration` still runs (§2).
- `git add -u` and directory adds: block, warn or allow.
- How Hatedate's plans move into SSDD's layout. With SSDD v3's `paths`
  config, plans can stay in `.claude/plans`; then run `/migrate-plans`
  (SSDD v3, Part 2) over the 90 plans.
- Where its ledgers go: tracked `.superpowers/sdd/*/progress.md` needs the
  root `.gitignore:58` rule (`.superpowers/`) removed.

## Out of scope

- Changes to SSDD itself. They're tracked in `~/Developer/ssdd`
  `docs/BACKLOG.md` and `SPEC.md` → v3.
- Branch protection and Supabase Pro branching (ruling 2).
- Release guards (ruling 4).

## Done looks like

Write the criteria in the plan's clarify pass. At a minimum:
- Over the transcript replay set, supabase-guard asks only on writes and
  on commands it can't parse. Re-run the replay; the SSDD survey's method
  is in §1.
- Hatedate runs SSDD v3's gate, work-state view and close check from
  `.ssdd/config.json`.
- Its own guards (supabase-guard and its pre-commit checks) live in that
  config or as SSDD pack files, not in forked copies.
