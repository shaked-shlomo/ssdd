# SDD ledger — plan: docs/superpowers/plans/2026-10-30-v3-6-backlog.md

Spec: docs/specs/v3.6.md. Executor: superpowers:executing-plans (inline). Branch claude/optimistic-payne-28160f. main (`fdd4785`, 3.4.0 and 3.5.0 tagged) merged as `4237ef8` (SPEC.md and docs/BACKLOG.md conflicted: main's 3.4.0/3.5.0 rows kept, this branch's clarified v3.6 row and backlog item kept). Built on the user's word via the top session (2026-11-03): "build v3.6 (one backlog) now … make the release files ready for 3.6.0 … Don't push, merge into main, or tag."
Baseline: node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs → 1617/1617 at 4237ef8.

What 3.4.0/3.5.0 changed for this plan:
- Finding IDs are `F<n>` (v3.5 Clarify 6): the row form is `- [F12] <severity> …`; `[plan NN]` for a finding without one.
- SDD.md is 10,953 bytes (§3 now "one line per deferred finding, which gets a home"); after Task 2 → 10,943. AGENTS template 43 lines.
- SSDD's own checkout has no installed gate; reviewers run by hand per commit (plan, Global Constraints).

## Tasks
