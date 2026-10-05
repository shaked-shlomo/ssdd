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

---

# v2 — back-port from the first injected project

**Date:** 2026-10-05 · **Status:** shipped (v2)

## Goal

Bring upstream what ~38 plans of real use changed in the first project that
injected v1 (`.ssdd/` diverged there on purpose — copy-and-diverge is the v1
model). Only changes that proved out in that project come back; project
routing, domain reviewers and domain skills stay there.

## Scope

**In:**
- **Review gate v2** — stamps per reviewer × per routed file × that file's
  staged blob pair (`srcMode:srcBlob→dstMode:dstBlob`), `--stamp … --files …`
  delta rounds, a block message that names what each reviewer still owes, and
  an oversize warning (`reviewGate.maxRoutedFiles`). Chosen over the v1
  whole-diff hash because v1 could not converge: any edit voided every stamp.
- **Multi-harness hook stdin** (`stdin-payload.mjs`) — Claude Code and Cursor
  payload shapes; hooks always print a JSON permission body (Cursor
  `failClosed` reads missing JSON as a block).
- **git-guard hardening** — global flags before the subcommand
  (`git -C x add -A`), bundled short flags (`-vA`), flags between `add` and
  the selector. Plus a corrected force-push rule in the example config (v1
  blocked `--force-with-lease`, the remedy its own message prescribed, and
  missed `-f` / `+refspec`).
- **Hook test suites**, ported from vitest to `node:test` to keep zero deps.
- **Process**: "findings are records; ledger rows are verified against the
  staged blob before they are written"; a Clarify-pass section in the plan
  template; Rulings + Execution in the ledger; a handover template; BUILT and
  SUPERSEDED statuses.
- **One source of truth per artifact** — `AGENTS.md` canonical and
  `CLAUDE.md` = `@AGENTS.md` + harness notes; `.agents/skills/` as the only
  skills tree; `.claude/agents/` and `.claude/skills/` as symlinks
  ("doorbells"). Chosen over copies because v1's copied agents drifted.
- **Cursor adapter** (`adapters/cursor/`).
- **Versioned releases and updates** — `VERSION`, `CHANGELOG.md` with upgrade
  notes, annotated `vX.Y.Z` tags, and `bin/ssdd.mjs` (install / update /
  adopt / status) writing `.ssdd/ssdd.lock.json`. `update` three-way merges
  each framework file against the locked version, using this repo's git
  history as the base store. Chosen over git subtree (needs one prefix; SSDD
  spans `.ssdd/`, `.agents/`, `.githooks/`, `.cursor/`), submodules (break
  "travels with the repo"), Copier (does this, but adds Python) and a plugin
  marketplace (no per-project edits, no Cursor). v1's re-inject was `cp -R`,
  which silently overwrote project edits to framework files.
- **git-guard: `commit -n` and `core.hooksPath` overrides** — found while
  comparing with the original source project; `git commit -anm` passed every
  gate.

**Out (deliberate):**
- The six gate-evasion weaknesses (README → Known limitations). The source
  project wrote ~800 lines of fixes inside an unrelated commit, found them
  incomplete round after round, and removed them; they get their own plan.
- Plugin packaging / model-era rewrites of the prose — proposed separately in
  [docs/model-era-review.md](docs/model-era-review.md), not applied here.

## Key decisions

1. **A stamp names both sides of the diff.** A re-stage that changes nothing
   keeps its stamps (by design now); an edit, deletion, mode change or new
   base voids it for that file only. Unrouted files never enter a key.
2. **Oversize is a warning, not a block** — it signals the per-task rule
   being skipped; the remedy is splitting the commit.
3. **Symlinks over copies** for harness discovery paths. Cost: Windows needs
   `git config core.symlinks true` (and Developer Mode).

## Acceptance criteria

- [x] `node --test mechanisms/hooks/*.test.mjs` passes with zero npm installs.
- [x] `inject.sh` on a scratch repo, for each adapter, yields resolving
      symlinks and a gate that blocks → `--stamp` → passes with a v2 stamp.
- [x] No file outside `SPEC.md` names the source project's plans/PRs as
      requirements (genericized examples only).
- [x] `node --test bin/*.test.mjs` covers install / update (clean, merged,
      conflict, sidecar, removal, dirty refusal, `--to`, new adapter) /
      adopt (v1 layout) / status, against a fake ssdd repo with a layout move.
- [x] A copy of the first injected project's framework files adopts
      `--base v1.0.1` and updates to v2 with project edits preserved and
      only genuine overlaps reported as conflicts.

*Verified 2026-10-05 at `ce02fe9` (the v2.0.0 content): `node --test
bin/*.test.mjs mechanisms/hooks/*.test.mjs` → 184 pass, 0 fail. Replay on a
scratch copy of the first injected project (its real repo untouched): adopt
traced 16 files to v1.0.1; update → 11 unchanged, 3 updated, 1 added, 4
conflicts (git-guard 1 hunk, review-gate 4, SDD.md 2, performance-reviewer 1
— each a line both sides rewrote: the project's plan-numbered text vs v2's
genericized text), 6 `.ssdd-new` sidecars for files the project added that v2
now ships (its own cleanup / docs-drift-audit skills, Cursor rule, vitest
suites); the git-guard `-n`/hooksPath fix merged in; project reviewers,
config and symlinks untouched.*

*Verified 2026-10-05: 135/135 tests on Node 24.15.0 (134 pass + 1 skipped
when run from an injected `.ssdd/hooks/`, where the example config is
absent); inject for `claude-code,cursor`, `cursor`, `generic`; a scratch
commit blocked → `--stamp` → `--files` delta → committed; re-inject keeps
seeded files and warns on a v1 copied agent; source-project grep clean.*
