# Changelog

Versions follow semver, adapted to a framework that lives inside other repos:

- **MAJOR**: needs manual steps in an injected repo, such as a layout move, a
  stamp-file or config contract change, or a renamed hook.
- **MINOR**: new reviewers, skills, or features that update cleanly.
- **PATCH**: fixes and wording.

`bin/ssdd.mjs update` prints every entry between a repo's locked version and
the target, so upgrade steps belong here and not only in commit messages.

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
