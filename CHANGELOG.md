# Changelog

Versions follow semver, adapted to a framework that lives inside other repos:

- **MAJOR**: needs manual steps in an injected repo, such as a layout move, a
  stamp-file or config contract change, or a renamed hook.
- **MINOR**: new reviewers, skills, or features that update cleanly.
- **PATCH**: fixes and wording.

`bin/ssdd.mjs update` prints every entry between a repo's locked version and
the target, so upgrade steps belong here and not only in commit messages.

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
