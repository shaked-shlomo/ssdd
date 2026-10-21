# SDD ledger — plan: docs/superpowers/plans/2026-10-21-v3-trimming.md

Spec: SPEC.md → v3 → Part 5 (docs/specs/v3.md → Part 5 after Task 1). Executor: superpowers:executing-plans (inline). Branch claude/v3-trimming-f3f1f8 (cut from local main at v3.2.1), BASE 0754fec.

Clarify (2026-10-21, before the plan):
- Read-only: prizma's .agents/skills/cleanup/SKILL.md (11,565 B, at f0f2600) and Hatedate's .claude/skills/cleanup/SKILL.md (13,321 B, at 795188aa). Nothing written there.
- /doctor prompt-audit runs headless: `claude -p "/doctor prompt-audit"` in a scratch install of v3.2.1 (claude-code,cursor), Claude Code 2.1.304. Output kept in the session scratchpad (audit-before.out); summary in Clarify 48.
- SessionStart payload: Claude Code's hooks doc (optional `model`), Cursor's hooks doc (`model`, `model_id` on every hook). A throwaway SessionStart hook to log the live payload was refused by this session's permission classifier ("Unauthorized Persistence"); not retried another way.
Baseline: node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs → 1264/1264 at 0754fec.
Pre-flight (shared interfaces):
- T1 bin/repo.selftest.mjs helpers (REPO, read, tracked, slug, links) → T2, T4–T7 add describes: match.
- T3 PARTS / partOf / parseWith / partsFromLock, lock `with` → T7's README text and T8's update check: match.
- T5/T6 budgets → AC44's numbers: match.
