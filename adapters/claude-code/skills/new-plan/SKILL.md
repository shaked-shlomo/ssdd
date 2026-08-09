---
name: new-plan
description: Create the next numbered plan doc in .ssdd/plans/ with the SSDD template (clarify pass first, then Goal / Non-goals / Acceptance criteria written BEFORE implementation; Verification closes against them), or sync a finished plan back. Use when a plan is approved (exiting plan mode), when starting a numbered piece of work, or when completing/updating one ("sync the plan").
---

# New plan / plan sync — `.ssdd/plans/` workflow

Plans are the repo's cross-session record: one numbered markdown file per
plan, `NN-kebab-slug.md`. The harness's own plan UI (if any) is still where a
plan is CREATED and approved — this skill persists it to the repo and keeps it
synced. The full process contract lives in `.ssdd/process/SDD.md`.

## Creating (plan approved → repo file)

1. **Number:** next = highest existing `NN-` prefix + 1:
   `ls .ssdd/plans/ | grep -oE '^[0-9]+' | sort -n | tail -1`
   Never reuse, skip, or backfill numbers.
2. **Strays check:** any file in `.ssdd/plans/` NOT matching `NN-*.md`
   violates the numbering convention — flag it to the user (number it or fold
   it into a numbered plan); never add more unnumbered files.
3. **Clarify — interrogate the plan BEFORE criteria are written.** List every
   assumption the approved plan makes: UX behavior (empty/error/loading
   states), design coverage (a mock for every state? interaction/motion
   specified, not guessed?), data (schema/authorization/query shape), platform
   differences, permission/monetization gates, edge cases (offline, degraded,
   suspended user, free-vs-paid). For each: resolve it from the source (the
   design file, the schema, the code — never assume, verify first) or ASK the
   user. An unresolved assumption must NOT silently become an acceptance
   criterion — park it in `## Open questions`; the plan stays DRAFT while any
   remain.
4. **File:** `.ssdd/plans/NN-<kebab-slug>.md` from
   `.ssdd/process/templates/plan-template.md`, filled from the approved plan.
   **Acceptance criteria are written NOW, before implementation** — they
   define "done"; Verification later closes against them, not against vibes.
5. For multi-task plans, also start the ledger from
   `.ssdd/process/templates/task-ledger-template.md`.
6. Plan docs are tracked — stage them with the work's first commit (the
   pre-commit hook blocks on untracked files anyway).

## Syncing back (work done / plan changed)

- Update **Status** (+ PR number), close each acceptance criterion in
  **Verification** with real command output, record **Deviations &
  discoveries**, and promote gotchas to rules/memory.
- Sync direction is two-way: if the plan changed mid-flight in the harness's
  plan UI, mirror the change here in the same commit as the code it drove.
- The coupled docs keep their own same-commit rules (architecture maps,
  requirements checklist, version ledger) — the plan doc supplements them,
  never replaces them.
