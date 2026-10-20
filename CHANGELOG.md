# Changelog

Versions follow semver, adapted to a framework that lives inside other repos:

- **MAJOR**: needs manual steps in an injected repo, such as a layout move, a
  stamp-file or config contract change, or a renamed hook.
- **MINOR**: new reviewers, skills, or features that update cleanly.
- **PATCH**: fixes and wording.

`bin/ssdd.mjs update` prints every entry between a repo's locked version and
the target, so upgrade steps belong here and not only in commit messages.

## [3.1.0] — unreleased

v3 Part 3, a cheaper gate: keep every block that catches a real mistake and
stop charging for the ones that don't; see `SPEC.md` → v3 → Part 3. Nothing
to do by hand: a repo that wants the untracked-file block back sets
`preCommit.blockUntracked`.

### Changed
- **A merge of the default branch owes only its resolutions.** While such a
  merge is stopped (a conflict, or `--no-commit`), a staged file equal to
  git's own merge of the two sides (`git merge-tree --write-tree`, git 2.38
  or later) owes no review. Conflict resolutions and edits made during the
  merge are owed as usual. Merging another branch, an octopus merge, or older
  git judges every file, as before. On prizma's four SKIP'd merges, the
  routed files owed go from 120 to 1.
- **A re-review gets the change, not the file.** When a file changed after a
  reviewer stamped it, the block message gives `git diff <stamped blob>
  <staged blob>` under that reviewer, and that diff is the reviewer's input.
  The stamp format doesn't change.
- **`review-gate.mjs --check [--repo <path>]`** prints what the index owes
  without committing, and exits 1 when a commit would be blocked. It writes
  nothing and runs in both stamping modes. Use it instead of a probe commit.
- **A chained `git add` of unrouted files passes.** `git add docs/x.md &&
  git commit` is allowed when every path is a file that exists now (or a
  tracked file being deleted) inside the repo, and no reviewer is routed to
  it. A path is routed by its spelling on disk. Still refused: options
  other than `-f` / `-v`, directories, globs, pathspec magic, expansions, a
  subshell, another git command before the commit other than a read
  (`status`, `diff`, `log`, `show`, `rev-parse`, `ls-files`), and chained
  `rm`, `mv`, `restore` and `update-index`. Of Hatedate's chained docs
  commits, 70 of 88 would now pass; none that added a routed file would.
- **Command shapes are judged only in an SSDD repo.** The harness gate
  resolves the target repo and loads its config first, so a scratch repo
  with no `.ssdd/config.json` passes chained staging, `commit -a` and `commit
  <path>`. An unresolvable target (`$VAR`, `pushd`, `cd -`) still fails
  closed.
- **Untracked files are a warning.** The pre-commit lists them, at most 10,
  and the commit lands. `preCommit.blockUntracked: true` in
  `.ssdd/config.json` restores the block; a `preCommit` that isn't an object
  is a config error. The check moved from the shell into `work-state.mjs
  --staged`.
- **git-guard lets a read of `core.hooksPath` through.** `git config
  core.hooksPath`, with `--get`, a scope or the `get` subcommand, and inside
  `$(…)`, passes. A value after the key, a write option or its abbreviation,
  and anything the shell expands before the key are still writes. Each `git
  config` in a call is judged on its own.
- **convention-lint lints the lines a change adds.** `--staged` lints the
  `+` lines of the staged diff, with renames detected. The edit hook lints
  the lines added since `HEAD`. A new file and files named on the command
  line are linted whole.

### Fixed
- `convention-lint --staged` read the file on disk, not the staged content,
  and skipped a staged file whose name has non-ASCII letters.
- git-guard judged only the first `git config … core.hooksPath` in a call.
- The command tokenizer split `2>&1` and `&>file` at the `&`.

## [3.0.0] — 2026-10-20

v3 Parts 1 (work state) and 2 (onboarding existing repos); see `SPEC.md` →
v3.

### Added
- **The work-state view** (`.ssdd/hooks/work-state.mjs`). It lists every open
  plan across the default branch (`origin/HEAD` as last fetched, else `main`),
  other branches and worktrees: status, next task from its ledger, criteria
  verified and deferred, open questions. It flags a plan that says IN PROGRESS
  on the default branch while no branch is working on it, reports plans that
  share a number, and groups status words outside the six. It never fetches
  or edits a plan.
- **Session start.** Claude Code's `SessionStart` hook and Cursor's
  `sessionStart` run it (`--session-start`: at most 12 lines and 1.5 KB,
  always exit 0). Cursor's always-applied rule and the AGENTS template also
  tell the agent to run it, since Cursor may drop hook context.
- **The close check** (`--staged`, run by the pre-commit hook). A staged plan's
  Status must be DRAFT, IN PROGRESS, BUILT, SHIPPED, SUPERSEDED or ABANDONED.
  BUILT or SHIPPED needs a Verification entry for every `AC` ID (`DEFERRED
  (operator): …` counts) and the plan's ledger staged. Plans with no IDs are
  noted and pass. A plan a merge brings in unchanged is skipped, since it was
  judged where it was committed. The check runs on the repo git runs the hook
  in.
- **Tracked Superpowers ledgers.** `install` and `update` ship
  `.superpowers/sdd/.gitignore`, which keeps each plan's `progress.md` in git
  and the rest of Superpowers' workspace ignored. Superpowers' own `*`-only
  file is replaced; an edited one is left. `status` warns when a parent
  ignore rule (for example `.superpowers/` in the root `.gitignore`) hides the
  ledgers.
- **`paths`** in `.ssdd/config.json`: `plans`, `specs` and `ledgers`,
  defaulting to `.ssdd/plans`, `.ssdd/specs` and `.ssdd/ledgers`. The view,
  the close check, `--next-plan` and the migration read them; `install`
  creates the folders they name.
- **The plan migration**, for a repo whose plans predate v3. `work-state.mjs
  --migrate` rewrites criteria to `- **AC1** — …` (IDs kept, ID-less ones
  numbered after the highest) and prints each plan's to-do. `/migrate-plans`
  is the agent pass: entries cite their IDs from the plan's own record,
  Status words become one of the six (checked against git, the old text
  kept), references gain IDs, and a criterion nothing closes gets `NOT
  RECORDED (migrated <date>)`. `--migrate-check <ref>` is its floor: every
  removed line kept under one of its IDs (a ❌, ☐ or `[ ]` still saying not
  met), nothing left to do.
- **Onboarding lines.** The view, `status` and `update` say `N plans in the
  old format: run /migrate-plans` and `/skills-audit hasn't run here` until
  each step is done. `skills-audit.mjs record` sets `"audited"` in
  `.ssdd/skills.json`; `/skills-audit` ends every run with it.
- **`work-state.mjs --next-plan`**: the next free plan number across every
  worktree and ref, read from `paths.plans`. `/new-plan` uses it.

### Changed
- The pre-commit untracked-file block skips `.superpowers/sdd/*/progress.md`
  (Superpowers creates it before the first task's commit); the close check
  reminds to stage it instead.
- Templates: criteria are `- **AC1** — …` with no checkbox; Verification
  entries cite the IDs, with a `DEFERRED (operator)` form. The ledger
  template's finished example row is ticked.
- The plan parser reads what prizma writes: IDs with a letter (`AC8b`),
  `[~]` and `[-]` checkboxes on criteria, and Verification entries ticked
  `[x]` or `[~]`. An unticked `- [ ] **AC1** — …` is still no entry.
  Criteria are the top-level items of the criteria section (a sub-bullet
  naming an ID isn't one), a line headed by a run of IDs (`AC1–AC3`) is no
  ID's entry, and a `##` line inside a code fence starts no section. A `NOT
  RECORDED` entry counts as an entry, not as verified; open plans show their
  not-recorded count.
- SDD.md, the templates, `/new-plan` and the AGENTS template name the
  folders by setting ("the plans folder (`paths.plans`, default
  `.ssdd/plans`)").
- `update` ends with each crossed version's `### Upgrade` section from this
  file, oldest first; a `+sha` target also counts sections headed
  `unreleased`.

### Upgrade
- Run `/migrate-plans` once, in a repo with existing plans: it formats them
  for v3 in one commit (`node .ssdd/hooks/work-state.mjs --migrate` is its
  first step). Until then the session view says how many plans are in the
  old format.
- Claude Code: `.claude/settings.json` is project-owned, so add the
  `SessionStart` entry from `adapters/claude-code/settings-hooks.json`
  (`update` prints the template diff).
- Run `/skills-audit` if it never ran here; `update` and `status` say so.

## [2.7.0] — 2026-10-17

Fixes from user reports, and `install` / `update` now arm the pre-commit
hook. No manual steps.

### Fixed
- **Completion stamps work in the Claude Code desktop app.** There a
  subagent ends by calling `SubagentHandback`, and its report (with the
  verdict line) is that call's `message`; `last_assistant_message` is
  empty, so every review was refused as "ended without a verdict line" and,
  with `stamping: "hooks"`, routed files couldn't be committed. The
  `SubagentStop` hook now reads the handback from the subagent transcript
  and parses it first. A handback followed by a new prompt (a resumed
  agent) doesn't count; a handback without a verdict is refused even if
  `last_assistant_message` has one. The CLI path is unchanged.
- **An absolute `core.hooksPath` in a worktree is no longer called
  dormant.** Pointed at the main checkout's `.githooks`, every linked
  worktree runs that copy of `pre-commit`, which still gates the
  worktree's own diff. `status` and the gate said "dormant"; now only
  `status` prints a note suggesting the relative form, run once since the
  setting is shared. A path with no `pre-commit` under it is still dormant.

### Changed
- **`install` and `update` arm the pre-commit hook.** They set
  `core.hooksPath` to `.githooks` when it's unset, or when it's an absolute
  path to a checkout's `.githooks` (so each worktree runs its own copy),
  and print `armed`. Any other value (`.husky`, `.git/hooks`), or an unset
  one with a real hook in `.git/hooks` (the `pre-commit` framework,
  lefthook), is left alone and the manual step stays: setting it would
  stop those hooks. Only at the top of a work tree that has
  `.githooks/pre-commit`. git-guard still blocks the agent from writing
  `core.hooksPath` directly. `status` says when rerunning `update` would fix
  it. To arm an existing install, rerun `update`.

### Docs
- `adapters/claude-code/README.md`: desktop-app worktree sessions load
  agents, skills and hooks from the main checkout (`--project-config-root`),
  so SSDD must be on its branch for them to run there.

## [2.6.1] — 2026-10-14

Fixes from the v2.6 review. A manual step only if `.ssdd/config.json` has
a section of the wrong type (see below): the gate now blocks every commit
until it's fixed, and `ssdd status` prints the key.

### Fixed
- **A `"root"` key in `.ssdd/config.json` no longer moves the repo root**
  the hooks use. The loader sets `root` after the file's own keys.
- **A section of the wrong type is a broken config.** A `reviewGate` or
  `gitGuard` that isn't an object (`null` and arrays included), or a
  `routing` that isn't a list of objects (`{}`, `["^src/"]`, `[null]`), now
  fails closed with a message naming the key. Before, it loaded: a string
  was spread into index-keyed characters, and a string route matched
  nothing. git-guard drops only the bad section and keeps the rest, so its
  `extraRules` stay on.
- **The gate's broken-config message fits every case.** It said "Fix the
  JSON" and "is not valid JSON" even when the file couldn't be read. It now
  says the config can't be used; the loader's error says why.

## [2.6.0] — 2026-10-12

Brings the gate back to its threat model: it keeps a cooperating agent on
the process and isn't a sandbox. A new evasion shape is out of scope unless
an agent was seen using it in a real project.

### Removed
- **Shell-wrapper unwrapping**, added in v2.1.1. The harness hooks no longer
  judge `bash -c '…'`, `eval "…"`, a heredoc fed to a shell or `… | sh` as if
  typed directly. The pre-commit layer still blocks the commit. Runner
  prefixes (`sudo`, `env`, an absolute `git` path) are still recognized by
  git-guard and Cursor's hook.
- **The HEAD ∪ staged config** (v2.5). The working-tree `.ssdd/config.json`
  applies, so an edit takes effect at once, in both layers and in git-guard.
  A broken config is fixed in place, with no commit needed.
- **`gate-reviewer` routed by default.** The shipped `config.example.json`
  no longer routes it, and `status` no longer lists unrouted gate files. The
  reviewer still ships and `install` still links it; its route is the opt-in
  snippet in `reviewers/gate-reviewer.md`.

### Changed
- **The review gate's Claude Code hook starts only on git commands**:
  `"if": "Bash(git *)"` on its PreToolUse(Bash) entry. It still runs for
  `git -C <worktree> commit`. `/usr/bin/git`, `env …` / `sudo …` runners and
  shell wrappers now reach only the pre-commit layer. git-guard,
  convention-lint and the SubagentStart / SubagentStop hooks are unfiltered.
- README → Known limitations opens with the threat-model rule and says what
  the harness hooks don't see.
- Kept: a config that isn't valid JSON still blocks, the dormant-hook note,
  per-file and completion stamps, `stamping: "hooks"`, `reviewerModels`, and
  v2.1's refusal of commits the gate can't see.

### Upgrade
`update` doesn't touch `.claude/settings.json`. Add the `if` line to the
review gate's PreToolUse(Bash) handler:

```json
{
  "type": "command",
  "if": "Bash(git *)",
  "command": "node \"$CLAUDE_PROJECT_DIR/.ssdd/hooks/review-gate.mjs\""
}
```

A repo that pasted the 2.5 `gate-reviewer` route into `.ssdd/config.json`
may keep it or drop it. No other step.

## [2.5.0] — 2026-10-09

Closes the four gate weaknesses README → Known limitations still listed.

### Added
- **`gate-reviewer`.** It reviews changes to the gate itself (routing,
  gate settings, hook wiring, hook scripts, reviewer checklists, process,
  instruction files) for anything that loosens it without the owner's
  recorded go-ahead. The shipped config routes the gate's own files to it.
- **`status` says whether the gate is armed:** it lists gate files no route
  covers, warns when the pre-commit hook is dormant (`core.hooksPath` isn't
  `.githooks`), and names a config that isn't valid JSON. The exit code is
  unchanged.
- **The harness gate notes a dormant pre-commit hook** on every commit, in
  its block message and its allow result.
- `install` suggests a `"prepare"` script when the target has a
  `package.json`.
- **CI:** every selftest runs on Node 18 and 24 for pushes to `main` and PRs.

### Changed
- **A commit is judged by HEAD's config and the staged one**, the stricter of
  the two: routes from both, `stamping: "hooks"` if either says so, both
  `reviewerModels` lists, a `gitGuard` block off only when both turn it off.
  The working-tree file is read only when neither exists. So **a config edit
  takes effect once it's committed**, and an uncommitted edit changes
  nothing. git-guard reads the same pair.
- **A config that isn't valid JSON blocks** (pre-commit exit 1, harness
  deny, `--stamp` refused) instead of disarming the gate. A broken HEAD
  config with a valid staged one only warns, so the fix can land.
  convention-lint reports a broken config or a rule regex that doesn't
  compile instead of skipping silently.

### Upgrade
`update` doesn't touch `.ssdd/config.json`, so add the route by hand (drop
any path you don't want reviewed), then commit it:

```json
{ "reviewer": "gate-reviewer",
  "paths": ["^\\.ssdd/(config\\.json$|hooks/|reviewers/|process/)", "^\\.githooks/", "^\\.claude/(settings\\.json$|agents/|rules/)", "^\\.cursor/(hooks\\.json$|rules/)", "^(AGENTS|CLAUDE)\\.md$"] }
```

`status` lists the gate files still unrouted. That commit is the first one
`gate-reviewer` reviews.

## [2.4.0] — 2026-10-06

### Added
- **`/skills-audit`.** It picks the stack's best-practice skills without
  installing them blindly. A catalog (RN/Expo, Next.js/React: Software
  Mansion, Callstack, Expo, Vercel) maps stack signals to skill sources,
  with hazards that belong to the source and the sha its audit read.
  - `skills-audit.mjs` lists candidates, sha drift, name clashes and skills
    already present.
  - `collisions <dir>` checks a source's code samples against the repo's
    `lint` rules.
  - The skill reads each source at a pinned sha against the repo's rules
    and reviewers, then proposes adopt / cherry-pick / refresh /
    do-not-install / skip.
  - On approval it records each verdict by sha. It never installs a plugin
    itself; it prints the command.
  - In Claude Code it also runs `claude-automation-recommender` when
    `claude-code-setup` is enabled, and otherwise says how to enable it.
- **`.ssdd/skills.json`:** a project-owned ledger, seeded by `install` and
  never touched by `update`.
- **`status <repo> --skills`** reports ledger sources that moved upstream
  (`current`, `moved`, `unreachable`, `never pinned`). It's network on
  request only and never changes the exit code.

### Changed
- `performance-reviewer` and `/new-reviewer` look in `.ssdd/skills.json`
  too.
- `--skills` is a flag: it doesn't take the next argument as a value.

### Upgrade notes (from 2.3.x)
- `update` adds `.agents/skills/skills-audit/` and seeds
  `.ssdd/skills.json`.
- If your repo already records vendored skills in `skills-lock.json` or a
  VERSIONS table, run `/skills-audit` once to move those decisions into the
  ledger by sha. The other files can stay.
- `claude-code-setup` is not enabled by the settings template. Enable it
  per repo if you want the recommender.

## [2.3.2] — 2026-10-06

### Fixed
- **SSDD's hook tests no longer break a project's test runner.** They were
  installed as `.ssdd/hooks/*.test.mjs` and written with `node:test`.
  Vitest's default include collected them and failed ("No test suite
  found"), which would have broken the first injected project's
  `npm run check`.
- The tests are now `*.selftest.mjs`, which no default pattern of vitest,
  jest, playwright, `node --test`, bun or deno matches. A new test keeps it
  that way. Run them with `node --test .ssdd/hooks/*.selftest.mjs`.

### Upgrade notes (from 2.3.x)
- `update` removes the old `*.test.mjs` hook tests (unless you edited them)
  and adds the `*.selftest.mjs` ones. If you excluded `.ssdd/hooks/**` from
  your test runner as a workaround, you can drop that.
- A repo that wrote its own hook tests under `.ssdd/hooks/` before v2 keeps
  them, since `update` only manages its own files. They test the old hooks;
  delete them in favor of the selftests.

## [2.3.1] — 2026-10-05

### Changed
- **Reviewer files no longer pin a model.** `.ssdd/reviewers/*.md` are
  harness-neutral: the same files serve Cursor, where a session may run
  Grok, Composer, GPT or Claude. A Claude model id there means nothing, or
  the wrong thing. The harness and session choose the model, and
  `/new-reviewer` no longer adds one. `effort: medium` stays on the
  mechanical lenses; it's a level, not a vendor id.
- **`reviewGate.reviewerModels` is opt-in** and unset in the example
  config. Only Claude Code's completion-stamp hook can check it, so it never
  affects Cursor. A Claude-based project that wants the floor sets
  `["opus>=5.5", "sonnet>=5.5"]`. Reviewers then use the session's model, so
  run the session on one of those.

### Upgrade notes (from 2.3.0)
- `update` removes the `model:` lines from the framework reviewers. Add
  `reviewGate.reviewerModels` to `.ssdd/config.json` yourself if you want
  the floor.

## [2.3.0] — 2026-10-05

### Added
- **Completion stamps (Claude Code).**
  - The review gate also runs on `SubagentStart` / `SubagentStop`. A routed
    reviewer's start snapshots the staged keys of its files. Its stop stamps
    the ones still unchanged, if the final message ends with a verdict
    (CLEAN / SECURE / `N ISSUE(S)` / `N RISK(S)`) and every turn ran on an
    allowed model.
  - `NO DIFF`, a missing verdict, a disallowed model, or a file edited
    during the review all leave the file owed.
  - Stamps record `by: "hook"`, the verdict, the issue count and the model.
    Start and stop are paired by `agent_id`; parallel stops write under a
    lock.
- **`reviewGate.stamping`:** `"manual"` (default) or `"hooks"`. In hooks
  mode git-guard denies `review-gate.mjs --stamp`, including when wrapped in
  a shell, and any Bash reference to `.git/ssdd-review-*`. The block message
  says to dispatch the reviewers.
- **`reviewGate.reviewerModels`:** a completion stamp lands only if every
  turn of the review ran on an allowed model. An entry is a family
  (`"opus"`), a family with a version floor (`"sonnet>=5.5"`), or a
  substring of the model id. The example config is
  `["opus>=5.5", "sonnet>=5.5"]`: Sonnet and Opus 5.5 and later. Older
  versions, Haiku and Fable are refused. The check reads the subagent
  transcript, because a spawn can override the frontmatter model.
- **Reviewer models pinned by full id:** `claude-opus-5-5` on security and
  resilience; `claude-sonnet-5-5` on performance, convention-compliance and
  docs-sync. The domain template defaults to `claude-sonnet-5-5`. Full ids,
  because aliases resolve per CLI version: on Claude Code 2.1.263 `sonnet`
  meant `claude-sonnet-5`, which the 5.5 floor refused. CLIs that don't
  list the id print an `unrecognized_model` warning and still run it.
- **Refusals are visible:** a completion stamp refused for a missing verdict
  or a disallowed model is recorded in the stamp file's `refused` map. The
  gate's block message prints it (`! <reviewer>: …`), since the
  orchestrating agent never sees the hook's stderr. A later good review
  clears it.
- **Edit/Write guard:** git-guard as PreToolUse(Edit|Write) denies the Edit
  and Write tools on `.git/ssdd-review-*` in every mode.
- **Triage note:** a commit whose files a reviewer flagged, unchanged since,
  passes with a "triaged?" note (the PreToolUse `additionalContext`, and
  stderr in pre-commit).
- **`/new-reviewer` skill:** proposes lenses from the stack, the code no
  reviewer covers, and bug classes that recur in the ledgers. It scaffolds
  an approved one from the domain template (route with a `$comment`, model,
  effort, symlink). `coverage.mjs` lists unrouted files and tests a
  candidate route's regexes.
- 20 tests in `review-stamp.test.mjs` with payloads shaped by a live probe
  of Claude Code 2.1.263.

### Upgrade notes (from 2.2)
- `.claude/settings.json` is yours; `update` prints the template diff. Add
  three entries:
  - PreToolUse `Edit|Write|MultiEdit|NotebookEdit` → `git-guard.mjs`
  - `SubagentStart` → `review-gate.mjs`
  - `SubagentStop` → `review-gate.mjs`
  
  Reload the session.
- `.ssdd/config.json` is yours. To enforce models, add
  `reviewGate.reviewerModels` (e.g. `["opus>=5.5","sonnet>=5.5"]`). To make completion
  stamps the only way for the agent, add `"stamping": "hooks"`. Cursor-only
  repos stay `manual`.
- Reviewers gain `model:` lines. If you edited a reviewer's frontmatter,
  expect a small merge there.
- Your own domain reviewers keep their models; add `model: sonnet|opus` to
  each.

## [2.2.0] — 2026-10-05

Text cut for Claude 5-generation models (framework half of
`docs/model-era-review.md`). There are no mechanism changes; hooks, block
messages and config are as in 2.1.1.

### Changed
- **AGENTS template** (always loaded): 96 → 58 lines. It now carries the
  gate as a pointer instead of a procedure, one evidence rule instead of
  three verification principles, a two-line git section, and an empty
  **Gotchas** section, which is where its tokens are best spent.
- **SDD.md §4** is the one place the gate procedure is written out (with
  the hook's block message). The cleanup skill and the Cursor rule point
  there.
- **Principles 1–3 merged** into one evidence rule ("check each claim
  against a tool result from this session; say what isn't verified").
  Added: effort follows the stakes.
- **§5:** the gate and the final review are the review rounds. Don't start
  others unless asked.
- **§7:** run `/doctor prompt-audit` when instructions, skills or reviewers
  change, or when a new model generation is adopted.
- **new-plan** points to SDD.md §2 instead of restating it, 51 → 37 lines.
  The clarify-pass checklist is now "kinds that have bitten before".
- **Descriptions** for every reviewer and skill are 300 chars or fewer, in
  third person, with no route lists. Resilience went from 490 to 289.
- **Reviewers:**
  - `effort: medium` on docs-sync and convention-compliance; the others
    inherit the session's level
  - incident stories cut to a clause
  - capitals used for emphasis made normal case
- README: a "When a new model generation ships" checklist.

### Upgrade notes (from 2.1)
- `update` merges the framework files. `AGENTS.md` is yours, so it prints
  the template diff instead. Worth porting by hand:
  - replace the gate procedure with the four-line pointer
  - merge the three verification principles into the one evidence rule
  - add the "reviews happen at the gate and the final review" line
  - add a Gotchas section
- If you customized a reviewer's description to list its routes, expect a
  conflict there. The routes already live in `.ssdd/config.json`.

## [2.1.1] — 2026-10-05

### Fixed
- A command wrapped in a shell passed both hooks:
  `bash -c 'git commit -anm x'`, `sh -lc …`, `eval "…"`, `bash <<EOF`
  scripts, and `echo '…' | sh`. With `-n` that skipped the pre-commit
  layer too. git-cmd.mjs now flattens wrapped scripts in execution order
  (`flatten`, `expandWrappers`, depth 3), and both hooks judge them as if
  typed directly.
- The gate scanned only the first commit in a call:
  `git commit -m x; git commit -am y` passed. Every commit is now
  checked. One call that commits to two different repos is refused.
- Runner prefixes (`sudo`, `env -i`, `command`, `nohup`, `time`, `exec`,
  `nice`) and an absolute git path no longer hide a git command from the
  gate's checks or from the `core.hooksPath` rule.
- 14 more git-guard cases and 19 more gate cases. Against the v2.1.0 hooks
  they fail 18 and 15 tests respectively.

## [2.1.0] — 2026-10-05

**Agents must now stage and commit in separate tool calls.** The harness
review gate runs before the command, so it reads the index as it is now. It
therefore refuses commits whose content it can't see: `git add … && git
commit` in one call, `commit -a/-i/-o`, and `commit <pathspec>`. Skills or
habits that chain `git add x && git commit` will be blocked with a message
saying what to do instead.

### Added
- `mechanisms/hooks/git-cmd.mjs`: one shared command grammar (skeleton,
  separator-bounded flag rules, `splitCommands`, `gitInvocation`) for
  git-guard and review-gate. Ported from the original source project's
  hardened hooks.
- review-gate judges the repo a commit targets. It starts from the tool
  call's `cwd`, `cd` moves it and `git -C` composes on it. It fails closed
  on `$VAR`, `$(…)`, `cd -`, or a directory that isn't a repo.
  `--stamp … --repo <path>`, and the block message prints `--repo` when
  needed.
- Route `exclude` (per route) and `reviewGate.exclude` (all routes).
- Reviewers answer `NO DIFF — scope not provided` instead of `CLEAN` when
  given nothing to review.
- Test suites: `review-gate.shapes.test.mjs` (89 cases, including a real
  worktree) plus 21 more git-guard cases. Against the v2.0.0 hooks they fail
  64 and 8 cases respectively.

### Changed
- review-gate harness mode prefers the payload's `cwd` over
  `CLAUDE_PROJECT_DIR`. In v2.0 a `git -C <worktree> commit` was judged
  against the main checkout's index.
- `--pre-commit` uses git's cwd and ignores `SSDD_PROJECT_DIR` /
  `CLAUDE_PROJECT_DIR`.
- What counts as a commit is now `git [global options] commit`, so
  `git log | grep commit` no longer is one.
- In harness mode, a staged diff the gate can't evaluate (e.g. a bad regex
  in config) now blocks with the error instead of allowing.

### Fixed
- git-guard: every rule's flag scan stops at its own command, so
  `git commit -m x && git log -n 3` is no longer `commit -n`.
  `core.hooksPath` is matched case-insensitively, quoted or bare, after
  `VAR=value` prefixes, and via `GIT_CONFIG_PARAMETERS` /
  `GIT_CONFIG_KEY_<n>`.
- The example force-push rule stops at its own command
  (`git push origin main && echo +done` was blocked).

### Upgrade notes (from 2.0)
- `update` merges everything. Port the force-push `pattern` from the
  printed config-template diff (`[^\n]*` → `[^;&|\n]*`). Optionally add
  `reviewGate.exclude`.

## [2.0.0] — 2026-10-05

Back-port from the first injected project (~38 plans of real use), plus
versioned updates.

### Added
- `bin/ssdd.mjs` with four commands: `install`, `update`, `adopt`, `status`.
  `.ssdd/ssdd.lock.json` records the version, commit, adapters, and each
  framework file's source path and sha256. `update` three-way merges every
  framework file, so project edits survive, upstream fixes land, and real
  conflicts get standard markers.
- Review gate v2:
  - stamps per reviewer × per routed file × staged blob pair
  - `--stamp … --files …` for re-review rounds that only cover the files
    that changed
  - a block message naming what each reviewer still owes
  - a `reviewGate.maxRoutedFiles` oversize warning
- Hook stdin works with both Claude Code and Cursor payloads, and the hooks
  always print a JSON permission body.
- Cursor adapter (`adapters/cursor/`).
- Skills: `cleanup` and `docs-drift-audit`, alongside `new-plan`.
- Templates:
  - handover template
  - `## Clarify pass` in the plan template
  - `Execution:` and `## Rulings` in the ledger template
  - BUILT and SUPERSEDED statuses
- Process: ledger rows that claim a fix are verified against the staged
  file; every reviewer is told what input to review; plan numbers are
  checked across branches.
- Zero-dependency test suites: `node --test bin/*.test.mjs mechanisms/hooks/*.test.mjs`.

### Changed
- `inject.sh` is now a shim for `bin/ssdd.mjs install`. Content comes from
  a git tag (the newest by default), not the working tree.
- Skills live in `.agents/skills/`. `.claude/skills/<name>` and
  `.claude/agents/<name>.md` are symlinks, not copies.
- `AGENTS.md` is the canonical instructions file. `CLAUDE.md` is
  `@AGENTS.md` plus Claude-only notes.

### Fixed
- git-guard:
  - `git commit -n` / `-anm` (short `--no-verify`) passed every gate
  - `-c core.hooksPath=…` and `git config core.hooksPath …` could disable
    the hooks
  - global flags (`git -C x add -A`) and bundled short flags (`-vA`)
    bypassed the bulk-add rule
- The example force-push rule blocked `--force-with-lease` (the alternative
  its own message recommends) and missed `-f` and `+refspec`.

### Upgrade notes (from 1.x)
1. A repo injected with the copy-based `inject.sh` has no lock. Run
   `node <ssdd>/bin/ssdd.mjs adopt <repo> --base v1.0.1 --to v2.0.0`, then
   commit, then `update <repo> --to v2.0.0`. Use `--base v1.0.0` if you
   injected before 2026-08-09 12:42. adopt moves v1 `.claude/skills/<name>`
   copies to `.agents/skills/` and swaps identical agent copies for
   symlinks.
2. Expect conflict markers where your project edited the same lines v2
   changed. Expect `<file>.ssdd-new` beside files you added yourself that v2
   now ships (skills, hook tests): keep yours or take ours, then delete the
   sidecar. The pre-commit's untracked-file check blocks commits until you
   do.
3. The stamp file is now version 2, so stamps made before the update read as
   none. Re-stamp once.
4. `.ssdd/config.json` is yours, so `update` prints the template diff instead
   of applying it. Port `reviewGate.maxRoutedFiles`, `gitGuard.blockHooksPath`
   and the corrected force-push rule.
5. Hook tests run with `node --test .ssdd/hooks/*.test.mjs`. Node 21+ needs
   the glob, not a bare directory.
6. Move project instructions into `AGENTS.md` and make `CLAUDE.md` start
   with `@AGENTS.md`.

## [1.0.1] — 2026-08-09
- Adapter docs: note the copy drift between `.ssdd/reviewers/` and
  `.claude/agents/`.

## [1.0.0] — 2026-08-09
- Initial extraction:
  - the process and templates
  - five reviewers
  - review-gate, git-guard and convention-lint
  - claude-code and generic adapters
  - copy-based `inject.sh`
