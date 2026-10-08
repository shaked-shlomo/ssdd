# v2.5 gate hardening — implementation plan

Spec: SPEC.md → "v2.5 — close the remaining gate weaknesses".
Branch: `v2.5-gate-hardening`. Tests first for each task; one commit per task.

| # | Task | Files | Criteria |
|---|---|---|---|
| 1 | Shared loader: HEAD ∪ index config, working-tree fallback, absent vs broken | `mechanisms/hooks/ssdd-config.mjs` (+ selftest) | union, broken |
| 2 | Review gate on the loader: broken blocks, union routes, merged reviewers, reviewerModels sets | `review-gate.mjs`, `review-gate.selftest.mjs`, `review-stamp.selftest.mjs` | broken, broken HEAD, union (gate), completion stamps |
| 3 | git-guard on the loader | `git-guard.mjs`, selftest | union (guard) |
| 4 | convention-lint absent vs broken | `convention-lint.mjs`, selftest | convention-lint |
| 5 | `gate-reviewer` + its route | `reviewers/gate-reviewer.md`, `config.example.json` | gate files |
| 6 | Dormant-hook note (gate), `status` warnings, `prepare` next step | `review-gate.mjs`, `bin/ssdd.mjs`, selftests | status, harness note, next steps |
| 7 | CI workflow; run the suite under Node 18 locally | `.github/workflows/test.yml` | CI |
| 8 | README, CHANGELOG, VERSION, BACKLOG; update test from v2.4.0; spec verification | docs | update, existing tests |

Push the branch and open a PR after task 8 (owner ruling 4).
