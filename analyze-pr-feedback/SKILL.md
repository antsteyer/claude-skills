---
name: analyze-pr-feedback
description: >-
  Read-only analysis of the unresolved feedback on the current branch's PR:
  fetch unresolved review threads, review bodies, and general PR comments, read
  the code each one touches, and give Claude's point-by-point verdict (agree /
  disagree / to discuss) with reasoning citing path:line and a suggested action.
  Never edits code, commits, posts, or resolves threads — analysis only. Use when
  the user says "analyse les retours de la PR", "qu'est-ce que tu penses des
  commentaires de review", "analyze PR feedback", or "/analyze-pr-feedback [PR#]".
---

# PR Feedback Analysis (read-only)

**Analysis only. No file edits, no commits, no posted comments, no thread resolution, no worktree.** The single deliverable is a written point-by-point analysis for the user to read. Output language: **French** (the user's working language).

## Step 1 — Identify the PR

If a PR number was passed as argument, use it. Otherwise detect from the current branch:

```bash
gh pr view --json number,url,headRefName,title 2>/dev/null
```

If no PR exists for the branch, say so and stop. If detection is ambiguous, confirm the number with the user before continuing.

Get `owner`/`repo` for the GraphQL call:

```bash
gh repo view --json owner,name
```

## Step 2 — Fetch all the feedback

Pull from three sources so nothing a reviewer left is missed.

### 2a. Unresolved inline review threads (GraphQL)

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          comments(first: 20) {
            nodes { body author { login } createdAt }
          }
        }
      }
    }
  }
}' -f owner=<owner> -f repo=<repo> -F pr=<PR#>
```

Keep only threads where `isResolved == false`. Note `isOutdated == true` threads but do **not** drop them — flag them as "outdated diff" since the line may have moved; they often still carry a valid point.

### 2b. Review bodies (summary + non-inline nits)

Reviewers often put real asks in the review summary, not on a line. Don't skip these.

```bash
gh pr view <PR#> --json reviews
```

Keep reviews whose `body` is non-empty. Ignore pure `APPROVED` reviews with empty bodies.

### 2c. General PR (issue) comments

```bash
gh pr view <PR#> --json comments
```

Keep comments with substantive content (skip bot noise / CI status chatter unless it raises a real concern).

De-duplicate: if the same point appears inline and in a review body, treat it as one item.

If there is **nothing** unresolved across all three sources, report that the PR has no open feedback and stop — don't manufacture points.

## Step 3 — Ground each point in the code

This is what makes the analysis worth more than re-reading the comment. For every actionable item:

- Open the file at the referenced `path:line` (use `originalLine` if `line` is null on an outdated thread) and read enough surrounding context to actually judge the reviewer's point.
- For a `.vue` or `.ts` file, also glance at the matching `.spec.ts` when the comment concerns behavior or tests.
- Verify the current state of the code: if it already reflects what the reviewer asked, say so (the thread may be stale).

Every claim about how the code behaves must cite a concrete `path:line`. If you genuinely can't verify a point from the code (e.g. it's a design/product question), mark it **`non vérifiable dans le code`** rather than guessing — don't infer behavior from naming.

For non-inline review/comment points that don't name a file, locate the relevant code yourself (grep for the symbol/component mentioned) before forming a verdict.

## Step 4 — Form a verdict per point

For each item, decide one verdict and justify it:

| Verdict | When |
|---------|------|
| ✅ **D'accord** | The reviewer is right; the change is worth making. |
| ❌ **Pas d'accord** | The point is incorrect, already handled, or out of scope. Explain why, with code evidence. |
| 🤔 **À discuter** | Legitimate but a judgment call / needs the reviewer's or user's input (trade-off, product decision, ambiguous intent). |

Be honest and specific — the value is in a real opinion, not in agreeing with everything. When you disagree, the burden is on you to cite the code that proves it.

## Step 5 — Output the analysis

Lead with a one-line orientation, then a summary table, then one detailed block per point. Use this structure:

```markdown
## Analyse des retours — PR #<N> (<title>)

<X> retours non résolus : <a> ✅ d'accord · <b> ❌ pas d'accord · <c> 🤔 à discuter.

| # | Emplacement | Auteur | Verdict | En une phrase |
|---|-------------|--------|---------|---------------|
| 1 | `src/foo.vue:42` | @reviewer | ✅ D'accord | Le `mapState` devrait passer en `mapStores` |
| 2 | Review (résumé) | @reviewer | ❌ Pas d'accord | Le cas vide est déjà géré en `src/foo.vue:88` |
| 3 | Commentaire PR | @reviewer | 🤔 À discuter | Choix de nommage, dépend de la convention voulue |

---

### Point 1 — `src/foo.vue:42` — @reviewer
> <citation courte et fidèle du commentaire>

**Verdict :** ✅ D'accord
**Pourquoi :** <justification ancrée, citant `path:line`>
**Action suggérée :** <ce qu'il faudrait faire — décrit, pas exécuté>

### Point 2 — Review (résumé) — @reviewer
> <citation>

**Verdict :** ❌ Pas d'accord
**Pourquoi :** <preuve dans le code, `path:line`>
**Action suggérée :** Aucune — ou : répondre au reviewer que <…>
```

Notes on the output:
- Quote the reviewer faithfully but briefly; don't paste huge comment bodies.
- "Action suggérée" describes the change — it never means you'll make it. For ❌ points it's often "répondre au reviewer que …".
- Keep each block tight. The summary table is the scannable layer; the blocks are the detail.

## Rules

- **Never** edit files, run `git add/commit/push`, post via `gh pr comment` / `gh pr review`, or call any `gh api` mutation (including resolving threads). This skill only reads and reports.
- Don't assert code behavior you haven't read — cite `path:line` or mark the point `non vérifiable dans le code`.
- Don't pad: if a reviewer's point is trivial, a one-line block is fine. If there's no unresolved feedback, say so and stop.
- Reviewer is not always right — disagreeing with evidence is the point of this skill, not a failure mode.
