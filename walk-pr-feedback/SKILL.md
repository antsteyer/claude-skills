---
name: walk-pr-feedback
description: >-
  Interactive, point-by-point handling of the unresolved feedback on the current
  branch's PR. Builds a numbered inventory first — merged with the persisted state of
  any earlier pass on the same PR — then walks one point at a time: reads the code,
  forms a verdict, and either applies the fix and asks the user to validate before
  committing, asks the user to choose when several solutions or a judgment call are on
  the table, parks the point when it waits on a third party, or drafts a reply to the
  reviewer and asks for validation before sending it. Asks before pushing once at the
  end, then posts the approved replies in-thread, resolves the threads it addressed,
  re-requests the review on GitHub, and moves the Jira ticket to "Final Review" when
  the review it handled was AI-authored.
  Use when the user says "traite les retours de la PR", "on reprend les commentaires un
  par un", "handle PR feedback", or "/walk-pr-feedback [PR#] [start-index]".
---

# Interactive PR Feedback Walkthrough

Cheaper and more controllable than a batch pass: the feedback is inventoried once,
then handled **one point at a time**, with the user in the loop at every branch.
Only the code a given point touches is read, and only when that point comes up.

**This skill is allowed to edit, commit, push, post replies and resolve threads** —
but never without the user's explicit validation for that specific point.
Output language: **French** (the user's working language).

A PR is rarely walked in one sitting — the same PR typically comes back over several
sessions and several days. Everything that survives a session lives in the **state
file** (Step 2d), never only in context.

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

Four sources, one pass. This is the only network-heavy step.

### 2a. Inline review threads (GraphQL)

The script returns each thread's `id` **and** each comment's `databaseId` — they are
needed later for the in-thread reply, the resolve mutation and the state file key.

```bash
bash ~/.claude/skills/_shared/pr-threads.sh <owner> <repo> <PR#>
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

### 2d. The companion PR in the sibling repo

A front ticket usually has a back PR, and its review often lands on the front. Look
for a PR carrying the same ticket prefix (`PROD-XXXX` / `#N`) in the sibling repo
(`agorize-front` ↔ `agorize-core`):

```bash
gh pr list --repo <org>/<sibling-repo> --state open --search "<PROD-XXXX or #N>" \
  --json number,title,url,headRefName
```

If one exists, ask **once** whether to fold its unresolved threads into the same
inventory (rerun 2a–2c against it). Points from the companion PR are tagged with
their repo in the table.

Any point requiring a back change is handled in the **agorize-core worktree of this
same ticket** — reuse it if `git worktree list` already shows one, create it
otherwise. Never work in an unrelated agorize-core worktree, and never in the main
checkout.

### 2e. Persist the state — keyed on the PR, not on the session

The scratchpad is session-scoped: a state written there is lost the moment the user
comes back tomorrow. Write instead to a stable, PR-keyed directory:

```
~/.claude/pr-feedback/<owner>-<repo>-<PR#>/state.json
~/.claude/pr-feedback/<owner>-<repo>-<PR#>/reply-<databaseId>.md
```

The directory is keyed on the PR the skill was **invoked from**, and a companion pass
(2d) writes its points into that same directory, whatever worktree you happen to be
in — otherwise the cross-repo points lose their status on the next pass. Create it
once with `mkdir -p` before the first write. `state.json` holds one entry per point:

```json
{
  "key": "<thread node id, or comment databaseId for a review body / PR comment>",
  "databaseId": 123456789,
  "source": "thread | review | comment",
  "repo": "agorize-front",
  "path": "src/foo.vue", "line": 42, "author": "reviewer",
  "gist": "une phrase",
  "body": "corps intégral de chaque commentaire du thread, non tronqué",
  "status": "open | done | parked | answered | skipped",
  "commit": "a1b2c3d", "reply": "none | drafted | posted", "note": "en attente du PO",
  "aiAuthored": true
}
```

`aiAuthored` is set at fetch time: the reviewer's comment starts with `🤖` **and** its
author isn't the PR author. Step 5 reads it to decide the Jira transition — don't
recompute it later from a thread that has since gained one of your own `🤖` replies.

Alongside the points, the file carries two top-level keys: `reviewers` (the distinct
`author.login` of every point, minus the PR author) and `closeout` (set at the end of
Step 5). Both survive the passes where a fetched thread no longer appears.

**If the file already exists, load it and merge on `key`, never on the index** — a
thread resolved or a comment added since the previous pass shifts every number. A
point absent from the fresh fetch (resolved on GitHub in the meantime) keeps its
entry for the final report but leaves the loop.

Rewrite `state.json` after **every** status change: a validated fix, a parked point,
an approved draft, a posted reply. Step 4a re-quotes the reviewer from `body`, so a
long loop can't lose the exact wording, and the fetch never has to run twice.

If nothing is unresolved across the sources, report it and stop.

## Step 3 — Print the inventory, then start point 1 in the same turn

Before reading a single line of code, output a numbered table. This is the map for
the whole session and what makes "reprends au point 4" possible.

```markdown
## Retours à traiter — PR #<N> (<title>)

<X> points, dont <Y> déjà traités lors d'un passage précédent.

| # | Emplacement | Auteur | En une phrase | Statut |
|---|-------------|--------|---------------|--------|
| 1 | `src/foo.vue:42` | @reviewer | Passer `mapState` en `mapStores` | ✅ commit `a1b2c3d` |
| 2 | Review (résumé) | @reviewer | Le cas liste vide ne serait pas géré | à traiter |
| 3 | core · `app/x.rb:8` | @reviewer | Question sur le nommage du prop | ⏸ en attente du PO |
```

The `Statut` column comes from `state.json`. It is what makes the walk resumable
without the user having to say "ne traite que le 2, les autres sont déjà faits".

No verdicts, no code reading, no opinions at this stage — a faithful one-line gist
per point is all that belongs here. The full comment body is re-printed when the point
comes up in 4a, so nothing is lost by keeping this table terse.

**Then go straight into 4a for the first point still `open`, in the same turn.** Do
not end the turn on "on y va ?" — the table already shows what remains, and the user
interrupts if they want to restrict the run. If a start index was passed as argument
(`/walk-pr-feedback 3217 4`), start at that line of the freshly printed table.

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

**The quote must also be inside every `AskUserQuestion` of the point** (4c, 4d, 4e,
4f gates). The question dialog hides the text printed before it, so a gate that only
says "on valide ?" leaves the user deciding without the comment in view. Build the
`question` field as: `Point <N>/<X> — <path:line> — @reviewer :` + the reviewer's
comment in full (for a very long comment, the whole ask with only digressions cut,
marked `[…]`) + the verdict and what was done in a few lines + the actual question.

Then read the file at `path:line` (`originalLine` if `line` is null) and enough context
around it to actually judge the point. For a `.vue` / `.ts` file whose comment
concerns behavior, also open the matching `.spec.ts`.

Re-read the file **fresh every time**, even if a previous point already opened it —
an earlier fix may have moved lines.

For a point that names no file, grep for the symbol or component mentioned.

Every claim about how the code behaves must cite `path:line`. If a point can't be
settled from the code (product or design question), mark it
`non vérifiable dans le code` rather than guessing. If it depends on what the API can
actually return, check it in the agorize-core worktree of the ticket — never assume a
payload shape.

### 4b. Classify into one of five branches

| Branche | Quand | Ce qui se passe |
|---------|-------|-----------------|
| ✅ **D'accord** | Le reviewer a raison et la correction est évidente | 4c — corriger puis faire valider |
| 🔀 **Plusieurs solutions** | D'accord sur le fond, mais ≥ 2 implémentations défendables | 4d — faire choisir |
| 🤔 **À discuter** | Point légitime mais arbitrage produit / convention / trade-off | 4e — demander la position de l'utilisateur |
| ❌ **Pas d'accord** | Point erroné, déjà traité, ou hors scope — preuve dans le code à l'appui | 4f — brouillon de réponse |
| ⏸ **En attente** | Dépend d'un tiers (PO, design, back) que l'utilisateur doit consulter | 4g — parquer, passer au suivant |

State the verdict and the `path:line` reasoning in one short block before acting.
Disagreeing is a normal outcome, not a failure mode — but the burden of proof is on
you when you do.

### 4c. ✅ D'accord — corriger, puis faire valider

1. **Check the scope before editing.** Touch only files already in the PR's diff. A
   file outside it, a shared utility, a serializer, or more than three files → stop and
   confirm the scope with the user. Before deleting an i18n key, a constant or a
   helper, grep its other usages — dropping it because *this* component no longer uses
   it is the classic miss.
2. **Look for a precedent before writing anything.** Grep the repo for an existing helper,
   util, `Base*` component, mock or an analogous spec/component that already solves the
   same thing (`grep -rn "<symbol|pattern>" src/ tests/`), and check the memory files for a
   matching `feedback_*` rule. Follow it when it exists — inventing a parallel solution is the
   most common reason a fix gets sent back. Note it as `Modèle suivi : <path:line>` (or
   `aucun précédent trouvé`) — that line goes into the gate question below.
3. Apply the fix, following the project `CLAUDE.md` and the path-scoped rules.
4. Update the matching `.spec.ts` in the same change if behavior moved: load the
   `writing-specs` skill first. Most review feedback is about tests; on top of that skill,
   these misses come back every time:
   - a literal used twice in the same `it()` → a const; **recount after every added
     assertion** — that's how a second occurrence appears unnoticed
   - no vacuous test: a non-conditional `aria-label`, tooltip or pass-through
   - explicit type annotation on every object literal
   - a test that needs `as` casts is the sign the shared mock should be enriched instead
5. **Only if the point can break something**, run the spec files touched by this
   point: `bun run test:unit <path-to-spec>`. Skip it for a change that cannot alter
   behaviour — renaming a local variable or an `it()` label, reordering, a comment,
   extracting a literal into a const. Run it as soon as logic, a conditional template
   branch, a component contract or a spec's setup/assertions change. Grep for the
   path if it isn't obvious:
   `grep -rl "ComponentName" tests/ --include="*.spec.ts"`. **Never the full suite,
   never `--maxWorkers`** — a single review point doesn't justify rerunning the whole
   project. Report `PASS` / `FAIL`, and grep the output for `[Vue warn]` — any warning
   is a bug. If it fails, try one fix iteration; if it still fails, revert and hand the
   point back to the user as `needs-manual-review`.
6. Show `git diff` for the touched files. **For a rendering point** (CSS, layout,
   responsive, visual state) a diff proves nothing: screenshot it yourself (headless
   Chrome, fresh profile) or ask the user for a capture before gating.

**Then gate — always, no exception.** A fix is never committed without this
`AskUserQuestion`, however small it looks. Its `question` carries the
`Modèle suivi : <path:line>` / `aucun précédent trouvé` line from step 2:

- **Valider et commiter** — go to 4h
- **Corriger d'abord** — the user says what to change; apply, re-run the spec if step 5 calls for it,
  re-show the diff, ask again
- **Annuler ce point** — mark the point skipped, next N. Revert with
  `git restore --source=HEAD <files>` **only in commit-per-point mode**, where HEAD
  already carries the earlier fixes. In single-commit mode (see 4h) a checkout would
  wipe a previous point's uncommitted fix to the same file — undo by re-editing.

### 4d. 🔀 Plusieurs solutions — faire choisir

Don't write code yet. Run the precedent search of 4c step 2 first: when the codebase
already does it one way, that way is a candidate and its `path:line` is in its
`description`. Put the candidates in an `AskUserQuestion`, one option each,
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

- **Valider ce brouillon** — persist it, next N
- **Reformuler** — the user says how; redraft and ask again
- **Finalement corriger** — go to 4c

Nothing is posted at this stage. Replies leave in one batch at Step 5.

**Write every approved draft the moment it's approved**, into
`~/.claude/pr-feedback/<owner>-<repo>-<PR#>/` — `reply-<databaseId>.md` for an inline
thread, `reply-review-<reviewId>-<pointKey>.md` or `reply-comment-<id>.md` for a point
coming from a review body or a general PR comment (those are posted with
`gh pr comment`, so they need a name of their own). A review body usually carries
several points: keep one file per point here, Step 5 merges them into a single
comment. Set the point to `answered` / `reply: drafted` in
`state.json`. Step 5 posts from those files; a long interactive loop is exactly the
situation where a draft held only in context gets lost.

### 4g. ⏸ En attente — parquer le point

When the user says the point depends on someone else ("j'ai posé la question au PO",
"à voir avec le design", "Marine doit trancher"), don't force a verdict and don't
guess. Set the point to `parked` in `state.json` with a one-line `note` saying what is
awaited, say it in one line, and move on to the next point in the same turn.

A parked point is never silently dropped: it shows as `⏸ en attente` in the inventory
of the next pass and in the final report, and its thread stays open. When the user
comes back with the answer ("pour le point 8, le PO veut X"), re-enter at 4c with it.

### 4h. Commit the point, then chain to the next one

One commit per validated point — it keeps the loop resumable and makes each review
point traceable. (If the user asks for a single commit at the end, hold the changes
and commit once at Step 5 instead.)

1. Format **only the files this point touched**, never the whole project:
   `bash ~/.claude/skills/_shared/format-files.sh <file1> <file2>` (non-zero exit =
   an unfixable error to fix first). Then stage explicitly: `git add <file1> <file2>`
   — never `git add -A` / `git add .`. Write the paths out in both commands, never
   through a shell variable: zsh does not word-split `$files`.
2. Prefix from the branch name: `PROD-XXXX-...` → `PROD-XXXX `, `<N>-...` → `#<N> `,
   otherwise no prefix.
3. Message in English, conventional style (`fix(scope): ...`, `update(scope): ...`),
   focused on the *why*. The `PreToolUse` hook checks prettier/eslint/stylelint on
   the staged files and blocks the commit on failure — it does not format.
4. Write the reply draft for this thread (🤖 + what changed + the `path:line`) to
   `~/.claude/pr-feedback/<owner>-<repo>-<PR#>/reply-<databaseId>.md`.
5. Update `state.json`: `status: done`, the commit sha, `reply: drafted`.
6. **Chain straight into 4a of the next point, in the same turn.** Announce
   `→ Point N+1 sur X` and carry on — never end a turn on the announcement or on a
   "j'y vais ?". The validation being asked for is on the fix (the 4c gate), never on
   whether to keep going.

**Never push inside the loop** — the pre-push lint gate would run on every point.

When the last point is done, go to Step 5.

## Steps 5 and 6 — Close out and report

When the last point is done, or when the user triggers the close-out mid-loop ("réponds et résous ce qui est déjà traité, et push"), read `closeout.md` next to this file and follow it: typecheck, ask before pushing, post the replies, resolve the threads, re-request the review, Jira transition, PR description, final report.

## Rules

- **Allowed after validation of that specific point**: file edits, commits, push,
  posted replies, thread resolution.
- **Never** post a reply the user hasn't validated, resolve a thread whose reply
  wasn't approved, push mid-loop, or push at all without asking first — invoking this
  skill authorizes the loop, not the push.
- Re-requesting the review and the "Final Review" transition are the exception: they
  are automatic once the threads are resolved, no `AskUserQuestion`. The transition
  fires only for a `PROD-XXXX` branch whose reviewer comments are `🤖`-prefixed — the
  PR author's own `🤖` replies don't count as an AI review.
- One point per turn — but a turn ends on a *validation gate*, never on "on continue ?".
  Don't read ahead and don't pre-fix point N+1.
- Every point opens with the reviewer's comment quoted **in full**. Summarizing it is
  the one economy not to make: it's the text being judged. Repeat it inside the
  `question` of every gate — the dialog hides the text printed before it.
- Don't assert code behavior you haven't read — cite `path:line` or say
  `non vérifiable dans le code`.
- Stay inside the PR's diff. A shared utility, a serializer, a file outside the diff,
  or more than three files → confirm the scope with the user before editing.
- Never run the full test suite. Only the specs touched by the current point.
- Stay on the current working tree — the user is already on the right branch. No
  worktree, no `git checkout <branch>`. A back change goes to the agorize-core
  worktree of the same ticket.
