---
name: ship
description: >-
  Run pre-flight checks (typecheck, lint, specs touched by the diff), draft a
  commit message with the correct branch-based prefix (PROD-XXXX or #N), then
  commit, push, and open a PR — no approval prompts; the /ship invocation is the
  authorization. Use when the user says "/ship", "ship", "ship it", "shippe",
  "shippe ça", "commit and push", or wants to commit + push the current branch.
  PR creation is delegated to /pr.
---

# /ship — Ship the current branch end-to-end

Drives commit → push → PR in one go. Calling `/ship` is the explicit
authorization for all three actions; do NOT add `AskUserQuestion` gates around
commit, push, or PR creation.

## Step 1 — Pre-flight checks

Run in parallel:

```bash
git status --short
```

```bash
git branch --show-current
```

Detect the package manager (`bun.lock`/`bun.lockb` → bun, else `yarn.lock` → yarn,
else `package-lock.json` → npm) and use it for every step below.

Run **format first** so the final diff is what actually gets committed:

- bun → `bun run format`
- yarn → `yarn format`
- npm → `npm run format`

Then show the post-format diff stat:

```bash
git diff --stat
```

Then run typecheck and lint (parallel):

- bun → `bun run typecheck` & `bun run lint`
- yarn → `yarn typecheck` & `yarn lint`
- npm → `npm run typecheck` & `npm run lint`

If any `.spec.ts` / `.spec.js` file is in the diff, run the affected tests:

```bash
npx vitest run <path/to/spec.ts> [...]
```

**If ANY check fails: report the failure to the user and STOP. Do not proceed.**

## Step 2 — Draft the commit message

Determine the prefix from the current branch name:

| Branch pattern          | Commit prefix  |
|-------------------------|----------------|
| `PROD-XXXX-...`         | `PROD-XXXX `   |
| `<N>-...` (issue #)     | `#<N> `        |
| Otherwise               | (no prefix)    |

Rules for the message body:
- **Always in English**, 1–2 sentences, focused on the *why*.
- Conventional style:
  - new feature: `feat(scope): add X`
  - enhancement: `update(scope): X`
  - bug fix: `fix(scope): X`
  - chore/refactor: `chore(scope): X` / `refactor(scope): X`

Display the staged files and the drafted message in the chat **as you commit**,
so the user can see what landed without being prompted.

## Step 3 — Commit

1. Stage relevant files explicitly: `git add <file1> <file2> ...` — never `git add -A` or `git add .`.
   Exclude `.env*`, credentials, and large binaries.
2. Run `git commit -m "<message>"`.
3. The existing global PreToolUse format hook will run format again as a
   backstop (usually idempotent since pre-flight already formatted).
4. Verify with `git status --short` and `git log -1 --oneline`.

## Step 4 — Push

1. Confirm the branch name and intended remote (typically `origin`).
2. Run `git push` (add `-u origin <branch>` if no upstream is set).

## Step 5 — PR

After push, check whether a PR exists for this branch:

```bash
gh pr view --json url,number,state 2>/dev/null
```

- **No PR**: invoke `/pr` directly (no question). `/pr` handles description,
  assignee, and Jira transition.
- **PR exists, open**: report the URL, then run Step 6.
- **PR exists, closed/merged**: report and stop.

## Step 6 — Answer and resolve the threads the push addressed

Part of `/ship`, not a follow-up to suggest. Do it without being asked, in the
same turn as the push.

1. Fetch the unresolved threads (`isResolved == false`) via GraphQL, keeping
   each thread's `id` and its first comment's `databaseId`.
2. For every thread the pushed commits address, reply **in-thread** with
   `gh api repos/<owner>/<repo>/pulls/<PR#>/comments -f body="..." -F in_reply_to=<databaseId>`
   — never a top-level comment. Prefix the body with `🤖`. Use
   `--body-file`/`"$(cat file)"` rather than inline escapes.
3. Resolve each of those threads:
   `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }' -f threadId=<id>`

The reply carries the reasoning, especially when the fix **deviates** from what
the reviewer suggested — cite the `path:line` evidence that justified the
deviation. A commit message is not a reply; the reviewer reads the thread.

Only touch threads this push actually addresses. Leave the rest unresolved and
list them in the final report so the user knows what's still open.

### Cross-link related front/back PRs

When a single change ships **both** a front PR (agorize-front) and a linked
back PR (agorize-core) — e.g. a feature plus its translation/API change —
**always** add each PR's URL to the other's description (a `## Related PRs`
section), so reviewers can find the companion. Do this for every multi-repo
ship, in both directions, without being asked. Use `gh pr edit <N> --repo
<owner/repo> --body-file <file>` (never inline `--body` with escapes).

## Hard rules

- **No approval gates.** Do not call `AskUserQuestion` to confirm commit, push,
  or PR creation. The `/ship` invocation already authorizes all three.
- Never `--no-verify`, never `--amend`, never `--force` without explicit user
  request for that exact operation.
- Never stage `.env*`, credentials files, or anything that looks like a secret.
- Commit messages always in English. Branch prefix conventions
  (`PROD-XXXX `, `#N `) are mandatory when the branch matches.
- If pre-flight checks fail, do not "fix and retry" silently — surface the
  failure and let the user decide.
- If the user says only "commit", stop after Step 3. If they say only "push",
  skip to Step 4 (after confirming there's something to push).
