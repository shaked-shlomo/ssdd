# SDD ledger — plan: docs/superpowers/plans/2026-10-20-v3-cheaper-gate.md

Spec: SPEC.md → v3 → Part 3. Executor: superpowers:executing-plans (inline). Branch claude/v3-cheaper-gate-cc1697 (cut from local main at v3.0.0), BASE 722bc60.

Clarify (2026-10-20, before the plan):
- Owner rulings: plan numbers stay, with the duplicate report (decision 7); git 2.38 for the merge rule, falling back on older git; lint only added lines joins Part 3.
- Real data first: prizma's 4 SKIP'd merges replayed with merge-tree in a scratch clone → routed files owed 120 → 1. A clean `git merge` runs pre-merge-commit, not pre-commit (scratch check), so the rule only meets stopped merges.
- Found: the harness gate refuses chained staging, -a and pathspec commits before it looks for a config, so a scratch repo is refused (Evidence said it passed). Fixed in Task 7.
- Found: convention-lint --staged reads the disk file, not the staged blob. Fixed in Task 3.
- Found: git-guard checks only the first `git config … core.hooksPath` in a call; a read then a write would pass once reads are allowed. Task 1 scans every match.
- Hatedate corpus (transcripts, read-only): 209 add→commit chains (99 add only unrouted files), 4 hooksPath commands. Kept in the scratchpad (private paths and commit text).
