#!/bin/sh
# SSDD injector — copies the framework into a target repo.
# Usage: inject.sh <target-repo> [adapters]
#   adapters: comma-separated list of claude-code, cursor, generic
#             (default: generic). e.g. `inject.sh ../app claude-code,cursor`
#
# Copy-based by design (projects diverge; the framework travels with the
# repo). Re-running refreshes .ssdd/{process,reviewers,hooks} but NEVER
# overwrites .ssdd/config.json, skills, or adapter files already present —
# re-inject, then review the git diff in the target repo.
#
# One source of truth per artifact: reviewers live in .ssdd/reviewers/ and
# skills in .agents/skills/; harness discovery paths (.claude/agents,
# .claude/skills) are symlinks onto them, never copies.

set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
TARGET="$1"
ADAPTERS="${2:-generic}"

if [ -z "$TARGET" ] || [ ! -d "$TARGET" ]; then
  echo "usage: inject.sh <target-repo> [claude-code,cursor,generic]" >&2
  exit 1
fi
for a in $(echo "$ADAPTERS" | tr ',' ' '); do
  case "$a" in claude-code|cursor|generic) ;; *)
    echo "unknown adapter: $a (claude-code|cursor|generic)" >&2; exit 1 ;;
  esac
done
has() { case ",$ADAPTERS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# seed <src> <dst>: copy only if dst is absent.
seed() {
  if [ -e "$2" ] || [ -L "$2" ]; then echo "  kept existing ${2#$TARGET/}"
  else mkdir -p "$(dirname "$2")"; cp -R "$1" "$2"; echo "  seeded ${2#$TARGET/}"; fi
}
# link <relative-target> <dst>: symlink only if dst is absent; warn on a copy.
link() {
  if [ -L "$2" ]; then return 0; fi
  if [ -e "$2" ]; then
    echo "  WARNING: ${2#$TARGET/} is a copy, not a symlink — diff it against its source, then replace it with: ln -s $1 ${2#$TARGET/}"
    return 0
  fi
  mkdir -p "$(dirname "$2")"; ln -s "$1" "$2"; echo "  linked ${2#$TARGET/} -> $1"
}

echo "Injecting SSDD into $TARGET (adapters: $ADAPTERS)"

# Core: process + reviewers + hooks under .ssdd/ (framework-owned; refreshed).
mkdir -p "$TARGET/.ssdd/plans" "$TARGET/.ssdd/specs" "$TARGET/.ssdd/ledgers" "$TARGET/.ssdd/hooks"
cp -R "$SRC/process" "$TARGET/.ssdd/"
cp -R "$SRC/reviewers" "$TARGET/.ssdd/"
cp "$SRC"/mechanisms/hooks/*.mjs "$TARGET/.ssdd/hooks/"
cp "$SRC/mechanisms/drift-audit.md" "$TARGET/.ssdd/"

# Config and git hook: seed once, never overwrite.
seed "$SRC/mechanisms/config.example.json" "$TARGET/.ssdd/config.json"
seed "$SRC/mechanisms/hooks/pre-commit" "$TARGET/.githooks/pre-commit"
chmod +x "$TARGET/.githooks/pre-commit"

# Skills: one harness-neutral tree, seeded once (projects customize them).
for d in "$SRC"/skills/*/; do
  name="$(basename "$d")"
  seed "${d%/}" "$TARGET/.agents/skills/$name"
done

# Shared instructions: every adapter reads AGENTS.md.
[ -f "$TARGET/AGENTS.ssdd.md" ] || cp "$SRC/adapters/generic/AGENTS.md" "$TARGET/AGENTS.ssdd.md"

STEP=1
step() { echo "  $STEP. $1"; STEP=$((STEP + 1)); }

if has claude-code; then
  for f in "$TARGET"/.ssdd/reviewers/*.md; do
    base="$(basename "$f")"
    [ "$base" = "domain-reviewer-template.md" ] && continue
    link "../../.ssdd/reviewers/$base" "$TARGET/.claude/agents/$base"
  done
  for d in "$TARGET"/.agents/skills/*/; do
    name="$(basename "$d")"
    link "../../.agents/skills/$name" "$TARGET/.claude/skills/$name"
  done
  if [ -f "$TARGET/.claude/settings.json" ]; then SETTINGS_EXISTED=1; fi
  seed "$SRC/adapters/claude-code/settings-hooks.json" "$TARGET/.claude/settings.json"
  seed "$SRC/adapters/claude-code/CLAUDE.md" "$TARGET/CLAUDE.md"
fi

if has cursor; then
  seed "$SRC/adapters/cursor/hooks.json" "$TARGET/.cursor/hooks.json"
  seed "$SRC/adapters/cursor/rules/ssdd.mdc" "$TARGET/.cursor/rules/ssdd.mdc"
fi

echo ""
echo "Manual steps left:"
step "git -C '$TARGET' config core.hooksPath .githooks"
step "Edit .ssdd/config.json routing/lint for THIS project's paths (the shipped values are examples)"
step "Merge AGENTS.ssdd.md into AGENTS.md (fill the Documentation Map and Harnesses rows), then delete AGENTS.ssdd.md"
step "Fill the project domain list in .agents/skills/docs-drift-audit/SKILL.md"
if has claude-code; then
  [ -n "$SETTINGS_EXISTED" ] && step "Merge adapters/claude-code/settings-hooks.json into .claude/settings.json (it already existed)"
  step "Make sure CLAUDE.md starts with @AGENTS.md (see adapters/claude-code/CLAUDE.md)"
fi
has cursor && step "Check .cursor/hooks.json if it already existed (see adapters/cursor/README.md)"
step "Reload the agent session so hooks take effect; run: node --test .ssdd/hooks/*.test.mjs"
step "Commit the whole setup — the framework travels with the repo"
echo "Done."
