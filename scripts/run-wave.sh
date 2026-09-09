#!/usr/bin/env bash
# Graphics Control Plane - wave runner. See plan_approved.md, "Running it from the CLI".
#
# usage: ./scripts/run-wave.sh <wave-number> [base-ref]
#
# base-ref defaults to $GFX_BASE, else main. The plan assumes the specs live on
# main; until they are merged there, pass the branch that carries them, or every
# worktree comes up without plan_approved.md and specs/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WAVE="${1:?usage: run-wave.sh <wave-number> [base-ref]}"
BASE="${2:-${GFX_BASE:-main}}"

case "$WAVE" in
  0) SPECS=("14:claude-opus-5") ;;
  1) SPECS=("15:claude-sonnet-5" "16:claude-sonnet-5" "20:claude-sonnet-5" "21:claude-haiku-4-5-20251001") ;;
  2) SPECS=("17:claude-sonnet-5" "18:claude-opus-5" "22:claude-sonnet-5" "23:claude-haiku-4-5-20251001") ;;
  3) SPECS=("19:claude-sonnet-5") ;;
  *) echo "unknown wave $WAVE" >&2; exit 1 ;;
esac

echo "wave $WAVE - ${#SPECS[@]} spec(s), base=$BASE"

for entry in "${SPECS[@]}"; do
  N="${entry%%:*}"
  MODEL="${entry##*:}"
  SPEC_FILE="$(ls "$ROOT/specs/$N-"*.md)"
  SLUG="$(basename "$SPEC_FILE" .md | cut -d- -f2-)"
  BRANCH="feat/graphics-$N-$SLUG"
  WT="$ROOT/.claude/worktrees/gfx-$N"
  LOG="$ROOT/.claude/worktrees/gfx-$N.log"

  git -C "$ROOT" worktree add "$WT" -b "$BRANCH" "$BASE"

  PROMPT=$(cat <<PEOF
Implement specs/$N-*.md in this worktree, end to end.

Read plan_approved.md first for the Global Constraints - they apply to every task.
Read the "What already exists" section of the spec before writing code; do not
rebuild anything listed there.

Work the task list in order. For each task: write the failing test, run it and
confirm it fails, implement the minimum to make it pass, run the full suite,
then commit. Do not skip the failing-test step.

Finish only when "npm run typecheck && npm test" is green and every criterion
in the Acceptance section of the spec is demonstrably met. Report any criterion
you could not meet rather than marking it done.
PEOF
)

  echo "  spawned $N ($MODEL) -> $BRANCH"
  (
    cd "$WT"
    claude --model "$MODEL" --permission-mode acceptEdits -p "$PROMPT" > "$LOG" 2>&1
    echo "[$N] claude exited $?" >> "$LOG"
  ) &
done

wait
echo "wave $WAVE complete - logs in .claude/worktrees/gfx-*.log"
