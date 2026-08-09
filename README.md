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
| **Process** | `process/` | None — pure markdown. The lifecycle (brainstorm → spec → plan → task ledger → implement → verify → sync back), the principles, and the three document templates. |
| **Reviewers** | `reviewers/` | None — each file is a self-contained review checklist an agent *or a human* can execute against a git diff. Frontmatter is included so agent harnesses can load them directly. |
| **Mechanisms** | `mechanisms/` | Node ≥ 18, no npm deps. Config-driven enforcement scripts with **two entry modes each**: a portable git-hook/CLI mode that works everywhere, and a Claude Code hook mode for earlier, friendlier interception. Plus the docs-drift-audit runbook. |
| **Adapters** | `adapters/` | Per-harness wiring. `claude-code/` (hooks JSON, agents, skills) and `generic/` (an `AGENTS.md` that inlines the process for any other harness). |
| **Injector** | `inject.sh` | Copies the framework into a target repo. |

## The core loop (one paragraph)

Every non-trivial piece of work is a **numbered plan**. Before a plan exists, a
**clarify pass** interrogates every assumption; unresolved ones live in *Open
questions* and block implementation. **Acceptance criteria are written before
any code** — they define "done". Implementation proceeds task by task, each
task recorded in a **ledger** (commit hash, spec-compliance ✅, quality ✅,
findings triaged, not just "done"). Every commit whose staged diff touches a
gated path is **blocked by the review gate** until the required reviewers have
actually run against that exact diff. **Verification closes each acceptance
criterion with real command output** — never numbers from memory. Coupled docs
(architecture maps, version ledger, requirements checklist) update **in the
same commit** as the change that invalidated them. Gotchas discovered along
the way are promoted to rules or memory so they bite once.

Details: [process/SDD.md](process/SDD.md).

## Injecting into a project

```bash
/Users/shaked/Developer/ssdd/inject.sh /path/to/project [claude-code|generic]
```

This copies `process/`, `reviewers/`, and `mechanisms/` into `<project>/.ssdd/`,
seeds `.ssdd/config.json` from the example, and prints the wiring steps for the
chosen adapter. Then you **fill in the per-project half**:

1. `.ssdd/config.json` — reviewer routing (which staged paths require which
   reviewers), lint rules, git-guard toggles. The config is the injection
   contract: the mechanism is the framework, the regexes are the project.
2. A **Documentation Map** in the project's instructions file (CLAUDE.md /
   AGENTS.md): every canonical doc, its one purpose, and its "when to update"
   trigger. `docs-sync-reviewer` enforces it per-diff; the
   [drift-audit runbook](mechanisms/drift-audit.md) audits it periodically.
3. Domain reviewers — copy [reviewers/domain-reviewer-template.md](reviewers/domain-reviewer-template.md)
   for each project-specific lens (e.g. an RLS/backend reviewer, an
   RTL/text-surface reviewer) and add routes for them.
4. Git hook wiring (portable path): `git config core.hooksPath .githooks` and
   use the provided [pre-commit template](mechanisms/hooks/pre-commit).

## What deliberately stays per-project

Domain skills and rules do **not** live here: migration workflows, dependency
version policies, design-system/Figma rules, realtime-RLS proofs, platform
conventions. SSDD gives them a home (`.claude/skills/`, `.claude/rules/`, or
plain docs) and the coupling discipline; their content is the project's.

Keep whatever the adapter injects into *session context* small — instruction
files have real load budgets (hard lesson: a 37KB CLAUDE.md silently truncates
at ~25KB/200 lines in some harnesses).

## Known limitation

Injection is **copy-based**. Fixes made here do not propagate to projects that
already injected, and project-side edits don't flow back. That's deliberate —
projects diverge, and a live symlink would break "the framework travels with
the repo". To pick up upstream fixes, re-run `inject.sh` and review the diff
(it never overwrites `config.json`).

## This repo dogfoods itself

[SPEC.md](SPEC.md) is the framework's own design spec, written with its own
template before the files you're reading were created.
