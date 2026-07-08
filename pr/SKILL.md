---
name: pr
description: >-
  Full PR creation workflow: generate description, create GitHub PR with Jira
  link when branch starts with PROD-, assign to antsteyer, and transition the
  Jira ticket to "Ready for review". Use when the user says "create a PR",
  "open a PR", "push and open a PR", or "/pr".
---

# PR Creation Workflow

## Instructions

### Step 1: Gather branch and commit data

Run in parallel:

```bash
git branch --show-current
```

```bash
git remote show origin | grep 'HEAD branch'
```

```bash
git log <base>..<current> --reverse --format="### %s%n%n%b"
```

```bash
git diff <base>...<current> --stat
```

Extract `PROD-XXXX` from the branch name if the branch starts with `PROD-`. Store it as `JIRA_TICKET`.

### Step 2: Check for uncommitted changes

```bash
git status --short
```

If there are uncommitted changes, ask the user whether to commit them first before creating the PR.

### Step 3: Push the branch

```bash
git push -u origin <current-branch>
```

### Step 4: Generate the PR description

Analyze the diff and write a PR description using this template:

```markdown
## Summary

<!-- 1-3 sentences: what this PR does and why -->

## Changes

<!-- Bullet list of meaningful changes grouped by intent, not by file -->

-

## Test plan

- [ ]

Jira: https://agorize.atlassian.net/browse/<JIRA_TICKET>
```

**Rules for the description:**
- If the branch has a `PROD-XXXX` prefix, always include the `Jira:` line at the bottom of the description.
- If no PROD- ticket, omit the Jira line.
- Write in the same language as the commit messages (usually English).
- Be concise — reviewers should understand in under 30 seconds.
- Focus on the **why** and **what**, not the **how**.

### Step 5: Create the PR

```bash
gh pr create \
  --title "<title from latest commit or summary>" \
  --body "$(cat <<'EOF'
<generated description>
EOF
)" \
  --assignee antsteyer
```

**Always** pass `--assignee antsteyer`.

### Step 6: Transition the Jira ticket (if PROD- branch)

If a `JIRA_TICKET` was extracted, transition it to "Ready for review":

```bash
curl -s -u $JIRA_EMAIL:$JIRA_API_TOKEN \
  -X GET \
  "https://agorize.atlassian.net/rest/api/3/issue/<JIRA_TICKET>/transitions" \
  | jq '.transitions[] | {id, name}'
```

Find the transition ID for "Ready for review" (or "Ready for preview"), then:

```bash
curl -s -u $JIRA_EMAIL:$JIRA_API_TOKEN \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"<ID>"}}' \
  "https://agorize.atlassian.net/rest/api/3/issue/<JIRA_TICKET>/transitions"
```

### Step 7: Report

Return the PR URL and confirm the Jira transition was applied (or skipped if no PROD- ticket).

## Rules

- Never skip the `--assignee antsteyer` flag.
- Never post PR comments without the 🤖 emoji prefix.
- Always include the Jira link when the branch starts with `PROD-`.
- Do not amend or force-push unless explicitly asked.
