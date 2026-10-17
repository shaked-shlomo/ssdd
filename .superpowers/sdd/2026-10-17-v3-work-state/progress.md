# SDD ledger — plan: docs/superpowers/plans/2026-10-17-v3-work-state.md

Spec: SPEC.md → v3 → Part 1. Executor: superpowers:executing-plans (inline). Branch v3, BASE 0d3eb89.

Pre-flight (shared interfaces):
- T1 cfg.paths → T3, T5 consume `cfg.paths.plans/ledgers`: match.
- T2 parse API → T3, T4, T5: match (names as in T2 Produces).
- T3 collect/render → T4: match. T3 ledgerIgnoreRule → T5 and T6 (bin imports work-state.mjs): conflict — importing would run the CLI. Ruling: work-state.mjs runs its CLI only when executed directly (import.meta.url vs argv[1]) — needed for T6's import — cost if wrong: bin prints a view on every status call.
- T5 edits mechanisms/hooks/pre-commit; T6 ships it as a managed file: no conflict.
- T7 references T4's flags `--session-start` / `--session-start=cursor`: match.
Task 1: complete (commits 0d3eb89..c825b2c, tests: node --test mechanisms/hooks/ssdd-config.selftest.mjs bin/ssdd.selftest.mjs → ℹ duration_ms 19256.817708)
Task 2: complete (commits c825b2c..51dc215, tests: node --test mechanisms/hooks/plan-parse.selftest.mjs → ℹ duration_ms 32.673667)
- Task 3: Ruling: stale rule — "holds a different copy" covers the plan file OR its ledger (spec Clarify 6 says the plan file, but its known-miss note relies on ledger edits counting as work) — cost if wrong: a branch that only updates the ledger is reported as worked on instead of flagged.
- Task 3: early real-data run on prizma (read-only), 0.43 s: plan 34 flagged; found and fixed 3 issues by test first — status tokens cut to one word (IN REVIEW → IN), absolute .git/info/exclude path from a linked worktree, markdown in ledger next text.
Task 3: complete (commits 51dc215..2755cbd, tests: node --test mechanisms/hooks/work-state.selftest.mjs mechanisms/hooks/plan-parse.selftest.mjs mechanisms/hooks/ssdd-config.selftest.mjs → ℹ duration_ms 3342.18025)
- Task 4: Ruling: a broken config.json doesn't silence the view — it prints with a `! <config error>` line (plan said ≤1 line) — every commit is blocked until it's fixed, so the session should see why — cost if wrong: one extra line at session start.
Task 4: complete (commits 2755cbd..680a219, tests: node --test mechanisms/hooks/work-state.selftest.mjs → ℹ duration_ms 4199.693625)
- Task 5: a patch script's String.replace turned `$'` into 'text after the match' and spliced pre-commit; caught by the pre-commit test (RED), file rewritten whole; work-state.mjs checked for the same (one copy of each function, node --check ok).
Task 5: complete (commits 680a219..88d298d, tests: node --test mechanisms/hooks/work-state.selftest.mjs mechanisms/hooks/review-gate.selftest.mjs → ℹ duration_ms 8255.063292)
- Task 6: Ruling: the installer tests add a per-test v3.0.0 release carrying mechanisms/superpowers-sdd.gitignore instead of editing buildSource's v2.0.0 (plan said v2.0.0) — keeps every existing fixture's meaning — cost if wrong: none beyond a helper.
Task 6: complete (commits 88d298d..ad03d8e, tests: node --test mechanisms/hooks/convention-lint.selftest.mjs mechanisms/hooks/git-guard.selftest.mjs mechanisms/hooks/plan-parse.selftest.mjs mechanisms/hooks/review-gate.selftest.mjs mechanisms/hooks/review-gate.shapes.selftest.mjs mechanisms/hooks/review-stamp.selftest.mjs mechanisms/hooks/ssdd-config.selftest.mjs mechanisms/hooks/work-state.selftest.mjs bin/skills-audit.selftest.mjs bin/ssdd.selftest.mjs → ℹ duration_ms 20182.119417)
Task 7: complete (commits ad03d8e..29dcea3, tests: node --test bin/ssdd.selftest.mjs → ℹ duration_ms 18086.994667)
- Task 8: Ruling: BACKLOG's "Plan 1 done" moves to Task 9, after verification — marking it done before the criteria are checked would be a claim without evidence — cost if wrong: none.
Task 8: complete (commits 29dcea3..a7a7a0e, tests: node --test mechanisms/hooks/convention-lint.selftest.mjs mechanisms/hooks/git-guard.selftest.mjs mechanisms/hooks/plan-parse.selftest.mjs mechanisms/hooks/review-gate.selftest.mjs mechanisms/hooks/review-gate.shapes.selftest.mjs mechanisms/hooks/review-stamp.selftest.mjs mechanisms/hooks/ssdd-config.selftest.mjs mechanisms/hooks/work-state.selftest.mjs bin/skills-audit.selftest.mjs bin/ssdd.selftest.mjs → ℹ duration_ms 22305.874875)
- Task 9: AC8's close-check half had no test; added "paths.plans honored by the close check" — passed on first run (pins Task 5's behavior, not new code). Installed-layout run caught the pre-commit path (RED there), fixed by looking in both places.
Task 9: complete (commits a7a7a0e..d9b662c, tests: node --test mechanisms/hooks/convention-lint.selftest.mjs mechanisms/hooks/git-guard.selftest.mjs mechanisms/hooks/plan-parse.selftest.mjs mechanisms/hooks/review-gate.selftest.mjs mechanisms/hooks/review-gate.shapes.selftest.mjs mechanisms/hooks/review-stamp.selftest.mjs mechanisms/hooks/ssdd-config.selftest.mjs mechanisms/hooks/work-state.selftest.mjs bin/skills-audit.selftest.mjs bin/ssdd.selftest.mjs → ℹ duration_ms 21399.453042)

Final review: fresh reviewer (opus) on 37facab..d9b662c — "With fixes": 1 Critical, 7 Important, 8 Minor. Re-graded M6 (cap drops every ! line, incl. the config error) to Important by effect.
Final: fixed C1 merge blocked by a plan it brings in unchanged — "a merge bringing plans from main is not blocked by them" RED→GREEN (a plan the resolution edits is still checked), suite 550/550
Final: fixed I1 --staged read CLAUDE_PROJECT_DIR/SSDD_PROJECT_DIR (bypass, wrong index in worktrees) — "judges the repo at the cwd…" RED→GREEN, suite 550/550
Final: fixed I2 pre-commit exemption missed non-ASCII ledger names (C-quoted) — "pre-commit: a ledger with a non-ASCII name is exempt too" RED→GREEN, suite 550/550
Final: fixed I3 DRAFT/BUILT on main worked on elsewhere showed no work — "a DRAFT on main worked on in a worktree shows that work, from either checkout" RED→GREEN, suite 550/550
Final: fixed I4 indirectly linked Superpowers ledger not watched by the stale rule — "a branch advancing only an indirectly linked ledger counts as working" RED→GREEN, suite 550/550
Final: fixed I5 template placeholder Verification lines counted as entries — "the plan template's example lines are not Verification entries" RED→GREEN, suite 550/550
Final: fixed I6 git calls grew per ledger × source (154 on the fixture) — "git calls stay bounded with many tracked ledgers" (≤40 view, ≤12 close check) RED→GREEN, suite 550/550
Final: fixed I7 detached worktree counted as working — "a clean detached worktree at an old commit doesn't count as working" RED→GREEN, suite 550/550
Final: fixed M6 (re-graded Important) cap dropped every ! line — "warnings survive the cap" RED→GREEN, suite 550/550
Final: minor (deferred): M1 a ledger's plan: line can name a file outside the worktree (read, not printed); resolve and require a regular file inside the worktree
Final: minor (deferred): M2 an unrecognized Status line (`**Status**: X`, in a list item, after **Date:**) blocks with 'Status ""' — say "no **Status:** line found" and strip */backticks around the word
Final: minor (deferred): M3 sections start only at ## — a ### Verification under ## Acceptance criteria isn't read, so BUILT is falsely blocked
Final: minor (deferred): M4 non-ASCII repo path quotes the ignore-rule source — fixed in passing by check-ignore -z in I6
Final: minor (deferred): M5 no fallback to refs/remotes/origin/<name> when origin/HEAD is unset (git < 2.48 remote add + push)
Final: minor (deferred): M7 parser edges — "(none)" counts as an open question, lowercase "deferred" counts as verified, "- [x] **AC1**" in Verification isn't an entry; literal BOM in the regex
Final: minor (deferred): M8 an edited .superpowers/sdd/.gitignore aborts install (as other clashes do); --force would overwrite it; update's .ssdd-new sidecar lands under the * rule and is hidden from git status
Final: Ruling: declined-to-judge items (Cursor delivery, stale-branch rows, unlinked-ledger noise, force-added ignored ledgers, FIFOs in plans/, no SessionStart timeout, Windows paths, Hatedate's ignore, gate merge cost, DEFERRED checks) — each is outside Part 1 or already recorded; I6's fix makes a hook timeout unnecessary at today's sizes — cost if wrong: a slow repo could still delay session start.
