#!/usr/bin/env bash
# Print the review threads of a PR as JSON: thread id, resolution state, anchor, and every
# comment with its databaseId (needed for the in-thread reply and the resolve mutation).
# Run it as `bash ~/.claude/skills/_shared/pr-threads.sh <owner> <repo> <PR#>`.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: pr-threads.sh <owner> <repo> <PR#>" >&2
  exit 1
fi

gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          comments(first: 20) {
            nodes { id databaseId body author { login } createdAt }
          }
        }
      }
    }
  }
}' -f owner="$1" -f repo="$2" -F pr="$3" --jq '.data.repository.pullRequest.reviewThreads.nodes'
