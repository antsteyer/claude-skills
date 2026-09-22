---
name: pr
description: >-
  Full PR creation workflow: generate description, create GitHub PR with Jira
  link when branch starts with PROD-, assign it to the current GitHub user, and transition the
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

Extract `PROD-XXXX` from the branch name if the branch starts with `PROD-`. Store it as `JIRA_TICKET`.

### Step 1b: Determine the base branch

The remote's default branch (`DEFAULT`) is only the base when the branch is not stacked
on another feature branch. Look for stacked parents — remote branches already contained
in `HEAD` that carry commits `DEFAULT` does not have (set `DEFAULT` and `CURRENT` from Step 1 first):

```bash
git fetch origin
git for-each-ref --merged HEAD --format='%(refname:short)' refs/remotes/origin | while read -r ref; do
  case "$ref" in origin|origin/HEAD|origin/$DEFAULT|origin/$CURRENT) continue ;; esac
  ahead=$(git rev-list --count origin/$DEFAULT..$ref)
  if [ "$ahead" -gt 0 ]; then echo "$ref ahead=$ahead distance=$(git rev-list --count $ref..HEAD)"; fi
done
```

(`origin/HEAD` prints as `origin` in short form, hence both in the skip list.)

Look up each candidate's PR (`gh pr list --head <branch> --state all --json number,state,url`):

- **No candidate, or candidates without any PR** → `BASE = DEFAULT`.
- **One candidate with an open PR** → `BASE = <that branch>` (stacked PR). State it in the report; no question.
- **Several candidates with an open PR** → pick the closest (smallest `distance`) only if the others are its
  own ancestors; otherwise ask the user which one with `AskUserQuestion`.
- **A candidate whose PR is merged or closed** (squash-merged parent) → `BASE = DEFAULT`, and warn
  that the PR will carry the parent's commits until the branch is rebased — suggest
  `/resolve-conflicts` before creating the PR, and stop if the user wants to rebase first.

Then gather the commits and diff against `BASE`:

```bash
git log origin/<BASE>..<current> --reverse --format="### %s%n%n%b"
```

```bash
git diff origin/<BASE>...<current> --stat
```

If the log lists commits that do not belong to this ticket, stop and report them: the base is wrong.

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
  --base <BASE> \
  --assignee @me
```

**Always** pass `--base <BASE>` (Step 1b) — without it `gh` targets the default branch, which is
wrong for a stacked PR — and `--assignee @me` (the authenticated `gh` user).

For a stacked PR, add a line under `## Summary`: `Stacked on #<parent PR number> — merge it first.`

### Step 6: Transition the Jira ticket (if PROD- branch)

If a `JIRA_TICKET` was extracted, call `mcp__plugin_atlassian_atlassian__transitionJiraIssue`
(`cloudId: agorize.atlassian.net`, `issueIdOrKey: <JIRA_TICKET>`, `transitionName: "Ready for review"`).
If that transition is not available from the current status, say which ones are and leave the
ticket untouched — never pick another transition.

### Step 7: Report

Return the PR URL, the base branch (and why, when it is not the default branch), and confirm
the Jira transition was applied (or skipped if no PROD- ticket).

## Rules

- Never skip the `--assignee @me` flag.
- Never skip the `--base` flag; never assume the default branch without running Step 1b.
- Never post PR comments without the 🤖 emoji prefix.
- Always include the Jira link when the branch starts with `PROD-`.
- Do not amend or force-push unless explicitly asked.
