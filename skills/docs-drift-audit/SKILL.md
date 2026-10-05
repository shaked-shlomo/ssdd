---
name: docs-drift-audit
description: >-
  Audits the whole repo for docs that drifted from the code: parallel read-only passes, one per
  doc↔code domain, every finding re-verified, then the docs fixed. Use for "audit the docs" or a
  map staleness check; per-diff coupling is docs-sync-reviewer's job.
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
