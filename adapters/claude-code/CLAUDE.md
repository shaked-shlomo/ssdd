@AGENTS.md

## Claude Code

A reviewer subagent that ends with its verdict line stamps all its routed
staged files as they were when it started, whatever its input named, so name
every file it owes (the SubagentStop hook). It does so whatever
`reviewGate.stamping` says; that setting decides only whether the agent may
also run `--stamp`.
