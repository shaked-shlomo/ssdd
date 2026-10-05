---
name: docs-drift-audit
description: >-
  Full-repo docs-drift audit — fan out parallel read-only subagents, one per doc↔code domain,
  to find where the canonical maps/docs have drifted from the code, re-verify every finding,
  then fix the DOC side. Use when the user asks to audit the docs, check the maps for
  staleness, or run a drift audit. Not for diff-scoped doc coupling (that's
  docs-sync-reviewer's job on a commit/PR) and not for reviewing code quality (cleanup).
---

Run the full-repo docs-drift audit. The procedure is `.ssdd/drift-audit.md` — read it and
follow it; this skill is the invocation surface, the runbook is the procedure.

Project-specific domain list for Phase 1 (derive the rest from AGENTS.md → Documentation Map):

<!-- Fill in one line per doc↔code domain, e.g.
1. `docs/maps/data-map.md` vs `migrations/` + the data-access layer
2. `docs/maps/flows-map.md` vs routes, jobs, CI workflows, scripts
3. Secrets map + `.env.example` vs a repo-wide env-access grep
4. Public claims (method/terms/about pages) vs the code they describe — often the
   highest-stakes drift class
-->
