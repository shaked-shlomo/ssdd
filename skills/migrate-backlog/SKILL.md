---
name: migrate-backlog
description: Use once per repo, when install or update says "not seeded BACKLOG.md" because the repo keeps its backlog under another name (TODO, ROADMAP, a requirements or checklist file). Moves it to BACKLOG.md and points every mention there. Not for editing the backlog.
disable-model-invocation: true
---

# Migrate a backlog to `BACKLOG.md`

SSDD keeps a repo's remaining work, deferred review findings included, in
one file at the root: `BACKLOG.md` (`.ssdd/process/SDD.md` §3, §7; template
`.ssdd/process/templates/backlog-template.md`). This moves a backlog kept
under another name there once, like `/migrate-plans`, and lands as one
commit. Nothing is written until the user approves the report.

## 1. Start clean

A branch or worktree off the default branch, a clean tree, the user's
go-ahead, and `.ssdd/ssdd.lock.json` at 3.6.0 or later. Without that lock,
run `update` (or `install`) first: SSDD's own text must already say
`BACKLOG.md`, since this skill leaves managed files as installed alone.

## 2. The file

The candidates are what `install`/`update` named: `.md` files at the root or
directly in `docs/` whose name, ignoring case, is `backlog`, `todo` or
`roadmap`, or starts with `requirements`, or ends with `requirements` or
`checklist` (`REQUIREMENTS_BEFORE_PRODUCTION.md`, `pre-launch-requirements.md`). With more
than one, the user says which is the backlog; the others stay as they are.

## 3. The report (nothing is written yet)

Show the user, and wait for approval:
- **The rename:** `<old path>` → `BACKLOG.md`. No stub stays at the old path.
- **The outline, before → after.** The H1 becomes `# Backlog`; the old
  intro paragraphs stay under it. The
  template's sections are Now, Next, Later, Deferred review findings, Done.
  Each top-level section of the old file goes under the template section it
  belongs to, its own heading kept word for word, one heading level down; one
  that belongs to none stays as it is. A heading equal to a template heading
  is that section. A section of deferred review findings moves under
  Deferred review findings. Template sections with no counterpart are added
  empty. GitHub's anchor is a heading's text, not its level, so no anchor
  changes.
- **Rows moved** under Deferred review findings, with a count. They keep
  their words; the template's one-line row form is for new rows.
- **Done** keeps its history word for word (owner, 2026-10-30).
- **Mentions**, grouped, with a count per group: instructions (`AGENTS.md`,
  `CLAUDE.md`, Cursor rules), reviewers, skills, plans, ledgers, specs, other
  docs, code comments (migrations included: a comment changes nothing that
  runs). Find them with `git grep -n -F <old file name>`. The old file's
  mentions of itself are rewritten too, counted on their own line.
- **Short names**, each with its count and its replacement: names that
  aren't the path ("REQUIREMENTS §3B", "the pre-launch doc", "the
  requirements file"). Find them by grepping the old file name's
  distinctive words. A section label the file keeps (`§3B`) stays; only the
  file's name changes ("BACKLOG §3B"). The user approves each short name;
  none is rewritten unasked.
- **Managed files** (the lock's `managed` list), for mentions and short names
  alike. A file as installed (its sha256 is the lock's) is SSDD's text: skip
  it. A file the project edited may hold the project's own line, such as the
  drift audit's domain list: list each such line, for the user to approve one
  by one. A line SSDD's copy has too (`git -C <SSDD checkout> show <lock
  commit>:<src>`) stays; without a checkout, say so on the listed line.

## 4. Apply

`git mv <old> BACKLOG.md`, then restructure as the outline says. Rewrite
every listed mention and each approved short name, and only those: never in
a managed file as installed, never a managed line the user didn't approve. A markdown link gets the
relative path from its own file to `BACKLOG.md`; a relative link inside the
moved file is rewritten relative to the root. Change nothing else.

## 5. Check

Before the commit, every line of the old file, heading marks stripped,
survives; this prints only the old H1 and the lines step 4 rewrote inside
the file (a mention, a link). Check each of those by eye:

```bash
diff <(git show HEAD:<old> | sed -E 's/^#+ //' | sort) <(sed -E 's/^#+ //' BACKLOG.md | sort) | grep '^<'
```

Then `git grep -n -F <old file name>` and each approved short name print
only the managed-file lines that rule left, and every relative link to or in
`BACKLOG.md` resolves.

## 6. One commit

Stage each changed file by path. Every staged file goes through the review
gate as routed, code comments included (their diff is comment-only). The message gives the rename and the
counts per group. After it, `git show --stat -M HEAD` shows the rename.

## Common mistakes

| Mistake | Instead |
|---|---|
| Rewriting a managed file as installed | skip it; `update` owns it |
| Folding a long row into one line | move it with its words |
| Renaming a project heading to the template's | nest it, heading kept |
| Rewriting a short name the user didn't approve | list it; they choose |
| Leaving a stub at the old path | nothing names it any more |
