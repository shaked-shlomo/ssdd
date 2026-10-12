# SSDD — a portable spec-driven development framework

SSDD is a personal engineering framework extracted from a production project
(HateDate, ~50 shipped plans). It packages the workflow that made that project
reliable — specs before plans, acceptance criteria before implementation,
deterministic review gates before commits, docs coupled to code in the same
commit — so it can be injected into any future project, **regardless of the
agent, harness, or IDE driving the work** (Claude Code, Codex, Cursor, a human
in a terminal, …).

> The name is just "SSDD" — expand or rename it freely per project.

## What's in the box

| Layer | Path | Harness-dependence |
|---|---|---|
| **Process** | `process/` | None — pure markdown. The lifecycle (brainstorm → spec → plan → task ledger → implement → verify → sync back), the principles, and the plan / spec / ledger / handover templates. |
| **Reviewers** | `reviewers/` | None — each file is a self-contained review checklist an agent *or a human* can execute against a git diff. Frontmatter is included so agent harnesses can load them directly. |
| **Skills** | `skills/` | None — `SKILL.md` folders (`new-plan`, `new-reviewer`, `skills-audit`, `cleanup`, `docs-drift-audit`) injected into the harness-neutral `.agents/skills/` tree. |
| **Mechanisms** | `mechanisms/` | Node ≥ 18, no npm deps. Config-driven enforcement scripts with **two entry modes each**: a portable git-hook/CLI mode that works everywhere, and a harness stdin mode (Claude Code and Cursor payloads) for earlier interception. Tests: `node --test mechanisms/hooks/*.selftest.mjs` (named so no project's test runner collects them by default); CI runs them with `bin/*.selftest.mjs` on Node 18 and 24. Plus the docs-drift-audit runbook. |
| **Adapters** | `adapters/` | Per-harness wiring: `claude-code/` (hooks JSON, `CLAUDE.md` loader), `cursor/` (hooks.json, always-on rule), and `generic/AGENTS.md` — the shared instructions template every adapter uses. |
| **Installer / updater** | `bin/ssdd.mjs` (`inject.sh` = install) | Installs a tagged release into a repo, writes `.ssdd/ssdd.lock.json`, and later three-way merges updates. Harness discovery paths become symlinks. |

## The core loop (one paragraph)

Every non-trivial piece of work is a **numbered plan**. Before a plan exists, a
**clarify pass** interrogates every assumption; unresolved ones live in *Open
questions* and block implementation. **Acceptance criteria are written before
any code** — they define "done". Implementation proceeds task by task, each
task recorded in a **ledger** (commit hash, spec-compliance ✅, quality ✅,
findings triaged, not just "done"). Every commit whose staged diff touches a
gated path is **blocked by the review gate** until every reviewer routed to
each such file has actually run against that file's exact staged change
(stamps are per reviewer × per file, so a fix round re-reviews only what
changed). **Verification closes each acceptance
criterion with real command output** — never numbers from memory. Coupled docs
(architecture maps, version ledger, requirements checklist) update **in the
same commit** as the change that invalidated them. Gotchas discovered along
the way are promoted to rules or memory so they bite once.

Details: [process/SDD.md](process/SDD.md).

## Injecting into a project

```bash
node ~/Developer/ssdd/bin/ssdd.mjs install /path/to/project claude-code,cursor   # or: generic
```

(`inject.sh /path/to/project claude-code,cursor` does the same.) It installs
the newest release tag: `process/`, `reviewers/` and the hook scripts into
`<project>/.ssdd/`, the git pre-commit hook, the skills into `.agents/skills/`,
each named adapter (symlinked `.claude/agents` + `.claude/skills`, Cursor
hooks and rule). It seeds the project-owned files (`.ssdd/config.json`,
`.ssdd/skills.json`, `AGENTS.md` — or `AGENTS.ssdd.md` to merge if one exists — `CLAUDE.md`,
`.claude/settings.json`), writes the lock, and prints the steps left. Then you **fill in the per-project half**:

1. `.ssdd/config.json` — reviewer routing (which staged paths require which
   reviewers; a route may carry a `$comment` saying why), lint rules,
   git-guard toggles, `reviewGate.maxRoutedFiles`. The config is the
   injection contract: the mechanism is the framework, the regexes are the
   project. `gate-reviewer`, which reviews changes to the gate's own files, is
   opt-in: its route snippet is in `reviewers/gate-reviewer.md`.
2. `AGENTS.md` — merge `AGENTS.ssdd.md` in, with a **Documentation Map**:
   every canonical doc, its one purpose, and its "when to update" trigger.
   `docs-sync-reviewer` enforces it per-diff; the
   [drift-audit runbook](mechanisms/drift-audit.md) audits it periodically.
   One instructions file for every harness; `CLAUDE.md` only imports it.
3. Domain reviewers — run `/new-reviewer`: it proposes project-specific
   lenses from the code no reviewer covers and the bug classes that recur in
   your ledgers, then scaffolds an approved one from
   [reviewers/domain-reviewer-template.md](reviewers/domain-reviewer-template.md)
   (route, model, symlink).
4. Best-practice skills — run `/skills-audit`: it matches the stack against
   the catalog, audits each source at a pinned sha against your rules, and
   records what you approve in `.ssdd/skills.json`.
5. Git hook wiring (portable path): `git config core.hooksPath .githooks`.
   With a `package.json`, a `"prepare"` script running it arms the hook on
   every fresh clone's install.

## What deliberately stays per-project

Domain skills and rules do **not** live here: migration workflows, dependency
version policies, design-system/Figma rules, realtime-RLS proofs, platform
conventions. SSDD gives them a home (`.claude/skills/`, `.claude/rules/`, or
plain docs) and the coupling discipline; their content is the project's.

Third-party best-practice skills are chosen per project too. `/skills-audit`
matches the stack against a small catalog (RN/Expo, Next.js/React), reads
each source at a pinned sha against the repo's own rules, and records
every verdict, rejections included, by sha in `.ssdd/skills.json`. It never
installs anything unasked.

Keep whatever the adapter injects into *session context* small — instruction
files have real load budgets (hard lesson: a 37KB CLAUDE.md silently truncates
at ~25KB/200 lines in some harnesses).

## Versioning and updates

Releases are annotated `vX.Y.Z` tags; [VERSION](VERSION) holds the current
one and [CHANGELOG.md](CHANGELOG.md) has upgrade notes per release (semver:
MAJOR needs manual steps in injected repos, MINOR updates cleanly, PATCH is
fixes). Every injected repo commits `.ssdd/ssdd.lock.json`: the version and
commit it came from, its adapters, and each framework file's source path and
hash. **A repo runs fully without this checkout** — only these commands need
it:

```bash
node ~/Developer/ssdd/bin/ssdd.mjs status <repo>                 # version, local customizations, update available, gate armed?
node ~/Developer/ssdd/bin/ssdd.mjs status <repo> --skills        # also: upstream skill sources that moved past .ssdd/skills.json
node ~/Developer/ssdd/bin/ssdd.mjs update <repo>                 # to the newest tag (--to <ref> to choose)
node ~/Developer/ssdd/bin/ssdd.mjs adopt  <repo> --base v1.0.1   # give a pre-lock (copy-era) install a lock
```

`update` refuses to run over uncommitted changes in framework paths, then
handles each framework file three ways — base (your locked version), yours,
and the new release:

| Your file vs. … | Result |
|---|---|
| unchanged since install | replaced by the new version |
| edited, upstream unchanged | kept |
| both edited, different lines | merged (both edits kept) |
| both edited, same lines | conflict markers — resolve, then commit |
| you added a file the release now ships | `<file>.ssdd-new` beside yours — reconcile, delete it |
| removed upstream | deleted if you never edited it, else kept with a warning |

Project-owned files (`config.json`, `skills.json`, `AGENTS.md`, `CLAUDE.md`,
`.claude/settings.json`) are never touched; `update` prints how their
templates changed so you can port what you need. It ends with the CHANGELOG
entries since your version. Review with `git diff` in the repo and commit
(the lock included).

**Releasing** (here): update `CHANGELOG.md` and `VERSION`, commit, then
`git tag -a vX.Y.Z -m "…"` and `git push origin main --follow-tags`. On
another machine: `gh repo clone shaked-shlomo/ssdd ~/Developer/ssdd`, later
`git -C ~/Developer/ssdd pull --tags`.

## When a new model generation ships

Instructions tuned for one generation drift with the next (see
[docs/model-era-review.md](docs/model-era-review.md)). In each injected repo:

1. Run `/doctor prompt-audit` in Claude Code. It flags instructions written
   for older models, contradictions and dead references across CLAUDE.md /
   AGENTS.md, rules, skills and agents.
2. Re-run one recent plan's task on the new model. Compare review rounds,
   findings and tokens with the ledger's record.
3. Re-check the effort levels: reviewers' `effort:` frontmatter and the
   session default.
4. Upstream what generalizes here as a MINOR release.

## Known limitations

**Copies, not a live link.** Each repo carries its own copy (the framework
must travel with the repo and be editable per project); updates arrive only
when you run `update`. A future release that moves a *target* path (not just
a source path) needs a move entry in `bin/ssdd.mjs`, or `update` sees it as a
removal plus an addition.

**The gate is not a sandbox.** The harness hooks catch what a cooperating
agent does by mistake or habit: bulk staging, `-n`, amend, force push,
re-pointing `core.hooksPath`, committing content the gate can't see,
committing to the wrong repo, a broken config. They don't try to catch an
agent that hides a command from them; the git pre-commit layer is the
backstop for what they can't see. A new evasion shape is out of scope unless
an agent was seen using it in a real project.

- A config that isn't valid JSON blocks in both layers (it used to read as
  "no config"); convention-lint reports it too. Absent still means "not an
  SSDD repo". The working-tree config is the one that applies, so a broken
  one is fixed in place.
- A dormant pre-commit hook (`core.hooksPath` not `.githooks`, the fresh-clone
  state) is named by `status` and by the harness gate on every commit. The
  user runs `git config core.hooksPath .githooks`; git-guard denies the agent
  any write to it. Once set, git ignores `.git/hooks` entirely (verified on
  git 2.54).
- In Claude Code the review gate runs only on commands that start with `git`
  (`"if": "Bash(git *)"`). `/usr/bin/git`, `env …` / `sudo …` runners and
  shell wrappers (`bash -c`, `eval`, `… | sh`, a heredoc fed to a shell)
  reach only the pre-commit layer. git-guard no longer unwraps shell wrappers
  either. Cursor's hook has no such filter.
- `SSDD_PROJECT_DIR` pointing elsewhere made the hook judge that path —
  closed in v2.1 for the pre-commit layer (it uses git's own cwd); the
  harness layer starts from the tool call's cwd.
- A re-stage that changes nothing keeps its stamps — by design since v2.

Since v2.3, Claude Code can make attestation mechanical: a reviewer
subagent's completion stamps its files, and `reviewGate.stamping: "hooks"`
stops the agent from running `--stamp` or writing the stamp files. In
`manual` mode (the default, and the only mode in Cursor) `--stamp` is still
an attestation the gate can't verify — including which model ran the
review.

Since v2.1 the harness gate refuses commits whose content it can't see
(`git add … && git commit`, `commit -a/-i/-o`, `commit <pathspec>`) and
judges the repo a commit targets (`cd`, `git -C`, worktrees), failing closed
on `$VAR` / `$(…)`. They can't see git run from a script *file*, a
variable, an alias, `xargs` / `find -exec`, or another language's subprocess
call, nor a `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` file that sets
`core.hooksPath`.
For those the git pre-commit layer is the backstop, and only while `-n`
isn't used. The hooks keep a cooperating agent on the process; they aren't
a sandbox.

## This repo dogfoods itself

[SPEC.md](SPEC.md) is the framework's own design spec, written with its own
template before the files you're reading were created — v1 (extraction) and
v2 (back-port from the first injected project).
