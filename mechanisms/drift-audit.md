# Docs-drift audit — full-repo runbook

The project's docs are canonical, code-coupled maps (the Documentation Map in
the instructions file). Per-diff coupling is `docs-sync-reviewer`'s job; this
runbook is the **periodic full-repo sweep** that finds where the maps drifted
anyway, then fixes the doc side only. Run it on demand ("audit the docs") or
after a burst of merged work.

Ground rules: **file evidence only** — no live-network/DB verdicts; where a
claim depends on live state, mark it `🔍 needs live check` instead of calling
it drift. Anything you write (counts included) comes from command output run
in this session.

## Phase 1 — Fan out (parallel, read-only)

Dispatch one read-only searcher per doc↔code domain, concurrently (subagents
if the harness has them; sequential passes otherwise). Derive the domain list
from the project's Documentation Map — typical domains:

1. **Each architecture map** vs. its source tree — row inventory both
   directions (doc rows without code, code without rows), dead file paths,
   duplicate rows, plus spot-verifying ~10 composition/wiring claims against
   actual imports.
2. **Version ledger** vs. the manifest(s) — both directions, including CI
   action pins and runtime version files.
3. **Secret/key inventory** vs. a grep of the env-access patterns the stack
   uses — plus `.env.example` parity.
4. **Design/token docs** vs. the token sources — every documented value
   matches code, both directions; consumer claims spot-checked.
5. **Observability docs** (analytics taxonomy, error-tracking contract) vs.
   the emitting code — event helpers and call sites both directions.
6. **Rules + operator docs** — every referenced path/script/hook exists;
   locally checkable claims hold. Sanctioned "do-not-reintroduce" history
   notes aren't drift.
7. **Flow/legal maps** (if any) vs. actual routes, permission prompts, and
   third-party integrations.

Each searcher returns raw findings as
`❌|⚠️ <doc:row> — claim vs reality (file:line evidence)` plus `✅ <dimension>`
per clean dimension — no prose padding.

## Phase 2 — Synthesize & verify

Deduplicate across reports, then **re-verify every ❌ yourself** against the
named file before acting — searcher findings are leads, not verdicts.

## Phase 3 — Fix & deliver

- Zero confirmed findings → report "no drift" and stop. No branch, no PR,
  no noise.
- Findings exist → present the consolidated table (❌ confirmed / ⚠️ stale-ish
  / 🔍 needs-live-check, with file:line evidence). Fix only documentation and
  rules files — never app code, manifests, or workflows. Branch from a clean
  default branch (`chore/docs-drift-audit-<YYYYMMDD>`) unless mid-task, stage
  files individually, commit with a finding→fix list, open a docs-only PR
  (passes the review gate ungated). Do not merge without the user's say-so.
