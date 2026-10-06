# Handover — SSDD v2.4: best-practice skills catalog and automation recommender

Written 2026-10-06. Verified against ssdd `main` at `3ecdb4e` (tag `v2.3.1`;
remote `shaked-shlomo/ssdd`, private). Paste this whole file as the opening
prompt of a fresh session in `/Users/shaked/Developer/ssdd`.

---

You are picking up the next SSDD release. Read `README.md`, `SPEC.md` (the
v2–v2.3 sections show how a release is planned and verified here),
`CHANGELOG.md` and `docs/model-era-review.md`.

How releases work in this repo:
- A `# vX.Y` section in SPEC.md comes first: goal, clarify pass, scope
  in/out, acceptance criteria. Then the code on a branch.
- Then the tests, CHANGELOG with upgrade notes, VERSION, the SPEC
  verification note, and a `vX.Y.Z` tag. Push the branch and the tag.
- The owner fast-forwards `main` with `git push origin <branch>:main`, never
  a squash, so tags stay on `main`.
- Tests: `node --test bin/*.selftest.mjs mechanisms/hooks/*.selftest.mjs`
  (zero npm deps). The `.selftest.mjs` naming keeps project test runners
  from collecting them; keep it for new test files.

## The goal

When SSDD is injected into a repo, it should help pick the stack's
best-practice skills without installing them blindly, and point at
Claude Code's automation recommender. The owner asked for both on
2026-10-05.

## What the two audits established (the spec's inputs)

- **Hatedate RN skills audit**, artifact
  https://claude.ai/artifact/Mp8hy1ouga8i3m3tjoiCJB (2026-09-08). It
  checked four sources against the repo's rules, hooks and reviewers:
  vercel-labs/agent-skills, callstackincubator/agent-skills, expo/skills and
  software-mansion-labs/skills.
  - **None installs wholesale;** every source ships rules a hook or reviewer
    would block.
  - Its ratings use the author's proximity to the stack, API currency, a
    validation harness, and collisions with house rules. GitHub stars are
    deliberately ignored.
  - Hazards it found:
    - Callstack and Software Mansion both ship a skill named
      `react-native-best-practices`, on the same trigger words.
    - Vercel's RN skill teaches `runOnJS` and Reanimated 3.
    - `expo-dev-client` lists `eas update` as a version check, but that
      command publishes an OTA update.
  - Plugin version strings were inert (Software Mansion stayed at `0.1.0`
    across commits), so track by git sha.
  - `npx skills add` writes a second copy next to a plugin's.
  - Verdict classes: keep, refresh, cherry-pick into rules, do not install,
    skip.
- **prizma's audit** lives in git, not a document:
  - commit `457cc0f` in `/Users/shaked/Developer/prizma` ("Wire Vercel
    skills into CLAUDE.md; drop deploy/cli/react-native skills")
  - `AGENTS.md` → "Skills: which one, when" and "Not vendored on purpose"
  - `skills-lock.json`: 8 vendored skills from anthropics/skills and
    vercel-labs/agent-skills. Its `computedHash` covers the upstream
    folder, not the local copy.
  - Plugins such as Superpowers are enabled through settings, not vendored.
- Hatedate also tracks plugins by sha in `VERSIONS.md` → "Claude Code
  plugins".
- **The recommender** is the official plugin
  `claude-code-setup@claude-plugins-official`. Its skill
  `claude-automation-recommender` is read-only: it recommends 1–2 hooks,
  subagents, skills, plugins and MCP servers per category. A copy is cached
  at `~/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/`.
  SSDD can't vendor a plugin product. It can enable it in the claude-code
  settings template (`enabledPlugins`), call it when present, or both.

## A starting shape (refine it in the clarify pass)

- **A catalog** (e.g. `catalog/skills.json`), keyed by stack signals:
  `package.json` deps, `app.json`/Expo, `next.config.*`, `supabase/`, and so
  on. Each entry has the source repo, the distribution (plugin/marketplace
  or vendored folder), skill names, known hazards and collisions, and the
  last audited sha and date.
- **A skill** that runs the audit method:
  1. Detect the stack.
  2. List the candidates.
  3. Read each source at a pinned sha.
  4. Check collisions against the repo's rules, hooks, reviewers and
     `.ssdd/config.json` lint.
  5. Rate and recommend: adopt, cherry-pick into rules, refresh, or skip.
  6. On approval, record by sha (a lock or ledger).
  
  It never installs unasked. The Hatedate artifact is effectively its spec.
- **The recommender:** the skill invokes `claude-automation-recommender`
  when available. Otherwise it says how to enable the plugin.
- **The performance reviewer** already treats an installed best-practices
  skill as its rules index (cites rule ids). Keep that link.

## What is open (ask the owner)

- The skill's name.
- Which stacks the first catalog covers. Evidence exists for RN/Expo and
  Next.js/React; Supabase is likely.
- Should `install` enable `claude-code-setup` in the settings template by
  default? Every plugin's descriptions cost context.
- Where adopted skills are recorded: `skills-lock.json`, a VERSIONS-style
  table, or the SSDD lock.
- Should `ssdd.mjs status` report upstream skill sources that moved past
  their recorded sha?

## Out of scope

- The remaining gate-evasion weaknesses (README → Known limitations). They
  need their own release.
- A CI workflow running the tests on PRs (offered, not requested).
- Upgrading projects. Each project runs `update` itself once the SSDD work
  is done. prizma needs `adopt --base v1.0.1` first, because it predates
  the lock file.

## How to write it (lessons from v2.2–v2.3)

- Descriptions: third person, at most 300 chars, and no `": "` inside a
  plain YAML value. Check frontmatter with
  `NODE_PATH=/Users/shaked/Developer/prizma/node_modules node -e` and
  `js-yaml`.
- A skill points to SDD.md instead of restating it. No capitals for
  emphasis.
- Verify Claude Code behavior live:
  `env -u CLAUDECODE claude -p --model claude-sonnet-5-5 …` in a scratch
  project with its own `.claude/settings.json`. A live run caught the alias
  bug that synthetic payloads missed.
- Tests: each test owns one `mkdtemp` base directory and removes only that.
  On Node 21+, pass test files as a glob, not a bare directory.
