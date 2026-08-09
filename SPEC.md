# SSDD framework extraction — design spec

**Date:** 2026-08-09 · **Status:** shipped (v1)

## Goal

Generalize the spec-driven development workflow proven in the HateDate repo
into a standalone, personal framework that can be injected into any future
project, independent of the agent/harness/IDE driving the work.

## Scope (decided at extraction)

**In:**
- The process: brainstorm → spec → plan (numbered, clarify pass, acceptance
  criteria first) → per-task ledger → review-gated commits → verification
  against criteria with real output → same-commit doc coupling → gotcha
  promotion. Templates for spec, plan, and task ledger.
- The five generalizable reviewer lenses (docs-sync, convention-compliance,
  resilience, performance, security) as harness-neutral checklists, plus a
  template for adding project-specific domain lenses.
- The enforcement mechanisms (review-gate, git-guard, convention-lint)
  rewritten **config-driven** (routing/rules move from code into
  `.ssdd/config.json`) and **dual-mode**: a portable git-hook/CLI entry that
  works under any harness, plus a Claude Code hook entry for earlier
  interception and better error routing.
- The docs-drift-audit runbook, generalized.
- Adapters: `claude-code/` (first-class) and `generic/` (an AGENTS.md
  template). A dumb copy-based `inject.sh`.

**Out (deliberate):**
- Domain-specific skills/rules from the source project (Supabase migration
  workflow, dependency-versioning policy, Figma/design-system rules,
  realtime-RLS proofs) — they stay per-project; the framework only reserves
  their place and the coupling discipline.
- Sync tooling between this repo and injected copies (v1 is copy-and-diverge).
- Adapters for harnesses beyond Claude Code and the generic AGENTS.md.

## Key decisions

1. **Enforce at the git layer, adapt at the harness layer.** Harness hook
   protocols don't survive "no matter the agent"; `git commit` does. The
   portable enforcement point is a git `pre-commit` hook; harness hooks are
   sugar on the same core scripts.
2. **Config is the injection contract.** The HateDate hooks hardcoded routing
   regexes and lint greps; those are the *per-project* half. SSDD ships the
   mechanism; `.ssdd/config.json` carries the instance.
3. **Reviewers keep their "every check shipped as a real bug" character** but
   the war stories are rewritten as genericized, clearly-marked examples —
   the rule survives, the project-specific file names don't.
4. **The task ledger is a first-class artifact** — the per-task
   `commit / spec ✅ / quality ✅ / findings triage` record plus the final
   whole-plan review is the most distinctive part of the source workflow and
   gets its own template.
5. **Copy, don't symlink**, on injection: projects diverge, and the framework
   must travel with each repo.

## Acceptance criteria

- [x] A fresh reader can run `inject.sh` on a new repo and know, from README +
      printed output alone, the manual wiring steps left. *(inject.sh dry-run
      verified on a scratch repo; prints per-adapter steps.)*
- [x] `review-gate.mjs --pre-commit` blocks a commit touching a routed path
      with no stamp, and passes after `--stamp` — with zero npm installs.
      *(Verified in a scratch repo; see repo history.)*
- [x] The same script also functions as a Claude Code PreToolUse hook without
      modification. *(Verified with a synthetic hook payload.)*
- [x] No file in `process/` or `reviewers/` mentions HateDate-only systems as
      requirements (they may appear in marked examples). *(Grep-verified.)*
- [x] The framework documents its own known limitation (copy-based drift).
