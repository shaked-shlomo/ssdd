# v2.6 gate simplify — implementation plan

Spec: SPEC.md → "v2.6 — simplify the gate to its threat model".
Branch: `v2.6-simplify`. Tests first for each task; one commit per task.

Baseline (on `fbda1ee`): `mechanisms/hooks/*.mjs` without selftests 1,169
lines; selftests (`mechanisms/hooks/` + `bin/`) 2,575 lines; 466 tests pass.

| # | Task | Files | Criteria |
|---|---|---|---|
| 1 | Loader reads the working-tree config. Keep absent / broken and `dormantHook`. Drop the HEAD / index reads, `merge` and `warnings`. Keep the returned shape (`reviewerModelSets` = `[reviewerModels]` when set) so callers don't change. | `ssdd-config.mjs`, `ssdd-config.selftest.mjs` (drop the union cases, add "an unstaged edit applies") | working-tree config, broken / absent |
| 2 | Review gate on the new loader. Remove the union cases from "the config a commit is judged by" (staged deletion, dropped route, HEAD-only `--stamp`, both-configs dedupe, HEAD exclude, broken-HEAD warning). Rewrite the broken cases for the working tree. Add: an unstaged route edit applies; HEAD's routes stop applying. | `review-gate.mjs` (the warnings loop and header comment), `review-gate.selftest.mjs` | working-tree config, broken / absent |
| 3 | git-guard on the new loader. Replace "the guard can't be loosened by an uncommitted config edit" with: an unstaged `"manual"` re-enables `--stamp`; a broken config leaves the defaults on. | `git-guard.mjs` (header comment), `review-stamp.selftest.mjs` | working-tree config, broken / absent |
| 4 | Stop unwrapping shell wrappers. Remove `flatten`, `expandWrappers`, `innerScript`, `heredocBodies`, `SHELLS` and `PIPE_TO_SHELL`. The gate uses `skeleton(cmd)` / `splitCommands(cmd)`; git-guard uses `full = cmd`. The v2.1.1 wrapper cases move to allowed lists ("not unwrapped"). The hooks-mode `bash -c '… --stamp …'` denial stays. Add the backstop test: with the hook armed and a routed file staged, `bash -c 'git commit -m x'` run from a shell exits 1. | `git-cmd.mjs`, `review-gate.mjs`, `git-guard.mjs`, `git-guard.selftest.mjs`, `review-gate.shapes.selftest.mjs`, `review-gate.selftest.mjs` | wrappers + backstop, direct shapes, quoted mentions |
| 5 | Make `gate-reviewer` opt-in. Remove its route from the example config, and give the route as an opt-in snippet in the reviewer's header. Remove `GATE_FILES` and the unrouted listing from `status`; the broken-config and dormant-hook warnings stay. Rewrite "status: is the gate armed?" and the example-config route test: no `gate-reviewer` route, the reviewer still ships, and `install` links `.claude/agents/gate-reviewer.md`. | `mechanisms/config.example.json`, `reviewers/gate-reviewer.md`, `bin/ssdd.mjs`, `bin/ssdd.selftest.mjs` | gate-reviewer opt-in |
| 6 | Add `"if": "Bash(git *)"` to the review gate's PreToolUse(Bash) entry only. Selftest: the template's review-gate entry has the filter, and git-guard, SubagentStart / Stop and convention-lint don't. | `adapters/claude-code/settings-hooks.json`, `bin/ssdd.selftest.mjs` | `if` filter (template) |
| 7 | Docs: | | docs |
|   | • README: drop "Keep the `gate-reviewer` route…" (Injecting, step 1), the gate-files bullet and the "first commit of a config" limitation. Put the threat-model rule first in Known limitations. Add what the Claude Code gate doesn't see (`/usr/bin/git`, `env` / `sudo`, shell wrappers). | `README.md` | |
|   | • AGENTS template: drop the "once committed" paragraph. | `adapters/generic/AGENTS.md` | |
|   | • D13: un-withdraw it, pointing at Clarify 9. | `docs/model-era-review.md` | |
|   | • BACKLOG: add the threat-model rule; drop the "first commit" limitation and the v2.5 paste-the-route item; move the adoption items to the top. | `docs/BACKLOG.md` | |
| 8 | CHANGELOG 2.6.0 (Removed / Changed, then Upgrade: add the `if` line to `.claude/settings.json`, and optionally drop the `gate-reviewer` route), VERSION. | `CHANGELOG.md`, `VERSION` | update |
| 9 | Verification (below), recorded under the spec's criteria. | `SPEC.md` | all |

## Verification (task 9)

- `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs`: all
  pass. Record the count and the line counts against the baseline.
- `git grep -n -e expandWrappers -e "flatten(" -e "once committed" -e "stricter of the two"`:
  nothing outside SPEC.md, CHANGELOG.md and plans.
- **Update:** a scratch repo installed at v2.5.0 with the `gate-reviewer`
  route committed updates to `v2.6.0+<sha>` (`--to <branch sha>`).
  - Its config is untouched.
  - With the hook armed, a commit to `.ssdd/config.json` is blocked until
    `gate-reviewer` is stamped.
  - A commit that deletes the route goes through with no `gate-reviewer`
    stamp.
- **Live `if` probe** (the Clarify 9 harness). The installed template's
  hooks, in a scratch repo, run headless with `claude -p`:
  - The review gate runs for `git commit`, `git -C <worktree> commit`,
    `cd x && git commit`, `VAR=x git commit` and `git -c k=v commit`, and
    not for `npm test` or `ls`.
  - git-guard runs for all of them.
  - Probe hooks that block commands go in a scratch repo only, never in this
    session's settings.
- **CI:** push the branch and open a PR with the owner's go-ahead. CI runs
  green on Node 18 and 24.
