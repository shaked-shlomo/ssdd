# SSDD backlog

The single list of remaining SSDD work. Updated 2026-10-12 at v2.6.0 (455
tests pass). v2.6 took the gate back to its threat model; the next work is
adoption (configurable artifact paths, prizma's lock), not hardening.
When an item ships, delete it here and record it in `CHANGELOG.md`. When one
is planned, it gets a `SPEC.md` section first.

**Threat model.** The harness hooks keep a cooperating agent on the process;
they aren't a sandbox. A new evasion shape is out of scope unless an agent
was seen using it in a real project, and the spec that closes it records
that incident.

## Next: adoption

- **Configurable artifact paths** (`.ssdd/plans`, `specs`, `ledgers`): Hatedate
  keeps plans in `.claude/plans` (12 files reference it) and rules in
  `.claude/rules` (47). It can't adopt SSDD fully while these paths are
  hardcoded. Size M; needs its own spec.
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

## Later

| Item | Why | Blocked by / note | Size |
|---|---|---|---|
| **More `/skills-audit` catalog sources:** Supabase and stack-agnostic ones | v2.4 covers RN/Expo and Next.js/React. Supabase is used by both injected projects. | Needs an audit of each source first. The catalog records what an audit read. | M |
| **Enable `claude-code-setup` in the settings template?** | v2.4 decided against it by default (every plugin's descriptions cost context). `/skills-audit` says how to enable it per repo. | Owner decision; revisit after a few real `/skills-audit` runs. | S |
| **"ask" decision for guard rules:** pause for approval instead of deny | Hatedate's production-write guard uses Claude Code's `permissionDecision: "ask"`. | Cursor's `ask` behavior on `beforeShellExecution` isn't verified. | S–M |

## Accepted limitations (no plan)

These are documented in README → Known limitations. Listed here so they aren't
re-discovered as new.

- The harness hooks can't see git run from a script *file*, a variable, an
  alias, `xargs` / `find -exec`, or another language's subprocess, nor a
  `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` file that sets
  `core.hooksPath`. In Claude Code the review gate also skips
  `/usr/bin/git`, `env` / `sudo` runners and shell wrappers (`bash -c`,
  `eval`, `| sh`), and git-guard no longer unwraps them. The pre-commit
  layer is the backstop while `-n` isn't used.
- `--stamp` in `manual` mode (the default, and the only mode in Cursor) is
  an attestation the gate can't verify, including which model reviewed.
- Completion stamps cover the repo at the session's cwd. A `git -C <other>`
  commit from elsewhere needs manual mode.
- A re-stage that changes nothing keeps its stamps (by design since v2).
- Injection is copy-based. A release that moves a *target* path needs a
  move entry in `bin/ssdd.mjs`, or `update` sees a removal plus an addition.
