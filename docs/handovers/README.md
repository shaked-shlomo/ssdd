# Handovers

Written 2026-10-06. These cover SSDD work only. Each project upgrades itself
when the SSDD work is done:

```bash
node ~/Developer/ssdd/bin/ssdd.mjs update <repo>
```

A repo installed by copy before lock files existed (prizma: v1.0.1) runs
`adopt <repo> --base v1.0.1` once first.

## Next

- [HANDOVER-ssdd-v2.4-skills-catalog.md](HANDOVER-ssdd-v2.4-skills-catalog.md):
  the best-practice skills catalog and audit skill, plus the
  `claude-automation-recommender` integration. Built from the Hatedate RN
  skills audit and prizma's skills decisions.

## Backlog, found while comparing with the injected projects

1. ~~**SSDD's hook tests collide with project test runners.**~~ Fixed in
   v2.3.2: the tests are `*.selftest.mjs`.
2. **Configurable artifact paths.** SSDD hardcodes
   `.ssdd/plans|specs|ledgers`. Hatedate keeps plans in `.claude/plans`,
   referenced from 12 files, and rules in `.claude/rules` (47). It can't
   adopt SSDD fully until these paths are set in config.
3. **The remaining gate-evasion weaknesses** listed in README → Known
   limitations:
   - fail-open on an unusable config
   - framework files with no reviewer route
   - the gate reading the working-tree config
   - hooks dormant on a fresh clone until `core.hooksPath` is set
4. **A GitHub Action that runs the tests on PRs.**
5. **An "ask" decision type for guard rules,** to pause for approval rather
   than deny (Hatedate's production-write guard). It needs Cursor's `ask`
   semantics verified first.

Before starting: update the Claude Code CLI. It's 2.1.263 on this machine;
`/doctor prompt-audit` needs 2.1.283 or later, and the old CLI resolves
`sonnet` to `claude-sonnet-5`.
