# SSDD for Claude 5-generation models — review and proposal

**Date:** 2026-10-05 · **Status:** partly applied. **v2.2.0** applied the
framework-side Remove/Change/Add rows: shorter descriptions, the gate
procedure in one place, merged evidence principle, `effort:` frontmatter,
"reviews at the gate" line, prompt audit and the new-model checklist.
Mechanical stamping via `SubagentStop` shipped in **v2.3.0** (models: v2.3.1). The
project-side rows (the first injected project's AGENTS.md trim, design-sync
→ skill, Superpowers) belong in a plan in that project.
**Baseline:** SSDD v2 = the framework as it runs in its first injected project,
which works well. The goal is to keep what works and cut what newer models no
longer need — not a rewrite.

## Summary

Anthropic's current guidance comes down to one shift: **less prose telling
the model how to behave, more mechanism and well-shaped context.** For SSDD
that means:

- **Keep the parts that already fit.** Hooks, the review gate, config-driven
  routing, acceptance criteria written first, verification against real output,
  the ledger, the handover, and the verified-ledger pattern are all mechanisms
  or state artifacts. The docs recommend exactly these.
- **Cut the prose layer.** It is long, it repeats itself across 4–5 files, it
  carries incident history in always-loaded context, and it has a few
  instructions the docs now say cause overtriggering or over-verification.
- **Add a few new Claude Code mechanisms** that replace honor-system prose
  with enforcement. The biggest is mechanical review stamping.

Expected payoff: a smaller always-loaded context, fewer redundant review and
verification rounds, and a gate that doesn't rely on the agent attesting
honestly. Exact token savings aren't measured yet; step 1 below measures them.

## What the docs say (verified 2026-10-05)

| # | Guidance | Source |
|---|---|---|
| D1 | Anthropic removed "over 80% of Claude Code's system prompt" for Opus 5 / Fable 5 with "no measurable loss"; it had been "overconstraining Claude Code … in our CLAUDE.md files and skills." | [Context-engineering rules for Claude 5](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models) |
| D2 | CLAUDE.md: "lightweight … spend most of the tokens on gotchas". Target under 200 lines. Imports don't reduce context cost. | Same post; [Memory docs](https://code.claude.com/docs/en/memory) |
| D3 | Skills built for prior models "are often too prescriptive … and can degrade output quality". Review them, and consider removing older instructions. | [Prompting Fable 5 → scaffolding](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5#recommended-scaffolding-changes) |
| D4 | Opus 5 verifies its own work without being asked. Remove carried-over verification instructions ("use a subagent to verify"): they cause over-verification at no gain. The same goes for "double-check" style re-check instructions. | [Prompting Opus 5 → over-verification](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5#task-scope-and-over-verification) |
| D5 | Fresh-context verifier subagents outperform self-critique. "Ground progress claims": audit each claim against a tool result from the session. | Fable 5 guide (scaffolding; progress claims) |
| D6 | Replace "CRITICAL: You MUST…" with plain "Use X when…". Over-prompting causes overtriggering. | [Prompting best practices → tool usage](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) |
| D7 | Give the reason, not only the request: context about intent improves results. | Fable 5 guide; best practices ("Add context") |
| D8 | At high effort, models may start their own review rounds with reviewer subagents. One instruction ("don't launch reviewer sub-agents unless asked…") cut cost about a third with no quality change. | [Prompting Sonnet 5.5 → initiative](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5#steer-initiative-and-scope) |
| D9 | For reviews, accuracy holds at lower effort. Don't tell reviewers "only report high-severity"; they will follow it literally. Report everything and filter later. | Opus 5 guide (capabilities) |
| D10 | `/doctor prompt-audit` (Claude Code ≥ 2.1.283) audits CLAUDE.md/AGENTS.md, rules, skills and subagents for "instructions written for older models" and conflicts, and proposes edits. | Memory docs → audit |
| D11 | Claude Code reads `AGENTS.md` natively (≥ 2.1.277) when there is no CLAUDE.md. A CLAUDE.md with `@AGENTS.md` never double-loads it. | Memory docs → AGENTS.md |
| D12 | Subagent frontmatter: `model`, `effort`, `disallowedTools`, `skills`, `memory`, `maxTurns`, `omitClaudeMd`, `isolation`, `background`, `color`. Descriptions should be brief; all of them combined must stay under 15k tokens. | [Subagents](https://code.claude.com/docs/en/sub-agents) |
| D13 | Hooks: a `SubagentStop` input carries `agent_type`. The `if` field (e.g. `"Bash(git commit*)"`) filters before a hook runs. `PreToolUse` JSON accepts `permissionDecision`/`permissionDecisionReason`, and unknown fields are ignored. | [Hooks](https://code.claude.com/docs/en/hooks) |
| D14 | Skill frontmatter: `paths` (activate only for matching files), `effort`, `model`, `context: fork`, `disable-model-invocation`, `allowed-tools`. A skill folder may be a symlink. The body stays in context after it's invoked, so every line is a recurring cost. Keep it under 500 lines. | [Skills](https://code.claude.com/docs/en/skills); [Skill best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) |

## Keep: already aligned

| SSDD piece | Why it fits newer models |
|---|---|
| Hooks + git pre-commit gate | Deterministic enforcement is the recommended home for "must" rules; instructions are only context (D2, D13). |
| Acceptance criteria → Verification with pasted output | This is a spec plus a state artifact, not a "double-check" nag. It is the `tests.json` + progress-file pattern from the long-horizon guidance, and the evidence rule from D5. |
| Ledger, handover, numbered plans | Durable state for multi-session work: "Use git for state tracking", structured progress notes, and starting fresh from files rather than compaction. |
| Verified ledger rows (a different agent, refute-by-default) | The fresh-context writer→verifier pattern D5 recommends. |
| Reviewers that don't filter by severity | Already true (no "only report high-severity" phrasing found). Keep it that way (D9). |
| Per-file stamps, oversize warning | Mechanism, not prose. Unaffected by model changes. |

## Remove

| What | Where (first injected project) | Why |
|---|---|---|
| **Incident history in always-loaded text.** For example, the bias-semantics reviewer's 786-character `description` lists its routed paths "as of" two dates. | reviewer descriptions, AGENTS.md, SDD.md §4 | Descriptions are always in context (D12, D14), and the path list duplicates `.ssdd/config.json` and goes stale. Keep a one-line *why* (D7). The story belongs in the ledger or the config `$comment`, which no model loads. |
| **Maintenance trivia in AGENTS.md**: how `skills-lock.json` hashes are computed, what isn't vendored and why. | AGENTS.md → Skills | It doesn't change what the agent does on a normal task. Move it to `docs/`, since AGENTS.md is "lightweight … gotchas" (D2). |
| **"Red flags — you are about to skip something" tables** and similar pre-emptive rebuttals. | `cleanup` skill | This is the anti-undertriggering style D6 says now overtriggers. The phase structure already carries the ordering. |
| **Generic verify/re-check nags** that duplicate the Verification artifact: "never assume — verify first", "say done only after…". | SDD principles 1–3 and their copies in AGENTS.md | Opus 5 does this unprompted, and carried-over instructions cause over-verification (D4). Keep *one* sentence in the Fable-5 "ground progress claims" form (D5). **Keep** the steps where the orchestrator verifies *subagent* findings (drift-audit Phase 2, cleanup's check of each SSDD reviewer's finding against its file since v3 Part 5, verified ledger rows): that is the fresh-context writer→verifier pattern D5 recommends, not a self-recheck. |
| **Restating the review-gate procedure in 4–5 places**: SDD.md §4, AGENTS.md, `.cursor/rules/ssdd.mdc`, cleanup Phase 5, and the hook's block message. | — | The block message is already a just-in-time instruction at the moment it matters. Keep the full procedure in SDD.md and the block message, with a 2-line pointer elsewhere. Repetition is what D1's cut targeted. |

## Change

| What | Proposal | Evidence |
|---|---|---|
| **AGENTS.md shape** | Aim for about 80–120 lines: what the repo is, `npm run check`, a pointer to SDD.md, the Documentation Map, and the project's gotchas. Move the Design-sync rule (≈40 lines, relevant only to UI diffs) into a `design-sync` skill with `paths:` on UI globs, which Cursor also discovers via `.agents/skills/`. Collapse the skills routing table to one precedence line. | D2, D14 |
| **Reviewer frontmatter** | Add `effort:` (and optionally `model:`) per lens. Mechanical lenses (docs-sync, convention) run at `medium`. Judgment lenses (security, domain/bias) inherit. A gated commit dispatches 3–6 reviewers, so this is the largest per-commit cost lever. Keep `tools: Read, Grep, Glob, Bash`. | D9, D12 |
| **Reviewer bodies** | Keep the checks; trim the "motivating history" paragraphs to one line each. Leave the "every check shipped as a real bug" character in the check list itself. | D3, D7 |
| **SDD.md principles** | Merge 1–3 into one evidence rule (D5's wording). Keep 4–6 as they are: they're about *what* to do (class coverage, failure owners, budgets), not nagging. | D4, D5 |
| **Clarify pass checklist** | Keep it, but frame it as "the kinds of assumptions that bit before" rather than an exhaustive enumeration. Fable 5 follows a brief instruction without needing every case named. | D3, Fable 5 "strong instruction following" |
| **Superpowers plugin** (enabled project-wide) | Decide deliberately. Its `using-superpowers` session hook injects "EXTREMELY_IMPORTANT … ABSOLUTELY MUST" text every session, and SSDD already owns brainstorm → plan → verify. AGENTS.md currently has to outrank it in words. Try a plan with it disabled and compare. | D6, D1 |
| **Review-gate hook registration** | Done in v2.6: `"if": "Bash(git *)"` on the review gate's PreToolUse(Bash) entry only. `Bash(git commit*)` was rejected because it skips `git -C <worktree> commit`; `Bash(git *)` skips only `/usr/bin/git`, `env` / `sudo` runners and shell wrappers, which reach the pre-commit layer. The first withdrawal (after v2.1.1) no longer applies since v2.6 stops unwrapping wrappers. See `SPEC.md` v2.6 Clarify 9. | D13 |

## Add

| What | Proposal | Evidence |
|---|---|---|
| **Mechanical stamping** (biggest win) | A `SubagentStop` hook: when a subagent whose `agent_type` is a routed reviewer finishes, stamp that reviewer for its routed staged files, keyed to the blob pairs captured when it was dispatched (via SubagentStart or a PreToolUse hook on the Agent tool), so a file that changed mid-review stays owed. The forbidden-stamping prose then becomes enforcement. `--stamp` stays the portable path for Cursor and humans. Optionally record the reviewer's final `CLEAN` / `N ISSUE(S)` line in the stamp file, which makes "findings are records" mechanical too. Needs its own plan and tests; confirm the hook payload fields in that plan's clarify pass. | D13 |
| **A "reviews happen at the gate" line** | In AGENTS.md: "Reviews run at the review gate and the final whole-plan review. Don't start other review or hardening rounds unless asked." This prevents the self-started reviewer rounds that high effort produces on top of the gate's own. | D8 |
| **Prompt audit as a sync-back step** | §7 (sync back) and the drift-audit runbook: run `/doctor prompt-audit` when instructions change, and before adopting a new model generation. | D10 |
| **Effort guidance per phase** | One line in SDD.md: brainstorm/clarify/final review at high+; routine tasks at the session default; reviewers per their frontmatter. | D9, effort docs |
| **Model-generation checkpoint** | A short "when a new model ships" checklist in the README: run the prompt audit, re-run one recent plan's tasks, and compare review rounds and tokens. Prompts tuned for one generation drift with the next. | D1, D3 |

## Don't

- **Don't convert SSDD into a Claude Code plugin.** Plugins version and
  distribute well, but the framework must travel with the repo, run under
  Cursor, and be edited per project. The first project customized a reviewer
  and added a domain lens. A plugin would make those edits forks. Keep
  copy-based injection.
- **Don't drop the gate or the verification artifacts** on the theory that
  newer models verify themselves. D4 targets *instructions to re-check*, not
  structured evidence that a reviewer or the owner reads later.
- **Don't strip all "why".** D7 says context helps. The cut is
  multi-paragraph incident narratives, not one-line reasons.

## Suggested order

1. **Measure:** run `/doctor prompt-audit` in the first injected project and
   record the always-loaded footprint: AGENTS.md (178 lines / 16 KB today),
   reviewer and skill descriptions, and the Superpowers session hook.
2. **Prose pass** (Remove + Change rows) on a branch, as one SSDD plan with
   acceptance criteria such as "AGENTS.md ≤ 120 lines" and "no reviewer
   description over 300 chars". Run the next real plan on it and compare
   review rounds, findings, and tokens against the previous comparable plan.
3. **Mechanical stamping** as its own plan with hook tests. It touches the
   gate, so it goes through the gate.
4. Upstream whatever survives into SSDD (v3).

## Sources

- [The new rules of context engineering for Claude 5 generation models](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)
- [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- [Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)
- [Prompting Claude Sonnet 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5)
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Claude Code: [Memory](https://code.claude.com/docs/en/memory) · [Skills](https://code.claude.com/docs/en/skills) · [Subagents](https://code.claude.com/docs/en/sub-agents) · [Hooks](https://code.claude.com/docs/en/hooks) · [Plugins](https://code.claude.com/docs/en/plugins)
