# SDD ledger — plan: docs/superpowers/plans/2026-10-21-v3-prod-guard.md

Spec: SPEC.md → v3 → Part 4. Executor: superpowers:executing-plans (inline). Branch claude/v3-prod-guard-c3c7d0 (cut from local main at v3.1.1), BASE f1cc647.

Clarify (2026-10-20/21, before the plan):
- Owner rulings (2026-10-21, AskUserQuestion): Cursor gets deny (its hooks ignore ask; staff-confirmed); MCP writes keep ask (07-27 was an interrupt of an in-flight call, not a rejected prompt); the fixture is redacted to kinds + verdicts; reads Postgres doesn't hold to READ ONLY pass on the static check; proof frame and live extensions come from config; MCP: everything but known reads asks; psql to a Supabase host is guarded.
- Real data first: Hatedate's transcripts (read-only) replayed through its own guard versions → 89 asks 09-28..10-17 (handover said 79, method unrecorded); 20 -f files lost; 1 guard self-test excluded. 2 writes (10-15 seed/cleanup), 2 rollback probes (10-08). prizma: 96 MCP execute_sql (66 static reads, 10 writes, 20 allowlist misses), 16 local `db reset`.
- Found: Hatedate's guard asks on every `supabase db reset` (local by default) — fixed in the pack. Its strict-shape path made `2>&1 | tail` ask on reads (26 of its false positives).
- Corpus scripts and outputs: session scratchpad `replay/` (private paths, SQL, commit text). Never committed.
Baseline: node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs → 835/835 at f1cc647.
