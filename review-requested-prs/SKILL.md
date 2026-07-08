---
name: review-requested-prs
description: >-
  Review the open PRs awaiting my requested review and leave pending
  (un-submitted) feedback I finish on the UI. Use when the user wants to go
  through the PRs they've been requested to review and drop pending review
  comments, across one or several repos.
---

# Review-Requested PRs Skill

Goal: find the PRs awaiting **my** review, let me pick repos then PRs, and for each chosen PR
leave a GitHub review **in PENDING state** (a draft I review/finish/submit myself on the UI).
**Never submit a review on your own initiative** — leave it PENDING. The only exception is when I
*explicitly* ask you to publish / submit / send it: then follow **Step 6** (ask me the review type first).

`gh` is authenticated. Resolve my login once: `gh api user --jq .login` (call it `ME`).

## Targeted-PR mode — when I pass a specific PR

If the invocation args contain a reference to **one specific PR**, skip discovery and selection
entirely (Steps 1–3) and go straight to **Step 4** on that single PR. Accepted forms:
- a full URL `https://github.com/<OWNER>/<REPO>/pull/<N>`
- a short ref `<OWNER>/<REPO>#<N>`
- a bare `#<N>` or `<N>` — only valid when run from inside a repo dir; resolve `<OWNER>/<REPO>` with
  `gh repo view --json nameWithOwner --jq .nameWithOwner`.

Parse out `REPO` (as `<OWNER>/<REPO>`) and `N`, state which PR you're reviewing up front, then run
Step 4 (4a → 4e) for that one PR and report via Step 5. The `dry-run` flag still composes — args can
contain both a PR link and `dry-run`. A single targeted PR doesn't need its own worktree subagent;
review it inline (still trace calls end to end per 4a). Everything else — comment style, pending
mechanics, the "never submit" rule — is unchanged.

If no PR reference is present in the args, fall through to the discovery flow below (Step 1 onward).

## Mode — live vs dry-run
Default is **live**: post pending reviews to GitHub. If the invocation args contain `dry-run` (or
`--dry-run`), run in **dry-run** instead: do everything read-only (discovery, context, analysis) but
make **no writes to GitHub at all** — no `POST`/`PUT`/`DELETE`, no `gh pr review`. Output here in the
chat exactly what *would* have been posted. Steps 1–4c are identical in both modes; only the delivery
(4d) and the report (5) differ. State the active mode up front so I know which one is running.

---

## Step 1 — Discover the PRs awaiting my review

```
gh search prs --review-requested=@me --state=open --json number,title,repository,url,isDraft,updatedAt --limit 100
```

- `review-requested:@me` already gives the right set: GitHub removes me from the requested
  reviewers once I submit a review, so PRs **where I've already left feedback and haven't been
  re-requested are naturally excluded**. The PRs returned are the "awaiting my review" ones.
- **Drop drafts** (`isDraft == true`).
- If the result is empty, tell me and stop.

## Step 2 — Let me pick the repos (default = all)

Group the PRs by `repository`. Use **AskUserQuestion** (multiSelect) to let me choose the repos to
review. Make clear that **all repos are in scope by default** — I'm only deselecting ones to skip.
- If ≤4 repos: one multiSelect question, one option per repo (label = repo, description = PR count).
- If >4 repos (AskUserQuestion caps at 4 options): show the repos as a short numbered list and ask
  me to reply with the repos to skip (default: keep all).
- If there's a single repo, skip this step.

## Step 3 — Show a recap table, then let me pick the PRs (default = all)

For the selected repos, print a markdown recap table: `Repo | # | Titre | Mis à jour | URL`.
Then let me narrow the PR list:
- If ≤4 PRs: AskUserQuestion multiSelect, one option per PR (label = `repo#number`, description = title).
- If >4 PRs: keep the table and ask me to reply with the PR numbers to skip (default: review all).

The PRs I keep after this step are the final work list.

## Step 4 — Review each chosen PR (pending, never submitted)

Run the PRs concurrently when there are several: one subagent per PR, each in its **own git
worktree** (`isolation: "worktree"`) so branch checkouts don't collide. Each subagent owns one PR
end to end and reports back. Give every subagent the rules below verbatim.

### 4a. Build context — and read what's already been handled
- `gh pr view <N> --repo <REPO> --json title,body,baseRefName,headRefName,files,additions,deletions`
- `gh pr diff <N> --repo <REPO>`  and head sha: `... --json commits --jq '.commits[-1].oid'`
- **Read prior feedback so I don't repeat myself**: existing reviews and their comments
  (`gh api repos/<REPO>/pulls/<N>/reviews` and `.../reviews/<id>/comments`,
  `gh api repos/<REPO>/pulls/<N>/comments`). Skip anything already raised and already addressed by
  later commits; only surface what's still open or new.
- Get the full branch for real context (not just the diff): `gh pr checkout <N>`; if SSH is blocked,
  `git fetch origin refs/pull/<N>/head` then check out FETCH_HEAD. Read the changed files **and the
  code they call** (scopes, authorization, serializers, migrations) — trace the calls end to end.

### 4b. Review it as if a junior wrote it
Analyse the PR as if a junior wrote it. Do a real, thorough review and **also** keep an eye on the
choices made: simplicity, the "be clear, not clever" rule, security, etc. The list is a reminder of
things not to overlook, not the scope of the review.

### 4c. Comment style
**French**, constructive/mentoring, always explain the **why**. **Actionable only** — a decision to
make, a test to add, a change to do, a point to confirm. **No purely positive comments**
("bon réflexe", "bien joué", "rien à changer") — these are request-changes reviews. Be concise;
quality over quantity.

### 4d. Deliver the review

**Dry-run mode** — write nothing to GitHub. Don't call any write endpoint (`POST`/`PUT`/`DELETE`) and
don't run `gh pr review`. Build the exact review you *would* have posted (head sha, body, and every
inline comment with `path`, `line`, `side`, `body`) and return it to the orchestrator so it gets
rendered in the chat (see Step 5). Resolving line numbers still matters — they're part of the output.

**Live mode** — post the review as PENDING (strict mechanics):
- First check no pending review of mine already exists (one draft per user/PR):
  `gh api repos/<REPO>/pulls/<N>/reviews --jq '.[] | select(.user.login=="<ME>") | "\(.id) \(.state)"'`.
  If a PENDING one exists, report it and don't create a second.
- Write the payload **inside the repo dir** (the sandbox isolates `/tmp`, so `gh --input /tmp/...`
  fails), e.g. `./.review_<N>.json`:
  ```json
  {
    "commit_id": "<HEAD_SHA>",
    "body": "<summary + cross-cutting remarks not tied to a line>",
    "comments": [
      {"path": "path/file.rb", "line": <line in the NEW file version>, "side": "RIGHT", "body": "..."}
    ]
  }
  ```
- `line` = line number **in the file** (new version), present in a diff hunk. Use `side: "RIGHT"`
  only (avoid deleted lines). For new files, it's still the file line number, not the diff position.
- Post in a **single** request:
  `gh api --method POST repos/<REPO>/pulls/<N>/reviews --input ./.review_<N>.json --jq '"\(.id) \(.state)"'`
- **FORBIDDEN**: never include an `"event"` field, never run `gh pr review`. The absence of `event`
  is exactly what keeps the review a draft; either one would submit it immediately.
- On `422 "line could not be resolved"`: fix the line number (or move that point into `body`) and
  re-post the whole payload. Iterate until `state=PENDING`. Delete the payload file afterwards.

### 4e. Worktree cleanup
After the subagents finish, remove their worktrees and temp branches
(`git worktree remove --force ...`, `git worktree prune`, delete `worktree-agent-*` branches) and
confirm the default branch (usually `master` or `main`) is clean.

## Step 5 — Report back

**Live mode** — a recap table: `Repo#PR | review id | PENDING | nb commentaires | points saillants`.
For each review, verify `state=PENDING` and `submitted_at=null`. Remind me that a pending review is
visible **only to me** (with a "Pending" badge) until I click **Submit review** on the UI, and that
the `GET /pulls/<N>/comments` endpoint does **not** list pending comments (use
`.../reviews/<id>/comments`).

**Dry-run mode** — render here what *would* have been posted, nothing sent to GitHub. For each PR,
print a section: a `Repo#PR — title` header, the review **body**, then each inline comment as
`path:line — comment` (a list or small table). End with a one-line reminder that this was a dry-run
and that re-running without `dry-run` is what would actually create the pending reviews.

## Step 6 — Publish a review, only when I explicitly ask

Everything above leaves reviews **PENDING** — never submit on your own initiative. When, and only
when, I explicitly ask you to publish / submit / send the review, do this:

1. **Ask me the review type first — always, before submitting anything.** A submitted review is
   **immutable**: its event (`COMMENT` / `REQUEST_CHANGES` / `APPROVE`) cannot be changed afterward, so
   never guess or default silently. Use **AskUserQuestion** (header e.g. `Type de review`) with:
   - **Request changes** *(Recommended)* — the comments are actionable/blocking (this skill's default posture).
   - **Comment** — neutral, non-blocking feedback.
   - **Approve** — good to merge.
2. **Submit my PENDING review with the chosen event** — this keeps the body and inline comments already
   attached, so don't re-post them:
   ```
   gh api repos/<REPO>/pulls/<N>/reviews --jq '.[] | select(.user.login=="<ME>" and .state=="PENDING") | .id'
   gh api --method POST repos/<REPO>/pulls/<N>/reviews/<review_id>/events \
     -f event=<COMMENT|REQUEST_CHANGES|APPROVE> --jq '"\(.id) \(.state) \(.submitted_at)"'
   ```
   If no PENDING review of mine exists (e.g. it was already submitted once), a submitted review can't be
   converted — create a **new** review carrying the `event` field directly. Keep its body short and
   point back to the existing inline comments instead of duplicating them.
3. Confirm the resulting `state` back to me (`CHANGES_REQUESTED` / `COMMENTED` / `APPROVED`).
