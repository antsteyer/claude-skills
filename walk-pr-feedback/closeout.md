# walk-pr-feedback — close-out (Steps 5 and 6)

Read by `SKILL.md` when the loop ends or the user triggers the close-out mid-loop. The state file, keys and statuses are the ones defined in `SKILL.md` Step 2e.

## Step 5 — Close out: push once, then reply and resolve

Normally reached at the end of the loop — but the user can trigger it **mid-loop**
("réponds et résous ce qui est déjà traité, et push"). In that case, close out only
the points marked `done` / `answered`, leave the rest untouched in `state.json`, and
resume the loop at the next `open` point afterwards.

Steps 1–3 below run **only if at least one commit was made**. If the pass produced
nothing but replies, skip straight to the posting part.

1. Pre-push check: `bun run typecheck` (fall back to the repo's package manager),
   **only if a commit of this pass changed a signature, an interface, a type or an
   exported symbol** — or touched `.ts`/`.vue` code in a way the specs don't cover.
   Skip it when the pass only changed test labels, literals, CSS or comments. Never
   `bun run lint`: the commit hook already linted each commit's staged files, and the
   local `pre-push` hook lints the pushed changes. Not the test suite either — the
   specs were handled at 4c. If the typecheck fails, report and stop — don't push.
2. **Ask before pushing.** Unlike `/ship`, invoking this skill is not authorization to
   push — the user gated commits and replies, never push. `AskUserQuestion`:
   *pousser maintenant* / *je pousse moi-même* / *rester local*. On anything but the
   first, skip the push, hold the replies (they reference pushed fixes), and jump to
   Step 6 listing what's left to do.
3. `git push -u origin "$(git branch --show-current)"` — never a bare `git push`. Verify the branch
   name first; **never push to master**. If the `pre-push` lint hook blocks the push,
   report the failure and stop.

Then post the replies validated during the loop, **in-thread**, never top-level, from
the files written during the loop:

```bash
gh api repos/<owner>/<repo>/pulls/<PR#>/comments \
  -F body=@$HOME/.claude/pr-feedback/<owner>-<repo>-<PR#>/reply-<databaseId>.md \
  -F in_reply_to=<comment databaseId>
```

The reply file is written without escaping. Every reply starts with `🤖`. Mark the point
`reply: posted` in `state.json` as each one lands.

For points raised in a review body or a general PR comment (no thread), reply with
`gh pr comment` — **one comment per review body (or per general PR comment), never one
comment per point**. Merge the approved drafts of that review into a single body: one
`🤖` at the very top, then one short section per point (a bold one-line label naming
the ask, then the drafted answer without its own `🤖`), in the review's order. Write
the merged body to `reply-review-<reviewId>.md` and post that file. Mark every point
it covers `reply: posted` once it lands.

Then resolve only the threads whose **fix was pushed**:

```bash
gh api graphql -f query='mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } }
}' -f threadId=<thread id>
```

Threads answered with a disagreement, a discussion reply or a parked point stay
**open** — the reviewer closes those. Resolve one anyway only if the user explicitly
asks. If the user says a thread was resolved by mistake, reopen it:

```bash
gh api graphql -f query='mutation($threadId: ID!) {
  unresolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } }
}' -f threadId=<thread id>
```

### Relancer la review — et le ticket si la review venait d'une IA

Once the threads are resolved, two closing actions, in this order. Both run only on a
**final** close-out — every point in `state.json` is `done`, `answered` or `skipped`,
nothing left `open` or `parked`, and this pass pushed or posted something. Three cases
skip them, each announced in one line so the user knows they're deferred, not lost:

- a **mid-loop** close-out (Step 5 triggered with points still to walk) — post the
  replies, resolve the threads, then go back to the loop
- points still `parked` — the PR isn't ready for re-review while one waits on the PO
- the user chose *je pousse moi-même* / *rester local* — nothing is on the remote yet

Once run, set `"closeout": "<ISO date>"` at the top level of `state.json`; a later pass
on the same PR that adds no new point must not re-fire the transition.

**1. Re-request the review on GitHub — always, whoever the reviewer was.** Resolving a
thread doesn't put the PR back in anyone's queue; the review has to be asked for again.
For every reviewer whose feedback was handled in this pass:

```bash
gh api repos/<owner>/<repo>/pulls/<PR#>/requested_reviewers \
  -X POST -f "reviewers[]=<login>"
```

That REST endpoint is the re-request primitive — it puts back a reviewer who has
*already submitted* a review, which is exactly the case here.
`gh pr edit <PR#> --add-reviewer <login>` is the fallback if it errors; it takes a
comma-separated list but doesn't accept `@me` / `@copilot`.

The logins come from `reviewers` in `state.json` (2e), not from the fresh fetch — a
thread resolved in an earlier pass is no longer returned by 2a. Skip the PR author's
own login (GitHub rejects a self-request) and bot accounts (`<name>[bot]`), which that
endpoint can't re-request.

Read the result back rather than trusting the exit code — reporting « review
redemandée » when nothing reached the queue is worse than failing loudly:

```bash
gh pr view <PR#> --json reviewRequests
```

If a login is missing from it, say so instead of claiming the re-request landed. A
failure (no write access, reviewer removed from the repo) is reported in one line and
never blocks the close-out. A companion PR walked at 2d gets its own re-request.

**2. Transition the Jira ticket to "Final Review" — only for an AI review.** Two
conditions, both required:

- the branch carries a `PROD-XXXX` prefix (no Jira ticket → nothing to transition), and
- at least one handled point carries `aiAuthored: true` in `state.json` — a reviewer
  comment starting with `🤖`, authored by someone other than the PR author.

The second check is the one to get right: the user's own replies posted by this very
skill also start with `🤖`, which is why the flag is set at fetch time (2e) and read
here rather than recomputed. No `aiAuthored` point → the review was human: leave the
ticket where it is.

When both hold, call `mcp__plugin_atlassian_atlassian__transitionJiraIssue`
(`cloudId: agorize.atlassian.net`, `issueIdOrKey: <PROD-XXXX>`, `transitionName: "P2P review accepted"`).
"Final Review" is the target **status**, not a transition name: from "P2P Review" the
transition leading to it is "P2P review accepted" (id `461`). Skip the call when the ticket
is already in "Final Review". If the ticket is in another status and no available transition
leads to "Final Review", say which transitions were offered and leave the ticket untouched —
don't pick a neighbouring status.

Finally, re-read the description against the pushed diff. If the fixes changed what
the PR actually does — a behaviour added or dropped, a renamed component, a removed
access right — the description is now stale: update it directly with
`gh pr edit <N> --body-file <file>` (both PRs if a companion one was walked), without
asking first, and say in one line what changed in it.

## Step 6 — Final report

```markdown
## PR #<N> — <X> points traités

| # | Emplacement | Verdict | Action | Tests | Commit | Réponse |
|---|-------------|---------|--------|-------|--------|---------|
| 1 | `src/foo.vue:42` | ✅ | `mapStores` | PASS | `a1b2c3d` | postée + résolu |
| 2 | Review (résumé) | ❌ | aucune | — | — | postée, thread ouvert |
| 3 | `src/baz.vue:88` | 🤔 → ✅ | prop renommé | PASS | `e4f5g6h` | postée + résolu |
| 4 | `src/old.vue:5` | ⏸ | en attente du PO | — | — | thread ouvert |
| 5 | `tests/foo.spec.ts:12` | ✅ | libellé `it()` | non lancés | `c3d4e5f` | postée + résolu |

Threads laissés ouverts : #2 (en attente du reviewer), #4 (en attente du PO).

Review redemandée à @reviewer · Jira PROD-7705 passé en « Final Review » (review IA).
```

The last line states both close-out actions: who the review was re-requested from, and
whether the ticket moved to "Final Review" — or why it didn't (pas de ticket Jira,
review humaine, transition indisponible, rien poussé).

State `state.json` is up to date and name the points still `open` or `parked` — the
next pass resumes from there without the user having to renumber anything.

