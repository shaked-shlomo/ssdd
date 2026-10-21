@AGENTS.md

## Claude Code

A reviewer subagent that ends with its verdict line stamps the files it was
dispatched on (the SubagentStop hook), whatever `reviewGate.stamping` says;
that setting decides only whether the agent may also run `--stamp`.
