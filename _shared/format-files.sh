#!/usr/bin/env bash
# Format only the given files, or every changed/untracked file when none is given.
# Run it as `bash ~/.claude/skills/_shared/format-files.sh [files...]`: the rtk hook
# leaves it untouched and bash word-splits the file list, unlike a zsh one-liner.
set -euo pipefail

if [ -f bun.lock ] || [ -f bun.lockb ]; then
  runner=(bunx)
elif [ -f yarn.lock ]; then
  runner=(yarn)
else
  runner=(npx)
fi

if [ "$#" -gt 0 ]; then
  candidates=("$@")
else
  candidates=()
  while IFS= read -r file; do
    candidates+=("$file")
  done < <( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u )
fi

code=()
styles=()
for file in "${candidates[@]+"${candidates[@]}"}"; do
  [ -f "$file" ] || continue
  case "$file" in
    *.ts | *.js | *.vue) code+=("$file") ;;
    *.scss) styles+=("$file") ;;
  esac
done

# Every tool runs even when a previous one fails, so the files still get formatted;
# the exit status reports the unfixable errors left for the caller to fix.
status=0
if [ "${#code[@]}" -gt 0 ]; then
  "${runner[@]}" eslint --fix "${code[@]}" || status=1
fi
if [ "${#styles[@]}" -gt 0 ]; then
  "${runner[@]}" stylelint --fix "${styles[@]}" || status=1
fi
if [ "$(( ${#code[@]} + ${#styles[@]} ))" -gt 0 ]; then
  "${runner[@]}" prettier --write --log-level warn "${code[@]+"${code[@]}"}" "${styles[@]+"${styles[@]}"}" || status=1
  printf 'Formatted:\n'
  printf '  %s\n' "${code[@]+"${code[@]}"}" "${styles[@]+"${styles[@]}"}"
else
  printf 'Nothing to format.\n'
fi
exit "$status"
