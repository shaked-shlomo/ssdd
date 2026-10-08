# SSDD backlog

The single list of remaining SSDD work. Updated 2026-10-09 at v2.5.0 (466
tests pass). v2.5 closed the known gate weaknesses; nothing is planned next.
When an item ships, delete it here and record it in `CHANGELOG.md`. When one
is planned, it gets a `SPEC.md` section first.

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
- The first commit of `.ssdd/config.json` is judged by that config alone;
  there's no committed table to compare against. convention-lint reads the
  working-tree config (it's advisory; the gate stands behind it).
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
- **Every injected project, on its v2.5 update:** paste the `gate-reviewer`
  route from CHANGELOG 2.5.0 → Upgrade into `.ssdd/config.json` and commit
  it; `status` lists what's still unrouted. Arm the hook if `status` says
  it's dormant.
- **Hatedate:** partial adoption, mechanisms first: per-file stamps, the
  gate in `.githooks/pre-commit`, a tracked ledger. Full adoption waits for
  configurable artifact paths (above).
- **This machine:** update the Claude Code CLI. It's 2.1.263;
  `/doctor prompt-audit` needs 2.1.283 or later, and 2.1.263 resolves the
  alias `sonnet` to `claude-sonnet-5`.
