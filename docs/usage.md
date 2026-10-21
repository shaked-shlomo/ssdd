# Using SSDD

The detail behind the [README](../README.md).

## How it works

Before a plan exists, a **clarify pass** interrogates every assumption;
unresolved ones block implementation. Each task is recorded in a **ledger**
(commit hash, spec compliance, quality, findings triaged). The gate's stamps
are per reviewer × per file, so a fix round re-reviews only what changed, and
the block message hands each reviewer the diff since its stamp.
`review-gate.mjs --check` says what's owed without a commit. A merge of the
default branch owes only its conflict resolutions.
Gotchas found along the way are promoted to rules or memory so they bite
once. Full lifecycle: [process/SDD.md](../process/SDD.md).

**Where the work is.** `node .ssdd/hooks/work-state.mjs` reads the plans,
ledgers and git across the default branch, other branches and worktrees, and
prints every open plan: its status, the next task, the criteria verified, and
any plan whose Status says IN PROGRESS while nothing is working on it. The
harness hooks print it when a session starts, so an agent opens knowing its
place. The pre-commit hook also checks a plan before it closes: BUILT or
SHIPPED is refused while an `AC` ID has no Verification entry or the plan's
ledger isn't staged. Superpowers' per-plan ledgers
(`.superpowers/sdd/<plan>/progress.md`) are tracked in git.

**Production changes go one way.** In both projects SSDD came from, that way
is the integrations that deploy on merge to `main`. `prod-guard.mjs` asks a
person before anything else that would change production, with a reason that
says which case it is: "writes to production outside the merge path" or
"can't tell what this does". Reads don't ask, and `| tail`, `2>&1` or `> file`
beside a command change nothing. What production means for a stack lives in a
**pack**, installed only where that stack is used: the
[Supabase pack](../packs/supabase/README.md) judges the CLI, `db query` by its
SQL, MCP tools, the HTTP APIs and `psql`, and adds `db-read`, a read path that
never asks. A project adds its own rules (`productionGuard.extraRules`, e.g.
`vercel deploy --prod`).

**Onboarding a repo that already has plans.** Plans written before v3 (checkbox
criteria, criteria without IDs, Status words like DONE) are migrated once with
`/migrate-plans`: `work-state.mjs --migrate` does the mechanical half, an agent
cites each Verification entry's ID from the plan's own record and fixes Status
against git, a second agent checks it, and `--migrate-check` makes sure no text
was lost. Plans can live anywhere: `paths` in `.ssdd/config.json` names the
plans, specs and ledgers folders. The view, `status` and `update` list the
onboarding steps still open.

## What's in the box

| Layer | Path | What it is |
|---|---|---|
| **Process** | [`process/`](../process/) | The lifecycle, principles, and plan / spec / ledger / handover templates. Pure markdown. |
| **Reviewers** | [`reviewers/`](../reviewers/) | Self-contained review checklists an agent *or a human* runs against a diff: security, performance, resilience, docs-sync, convention compliance, the gate's own files, and a template for domain reviewers. Frontmatter lets harnesses load them as subagents. |
| **Skills** | [`skills/`](../skills/) | `new-plan`, `new-reviewer`, `skills-audit`, `cleanup`, `migrate-plans`, and `docs-drift-audit` with `--with drift-audit`, installed into the harness-neutral `.agents/skills/`. |
| **Mechanisms** | [`mechanisms/`](../mechanisms/) | Config-driven enforcement (review gate, git-guard, production guard, convention lint). Each runs as a git hook/CLI anywhere, or from Claude Code / Cursor hook payloads for earlier interception. |
| **Packs** | [`packs/`](../packs/) | Knowledge for one stack, installed only where it's used: [`supabase`](../packs/supabase/README.md) (what reaches the production project, `db-read`). |
| **Adapters** | [`adapters/`](../adapters/) | Per-harness wiring for `claude-code/`, `cursor/`, and a `generic/AGENTS.md` every adapter shares. |
| **Installer** | [`bin/ssdd.mjs`](../bin/ssdd.mjs) | Installs a tagged release, writes a lock, and later three-way merges updates. |

## Setup

After `node ~/ssdd/bin/ssdd.mjs install /path/to/project claude-code,cursor`
([Quick start](../README.md#quick-start)):

Use `generic` instead of the adapter list for any other harness
(`inject.sh /path/to/project claude-code,cursor` does the same). It installs
the newest release: `process/`, `reviewers/` and the hooks into
`<project>/.ssdd/`, the git pre-commit hook, the skills, and each adapter's
wiring, and each pack the repo matches (`--packs a,b` or `--packs none`
overrides that). Optional parts install only when named: `--with
drift-audit` adds the drift-audit runbook and `/docs-drift-audit`. It seeds the project-owned files (`.ssdd/config.json`,
`.ssdd/skills.json`, `AGENTS.md`, or `AGENTS.ssdd.md` to merge if one exists,
`CLAUDE.md`, `.claude/settings.json`), writes the lock, and prints what's
left. Then fill in the per-project half:

1. **`.ssdd/config.json`**: reviewer routing (which staged paths need which
   reviewers; a route may carry a `$comment` saying why), lint rules,
   git-guard toggles, `reviewGate.maxRoutedFiles`, and `productionGuard`
   (the sanctioned `writePath`, the project's own `extraRules`, a pack's
   options). The mechanism is the framework, the regexes are the project. `gate-reviewer` is opt-in; its
   route snippet is in [reviewers/gate-reviewer.md](../reviewers/gate-reviewer.md).
2. **`AGENTS.md`**: merge `AGENTS.ssdd.md` in, with a **Documentation Map**
   listing every canonical doc, its purpose, and when it must change.
   `docs-sync-reviewer` enforces it per diff; the
   [drift-audit runbook](../mechanisms/drift-audit.md) (`--with drift-audit`)
   audits it periodically.
   `CLAUDE.md` only imports it.
3. **Domain reviewers**: run `/new-reviewer`. It proposes project-specific
   lenses from code no reviewer covers and bug classes that recur in your
   ledgers, then scaffolds the ones you approve from
   [the template](../reviewers/domain-reviewer-template.md).
4. **Best-practice skills**: run `/skills-audit`. It matches your stack
   against a small catalog (RN/Expo, Next.js/React), audits each source at a
   pinned sha against your rules, and records every verdict in
   `.ssdd/skills.json`. It never installs anything unasked.
5. **Arm the hook**: `install` and `update` set `core.hooksPath` to
   `.githooks` when it's unset or an absolute path to a checkout's
   `.githooks`. Any other value, or a real hook already in `.git/hooks`, is
   left alone (setting it would stop those hooks), and they print the
   command to run instead. The setting is per clone, so with a `package.json`, a
   `"prepare"` script running `git config core.hooksPath .githooks` arms
   the hook on every fresh clone.

Domain skills and rules (migration workflows, version policies, design-system
rules, platform conventions) stay per project: SSDD gives them a home and the
coupling discipline, the content is yours. Keep what the adapter injects into
session context small; instruction files have real load budgets (a 37KB
`CLAUDE.md` silently truncates in some harnesses).

## Updating an injected repo

Each injected repo commits `.ssdd/ssdd.lock.json`: the version and commit it
came from, its adapters, and every framework file's source and hash. **A repo
runs fully without the SSDD checkout**; only these commands need it:

```bash
node ~/ssdd/bin/ssdd.mjs status <repo>                 # version, local edits, update available, gate armed?
node ~/ssdd/bin/ssdd.mjs status <repo> --skills        # also: upstream skill sources that moved
node ~/ssdd/bin/ssdd.mjs update <repo>                 # to the newest tag (--to <ref> to choose)
node ~/ssdd/bin/ssdd.mjs adopt  <repo> --base v1.0.1   # give a pre-lock install a lock
```

`update` refuses to run over uncommitted framework changes, then merges each
framework file three ways (your locked version, yours, the new release):

| Your file vs. … | Result |
|---|---|
| unchanged since install | replaced by the new version |
| edited, upstream unchanged | kept |
| both edited, different lines | merged (both edits kept) |
| both edited, same lines | conflict markers: resolve, then commit |
| you added a file the release now ships | `<file>.ssdd-new` beside yours: reconcile, delete it |
| removed upstream | deleted if you never edited it, else kept with a warning |

`update` keeps the packs the lock lists and never detects new ones; `status`
says when the repo now matches a pack it lacks, and `update --packs a,b`
adds or removes one. It keeps the optional parts the lock lists too (a lock
from before 3.3.0 keeps the drift audit it has), and `update --with a,b|none`
adds or removes one.

Project-owned files are never touched; `update` prints how their templates
changed so you can port what you need, and ends with the
[CHANGELOG](../CHANGELOG.md) entries since your version, the manual Upgrade
steps they name, and the onboarding steps still open. Review with `git diff`
and commit, lock included.

Releases are annotated `vX.Y.Z` tags with semver adapted to a framework that
lives inside other repos: MAJOR needs manual steps in injected repos, MINOR
updates cleanly, PATCH is fixes.

## When a new model generation ships

Instructions tuned for one generation drift with the next (see
[docs/model-era-review.md](model-era-review.md)). In each injected repo:

1. Run `/doctor prompt-audit` in Claude Code to flag instructions written for
   older models, contradictions, and dead references.
2. Re-run one recent plan's task on the new model and compare review rounds,
   findings, and tokens with the ledger's record.
3. Re-check effort levels: reviewers' `effort:` frontmatter and the session
   default.
4. Upstream what generalizes as a MINOR release.

## Releasing

Update `CHANGELOG.md` and `VERSION`, commit, then `git tag -a vX.Y.Z -m "…"`
and `git push origin main --follow-tags`.
