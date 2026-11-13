---
name: dependency-versioning
description: Use when adding an npm package or changing a dependency's version - npm install, a bump or downgrade, an audit fix, "are we up to date". Picks the newest version published at least 7 days ago, unless a newer one fixes a known advisory. Not for other work.
---

# Dependency versioning

> **Install the newest version that is both published at least 7 days ago and
> inside the project's compatibility range.** Never npm's `latest` while it's
> younger than 7 days; never "hold at current" when a newer safe version
> exists. The one override is the **security exception**: a version younger
> than 7 days that fixes a known, disclosed advisory open in the version you'd
> otherwise take.

The 7 days guard against undiscovered risk: a new release hasn't had time for
anyone to find a supply-chain compromise or a regression in it. A disclosed,
fixed advisory is the opposite kind of risk, so the fix wins.

## 1. Choose the version

```bash
npm view <pkg> time --json   # every version and its publish date
```

Safe means published on or before today − 7 days; compute the cutoff. Take the
newest safe version inside the compatibility range (project section; with
none set, the current major, and a new major only once its peers are checked).
Two mistakes: taking `latest` when it's younger than 7 days, and keeping the
installed version when a newer one has since aged past 7 days.

## 2. The security exception

Only when the newest version is younger than 7 days:

```bash
npm audit                     # does the tree carry an open advisory?
```

Read both versions' release notes and the advisory (GitHub Advisory Database).
Take the young version only for a disclosed security fix, and record its
GHSA or CVE ID (§5). A routine batch of patch releases is no exception, however
large: check each package, don't assume.

## 3. Install, then scan the whole tree

```bash
npm install <pkg>@<exact-version>
node .agents/skills/dependency-versioning/scripts/age-scan.mjs HEAD
```

Bumping a hub package (a framework core, a package with config plugins)
re-resolves the tree and can pull transitive dependencies up to releases
younger than 7 days that no command named. `age-scan.mjs` diffs
`package-lock.json` against the ref and checks the publish date of every
changed version. For each `<7 DAYS` hit:
- **A module that ships:** pin it to its newest safe version with `overrides`
  in `package.json`, or drop the hub bump that pulled it.
- **A hub's own toolchain** (its CLI's internals): don't bump the hub; an
  override there can break the CLI. When leaf bumps pulled it instead,
  override that build-tool package to its newest safe version.

Re-run until it reports 0, apart from versions taken under §2. A publish date
it can't read fails the scan too: check that version by hand.

## 4. Verify

```bash
node .agents/skills/dependency-versioning/scripts/peer-check.mjs
```

It checks the required peers of every package installed at the top of
`node_modules`, which matters most when `.npmrc` sets `legacy-peer-deps`
(install then hides peer conflicts). Confirm each flag it leaves is benign (an
optional layer that never runs, an intentional documented `overrides` pin);
don't "fix" an intentional override. A package that declares `*` or no peers
passes even when it doesn't work with the rest. Then run the project's checks
(project section). A green run proves only the layers its checks cover: say
which, not "fully compatible".
Sort `npm audit` hits by dependency path: only an advisory in a module that
ships is a blocker; build and test tooling is not.

## 5. Record

Where the project records versions (project section): the version, its publish
date, a one-line reason, and an advisory ID taken under §2. For anything held
below `latest` by the 7 days, the date the newer version turns 7 days old.
Un-holding it means dropping its `overrides` pin (or install exclusion) and
running §1–5 again.

## Project section

<!-- Fill in for this repo:
- Compatibility range: per class of package (a framework's bundled versions,
  exact pins, packages that must move together).
- Checks after a change: type check, tests, build, native resolution.
- Where versions are recorded (a VERSIONS.md, the commit message).
- Held packages and how they stay held (overrides, an install exclude list). -->
