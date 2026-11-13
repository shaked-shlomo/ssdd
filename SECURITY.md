# Security

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab →
**Report a vulnerability**. Please don't open a public issue for it.

Include the SSDD version (`VERSION`, or `.ssdd/ssdd.lock.json` in an injected
repo), the harness, and the steps or command that show the problem. Reports
are read as they come in; there's no fixed response time.

## Supported versions

Fixes land in the latest release only. Update an injected repo with
`node ~/ssdd/bin/ssdd.mjs update <repo>`.

## Scope

SSDD's guards keep a cooperating agent on the process; they aren't a sandbox
(see [docs/limitations.md](docs/limitations.md)). In scope:

- A way past the git pre-commit gate without `--no-verify` or
  `SSDD_REVIEW_SKIP`.
- The production guard missing a command that changes production.
- Anything SSDD writes or runs that exposes a secret, or runs code it
  shouldn't.

A known limitation listed in `docs/limitations.md` isn't a vulnerability
unless you've seen an agent use it in a real project.
