# SSDD design specs

SSDD's own design specs, one file per version in `docs/specs/`. A citation
such as "`SPEC.md` → v3 → Part 4" means `docs/specs/v3.md` → Part 4. A new
version gets its file and a row here before its plan.

v3.4–v3.6 were renumbered to ship order on 2026-11-01: the gate-in-git spec
(drafted as v3.6) is v3.4, findings (v3.4) is v3.5, and the backlog (v3.5) is
v3.6. Commit messages and `git show <commit>:docs/specs/…` paths from before
that date use the old numbers.

| Version | Spec | Shipped as |
|---|---|---|
| v1 | [SSDD framework extraction — design spec](docs/specs/v1.md) | 1.0.0 |
| v2 | [v2 — back-port from the first injected project](docs/specs/v2.md) | 2.0.0 |
| v2.1 | [v2.1 — guard hardening from the original source project](docs/specs/v2.1.md) | 2.1.0 |
| v2.2 | [v2.2 — text cut for Claude 5-generation models](docs/specs/v2.2.md) | 2.2.0 |
| v2.3 | [v2.3 — reviewer completion stamps; `/new-reviewer`](docs/specs/v2.3.md) | 2.3.0 |
| v2.4 | [v2.4 — `/skills-audit`: best-practice skills catalog and automation recommender](docs/specs/v2.4.md) | 2.4.0 |
| v2.5 | [v2.5 — close the remaining gate weaknesses](docs/specs/v2.5.md) | 2.5.0 (untagged) |
| v2.6 | [v2.6 — simplify the gate to its threat model](docs/specs/v2.6.md) | 2.6.0 (untagged) |
| v3 | [v3 — SSDD knows where the work is](docs/specs/v3.md) | 3.0.0–3.3.1 (Parts 1–5) |
| v3.4 | [v3.4 — the gate lives in git](docs/specs/v3.4.md) | — (draft) |
| v3.5 | [v3.5 — findings have outcomes](docs/specs/v3.5.md) | — (draft) |
| v3.6 | [v3.6 — one backlog](docs/specs/v3.6.md) | — (clarified) |
