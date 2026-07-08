---
name: pr-description
description: >-
  Generate a pull request description by analyzing commit changes on the current
  branch. Use when the user asks to fill, write, generate, or create a PR
  description, or when opening a pull request.
---

# PR Description Generator

## Instructions

Generate a structured PR description based on the commit history of the current branch compared to its base branch.

### Step 1: Identify the base branch

Run these commands in parallel:

```bash
git branch --show-current
```

```bash
git remote show origin | grep 'HEAD branch'
```

Use the remote HEAD branch (usually `main` or `master`) as the base branch. If the remote is not available, fall back to `main`.

### Step 2: Gather commit data

Run these commands in parallel to collect all relevant information:

```bash
git log <base>..<current> --reverse --format="### %s%n%n%b"
```

```bash
git diff <base>...<current> --stat
```

```bash
git diff <base>...<current>
```

Read the full diff carefully. Understand the **intent** behind the changes, not just the surface-level modifications.

### Step 3: Analyze changes

Categorize each commit into one of:
- **feat**: new feature or capability
- **fix**: bug fix
- **refactor**: code restructuring without behavior change
- **docs**: documentation only
- **test**: adding or updating tests
- **chore**: tooling, dependencies, CI, config

Identify:
- The **main objective** of the PR (the "why")
- **Key decisions** or trade-offs made
- **Breaking changes**, if any
- **Areas affected** (which modules, services, or components)

### Step 4: Write the PR description

Use the template below. Adapt sections as needed — omit empty sections, add relevant ones.

```markdown
## Summary

<!-- 1-3 sentences explaining WHAT this PR does and WHY -->

## Changes

<!-- Bullet list of meaningful changes, grouped logically. Focus on intent, not file-by-file diffs. -->

-

## Breaking changes

<!-- If none, remove this section entirely -->

-

## Test plan

<!-- How to verify these changes work correctly -->

- [ ]
```

### Rules

- Write in the same language as the commit messages. If commits are in English, write in English. If in French, write in French.
- Be concise: reviewers should understand the PR in under 30 seconds.
- Focus on the **why** and **what**, not the **how** — the diff already shows the how.
- Group related changes together instead of listing per commit.
- If a commit message is vague (e.g., "fix stuff"), look at the actual diff to describe the change properly.
- Never include auto-generated content (merge commits, version bumps) unless relevant.
- The test plan should contain actionable verification steps, not generic statements.
