# SSDD backlog

The single list of remaining SSDD work. Updated 2026-10-22 at v3.3.1. All
five parts of v3 (`SPEC.md` → v3) have shipped; what's left of v3 is the
migrations below. Not hardening. When an item ships, delete it here and
record it in `CHANGELOG.md`. When one is planned, it gets a spec in
`docs/specs/` and a row in `SPEC.md` first.

**Threat model.** The harness hooks keep a cooperating agent on the process;
they aren't a sandbox. A new evasion shape is out of scope unless an agent
was seen using it in a real project, and the spec that closes it records
that incident.

## Next: the end of v3

- **The real migrations of prizma and Hatedate** (owner, 2026-10-20: none
  until all five parts land; scratch clones only before then), with Part 1's
  after-`/compact` session-start check.
  - Both carry their own `/cleanup` (11.6 KB and 13.3 KB). The update merges
    or sidecars it against the thin one; what's project-specific moves into
    the skill's project section.
  - A repo that doesn't want the drift audit drops it with `update --with
    none` (prizma ran it once).
- **Hatedate adoption is parked** (owner, 2026-10-17). The prompt to start
  it is `docs/handovers/HANDOVER-hatedate-adoption.md`. Its supabase-guard
  is replaced by the Supabase pack (3.2.0): set `productionGuard.supabase`
  (its proof frame, live extensions) and retire its own copy.
- **prizma's migration:** add its `vercel deploy --prod` rule to
  `productionGuard.extraRules` (SPEC v3 Part 4, Scope).
- **prizma:** installed v1.0.1 by copy, with no lock (its hooks were since
  rewritten in the repo to about v2.0). It runs
  `node ~/Developer/ssdd/bin/ssdd.mjs adopt <repo> --base v1.0.1` once, then
  `update`. Until then its hooks let `git commit -anm` and `bash -c '…'`
  pass every gate. Its own text cuts (AGENTS.md 178 lines, design-sync →
  skill, the 786-char `bias-semantics-reviewer` description, the
  Superpowers decision) are a prizma plan. See `docs/model-era-review.md`
  → project-side rows.

## Later

| Item | Why | Blocked by / note | Size |
|---|---|---|---|
| **More `/skills-audit` catalog sources:** Supabase and stack-agnostic ones | v2.4 covers RN/Expo and Next.js/React. Supabase is used by both injected projects. | Needs an audit of each source first. The catalog records what an audit read. | M |
| **Enable `claude-code-setup` in the settings template?** | v2.4 decided against it by default (every plugin's descriptions cost context). `/skills-audit` says how to enable it per repo. | Owner decision; revisit after a few real `/skills-audit` runs. | S |

## Accepted limitations (no plan)

These are documented in `docs/limitations.md`. Listed here so they aren't
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
- git-guard blocks writes to `core.hooksPath` that name the key. `git config
  --remove-section core`, `--rename-section core` and `--edit` clear it
  without naming it (no agent was seen doing this; v3 Part 3).
- Completion stamps cover the repo at the session's cwd. A `git -C <other>`
  commit from elsewhere needs manual mode.
- A re-stage that changes nothing keeps its stamps (by design since v2).
- The production guard sees the command line, not what a script does; a
  call already sent can't be stopped; Cursor denies where Claude Code asks
  (its hooks ignore `ask`). See `docs/limitations.md`.
- Injection is copy-based. A release that moves a *target* path needs a
  move entry in `bin/ssdd.mjs`, or `update` sees a removal plus an addition.
