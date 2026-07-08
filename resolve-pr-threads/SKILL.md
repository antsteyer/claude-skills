---
name: resolve-pr-threads
description: >-
  Supervised PR review resolution: fetch unresolved GitHub review threads,
  classify them, apply code fixes, run the relevant tests, and draft reply
  comments — but never commit, push, or post. The user validates all changes.
  Use when the user says "resolve PR threads", "traite les commentaires de review",
  or "/resolve-pr-threads [PR#]".
---

# Supervised PR Review Thread Resolution

**Supervised mode: no commit, no push, no posted comments.** Only apply file edits and report. The user validates before doing anything.

## Step 1 — Identify the PR

If a PR number was passed as argument, use it. Otherwise detect from the current branch:

```bash
gh pr view --json number,url,headRefName 2>/dev/null
```

Confirm the PR number with the user before proceeding if detection is ambiguous.

## Step 2 — Fetch unresolved review threads

Use the GitHub GraphQL API to get only unresolved threads (never show resolved ones):

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          diffSide
          comments(first: 10) {
            nodes {
              id
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}' -f owner=<owner> -f repo=<repo> -F pr=<PR#>
```

Filter: keep only threads where `isResolved == false` and `isOutdated == false`.

Extract owner/repo from `gh repo view --json owner,name`.

## Step 3 — Classify each thread

For each unresolved thread, classify it as one of:

| Type | Description | Action |
|------|-------------|--------|
| `code-change` | Reviewer asks to change logic, naming, or structure | Apply fix |
| `test-refactor` | Reviewer asks to change a test | Apply fix |
| `accessibility` | aria-label, tabindex, sr-only, role | Apply fix |
| `style` | CSS, BEM class naming, template spacing | Apply fix |
| `discussion` | Question or comment with no clear actionable change | Draft reply only, no file edit |
| `outdated-by-context` | Thread makes sense only in context that no longer applies | Flag to user, skip |

## Step 4 — Resolve actionable threads (one by one)

For each `code-change`, `test-refactor`, `accessibility`, or `style` thread:

### 4a. Read context

Read the file at the line mentioned in the thread. Also read the corresponding `.spec.ts` if the thread touches a `.vue` or `.ts` source file.

Before touching any code, **verify the current state of the file matches what the reviewer saw** — if the code has already changed, mark the thread as `possibly-already-fixed` and flag it.

### 4b. Apply the fix

Follow all conventions from CLAUDE.md:
- `mapStores` not `mapState`/`mapActions`
- Options API patterns (no `setup()`)
- BEM class hierarchy matching DOM structure
- Vue template: blank line between sibling elements
- Vue script: no blank lines between options blocks
- Boolean props: shorthand form (`:foo="true"` → `foo`)
- No `!` non-null assertions
- `else` after every `if` with a `return`
- Positive `if` condition first

### 4c. Run the relevant test file

After each fix:

```bash
npx vitest run <path-to-spec>
```

If the spec path is not obvious, `grep` for it:

```bash
grep -r "ComponentName" tests/ --include="*.spec.ts" -l
```

Report: `PASS` / `FAIL` + failure output if any. If tests fail, attempt one fix iteration. If they still fail after one attempt, revert the change and mark the thread as `needs-manual-review`.

### 4d. Draft reply comment

Write a reply for each thread — **do not post it**. Format:

```
[DRAFT REPLY — thread <id> — <file>:<line>]
Applied: <one-line description of what changed>
File: <path>, line <N>

<The actual reply text to paste on GitHub>
```

The reply text should:
- Reference the specific file and line changed
- Explain briefly what was done
- Start with 🤖 (required prefix for AI-authored comments)

## Step 5 — Handle discussion threads

For threads classified as `discussion`, draft a reply that answers the reviewer's question based on the code context. Do not edit any file.

## Step 6 — Final report

After processing all threads, output a summary table:

```
## PR #<N> — Thread Resolution Summary

| # | File | Reviewer | Type | Action | Tests | Draft reply ready |
|---|------|----------|------|--------|-------|-------------------|
| 1 | src/foo.vue:42 | @reviewer | code-change | Fixed mapStores | PASS | ✅ |
| 2 | tests/bar.spec.ts:17 | @reviewer | test-refactor | Updated buildComponent | PASS | ✅ |
| 3 | src/baz.vue:88 | @reviewer | discussion | No change | — | ✅ |
| 4 | src/old.vue:5 | @reviewer | code-change | REVERTED — tests failed | FAIL | ⚠️ needs manual review |

## Changes made (not committed)
<git diff --stat output>

## Next steps for you
1. Review the diff: `git diff`
2. For each fix you approve, stage it: `git add -p`
3. Commit: `git commit -m "PROD-XXXX resolve PR review comments"`
4. Push and post the draft replies above on each thread
5. Resolve the threads after pushing
```

## Rules

- **Never** run `git add`, `git commit`, `git push`, or `gh pr comment` / `gh pr review`.
- **Never** call `gh api` mutations that resolve threads — resolving is the user's job after push.
- If a thread's fix is risky (touches shared utilities, serializers, or affects >3 files), flag it in the report and skip it rather than applying it.
- If fewer than 2 threads are unresolved, report that and stop — not worth running the full loop.
- Work on the current working tree directly (no worktree needed — the user is already on the right branch).
