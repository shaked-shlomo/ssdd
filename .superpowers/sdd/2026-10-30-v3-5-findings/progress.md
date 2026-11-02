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
Task 3: complete (71557d3, ef7b3c8; review-report 35/35).
- Tasks 4–8: one commit (f929d06): they share judge(), blockMessage and --stamp. review-findings.selftest.mjs written first (40 cases: 2 pass / 38 fail before the code), then 42/42. Four first failures were the tests' own (two setups committed the wrong files; two regexes); fixed in the tests.
- Tasks 4–8: Ruling (mine): a [pre-existing] finding citing an unrouted file is checked against the work tree's diff from HEAD (addedVsHead) — the change map holds routed paths only — cost if wrong: an extra git call per such finding.
- Tasks 4–8: two review-gate selftests pinned the old text and were updated: "names a flagged file" (the per-file issue count, gone by Decision 2) became "doesn't copy an entry's issue count onto its files"; the shell-quote test's regex reads the per-reviewer stamp line. review-gate 128/128.
Task 9: complete (3c2ebd6; repo selftest 23/23). Seven contracts (six reviewers + the domain template) gain the step; gate-reviewer check 5 names the finding line.
Task 10: complete (e84db86). SDD.md 10,538 → 10,953 bytes (≤ 11,000); no cut needed.
- Task 11: scratch install of the branch (claude-code,cursor): installed selftests 1,092 pass, 3 fail — all in tests shipped by 3.4.0 that read .ssdd/config.example.json, which an install doesn't ship (convention-lint "the example hex-colour rule"; review-gate's three routing-example cases). Not v3.5's; recorded in the spec's Deviations as found, not fixed.
- Task 11: by hand in that install: three reports leaving F2 open → round-3 warning in the block message; `✅ [F2] fixed` + a new ❌ → "F2 fixed, F6 ❌ open"; the commit passes and the triage note names [F6].
- Task 11: AC7 by hand: a v3.4.0 install's gate reads a stamp file this branch wrote (nothing owed), owes an edited file, and its own --stamp keeps `reviews` and `next`.
Task 11: suite 1617/1617 (node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs, before the release-files commit).
- Task 11: `update --to HEAD` of a scratch v3.4.0 install (claude-code,cursor): exit 0; added-lines.mjs and review-report.mjs land in .ssdd/hooks; all seven installed reviewer files carry the new step; the printed CHANGELOG holds `## [3.5.0]`. Its first cut had a `### Upgrade` "None." section, which update printed as a manual step; moved into the entry's intro (abc911b), and update prints no steps.
Task 11: complete. VERSION 3.5.0, CHANGELOG [3.5.0] dated 2026-11-02 (release-ready on the top session's instruction; the plan had said "unreleased"), SPEC.md row 3.5.0, BACKLOG's v3.5 entry gone. Not pushed, not merged, not tagged.
