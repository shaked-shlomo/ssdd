# The Supabase pack

Knowledge prod-guard (`.ssdd/hooks/prod-guard.mjs`) needs for a Supabase
project, a security reviewer for `supabase/`, and a pre-merge check of the
migration history. `bin/ssdd.mjs install` adds it when the repo has
`supabase/config.toml`, or `@supabase/supabase-js` / `supabase` in the root
`package.json`; `--packs` overrides that. Design and evidence: SPEC.md → v3 →
Part 4.

Production changes go one way: migrations merged to `main` (the project's
`productionGuard.writePath`). Anything else that would change the production
project asks first, with a reason that says which case it is. Reads don't ask.

## What it judges

| Path | Passes | Asks "writes" | Asks "can't tell" |
|---|---|---|---|
| `supabase` CLI | reads, local commands, `--help`, `db push --dry-run` | `db push`, `migration repair`, `functions deploy\|delete`, `config push`, `secrets set\|unset`, `storage rm\|mv`, an upload with `storage cp`, a remote `db reset` / `migration up\|down`, a management write (`projects delete`, `branches create` …) | a remote command that isn't a known read, `db pull` |
| `supabase db query` against production (`--linked`, a remote `--db-url`) | SQL that reads, or a proof in the configured frame | SQL with write statements | SQL it can't vouch for (below), a `-f` file that is missing, over 1 MiB, a link, not a literal path, named elsewhere in the call, or that another command before it could change; stdin; two SQL sources |
| MCP (a Supabase server, a Supabase-only tool, or a project ref) | Supabase's read tools; `execute_sql` that reads | `apply_migration`, `deploy_edge_function`, branch and project changes; `execute_sql` with write statements | any other tool; `execute_sql` it can't vouch for |
| `curl` / `wget` to `api.supabase.com` or `<ref>.supabase.co` | GET and HEAD | any other method | an option, config file or variable that could change the method; a URL it can't read |
| `psql` / `pg_restore` to a Supabase host | `-c` / `-f` reads; `pg_dump` | writes; `pg_restore` | interactive or stdin use, a target that isn't literal, a connection service |
| a script (`node -e`, `python3 -c` …) naming a Supabase API host | | | always |

**Reads it vouches for** (`sql-readonly.mjs`): only `SELECT` / `WITH` /
`TABLE` / `VALUES` / `SHOW` / `EXPLAIN` statements, optionally inside one
`BEGIN … ROLLBACK|COMMIT` that isn't `READ WRITE`; no write words; calls only
to allowlisted read-only builtins, `information_schema.*` and `auth.uid` /
`role` / `jwt`. Anywhere in the SQL, `set_config`, `U&`,
`standard_conforming_strings` / `client_encoding` / `transaction_read_only`,
`SET NAMES`, a string-bodied function or `DO`, and an out-of-band name
(`dblink*`, `pg_terminate_backend`, `COPY … PROGRAM`, `http_*` but pg_net's
`net.http_*` enqueue functions …) make it "can't tell". Heredocs that are
data (commit messages, PR bodies) and quoted text aren't commands.

## `db-read`: the read path that never asks

```bash
node .ssdd/packs/supabase/db-read.mjs -o json "select count(*) from public.matches"
```

It wraps the SQL in `BEGIN READ ONLY; … ROLLBACK;` (Postgres refuses any
write), classifies the wrapped text before anything runs, and refuses what
isn't a read with exit 2. A read runs as `supabase db query --linked -f
<private temp file>`. Prefer it to an inline or plain-file query: Postgres
then enforces what the classifier checked. `--workdir` and `-o` pass through;
`SSDD_SUPABASE_BIN` names another CLI binary.

## The reviewer: `supabase-security-reviewer`

Installed as `.ssdd/reviewers/supabase-security-reviewer.md` (linked into
`.claude/agents/` by the claude-code adapter). Its checks are the ones that
held across projects: RLS with `WITH CHECK` in the creating migration, grants
in the same migration, `SECURITY DEFINER` with a pinned `search_path`,
trigger functions with EXECUTE revoked, the caller's identity from the token,
realtime filters that are not a boundary, applied migrations never edited, and
proofs that assert as `authenticated`. Two steps after install:

1. Fill its **Project** section: the project ref, the privileged fields and
   what enforces them, who may hold the service-role key, the advisor
   baseline. `update` keeps the lines you write.
2. Route it. `.ssdd/config.json` is the project's, so `install`, `update` and
   `status` print the suggested route (from `routes.json`) until one names the
   reviewer:
   `{ "reviewer": "supabase-security-reviewer", "paths": ["^supabase/"], "exclude": ["\\.test\\.", "__tests__/"] }`

The advisors read the live project, and a reviewer subagent may not reach
them: the orchestrator runs Supabase's security and performance advisors and
pastes their output into the dispatch. Without it the reviewer reports
`⚠️ ADVISOR NOT RUN`, an open finding to triage like any other.

## `sync-check`: the migration history before a merge

```bash
node .ssdd/packs/supabase/sync-check.mjs [--pr <number>] [--base main] [--digits 14]
```

For a project where only the Supabase GitHub integration applies migrations,
on merge. Run it from the branch's checkout before opening the PR and again
before merging. It compares `supabase migration list --linked` (run in the
main checkout, which holds the link) with `supabase/migrations/` here and on
`origin/<base>`, and fails on a version applied with no file (out of band, or
the branch is behind), a pending file older than the newest applied one, a
version this branch adds that is already applied (unless the open PR's
description has an `applied-early: <versions>` line), an edited applied
migration, and a version of the wrong width. The width is the oldest applied
version's: 14 for `supabase migration new` timestamps, 4 for a `0001_`
sequence; `--digits` overrides it, and a history mixing widths fails. It reads
the history table only, so DDL run outside a migration (dashboard SQL, MCP
`execute_sql`) is invisible to it. Needs the `supabase` CLI logged in and
linked, `git`, and `gh` for the PR description (without it, no
`applied-early` line is read).

## Options (`.ssdd/config.json` → `productionGuard.supabase`)

```json
"productionGuard": {
  "writePath": "migrations on merge to main (the Supabase GitHub integration)",
  "supabase": {
    "proofFrame": { "prologue": ["-- generated by …", "BEGIN;", "SET LOCAL lock_timeout = '3s';"], "epilogue": ["ROLLBACK;"] },
    "liveExtensions": ["pg_net", "pg_cron", "pgcrypto"],
    "personalReads": { "tables": ["auth.users"], "columns": ["phone", "birthday"] }
  }
}
```

- **`proofFrame`:** a rolled-back proof (a migration run on production inside
  `BEGIN … ROLLBACK` with timeouts) passes only when the file is exactly this
  prologue, a body that can't loosen the timeouts, and this epilogue. Unset, a
  proof asks "proof frame not configured".
- **`liveExtensions`:** the extensions a proof may `CREATE EXTENSION`; any
  other, or any `ALTER EXTENSION`, asks.
- **`personalReads`:** off by default. Set, a read naming one of these tables
  or columns asks "reads personal data", through `db query`, MCP and
  `db-read`, which refuses it unless run with `--personal` (and that asks).

A bad option makes every Supabase call ask, naming it.

## Known limits

- **Cursor** can't ask (its hooks ignore `ask`), so it denies instead and the
  owner runs the command in their own terminal.
- **A call already sent** can't be stopped: an Esc on an MCP call in flight
  doesn't undo it on the server (Hatedate, 07-27).
- **A read without `READ ONLY`** (inline, a plain file, MCP `execute_sql`)
  can still write through a view or an RLS policy that calls a writing
  function. `db-read` closes that.
- **What isn't on the command line:** a script file, a variable holding a
  command, a service-role key used from code. As for git, the guard sees the
  call, not what a program does.
- **MCP:** a new Supabase tool on a connector whose name doesn't say
  "supabase", called without a `project_id`, isn't recognized.
- **The file a query reads** can be changed by a command running beside it in
  the same pipeline; the guard checks only what runs before it.
