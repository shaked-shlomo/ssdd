---
name: migrate-plans
description: Use once per repo, when SSDD v3 is first injected into a repo whose plans predate it, or when the session view says plans are in the old format (checkbox criteria, criteria without AC IDs, Status words like DONE or CLOSED). Not for writing or closing a plan.
---

# Migrate plans to v3

SSDD v3 reads plans: criteria as `- **AC1** — …`, one Verification entry per
ID, a Status from DRAFT, IN PROGRESS, BUILT, SHIPPED, SUPERSEDED, ABANDONED
(`.ssdd/process/SDD.md` §2, §6, §7). Plans written before v3 use other forms.
A script does the mechanical half; this skill is the half that takes reading.
It runs once per repo and lands as one commit.

Folders, from `paths` in `.ssdd/config.json`:
- the plans folder (`paths.plans`, default `.ssdd/plans`)
- the specs folder (`paths.specs`, default `.ssdd/specs`)
- the ledgers folder (`paths.ledgers`, default `.ssdd/ledgers`)

## 1. Start clean

A branch or worktree off the default branch, a clean tree, and the user's
go-ahead. Nothing is committed until step 6.

## 2. The mechanical pass

```bash
node .ssdd/hooks/work-state.mjs --migrate > <scratchpad>/migrate-report.txt
```

It rewrites every plan's criteria (IDs kept, ID-less ones numbered) and
never touches Verification. Keep the report: per plan it lists what changed
and what is left, and it is the only record of which criteria were ticked
`[x]`. A second run won't have it.

## 3. The agent pass, plan by plan

Every plan gets this pass, not only the ones with a `to do:` line: the
report can't see an open plan whose Verification says a criterion is met.
For many plans, fan out: one agent per batch of about six, each given this
section, its plans' report lines and today's date. They share one working
tree, so each writes only its own plans' files, edit by edit: never a copy,
restore or checkout of the folder. Do the References paragraph after them,
in one agent, since it edits other files. Sources are the plan's own text,
and git for Status. Nothing else.

**Status.** A Status already from the six stays. Otherwise find the plan's
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

Write `**Status:** <WORD> — migrated <YYYY-MM-DD>; was: <the old Status text, verbatim>`.

**Entries.** These IDs need one: every ID of a BUILT or SHIPPED plan; in an
open plan, the IDs the report says were ticked and the ones the plan's text
says are met. Each gets exactly one line, in the first shape that fits:

1. The plan has a Verification line for it in another form: re-prefix that
   line, `- **AC3** — <its text, unchanged>`. Only the head changes (list
   marker, checkbox, bold, the ID); a ✅ may stay. When that line says the
   criterion is still open, pending or deferred, the head is
   `- **AC3** — DEFERRED (operator): <its text, unchanged>`.
2. One line or passage covers several IDs (`AC1–AC3`, `AC2/AC3`, "Unit
   criteria (…)"): keep it as it is, and add one line per ID right after it,
   `- **AC2** — see "<its first words>" above.`
3. Prose closes it without its ID: add `- **AC4** — see "<that passage's first words>" above.`
4. The plan says it is still open, pending or deferred:
   `- **AC9** — DEFERRED (operator): <the plan's words for what's left>.`
5. Nothing in the plan closes it:
   `- **AC6** — NOT RECORDED (migrated <YYYY-MM-DD>): the plan's Verification didn't close this.`

When the passage behind shape 2 or 3 closes only part of the criterion (the
unit half, not the live run), the line ends with what it leaves:
`- **AC6** — see "…" above; the live run: NOT RECORDED (migrated <YYYY-MM-DD>).`

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

## 4. Verify, refute-by-default

A second agent, not one that wrote entries, checks every plan (SDD.md §4,
"Findings are records"). For each entry added or re-prefixed, it finds the
passage in `git show HEAD:<plan>` the entry rests on; the entry stands only
when that text demonstrably supports it. A NOT RECORDED entry stands only
when no passage closes the criterion; a Status only when the git evidence
supports it. Fix what it refutes, then re-check those fixes.

## 5. The mechanical check

```bash
node .ssdd/hooks/work-state.mjs --migrate-check HEAD
```

It must end `migrate-check: ok`: every removed line's text survives,
every Status is one of the six, every ID that needs an entry has one, and no
criteria are left in the old format. Its `not recorded:` lines list every
NOT RECORDED entry.

## 6. One commit

Stage each changed file by path. The message says how many plans changed
and lists every NOT RECORDED entry from step 5 as `<plan file>: AC6, AC9`.

## 7. Confirm

`node .ssdd/hooks/work-state.mjs` shows no "plans in the old format" line and
no "status outside the six" line.

## Common mistakes

| Mistake | Instead |
|---|---|
| Mapping today's test names onto criteria | point at the plan's record (shape 2 or 3), else NOT RECORDED |
| A pointer to a passage that closes half the criterion | name the other half NOT RECORDED on the same line |
| Adding notes, later findings, reconciled counts | entries only: the plan is a record of then |
| A Status the evidence doesn't support | the least-done word, the old text after "was:" |
| Rewording or deleting an old line | re-prefix the head, add lines |
| Not saving the first report | the ticked IDs exist only there |
