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
