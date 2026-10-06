# SSDD framework extraction — design spec

**Date:** 2026-08-09 · **Status:** shipped (v1)

## Goal

Generalize the spec-driven development workflow proven in the HateDate repo
into a standalone, personal framework that can be injected into any future
project, independent of the agent/harness/IDE driving the work.

## Scope (decided at extraction)

**In:**
- The process: brainstorm → spec → plan (numbered, clarify pass, acceptance
  criteria first) → per-task ledger → review-gated commits → verification
  against criteria with real output → same-commit doc coupling → gotcha
  promotion. Templates for spec, plan, and task ledger.
- The five generalizable reviewer lenses (docs-sync, convention-compliance,
  resilience, performance, security) as harness-neutral checklists, plus a
  template for adding project-specific domain lenses.
- The enforcement mechanisms (review-gate, git-guard, convention-lint)
  rewritten **config-driven** (routing/rules move from code into
  `.ssdd/config.json`) and **dual-mode**: a portable git-hook/CLI entry that
  works under any harness, plus a Claude Code hook entry for earlier
  interception and better error routing.
- The docs-drift-audit runbook, generalized.
- Adapters: `claude-code/` (first-class) and `generic/` (an AGENTS.md
  template). A dumb copy-based `inject.sh`.

**Out (deliberate):**
- Domain-specific skills/rules from the source project (Supabase migration
  workflow, dependency-versioning policy, Figma/design-system rules,
  realtime-RLS proofs) — they stay per-project; the framework only reserves
  their place and the coupling discipline.
- Sync tooling between this repo and injected copies (v1 is copy-and-diverge).
- Adapters for harnesses beyond Claude Code and the generic AGENTS.md.

## Key decisions

1. **Enforce at the git layer, adapt at the harness layer.** Harness hook
   protocols don't survive "no matter the agent"; `git commit` does. The
   portable enforcement point is a git `pre-commit` hook; harness hooks are
   sugar on the same core scripts.
2. **Config is the injection contract.** The HateDate hooks hardcoded routing
   regexes and lint greps; those are the *per-project* half. SSDD ships the
   mechanism; `.ssdd/config.json` carries the instance.
3. **Reviewers keep their "every check shipped as a real bug" character** but
   the war stories are rewritten as genericized, clearly-marked examples —
   the rule survives, the project-specific file names don't.
4. **The task ledger is a first-class artifact** — the per-task
   `commit / spec ✅ / quality ✅ / findings triage` record plus the final
   whole-plan review is the most distinctive part of the source workflow and
   gets its own template.
5. **Copy, don't symlink**, on injection: projects diverge, and the framework
   must travel with each repo.

## Acceptance criteria

- [x] A fresh reader can run `inject.sh` on a new repo and know, from README +
      printed output alone, the manual wiring steps left. *(inject.sh dry-run
      verified on a scratch repo; prints per-adapter steps.)*
- [x] `review-gate.mjs --pre-commit` blocks a commit touching a routed path
      with no stamp, and passes after `--stamp` — with zero npm installs.
      *(Verified in a scratch repo; see repo history.)*
- [x] The same script also functions as a Claude Code PreToolUse hook without
      modification. *(Verified with a synthetic hook payload.)*
- [x] No file in `process/` or `reviewers/` mentions HateDate-only systems as
      requirements (they may appear in marked examples). *(Grep-verified.)*
- [x] The framework documents its own known limitation (copy-based drift).

---

# v2 — back-port from the first injected project

**Date:** 2026-10-05 · **Status:** shipped (v2)

## Goal

Bring upstream what ~38 plans of real use changed in the first project that
injected v1 (`.ssdd/` diverged there on purpose — copy-and-diverge is the v1
model). Only changes that proved out in that project come back; project
routing, domain reviewers and domain skills stay there.

## Scope

**In:**
- **Review gate v2** — stamps per reviewer × per routed file × that file's
  staged blob pair (`srcMode:srcBlob→dstMode:dstBlob`), `--stamp … --files …`
  delta rounds, a block message that names what each reviewer still owes, and
  an oversize warning (`reviewGate.maxRoutedFiles`). Chosen over the v1
  whole-diff hash because v1 could not converge: any edit voided every stamp.
- **Multi-harness hook stdin** (`stdin-payload.mjs`) — Claude Code and Cursor
  payload shapes; hooks always print a JSON permission body (Cursor
  `failClosed` reads missing JSON as a block).
- **git-guard hardening** — global flags before the subcommand
  (`git -C x add -A`), bundled short flags (`-vA`), flags between `add` and
  the selector. Plus a corrected force-push rule in the example config (v1
  blocked `--force-with-lease`, the remedy its own message prescribed, and
  missed `-f` / `+refspec`).
- **Hook test suites**, ported from vitest to `node:test` to keep zero deps.
- **Process**: "findings are records; ledger rows are verified against the
  staged blob before they are written"; a Clarify-pass section in the plan
  template; Rulings + Execution in the ledger; a handover template; BUILT and
  SUPERSEDED statuses.
- **One source of truth per artifact** — `AGENTS.md` canonical and
  `CLAUDE.md` = `@AGENTS.md` + harness notes; `.agents/skills/` as the only
  skills tree; `.claude/agents/` and `.claude/skills/` as symlinks
  ("doorbells"). Chosen over copies because v1's copied agents drifted.
- **Cursor adapter** (`adapters/cursor/`).
- **Versioned releases and updates** — `VERSION`, `CHANGELOG.md` with upgrade
  notes, annotated `vX.Y.Z` tags, and `bin/ssdd.mjs` (install / update /
  adopt / status) writing `.ssdd/ssdd.lock.json`. `update` three-way merges
  each framework file against the locked version, using this repo's git
  history as the base store. Chosen over git subtree (needs one prefix; SSDD
  spans `.ssdd/`, `.agents/`, `.githooks/`, `.cursor/`), submodules (break
  "travels with the repo"), Copier (does this, but adds Python) and a plugin
  marketplace (no per-project edits, no Cursor). v1's re-inject was `cp -R`,
  which silently overwrote project edits to framework files.
- **git-guard: `commit -n` and `core.hooksPath` overrides** — found while
  comparing with the original source project; `git commit -anm` passed every
  gate.

**Out (deliberate):**
- The six gate-evasion weaknesses (README → Known limitations). The source
  project wrote ~800 lines of fixes inside an unrelated commit, found them
  incomplete round after round, and removed them; they get their own plan.
- Plugin packaging / model-era rewrites of the prose — proposed separately in
  [docs/model-era-review.md](docs/model-era-review.md), not applied here.

## Key decisions

1. **A stamp names both sides of the diff.** A re-stage that changes nothing
   keeps its stamps (by design now); an edit, deletion, mode change or new
   base voids it for that file only. Unrouted files never enter a key.
2. **Oversize is a warning, not a block** — it signals the per-task rule
   being skipped; the remedy is splitting the commit.
3. **Symlinks over copies** for harness discovery paths. Cost: Windows needs
   `git config core.symlinks true` (and Developer Mode).

## Acceptance criteria

- [x] `node --test mechanisms/hooks/*.test.mjs` passes with zero npm installs.
- [x] `inject.sh` on a scratch repo, for each adapter, yields resolving
      symlinks and a gate that blocks → `--stamp` → passes with a v2 stamp.
- [x] No file outside `SPEC.md` names the source project's plans/PRs as
      requirements (genericized examples only).
- [x] `node --test bin/*.test.mjs` covers install / update (clean, merged,
      conflict, sidecar, removal, dirty refusal, `--to`, new adapter) /
      adopt (v1 layout) / status, against a fake ssdd repo with a layout move.
- [x] A copy of the first injected project's framework files adopts
      `--base v1.0.1` and updates to v2 with project edits preserved and
      only genuine overlaps reported as conflicts.

*Verified 2026-10-05 at `ce02fe9` (the v2.0.0 content): `node --test
bin/*.test.mjs mechanisms/hooks/*.test.mjs` → 184 pass, 0 fail. Replay on a
scratch copy of the first injected project (its real repo untouched): adopt
traced 16 files to v1.0.1; update → 11 unchanged, 3 updated, 1 added, 4
conflicts (git-guard 1 hunk, review-gate 4, SDD.md 2, performance-reviewer 1
— each a line both sides rewrote: the project's plan-numbered text vs v2's
genericized text), 6 `.ssdd-new` sidecars for files the project added that v2
now ships (its own cleanup / docs-drift-audit skills, Cursor rule, vitest
suites); the git-guard `-n`/hooksPath fix merged in; project reviewers,
config and symlinks untouched.*

*Verified 2026-10-05: 135/135 tests on Node 24.15.0 (134 pass + 1 skipped
when run from an injected `.ssdd/hooks/`, where the example config is
absent); inject for `claude-code,cursor`, `cursor`, `generic`; a scratch
commit blocked → `--stamp` → `--files` delta → committed; re-inject keeps
seeded files and warns on a v1 copied agent; source-project grep clean.*

---

# v2.1 — guard hardening from the original source project

**Date:** 2026-10-05 · **Status:** shipped (v2.1) · **Branch:** `v2.1-guard`
(off `ssdd-v2`; `main` doesn't have v2 yet)

## Goal

Port the harness-hook hardening the original source project (the one SSDD
was extracted from) built after the extraction. In a scratch repo its hooks
block 10 command shapes that v2.0's let through; v2.0.0 already closed two of
them (`commit -n`, `core.hooksPath`). After this release the PreToolUse gate
judges the repo a commit really targets, and refuses the commit shapes it
can't judge.

## Clarify pass

1. **Why the PreToolUse gate can't see `git add x && git commit`.** It runs
   *before* the command, so it reads the index as it was. The same holds for
   `commit -a/-i/-o` and `commit <pathspec>`, which commit content outside the
   index. The git pre-commit layer does see the real index, but it only runs
   if `core.hooksPath` is set (and `-n` skips it). Resolved: block these
   shapes in the harness hook and tell the agent to stage and commit in
   separate calls (source project's `review-gate.mjs`, 2026-08-10 gap).
2. **Which repo does a commit target?** `cd <dir> &&`, `(cd <dir> && …)` and
   `git -C <dir>` move it. v2.0 resolves the repo from the env
   (`CLAUDE_PROJECT_DIR`, which *is* set in hook env), so
   `git -C <worktree> commit` is judged against the main checkout's index.
   That's a silent bypass in the harness layer for any project that uses
   worktrees (the first injected project does). Resolved: start from the
   payload's `cwd`, then the env, then `process.cwd()`; walk the commands,
   where `cd` moves and `-C` composes; expand `~` but never `$VAR` or `$(…)`;
   and fail closed when the result isn't an openable repo.
3. **`--pre-commit` repo.** git runs the hook at the top of the work tree
   being committed. Resolved: use `process.cwd()` and ignore the env, which
   also closes the `SSDD_PROJECT_DIR` decoy for this layer.
4. **What counts as a commit.** v2.0 matches `/\bgit\s+([^\s]+\s+)*commit\b/`,
   which `git log | grep commit` also matches. Resolved: use the shared
   grammar's git-prefix plus subcommand. This tightens what the gate looks
   at, and a test pins the change.
5. **Policy that stays different from the source project.** SSDD allows
   `--force-with-lease` (the source project blocks it because its `main`
   has no server-side protection) and allows `git config --get/--list
   core.hooksPath` reads. Both are per-project choices, not bugs.
6. **extraRules** keep running on the global-flag-collapsed probe, so
   project regexes like `\bgit\s+push\b…` still catch `git -C x push -f`.

## Scope

**In:**
- `mechanisms/hooks/git-cmd.mjs`: one shared command grammar (`skeleton`,
  `stripHeredocs`, git-prefix, flag `cluster`, `splitCommands`,
  `gitInvocation`), so git-guard and review-gate can't drift apart.
- git-guard on that grammar:
  - every rule's flag scan stops at a command separator
  - `core.hooksPath` matched case-insensitively, quoted or bare, plus the
    `GIT_CONFIG_PARAMETERS` / `GIT_CONFIG_KEY_<n>` environment forms
- review-gate hook mode:
  - blocks un-evaluable commits (cases in Clarify 1)
  - resolves the target repo and fails closed (Clarify 2)
  - `--stamp … --repo <path>`, with the block message naming `--repo` when
    the target isn't the default
  - loads config from the resolved repo
- `--pre-commit` uses git's cwd (Clarify 3).
- Route `exclude` (per route) and a global `reviewGate.exclude`, so a new
  route can't forget, say, the test-file filter.
- Reviewers given nothing to review answer `NO DIFF — scope not provided`
  instead of `CLEAN`. That stamp would otherwise attest to an empty review.
- SDD.md §4 and the AGENTS template: stage and commit in separate tool calls.

**Out (deliberate):**
- The remaining evasion weaknesses in README (fail-open on an unusable
  config, the unrouted framework files, the working-tree config, hook
  precedence on fresh clones). They're about evasion by an agent editing the
  gate's own inputs; give them their own plan.
- An "ask" guard (pause for approval on production writes). The source
  project's rules are platform-specific, and Cursor's `ask` semantics aren't
  verified.
- Mutation-proof testing as a process rule (process prose, not guard).

## Acceptance criteria

- [x] The source project's guard and gate shape cases pass as `node:test`
      cases, each as a Claude and a Cursor payload: blocked and allowed
      command shapes, un-evaluable commits, `cd`/`-C` resolution including
      subshells and newlines, fail-closed on `$VAR` / `$(…)` / missing dirs,
      and the gate message's `--repo` hint.
- [x] A real `git worktree add` with a routed file staged only in the
      worktree and nothing staged in the main checkout: the PreToolUse
      layer blocks `git -C <wt> commit` and `cd <wt> && git commit`, and
      `--stamp … --repo <wt>` unblocks it.
- [x] The v2.0 bypass repro (`commit -anm`, `-n -am`,
      `-c core.hooksPath=…`, `git config core.hooksPath …`) still denies,
      and `git add x && git commit` now denies in the harness layer.
- [x] `git log | grep commit` is no longer treated as a commit.
- [x] `exclude` and `reviewGate.exclude` remove a test-only commit from
      routing.
- [x] All suites green (`node --test bin/*.test.mjs mechanisms/hooks/*.test.mjs`);
      tag `v2.1.0`.

*Verified 2026-10-05: `node --test bin/*.test.mjs mechanisms/hooks/*.test.mjs`
→ 315 pass, 0 fail (Node 24.15.0). Against the v2.0.0 hooks the new suites
fail 64 of 89 gate cases and 8 of 163 guard cases. Bypass repro on the v2.1
hooks: `commit -anm`, `-n -am`, `-c core.hooksPath=… commit -am` → guard 2 /
gate 2; `git config core.hooksPath` → guard 2; `git add x && git commit` and
`commit -am` → gate 2 (both were 0 in v2.0's harness layer).*

**v2.1.1 (same day).** A final check found that a one-level indirection hid
a command from both hooks. `bash -c 'git commit -anm x'` and `eval "…"`
passed everything, because the hooks read the skeleton, where quoted text is
blanked. The gate also scanned only a call's first commit. Fixed by
flattening scripts handed to a shell (`-c`, `eval`, heredoc, pipe) in
execution order and checking every commit. *Verified: 362 pass, 0 fail.
Against the v2.1.0 hooks the new cases fail 15 gate and 18 guard tests.*

---

# v2.2 — text cut for Claude 5-generation models

**Date:** 2026-10-05 · **Status:** shipped (v2.2) · **Branch:** `v2.2-text`
(stacked on `v2.1-guard`)

## Goal

Apply the framework-side half of [docs/model-era-review.md](docs/model-era-review.md):
less always-loaded text and no repeated procedure, with every mechanism
unchanged. Anthropic's current guidance: keep the instructions file light
and spent on gotchas; skills built for older models are often too
prescriptive; carried-over "verify again" instructions cause
over-verification; give the reason in a line, not a story.

## Clarify pass

1. **Where the weight is** (measured on `v2.1.1`). SSDD's prose isn't
   shouty: 78 emphasis-caps words across 20 files. The weight is length and
   duplication.
   - The AGENTS template (always loaded) is 96 lines.
   - Four descriptions run over 300 chars: resilience 490, cleanup 442,
     docs-drift-audit 427, new-plan 373. Descriptions are always in context.
   - The gate procedure is spelled out in 4 prose files plus the hook's
     block message.
   - `new-plan` restates SDD.md §2.
   
   Resolved: cut length and duplication, and don't rewrite tone for its own
   sake.
2. **What stays.** Stays:
   - the reviewers' numbered checks (context the model doesn't have)
   - writer→verifier steps (verified ledger rows, drift-audit Phase 2,
     cleanup Phase 2.5); the guidance recommends fresh-context verifiers
   - acceptance criteria with pasted output (a deliverable, not a nag)
   - the handover template
   - a one-line "why" per rule
3. **Mechanism is out of scope.** No change to `mechanisms/hooks/*.mjs`, the
   block messages, pre-commit or `config.example.json`: tests pin the
   message text, and prizma's update should show only prose files.
4. **Effort per reviewer.** `effort: medium` on the mechanical lenses
   (docs-sync, convention-compliance). Security, resilience and performance
   inherit the session's level. No `model:` — model names churn, effort is
   the lever.

## Scope

**In:** shorter descriptions; the gate procedure in SDD.md §4 only (plus the
block message), with pointers elsewhere; `new-plan` points to §2 instead of
restating it; principles 1–3 merged into one evidence rule; incident stories
cut to a clause; "reviews run at the gate and the final review" line;
`/doctor prompt-audit` in §7 and a "when a new model ships" checklist;
`effort:` frontmatter; commit the proposal doc.

**Out:** mechanical stamping via `SubagentStop` (v2.3, changes the gate);
prizma's own AGENTS.md, design-sync rule and Superpowers decision (a prizma
plan).

## Acceptance criteria

- [x] AGENTS template ≤ 60 lines.
- [x] Every reviewer and skill description ≤ 300 chars.
- [x] `--stamp` appears in SDD.md and no other agent-loaded prose file.
- [x] Principles 1–3 merged into one evidence rule, in SDD.md and the
      AGENTS template.
- [x] Every reviewer's frontmatter parses (name, description, tools; effort
      where set).
- [x] Emphasis-caps count reported before/after (no target of zero).
- [x] All 362 tests pass; an installed v2.1.1 repo updates with only prose
      paths changed and no conflicts.

*Verified 2026-10-05:*
- AGENTS template 96 → 58 lines.
- Descriptions are all ≤ 300 chars (largest: resilience 289, cleanup 284),
  and every frontmatter block parses with js-yaml.
- `--stamp` appears only in SDD.md among agent-loaded prose.
- Emphasis capitals 78 → 24, the rest being template placeholders and
  defined tokens.
- `node --test bin/*.test.mjs mechanisms/hooks/*.test.mjs` → 362 pass,
  0 fail.
- No diff under `mechanisms/hooks/` or in `config.example.json`.
- An installed v2.1.1 repo updates with 12 prose files changed, 15
  unchanged, 0 hook/config paths, 0 conflicts.

---

# v2.3 — reviewer completion stamps; `/new-reviewer`

**Date:** 2026-10-05 · **Status:** shipped (v2.3) · **Branch:** `v2.3-stamping`

## Goal

Make the review gate's attestation mechanical in Claude Code: a reviewer
subagent finishing with a verdict stamps the files it was dispatched on, and
(opt-in) the agent can no longer stamp for itself. Add `/new-reviewer`, which
proposes and scaffolds project-specific review lenses.

## Clarify pass

1. **Hook payloads** (verified by a live probe on Claude Code 2.1.263 in a
   scratch project, not just the docs):
   - `SubagentStart` carries `agent_id`, `agent_type` and `cwd`.
   - `SubagentStop` carries the same three, plus `last_assistant_message`
     (the reviewer's final text), `agent_transcript_path` and
     `stop_hook_active`.
   - The Agent tool's `PostToolUse` response has `agentId` and `status` but
     no final text. Resolved: correlate start and stop by `agent_id`; no
     Agent-tool hook is needed.
2. **What a stamp attests.** Only files whose staged key at stop still
   equals the key at start: a file edited during the review stays owed.
   Stamps record `by: "hook"`, the verdict and the issue count. The stamp
   file stays version 2 (the fields are additive).
3. **Verdict.** The last line matching CLEAN / SECURE / `N ISSUE(S)` /
   `N RISK(S)` stamps. Stamping with issues matches the existing "fix or
   triage" rule: a fix changes the key and re-opens the file. When a commit
   includes files a reviewer flagged and that are unchanged since, the gate
   adds a non-blocking "triaged?" note. `NO DIFF`, or no verdict line,
   stamps nothing.
4. **Opt-in enforcement.** `reviewGate.stamping: "manual"` (the default)
   keeps `--stamp`; completion stamps still land if the hooks are wired. In
   `"hooks"` mode the git-guard denies Bash calls that run
   `review-gate.mjs --stamp` or touch `.git/ssdd-review-*`. A PreToolUse
   `Edit|Write` entry denies the Edit/Write tools on those files, and the
   block message tells the agent to dispatch reviewers instead of printing
   `--stamp`. A human in a terminal can still stamp; that's the intended
   boundary.
5. **Scope of auto-stamping.** It covers the repo at the hook's `cwd`. A
   Claude Code worktree session has its cwd in the worktree. A
   `git -C <other>` commit from elsewhere needs manual mode. Cursor has no
   subagent hooks, so Cursor repos stay manual.
6. **Concurrency.** Parallel reviewers write one dispatch file each, keyed
   by `agent_id`, and update the stamp file under a short lock.

## Scope

**In:**
- Subagent hook modes in `review-gate.mjs`.
- `reviewGate.stamping` config key.
- git-guard rules for `hooks` mode, including the Edit/Write path.
- Three new entries in the settings template.
- The gate's triage note.
- `/new-reviewer`: proposes lenses from the stack, unrouted code, and bug
  classes that recur in the ledgers. It scaffolds from the domain template
  only after approval: route, `effort`, symlink.

**Out:**
- The best-practice skills catalog and the `claude-automation-recommender`
  integration (v2.4, built from the two skills audits).
- Correlating a reviewer with a non-cwd repo.

## Acceptance criteria

- [x] node:test with synthetic `SubagentStart` / `SubagentStop` payloads in
      a scratch repo:
  - the stamp lands with verdict and `by: "hook"`
  - a mid-review edit stays owed
  - `NO DIFF` and a missing verdict stamp nothing
  - a non-reviewer agent and a stop without a start are no-ops
  - two concurrent stops both land
- [x] `hooks` mode:
  - `--stamp`, wrapped `--stamp`, a Bash write to the stamp file, and an
    Edit/Write payload on it are denied
  - manual mode still allows `--stamp`
  - the block message drops `--stamp` for "dispatch the reviewers"
- [x] The gate's allow path carries the triage note for flagged-but-unchanged
      files.
- [x] `/new-reviewer` frontmatter parses; its description is ≤ 300 chars.
- [x] All existing tests still pass. An installed v2.2.0 repo updates
      cleanly, and the settings-template diff is printed.

*Mid-flight rulings (owner, 2026-10-05):*
- Reviewers run on Sonnet or Opus, 5.5 or later. Never Haiku (it's for
  quick text edits) and never Fable.

That added `reviewGate.reviewerModels` with version floors
(`["opus>=5.5","sonnet>=5.5"]`), checked against the subagent transcript,
and full model ids in reviewer frontmatter.

*Verified 2026-10-05:*
- `node --test bin/*.test.mjs mechanisms/hooks/*.test.mjs` → 394 pass, 0
  fail (Node 24.15.0).
- Two live end-to-end runs in scratch repos with v2.3 installed: `claude -p`
  dispatched the docs-sync reviewer, then tried to commit.
  1. With `model: sonnet`, the CLI resolved the alias to `claude-sonnet-5`.
     The floor refused the stamp, and the agent saw only "never stamped".
     That's why reviewer models are now full ids and refusals are surfaced.
  2. With `model: claude-sonnet-5-5`, the reviewer's completion stamped
     `src/math.ts` (`by: hook`, verdict ISSUES 1, model
     `claude-sonnet-5-5`). The commit passed, with the triage note.
- `/new-reviewer` frontmatter parses (description 269 chars);
  `coverage.mjs` ran read-only on the first injected project.

**v2.3.1 (owner ruling, same day).** Model pinning doesn't fit a multi-model
harness: the reviewer files also serve Cursor (Grok, Composer, GPT, Claude).
Reviewer files name no model, and `reviewGate.reviewerModels` becomes an
opt-in, Claude-Code-only floor, unset by default. The Claude ecosystem
preference (Sonnet or Opus 5.5+) lives in a project's config, not in the
framework.
*Verified 2026-10-05:*
- 395 tests pass.
- An installed v2.3.0 repo updates cleanly (10 updated, no conflicts, no
  `model:` left in the framework reviewers).
- Live run with `claude -p --model claude-sonnet-5-5`, an unpinned
  docs-sync reviewer, and `reviewerModels: ["opus>=5.5","sonnet>=5.5"]`:
  the reviewer ran on the session's `claude-sonnet-5-5`; its completion
  stamped (`by: hook`, ISSUES 1); the commit passed with the triage note.

**v2.3.2 (2026-10-06).** SSDD's installed hook tests (`*.test.mjs`,
written with `node:test`) were collected by vitest's default include and
failed. That reproduced with the first injected project's vitest; its
`npm run check` would have broken on update. They're renamed
`*.selftest.mjs`, which no default runner pattern matches, and a test
guards the naming.

*Verified:*
- 396 tests pass.
- Real vitest in a scratch project collects only the project's own test
  (before: 2 "No test suite found" failures).
- An installed v2.3.1 repo updates with the 5 old files removed and the 5
  selftests added; 379 pass + 1 skipped there.
