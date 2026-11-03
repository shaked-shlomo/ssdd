# SDD ledger — plan: docs/superpowers/plans/2026-10-30-v3-6-backlog.md

Spec: docs/specs/v3.6.md. Executor: superpowers:executing-plans (inline). Branch claude/optimistic-payne-28160f. main (`fdd4785`, 3.4.0 and 3.5.0 tagged) merged as `4237ef8` (SPEC.md and docs/BACKLOG.md conflicted: main's 3.4.0/3.5.0 rows kept, this branch's clarified v3.6 row and backlog item kept). Built on the user's word via the top session (2026-11-03): "build v3.6 (one backlog) now … make the release files ready for 3.6.0 … Don't push, merge into main, or tag."
Baseline: node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs → 1617/1617 at 4237ef8.

What 3.4.0/3.5.0 changed for this plan:
- Finding IDs are `F<n>` (v3.5 Clarify 6): the row form is `- [F12] <severity> …`; `[plan NN]` for a finding without one.
- SDD.md is 10,953 bytes (§3 now "one line per deferred finding, which gets a home"); after Task 2 → 10,943. AGENTS template 43 lines.
- SSDD's own checkout has no installed gate; reviewers run by hand per commit (plan, Global Constraints).

## Tasks
- [x] Task 1 — template, seeding, candidates (AC1–AC3). Tests first: 11 new fail, then pass; one failure was the test's own (`docs/requirements-notes.md` starts with "requirements", so it is a candidate by Clarify 3; dropped from "not candidates"). Suite 1628/1628.
      Reviews: gate-reviewer CLEAN (⚠️ the plan's two-candidate order was wrong; fixed in the plan). security-reviewer SECURE, then on the fix SECURE: ⚠️ escape characters in a printed file name → fixed (control, C1 and bidi characters skip the name, as the reviewer proposed, with tests); ⚠️ `seedOne` follows a dangling symlink → `deferred`: pre-existing for every seeded file, the content is a fixed template; it gets a row in BACKLOG.md (Task 4). docs-sync 2 ISSUE(S): `docs/usage.md` Setup didn't list `BACKLOG.md` or the candidate line, and its Process row didn't name the backlog template → both fixed in this commit.
- [x] Task 2 — the names in shipped text (AC4, AC5). Tests first: 4 fail, then pass. SDD.md 10,953 → 10,943 bytes; AGENTS template 44 lines. Suite 1632/1632.
      Reviews: gate-reviewer CLEAN; ⚠️ the ledger template's Follow-ups still offered "its own task" as a home beside a BACKLOG row → fixed (a deferred finding is fixed this session or has its row, "its own task included"), re-review CLEAN. ⚠️ for the owner: the docs-sync coupling drops "with a dated changelog bullet" (the plan's wording; the backlog template has Done instead of a changelog) — `intentional`. docs-sync 1 ISSUE(S): ❌ [pre-existing] SSDD has no Documentation Map of its own — `pre-existing`; ⚠️ README "checklists" (36) left generic; ⚠️ README's link moves in Task 4.
