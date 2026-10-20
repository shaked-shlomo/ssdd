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

**Date:** 2026-10-12 · **Status:** implemented (v2.6.0), not yet tagged · **Branch:** `v2.6-simplify`

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
   control. A headless `claude -p` rerun of 13 of the shapes on the CLI at
   2.1.263 gave the same result for each:

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

- [x] **The harness hooks no longer unwrap shell wrappers; the pre-commit
      backstop still catches them:**
  - git-guard passes `bash -c 'git commit -anm x'` and `eval "git add -A"`
    through unjudged, and so does the harness gate for
    `bash -c 'git commit -am x'`.
  - With the pre-commit hook armed and a routed file staged,
    `bash -c 'git commit -m x'` run from a shell is still blocked by
    `--pre-commit`.
- [x] **Direct shapes unchanged:** every non-wrapper git-guard and shapes
      case still passes: bulk add, `-n`, amend, `core.hooksPath`, chained
      staging, `-a/-i/-o`, pathspec, `cd` / `-C` / worktree, `$VAR` failing
      closed.
- [x] **Quoted mentions still ignored:** a commit message mentioning
      `git add -A` or `bash -c "git commit -n"` triggers nothing, and
      `git commit -F - <<EOF … EOF` with `--no-verify` in the body is
      allowed.
- [x] **The working-tree config applies** in both layers:
  - An unstaged route edit applies to the next commit.
  - An unstaged `stamping: "manual"` re-enables `--stamp`.
  - HEAD's routes no longer apply once the working-tree config drops them.
- [x] **Broken / absent config:**
  - Invalid working-tree JSON blocks `--pre-commit` (1), the harness hook
    (2) and `--stamp` (1).
  - No config exits 0.
  - git-guard keeps its defaults on a broken config.
- [x] **`gate-reviewer` is opt-in:**
  - `config.example.json` has no `gate-reviewer` route.
  - `install` still ships `reviewers/gate-reviewer.md` and its
    `.claude/agents` link.
  - `status` prints no gate-files listing and still warns on a broken
    config and a dormant hook.
- [x] **Docs:**
  - README and the AGENTS template have no "once committed" or
    "the stricter of the two" wording.
  - README states the threat-model rule.
  - `git grep -n -e expandWrappers -e "flatten("` finds nothing outside
    SPEC.md and CHANGELOG.md.
- [x] **Size, recorded:** line counts of `mechanisms/hooks/*.mjs` (non-test)
      and the test count, before and after.
- [x] **`if` filter, live:** with the template's hooks installed in a scratch
      repo on the current Claude Code, the Clarify 9 probe still holds:
      the review gate runs for `git commit`, `git -C <worktree> commit`,
      `cd x && git commit`, `VAR=x git commit` and `git -c k=v commit`, and
      doesn't run for `npm test` or `ls`. git-guard runs for all of them.
      A selftest checks that the template's review-gate entry carries
      `"if": "Bash(git *)"` and git-guard's doesn't.
- [x] **Existing tests:** the rest pass. CI runs green on Node 18 and 24.
- [x] **Update:** a scratch repo installed at v2.5.0, with the
      `gate-reviewer` route committed, updates to v2.6.0 cleanly.
  - Its config is untouched, and the route still blocks until it's stamped.
  - A commit that deletes the route needs no `gate-reviewer` stamp.

*Verified 2026-10-12, on `fcd873b` (the code to be tagged) unless marked:*
- `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs` -> 455 pass, 0 fail (Node 24.15.0). Named cases: the `bash -c` / `eval` cases are in the allowed lists; "the pre-commit layer is the backstop for shell hand-offs" (`bash -c 'git commit -m x'` run for real exits 1); "an unstaged route edit applies to the next commit"; "HEAD says "hooks", the unstaged file says "manual": --stamp is allowed"; "HEAD's routes stop applying once the working-tree config drops them"; "a broken config blocks every mode"; "a broken config leaves every default block on"; "no config is still a no-op"; "gate-reviewer ships and is linked by install, but config.example.json does not route it"; "names a dormant hook and lists no gate files". The template's review-gate entry carries `"if": "Bash(git *)"` and git-guard's doesn't (`bin/ssdd.selftest.mjs:507`).
- Size: `mechanisms/hooks/*.mjs` without selftests 1,169 -> 1,062 lines; selftests (`mechanisms/hooks/` + `bin/`) 2,575 -> 2,485 lines; tests 466 -> 455.
- `git grep -n -e expandWrappers -e "flatten(" -e "once committed" -e "stricter of the two"` -> hits only in CHANGELOG.md, SPEC.md and `docs/superpowers/plans/`. README, the AGENTS template and the code have none. `mechanisms/config.example.json` has 0 `gate-reviewer` matches; README line 160 states the threat-model rule.
- Update: a scratch repo installed at the v2.5.0 commit `85b0b82` (no v2.5.0 tag yet) with the shipped `gate-reviewer` route committed, updated with `update --to fcd873b` to `v2.6.0+fcd873b`: `.ssdd/config.json` sha256 unchanged, no conflict markers, `status` exit 0 with no gate-files listing. With the hook armed, a staged `.ssdd/config.json` edit was blocked (`gate-reviewer — never stamped on this diff`, exit 1) and committed after `--stamp gate-reviewer`. A commit deleting the route went through with no stamp (exit 0).
- Installed layout, on the fix wave `490b780` (scratch repo installed with `install <dir> claude-code --ref 490b780`, committed as `5d59e1b`): `node --test .ssdd/hooks/*.selftest.mjs` -> 400 pass, 0 fail, 1 skipped (401 tests). Before the fix (`411a500`) the same run gave 399 pass, 1 fail: "the pre-commit layer is the backstop for shell hand-offs" read `.ssdd/hooks/pre-commit`, which install puts at `.githooks/pre-commit`. The test now looks in both places and skips if neither exists. Source suite on `490b780`: 455 pass, 0 fail.
- Live `if` probe, Claude Code 2.1.263 (`claude -p --model sonnet --allowedTools Bash`, in a scratch repo; probe hooks log `{hook, cmd}` and a separate unfiltered hook exits 2, so nothing ran; the `if` field is as the template ships it):

  | Command | review gate | git-guard |
  |---|---|---|
  | `git commit -m x` | ran | ran |
  | `git -C ../wt commit -m x` | ran | ran |
  | `cd sub && git commit -m x` | ran | ran |
  | `GIT_AUTHOR_NAME=x git commit -m x` | ran | ran |
  | `git -c user.name=x commit -m x` | ran | ran |
  | `npm test` | skipped | ran |
  | `ls` | skipped | ran |
- CI on PR #3 (`v2.6-simplify`, `bec338e`): `selftest (18)` pass, `selftest (24)` pass — https://github.com/shaked-shlomo/ssdd/actions/runs/38240168314.

---

# v3 — SSDD knows where the work is

**Date:** 2026-10-17 · **Status:** design approved by the owner 2026-10-17;
Parts 1 and 2 SHIPPED as 3.0.0, tagged and pushed 2026-10-20 (the
after-`/compact` check is DEFERRED to the first real repo migration, see
Part 1 → Verification); Part 3 BUILT 2026-10-20 on branch
`claude/v3-cheaper-gate-cc1697`, unreleased (3.1.0) · **Branch:** `v3`

Today SSDD enforces one moment, the commit. v3 makes it know the rest:
- where each plan stands, what's verified and what's next
- which production actions need a person

It also takes back what the two injected projects showed costs more than
it saves. Sources: the read-only surveys of prizma and Hatedate (Part 1,
Clarify 1) and the owner's rulings, all on 2026-10-17. There are five
parts, each with its own plan:

| Part | What | Plan | Ships as |
|---|---|---|---|
| 1 | Work state: where the work is, at session start; the close check; tracked ledgers | `docs/superpowers/plans/2026-10-17-v3-work-state.md` | 3.0.0, with Part 2 |
| 2 | Onboarding existing repos: the plan migration, `paths` everywhere, `/skills-audit` tracking | `docs/superpowers/plans/2026-10-18-v3-onboarding.md` | 3.0.0 |
| 3 | A cheaper gate | `docs/superpowers/plans/2026-10-20-v3-cheaper-gate.md` | 3.1.0 |
| 4 | The production guard and the Supabase pack | Plan 4, not written yet | 3.2.0 |
| 5 | Trimming | Plan 5, not written yet | 3.3.0 |

Parts 1 and 2 carry acceptance criteria. Parts 3–5 record the evidence,
decisions and scope; each plan writes its criteria after its own clarify
pass. Hatedate's adoption is parked in
`docs/handovers/HANDOVER-hatedate-adoption.md`.

## Part 1 — work state

### Goal

Today SSDD enforces one moment, the commit. Everything else about a plan is
markdown nothing reads: its status, its acceptance criteria, whether each is
verified, which task is next. In both injected projects that state goes
stale, and agents learn where the work is from files outside the repo. v3
adds one script that reads plans, ledgers and git and says where the work
is, prints that at the start of every session, and checks a plan before it
closes.

### Clarify pass

Sources are the read-only survey of prizma and Hatedate (2026-10-17).
Items marked *checked* were re-read directly; *survey* items are as the
survey reported them.

1. **What goes wrong today.**
   - **Status goes stale.** prizma plan 34:3 says "IN PROGRESS (PR #63
     open)"; #63 merged 09-17 (survey). Hatedate plan 62:3 says "COMPLETE
     (… PR pending)"; PR #128 merged as `255f7f2` (*checked*). Hatedate
     plan 22:3 still says IN PROGRESS; it shipped as `68634bb` (survey).
     Status words multiply: prizma uses DONE, CLOSED, READY TO CLOSE and IN
     REVIEW, none in the template (survey).
   - **Criteria checkboxes are never ticked.** prizma plan 41:24-35 has six
     `- [ ] AC…` lines while its Verification (:53-76) closes all six
     (*checked*). Hatedate's SHIPPED plans 54, 56 and 60 tick 0/7, 0/10 and
     1/12 (survey). The Verification section is the real record.
   - **"Where am I" lives outside the repo.** prizma keeps 12 per-plan
     `*-state.md` files in Claude's auto-memory (*checked*): machine-local,
     invisible to Cursor (which co-authored 25 commits), and drifting.
     Hatedate's CLAUDE.md:26 sends each session to the newest plan and a
     290 KB REQUIREMENTS file, while the true state sits in a worktree
     (survey).
2. **Criterion IDs already exist in practice.** 27 of prizma's 42 plans
   name criteria `AC1`, `AC2`, … (*checked*, `grep -c "AC[0-9]"`). Its
   Verification entries take two forms: `- **AC1** — …` (plan 41:55) and
   `- **AC1 ✅ — …` (plan 40:122). v3 adopts these forms as they are; no
   new syntax.
3. **The ledger: SSDD owns it, Superpowers writes into it** (owner ruling,
   2026-10-17). Superpowers 7.0.0 keeps each plan's ledger at
   `.superpowers/sdd/<plan-basename>/progress.md` and writes
   `.superpowers/sdd/.gitignore` = `*` only if none exists. Its
   `sdd-workspace` script says why: "a repo may commit its own .gitignore
   here (e.g. to version progress.md ledgers)". So SSDD ships that
   `.gitignore`, tracking `progress.md` and nothing else. Tested in a
   scratch repo: `progress.md` and the `.gitignore` show as untracked;
   task briefs and the `plan-path` marker stay ignored. The ledger stays
   at Superpowers' path. Chosen over copying it into `.ssdd/ledgers/` at
   close (an in-flight ledger is lost when its worktree goes, as Hatedate
   plan 61's nearly was) and over a symlink (fragile across the tools that
   write it). SSDD's own ledger template stays, for work run without
   Superpowers.
4. **A parent ignore wins.** git doesn't descend into an excluded
   directory, so a root rule like `.superpowers/` keeps the nested
   `.gitignore` from re-including the ledger (tested: `git check-ignore -v`
   reports the root rule). The project's `.gitignore` is the project's:
   v3 names the rule and doesn't edit it. Hatedate has such a rule
   (`.gitignore:58`, *checked*). Its adoption changes its rules and
   structure, and is parked (`docs/handovers/HANDOVER-hatedate-adoption.md`).
5. **The untracked-file block would fire on the ledger.** Superpowers
   creates `progress.md` at skill start, before Task 1's commit
   (subagent-driven-development `SKILL.md:148`; `task-done` creates it if
   absent). Once it's tracked, the pre-commit "untracked files exist"
   check blocks that first commit on a file the implementer didn't write.
   v3 exempts `.superpowers/sdd/*/progress.md` from that check, and
   nothing else. The wider narrowing is Part 3.
6. **The stale-status rule.** A plan on the default branch whose Status is
   IN PROGRESS is checked like this:
   - **Working on it:** some other local branch holds a *different* copy
     of the plan file *and* has commits touching the plan or its ledger
     that aren't on the default branch.
   - **Otherwise** nothing is working on it, so its Status is likely
     stale.
   - **DRAFT isn't flagged.** Writing a draft on the default branch before
     any branch exists is normal. A draft shows its age instead ("DRAFT
     since 08-10"), dated from the plan file's last commit.
   - **The default branch** is the remote's as last fetched
     (`refs/remotes/origin/HEAD`), else local `main`, else `master`. The
     script never fetches.
     - Status is read from whichever of the local and remote default
       branches contains the other. If they've diverged, it's read from
       the local one.
     - A commit counts as on the default branch if either one contains
       it, so a branch merged on GitHub but not yet pulled still counts as
       merged.
     - prizma's `origin/HEAD` is `origin/main`. The probe below ran
       against both.
   - A merged branch (merge commit) has no commits beyond the default
     branch, so it doesn't count as working → flagged.
   - A squash-merged branch holds the same blob → flagged.
   - A deleted branch → flagged.
   - A branch still changing the plan → not flagged.
   - BUILT is a legitimate resting state (operator steps remain) → never
     flagged.
   - Known miss: a squash-merged branch whose plan file the default branch
     edits later reads as still working.
   - Known miss: a new branch that changes only code, for a plan already
     merged as IN PROGRESS, reads as nothing working on it. Most branches
     touch the plan's ledger with each task.

   **A shell probe on prizma's real branches** (read-only, 2026-10-17,
   plan file only, no ledgers) gave:
   - **Against `origin/main`, flagged:** 18, 20, 29-studio, 32, 34, 36, 38
     and 43.
     - Plan 34 ("PR #63 open", merged 09-17) is flagged.
     - 20, 32 and 43 are waiting on operator steps or live data. 43's
       branch is fully merged and its worktree is clean. SSDD's word for
       that is BUILT, so the flag asks the right question.
     - 38 is between releases.
   - **Worked on:** 17.
   - **Not flagged:** 02 is a DRAFT and shows its age. 08 ("DONE …") and
     40 ("AC6 FAILED …") fall in the unknown-status group.
   - **Against local `main`:** 38 and 40 read as worked on, because local
     `main` was behind `origin/main` by the plan 40 and 43 merges. That's
     why the base is the remote (above).
   - **Timing:** the shell loop took 1.8 s. A Node script that spawns git
     a couple of times per branch should be well under 1 s.
7. **Session start, per harness.**
   - **Claude Code:** a `SessionStart` hook; its stdout becomes context.
     No matcher, so it runs on startup, resume, clear and compact.
     Compaction matters most: Superpowers calls losing place after
     compaction "the single most expensive failure observed".
   - **Cursor:** a `sessionStart` hook exists, but forum reports say its
     `additional_context` often never reaches the agent
     ([1](https://forum.cursor.com/t/sessionstart-hook-additional-context-is-never-injected-into-agents-initial-system-context/158452),
     [2](https://forum.cursor.com/t/agent-ignores-sessionstart-hook-context-even-when-hooks-log-says-it-merged-successfully-windows-3-14-7/167274)).
     v3 wires it and also adds one line to the always-on
     `.cursor/rules/ssdd.mdc` telling the agent to run the script.
   - **Other harnesses:** the same line in `AGENTS.md`.
8. **Existing plans are migrated** (owner ruling, 2026-10-17). Injecting
   v3 formats every existing plan with IDs and updates every reference to
   them (Part 2, Clarify 15). Until a repo has migrated, the status-word check runs
   only on *staged* plan files, so old DONE / CLOSED plans block nothing.
   The session view groups unknown words into one line. A plan with no
   `AC` IDs (one written by hand later) isn't close-checked, and a staged
   one gets a note saying so.
9. **Paths.** Hatedate keeps plans in `.claude/plans`. The script reads
   `paths.plans` and `paths.ledgers` from `.ssdd/config.json`, defaulting to
   `.ssdd/plans` and `.ssdd/ledgers`. Making templates, skills and SDD.md
   follow the setting is Part 2.
10. **What it replaces.** The orientation read: "read the newest plan and
    REQUIREMENTS", or a per-plan memory file used to find the next task.
    It doesn't replace memory's operator notes or rulings.
11. **Version: 3.0.0 (MAJOR)** (owner ruling, 2026-10-17). Under SSDD's
    semver, MAJOR means injected repos need manual steps, and v3 has two:
    - run the plan migration once (Part 2)
    - paste the `SessionStart` entry into `.claude/settings.json`, which is
      project-owned, so `update` only prints the template diff

    The script also works when run by hand. 3.0.0 is tagged once Parts 1
    and 2 have both landed; Part 1 alone is not released.
12. **Linking a Superpowers ledger to its plan** (builder check). The
    ledger's first line, `# SDD ledger — plan: <path>`, names the plan file
    Superpowers was given.
    - **Linking:**
      - If that file is under `paths.plans`, the ledger belongs to that
        plan. prizma passes the SSDD plan itself (plan 35:175, survey).
      - If it names another file (this repo keeps Superpowers plans in
        `docs/superpowers/plans/`), the ledger belongs to the SSDD plan
        that file mentions by path.
      - With neither, the ledger is listed once as unlinked.
    - **Progress comes from the ledger alone:**
      - "Tasks 1–3 done" comes from the highest `Task <N>: complete` line.
      - If the last line is a fix round, it reads "Task 4 in review".
      - A total ("of 6") appears only when the named plan file has
        `### Task <N>` headings to count.
13. **SSDD ledgers do get ticked.** prizma's 27 ledgers have 130
    `- [x] Task` rows and 8 `- [ ] Task` rows. None of the 8 has a ✓ or a
    commit hash (*checked*). So "next" is the first `- [ ] Task` row. The
    template's example row, `- [ ] Task 1 — <name> ✓ (commit …)`, shows a
    finished task with an empty box; it becomes `- [x]`.
14. **Ledgers are read from disk, and committed as the plan goes**
    (builder check). Superpowers appends each `Task <N>: complete` line
    after that task's commit, so a committed copy always lags one task
    behind.
    - **Reading:** for each worktree in `git worktree list`, the script
      reads that worktree's files on disk, uncommitted edits included. A
      branch with no worktree is read from git objects.
    - **Committing:** exempting the ledger from the untracked-file block
      (Clarify 5) removes the one thing that made anyone commit it. So:
      - The pre-commit prints a one-line reminder (`git add <ledger>`)
        when a Superpowers ledger in this worktree is untracked or has
        unstaged changes.
      - The close check *blocks* BUILT or SHIPPED while the plan's ledger
        is trackable but untracked or unstaged.
      - A ledger git ignores can't be staged, so that case stays a
        warning naming the rule.

### Design

**One script:** `mechanisms/hooks/work-state.mjs`, installed as
`.ssdd/hooks/work-state.mjs` like the other hooks. Zero dependencies, runs
inside the repo without the SSDD checkout, git CLI only. No config → prints
nothing, exits 0 (not an SSDD repo).

**What it reads:**
- Plans in `paths.plans` on every local branch and on the default branch
  (Clarify 6). A branch checked out in a worktree is read from that
  worktree's files on disk, uncommitted edits included. Any other branch is
  read from git objects (Clarify 14).
- From each plan:
  - **Status:** the first `**Status:**` line, with or without a leading
    `>`. Its first word(s) must come from DRAFT, IN PROGRESS, BUILT,
    SHIPPED, SUPERSEDED, ABANDONED; anything else is "unknown".
  - **Criteria:** lines in `## Acceptance criteria` that name `AC<n>`,
    with or without a checkbox.
  - **Verification entries:** lines in `## Verification` that start
    `- **AC<n>`. An entry whose text has `DEFERRED` plus a reason counts
    as an entry, and is reported as deferred.
  - **Open questions:** the count of open questions.
- **The ledger's progress.**
  - From Superpowers' `progress.md`, linked to its plan as in Clarify 12:
    tasks done, a task in review, and the total when it can be counted.
  - Otherwise from `<paths.ledgers>/<slug>-ledger.md`: the first
    `- [ ] Task` row is next (Clarify 13).
- **Whether git tracks the ledger.** If `git check-ignore` says it's
  ignored, the script names the rule (`.gitignore:58: .superpowers/`).

**What it prints** with `--session-start`. It always exits 0, prints at
most 12 lines and 1.5 KB, and ends with `+N more: node
.ssdd/hooks/work-state.mjs` when it cuts:

```
SSDD · 3 open plans
  12 onboarding     IN PROGRESS  (worktree step-2)  Tasks 1–3 of 6 done · AC 3/9 verified
  11 billing-export IN PROGRESS on main, no branch working on it → SHIPPED, BUILT, or still going?
  07 pricing-page   DRAFT since 08-10 · 2 open questions
  ! ledger for 12 is ignored by git (.gitignore:58: .superpowers/)
  ! two plans numbered 29 (main, social-video)
```

Open means DRAFT, IN PROGRESS or BUILT. BUILT shows its deferred count.
SHIPPED, SUPERSEDED and ABANDONED aren't listed. Warnings (`!` lines) come
last; Part 2 adds two onboarding ones.

**Which Status counts.** For a plan on the default branch, the default
branch's Status decides whether it's listed. Other branches only add
"worked on" and the worktree they're in. Without this, every shipped plan
with an old unmerged branch would show up as open again. A plan that
exists only on a branch is listed with that branch's Status. The bare
command prints the same view with no cap.

**The close check** (`--staged`, run by the pre-commit hook after
convention-lint):
- For each staged plan file:
  - Its Status must start with a word from the set, or the commit is
    blocked with the allowed words.
  - If its Status is BUILT or SHIPPED and it has `AC` IDs, every ID needs
    a Verification entry. The block names each missing ID.
  - If it has no IDs, the check prints a note and passes.
- **The plan's ledger, at close.** If the ledger is trackable but
  untracked or unstaged, BUILT or SHIPPED is blocked and the block gives
  the `git add` command. If git ignores the ledger, the check warns and
  names the rule (Clarify 14).
- **On every commit,** the check prints a one-line reminder when a
  Superpowers ledger in this worktree is untracked or has unstaged
  changes.
- Same layer and threat model as the review gate.

**Wiring:**
- **Claude Code:** `adapters/claude-code/settings-hooks.json` gains a
  `SessionStart` entry: `node "$CLAUDE_PROJECT_DIR/.ssdd/hooks/work-state.mjs"
  --session-start`.
- **Cursor:**
  - `adapters/cursor/hooks.json` gains `sessionStart` (not `failClosed`),
    printing the view in the field Cursor reads.
  - `adapters/cursor/rules/ssdd.mdc` gains: "Before starting work, run
    `node .ssdd/hooks/work-state.mjs`."
- **Every harness:** the `adapters/generic/AGENTS.md` Workflow section
  gets the same line.
- **The ledger's `.gitignore`:** a managed file,
  `mechanisms/superpowers-sdd.gitignore` → `.superpowers/sdd/.gitignore`:

  ```
  # SSDD: keep each plan's Superpowers ledger in git; the rest here is scratch.
  *
  !.gitignore
  !*/
  !*/progress.md
  ```

  - `install` replaces a file whose content is exactly Superpowers'
    default `*` and leaves any other.
  - It's installed whether or not the repo uses Superpowers (it's inert
    without it).
  - `status` warns when a parent rule ignores it, like the dormant-hook
    warning.
- **`.githooks/pre-commit`:**
  - The untracked check skips `.superpowers/sdd/*/progress.md`.
  - A new step 2b runs `work-state.mjs --staged`.

**Templates and docs:**
- **`plan-template.md`:**
  - Criteria become `- **AC1** — <criterion>`, with no checkbox.
  - Verification becomes `- **AC1** — <command> → <real output>` or
    `- **AC1** — DEFERRED (operator): <what's left>`.
  - The Status line lists the six words.
- **`task-ledger-template.md`:** the finished example row becomes
  `- [x] Task 1 — …` (Clarify 13).
- **`SDD.md`:** §2 covers IDs, §6 covers entries per ID and the DEFERRED
  form, and §7 says the close check runs on the Status change. A short
  "Where the work is" note goes under Handover.
- **`skills/new-plan/SKILL.md`:** Syncing back points at the close check.
- **Release files:** a README section and an unreleased 3.0.0 CHANGELOG
  entry. VERSION and the tag wait for Part 2 (3.0.0 ships Parts 1 and 2).

### Scope

**In:** `work-state.mjs` and its selftest; `ssdd-config.mjs` reads a
`paths` section (a wrong type is a config error, like the other sections);
the pre-commit changes; the managed ledger `.gitignore` and install's
replace rule; `status`'s parent-ignore warning; the three adapters' wiring;
the template and doc changes above; BACKLOG.

**Out:**
- Reviews owed on staged files in the view. The gate's block message
  already says this at commit time.
- PR lookups through `gh`, and network calls of any kind.
- Editing Status for the user. The script reports; people fix it.
- Running or driving plans. Superpowers does that.
- Hatedate adoption, including removing its `.superpowers/` ignore
  (`docs/handovers/HANDOVER-hatedate-adoption.md`).
- Narrowing the untracked-file block beyond the ledger, and preventing
  plan-number collisions (Part 3). v3 only reports duplicates.
- The plan migration, `paths` everywhere else, and `/skills-audit`
  tracking (Part 2).
- Trimming the handover template and AGENTS.md (Part 5).

### Acceptance criteria

- **AC1 — The view.** In a scratch repo with plans on the default branch,
  on a second branch and in a linked worktree, the bare command lists each
  open plan with:
  - its branch or worktree
  - its progress
  - verified and deferred counts
  - open questions

  Progress is read as follows:
  - from an uncommitted Superpowers `progress.md` in the linked worktree,
    read from disk, when one exists
  - from that ledger whether its first line names the SSDD plan or a
    Superpowers plan that mentions the SSDD plan's path
  - otherwise from the SSDD ledger's first `- [ ] Task` row

  A ledger linked to no plan is listed once as unlinked.
- **AC2 — Stale status.** In scratch repos:
  - An IN PROGRESS plan is flagged after a merge-commit merge, after a
    squash merge, and after its branch is deleted.
  - It isn't flagged while a branch has unmerged commits changing it.
  - With a remote, a branch merged into `origin/main` but not into local
    `main` is still flagged.
  - A DRAFT shows its age and is never flagged. BUILT is never flagged.
  - SHIPPED, SUPERSEDED and ABANDONED are never listed.
- **AC3 — On real data.** Run read-only in prizma's checkout:
  - Plan 34 is flagged.
  - Every plan the Clarify 6 probe flagged against `origin/main` is
    flagged, unless the ledger rule now counts it as worked on. Any
    difference is recorded with the commit that explains it.
  - 02 shows its age.
  - Plans whose Status is outside the set (08, 40 and the rest) appear as
    one grouped line.
  - Plans that are SHIPPED on the default branch but have old unmerged
    branches aren't listed.
  - It finishes in under 1 s (`time`).
- **AC4 — Session start, Claude Code.** With the template's hooks in a
  scratch repo on the current Claude Code, a live probe shows the view in
  context on startup and after `/compact`. A selftest checks
  `--session-start` exits 0 on a broken config and a corrupt plan, prints
  ≤ 12 lines and ≤ 1.5 KB with 40 open plans, and prints nothing without a
  config.
- **AC5 — Cursor and generic wiring.** A selftest checks Cursor's
  `sessionStart` entry exists without `failClosed`. It also checks that
  `ssdd.mdc` and the AGENTS template carry the run-the-script line. Cursor
  delivering the context isn't required (Clarify 7).
- **AC6 — The close check.**
  - A staged plan set to BUILT with one `AC` lacking an entry is blocked by
    `--pre-commit`, naming the ID. A `DEFERRED` entry passes.
  - Both entry forms parse (`- **AC1** —`, `- **AC1 ✅ —`).
  - A staged plan with Status DONE is blocked with the allowed words.
  - An unstaged plan saying DONE blocks nothing.
  - A staged BUILT plan with no IDs passes with a note.
  - A staged plan set to SHIPPED is blocked while its Superpowers ledger is
    untracked or has unstaged changes, and passes once the ledger is staged.
    With the ledger ignored by a parent rule, the plan passes with a
    warning naming the rule.
- **AC7 — Tracked ledger.**
  - After `install`, a Superpowers-shaped workspace shows only
    `progress.md` and the `.gitignore` in `git status`.
  - `install` replaces a `*`-only `.gitignore` and leaves an edited one.
  - With `.superpowers/` in the root `.gitignore`, the view and `status`
    both name that rule.
  - The pre-commit untracked check ignores
    `.superpowers/sdd/<plan>/progress.md` and still blocks any other
    untracked file. A commit made while that ledger is untracked or
    unstaged prints the one-line `git add` reminder.
- **AC8 — Paths.** With `paths.plans: ".claude/plans"`, the view and the
  close check find plans there. A non-object `paths` is a config error in
  every layer, like the other sections.
- **AC9 — Duplicate numbers.** Two plans with the same `NN-` prefix on
  different branches give one warning line.
- **AC10 — Docs.**
  - The plan template has no criteria checkboxes and shows both entry
    forms. The ledger template's finished example row is `- [x]`.
  - `git grep -n "\- \[ \] <criterion>"` finds nothing outside SPEC.md and
    CHANGELOG.md.
  - SDD.md, new-plan, README and the CHANGELOG's unreleased 3.0.0 entry
    are updated.
- **AC11 — Update.** A scratch repo installed at v2.7.0 updates to the Part 1 commit
  (`update --to <sha>`) with no conflicts. Its `.claude/settings.json` is untouched, and `update`
  prints the `SessionStart` template diff.
- **AC12 — Existing tests.** The rest pass; CI is green on Node 18 and 24.

### Verification

*Verified 2026-10-17 on branch `v3`. Code at `a7a7a0e`, with Task 9's test
additions on top, then re-run after the final review's fix pass. Node 24.15.0.
Selftest counts after the fix pass: `work-state` 45, `plan-parse` 22,
`ssdd-config` 14, `bin/ssdd` 45, all passing.*

- **AC1** — `node --test mechanisms/hooks/work-state.selftest.mjs` → 37
  pass. Named cases:
  - "lists open plans across main, a branch and a worktree": the progress
    comes from an uncommitted `progress.md` read from the worktree's disk.
  - "SSDD ledger next task".
  - "a ledger linked through the Superpowers plan that names it":
    `Task 1 of 3 done · Task 2 in review`.
  - "unlinked ledger is warned once".
- **AC2** — the same run. All six cases pass:
  - "merge commit", "squash merge" and "deleted branch" are each flagged.
  - "active branch is not flagged".
  - "merged on the remote but not pulled is flagged": a bare origin, with
    the merge pushed from a second clone, so local `main` is behind
    `origin/main`.
  - "BUILT and DRAFT never flagged; closed plans not listed".
- **AC3** — read-only in prizma (`main` `441a9e6`, `origin/main`
  `2712ab0`), `time node ~/Developer/ssdd/mechanisms/hooks/work-state.mjs`
  → 0.416 s total, exit 0, "SSDD · 12 open plans". After the fix pass it's
  0.584 s with the same output: every open plan, not only IN PROGRESS, is now
  checked for a copy being worked on.
  - **Flagged:** 18, 20, 29-studio, 32, 34 ("PR #63 open") and 36, 38, 43.
    That is exactly the Clarify 6 probe set against `origin/main`.
  - **Worked on:** 17 (branch `console-deploy`).
  - **02:** "DRAFT since 2026-08-11 · 4 open questions".
  - **Statuses outside the six:** "9 plans … (DONE ×5, IN REVIEW, READY TO
    CLOSE, CLOSED, AC6 FAILED)". 08 is one of the DONEs, and 40 is the AC6
    FAILED.
  - **Shipped plans with old unmerged branches** (19, 21, 30 and others)
    aren't listed.
  - **Real findings it surfaced:**
    - two plans numbered 42, in worktrees `eval-clustering` and `pr87`
    - the two 29s on main
    - prizma's ledger for 42 ignored by `.git/info/exclude:18: .superpowers/`
- **AC4** — split in two:
  - **Live, startup:** in a scratch repo installed with
    `install … claude-code --ref a7a7a0e`, with one plan
    (`07-probe-zebra`, IN PROGRESS). I ran
    `claude -p --model sonnet --max-turns 1` (Claude Code 2.1.263), asking
    with no tools whether a line starting `SSDD ·` was in its context. It
    answered by quoting `SSDD · 1 open plan` / `07 probe-zebra  IN PROGRESS
    on main, no branch working on it → …`.
  - **Selftests:** "capped" (40 plans → ≤ 12 lines, ≤ 1536 bytes, ending
    `+N more: …`), "broken config and corrupt plan exit 0", "no config
    prints nothing", "session-start=cursor prints JSON" and "reads the
    project from CLAUDE_PROJECT_DIR": all pass.
- **AC4, after `/compact`** — DEFERRED (operator). A headless
  `claude -p --continue` with `/compact` answers "Not enough messages to
  compact". To check it: in an interactive Claude Code session in a repo
  with the template hooks, run `/compact`, then ask what the `SSDD ·` line
  says. The hook has no matcher, so Claude Code runs it for every
  `SessionStart` source. Owner ruling (2026-10-20): run this check during
  the first real repo migration at the end of v3, since no repo runs the
  newest SSDD yet.
- **AC5** — `node --test bin/ssdd.selftest.mjs` → 45 pass, including
  "the Claude Code template has a SessionStart work-state hook without a
  matcher", "the Cursor template has sessionStart without failClosed" and
  "ssdd.mdc and the AGENTS template carry the run-the-script line". Whether
  Cursor delivers the context isn't required (Clarify 7).
- **AC6** — the work-state run above, "close check (--staged)". All pass:
  - "BUILT with a missing entry is blocked" (exit 1, names `AC2`)
  - "a DEFERRED entry passes"
  - "both entry forms parse"
  - "Status DONE is blocked with the allowed words"
  - "an unstaged DONE plan blocks nothing"
  - "BUILT with no IDs passes with a note"
  - "SHIPPED with an unstaged Superpowers ledger is blocked, and passes once
    staged" (it blocks again once the ledger has an unstaged edit)
- **AC7** — all pass:
  - **Installer** (`bin/ssdd` run above):
    - "install writes .superpowers/sdd/.gitignore and replaces a \"*\"-only
      one"
    - "install leaves an edited .superpowers/sdd/.gitignore and reports the
      clash"
    - "update replaces Superpowers' default instead of a sidecar"
    - "status warns when a parent rule ignores the ledgers"
  - **work-state:**
    - "pre-commit: ledger exempt from the untracked block": the real
      `pre-commit`; an untracked ledger commits and prints the reminder,
      and an untracked `notes.txt` still blocks.
    - "reminds to stage a Superpowers ledger on every run".
    - "an ignored ledger passes with a warning naming the rule".
  - **Dogfooded:** this repo's `.superpowers/sdd/.gitignore` is SSDD's
    version (`a7a7a0e`). `git status -uall .superpowers/` showed only
    `.gitignore` and this plan's `progress.md`, and the ledger is now
    committed.
- **AC8** — all pass:
  - "paths.plans honored" (the view) and "paths.plans honored by the close
    check".
  - `ssdd-config` run above: "paths default…", "paths are read and
    normalized", "a non-object paths is a config error".
  - The view prints the config error as a `!` line, and the gate blocks on
    it as on any section of the wrong type.
- **AC9** — "duplicate numbers warned" passes. On real data (AC3): two 29s
  and two 42s.
- **AC10** — `git grep -n "\- \[ \] <criterion>"` → no matches (exit 1).
  - The plan template now shows `- **AC1** — <criterion>` and both
    Verification forms.
  - The ledger template's finished example row is `- [x] Task 1`.
  - Updated: SDD.md §2, §6 and §7 plus the "Where the work is" note,
    `skills/new-plan/SKILL.md`, README, and CHANGELOG `## [3.0.0] —
    unreleased`.
- **AC11** — a scratch repo installed at `v2.7.0` (adapters `claude-code`
  and `cursor`, committed), then `update --to a7a7a0e`:
  - exit 0, "unchanged: 27, updated (9), added (5)"
  - the added files include `.ssdd/hooks/work-state.mjs`,
    `.ssdd/hooks/plan-parse.mjs` and `.superpowers/sdd/.gitignore`
  - no conflict markers, and `.claude/settings.json` has the same sha256 as
    before
  - the printed template diff carries `"SessionStart": [` and the
    `--session-start` command

  In that installed layout, `node --test .ssdd/hooks/*.selftest.mjs` → 472
  tests: 471 pass, 1 skipped, 0 fail.

  Re-run on HEAD after the fix pass: a fresh scratch repo installed at
  `v2.7.0`, then `update --to 7d58232`.
  - exit 0, "unchanged: 27, updated (9), added (5)", no conflicts
  - `.claude/settings.json` sha256 unchanged, and the `"SessionStart": [`
    diff printed
  - installed layout: 482 tests, 481 pass, 1 skipped, 0 fail
  - Before the fix, "pre-commit: ledger exempt…" failed there: it read
    `pre-commit` next to the hooks, and install puts it in `.githooks/`.
  - It now looks in both places, as the review-gate backstop test does.
- **AC12** — `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs`
  → 550 tests, 0 fail, on Node 24.15.0, after the fix pass (541 before it).
  - The fix pass added one test per finding: merges, cwd, non-ASCII ledger,
    DRAFT in a worktree, indirect ledger, template, git-call bound, detached
    worktree, and warnings under the cap.
  - On prizma, `--session-start` keeps its three `!` lines within 12 lines
    and 1,173 bytes.
- **AC12, Node 18** — CI run 39416354787 on `722bc60` (`v3.0.0`, pushed
  2026-10-20): `selftest (18)` success, `selftest (24)` success,
  https://github.com/shaked-shlomo/ssdd/actions/runs/39416354787. It was DEFERRED until the push, since this machine has no
  Node 18.

### Deviations & discoveries

What shipped differs from Clarify 6 and the Design above in these ways.
Each was ledgered in `.superpowers/sdd/2026-10-17-v3-work-state/progress.md`.

- **The stale rule counts ledgers too.** A source works on a plan when its
  copy of the plan *or of a ledger linked to it* differs from the default
  branch's. That includes a Superpowers ledger linked indirectly, through
  the file it names. The difference must also be its own: uncommitted in a
  worktree, or commits on neither default ref. A detached worktree is
  compared with its HEAD. (Clarify 6 said the plan file only; its own
  known-miss note relied on ledger edits counting.)
- **Every open plan shows its copy being worked on, not only IN
  PROGRESS.** A DRAFT on main that a worktree is building shows that
  worktree's Status and progress. Only IN PROGRESS with nothing on it is
  flagged.
- **The close check skips a plan a merge brings in unchanged.** While
  `MERGE_HEAD` exists, a staged plan whose index blob equals a merge
  head's blob was judged where it was committed. A plan the resolution
  edits is still checked. Without this, merging `main` could be blocked by
  a legacy plan nobody touched (Clarify 8).
- **The close check judges git's cwd,** never `CLAUDE_PROJECT_DIR` or
  `SSDD_PROJECT_DIR`. That is v2.1's pre-commit rule: a hook in a linked
  worktree must read that worktree's index. The view and `--session-start`
  still read the environment first.
- **The session-start cap keeps the `!` lines.** Warnings outrank rows,
  so a broken config or a duplicate number is never cut.
- **A broken `config.json` prints the view with a `! <error>` line.**
  It doesn't go silent.
- **Batched git calls.**
  - Named files go through one `cat-file --batch`.
  - Each checkout gets one `check-ignore --stdin -z` and one
    `status -z`.
  - On a fixture with 30 ledgers, 4 branches and 3 worktrees, the view
    went from 154 git calls to at most 40, and the close check to at most
    12.
- **The pre-commit hook lists untracked files with
  `core.quotePath=false`,** so a ledger with a non-ASCII name is exempt
  too.
- **The plan template's Verification examples are inline text,** not
  list items, so a fresh plan has no entries.

## Part 2 — onboarding existing repos

### Goal

A repo that already has plans, or keeps them somewhere else, gets the v3
format and v3's behavior from its first injection, and SSDD knows which
onboarding steps are still open.

### Clarify pass

15. **The plan migration.** It runs once per repo, when v3 is injected
    into a repo that already has plans (`update` to v3, or `install` into
    a repo like Hatedate later).
    - **Why an agent does it:** matching a plan's Verification prose to
      its criteria, and finding references like "criterion 3" or "plan 39's
      fourth check", takes reading, not regex. So it's a skill,
      `/migrate-plans`, with a script for the mechanical half.
    - **Mechanical (script, `work-state.mjs --migrate`):**
      - Criteria with IDs and checkboxes (`- [ ] AC1 …`, 27 of prizma's 42
        plans) become `- **AC1** — …`. The numbers are unchanged, so
        nothing that cites them breaks.
      - Criteria with no IDs are numbered in order.
      - It prints, per plan, what it changed and what it left for the
        agent.
    - **By the agent:**
      - Cite each Verification entry's ID.
      - Normalize the Status word to the six. DONE, COMPLETE and CLOSED
        become SHIPPED or BUILT, checked against git. This is my call: an
        unknown word is a format problem too, and leaving it means a
        grouped line in every session forever.
      - Update references in ledgers, specs, handovers and other plans to
        the new IDs.
    - **Never invent evidence.** A criterion whose plan has no matching
      evidence gets `- **AC3** — NOT RECORDED (migrated <date>): the plan's
      Verification didn't close this.` That counts as an entry, so a
      closed plan passes the close check honestly. Open plans show their
      not-recorded count.
    - **Checked before it's written.** A second agent, refute-by-default,
      checks each plan's mapping against the old text, as in SDD.md §4,
      "Findings are records".
    - **Lands as one commit.** It only adds or reformats lines; nothing
      in a Verification section is deleted.
    - **Out of reach:** commit messages, and Claude memory outside the
      repo.
    - **Until it has run,** the session view shows one line: `! N plans in
      the old format: run /migrate-plans`.
16. **`/skills-audit` is an onboarding step that SSDD tracks.**
    - **What exists today:** `install` already lists it in what's left
      (`bin/ssdd.mjs:266`), and `status --skills` says "no skill sources
      recorded" (`:502`).
    - **What's missing:** nothing records that a run happened. A run that
      matched no catalog source leaves `.ssdd/skills.json` looking the same
      as one that never ran. prizma, on v1.0.1, has no `skills.json` at
      all.
    - **The fix:**
      - The skill writes `"audited": "<date>"` at the end of every run,
        even an empty one.
      - `update` and `status` print "`/skills-audit` hasn't run here" while
        it's missing.
      - The session view carries the same line until then.
    - **It isn't run automatically.** `update` is a Node script: it can't
      run an agent, and the audit needs the network and owner approval.
17. **`paths` everywhere.**
    - **The gap:** Part 1's script reads `paths.plans` and
      `paths.ledgers`, but the templates, the skills (`new-plan`, and
      `migrate-plans`), SDD.md and the AGENTS template still say
      `.ssdd/plans`.
    - **The fix:**
      - They name the setting instead: "the plans folder (`paths.plans`,
        default `.ssdd/plans`)".
      - `new-plan`'s numbering command reads the setting.
      - `paths.specs` joins, since Hatedate keeps specs in 3 folders.
    - **The test case** is Hatedate's layout (`.claude/plans`), run on a
      scratch copy only. Hatedate itself stays untouched.

### Design

- **`skills/migrate-plans/SKILL.md`** (new): the Clarify 15 procedure. It
  runs `work-state.mjs --migrate`, then the agent pass, then the verifier,
  then one commit. Its description says it runs once, so it doesn't
  trigger on everyday plan work.
- **`skills/skills-audit/SKILL.md`:** the last step writes `"audited"`;
  `mechanisms/skills.example.json`'s `$comment` names the field.
- **`bin/ssdd.mjs`:** `update` to 3.x prints the two Upgrade steps.
  `update` and `status` print the `/skills-audit` line while `audited` is
  missing.
- **The session view gains two onboarding lines**, each shown until
  that step is done: `! N plans in the old format: run /migrate-plans`
  and `! /skills-audit hasn't run here`.
- **`paths` per Clarify 17,** in `process/`, `skills/` and
  `adapters/generic/AGENTS.md`.

### Scope

**In:**
- `/migrate-plans` and `work-state.mjs --migrate`
- the `audited` record and its reminders
- `paths` everywhere, plus `paths.specs`
- the `update` Upgrade lines
- tagging 3.0.0 with VERSION and CHANGELOG

**Out:**
- Running the migration in Hatedate. That's parked; see the handover.
- Running `/skills-audit` automatically (Clarify 16).
- Rewriting commit messages or Claude memory outside the repo.

### Acceptance criteria

- **AC13 — Migration, mechanical.** On fixture plans, `--migrate`:
  - turns `- [ ] AC1 …` and `- [x] AC1 …` into `- **AC1** — …` without
    renumbering
  - numbers ID-less criteria in order
  - leaves every Verification line's text in place
  - prints the agent's to-do list per plan

  Run twice, it changes nothing the second time.
- **AC14 — Migration, on real data.** On a scratch clone of prizma at
  `origin/main` (read-only to the real repo), after `/migrate-plans`:
  - every plan has `AC` IDs and a Status from the six
  - `git diff --stat` shows no Verification line removed (only `+` lines
    and reformatted criteria)
  - every `NOT RECORDED` entry is listed in the commit message
  - a sample of 5 plans checked by hand matches the old evidence to the
    right IDs
  - the session view has no old-format or unknown-status line
- **AC15 — `/skills-audit` tracking.**
  - A repo whose `skills.json` has no `audited` gets the reminder from
    `update`, `status` and the session view.
  - After a run that matched nothing, `audited` is set and all three go
    quiet.
- **AC16 — `paths` everywhere.** With `paths.plans: ".claude/plans"` and
  `paths.specs` set:
  - `/new-plan`'s numbering command reads and writes there.
  - `git grep -n "\.ssdd/plans"` over `process/`, `skills/` and
    `adapters/` finds only the stated default.

### Verification

*Verified 2026-10-18 on branch `claude/goofy-faraday-0bc0ee` (cut from local
`main` at `71c95e4`). First at `701cad5`; every check below was re-run at
`4951153`, after the final review's fix pass. Node 24.15.0. Selftest counts
at `4951153`: `plan-migrate` 35, `plan-parse` 29, `work-state` 66,
`ssdd-config` 15, `bin/ssdd` 56, `bin/skills-audit` 27, all passing.*

- **AC13** — `node --test mechanisms/hooks/plan-migrate.selftest.mjs
  mechanisms/hooks/work-state.selftest.mjs` → 101 tests, 101 pass. Named
  cases:
  - `migratePlan`: "checkbox forms become canonical, numbers kept",
    "keeps AC8b", "a bold title that wraps keeps its ID (prizma 03, 05,
    26)", "ID-less criteria numbered in order", "mixed plan numbers after
    the highest", "sub-bullets and continuations untouched", "Verification
    is never touched", "reports ticked IDs", "idempotent", "CRLF and BOM"
  - `migrate`: "rewrites fixture plans and prints the to-do" (per-plan
    `to do:` lines), "run twice: byte-equal" (the second run prints
    `0 changed, 3 unchanged` and every plan's bytes are equal),
    "paths.plans honored", "acts on the cwd, refuses without config"
  - `lostText`: "a deleted Verification line is returned", "a not-met
    mark must survive, or become DEFERRED or NOT RECORDED", "a deleted
    verdict-only line is lost", and a reformatted criterion, entry, Status
    or split range loses nothing
  - On real data: `--migrate` over the 43 migrated prizma plans (AC14) →
    `0 changed, 43 unchanged`.
- **AC14** — a scratch clone of `~/Developer/prizma` (`git clone`, then
  `checkout -B main 2712ab0` and `update-ref refs/remotes/origin/main
  2712ab0`), branch `migrate-plans`, with this branch's scripts run by path
  (prizma is on v1.0.1). `/migrate-plans` ran as written:
  - **Step 2:** `--migrate` → `42 changed, 1 unchanged`.
  - **Step 3:** 7 agents (sonnet, about six plans each) did Status and
    entries; one References agent searched the repo's markdown for
    positional references and found none.
  - **Step 4:** 5 refute-by-default verifiers (opus) raised 26 findings in
    17 plans: pointers claiming more than their passage, open or failed
    criteria reading as verified, range lines re-headed, and plan
    29-studio, which I had left out of step 3. One agent applied them,
    and I re-read its interdiff line by line.
  - **Step 6:** one commit, `cb4df10`, `42 files changed, 740
    insertions(+), 549 deletions(-)`.

  Against the criterion:
  - **IDs and Status:** a script over every plan, using SSDD's own parser,
    → `plans without IDs: 1 · Status outside the six: 0 · old format: 0 ·
    NOT RECORDED entries: 45`. The plan without IDs is 02, a DRAFT whose
    criteria section is empty. It has no criteria to number, and none were
    invented.
  - **No Verification line removed:** `git diff --stat` can't show this
    (see Deviations). `--migrate-check HEAD~1` → `migrate-check: ok`, both
    at `701cad5` and with the stricter check at `4951153`. Every removed
    line's text survives under one of its own IDs, with only its head
    reformatted, and every not-met mark is kept or became DEFERRED.
  - **NOT RECORDED in the commit message:** it lists 45 entries in 9
    plans, the same 9 `not recorded:` lines the check printed.
  - **Hand-checked:** 01, 09, 24, 32 and 40, each new entry against the old
    passage it cites:
    - 01: every quoted passage is in the old text, once bold markers and
      line wraps are stripped. AC13 (per-instance hover) rests on "other
      bars on the page unaffected (per-instance state)".
    - 09: the shared "Unit criteria (…)" passage closes AC2–AC7. AC6's live
      run is NOT RECORDED, and AC1's production apply and AC9 are DEFERRED,
      as the old text says.
    - 24 and 32: each ID was already on its own line. 32 keeps its
      `AC2/AC3` line and its AC13–AC15 `☐` line.
    - 40: AC6's ❌ is DEFERRED (plan 43).
  - **The view:** after a fast-forward of the clone's `main` to the
    migration, `work-state.mjs` → no old-format line and no
    status-outside-the-six line, 0.132 s (0.154 s at `4951153`). It still prints `! /skills-audit
    hasn't run here` (prizma has no `skills.json`). It also flags 9 IN
    PROGRESS plans as having nothing working on them; the clone has no
    other branches. The verifiers found 7 of those merged (17, 18, 20,
    29-studio, 32, 34 and 36), while 38 and 43 have work left. See the
    Status ruling in Deviations.
  - **The real repo:** `git -C ~/Developer/prizma status --porcelain`
    stays empty at `441a9e6`.
- **AC15** — a scratch repo installed from this branch (`install … claude-code
  --ref HEAD`, at `673ee5c` and again at `4951153`, same output), committed:
  - Before: `status` → `onboarding: /skills-audit hasn't run here`; `update
    --to HEAD` prints the same line; the view → `SSDD · no open plans` /
    `! /skills-audit hasn't run here`.
  - The run: `skills-audit.mjs --offline` → `Stack signals: none in the
    catalog` / `No catalog source matches this repo.`; then `skills-audit.mjs
    record` → `recorded: audited 2026-10-18 in .ssdd/skills.json`.
  - After: `status` and `update` print no `onboarding:` line, and the view
    prints only `SSDD · no open plans`.
  - Selftests: "skillsAudited reads the date, null otherwise", "skills-audit
    reminder until audited", "status and update print the onboarding
    lines", and `record`'s three cases all pass.
- **AC16** — a scratch repo whose `.ssdd/config.json` sets `paths.plans:
  ".claude/plans"` and `paths.specs: "docs/specs"`, with `03-a` on `main`
  and `07-b` only on branch `other` (run at `39b3426` and again at
  `4951153`, same output):
  - After `install … --ref HEAD`, `.claude/plans`, `docs/specs` and
    `.ssdd/ledgers` exist, and `.ssdd/plans` doesn't.
  - `node .ssdd/hooks/work-state.mjs --next-plan` → `next plan:
    .claude/plans/08-<slug>.md`. `/new-plan`'s step 1 is that command.
  - `git grep -n "\.ssdd/plans" -- process skills adapters` → 6 lines,
    each the stated default (`paths.plans`, default `.ssdd/plans`).
  - Selftests "docs name the paths setting", "reads paths.plans and counts
    other branches" and "install creates the folders the config names"
    pass.
- **Existing tests** — `node --test mechanisms/hooks/*.selftest.mjs
  bin/*.selftest.mjs` → 629 tests, 629 pass, 0 fail at `4951153` (617
  before the fix pass). In an installed layout (`install … claude-code,cursor
  --ref HEAD` into a scratch repo), `node --test .ssdd/hooks/*.selftest.mjs`
  → 546 tests, 545 pass, 1 skipped (the source-tree-only config-example
  check), 0 fail.
- **`update` to 3.x** (Scope; no AC) — a scratch repo installed at `v2.7.0`
  (adapters `claude-code` and `cursor`) with one old-format plan, then
  `update --to HEAD` at `4e1a2e2`:
  - exit 0, "unchanged: 24", "updated (12)", "added (8)", including
    `.ssdd/hooks/plan-migrate.mjs` and `.agents/skills/migrate-plans/SKILL.md`
  - 0 conflict markers and 0 `.ssdd-new` files; `.claude/settings.json`
    has the same sha256, and the `"SessionStart": [` template diff is printed
  - output ends with `── Upgrade steps (manual), from the CHANGELOG:` /
    `v3.0.0:` and the `/migrate-plans`, `SessionStart` and `/skills-audit`
    steps, then `onboarding: 1 plan in the old format: run /migrate-plans`
    and `onboarding: /skills-audit hasn't run here`
  - in that layout, `node --test .ssdd/hooks/*.selftest.mjs` → 546 tests,
    545 pass, 1 skipped, 0 fail
- **The Hatedate copy test** (2026-10-20, at the owner's request). This ran
  on a scratch clone of `~/Developer/Hatedate` at `8563f3c`; the real repo
  is unchanged. Hatedate has never adopted SSDD, so the clone got a
  `.ssdd/config.json` with `paths.plans: ".claude/plans"`.
  - **What the plans are:** 90 files. 77 have no `## Acceptance criteria`
    section, and 63 have no `**Status:**` line. Some write `## Status: …`
    as a heading, and some write `> **STATUS (date): SHIPPED — …**`. Many
    are Superpowers implementation plans.
  - **The mechanical pass:** `--migrate` → `13 changed, 77 unchanged`, with
    103 to-dos (63 "no Status line", 19 Status outside the six).
  - **The agent pass** (2 sonnet agents) ran on 01, 22, 27, 42, 60 and 62,
    followed by one refute-by-default verifier (opus). It found 1
    refutation: 27's old status already said SHIPPED, so it keeps SHIPPED.
    After the fix, `--migrate-check HEAD~1` lists none of the six.
  - **Status:**
    - 42 → SHIPPED (it had no Status line).
    - 62 → SHIPPED (was "COMPLETE … PR pending"; #128 merged).
    - 01 → BUILT (external setup is still listed as remaining).
    - 22 keeps IN PROGRESS under the Status ruling, though `68634bb0` (#52)
      shipped it.
  - **Criteria:** 60 and 62 had AC IDs and were re-prefixed. 01, 22, 27 and
    42 have none, but each has a checklist that reads as criteria ("Verify
    Phase N", Verification lists). The skill leaves these alone, by design:
    it never writes criteria. 42 is SHIPPED with 2 of its 5 checks recorded
    nowhere.
- **Node 18** — CI run 39416354787 on `722bc60` (`v3.0.0`, pushed
  2026-10-20): `selftest (18)` success, `selftest (24)` success,
  https://github.com/shaked-shlomo/ssdd/actions/runs/39416354787.
- **Tagging 3.0.0** (Scope) — tagged `v3.0.0` on 2026-10-20 at the owner's
  go-ahead: VERSION `3.0.0`, the CHANGELOG entry dated, and its `### Upgrade`
  section names the migration and the `SessionStart` entry. Pushed with
  `main` the same day.

### Deviations & discoveries

What shipped differs from Clarify 15–17 and the Design above in these ways.
Each is in `.superpowers/sdd/2026-10-18-v3-onboarding/progress.md`.

- **`--migrate-check <ref>` was added.** AC14 asks `git diff --stat` to
  show no Verification line removed, but it can't tell a reformat from a
  deletion, and Clarify 15 lets the agent reformat a line to cite its ID.
  For each removed line, the check strips the formatting and requires the
  text in a new line under one of the same IDs. A not-met mark (❌, ☐,
  `[ ]`) must stay, or become DEFERRED or NOT RECORDED. It also re-runs the
  to-do against the base, so the verifier has a floor, and it lists the NOT
  RECORDED entries for the commit message.
- **The parser reads prizma's real forms.** These changes are in Part 1's
  parser:
  - IDs with a letter (`AC8b`, plans 20, 24 and 32), and `[~]` and `[-]`
    checkboxes (plan 20).
  - Checkboxed Verification entries (plans 08, 13, 21, 37 and 38).
  - A head naming a run of IDs (`**AC8–AC11, …`) is no ID's entry. It had
    read as the first ID's entry and shadowed the per-ID line after it
    (plan 38).
  - A NOT RECORDED entry counts as an entry, but not as verified.
- **Found on prizma and fixed test-first:**
  - A bold title that wraps lost its ID and was renumbered (03, 05, 26).
  - A kept range line stayed a to-do forever, even with one entry per ID.
    It also owed an entry for a non-criterion ID (38's `AC12b`).
- **Upgrade steps come from the CHANGELOG.** `update` prints each crossed
  version's `### Upgrade` section, so nothing about 3.x is hard-coded.
  - A `+sha` target counts sections headed `unreleased`, unless the locked
    commit already had that section word for word.
  - AC15's run found the repeat: a same-commit update reprinted them.
- **`install` prints the onboarding lines too,** for a repo that already
  has plans (Clarify 15 names install as a trigger).
- **`--next-plan`** replaces new-plan's shell pipeline. It reads
  `paths.plans` and counts every worktree's disk and every ref.
- **`paths.specs` is one string.** `/migrate-plans` searches the whole
  repo's markdown for references, so Hatedate's three spec folders don't
  need a list.
- **`skills-audit.mjs record`** writes `"audited"`, so the write is a
  command, not hand-edited JSON. The script's header now reads "read-only
  except `record`".
- **The skill's rules came from runs, not from the design alone:**
  - **Baseline, no skill:** sonnet on prizma 09, 22 and 25. It built
    entries from today's code and tests ("Passed in the run above" for
    test names the plan never records), and added research notes.
  - **The recipe:** five entry shapes, all resting on the plan's own text.
  - **Not yet run:** the final text, with the rules below, has had no
    fresh agent run end to end. Prizma's real migration will be its first.
  - **Added from the prizma run:**
    - a partial line for a passage that closes half a criterion
    - a DEFERRED head for a line that says the criterion isn't met (open,
      failed or superseded), existing entries included
    - every plan gets the pass, not only plans with a to-do
    - fan-out agents write only their own plans (one agent restored the
      whole folder from its snapshot)
    - References run once, after the fan-out
    - the view changes only once the branch merges
- **The final review's fix pass** (0 Critical, 5 Important, each fixed
  test-first):
  - An entry's checkbox, if it has one, must be ticked. `- [ ] **AC1** —
    run the suite` had counted as a record and let a BUILT plan pass the
    close check that Part 1 blocked.
  - Criteria are top-level items in the parser too. Parser and migration
    share one fence-aware scan, so a sub-bullet like "AC5's follow-up" is
    no criterion.
  - `--migrate-check` matches by ID and keeps not-met marks (above).
  - The onboarding lines come right after a config error, so the cap keeps
    them.
  - The old-format count is the default branch's plans, which is where the
    migration lands. On real prizma it reads 42, not the 44 that included
    worktree-only plans.
- **Found on the Hatedate copy and fixed:**
  - Sub-plan numbers (`14d-1`, `14d-1-1`, `14e-3.1`) had all read as `14d`
    or `14e`. That gave false duplicate warnings, and `--next-plan` listed 34
    false strays. Fixed test-first; the duplicates left are real (two 28s,
    two 14f.2s).
  - The skill now covers three cases: a status word from the six written
    another way keeps its word, with a `**Status:**` line added beside it;
    a plan with no Status says `was: (no Status line)`; and a plan with no
    criteria gets its Status only and is listed for the user.
- **Plans with no criteria** (owner ruling, 2026-10-20). In Hatedate that
  is 77 of 90.
  - An open plan (DRAFT, IN PROGRESS, BUILT) gets its own done-checklist
    copied word for word into an `## Acceptance criteria` section, and
    entries follow the usual rules.
  - A closed plan keeps its Status only.
  - The agent never writes criteria of its own.
  - **Tried on the Hatedate copy, 01 and 22:** 01's four "Verify Phase N"
    lists became AC1–AC19, and 22's Wave V gauntlet became AC1–AC5. The
    diff is 60 added lines and 0 removed.
  - **What the verifier changed:** a ✅ on a phase heading records the
    build, not the check, so 15 of 01's pointers became NOT RECORDED.
  - **The skill now says so,** and it also covers a checklist split across
    phases, a `## Verification` added to hold the entries, and DEFERRED
    resting on the plan's list of unfinished work.
  - **The view now reads** `01 backend-production  BUILT · AC 0/19
    verified · 4 deferred · 15 not recorded`, where before it showed a bare
    BUILT.
- **Status ruling.** A Status already from the six stays, even when git
  shows the plan merged. The migration formats; Part 1's view flags an IN
  PROGRESS nothing is working on, and Part 1's Scope leaves editing Status
  to people. On prizma that leaves 7 merged plans for the owner to
  re-status.

## Part 3 — a cheaper gate

### Goal

Keep every block that catches a real mistake, and stop charging for the
ones that don't. No release has fixed these yet, and both injected
projects hit them.

### Evidence

- **Merges of code already reviewed.** 4 of prizma's 8 `SSDD_REVIEW_SKIP`
  uses were merges like this (`ebbd494`, `60da710`, `5597881`, `1aa4cc6`).
- **A fix re-reviews too much.**
  - Stamps are keyed to a file's content, so a comment edit costs a full
    round on that file.
  - prizma's ledger 39:60-63 shows agents leaving stale text rather than
    void a stamp.
  - In Hatedate (whole-diff stamps), 43% of commits needed 2–4 rounds, and
    31% of its 391 reviewer runs were repeats.
- **Agents probe the gate with throwaway commits.** Hatedate has 9 of
  them, `-m "probe"`, made just to learn what's owed.
- **Chained staging blocks docs.**
  - 12 of Hatedate's 14 blocks were docs-only commits or scratch repos.
  - The 2 real catches were code (a release bump, an audit).
- **The untracked-file block costs more than it catches.**
  - prizma: it forced several tasks into one commit (plans 19 and 21).
  - Hatedate: 7 of its 10 firings were other sessions' work, and the
    workarounds stashed that work.
- **A read of `core.hooksPath` is blocked.**
  - All 6 of Hatedate's firings were reads.
  - SSDD's git-guard does the same, checked 2026-10-17:
    `git config core.hooksPath` with no value exits 2, while `--get`
    passes.
- **Plan numbers collide across parallel branches.**
  - prizma: 29 used twice, and one plan renumbered.
  - Hatedate: 28 used twice, and 61 against 62.
- **Already fine in SSDD:**
  - A repo with no `.ssdd/config.json` is a no-op (`review-gate.mjs:489`),
    so scratch repos pass. *Only half true: see Clarify 21.*
  - Stamps have been per file since v2.

### Decisions

My calls, except item 7:

1. **A clean merge owes nothing.**
   - During a merge (`MERGE_HEAD` exists), a staged file whose content
     equals git's automatic merge of the two sides was reviewed on its
     way in. Git's merge is computed with `git merge-tree --write-tree`
     (git ≥ 2.38).
   - Only files that differ owe reviews: conflict resolutions and edits
     made during the merge.
2. **Re-review the change, not the file.** When a file's stamp is for an
   older blob, the block message gives the reviewer
   `git diff <stamped blob> <staged blob>` as its input. The stamp still
   lands on the new blob. It's the same gate, with smaller reviews.
3. **`review-gate.mjs --check`** prints what the current index owes,
   without committing.
4. **Chained staging is allowed when it's visible and unrouted:** every
   path in the chained `git add` is named explicitly, and none is routed.
   Anything else is still refused.
5. **The untracked-file check becomes a warning.** A repo that wants the
   block sets `preCommit.blockUntracked: true`.
6. **git-guard treats `git config core.hooksPath` with no value as a
   read.**
7. **Plan-number collisions: keep numbers and rely on the duplicate
   report** (owner ruling, 2026-10-20). The other options were reserving a
   number by pushing an empty plan file first, and assigning numbers at
   merge. See Clarify 25.
8. **Lint only the lines a change adds** (owner ruling, 2026-10-20, added
   to Part 3's scope). See Clarify 26.

### Scope

**In:**
- review-gate: the merge rule, the delta message, `--check`, the
  chained-staging rule, and shapes judged only in an SSDD repo
- git-guard: the `core.hooksPath` read
- pre-commit: the untracked-file warning, and
  `preCommit.blockUntracked`
- convention-lint: added lines only
- SDD.md §2 and §4, README, the tests

**Out:**
- The stamp format, which stays as v2 made it.
- New evasion shapes (the threat-model rule).
- Hatedate's own gate (parked).
- The rest of Clarify 27.

### Open

Both resolved by the owner on 2026-10-20:
- Decision 7: keep numbers (Clarify 25).
- git 2.38 is acceptable; older git judges a merge as today (Clarify 18).

### Clarify pass

Sources: scratch clones of prizma (`2712ab0`) and Hatedate (`8563f3c`),
Hatedate's Claude Code transcripts (read-only, 14 project folders under
`~/.claude/projects`), and the code at `v3.0.0`. All checked 2026-10-20.

18. **Clean merges, measured.**
    - prizma's 4 SKIP'd merges are each `Merge origin/main into <branch>`.
      Replayed in a scratch clone with `git merge-tree --write-tree <c>^1
      <c>^2`, against the routing in each merge's own config:

      | Merge | Staged | Routed (owed today) | Routed and unlike git's merge |
      |---|---|---|---|
      | `ebbd494` | 320 | 37 | 0 |
      | `60da710` | 41 | 25 | 0 |
      | `5597881` | 77 | 46 | 1 (`src/app/method/page.tsx`) |
      | `1aa4cc6` | 22 | 12 | 0 |

    - **Where it applies.** A merge with no conflicts commits through
      `pre-merge-commit`, not `pre-commit` (checked in a scratch repo), and
      the harness gate only sees `git commit`. So the gate meets a merge
      only when the merge stopped, on a conflict or `--no-commit`. All four
      conflicted (`merge-tree` exits 1). The rule makes those cost what a
      clean merge costs.
    - **How.** While `MERGE_HEAD` holds one commit, the gate asks git for
      its own merge of `HEAD` and that commit. A staged path whose index
      entry (mode and blob) equals the merged tree's owes no one. A
      conflicted path holds markers in that tree, so its resolution differs
      and is owed, and so is any edit made during the merge. Both layers and
      `--check` apply it, and the oversize warning doesn't count those
      paths.
    - **Judged as today:** an octopus merge (several `MERGE_HEAD` lines), a
      git that fails `merge-tree --write-tree` (older than 2.38, or any
      error), a squash merge (no `MERGE_HEAD`), cherry-pick and revert (no
      evidence they cost).
    - **Ruling** (owner, 2026-10-20): git 2.38 is acceptable, and older git
      falls back. SSDD gets no new git floor.
19. **Delta re-review.** A stamp's key is `srcMode:srcBlob→dstMode:dstBlob`,
    so the blob a reviewer last saw is already in the stamp, and the format
    doesn't change.
    - When a reviewer's stamp on a file is for another blob, its block line
      gives `git diff <stamped blob> <staged blob>`, in both stamping modes.
    - **No delta, the whole change owed as today:** a file never stamped, a
      deletion on either side, or a stamped blob that's gone (`git cat-file
      -e` fails; git prunes an unreachable blob after `gc.pruneExpire`, two
      weeks by default).
    - A mode-only change prints the modes, as today.
    - When the base moved too (a different `srcBlob`, e.g. after a rebase),
      the line says so.
    - Reviewers already take "the named range" as input (each reviewer's
      step 1), so the reviewer files don't change. SDD.md §4 says the delta
      is the input.
20. **`--check`.** Hatedate's 9 `-m "probe"` commits asked what was owed.
    - `review-gate.mjs --check [--repo <path>]` prints what the commit would
      get: the owed list with its deltas and the oversize warning, or
      `nothing owed`.
    - Exit 0 when nothing is owed, 1 when a commit would be blocked. It
      writes nothing.
    - It judges the index of git's cwd, or `--repo`. It doesn't judge a
      command's shape or run the pre-commit's other steps.
    - git-guard's hooks-mode rule matches `--stamp` only, so `--check` runs
      in both stamping modes. The block message names it.
21. **Shapes are judged only in an SSDD repo.** The Evidence line "scratch
    repos pass" is half true. The harness gate refuses chained staging,
    `commit -a/-i/-o` and `commit <path>` before it looks for a config
    (`review-gate.mjs:385-438`, then `:488`). Checked: `git add notes.md &&
    git commit -m x` in a fresh repo with no config exits 2. So the gate
    resolves the target repo and loads its config first: no config allows.
    An unresolvable target (`$VAR`, `$(…)`, `cd -`) still fails closed,
    since the gate can't tell whether that repo uses SSDD.
22. **Which chained `git add` is visible.** Hatedate's transcripts hold 209
    Bash calls with a staging command and a commit. Classified with SSDD's
    own tokenizer and Hatedate's routing (its gate's table):
    - 99 add only files no route covers: 60 in the repo, 39 after a `cd` or
      `-C`, many of those in other repos.
    - 78 add at least one routed file.
    - 14 stage after the commit, or only mention it.
    - 13 use `-A` or `-u`, 3 a directory and 2 a glob (some overlap).

    **Visible** means:
    - The chained command is `git add`, with no option but `-f`,
      `--force`, `-v`, `--verbose` and `--`.
    - Each path has no glob character (`*?[`), no pathspec magic (a
      leading `:`), no `$` or backtick, and isn't `.` or a directory on
      disk.
    - Each path resolves inside the commit's repo. It's routed by its real
      spelling on disk (`realpath`), so `SRC/a.ts` on a case-insensitive
      disk is `src/a.ts`.
    - No path is routed.

    Chained `rm`, `mv`, `restore` and `update-index` stay refused (decision
    4 names `git add`).
    - **Why it's safe:** the added paths route to no reviewer, so the index
      the gate judges and the one the commit records owe the same reviews.
      The pre-commit layer judges the real index anyway.
23. **The untracked check becomes a warning.**
    - It moves from the shell into `work-state.mjs --staged`, which already
      lists untracked ledgers, because a shell can't read the config.
    - Without `preCommit.blockUntracked: true` it lists the files (at most
      10, then `+N more`) and passes. With it, it blocks as v3.0.0 does.
    - A Superpowers ledger stays exempt, with its own reminder.
    - `preCommit` is a config section: anything but an object is a config
      error, and the gate fails closed on it.
24. **`core.hooksPath` reads.** 4 Bash calls in Hatedate's transcripts name
    the key: one plain read (`…; git config core.hooksPath`), one read inside
    `$(…)` next to a write, one write, and one Python string about the
    guard.
    - **A read:** a `git config` naming the key with `--get*`, `--list`,
      `-l`, or the `get` / `list` subcommand. Or one with no write option and
      nothing after the key but redirections; the scan stops at `)`, quotes
      and separators.
    - **A write:** a value after the key (`""` counts), `--unset*`, `--add`,
      `--replace-all`, or the `set` / `unset` subcommand.
    - `-c core.hooksPath=…` and the environment forms are unchanged.
    - Arming (`git config core.hooksPath .githooks`) is a write, and stays
      the user's.
25. **Plan-number collisions** (owner ruling, 2026-10-20): keep numbers.
    - `--next-plan` (Part 2) reads every worktree's disk and every local
      ref. So a collision now needs work this checkout can't see (an
      unfetched branch, another machine, a cloud session), or two sessions
      numbering in the same moment.
    - prizma's two 29s and Hatedate's two 28s predate it.
    - The session view's duplicate warning (Part 1, AC9) reports what's
      left. SDD.md §2 says to renumber the later plan and its references.
    - No new mechanism, so no criterion.
26. **Lint only added lines** (owner ruling, 2026-10-20).
    - **Evidence:** Hatedate's lint fired 35 times, at most 7 of them true.
      Most re-flagged old lines on every edit (handover §3).
    - SSDD's convention-lint does the same: the edit hook and `--staged`
      lint every line of the file (`convention-lint.mjs:50-60`).
    - `--staged` also reads the file on disk, not the staged blob. A
      violation staged and then fixed on disk passes, and the reverse
      blocks.
    - **The change:**
      - `--staged` lints the `+` lines of `git diff --staged -U0 -M`. That's
        the staged content, and rename detection keeps a moved file from
        counting as new.
      - The edit hook lints the lines added since `HEAD` (`git diff -U0
        HEAD -- <file>`). A file `HEAD` doesn't have is linted whole.
      - Files named on the command line are still linted whole (CI, manual
        runs).
27. **Out, recorded so they aren't raised again:**
    - `git add -u` and directory adds (open in Hatedate's handover). A new
      block isn't a cost cut.
    - The `2>` and heredoc tokenizer misses. Those are in Hatedate's gate;
      SSDD's shapes suite passes `2>&1`, `> /dev/null` and heredoc
      messages.
    - Color literals in comments, which is a Hatedate rule.
    - Cherry-pick and revert (Clarify 18).

### Acceptance criteria

- **AC17 — Clean merges.**
  - In a scratch repo, during a merge stopped on a conflict, a path equal to
    git's merge owes nothing in `--pre-commit`, the harness hook and
    `--check`.
  - The resolved path, and a path edited during the merge, are owed.
  - An octopus merge, and a git whose `merge-tree --write-tree` fails, owe
    everything, as today.
  - **On real data:** each of prizma's 4 merges is redone in a scratch clone
    (`checkout <c>^1`, `merge <c>^2`, then `<c>`'s tree as the resolution).
    `--check` owes 1 routed file across the four. Today's gate owes 120.
- **AC18 — Delta re-review.**
  - After a full stamp, one routed file is edited. Under each reviewer
    routed to it, the block message gives `git diff <stamped> <staged>`, and
    that command prints exactly the edit. This holds in both stamping modes.
  - A file never stamped, a deletion, and a pruned blob get no delta line
    and owe the whole change.
  - After the re-stamp, the key names the new blob.
- **AC19 — `--check`.**
  - It prints the owed list and exits 1, or prints `nothing owed` and exits
    0.
  - The stamp file and the index are byte-for-byte unchanged.
  - `--repo` works from another directory.
  - git-guard allows it under `stamping: "hooks"`.
- **AC20 — Shapes and chained staging.** Under both harness payloads:
  - In a repo without `.ssdd/config.json`, the shapes refused today pass
    (`-am`, `commit <path>`, a chained `add` or `rm`). An unresolvable target
    still fails closed.
  - In an SSDD repo, `git add <unrouted file> && git commit -m x` passes,
    and so does `git add -- <file>`.
  - It's refused when a chained path is routed (by its spelling on disk
    too), a directory, `.`, a glob, has a `$`, or is outside the repo. It's
    also refused for `-A`, `-u` or `-p`, and when the chain uses `rm`, `mv`,
    `restore` or `update-index`.
  - **On real data:** Hatedate's 209 chains are replayed through the new
    hook in a scratch clone, with Hatedate's routing in an SSDD config.
    None of the 78 that add a routed file passes. The count that now passes
    is recorded.
- **AC21 — The untracked warning.** Through the real `pre-commit`:
  - An untracked file is listed as a warning, and the commit lands.
  - With `preCommit.blockUntracked: true`, it blocks as v3.0.0 does.
  - A Superpowers ledger stays exempt and keeps its reminder.
  - A non-object `preCommit` is a config error.
- **AC22 — `core.hooksPath` reads.**
  - git-guard allows `git config core.hooksPath` alone; with `--local`,
    `--global`, `--show-origin` or `--type=path`; as `git config get`; and
    followed by `2>/dev/null`, `|| echo unset` or `; …`, or inside `"$(…)"`.
  - It blocks a value (`""` too), `--unset`, `--unset-all`, `--add`,
    `--replace-all`, `set` and `unset`, and every case it blocks today.
  - **On real data:** of the 4 Hatedate commands, the plain read now passes.
    The read beside a write stays blocked, and the other two keep today's
    outcome.
- **AC23 — Lint only added lines.** In a scratch repo with an old violation
  in a tracked file:
  - An edit elsewhere in that file passes the edit hook and `--staged`.
  - A new violating line is flagged with its line number.
  - A new file is linted whole, and files named on the command line are
    linted whole.
  - A renamed file whose only violation is old passes `--staged`.
  - `--staged` judges the staged content: a violation that's staged and
    then fixed on disk still blocks.
- **AC24 — Docs.**
  - SDD.md §4 covers `--check`, the delta, merges and the visible chained
    `add`. §2 says how to fix a duplicate number.
  - `config.example.json` has `preCommit`.
  - The README, BACKLOG and a `## [3.1.0] — unreleased` CHANGELOG entry are
    updated.
- **AC25 — Existing tests and update.**
  - The suite passes; it's 631 at `v3.0.0`, plus the new cases.
  - An installed layout's selftests pass.
  - `update` from a `v3.0.0` install to this branch is clean.
  - No API newer than Node 18 is added; CI runs Node 18 and 24 on a push.

### Verification

*Verified 2026-10-20 on branch `claude/v3-cheaper-gate-cc1697`, cut from
local `main` at `v3.0.0` (`722bc60`). Every check below was re-run at
`79f7c62`, after the final review's fix pass. Node 24.15.0, git 2.54.0.
Selftest counts at `79f7c62`: `review-gate` 78, `review-gate.shapes` 191,
`review-stamp` 44, `git-guard` 261, `convention-lint` 17, `ssdd-config` 19,
`work-state` 70, `plan-parse` 29, `plan-migrate` 35, `bin/ssdd` 56,
`bin/skills-audit` 27, all passing.*

- **AC17** — `node --test mechanisms/hooks/review-gate.selftest.mjs` → 78
  pass. Its `merges` cases:
  - "a path equal to git's merge of the default branch owes nothing" (the
    block names the resolved `src/a.ts`, not the merged `src/b.ts`, and says
    `merge: 1 staged path(s) match git's own merge with <sha> — owed by no
    one`)
  - "the harness hook and --check apply it too"
  - "an edit made during the merge is owed"
  - "once the resolution is stamped, the merge commits"
  - "merging a branch that is not on the default branch is judged in full"
    and "merging a commit no ref holds (git stash create) is judged in full"
  - "an octopus merge is judged as today" and "a git without merge-tree
    --write-tree is judged as today" (a `git` shim that exits 129)
  - "--check mid-conflict lists the conflicted path"
  - "in a linked worktree"
  - "a merge of origin/main counts, though local main is behind"
  - "the oversize warning doesn't count merged paths"

  **On real data:** a scratch clone of prizma, with `origin/main` set to
  `2712ab0` and `origin/HEAD` pointing at it. Each merge was redone with
  `checkout --detach <c>^1`, `merge --no-commit <c>^2`, then `read-tree
  --reset -u <c>` (the real resolution; `MERGE_HEAD` stays). Every `<c>^2`
  is on `origin/main`.

  | Merge | `v3.0.0` `--pre-commit` owes | `--check` at `79f7c62` owes |
  |---|---|---|
  | `ebbd494` | 37 | 0 |
  | `60da710` | 25 | 0 |
  | `5597881` | 46 | 1: `src/app/method/page.tsx`, with `merge: 70 staged path(s) match git's own merge with 9f35b43` |
  | `1aa4cc6` | 12 | 0 |

  That's 120 routed files owed today and 1 after. `--check` took 0.07–0.13 s
  per merge. The real prizma: `git status --porcelain` is empty, at
  `441a9e6`.
- **AC18** — the same run, `the delta since the last stamp`. All pass:
  - "after a full stamp, an edit gives git diff <stamped> <staged>, which
    prints exactly the edit": the same line under `alpha` and `beta`, and
    running it prints one body line, `+b`
  - "hooks mode gives the same delta line"
  - "no delta for a never-stamped file or a deletion"
  - "a stamped blob that is gone owes the whole change"
  - "a moved base is named" and "a stamped change that was then committed
    is not a moved base"
  - "a hand-edited key builds no delta and does not throw"
  - "after the re-stamp the key names the new blob"
- **AC19** — the same run, `--check`. All pass:
  - "prints the owed list and exits 1"
  - "prints nothing owed and exits 0"
  - "writes nothing": the stamp file and `.git/index` are byte-equal before
    and after
  - "--repo works from another directory"
  - "outside an SSDD repo it exits 0; a broken config exits 1"
  - "the block message names --check"
  - git-guard: "review-gate --check runs under stamping "hooks"", where
    `--stamp` is still denied
- **AC20** — `node --test mechanisms/hooks/review-gate.shapes.selftest.mjs`
  → 191 pass, each case under both the Claude and the Cursor payload.
  - **Refused:** a routed path (by its spelling on disk on a
    case-insensitive disk too), a directory, `.`, a glob, `$X`, a path
    outside the repo, a path that doesn't exist yet, `-A`, `-u`, `-p`, a
    quoted `'2>'`, another git command before the commit, a subshell, and
    chained `mv`, `restore` and `update-index`.
  - **Passes:** "a visible chained git add passes". That covers `--`, `-f`,
    `cd docs &&`, a name with a space and `é`, `2>&1`, `git status` or
    `python3` first, a heredoc message, and a tracked deletion. "the staged
    routed files are still judged" holds.
  - "a repo without .ssdd/config.json judges no shapes": `-am`, `commit
    <path>`, a chained `add` and a chained `rm` all pass. `cd $X` fails
    closed.
  - "a malformed route fails closed, never open", and "directory changes the
    gate can and can't follow".

  **On real data:** 209 Bash calls in Hatedate's transcripts stage and
  commit. They were replayed through the hook in a scratch clone at
  `8563f3c`, whose `.ssdd/config.json` carries Hatedate's gate routing (its
  `ROUTES`, tests excluded).
  - 33 target other repos or scratch dirs that are gone, and 8 stage
    nothing before a commit; neither is replayed.
  - **Of the 80 that add a routed file, none passes.**
  - Of the 88 that add only unrouted files, 70 pass. Under `v3.0.0`, none
    did.
  - The other 18 are refused for another git command in the call (`git
    checkout`, `git reset`, a second commit), a subshell, `-u` or `cd
    $REPO`. Some name a file that has since left the tree, which is a replay
    artifact.
  - The real Hatedate: `git status --porcelain` is empty, at `8563f3cd`.
- **AC21** — all pass:
  - work-state: "pre-commit: an untracked file is a warning; the commit
    lands" (it runs the real `pre-commit`), "pre-commit:
    preCommit.blockUntracked restores the block", and "the untracked list
    stops at 10".
  - ssdd-config: "preCommit.blockUntracked defaults to false and reads
    true", and "a non-object preCommit is a config error".
- **AC22** — `node --test mechanisms/hooks/git-guard.selftest.mjs` → 261
  pass.
  - The `ALLOWED` table has 12 read forms: a bare read, `--local`,
    `--global`, `--show-origin`, `--type=path`, `get`, `2>/dev/null`,
    `2>&1`, `|| echo unset`, `; ls`, inside `"$(…)"`, and Hatedate's 07-11
    command.
  - The `BLOCKED` table adds 22 write forms: `""`, a quoted value,
    `--unset-all`, `--add`, `--replace-all`, `set`, `unset`, read-then-write,
    Hatedate's 08-09 read beside a write, arming, a value after `2>&1` or
    `>&2`, `<(true)`, a quoted `'--unset'`, `get` after an option, `--unset-a`,
    `--get` inside a `--comment` value or as its value, `$OP`, a backtick, a
    brace and a zsh glob group.

  **On real data**, the 4 Hatedate commands:

  | Command | `v3.0.0` | `79f7c62` |
  |---|---|---|
  | 07-11, a plain read after a `cat` | BLOCK | allow |
  | 08-09, arming a scratch repo | BLOCK | BLOCK |
  | 08-09, a read in `$(…)` and then a write | BLOCK | BLOCK |
  | 09-27, the key inside a Python string | allow | allow |
- **AC23** — `node --test mechanisms/hooks/convention-lint.selftest.mjs`
  → 17 pass. Its `only added lines` cases are all green:
  - "an edit elsewhere passes the edit hook"
  - "a new violating line is flagged with its number" (`:3`, not `:1`)
  - "--staged: only staged added lines"
  - "a new file is linted whole"
  - "files named on the command line are linted whole"
  - "a renamed file with an old violation passes --staged"
  - "--staged judges the staged content, not the disk"
  - "a path with a space and non-ASCII letters"
  - "a name git C-quotes (a double quote, a tab)"
  - "the edit hook lints from a project dir below the repo root"
- **AC24** — updated:
  - SDD.md §4 (`--check`, the delta as the reviewer's input, merges, the
    chained `add` exception) and §2 (renumbering a duplicate)
  - `mechanisms/config.example.json` (`preCommit`)
  - the README (the gate paragraph, Known limitations)
  - BACKLOG (the Part 3 row; the open decision gone; the `--remove-section
    core` limit)
  - CHANGELOG `## [3.1.0] — unreleased`
- **AC25** — `node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs`
  → 827 tests, 827 pass, 0 fail (631 at `v3.0.0`).
  - **Update:** a scratch repo was installed at `v3.0.0` (adapters
    `claude-code,cursor`) and committed. Then `update --to 79f7c62`:
    - exit 0, "unchanged: 30 file(s)", "updated (14)"
    - 0 conflict markers and 0 `.ssdd-new` files
    - `.claude/settings.json` has the same sha256
    - `.githooks/pre-commit` is byte-equal to `mechanisms/hooks/pre-commit`
  - **Installed layout:** `node --test .ssdd/hooks/*.selftest.mjs` → 744
    tests, 743 pass, 1 skipped (the source-tree-only config-example check),
    0 fail. The final reviewer also made a real commit there with an
    untracked file; it printed the warning and landed.
  - **No API newer than Node 18:** a grep of the diff for `toSorted`,
    `findLast`, `Object.groupBy`, `.union(`, `globSync`, `fromAsync` and
    `.at(` finds none. `fs.realpathSync.native` is Node 9.2.
- **AC25, Node 18 CI** — DEFERRED (operator). There's no Node 18 on this
  machine, and CI runs on a push, which waits for the owner's go-ahead.

### Deviations & discoveries

What shipped differs from Clarify 18–27 in these ways. Each is ledgered in
`.superpowers/sdd/2026-10-20-v3-cheaper-gate/progress.md` with its cost if
wrong.

- **An automated security review ran on every commit,** from a Claude Code
  plugin in this environment. It drove seven follow-up fixes, each made
  test-first, and the rulings on what it raised are in the ledger.
- **Only a merge of the default branch is exempt** (Decision 1, Clarify 18,
  narrowed).
  - As first built, the rule trusted any `MERGE_HEAD`. Merging a `git stash
    create` object, or any branch nobody reviewed, would have passed its
    content unreviewed.
  - Now `MERGE_HEAD` must be on the default branch, using Part 1's
    definition: `origin/HEAD` and its local namesake, else `main` or
    `master`.
  - All four prizma merges brought `origin/main` into a branch, so the
    evidence is unchanged. Merging one feature branch into another still
    pays in full.
- **`core.hooksPath`: everything after the key must be a redirection**
  (Clarify 24, tightened).
  - A read flag no longer makes a call a read. So `git config --get
    core.hooksPath <value-pattern>` is now blocked, where `v3.0.0` allowed
    it.
  - Words before the key are split the way the shell splits them. A prefix
    of a write option (`--unset-a`) is a write.
  - So is anything the shell expands before the key: `$`, a backtick, a
    brace, a parenthesis or a glob character.
  - Scanning every match also closed a hole in `v3.0.0`: a `--get` followed
    by a write in the same call passed.
- **A chained `git add` has more conditions than Clarify 22 listed:**
  - **Each path must exist now,** or be a tracked file being deleted. The
    hook runs before any of the call, so it can't tell a file from a
    directory that an earlier command makes.
  - **No other git command may run before the commit,** except a read:
    `status`, `diff`, `log`, `show`, `rev-parse`, `ls-files`.
  - **No subshell.**
  - **Other programs may run.** Refusing them too cut Hatedate's passing
    chains from 70 to 50; 19 of the calls ran `python3` first. A program
    reaches the index only by running git itself, which is the `v3.0.0`
    limit that the pre-commit layer backs.
- **`splitCommands` marks quoted words.** It also keeps `2>&1` and `&>file`
  as one word; before, the `&` split the command, so `git add x 2>&1 && git
  commit` looked like a command named `1`.
- **Directory changes the gate can't follow fail closed before a commit.**
  That means `pushd`, `popd`, `builtin cd`, and `cd` with an option. `v3.0.0`
  judged the starting repo in those cases. A redirection on a `cd`, and a
  `popd` after the last commit, are fine.
- **Routing is checked to the regex** (final review). A string `paths`, a
  regex that doesn't compile, or a route with no reviewer is a config error.
  It had thrown inside the new chained-add check, outside the gate's try, and
  Claude's PreToolUse reads that exit 1 as allow.
- **Found in the clarify pass and fixed:**
  - The harness gate refused shapes in repos with no config (Clarify 21).
  - `convention-lint --staged` read the file on disk, and silently skipped
    a staged file whose name has non-ASCII letters (git C-quoted it).
  - The edit-hook lint, run from a project dir below the root, matched
    nothing. That was a regression in this branch, caught by the final
    review.
- **The "base moved" note** (Clarify 19) appears only when `HEAD`'s side
  differs from both the stamped base and the stamped content. A stamped
  change that was later committed isn't a moved base.
- **SubagentStop keeps comparing raw staged keys.** Applying the merge rule
  there would report a merge-clean file as "changed during review".
- **The final review** (opus) found 0 Critical, 1 Important (routing, fixed)
  and 6 Minor.
  - Two Minors were re-graded and fixed: the subdirectory lint regression,
    and `cd x 2>/dev/null` plus a trailing `popd` failing closed in every
    repo.
  - Four are deferred, plus one of mine:
    - convention-lint reads an added line that starts with `++ ` as a file
      header
    - a dropped or added final newline re-lints the last line
    - during a merge, `--stamp --files` on a merge-clean path says "not
      staged, or not routed"
    - the delta abbreviates blobs to 12 characters
    - when nothing is owed, `--check` doesn't show the merge line
- **Out, as rulings:** `git config --remove-section core` and `export
  GIT_INDEX_FILE` before a commit are both older than Part 3, and both are
  new evasion shapes. The first is in BACKLOG's accepted limitations.
- **The replay corpus stays out of the repo.** Hatedate's 209 chains and 4
  hooksPath commands carry private paths and commit text. The scripts and
  their outputs are in the session scratchpad; the counts are above.

## Part 4 — the production guard and the Supabase pack

### Goal

Production changes go one sanctioned way. In both injected projects that
way is the integrations that deploy on merge to `main`. Anything else that
would change production asks a person first, with an accurate reason.
Reads don't ask. Knowledge specific to a stack lives in a pack, which is
installed only into repos that use that stack.

### Evidence

- **Hatedate's supabase-guard is the source.** The numbers are in
  `docs/handovers/HANDOVER-hatedate-adoption.md` §1:
  - 79 asks from 09-28 to 10-17: 2 real writes and 77 false positives.
    Today's guard still asks on 68 of the 77.
  - The owner approved 74 of the 79, with a median wait of 72 s.
  - Since PR #131, 17 of its 18 false positives asked only because of the
    command's shape (`| tail`, `2>&1`, `> file`).
  - Its prompt text says "writes to the PRODUCTION Supabase project" even
    for reads.
- **Its covered paths had no misses.** Before it existed, 31 MCP
  `apply_migration`, 7 `deploy_edge_function`, 8 `storage cp/rm` and at
  least 2 CLI deploys went straight to production.
- **It doesn't cover the Management API.** Agents call it with the CLI
  token from the Keychain; 13 calls, all GETs.
- **prizma runs the same workflow as an instruction, with no hook:**
  "Production ships on merge to `main` … Never deploy production from a
  laptop" (`AGENTS.md:65`).
- **Both projects use Supabase.** prizma has `supabase/config.toml` and
  `@supabase/supabase-js` (checked 2026-10-17).
- **SSDD has no "ask" decision today.** git-guard only denies. BACKLOG's
  "ask decision for guard rules" item folds into this part. Whether Cursor
  supports `ask` on `beforeShellExecution` is unverified.

### Owner rulings (2026-10-17)

1. Writes reach production only through migrations on merge to `main`. Any
   other write is an edge case that needs the owner's explicit approval.
   The guard is that approval step, not a hard block.
2. SSDD has a Supabase pack, injected only into repos that use Supabase.
3. Tests that only read are approved. Releases get no strict guards.
   Pushing to `main` stays unguarded until Hatedate launches.
4. Reads of personal data become a rule at launch, not now.

### Design

My calls.

- **`mechanisms/hooks/prod-guard.mjs`** runs on PreToolUse for Bash, and
  for the MCP tools that packs name.
  - It decides per command segment (`splitCommands`), never on the whole
    command's shape. Only the segments that reach production are judged;
    `grep`, `tail`, `jq` and `> file` pass.
- **Decisions:** `allow`, or `ask` with a reason that says which case it
  is: "writes to production outside the merge path" or "can't tell what
  this does". Never "writes" for a read.
  - In Cursor, if `beforeShellExecution` doesn't support `ask`, it uses
    `deny` with the same reason. Verify this first.
- **Config:** `productionGuard: { writePath: "<one line, shown in
  reasons>", extraRules: [{ match, decision, reason }] }`.
  - Packs add rules, and a project can add its own: for example
    `vercel deploy --prod` for prizma.
- **Packs** live in `packs/<name>/`. Each holds a `detect.mjs` (run at
  install time), the classifier the guard loads, MCP tool patterns,
  helpers, docs and tests. They install as managed files in
  `.ssdd/packs/<name>/`.
- **Detection and the lock.**
  - `install` detects packs and records them in the lock as `packs`. For
    Supabase it checks for `supabase/config.toml`, or for
    `@supabase/supabase-js` / `supabase` in the root `package.json`.
  - `update` installs what the lock lists and never re-detects on its own,
    so packs can't appear or vanish between updates.
  - `status` says when a repo now matches a pack it doesn't have.
  - `--packs a,b` or `--packs none` on `install` or `update` overrides
    detection.
- **The Supabase pack:**
  - **Source:** Hatedate's supabase-guard rules and its `sql-lex` /
    `sql-readonly` libraries.
  - **The handover's fixes are applied here, in SSDD.** Hatedate stays
    untouched and later adopts the pack instead of fixing its own copy.
  - **What it changes:**
    - It judges only the database segment of a command.
    - A `db-read "<sql>"` helper wraps the SQL in `BEGIN READ ONLY …
      ROLLBACK` and runs the classifier on it. It never asks.
    - Its reasons are accurate.
    - `--help` and `db push --dry-run` pass.
    - Heredocs that are commit messages or PR bodies aren't treated as
      commands.
  - **What still asks:**
    - MCP `apply_migration`, `deploy_edge_function`, and `execute_sql`
      when it writes
    - CLI write subcommands
    - Management API calls that aren't GETs
  - **A `personalReads` option, off by default:** the tables and columns
    that should ask before a read. It's for launch (ruling 4).
- **The replay becomes a test.** The 79 Hatedate asks become a fixture,
  redacted as in Open below. The pack must ask on exactly these:
  - the 2 writes
  - the 2 rollback probes
  - whatever it can't parse

### Scope

**In:**
- prod-guard and the pack mechanism (detection, the lock's `packs`, and
  `install`, `update` and `status`)
- the Supabase pack, its tests and the replay fixture
- the adapters' wiring, README and SDD.md
- retiring BACKLOG's "ask" item

**Out:**
- Changes in Hatedate.
- A Vercel pack. A project rule covers prizma for now.
- Branch protection, and guards on releases (ruling 3).

### Open

- Whether Cursor supports `ask` on `beforeShellExecution`.
- Whether Hatedate's 07-27 note ("a rejected `apply_migration` still ran")
  reproduces on today's Supabase MCP. If it does, `ask` can't stop an MCP
  write, and the pack should `deny` MCP writes and point at the merge path
  instead.
- **Redaction:** SSDD is a public repo, and the replay inputs come from
  private transcripts. Keep only the command shapes, with SQL bodies
  reduced to their statement kinds. Bringing Hatedate's guard code into
  SSDD was approved on 2026-10-17 (ruling 2).

## Part 5 — trimming

### Goal

Make SSDD only as big as what it does. Keep what carries facts, commands,
scripts and gotchas a current model can't work out for itself. Cut what
tells it how to reason.

### Evidence

- **Unused parts:** prizma never routed `gate-reviewer`, ran the drift
  audit once (`62a1df6`), and has one lint rule.
- **`/cleanup` is the most used skill.** 26 prizma commits and 75 Hatedate
  commits cite it.
  - Both projects grew their copies to 11.5 KB and 13.3 KB, against the
    3.5 KB SSDD ships.
  - Its effort levels, `--fix`, `--comment` and verify pass now duplicate
    Claude Code's own `/code-review`.
- **The weight is in always-loaded files, not skills.**
  - SSDD's 5 skill descriptions come to about 1 KB in total.
  - Hatedate loads about 54 KB at every session start.
  - prizma's AGENTS.md is 179 lines; the template is 58.
- **Prescriptive text can hurt.** `docs/model-era-review.md` D3: skills
  written for older models are often too prescriptive and can make output
  worse.
- **SPEC.md is about 1,700 lines,** with every version in one file. The
  README's longest section is Known limitations.

### Decisions

My calls.

1. **Split SPEC.md** into one file per version in `docs/specs/`, with
   SPEC.md as the index.
2. **Cut the README to one page;** the detail moves to `docs/`.
3. **Make the rarely used parts optional:** the drift-audit runbook and
   `/docs-drift-audit` install only with `install --with drift-audit`.
   `gate-reviewer` is already opt-in. `/skills-audit` stays, since Part 2
   makes it an onboarding step, but its text is trimmed.
4. **`/cleanup` becomes thin.** It works out the scope, hands the general
   review to the harness (`/code-review` in Claude Code), adds the routed
   SSDD reviewers, merges the findings, and changes nothing until the
   user approves. Anything the prizma and Hatedate copies added that
   holds up goes back into SSDD.
5. **Test every skill and instruction file against the D3 rule.** Decide
   with the README's new-model re-run and `/doctor prompt-audit` (which
   needs Claude Code 2.1.283 or later).
6. **Trim the handover and AGENTS templates.** `new-plan` shrinks once
   Part 1's script can compute the next plan number.
7. **Raise the Node floor to 22** (owner ruling, 2026-10-20). Node 18 and
   20 are past end-of-life (April 2025 and April 2026), prizma's workflows
   run 22, and nothing in SSDD needs 18. CI moves to `[22, 24]`; the README
   badge and text, `bin/ssdd.mjs`'s header and the CHANGELOG follow.

### Open

- A new-model reminder: record which model generation the instructions
  were last reviewed for, and have the session view say when the current
  model is newer. This needs the session-start payload to carry the
  model, which is unverified.
