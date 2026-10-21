---
name: new-reviewer
description: Proposes project-specific SSDD review lenses from the stack, uncovered code and bug classes that recur in the ledgers, then scaffolds an approved one with its route and symlink. Use for "add a reviewer", "what reviewers do we need", or after a bug class repeats.
---

# New reviewer

A lens earns its place when a class of bug keeps recurring that the general
reviewers don't catch. This skill finds candidates and proposes them; it
creates nothing until the user picks one.

## 1. Gather (read-only)

- **Stack:** manifests (`package.json`, `app.json`, `pyproject.toml`, …) and
  the top-level layout.
- **Coverage:** `node .agents/skills/new-reviewer/coverage.mjs` lists tracked
  files that route to no reviewer, by directory. Unrouted code is a lead, not
  a verdict: docs and fixtures are often fine unrouted.
- **History:** the ledgers' fixed Important/Critical findings and Follow-ups,
  the requirements checklist, README limitations. Group them by defect class.
  A class that shows up across two or more plans is a candidate.
- **Existing lenses:** `.ssdd/reviewers/*.md`, so a candidate doesn't
  overlap one. Also any best-practices skill in `.agents/skills/` or in
  `.ssdd/skills.json`; the performance reviewer already cites those. A
  class an upstream skill already covers may only need `/skills-audit`.

## 2. Propose, then stop

One row per candidate: the lens, the bug class with its evidence (ledger rows,
file:line), the paths it would route (`coverage.mjs '<regex>'` shows what a
regex matches), the neighboring lanes, and whether it's mechanical (worth
`effort: medium`) or judgment-heavy.

When a class is narrow enough for a regex, say a lint rule in
`.ssdd/config.json` → `lint` would catch it deterministically. When it's one
missing check, say adding it to an existing reviewer is cheaper than a new
lens. Ask which to create.

## 3. Scaffold the approved lens

1. Copy `.ssdd/reviewers/domain-reviewer-template.md` to
   `.ssdd/reviewers/<name>-reviewer.md` and fill it in:
   - `name`
   - a third-person description under 300 chars, with no `": "` inside it
     (plain YAML) and no route list
   - `effort: medium` if the lens is mechanical; no `model:` (the harness and
     session choose it; a project that wants a floor sets
     `reviewGate.reviewerModels`)
   - the lens, its boundary with neighbors, and checks that each trace to
     a real bug in a one-line example
2. Add the route to `.ssdd/config.json` with a `$comment` saying why: the
   class and its evidence. Confirm its match count with `coverage.mjs`.
3. Claude Code: `ln -s ../../.ssdd/reviewers/<name>-reviewer.md .claude/agents/<name>-reviewer.md`.
   Cursor needs nothing; the Task tool uses the name.
4. Tell the user: once the route is staged, the gate requires this reviewer
   on those paths, starting with the commit that adds it.
