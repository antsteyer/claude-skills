---
name: walk-pr-feedback
description: >-
  Interactive, point-by-point handling of the unresolved feedback on the current
  branch's PR. Builds a numbered inventory first, then walks one point at a time:
  reads the code, forms a verdict, and either applies the fix and asks the user to
  validate before committing, asks the user to choose when several solutions or a
  judgment call are on the table, or drafts a reply to the reviewer and asks for
  validation before sending it. Asks before pushing once at the end, then posts the
  approved replies in-thread and resolves the threads it addressed. Use when the user says
  "traite les retours de la PR", "on reprend les commentaires un par un",
  "handle PR feedback", or "/walk-pr-feedback [PR#] [start-index]".
---

# Interactive PR Feedback Walkthrough

Cheaper and more controllable than a batch pass: the feedback is inventoried once,
then handled **one point at a time**, with the user in the loop at every branch.
Only the code a given point touches is read, and only when that point comes up.

**This skill is allowed to edit, commit, push, post replies and resolve threads** —
but never without the user's explicit validation for that specific point.
Output language: **French** (the user's working language).

Sibling skill: `/analyze-pr-feedback` is the read-only overview. Use this one when
the user actually wants the feedback *handled*.

## Step 1 — Identify the PR

If a PR number was passed as argument, use it. Otherwise detect from the branch:

```bash
gh pr view --json number,url,headRefName,title 2>/dev/null
```

If no PR exists for the branch, say so and stop. If detection is ambiguous, confirm
the number with the user before continuing.

Get `owner`/`repo` for the GraphQL calls:

```bash
gh repo view --json owner,name
```

Also confirm the working tree is clean (`git status --short`). If it isn't, show the
diff stat and ask the user whether to continue on top of it or stop — uncommitted
work will otherwise get swept into a per-point commit.

## Step 2 — Fetch all the feedback (once)

Three sources, one pass. This is the only network-heavy step.

### 2a. Inline review threads (GraphQL)

The query must carry the thread `id` **and** each comment's `databaseId` — they are
needed later for the in-thread reply and the resolve mutation.

```bash
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
}' -f owner=<owner> -f repo=<repo> -F pr=<PR#>
```

Keep only `isResolved == false`. Keep `isOutdated == true` threads too — flag them
as "diff obsolète" (the line may have moved) but never drop them.

### 2b. Review bodies

```bash
gh pr view <PR#> --json reviews
```

Keep reviews with a non-empty `body` — reviewers put real asks in the summary.
Ignore `APPROVED` reviews with an empty body.

### 2c. General PR comments

```bash
gh pr view <PR#> --json comments
```

Skip bot noise and CI chatter unless it raises a real concern.

De-duplicate: the same point raised inline and in a review body is **one** item.

If nothing is unresolved across the three sources, report it and stop.

**Persist the deduplicated feedback** to `<scratchpad>/pr-<PR#>-feedback.json`, one
entry per point: index, source, `path`, `line`, thread `id`, comment `databaseId`,
author, and the **full untruncated body** of every comment in the thread. Step 4a
re-quotes from this file, so a long loop can't lose the reviewer's exact wording — and
the fetch never has to run twice.

## Step 3 — Print the inventory, then stop

Before reading a single line of code, output a numbered table. This is the map for
the whole session and what makes "reprends au point 4" possible.

```markdown
## Retours à traiter — PR #<N> (<title>)

<X> points non résolus.

| # | Emplacement | Auteur | En une phrase |
|---|-------------|--------|---------------|
| 1 | `src/foo.vue:42` | @reviewer | Passer `mapState` en `mapStores` |
| 2 | Review (résumé) | @reviewer | Le cas liste vide ne serait pas géré |
| 3 | Commentaire PR | @reviewer | Question sur le nommage du prop |
```

No verdicts, no code reading, no opinions at this stage — a faithful one-line gist
per point is all that belongs here. The full comment body is re-printed when the point
comes up in 4a, so nothing is lost by keeping this table terse.

If a start index was passed as argument (`/walk-pr-feedback 3217 4`), the inventory
was still rebuilt from a fresh fetch — a thread resolved or a comment added since the
previous run shifts every number. So **always print the full table anyway**, then
confirm with the user which line to resume from before entering the loop. Never jump
straight to 4a on a numeric argument.

## Step 4 — The loop: one point at a time

For each point N, in order. **Never batch two points into one turn.**

### 4a. Restate the reviewer's comment in full, then ground it in the code

Open every point by re-printing the feedback **verbatim and in full** — the inventory
only carried a one-line gist, so by the time point N comes up neither the user nor you
still has the actual wording in view. Don't summarize, don't trim, don't paraphrase:
the reviewer's exact words are what's being judged, and a trimmed quote is how a
misreading slips in.

```markdown
### Point <N>/<X> — `src/foo.vue:42` — @reviewer · <date>
> <corps intégral du commentaire, tel quel — code blocks, suggestions et liens compris>
```

If the thread already has several comments (reviewer's follow-up, a previous answer),
quote **all of them** in order, each attributed to its author — the discussion so far
is often what makes the ask intelligible. Same for a point that came from a review
body or a general PR comment: the whole relevant passage, not an extract.

Then read the file at `path:line` (`originalLine` if `line` is null) and enough context
around it to actually judge the point. For a `.vue` / `.ts` file whose comment
concerns behavior, also open the matching `.spec.ts`.

Re-read the file **fresh every time**, even if a previous point already opened it —
an earlier fix may have moved lines.

For a point that names no file, grep for the symbol or component mentioned.

Every claim about how the code behaves must cite `path:line`. If a point can't be
settled from the code (product or design question), mark it
`non vérifiable dans le code` rather than guessing.

### 4b. Classify into one of four branches

| Branche | Quand | Ce qui se passe |
|---------|-------|-----------------|
| ✅ **D'accord** | Le reviewer a raison et la correction est évidente | 4c — corriger puis faire valider |
| 🔀 **Plusieurs solutions** | D'accord sur le fond, mais ≥ 2 implémentations défendables | 4d — faire choisir |
| 🤔 **À discuter** | Point légitime mais arbitrage produit / convention / trade-off | 4e — demander la position de l'utilisateur |
| ❌ **Pas d'accord** | Point erroné, déjà traité, ou hors scope — preuve dans le code à l'appui | 4f — brouillon de réponse |

State the verdict and the `path:line` reasoning in one short block before acting.
Disagreeing is a normal outcome, not a failure mode — but the burden of proof is on
you when you do.

### 4c. ✅ D'accord — corriger, puis faire valider

1. Apply the fix, following the project conventions (CLAUDE.md + memory): `mapStores`
   not `mapState`/`mapActions`, Options API, BEM classes mirroring the DOM, blank line
   between sibling template elements / none between script option blocks, boolean prop
   shorthand, no `!` non-null assertion, explicit `else`, positive condition first.
2. Update the matching `.spec.ts` in the same change if behavior moved.
3. Run the affected spec: `npx vitest run <path-to-spec>`. Grep for the path if it
   isn't obvious: `grep -rl "ComponentName" tests/ --include="*.spec.ts"`.
   Report `PASS` / `FAIL`. Grep the output for `[Vue warn]` — any warning is a bug.
   If it fails, try one fix iteration; if it still fails, revert and hand the point
   back to the user as `needs-manual-review`.
4. Show `git diff` for the touched files.
5. Gate with `AskUserQuestion`:
   - **Valider et commiter** — go to 4g
   - **Corriger d'abord** — the user says what to change; apply, re-run the spec,
     re-show the diff, ask again
   - **Annuler ce point** — mark the point skipped, next N. Revert with
     `git restore --source=HEAD <files>` **only in commit-per-point mode**, where HEAD
     already carries the earlier fixes. In single-commit mode (see 4g) a checkout would
     wipe a previous point's uncommitted fix to the same file — undo by re-editing.

### 4d. 🔀 Plusieurs solutions — faire choisir

Don't write code yet. Put the candidates in an `AskUserQuestion`, one option each,
using the option `preview` field to show the actual snippet side by side. Two to
three candidates, each with its trade-off in the `description`. Put your own
recommendation first, suffixed `(Recommandé)`.

Once chosen, drop into 4c from step 1 with that solution.

### 4e. 🤔 À discuter — demander la position

Present the trade-off in three or four lines with the `path:line` evidence, then ask
via `AskUserQuestion` what the user wants:

- adopt the reviewer's proposal → 4c
- keep the current code and explain why → 4f
- a third path the user describes → 4c with that path

Whatever the outcome, the thread gets an answer — the user's position becomes the
substance of the reply drafted in 4f.

### 4f. ❌ Pas d'accord — brouillon de réponse

Draft the reply **without posting it**. It must:

- open with `🤖` (required marker for AI-authored PR content)
- be in the language the reviewer used
- cite the `path:line` that proves the point
- stay short and non-defensive — one paragraph, no lecture

Show the draft, then gate with `AskUserQuestion`:

- **Valider ce brouillon** — persist it (see below), next N
- **Reformuler** — the user says how; redraft and ask again
- **Finalement corriger** — go to 4c

Nothing is posted at this stage. Replies leave in one batch at Step 5.

**Persist every approved draft to a file the moment it's approved**, in the session
scratchpad: `<scratchpad>/pr-<PR#>-point-<i>.md`. Step 5 posts from those files, and a
long interactive loop is exactly the situation where a draft held only in context gets
lost. Note the target thread's comment `databaseId` alongside it.

### 4g. Commit the point

One commit per validated point — it keeps the loop resumable and makes each review
point traceable. (If the user asks for a single commit at the end, hold the changes
and commit once at Step 5 instead.)

1. Stage explicitly: `git add <file1> <file2>` — never `git add -A` / `git add .`.
2. Prefix from the branch name: `PROD-XXXX-...` → `PROD-XXXX `, `<N>-...` → `#<N> `,
   otherwise no prefix.
3. Message in English, conventional style (`fix(scope): ...`, `update(scope): ...`),
   focused on the *why*. The `PreToolUse` hook runs `format` on commit.
4. Write a draft reply for this thread (🤖 + what changed + the `path:line`) to
   `<scratchpad>/pr-<PR#>-point-<i>.md`, with its comment `databaseId`, for Step 5.

**Never push inside the loop** — the pre-push lint gate would run on every point.

### 4h. Next point

Announce `→ Point N+1 sur X` and loop back to 4a. When the last point is done, go to
Step 5.

## Step 5 — Close out: push once, then reply and resolve

Steps 1–3 below run **only if at least one commit was made**. If the whole loop
produced nothing but replies (all points disagreed or discussed), skip straight to the
posting part — there's nothing to push.

1. Pre-push checks, in parallel: `bun run typecheck` and `bun run lint` (fall back to
   the repo's package manager). If either fails, report and stop — don't push.
2. **Ask before pushing.** Unlike `/ship`, invoking this skill is not authorization to
   push — the user gated commits and replies, never push. `AskUserQuestion`:
   *pousser maintenant* / *je pousse moi-même* / *rester local*. On anything but the
   first, skip the push, hold the replies (they reference pushed fixes), and jump to
   Step 6 listing what's left to do.
3. `git push` (add `-u origin <branch>` if there's no upstream). Verify the branch
   name first; **never push to master**.

Then post the replies validated during the loop, **in-thread**, never top-level, from
the files written during the loop:

```bash
gh api repos/<owner>/<repo>/pulls/<PR#>/comments \
  -f body="$(cat <scratchpad>/pr-<PR#>-point-<i>.md)" -F in_reply_to=<comment databaseId>
```

Use `--body-file` / `"$(cat …)"` rather than inline escapes — backticks and `$` in a
reply break an inline `-f body=`. Every reply starts with `🤖`.

For points raised in a review body or a general PR comment (no thread), reply with
`gh pr comment` — still prefixed `🤖`.

Then resolve only the threads whose **fix was pushed**:

```bash
gh api graphql -f query='mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } }
}' -f threadId=<thread id>
```

Threads answered with a disagreement or a discussion reply stay **open** — the
reviewer closes those. Resolve one anyway only if the user explicitly asks.

## Step 6 — Final report

```markdown
## PR #<N> — <X> points traités

| # | Emplacement | Verdict | Action | Tests | Commit | Réponse |
|---|-------------|---------|--------|-------|--------|---------|
| 1 | `src/foo.vue:42` | ✅ | `mapStores` | PASS | `a1b2c3d` | postée + résolu |
| 2 | Review (résumé) | ❌ | aucune | — | — | postée, thread ouvert |
| 3 | `src/baz.vue:88` | 🤔 → ✅ | prop renommé | PASS | `e4f5g6h` | postée + résolu |
| 4 | `src/old.vue:5` | ⚠️ | revert, tests KO | FAIL | — | — |

Threads laissés ouverts : #2 (en attente du reviewer).
```

If the loop was interrupted, state exactly which point number to resume from.

## Rules

- **Allowed after validation of that specific point**: file edits, commits, push,
  posted replies, thread resolution. This is the mutating skill of the pair — don't
  inherit `/analyze-pr-feedback`'s read-only caution.
- **Never** post a reply the user hasn't validated, resolve a thread whose reply
  wasn't approved, push mid-loop, or push at all without asking first — invoking this
  skill authorizes the loop, not the push.
- One point per turn. Don't read ahead, don't pre-fix point N+1, don't collapse two
  points into one gate — the whole value is the token saving and the control.
- Every point opens with the reviewer's comment quoted **in full**. Summarizing it is
  the one economy not to make: it's the text being judged.
- Don't assert code behavior you haven't read — cite `path:line` or say
  `non vérifiable dans le code`.
- If a fix touches a shared utility, a serializer, or more than three files, stop and
  confirm the scope with the user before editing.
- Stay on the current working tree — the user is already on the right branch. No
  worktree, no `git checkout <branch>`.
