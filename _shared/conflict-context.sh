#!/usr/bin/env bash
# Print, for every conflicted file, its conflict hunks (with line numbers) and the
# latest upstream commit that touched it, so one call gives the whole resolution context.
# Usage: bash ~/.claude/skills/_shared/conflict-context.sh <upstream-ref> [max-patch-lines]
# Hunks carry the common-ancestor section when the replay ran with merge.conflictStyle=zdiff3.
set -euo pipefail

upstream="${1:?usage: conflict-context.sh <upstream-ref> [max-patch-lines]}"
max_patch_lines="${2:-80}"

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(git diff --name-only --diff-filter=U)

if [ "${#files[@]}" -eq 0 ]; then
  printf 'No conflicted file.\n'
  exit 0
fi

printf 'Conflicted files (%s):\n' "${#files[@]}"
printf '  %s\n' "${files[@]}"

for file in "${files[@]}"; do
  printf '\n==================== %s\n' "$file"
  if [ -f "$file" ]; then
    printf -- '--- conflict hunks\n'
    awk '/^<<<<<<< /{inside=1} inside{printf "%5d: %s\n", NR, $0} /^>>>>>>> /{inside=0; print ""}' "$file"
  else
    printf -- '--- deleted on one side (modify/delete conflict)\n'
  fi
  printf -- '--- latest upstream change (%s)\n' "$upstream"
  git --no-pager log -p -1 --format='%h %s' "$upstream" -- "$file" | head -n "$max_patch_lines"
done
