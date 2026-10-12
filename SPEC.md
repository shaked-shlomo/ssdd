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

---

# v2.4 — `/skills-audit`: best-practice skills catalog and automation recommender

**Date:** 2026-10-06 · **Status:** shipped (v2.4) · **Branch:** `v2.4-skills-audit`

## Goal

When SSDD is injected into a repo, help it pick its stack's best-practice
skills without installing them blindly, and point at Claude Code's automation
recommender. The method is the one two audits used by hand: the Hatedate RN
skills audit (2026-09-08, artifact `Mp8hy1ouga8i3m3tjoiCJB`) and prizma's
(commit `457cc0f`, AGENTS.md "Skills: which one, when"). Their finding: no
source installs wholesale, because every one ships rules a hook or reviewer
would block.

## Clarify pass

Owner rulings, 2026-10-06:

1. **Name:** `/skills-audit`. It names the method, and pairs with
   `docs-drift-audit`.
2. **First catalog:** RN/Expo and Next.js/React only, where audit evidence
   exists. Supabase and stack-agnostic sources wait for their own audit.
3. **Recommender:** not enabled by `install`. Every plugin's descriptions
   cost context in every session. The skill runs
   `claude-automation-recommender` when `claude-code-setup` is enabled, and
   otherwise prints the line that enables it.
4. **Ledger:** `.ssdd/skills.json`, project-owned. It isn't npx's
   `skills-lock.json`, whose hash covers the upstream folder and which
   can't hold plugins or rejections. It isn't a markdown table, which status
   can't parse, and it isn't the SSDD lock, which `update` rewrites.
5. **Drift:** `ssdd.mjs status --skills` is opt-in, so plain `status` stays
   offline.

Design decisions:

6. **The catalog ships inside the skill**, as
   `skills/skills-audit/catalog.json`. `install` already copies `skills/` to
   `.agents/skills/`, so no installer change and no new target path is
   needed, and it updates through the normal three-way merge.
7. **The catalog holds only hazards that belong to the source.** One
   project's house rules (Hatedate's Pressable, `#666`, AppText) stay out;
   step 3 of the skill recomputes collisions for each repo. Hazards that
   belong in the catalog:
   - Two sources ship a skill named `react-native-best-practices`, on the
     same trigger words.
   - Vercel's RN skill teaches `runOnJS` and Reanimated 3.
   - `expo-dev-client` lists `eas update` as a version check, but that
     command publishes an OTA update.
   - Plugin version strings don't change across commits, so track by sha.
   - `npx skills add` writes a second copy next to a plugin's.
8. **Audited shas are recorded, never recalled.** Each is upstream HEAD on
   the audit date (`git rev-list -1 --before=2026-09-08T23:59 HEAD`), and
   its commit date matches the push date the Hatedate audit states for that
   source: Vercel `063bee9` (2026-08-28), Callstack `2766baa` (2026-08-07),
   Expo `170589a` (2026-09-08), Software Mansion `fed69f5` (2026-09-02, as
   the artifact names it). `80090cc` is the official marketplace's older
   Expo pin, recorded as a hazard.
9. **Script plus skill, the `new-reviewer` shape.** `skills-audit.mjs`
   (read-only, zero deps) does the deterministic parts. The model does
   rating and verdicts.
10. **The recommender step is Claude Code only.** Cursor reads
    `.agents/skills/` too, so the step is gated on the harness. Whether the
    plugin is present is read from `enabledPlugins` in
    `~/.claude/settings.json`, `.claude/settings.json` and
    `.claude/settings.local.json` (later wins), resolved through
    `~/.claude/plugins/installed_plugins.json`. The recommender's skill name is confirmed in
    the live run, not assumed.

## Design

### Catalog — `skills/skills-audit/catalog.json`

```json
{ "version": 1,
  "sources": [{
    "repo": "software-mansion-labs/skills",
    "distribution": { "plugins": ["skills@swmansion"] },
    "signals": { "deps": ["react-native-reanimated", "react-native-gesture-handler"] },
    "skills": [{ "name": "react-native-best-practices", "covers": "animations, gestures, svg" }],
    "hazards": [{ "text": "Version string stuck at 0.1.0 across commits; track by sha" }],
    "audited": { "sha": "fed69f566b78d3289b6f00e4bccc1d4a696ffde3", "date": "2026-09-08", "by": "Hatedate RN audit" } }] }
```

- **Signals:** a source becomes a candidate when any signal matches. A
  signal is a `package.json` dependency (`deps`) or a file (`files`: regexes over
  the root's entries, such as `^next\.config\.`; Expo matches by
  `deps: ["expo"]`).
- **Sources:**
  - `vercel-labs/agent-skills` (React/Next.js and RN)
  - `callstackincubator/agent-skills`
  - `expo/skills`
  - `software-mansion-labs/skills`
- **`distribution`:** `{ "plugins": ["<name>@<marketplace>", …] }`
  (Callstack and Expo ship several) or `{ "vendored": true }`. A skill may
  carry its own `signals`, overriding its source's. A hazard may name a
  skill, in which case it's shown only when that skill matches.

### Ledger — `.ssdd/skills.json`

Seeded empty from `mechanisms/skills.example.json`. It's project-owned, so
`update` never touches it.

```json
{ "version": 1,
  "sources": { "software-mansion-labs/skills": {
    "distribution": "plugin", "install": "skills@swmansion",
    "sha": "<full sha>", "date": "2026-10-06",
    "skills": {
      "react-native-best-practices": { "verdict": "adopt", "reason": "…" },
      "pulsar-haptics": { "verdict": "skip", "reason": "uses expo-haptics" } } } } }
```

- **Verdicts:**
  - `adopt`
  - `cherry-pick` (with `landed`: the rule file it was ported into)
  - `refresh`
  - `do-not-install`
  - `skip`
- **Rejections are kept**, with the reason. The ledger replaces a
  hand-written "not vendored on purpose" list.

### `skills-audit.mjs` (read-only)

- **Default mode** prints:
  - the stack signals it found
  - the candidate sources with their skills and catalog hazards
  - per candidate: the ledger sha, the catalog's audited sha, and upstream
    HEAD via `git ls-remote` (`--offline` skips it)
  - name collisions between candidates and skills already present:
    `.agents/skills/`, `.claude/skills/`, and the skill folders of plugins
    in `enabledPlugins`, located through
    `~/.claude/plugins/installed_plugins.json`
- **`collisions <dir>`** takes a source checked out in a temp dir:
  - It applies each `lint` pattern in `.ssdd/config.json` to the source's
    code samples. A hit reads "this example would fail lint rule X".
  - It lists the house-rule files for the model to read: `AGENTS.md`,
    `.claude/rules/` and `.ssdd/reviewers/`.

### `/skills-audit` steps

The skill points to SDD.md instead of restating it.

1. Run the script.
2. Clone each candidate with `--filter=blob:none` (the refresh diff needs
   history) and check out its HEAD sha into a temp dir outside the repo,
   then read it.
3. Run `collisions <dir>`. Read the house-rule files for collisions no lint
   pattern catches.
4. Rate each skill on the audit's criteria:
   - the author's proximity to the stack
   - API currency against the repo's installed versions
   - a validation harness
   - the collision count

   Stars are not used. Propose a table with a verdict per skill, then stop.
5. On approval:
   - Write the ledger rows by full sha.
   - Port cherry-picks into rule files, each with a source line.
   - For plugins, print the `/plugin install` / `/plugin update` commands
     for the user to run.
   - For vendored skills, warn against a second copy next to a plugin's.

   Nothing is installed without approval.
6. Claude Code only: run `claude-automation-recommender` if `claude-code-setup`
   is enabled; otherwise print the line that enables it.

### `ssdd.mjs status --skills`

- Runs `git ls-remote -- <repo> HEAD` for each ledger source. `owner/repo`
  expands to `https://github.com/owner/repo`; a URL or a path is used as
  is.
- Prints one of these per source: `current`, `moved <old>→<new>`,
  `unreachable`, or `never pinned` (null sha).
- The section never changes the exit code. Plain `status` is unchanged.

### Links

- `performance-reviewer.md` and `new-reviewer` reference the ledger next to
  `.agents/skills/`.
- README: the Skills row, and `status --skills` in the commands block.

## Scope

**In:**
- `skills/skills-audit/`: `SKILL.md`, `skills-audit.mjs`, `catalog.json`.
- `mechanisms/skills.example.json`, seeded by `install`.
- `status --skills`.
- The reviewer and `new-reviewer` links.
- README, CHANGELOG, VERSION.
- Tests in `*.selftest.mjs`.

**Out:**
- Supabase and stack-agnostic catalog sources.
- Enabling `claude-code-setup` in the settings template.
- The gate-evasion weaknesses (README → Known limitations).
- A CI workflow.
- Upgrading injected projects; each one runs `update` itself.

## Acceptance criteria

- [x] **Catalog:**
  - It parses.
  - Every entry has `repo`, `distribution`, `signals`, `skills` and
    `audited`.
  - Every non-null `audited.sha` resolves in its repo.
- [x] **Stack detection:**
  - An RN/Expo fixture gets the Software Mansion, Callstack, Expo and
    Vercel candidates.
  - A Next.js fixture gets Vercel.
  - A repo with no signals gets none.
- [x] **Name collision:** the Callstack / Software Mansion
      `react-native-best-practices` pair is reported.
- [x] **`collisions <dir>`:** a fixture skill with `runOnJS` and a `lint`
      rule for it produce a hit.
- [x] **`status --skills`:**
  - A local bare repo shows `current`, then `moved` after a commit.
  - An unreachable source shows `unreachable` and exits 0.
  - A null sha shows `never pinned`.
- [x] **Install and update:**
  - `install` seeds `.ssdd/skills.json` and copies the skill folder.
  - An installed v2.3.2 repo updates cleanly.
  - An existing ledger is untouched by `update`.
- [x] **Frontmatter:**
  - It parses with js-yaml.
  - The description is at most 300 chars, with no `": "` inside it.
- [x] **Existing tests:** all still pass.
- [x] **Live run 1:** `env -u CLAUDECODE claude -p "/skills-audit" --model claude-sonnet-5-5 --allowedTools <tools>`
      runs `/skills-audit` in a scratch Expo repo with v2.4 installed. It
      proposes and writes nothing. The prompt goes before `--allowedTools`,
      whose variadic value would swallow a trailing prompt.
- [x] **Live run 2:** given an approval, it writes only `.ssdd/skills.json`.
- [x] **Recommender:** live run 1 confirms the recommender's skill name.

*Verified 2026-10-06, on `092d47d` (the code to be tagged) unless marked:*
- `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs` → 428 pass, 0 fail (Node 24.15.0).
- The catalog's four `audited.sha` values resolve in their repos (`git cat-file -e`), and all 25 catalog skill names match a SKILL.md `name:` at those shas.
- An installed v2.3.2 repo updates cleanly to `v2.4.0+092d47d`: skills-audit added, `.ssdd/skills.json` seeded, no conflicts.
- Both live runs used a fresh scratch Expo repo with `v2.4.0+092d47d` installed, `claude -p "<prompt>" --model claude-sonnet-5-5 --allowedTools …` (Claude Code 2.1.263, which warned that `claude-sonnet-5-5` isn't in its model catalog and ran it anyway). The `/skills-audit` slash form triggered the skill.
- Live run 1: all four sources as candidates (Software Mansion moved `fed69f5→e3f00cd`, Callstack `2766baa→61e6e7d`, Expo `170589a→d4f4840`, Vercel current at `063bee9`) and the `react-native-best-practices` clash. It cloned each into a `mktemp -d` dir outside the repo, checked out the full upstream sha and echoed `rev-parse HEAD`; the eight-row verdict table has a "Source @ sha read" column with those shas in 7-char form. Verdicts: Software Mansion `react-native-best-practices` adopt; Callstack `react-native-best-practices`, `upgrading-react-native` and Vercel do-not-install; the rest skip. Recommender: ran as `claude-code-setup:claude-automation-recommender` before the closing question, and its result (the context7 MCP server; no hooks, subagents or skills) is a section of the proposal. It ended by asking which verdicts to apply. Working tree clean; no installs; no upstream code run.
- Live run 2 (approval, Edit and Write allowed): `git status` showed only ` M .ssdd/skills.json`. It cloned both approved sources, checked out the upstream shas run 1 read, and recorded `git rev-parse HEAD` from those checkouts: `software-mansion-labs/skills` @ `e3f00cdb34942cee8b788abe10fe0d78a7f2b4e9` plugin `skills@swmansion`, `react-native-best-practices` adopt; `callstackincubator/agent-skills` @ `61e6e7dfdf3a8ee862254c200d751fcb1fb863dc` `react-native-best-practices` do-not-install (name clash); both dated 2026-10-06. It didn't re-read the skill contents, and said so. `status --skills` then printed `current` for both. It made no Skill call: step 6 belongs to the proposing pass.
- From the `786a644` runs: with the prompt after `--allowedTools`, which is variadic, `claude` took the prompt as a tool name and exited 1 ("Input must be provided"); hence the prompt-first form above.
- Frontmatter checked with js-yaml 4.3.0: `name: skills-audit`, description 294 chars, no `": "`.

---

# v2.5 — close the remaining gate weaknesses

**Date:** 2026-10-09 · **Status:** implemented (v2.5.0), not yet tagged · **Branch:** `v2.5-gate-hardening`

## Goal

Close the four gate weaknesses README → Known limitations still lists as open
(1–4 there), and run SSDD's own tests in CI. After v2.5 the gate fails closed
on a broken config, reviews its own files, can't be loosened by the commit it
judges, and says when its pre-commit layer is dormant.

## Clarify pass

Owner rulings, 2026-10-09:

1. **Gate files get a new lens, `gate-reviewer`**, not `security-reviewer`,
   whose checklist is app security.
2. **Existing projects learn about the route from `status`.** The config is
   seeded, so `update` never adds the route to prizma or Hatedate.
   `ssdd.mjs status` lists gate files that route to no reviewer, and the
   CHANGELOG gives the route to paste.
3. **git-guard reads the same union as the gate.** Otherwise an unstaged edit
   to `stamping: "manual"` re-enables `--stamp` in hooks mode, and an
   unstaged `blockNoVerify: false` lets `commit -n` through.
4. **CI is verified by a real run:** push the branch and open a PR.

Design decisions:

5. **Which config is "the config".** The gate judges the commit, so it
   reads the config the commit leaves behind (the index blob,
   `git show :.ssdd/config.json`) and the one it starts from
   (`git show HEAD:.ssdd/config.json`). It applies both: the strictest.
   The working-tree file is read only when neither exists (the setup
   commit), which loosens nothing because there's no committed table yet.
   `GIT_INDEX_FILE` (set by git for `commit -a` / pathspec commits) is
   inherited, so the pre-commit layer reads the index being committed.
6. **Absent vs broken.** Absent everywhere means "not an SSDD repo": exit 0,
   as today. A broken index config (or working-tree config, in the
   fallback) blocks with the parse error: `--pre-commit` exits 1, the
   harness hook denies (2), `--stamp` exits 1, completion stamps are
   skipped with a stderr line. A broken *HEAD* config with a valid index
   config is a warning, so the commit that fixes it can land.
   `convention-lint` makes the same split on its own (working-tree) config:
   exit 1 in `--staged` / file mode, 2 as a PostToolUse hook, so an agent
   that just wrote bad JSON hears it at once. git-guard already fails
   closed: an unparseable config contributes nothing, so its defaults
   stay on.
7. **The union, field by field** (one shared loader,
   `mechanisms/hooks/ssdd-config.mjs`, returns the existing config shape so
   `routes()`, `judge()`, `--stamp` and the subagent hooks don't change):
   - `routing`: both lists. Each config's `reviewGate.exclude` is baked into
     its own routes, so one config's exclude never widens the other's
     routes. Routes naming the same reviewer merge (a file matching either
     routes to it).
   - `reviewGate.stamping`: `hooks` if either says so.
   - `reviewGate.reviewerModels`: when both set one, a model must satisfy
     both lists.
   - `reviewGate.maxRoutedFiles`: the index's (it only warns).
   - `gitGuard.block*`: off only when every present config turns it off.
     `extraRules`: both lists.
   - `lint` stays per config file; convention-lint keeps reading the
     working tree (it's advisory, and the review gate stands behind it).
8. **Gate files** (route in `config.example.json`, to `gate-reviewer`):
   `.ssdd/config.json`, `.ssdd/hooks/`, `.ssdd/reviewers/`,
   `.ssdd/process/`, `.githooks/`, `.claude/settings.json`,
   `.claude/agents/`, `.claude/rules/`, `.cursor/hooks.json`, `.cursor/rules/`, `AGENTS.md`,
   `CLAUDE.md`. A reviewer checklist or the process doc weakens review as
   much as a route does. The route carries a `$comment` saying a project
   may drop paths it doesn't want reviewed.
9. **`gate-reviewer`** checks whether the diff loosens the gate: a route
   removed or narrowed, an exclude widened, a hook unwired or its matcher
   narrowed, `failClosed` dropped, a guard toggle off, `stamping` back to
   manual, a hook script that now fails open, a reviewer check deleted or a
   verdict line changed, instruction text that permits a bypass. A
   loosening isn't wrong by itself; it's an issue unless the diff or plan
   cites the owner's go-ahead. Verdict `CLEAN` / `N ISSUE(S)`.
10. **Dormant hook.** git-guard denies every write to `core.hooksPath`,
    including the fix, so messages tell the *user* to run
    `git config core.hooksPath .githooks`. When `.githooks/pre-commit`
    exists and `core.hooksPath` doesn't resolve to the repo's `.githooks`:
    - the harness gate adds a note to its block message, and to its allow
      result as `additionalContext`;
    - `ssdd.mjs status` prints a warning (exit code unchanged);
    - `install`'s next steps suggest a `"prepare"` script when the target
      has a `package.json` (never written by SSDD).
11. **CI:** `.github/workflows/test.yml` runs
    `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs` on
    pushes to `main` and on PRs, Node 18 and 24, ubuntu-latest.

## Scope

**In:**
- `ssdd-config.mjs` (shared loader) used by `review-gate.mjs` and
  `git-guard.mjs`; the absent/broken split in `convention-lint.mjs`.
- `reviewers/gate-reviewer.md` and its route in `config.example.json`.
- The dormant-hook note (gate), `status` warnings (unrouted gate files,
  dormant hook), the `prepare` next step.
- The CI workflow.
- README (Known limitations rewritten, reviewer list), CHANGELOG, VERSION,
  BACKLOG.
- Tests in `*.selftest.mjs`.

**Out:**
- convention-lint reading the union (advisory; noted above).
- Allowing `git config core.hooksPath .githooks` through git-guard.
- Writing `package.json` in a target repo.
- Upgrading injected projects; each one runs `update` and adds the route.

## Acceptance criteria

- [x] **Broken config:** invalid JSON in the staged config blocks
      `--pre-commit` (1) and the harness hook (2) with the parse error;
      `--stamp` exits 1; no config anywhere still exits 0.
- [x] **Broken HEAD config** with a valid staged one: allowed, with a
      warning.
- [x] **convention-lint:** invalid JSON exits 1 with `--staged`, 2 as a
      hook; no config exits 0.
- [x] **Union (gate):**
  - HEAD routes `src/` to a reviewer; a staged config with no routes plus a
    staged `src/` file → blocked.
  - A staged deletion of the config → still blocked by HEAD's routes.
  - First commit (no HEAD): the staged config alone applies.
  - A working-tree config that differs from the staged one is ignored.
  - `--stamp` accepts a reviewer named only in HEAD's config.
  - HEAD's `reviewGate.exclude` doesn't widen the staged config's routes.
- [x] **Union (guard):** HEAD has `stamping: "hooks"`; a working-tree (and
      a staged) `"manual"` → `--stamp` still denied. HEAD
      `blockNoVerify` on, working tree off → `commit -n` denied.
- [x] **Completion stamps** honour the union: a HEAD-only reviewer's
      subagent stop stamps its files.
- [x] **Gate files:** `config.example.json` routes each gate path to
      `gate-reviewer`; `install` links `.claude/agents/gate-reviewer.md`.
- [x] **`status`:** lists unrouted gate files; warns on unset or wrong
      `core.hooksPath`; silent when routed and armed; exit code unchanged.
- [x] **Harness note:** a blocked and an allowed commit in a repo with
      `.githooks/pre-commit` and no `core.hooksPath` both carry the note;
      with it set, neither does.
- [x] **Next steps:** `install` into a target with `package.json` prints the
      `prepare` suggestion; without one, it doesn't.
- [x] **CI:** the workflow ran green on GitHub for Node 18 and 24.
- [x] **Existing tests:** all still pass.
- [x] **Update:** an installed v2.4.0 repo updates cleanly; its config is
      untouched and `status` then names the unrouted gate files.

*Verified 2026-10-09, on `85b0b82` unless marked:*
- `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs` → 466 pass, 0 fail (Node 24.15.0).
- A scratch repo with a `package.json`, installed at v2.4.0 and committed, updated to `v2.5.0+85b0b82`: `gate-reviewer` (reviewer and `.claude/agents` symlink), `ssdd-config.mjs` and its selftest added, six hook files updated, `.ssdd/config.json` untouched. `status` (exit 0) listed 9 unrouted gate groups and the dormant hook. The installed `node --test .ssdd/hooks/*.selftest.mjs` → 412 pass.
- In that repo, with `core.hooksPath .githooks` and the CHANGELOG route pasted and staged, `git commit` was blocked: `gate-reviewer — never stamped on this diff`, for `.ssdd/config.json`. After the stamp it committed, and `status` printed only its version lines.
- Deviation: convention-lint also reports a rule regex that doesn't compile (it used to skip the whole lint silently), under the same "can't be used" message.
- CI on PR #2 (`v2.5-gate-hardening`): `selftest (18)` pass, `selftest (24)` pass — https://github.com/shaked-shlomo/ssdd/actions/runs/37859053395. The suite was not run under Node 18 locally (no Node 18 here).

---

# v2.6 — simplify the gate to its threat model

**Date:** 2026-10-12 · **Status:** spec (owner rulings 2026-10-12) · **Branch:** `v2.6-simplify`

## Goal

Bring the gate back to the threat model README already states: it keeps a
cooperating agent on the process; it isn't a sandbox. Remove the hardening
that defends against an agent deliberately hiding from the gate (shell-wrapper
unwrapping, the HEAD ∪ staged config, the gate reviewing itself by default).
Keep everything that catches a sloppy or forgetful one. Write the threat model
down as a rule so the next evasion shape doesn't start another release. After
v2.6 the next SSDD work is adoption (configurable artifact paths, prizma's
lock), not hardening.

## Clarify pass

Owner rulings, 2026-10-12: items 4, 5 and 6 as proposed (the working-tree
config; cut the wrapper unwrapping; `gate-reviewer` opt-in, not deleted),
and the D13 `if` filter tested and included (item 9).

1. **Which hardening answered something that happened** (from this spec's
   history):
   - **v2.1** ported the source project's fixes for gaps it hit: staging
     chained before `git commit` in one call (its 2026-08-10 gap), and
     `git -C <worktree> commit` judged against the main checkout, a silent
     bypass in a project that uses worktrees. Real. Kept.
   - **v2.1.1** shell wrappers (`bash -c`, `eval`, a heredoc fed to a shell,
     `… | sh`): "a final check found" them. They were constructed; no agent
     was seen using one. Cut.
   - **v2.5** set out to "close the four weaknesses Known limitations still
     lists". v2.1's Out list calls them "evasion by an agent editing the
     gate's own inputs", and none cites an incident. Cut the two that cost
     friction (HEAD ∪ staged config, `gate-reviewer` routed by default). Keep
     the two that catch accidents (a broken config blocks; a dormant hook is
     named).
2. **Who runs v2.5 today.** No injected repo: prizma is on v1.0.1 with no
   lock, and Hatedate hasn't adopted (BACKLOG). Nothing downstream depends on
   the behavior being cut, so the cut needs no migration.
3. **The threat model, as a rule.** The harness hooks catch what a
   cooperating agent does by mistake or habit: bulk staging, `-n`, amend,
   force push, re-pointing `core.hooksPath`, committing content the gate
   can't see, committing to the wrong repo, a broken config. They don't try
   to catch an agent that hides a command from them; the pre-commit layer is
   the backstop for what they can't see. **A new evasion shape is out of
   scope unless an agent was seen using it in a real project**, and the spec
   that closes it records that incident.
4. **Which config applies.** The working-tree `.ssdd/config.json`, as before
   v2.5. Chosen over the staged blob alone because it's the rule people
   already expect (edit the file, it applies). convention-lint and `status`
   already read it, and the "a config edit takes effect once committed"
   caveat leaves README and the AGENTS template. Absent vs broken stays:
   absent means not an SSDD repo; broken blocks (`--pre-commit` 1, harness
   2, `--stamp` 1) and git-guard keeps its defaults on. A broken config is
   fixed in place, with no commit needed.
5. **`gate-reviewer` becomes opt-in.** The reviewer still ships and
   `install` still links it. `config.example.json` no longer routes to it,
   and `status` no longer lists unrouted gate files. The reviewer's header
   gives the route for a project that wants it. A repo that pasted the 2.5
   route keeps it (the config is project-owned), and CHANGELOG says it may
   drop it. With the working-tree loader, the commit that drops the route
   isn't reviewed by `gate-reviewer`.
6. **What stays of the command grammar** (`git-cmd.mjs`):
   - `splitCommands`, `gitInvocation` and `commandStart`. `VAR=x git …` is
     everyday usage; `sudo` / `env` cost nothing more.
   - `skeleton` / `stripHeredocs`, so a `git commit -F - <<EOF` message never
     reads as commands.
   - `cd` / `-C` repo resolution, and failing closed on `$VAR` / `$(…)` in a
     repo target. That's about judging the right repo, not about evasion.

   Removed: `flatten`, `expandWrappers`, `innerScript`, `heredocBodies`,
   `SHELLS` and `PIPE_TO_SHELL`. Callers use `splitCommands(cmd)` and
   `skeleton(cmd)`. git-guard's hooks-mode `--stamp` check reads the
   heredoc-stripped raw text, so `bash -c '… --stamp …'` is still denied as
   a side effect. It costs nothing, so its test stays.
7. **`reviewerModels` stays.** It has been opt-in and unset by default since
   v2.3.1, so projects that don't use it pay nothing. With one config,
   `reviewerModelSets` collapses back to the one list. Revisit if no project
   turns it on.
8. **Version: 2.6.0 (MINOR).** No manual step is required: the config shape
   and the stamp file are unchanged. The one optional step (drop the
   `gate-reviewer` route) goes under Upgrade.
9. **The review gate runs only on git commands in Claude Code** (D13,
   withdrawn after v2.1.1 because the gate unwrapped wrappers). The filter
   was tested live on Claude Code 2.1.295 (the desktop app), 2026-10-12. Hooks
   that only log ran on 18 command shapes, with an unfiltered hook as the
   control:

   | Shape | `Bash(git commit*)` | `Bash(git *)` |
   |---|---|---|
   | `git commit -m x` | runs | runs |
   | `cd sub && git commit`, `(cd sub && git commit)` | runs | runs |
   | `GIT_AUTHOR_NAME=x git commit` | runs | runs |
   | `git status && git commit`, `npm test; git commit` | runs | runs |
   | `git commit -F - <<'MSG' … MSG` | runs | runs |
   | **`git -C ../wt commit`**, `git -C sub commit` | **skipped** | runs |
   | `D=sub; git -C "$D" commit` | skipped | runs |
   | `git -c user.name=x commit`, `git --no-pager commit` | skipped | runs |
   | `/usr/bin/git commit`, `env X=1 git commit`, `sudo git commit` | skipped | skipped |
   | `bash -c 'git commit -m x'` | skipped | skipped |
   | `git log \| grep commit`, `git status` (not commits) | skipped | runs |
   | `echo "git commit"` (not a commit) | skipped | skipped |

   `Bash(git commit*)` is rejected: it skips `git -C <worktree> commit`,
   the real gap v2.1 closed. **`Bash(git *)` is chosen.** It catches every
   shape v2.1 answered. It skips the absolute-path, `env` and `sudo` runners
   (v2.1.1 additions, constructed like the wrappers) and `bash -c`, which
   v2.6 stops unwrapping anyway. In Claude Code those shapes now reach only
   the pre-commit backstop. `commandStart` still serves Cursor's
   `beforeShellExecution` (it has no such filter) and git-guard.
   The `if` field is best-effort by Anthropic's docs ("use the permission
   system rather than a hook to enforce"), which fits a gate that isn't a
   sandbox. It predates 2.1.214 (that release changed its file-tool
   matching), so the CLI versions SSDD targets have it.
   git-guard stays unfiltered: its hooks-mode `--stamp` check fires on
   `node … review-gate.mjs --stamp`, which isn't a git command. Only the
   review gate's PreToolUse entry gets the filter; SubagentStart / Stop
   don't take `if`.

## Scope

**In:**
- `ssdd-config.mjs`: read the working-tree config; keep the absent / broken
  split and `dormantHook`; remove `merge` and the HEAD / index reads.
- `review-gate.mjs` and `git-guard.mjs`: `splitCommands(cmd)` /
  `skeleton(cmd)` in place of the wrapper expansion; header comments
  updated.
- `git-cmd.mjs`: the wrapper functions removed (Clarify 6).
- `config.example.json`: the `gate-reviewer` route removed. The route moves
  into `reviewers/gate-reviewer.md` as the opt-in snippet.
- `adapters/claude-code/settings-hooks.json`: the review gate's
  PreToolUse(Bash) entry gets `"if": "Bash(git *)"` (Clarify 9). The
  project's `.claude/settings.json` is project-owned, so `update` prints the
  template diff and CHANGELOG gives the line.
- `bin/ssdd.mjs status`: the gate-files listing (`GATE_FILES`) removed; the
  broken-config and dormant-hook warnings stay.
- Tests:
  - Remove the wrapper cases (git-guard, shapes), the union suites ("the
    config a commit is judged by", "the guard can't be loosened by an
    uncommitted config edit", the union cases in `ssdd-config.selftest.mjs`),
    and the gate-files `status` / example-config tests.
  - Add the cases in the criteria below.
- Docs:
  - README: the threat-model rule leads Known limitations; "What remains"
    is rewritten. Remove "Keep the `gate-reviewer` route…" from Injecting
    step 1, the `gate-reviewer` bullet in Known limitations, and the "first
    commit of a config is judged by that config alone" limitation (moot with
    one config).
  - `adapters/generic/AGENTS.md`: the "once committed" paragraph is removed.
  - `docs/model-era-review.md` D13: un-withdrawn, done in v2.6 with
    `Bash(git *)`; points at Clarify 9.
  - README Known limitations: in Claude Code the harness gate doesn't see
    `/usr/bin/git`, `env` / `sudo` runners or shell wrappers; the pre-commit
    layer does.
  - CHANGELOG 2.6.0, VERSION.
  - BACKLOG: add the threat-model rule and move the adoption items to the
    top. Drop the "first commit … judged by that config alone" limitation
    and the "on its v2.5 update: paste the `gate-reviewer` route" item.

**Out:**
- v2.1's repo-target resolution and its refusal of commits the gate can't
  see. They answer real gaps.
- A broken config blocking, the dormant-hook note, per-file stamps,
  completion stamps, `stamping: "hooks"`. All kept.
- Removing `reviewerModels` (Clarify 7).
- Deleting `gate-reviewer`: it becomes opt-in, and the file stays.
- Filtering git-guard or convention-lint with `if` (Clarify 9).
- Configurable artifact paths and prizma's adoption: the next work, each
  with its own spec.

## Acceptance criteria

- [ ] **The harness hooks no longer unwrap shell wrappers; the pre-commit
      backstop still catches them:**
  - git-guard passes `bash -c 'git commit -anm x'` and `eval "git add -A"`
    through unjudged, and so does the harness gate for
    `bash -c 'git commit -am x'`.
  - With the pre-commit hook armed and a routed file staged,
    `bash -c 'git commit -m x'` run from a shell is still blocked by
    `--pre-commit`.
- [ ] **Direct shapes unchanged:** every non-wrapper git-guard and shapes
      case still passes: bulk add, `-n`, amend, `core.hooksPath`, chained
      staging, `-a/-i/-o`, pathspec, `cd` / `-C` / worktree, `$VAR` failing
      closed.
- [ ] **Quoted mentions still ignored:** a commit message mentioning
      `git add -A` or `bash -c "git commit -n"` triggers nothing, and
      `git commit -F - <<EOF … EOF` with `--no-verify` in the body is
      allowed.
- [ ] **The working-tree config applies** in both layers:
  - An unstaged route edit applies to the next commit.
  - An unstaged `stamping: "manual"` re-enables `--stamp`.
  - HEAD's routes no longer apply once the working-tree config drops them.
- [ ] **Broken / absent config:**
  - Invalid working-tree JSON blocks `--pre-commit` (1), the harness hook
    (2) and `--stamp` (1).
  - No config exits 0.
  - git-guard keeps its defaults on a broken config.
- [ ] **`gate-reviewer` is opt-in:**
  - `config.example.json` has no `gate-reviewer` route.
  - `install` still ships `reviewers/gate-reviewer.md` and its
    `.claude/agents` link.
  - `status` prints no gate-files listing and still warns on a broken
    config and a dormant hook.
- [ ] **Docs:**
  - README and the AGENTS template have no "once committed" or
    "the stricter of the two" wording.
  - README states the threat-model rule.
  - `git grep -n -e expandWrappers -e "flatten("` finds nothing outside
    SPEC.md and CHANGELOG.md.
- [ ] **Size, recorded:** line counts of `mechanisms/hooks/*.mjs` (non-test)
      and the test count, before and after.
- [ ] **`if` filter, live:** with the template's hooks installed in a scratch
      repo on the current Claude Code, the Clarify 9 probe still holds:
      the review gate runs for `git commit`, `git -C <worktree> commit`,
      `cd x && git commit`, `VAR=x git commit` and `git -c k=v commit`, and
      doesn't run for `npm test` or `ls`. git-guard runs for all of them.
      A selftest checks that the template's review-gate entry carries
      `"if": "Bash(git *)"` and git-guard's doesn't.
- [ ] **Existing tests:** the rest pass. CI runs green on Node 18 and 24.
- [ ] **Update:** a scratch repo installed at v2.5.0, with the
      `gate-reviewer` route committed, updates to v2.6.0 cleanly.
  - Its config is untouched, and the route still blocks until it's stamped.
  - A commit that deletes the route needs no `gate-reviewer` stamp.
