# SDD ledger — plan: docs/superpowers/plans/2026-10-30-v3-5-findings.md

Spec: docs/specs/v3.5.md. Executor: superpowers:executing-plans (inline). Branch claude/v3-4-plan-98c5d4, main (v3.4.0, 1f069b6) merged as 1e6a9ff (SPEC.md's table conflicted; main's v3.4 row kept). Built on the top session's word: "The owner wants v3.5 (findings), then v3.6, landed on main in order" (2026-11-02).
Baseline: node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs → 1531/1531 at 1e6a9ff.

Task 1 — the v3.4 assumptions (B1–B9), against 1e6a9ff:
- B1 holds: no harness mode; blockMessage(verdict, repoHint); the pre-commit passes ` --repo <repo>`.
- B2 holds: parseVerdict, subagentHook, stampingMode, refused, model-id.mjs gone. triageNote still reads `e.issues` (dead: nothing writes it); the carry predicate also reads `entry.issues`.
- B3 differs, for the better: the change map is `workTreeChanges(cfg)` → { changes, merged }, and its scratch `git add -A` writes the reviewed blobs, so Task 5 needs no hash-object. --check/--pre-commit judge `stagedOwed()`.
- B4 holds: `carrier(cfg)` → (name, path, entry, now); Task 8 passes it the open findings.
- B5 holds: SDD.md is 10,538 bytes (462 free); §4 step 3 is the plain --stamp text.
- B6 holds: the six report blocks are 3.3.2's; gate-reviewer check 5 says "the verdict line changed" (the completion-stamp clause is gone).
- B7 holds: review-stamp and shapes selftests deleted.
- B8 holds: commentReviewer added; maxRoutedFiles still read raw in review-gate.
- B9 holds: VERSION 3.4.0.
Task 1: complete (no code).
Task 2: complete (6ab3177; added-lines 6/6, convention-lint unchanged and passing).
- Task 3: real data (AC1). The sampler re-run first (2026-11-02): 2,434 replies with a verdict, x = 1,911 (was 1,687 on 2026-10-30). parseReport over the same final replies: 2,435 with a verdict, 0 throws, parsed ❌ (findings + still-open answers) = N in 1,913 (≥ 1,911); 4,439 findings, 3,493 with a place.
- Task 3: the commit-time security review flagged CLEAN/SECURE read case-insensitively (a line "Clean up later" read as a verdict), looser than 3cf89af's parseVerdict. Fixed: upper case only, as before, with a test; the real-data counts above are after the fix.
