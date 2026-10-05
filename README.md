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
| **Skills** | `skills/` | None — `SKILL.md` folders (`new-plan`, `cleanup`, `docs-drift-audit`) injected into the harness-neutral `.agents/skills/` tree. |
| **Mechanisms** | `mechanisms/` | Node ≥ 18, no npm deps. Config-driven enforcement scripts with **two entry modes each**: a portable git-hook/CLI mode that works everywhere, and a harness stdin mode (Claude Code and Cursor payloads) for earlier interception. Tests: `node --test mechanisms/hooks/*.test.mjs`. Plus the docs-drift-audit runbook. |
| **Adapters** | `adapters/` | Per-harness wiring: `claude-code/` (hooks JSON, `CLAUDE.md` loader), `cursor/` (hooks.json, always-on rule), and `generic/AGENTS.md` — the shared instructions template every adapter uses. |
| **Injector** | `inject.sh` | Copies the framework into a target repo; harness discovery paths become symlinks. |

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
/Users/shaked/Developer/ssdd/inject.sh /path/to/project [claude-code,cursor|generic]
```

This copies `process/`, `reviewers/`, and the hook scripts into
`<project>/.ssdd/`, seeds `.ssdd/config.json`, the git pre-commit hook, the
skills (`.agents/skills/`) and `AGENTS.ssdd.md`, wires each named adapter
(symlinked `.claude/agents` + `.claude/skills`, `CLAUDE.md`, Cursor hooks and
rule), and prints the steps left. Then you **fill in the per-project half**:

1. `.ssdd/config.json` — reviewer routing (which staged paths require which
   reviewers; a route may carry a `$comment` saying why), lint rules,
   git-guard toggles, `reviewGate.maxRoutedFiles`. The config is the
   injection contract: the mechanism is the framework, the regexes are the
   project.
2. `AGENTS.md` — merge `AGENTS.ssdd.md` in, with a **Documentation Map**:
   every canonical doc, its one purpose, and its "when to update" trigger.
   `docs-sync-reviewer` enforces it per-diff; the
   [drift-audit runbook](mechanisms/drift-audit.md) audits it periodically.
   One instructions file for every harness; `CLAUDE.md` only imports it.
3. Domain reviewers — copy [reviewers/domain-reviewer-template.md](reviewers/domain-reviewer-template.md)
   into `.ssdd/reviewers/` for each project-specific lens (e.g. an
   RLS/backend reviewer, a bias/semantics reviewer) and add routes for them.
4. Git hook wiring (portable path): `git config core.hooksPath .githooks`.

## What deliberately stays per-project

Domain skills and rules do **not** live here: migration workflows, dependency
version policies, design-system/Figma rules, realtime-RLS proofs, platform
conventions. SSDD gives them a home (`.claude/skills/`, `.claude/rules/`, or
plain docs) and the coupling discipline; their content is the project's.

Keep whatever the adapter injects into *session context* small — instruction
files have real load budgets (hard lesson: a 37KB CLAUDE.md silently truncates
at ~25KB/200 lines in some harnesses).

## Known limitations

**Copy-based injection.** Fixes made here do not propagate to projects that
already injected, and project-side edits don't flow back. That's deliberate —
projects diverge, and the framework must travel with the repo. To pick up
upstream fixes, re-run `inject.sh` and review the diff (it never overwrites
`config.json`, skills, or adapter files). Within a repo there is no drift:
harness paths are symlinks onto `.ssdd/reviewers/` and `.agents/skills/`.

**The gate can be evaded** — it keeps honest agents honest; it is not a
security boundary. Six weaknesses reproduced in the source project, filed
there for their own plan (a rushed fix grown inside an unrelated commit was
reverted after several rounds found it incomplete):

1. It fails open on a config it can't use (missing/invalid JSON exits 0; a
   bad regex crashes `--pre-commit` but passes the stdin mode).
2. Unrouted paths get no review — including the instruction files, the hook
   scripts and `.claude/settings.json`, which arms the hooks.
3. It reads the *working-tree* config, so a commit that removes a route is
   judged by the table it just edited.
4. A stale `.git/hooks/pre-commit` wins over `core.hooksPath`, and a fresh
   clone has the hook dormant until `git config core.hooksPath .githooks`.
5. `SSDD_PROJECT_DIR` pointing elsewhere makes the hook judge that path.
6. A re-stage that changes nothing keeps its stamps — by design since v2.

## This repo dogfoods itself

[SPEC.md](SPEC.md) is the framework's own design spec, written with its own
template before the files you're reading were created — v1 (extraction) and
v2 (back-port from the first injected project).
