# Known limitations

**The gate is not a sandbox.** The harness hooks catch what a cooperating
agent does by mistake or habit: bulk staging, `-n`, amend, force push,
re-pointing `core.hooksPath`, committing content the gate can't see,
committing to the wrong repo, a broken config. They don't try to catch an
agent that hides a command from them; the git pre-commit layer is the
backstop for what they can't see. A new evasion shape is out of scope unless
an agent was seen using it in a real project.

- A config that isn't valid JSON blocks in both layers; convention-lint
  reports it too. Absent still means "not an SSDD repo". The working-tree
  config is the one that applies, so a broken one is fixed in place.
- A dormant pre-commit hook (`core.hooksPath` not `.githooks`, the fresh-clone
  state) is named by `status` and by the harness gate on every commit.
  `install` / `update` arm it when it's unset; otherwise the user runs
  `git config core.hooksPath .githooks`. git-guard still denies the agent
  any direct write to it. Once set, git ignores `.git/hooks` entirely. The
  setting is shared by every worktree, so it stays relative: an absolute
  path to the main checkout's `.githooks` makes each worktree run that copy
  of the shim (the gate still runs, on the worktree's own `.ssdd/hooks`);
  `status` notes it and `update` rewrites it.
- In Claude Code the review gate runs only on commands that start with `git`
  (`"if": "Bash(git *)"`). `/usr/bin/git`, `env …` / `sudo …` runners and
  shell wrappers (`bash -c`, `eval`, `… | sh`, a heredoc fed to a shell)
  reach only the pre-commit layer. git-guard doesn't unwrap shell wrappers
  either. Cursor's hook has no such filter.
- The pre-commit layer judges git's own cwd, not `SSDD_PROJECT_DIR`; the
  harness layer starts from the tool call's cwd.
- A re-stage that changes nothing keeps its stamps, by design.
- The merge rule needs git 2.38 (`merge-tree --write-tree`); older git
  judges every file of a merge. Only a merge of the default branch counts:
  another branch's commits weren't necessarily reviewed.
- Untracked files are a warning at commit; `preCommit.blockUntracked: true`
  makes them a block.
- The harness gate judges the repo a commit targets (`cd`, `git -C`,
  worktrees), failing closed on `$VAR` / `$(…)` / `pushd`. In an SSDD repo it
  refuses commits whose content it can't see (`git add … && git commit`,
  `commit -a/-i/-o`, `commit <pathspec>`). A chained `git add` of existing
  files no reviewer is routed to is allowed, unless another git command
  that can change the index runs before the commit. A repo without
  `.ssdd/config.json` isn't gated at all. It can't see git run from a script *file*, a
  variable, an alias, `xargs` / `find -exec`, another language's subprocess,
  or a `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` file that sets
  `core.hooksPath`. For those the pre-commit layer is the backstop, while
  `-n` isn't used.
- In Claude Code, `reviewGate.stamping: "hooks"` makes attestation
  mechanical: a reviewer subagent's completion stamps its files, and the
  agent can't run `--stamp` or write stamp files. In `manual` mode (the
  default, and the only mode in Cursor) `--stamp` is an attestation the gate
  can't verify, including which model ran the review.
- **The production guard asks; it isn't a sandbox.** It judges the command
  line, so a script *file*, a variable holding a command, or a key used from
  code goes unseen, as for git. A call already sent can't be stopped: an Esc
  on an MCP call in flight doesn't undo it on the server. A read without
  `READ ONLY` can write through a view or policy that calls a writing
  function; `db-read` closes that. Cursor's hooks ignore `ask`, so in Cursor
  the guard denies and the owner runs the command in their own terminal. In
  Claude Code it runs on every MCP call (the settings can't follow which
  packs are installed). Details in the [pack's README](../packs/supabase/README.md).
- **Copies, not a live link.** Each repo carries its own editable copy;
  updates arrive only when you run `update`. A release that moves a *target*
  path needs a move entry in `bin/ssdd.mjs`, or `update` sees a removal plus
  an addition.
