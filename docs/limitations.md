# Known limitations

**The gate is not a sandbox.** The review gate is git's pre-commit, which
every harness and every human meets at `git commit`; the harness hooks don't
judge commits. git-guard catches what a cooperating agent does by mistake or
habit: `-n`, re-pointing `core.hooksPath`, force push (the example
`extraRules`), with a warning on bulk staging and amend. Neither tries to
catch an agent that hides a command or turns the pre-commit off on purpose.
A new evasion shape is out of scope unless an agent was seen using it in a
real project.

- A config that isn't valid JSON blocks every commit; convention-lint
  reports it at edit time too. Absent still means "not an SSDD repo". The
  working-tree config is the one that applies, so a broken one is fixed in
  place. A removed key doesn't break it: it's ignored, and `status` names it.
- A dormant pre-commit hook means no gate. It's dormant when the pre-commit
  git resolves doesn't run `review-gate.mjs … --pre-commit` on a line that
  isn't a comment: `core.hooksPath` unset (the fresh-clone state) or
  pointing where there's no such hook, or a project hook that never calls the gate.
  `status`, `update` and the session view name it, with the fix. A wrapper (a husky hook that calls
  `.githooks/pre-commit`) reads as dormant: a false warning, never a block.
  `install` / `update` arm it when it's unset; otherwise the user runs
  `git config core.hooksPath .githooks`. git-guard still denies the agent
  any direct write to it. Once set, git ignores `.git/hooks` entirely. The
  setting is shared by every worktree, so it stays relative: an absolute
  path to the main checkout's `.githooks` makes each worktree run that copy
  of the shim (the gate still runs, on the worktree's own `.ssdd/hooks`);
  `status` notes it and `update` rewrites it.
- `GIT_CONFIG_PARAMETERS=… git commit` (or `-c core.hooksPath=…`) can point
  git at another hooks dir for one commit. git-guard can't see every form:
  it reads the command line, not git run from a script *file*, a variable,
  an alias, `xargs` / `find -exec`, another language's subprocess, a shell
  wrapper (`bash -c`, `eval`, `… | sh`, a heredoc fed to a shell), or a
  `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` file. The pre-commit layer
  guards a cooperating agent and is not a sandbox.
- The gate judges the repo and index git commits (git's own cwd), not
  `SSDD_PROJECT_DIR`.
- `--stamp` is an attestation the gate can't verify: not whether the
  reviewers ran, nor on which model.
- A re-stage that changes nothing keeps its stamps, by design.
- The comment-only carry judges source text. It can't see code that reads
  its own comments at run time (`Function.prototype.toString`, source maps,
  a test that greps the file), so editing a comment such code depends on
  carries the stamp.
- The carry covers the JS/TS family only. Anything the scanner can't
  classify (Flow comment types, ASI edge cases after a line break, JSX/TS
  generic ambiguity in `.tsx`) costs a normal review instead.
- The merge rule needs git 2.38 (`merge-tree --write-tree`); older git
  judges every file of a merge. Only a merge of the default branch counts:
  another branch's commits weren't necessarily reviewed.
- Untracked files are a warning at commit.
- Cursor's warnings are best effort. It may not surface `agent_message` on
  an allowed call, so git-guard's bulk-add and amend warnings may not reach
  the agent there.
- **The production guard asks; it isn't a sandbox.** It judges the command
  line, as the git guard does, and in Claude Code runs on every MCP call (the
  settings can't follow which packs are installed); see [the pack's known
  limits](../packs/supabase/README.md#known-limits).
- **Copies, not a live link.** Each repo carries its own editable copy;
  updates arrive only when you run `update`. A release that moves a *target*
  path needs a move entry in `bin/ssdd.mjs`, or `update` sees a removal plus
  an addition.
