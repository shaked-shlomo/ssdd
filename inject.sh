#!/bin/sh
# SSDD injector — copies the framework into a target repo.
# Usage: inject.sh <target-repo> [claude-code|generic]
#
# Copy-based by design (projects diverge; the framework travels with the
# repo). Re-running refreshes process/reviewers/mechanisms but NEVER
# overwrites .ssdd/config.json or adapter files already customized —
# re-inject, then review the git diff in the target repo.

set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
TARGET="$1"
ADAPTER="${2:-generic}"

if [ -z "$TARGET" ] || [ ! -d "$TARGET" ]; then
  echo "usage: inject.sh <target-repo> [claude-code|generic]" >&2
  exit 1
fi
case "$ADAPTER" in claude-code|generic) ;; *)
  echo "unknown adapter: $ADAPTER (claude-code|generic)" >&2; exit 1 ;;
esac

echo "Injecting SSDD into $TARGET (adapter: $ADAPTER)"

# Core: process + reviewers + hooks under .ssdd/
mkdir -p "$TARGET/.ssdd/plans" "$TARGET/.ssdd/specs" "$TARGET/.ssdd/ledgers"
cp -R "$SRC/process" "$TARGET/.ssdd/"
cp -R "$SRC/reviewers" "$TARGET/.ssdd/"
mkdir -p "$TARGET/.ssdd/hooks"
cp "$SRC/mechanisms/hooks/review-gate.mjs" \
   "$SRC/mechanisms/hooks/git-guard.mjs" \
   "$SRC/mechanisms/hooks/convention-lint.mjs" "$TARGET/.ssdd/hooks/"
cp "$SRC/mechanisms/drift-audit.md" "$TARGET/.ssdd/"

# Config: seed once, never overwrite.
if [ ! -f "$TARGET/.ssdd/config.json" ]; then
  cp "$SRC/mechanisms/config.example.json" "$TARGET/.ssdd/config.json"
  echo "  seeded .ssdd/config.json (EDIT THE ROUTING/RULES — they are examples)"
else
  echo "  kept existing .ssdd/config.json"
fi

# Portable git hook: seed once.
mkdir -p "$TARGET/.githooks"
if [ ! -f "$TARGET/.githooks/pre-commit" ]; then
  cp "$SRC/mechanisms/hooks/pre-commit" "$TARGET/.githooks/pre-commit"
  chmod +x "$TARGET/.githooks/pre-commit"
  echo "  installed .githooks/pre-commit"
else
  echo "  kept existing .githooks/pre-commit (diff against mechanisms/hooks/pre-commit for updates)"
fi

# Adapter
if [ "$ADAPTER" = "claude-code" ]; then
  mkdir -p "$TARGET/.claude/agents" "$TARGET/.claude/skills"
  for f in "$SRC"/reviewers/*.md; do
    base="$(basename "$f")"
    [ "$base" = "domain-reviewer-template.md" ] && continue
    [ -f "$TARGET/.claude/agents/$base" ] || cp "$f" "$TARGET/.claude/agents/$base"
  done
  cp -R "$SRC/adapters/claude-code/skills/new-plan" "$TARGET/.claude/skills/" 2>/dev/null || true
  echo ""
  echo "Manual steps left (claude-code):"
  echo "  1. Merge adapters/claude-code/settings-hooks.json into $TARGET/.claude/settings.json"
  echo "  2. git -C '$TARGET' config core.hooksPath .githooks"
  echo "  3. Edit .ssdd/config.json routing/lint for THIS project's paths"
  echo "  4. Add the Documentation Map + review-gate paragraph to CLAUDE.md"
  echo "     (see adapters/claude-code/README.md; mind the CLAUDE.md size budget)"
  echo "  5. Reload the session so hooks take effect; commit the whole setup"
else
  [ -f "$TARGET/AGENTS.ssdd.md" ] || cp "$SRC/adapters/generic/AGENTS.md" "$TARGET/AGENTS.ssdd.md"
  echo ""
  echo "Manual steps left (generic):"
  echo "  1. git -C '$TARGET' config core.hooksPath .githooks"
  echo "  2. Edit .ssdd/config.json routing/lint for THIS project's paths"
  echo "  3. Merge AGENTS.ssdd.md into the project's AGENTS.md (fill the"
  echo "     Documentation Map placeholders), then delete AGENTS.ssdd.md"
  echo "  4. Commit the whole setup — the framework travels with the repo"
fi
echo "Done."
