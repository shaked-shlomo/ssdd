# SSDD backlog

The single list of remaining SSDD work. Updated 2026-10-07 at v2.4.0 (428
tests pass). When an item ships, delete it here and record it in
`CHANGELOG.md`. When one is planned, it gets a `SPEC.md` section first.

## Next: v2.5 — close the remaining gate weaknesses

The gate is what SSDD exists for. These are the known ways around it that
aren't fixed yet (README → Known limitations). Each is small; together they
make one release.

| # | Weakness | Direction | Size |
|---|---|---|---|
| 1 | **Fails open on invalid config JSON.** A missing config means "not an SSDD repo" (fine), but unparseable JSON is treated the same: exit 0 in both layers. *(Verified 2026-10-07: a bad regex already blocks in both: `--pre-commit` exits 1, harness 2.)* | Distinguish *absent* from *broken*: broken JSON blocks in both layers, with the parse error. | S |
| 2 | **The gate's own files route to no reviewer:** `.ssdd/config.json`, `.ssdd/hooks/`, `.githooks/`, `.claude/settings.json` (which arms the hooks), `.cursor/hooks.json`, and the instruction files. | Route them in `config.example.json`, to `security-reviewer` or a small gate lens. The first injected project left `.ssdd/hooks/` unrouted by choice, so make it the default but easy to drop. | S |
| 3 | **A commit can loosen its own review.** The gate reads the working-tree config, so a commit that removes a route is judged by the table it just edited. | Judge with the union of the routes in HEAD's config and the staged config: the strictest of the two. | S–M |
| 4 | **Dormant on a fresh clone.** `.githooks/pre-commit` runs only once `git config core.hooksPath .githooks` is set. *(Verified on git 2.54: once it's set, git ignores `.git/hooks`. README's "a stale `.git/hooks/pre-commit` wins" was wrong and is corrected.)* | `ssdd.mjs status` warns when `core.hooksPath` isn't `.githooks`, and the harness gate's block message mentions it. A one-line `npm prepare` / postinstall suggestion for projects that have a package manifest. | S |
| 5 | **No CI.** SSDD's own tests run only locally. | A GitHub Actions workflow running `node --test` over every `*.selftest.mjs` on PRs and pushes to `main` (Node 18 and current), which also checks the Node ≥ 18 claim. | S |

Also in v2.5, housekeeping:
- Delete the merged branch `v2.3.2-selftest`, locally and on GitHub.

## Later

| Item | Why | Blocked by / note | Size |
|---|---|---|---|
| **Configurable artifact paths** (`.ssdd/plans`, `specs`, `ledgers`) | Hatedate keeps plans in `.claude/plans` (12 files reference it) and rules in `.claude/rules` (47). It can't adopt SSDD fully while these paths are hardcoded. | Only needed when Hatedate adopts SSDD. | M |
| **More `/skills-audit` catalog sources:** Supabase and stack-agnostic ones | v2.4 covers RN/Expo and Next.js/React. Supabase is used by both injected projects. | Needs an audit of each source first. The catalog records what an audit read. | M |
| **Enable `claude-code-setup` in the settings template?** | v2.4 decided against it by default (every plugin's descriptions cost context). `/skills-audit` says how to enable it per repo. | Owner decision; revisit after a few real `/skills-audit` runs. | S |
| **"ask" decision for guard rules:** pause for approval instead of deny | Hatedate's production-write guard uses Claude Code's `permissionDecision: "ask"`. | Cursor's `ask` behavior on `beforeShellExecution` isn't verified. | S–M |

## Accepted limitations (no plan)

These are documented in README → Known limitations. Listed here so they aren't
re-discovered as new.

- The harness hooks can't see git run from a script *file*, a variable, an
  alias, `xargs` / `find -exec`, or another language's subprocess, nor a
  `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` file that sets
  `core.hooksPath`. The pre-commit layer is the backstop while `-n` isn't
  used. The hooks keep a cooperating agent on the process; they aren't a
  sandbox.
- `--stamp` in `manual` mode (the default, and the only mode in Cursor) is
  an attestation the gate can't verify, including which model reviewed.
- Completion stamps cover the repo at the session's cwd. A `git -C <other>`
  commit from elsewhere needs manual mode.
- A re-stage that changes nothing keeps its stamps (by design since v2).
- Injection is copy-based. A release that moves a *target* path needs a
  move entry in `bin/ssdd.mjs`, or `update` sees a removal plus an addition.

## Not SSDD work: each project, when the SSDD work is done

- **prizma:** installed v1.0.1 by copy, with no lock. It runs
  `node ~/Developer/ssdd/bin/ssdd.mjs adopt <repo> --base v1.0.1` once, then
  `update`. Until then its hooks let `git commit -anm` and `bash -c '…'`
  pass every gate. Its own text cuts (AGENTS.md 178 lines, design-sync →
  skill, the 786-char `bias-semantics-reviewer` description, the
  Superpowers decision) are a prizma plan. See `docs/model-era-review.md`
  → project-side rows.
- **Hatedate:** partial adoption, mechanisms first: per-file stamps, the
  gate in `.githooks/pre-commit`, a tracked ledger. Full adoption waits for
  configurable artifact paths (above).
- **This machine:** update the Claude Code CLI. It's 2.1.263;
  `/doctor prompt-audit` needs 2.1.283 or later, and 2.1.263 resolves the
  alias `sonnet` to `claude-sonnet-5`.
