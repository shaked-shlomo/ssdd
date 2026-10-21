# SDD ledger — plan: docs/superpowers/plans/2026-10-21-v3-trimming.md

Spec: SPEC.md → v3 → Part 5 (docs/specs/v3.md → Part 5 after Task 1). Executor: superpowers:executing-plans (inline). Branch claude/v3-trimming-f3f1f8 (cut from local main at v3.2.1), BASE 0754fec.

Clarify (2026-10-21, before the plan):
- Read-only: prizma's .agents/skills/cleanup/SKILL.md (11,565 B, at f0f2600) and Hatedate's .claude/skills/cleanup/SKILL.md (13,321 B, at 795188aa). Nothing written there.
- /doctor prompt-audit runs headless: `claude -p "/doctor prompt-audit"` in a scratch install of v3.2.1 (claude-code,cursor), Claude Code 2.1.304. Output kept in the session scratchpad (audit-before.out); summary in Clarify 48.
- SessionStart payload: Claude Code's hooks doc (optional `model`), Cursor's hooks doc (`model`, `model_id` on every hook). A throwaway SessionStart hook to log the live payload was refused by this session's permission classifier ("Unauthorized Persistence"); not retried another way.
Baseline: node --test mechanisms/hooks/*.selftest.mjs bin/*.selftest.mjs packs/*/*.selftest.mjs → 1264/1264 at 0754fec.
Pre-flight (shared interfaces):
- T1 bin/repo.selftest.mjs helpers (REPO, read, tracked, slug, links) → T2, T4–T7 add describes: match.
- T3 PARTS / partOf / parseWith / partsFromLock, lock `with` → T7's README text and T8's update check: match.
- T5/T6 budgets → AC44's numbers: match.
- Task 1: the links test passed before the split (it guards the move); a mutation (v2.md's link put back to docs/model-era-review.md) first passed unnoticed because `git ls-files` skipped the new untracked file. Fixed in the test: tracked() includes untracked, non-ignored files; the mutation then fails "docs/specs/v2.md: docs/model-era-review.md — missing". A second mutation (v2.4's index row removed) fails the citation test. 37 citations checked, 23 naming a Part.
- Task 1: one-off check: `git show adb1365:SPEC.md` equals docs/specs/{v1,v2,v2.1…v2.6,v3}.md joined with "\n---\n\n", after undoing the two link rewrites → identical (207,454 chars). Commit A 2058dee is the pure move; `git log --follow docs/specs/v3.md` reaches the first SPEC.md commits.
- Task 1: Ruling: the citations in shipped files (work-state.mjs:20,345,511, plan-migrate.mjs:1, packs/supabase/README.md:6) stay "SPEC.md → v3 → Part N" — they resolve through the index (the citation test checks them), and editing them would touch three managed files in every injected repo for no reader gain — cost if wrong: a reader of those comments takes two steps instead of one.
Task 1: complete (commits adb1365..8d66203, tests: node --test bin/repo.selftest.mjs → ℹ duration_ms 75.9015)
Task 2: complete (commits 8d66203..2a45155, tests: node --test bin/repo.selftest.mjs → ℹ duration_ms 85.660375)
- Task 3: Ruling: the unknown-part message says "(known parts: drift-audit)", not the plan's "(this release has: …)" — parts are defined by the installer, not read from the release tree as packs are — cost if wrong: a message's wording.
- Task 3: Ruling: `--with` with an empty value (or none at all) is an error ("--with needs a part (drift-audit) or none"), checked with `'with' in opt` so a trailing `--with` doesn't read as "not given" — cost if wrong: none found.
- Task 3: Ruling: added pruneEmpty — a removed file's emptied folders go too, up to the top-level one. Without it `.agents/skills/docs-drift-audit/` stayed as an empty folder, so its `.claude/skills` link wasn't dangling and stayed (the "update --with none removes the files and the dangling link" test caught it). It applies to every "removed upstream" file, as a skill dropped by a release left the same empty folder before — cost if wrong: an empty folder a project made itself inside a removed file's path is removed.
- Task 3: the dangling-link prune also covers `.claude/agents/<name>.md` → `../../.ssdd/reviewers/<name>.md`, the same shape linkAll makes; a reviewer removed upstream left that link dangling before.
- Task 3: 9 new cases + the adopt assertions RED (10 fail) → GREEN, bin/ssdd 74/74, suite 1279/1279.
Task 3: complete (commits 2a45155..c54c3ef, tests: node --test bin/ssdd.selftest.mjs → ℹ duration_ms 41008.64575)
- Task 4: "every step it cites exists" first passed on the old skill's dangling "Phase 2" (a `## 2.` heading existed); tightened so "Phase N" needs a `## Phase N` heading, then RED. All three cases RED → GREEN; cleanup SKILL.md 3,468 → 3,218 bytes, description 247 chars (was a folded block).
- Task 4: Ruling: dropped the old skill's small-scope path (≤5 files, check it yourself, tag `direct`) — /code-review takes a path target and decides its own depth, and Decision 4's steps don't include it — cost if wrong: a one-file review runs /code-review's agents instead of a direct read.
- Task 4: Ruling: `/code-review`'s `--fix` isn't passed through — the skill changes nothing until the user approves (Decision 4); `--comment` is — cost if wrong: a user who wants /code-review's own fix pass calls it directly.
Task 4: complete (commits c54c3ef..e949f11, tests: node --test bin/repo.selftest.mjs → ℹ duration_ms 87.737333)
- Task 5: D3 verdicts (bytes v3.2.1 → now; what went):
  - skills/skills-audit/SKILL.md 6,696 → 6,153: the dated "every source audited so far ships rules…" (prompt-audit flag), the lifecycle pointer, step 1's restatement of what the script prints (kept its four gotchas), a redundant `${TMPDIR}` aside (mktemp -d already uses it), a doubled sentence in step 7, "these edits go through the gate" (the gate says so). Pinned strings kept (bin/skills-audit.selftest.mjs "SKILL.md" 3/3).
  - skills/docs-drift-audit/SKILL.md 949 → 788: the folded description is one line; "this skill is the invocation surface…" → "Follow `.ssdd/drift-audit.md`." The domain-list placeholder stays (template text, prompt-audit flag by design).
  - skills/new-reviewer/SKILL.md 2,942 → 2,882: "the new files go through the gate like any other change" (restated). Rest: facts and commands. Kept.
  - skills/migrate-plans/SKILL.md 8,989 → 8,989: rules and formats, written for this model generation in 3.0.0; prompt-audit clean. Kept whole.
  - skills/cleanup/SKILL.md: Task 4. skills/new-plan/SKILL.md: Task 6.
  - reviewers: security 3,308 → 3,303 ("not vibes"); performance 3,180 → 3,046 (the claim that "projects that adopt SSDD keep a thin perf index"). convention-compliance, docs-sync, gate, resilience and the domain template unchanged: checks, formats, verdict lines and one-line incident reasons (D7); prompt-audit called them clean and the incident lines intentional.
  - process/SDD.md 12,105 → 10,998: §0's how-to-brainstorm prose (one line of what's settled), §1's restatement of the spec template, §2's numbering arithmetic (the command does it), §3's restatement of the ledger template and its duplicate of §4's "findings are records", §6's restatement of the plan template's Verification block, §7's list of what prompt-audit finds, the Handover paragraph's restatement of the template, "Where the work is" tightened, principle 1's "report outcomes as they are" (D4: models do it unprompted; D5's sentence kept), "Only then is the ledger section written" (its heading says it). The gate procedure (§4) stays whole: it's the one place it's written (model-era-review → Remove).
  - mechanisms/drift-audit.md 2,887 → 2,866: "no prose padding". Phases and ground rules are procedure facts; kept.
- Task 5: 2 cases RED (docs-drift-audit's folded description; skills-audit 6,696, SDD.md 12,105) → GREEN; suite 1284/1284.
