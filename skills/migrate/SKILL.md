---
name: migrate
description: Use once per repo, when SSDD v3 is first injected into a repo that predates it - the session view says plans are in the old format, or install or update says "not seeded BACKLOG.md". Brings plans to v3's format, then moves the backlog to BACKLOG.md. Not for writing a plan or editing the backlog.
disable-model-invocation: true
---

# Migrate a repo to SSDD v3

Two halves, in this order, on one branch. Skip a half with nothing to do.

1. **Plans** (§2), when `node .ssdd/hooks/work-state.mjs` lists plans in the
   old format: checkbox criteria, criteria without AC IDs, Status words like
   DONE or CLOSED.
2. **The backlog** (§3), when `install` or `update` said `not seeded
   BACKLOG.md` because the repo keeps its backlog under another name (TODO,
   ROADMAP, a requirements or checklist file).

Each half lands as its own commit, plans first. Both checks compare against
`HEAD`, and the backlog half rewrites mentions inside plans, so one commit
would hide one half's changes from the other's check. The pre-commit also
refuses a staged plan that fails its close check, which an old-format plan
does.

Folders, from `paths` in `.ssdd/config.json`:
- the plans folder (`paths.plans`, default `.ssdd/plans`)
- the specs folder (`paths.specs`, default `.ssdd/specs`)
- the ledgers folder (`paths.ledgers`, default `.ssdd/ledgers`)

## 1. Start clean

A branch or worktree off the default branch, a clean tree, the user's
go-ahead, and `.ssdd/ssdd.lock.json` at 3.7.0 or later. Without that lock,
run `update` (or `install`) first: SSDD's own text must already say
`BACKLOG.md`, since §3 leaves managed files as installed alone. Nothing is
committed until §2.5 and §3.5.

## 2. Plans

SSDD v3 reads plans: criteria as `- **AC1** — …`, one Verification entry per
ID, a Status from DRAFT, IN PROGRESS, BUILT, SHIPPED, SUPERSEDED, ABANDONED
(`.ssdd/process/SDD.md` §2, §6, §7). Plans written before v3 use other forms.
A script does the mechanical half; this half is the one that takes reading.

### 2.1 The mechanical pass

```bash
node .ssdd/hooks/work-state.mjs --migrate > <scratchpad>/migrate-report.txt
```

It rewrites every plan's criteria (IDs kept, ID-less ones numbered) and
never touches Verification. Keep the report: per plan it lists what changed
and what is left, and it is the only record of which criteria were ticked
`[x]`. A second run won't have it.

### 2.2 The agent pass, plan by plan

Every plan gets this pass, not only the ones with a `to do:` line: the
report can't see an open plan whose Verification says a criterion is met.
For many plans, fan out: one agent per batch of about six, each given this
section, its plans' report lines and today's date. They share one working
tree, so each writes only its own plans' files, edit by edit: never a copy,
restore or checkout of the folder. Do the References paragraph after them,
in one agent, since it edits other files. Sources are the plan's own text,
and git for Status. Nothing else.

**Status.** A Status already from the six stays, in whatever form the plan
writes it, even one git contradicts: the view flags an IN PROGRESS nothing
is working on, and changing it is the owner's call. The view reads only a
`**Status:**` line, so a status written another way (a `## Status:` heading,
a `STATUS (date): SHIPPED` paragraph) gets that line added beside it, with
the same word, and the original stays. Otherwise find the plan's
merge in git (`git log --oneline <default> -- <plan>`, the commits and PRs
the plan names, `git branch -a --contains <sha>`) and pick the least-done
word the evidence supports:

| Evidence | Word |
|---|---|
| merged into the default branch | SHIPPED |
| merged, with steps the plan says are still pending | BUILT |
| not merged, still being worked | IN PROGRESS |
| replaced by another plan | SUPERSEDED |
| dropped | ABANDONED |

Write `**Status:** <WORD> — migrated <YYYY-MM-DD>; was: <the old Status text, verbatim>`,
or `was: (no Status line)` when the plan had none.

**A plan with no criteria** (no `## Acceptance criteria` section, or one
with no items), once its Status is set:
- **Closed** (SHIPPED, SUPERSEDED, ABANDONED): its Status only.
- **Open** (DRAFT, IN PROGRESS, BUILT): if the plan has its own checklist of
  what done means (a Verification list, "Verify Phase N" items, a
  gauntlet), copy that checklist's items (one split across phases is still
  one list), in plan order and word for word, into a new `## Acceptance
  criteria` section just before its `## Verification` (else at the end), as
  `- **AC1** — <the item's text>`. When no `## Verification` comes after the
  passages the entries will cite, add one at the end to hold them. The
  original list stays where it is. Then give entries as below.
- **No such checklist:** leave it.

Never write criteria of your own: no merged lists, reworded items or added
ones. List every plan with no criteria for the user, saying which got a
copied checklist.

**Entries.** These IDs need one: every ID of a BUILT or SHIPPED plan; in an
open plan, the IDs the report says were ticked and the ones the plan's text
says are met. Each gets exactly one line, in the first shape that fits:

1. The plan has a Verification line for it in another form: re-prefix that
   line, `- **AC3** — <its text, unchanged>`. Only the head changes (list
   marker, checkbox, bold, the ID); a ✅ may stay. A `### AC3 …` heading
   stays a heading; add `- **AC3** — see "AC3 …" above.` under its section.
2. One line or passage covers several IDs (`AC1–AC3`, `AC2/AC3`, "Unit
   criteria (…)"): keep it as it is, and add one line per ID right after it,
   `- **AC2** — see "<its first words>" above.`
3. Prose closes it without its ID: add `- **AC4** — see "<that passage's first words>" above.`
4. The plan says it is still open, pending or deferred:
   `- **AC9** — DEFERRED (operator): <the plan's words for what's left>.`
5. Nothing in the plan closes it:
   `- **AC6** — NOT RECORDED (migrated <YYYY-MM-DD>): the plan's Verification didn't close this.`

What counts as a record: a passage that says the item's check ran (its
output, "verified", "passes"). A ✅ or "complete" on a phase or section
heading records the build, not the check, and a summary line ("all
features work", "verification COMPLETE") closes no single item. A DEFERRED
may rest on the plan's list of unfinished work when the criterion plainly
depends on an item in it; quote that list.

A line that says the criterion isn't met (still open, pending, deferred,
failed, superseded) is no verification: its head is
`- **AC3** — DEFERRED (<what it waits on: operator, plan 43>): <its text, unchanged>`.
That holds for entries that already read as `- **AC3** …`, so check those too.

When the passage behind shape 2 or 3 closes only part of the criterion (the
unit half, not the live run), the line ends with what it leaves:
`- **AC6** — see "…" above; the live run: NOT RECORDED (migrated <YYYY-MM-DD>).`
When the plan says why the rest isn't done, that tail is
`; <the rest>: DEFERRED (<what it waits on>): <the plan's words>` instead.

Every entry rests on the plan's text. The code, its tests, other plans, the
docs and the repo as it is today are not a record of what was verified then:
an entry built from them is invented evidence, even when it is true today.
Entries are the only additions: no notes, later findings or reconciled
numbers. Never move or delete a line.

**References.** For a plan whose report says "criteria were unnumbered",
find references to its criteria by position in the rest of the repo's
markdown (other plans, ledgers in the ledgers folder and
`.superpowers/sdd/`, specs in the specs folder, handovers), for example
`git grep -n -i -E 'criteri(on|a) [0-9]|check [0-9]' -- '*.md'`, and
the plan's number near them. Add the ID beside each, "criterion 3 (AC3)";
change nothing else. Commit messages and memory outside the repo are out of
reach.

### 2.3 Verify, refute-by-default

A second agent, not one that wrote entries, checks every plan (SDD.md §4,
"Findings are records"). For each entry added or re-prefixed, it finds the
passage in `git show HEAD:<plan>` the entry rests on; the entry stands only
when that text demonstrably supports it. A NOT RECORDED entry stands only
when no passage closes the criterion; a Status only when the git evidence
supports it. Fix what it refutes, then re-check those fixes.

### 2.4 The mechanical check

```bash
node .ssdd/hooks/work-state.mjs --migrate-check HEAD
```

It must end `migrate-check: ok`: every removed line's text survives,
every Status is one of the six, every ID that needs an entry has one, and no
criteria are left in the old format. Its `not recorded:` lines list every
NOT RECORDED entry.

### 2.5 One commit

Stage each changed file by path. The message says how many plans changed and lists every NOT RECORDED entry
from §2.4 as `<plan file>: AC6, AC9`.

## 3. The backlog

SSDD keeps a repo's remaining work, deferred review findings included, in
one file at the root: `BACKLOG.md` (`.ssdd/process/SDD.md` §3, §7; template
`.ssdd/process/templates/backlog-template.md`). This half moves a backlog
kept under another name there. Nothing is written until the user approves
the report.

### 3.1 The file

The candidates are what `install`/`update` named: `.md` files at the root or
directly in `docs/` whose name, ignoring case, is `backlog`, `todo` or
`roadmap`, or starts with `requirements`, or ends with `requirements` or
`checklist` (`REQUIREMENTS_BEFORE_PRODUCTION.md`,
`pre-launch-requirements.md`). With more than one, the user says which is the
backlog; the others stay as they are. If none is, copy the template to
`BACKLOG.md` and stop: `update` no longer names them.

### 3.2 The report (nothing is written yet)

Show the user, and wait for approval:
- **The rename:** `<old path>` → `BACKLOG.md`. No stub stays at the old path.
- **The outline, before → after.** The H1 becomes `# Backlog`; the old
  intro paragraphs stay under it. The
  template's sections are Now, Next, Later, Deferred review findings, Done.
  Each top-level section of the old file goes under the template section it
  belongs to, its own heading kept word for word, one heading level down; one
  that belongs to none stays as it is. A heading equal to a template heading
  is that section. A section of deferred review findings moves under
  Deferred review findings, which carries the template's comment. Template sections with no counterpart are
  added empty. GitHub's anchor is a heading's text, not its level, so no anchor
  changes.
- **Rows moved** under Deferred review findings, with a count. They keep
  their words; the template's one-line row form is for new rows.
- **Done** keeps its history word for word (owner, 2026-10-30).
- **Mentions**, grouped, with a count per group: instructions (`AGENTS.md`,
  `CLAUDE.md`, Cursor rules), reviewers, skills, plans, ledgers, specs, other
  docs, code comments (migrations included: a comment changes nothing that
  runs), code and config (a CI path, a script that reads the file, a route
  in `.ssdd/config.json`: flag each, it may change behaviour). Find them with
  `git grep -n -F <old file name>`, plus its `%20` form for a name with
  spaces and its stem for a regex route. When the old file is already named
  `BACKLOG.md`, in `docs/`, grep its path and the links beside it instead,
  here and in §3.4. Relative links inside the moved file get
  a line of their own. The old file's
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

### 3.3 Apply

`git mv <old> BACKLOG.md`, then restructure as the outline says. Rewrite
every listed mention and each approved short name, and only those: never in
a managed file as installed, never a managed line the user didn't approve. A markdown link gets the
relative path from its own file to `BACKLOG.md`; a relative link inside the
moved file is rewritten relative to the root. Change nothing else.

### 3.4 Check

Before the commit, every line of the old file, heading marks stripped,
survives; this prints only the old H1 and the lines §3.3 rewrote inside
the file (a mention, a link). Check each of those by eye:

```bash
diff <(git show "HEAD:<old>" | sed -E 's/^#+ //' | sort) <(sed -E 's/^#+ //' BACKLOG.md | sort) | grep '^<'
```

Then `git grep -n -F <old file name>`, its stem and each approved short name
print only the managed-file lines that rule left, and every relative link to or in
`BACKLOG.md` resolves.

### 3.5 One commit

Stage each changed file by path. Every staged file goes through the review
gate as routed, code comments included (their diff is comment-only). The message gives the rename and the
counts per group. After it, `git show --stat -M HEAD` shows the rename (a
small file may need `-M30%`).

## 4. Confirm

The view reads the default branch, so it changes once the branch merges.
Then `node .ssdd/hooks/work-state.mjs` shows no "plans in the old format"
line and no "status outside the six" line. An IN PROGRESS that git shows
merged is flagged there; tell the user, since its Status is theirs to
change.

## Common mistakes

| Mistake | Instead |
|---|---|
| Both halves in one commit | plans first, each half its own commit |
| Mapping today's test names onto criteria | point at the plan's record (shape 2 or 3), else NOT RECORDED |
| A pointer to a passage that closes half the criterion | name the other half NOT RECORDED on the same line |
| A failed or superseded criterion left as a plain entry | the DEFERRED head: the view counts a plain entry as verified |
| Adding notes, later findings, reconciled counts | entries only: the plan is a record of then |
| A Status the evidence doesn't support | the least-done word, the old text after "was:" |
| Rewording or deleting an old plan line | re-prefix the head, add lines |
| Not saving the first report | the ticked IDs exist only there |
| Rewriting a managed file as installed | skip it; `update` owns it |
| Folding a long backlog row into one line | move it with its words |
| Renaming a project heading to the template's | nest it, heading kept |
| Rewriting a short name the user didn't approve | list it; they choose |
| Leaving a stub at the old path | nothing names it any more |
