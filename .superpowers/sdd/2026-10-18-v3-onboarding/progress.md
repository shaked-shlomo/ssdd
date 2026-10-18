# SDD ledger — plan: docs/superpowers/plans/2026-10-18-v3-onboarding.md

Spec: SPEC.md → v3 → Part 2. Executor: superpowers:executing-plans (inline). Branch claude/goofy-faraday-0bc0ee (cut from local main), BASE 71c95e4.

Pre-flight (shared interfaces):
- T1 AC_ID/CHECKBOX/entries.notRecorded → T2 (plan-migrate), T3 (--migrate-check not-recorded list): match.
- T2 migratePlan/todoFor/lostText/idRange/needsMigration → T3 (CLI), T4 (view count): match.
- T4 collect().onboarding → T6 (bin status/update): match. bin already imports work-state.mjs (CLI runs only when executed directly).
- T5 record writes audited → T4 skillsAudited reads it: match (top-level "audited", non-empty string).
- T7 DEFAULT_PATHS.specs → T8 skill names it: match.
