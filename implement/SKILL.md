---
name: implement
description: >-
  Analyse a Jira or GitHub ticket, propose an implementation plan for
  validation, then implement the changes and run tests. Does NOT create a
  worktree (use /worktree first) and does NOT push (use /ship after). Use when
  the user says "/implement <url>", "implémente ce ticket", or provides a
  Jira/GitHub link and wants the code written.
---

# /implement — Analyse and implement a ticket (no worktree, no push)

Assumes the worktree is already created and the working directory is set to it.

All user-facing text — plan, `AskUserQuestion` questions and labels, report — is in **French**.

## Step 1 — Parse the input

The input is a ticket reference optionally followed by a free-form brief:

- Jira URL or `PROD-XXXX` → **Jira mode**, `ID` = `PROD-XXXX`
- GitHub issue URL or bare number → **GitHub mode**, `ID` = issue number
- Everything else is the **brief**. Extract from it:
  - Figma URLs → `FIGMA_LINKS`
  - agorize-core PR URLs → `BACK_PR`
  - hints, glossary ("Deliverables = participations answers"), scope restrictions ("on ne touche pas aux access rights") → `BRIEF`. The brief overrides the ticket when they disagree.

No identifiable ticket (empty input, a file name, a truncated paste) → ask the user before doing anything.

## Step 2 — Gather the context

**Ticket**
- Jira: `mcp__plugin_atlassian_atlassian__getJiraIssue` with `cloudId: agorize.atlassian.net`, fields `["summary", "description", "issuetype", "status", "parent", "issuelinks"]`, `responseContentFormat: "markdown"`.
- GitHub: `gh issue view <ID> --json title,body,labels`, plus the parent issue when the body references one.
- Read the parent and linked tickets too: their scope may have been narrowed since the ticket was written.

**Backend companion** (Jira mode) — find it even when the brief does not mention it.
1. **Back ticket** — a `[FRONT] …` story is usually paired with a `[BACK] …` story (sometimes `[🔥BACK]`) with the same wording, linked by `is blocked by`. Look in this order:
   - the front ticket's `issuelinks` for a summary containing `BACK`;
   - otherwise the other children of the same `parent` epic (`searchJiraIssuesUsingJql`: `parent = <PARENT> AND summary ~ "BACK"`), matched on the summary text after the prefix.
   Keep it as `BACK_ID` and read its description (endpoints, attributes, flags, access rights).
2. **Back PR** — if `BACK_PR` is absent: `gh pr list --repo Agorize/agorize-core --search <BACK_ID> --state all --json number,title,headRefName,state`. Also search with the front `ID`: a core PR named after the front ticket usually holds its translations. Read the description and diff for the contract the front consumes, and note the PR state (an unmerged back means the contract can still move).
3. **Core worktree** — run `git worktree list` in agorize-core and note the worktree matching `ID` or `BACK_ID`, if any. It is the only place to edit translations.

Nothing found → say so in the plan (« Back : aucun ticket / PR trouvé »), never guess.

## Step 3 — Analyse the codebase

Brief an `Explore` subagent with the ticket, the `BRIEF`, the backend contract, and the area the brief points to — tell it to stay there before widening. Ask:

- Which files need to change, and what exactly in each?
- **What already exists that covers part of the need?** Utils/helpers, `Base*` components and their defaults, i18n keys (`common.*` and siblings), Bootstrap 5 utility classes, store actions, test mocks under `tests/helpers/mocks/`.
- Shared serializer / utility / module impact.
- Edge cases from the AC.

**Figma** — when `FIGMA_LINKS` is set, read the layer tree of each node (not only the screenshot) and note icons, severities, variants and colors. If a state or breakpoint described in the ticket has no precise node, ask the user for it instead of guessing.

**Do not write any code yet.**

## Step 4 — Propose the plan

Present in French:

```
Fichiers à modifier :
1. src/components/Foo/Bar.vue — [changement]
2. src/stores/foo.ts — [changement]
3. tests/unit/components/Foo/Bar.spec.ts — [tests ajoutés / modifiés]

Réutilisé : [helpers, clés i18n, composants existants]
Back : [ticket BACK, PR agorize-core + état, worktree core] / aucun
Impact partagé : aucun / [détail]
Cas limites : [AC]
Découpage : un seul diff final / étapes (voir ci-dessous)
```

**Splitting** — judge from the size of the change:
- Small change (one concern, a handful of files) → a single diff reviewed at the end.
- Larger change (several concerns, store + components + routing, back + front…) → list ordered steps, each one a reviewable, self-consistent commit (e.g. 1. store + specs, 2. component + specs, 3. wiring).

Then `AskUserQuestion`: « Le plan te convient ? » with **Approuvé** / **À ajuster**. Re-present the plan after any change. **No code before approval.**

## Step 5 — Implement

Follow the approved plan. Minimal changes, no unrelated refactor.

- **Before writing or editing any `.spec.ts`**, re-read the "Spec Conventions" section of the global CLAUDE.md and the spec-related `feedback_*` memories (tooltips, grouped expects, router in `buildComponent`, mocks…). These are the rules most often corrected on this skill.
- Update the matching `.spec.ts` alongside every `.vue` / `.ts` change.
- Translations: only in the agorize-core worktree for this ticket (ask before creating one), `en.yml` + `fr.yml`, reuse existing keys first, then run `ac_t` once.
- Shared serializer, utility or module → stop, list the impact, confirm before editing.

### Step-by-step mode

When the plan was split, at the end of each step:
1. Run the specs of that step (see Step 6 rules).
2. Format only the changed files: `bunx eslint --fix`, `bunx stylelint --fix` for `.scss`, `bunx prettier --write`.
3. Show the diff summary and the proposed commit message (`PROD-XXXX ` / `#N ` prefix), then ask « Je commite cette étape ? » — **Commiter** / **À ajuster**.
4. Commit only on **Commiter**. Never push. Approving the plan does not approve the commits.

## Step 6 — Tests

- Run each changed spec **once** after editing: `npx vitest run <path>`. After a fix, re-run only the failing spec.
- At the end, run only the specs not already green since their last edit — never re-run a green spec "to confirm".
- **Never** run the full suite, `bun format` or `bun run lint` — the scope is always enumerable by grep (store name, component name, endpoint).
- `bun run typecheck` only when a signature, interface or exported symbol changes across files.
- Treat every `[Vue warn]` as a failure.
- On failure, fix the root cause; report anything left unfixed and why.

## Step 7 — Report

In French:
- Files created / modified
- Tests: pass / fail count
- Commits made (step-by-step mode) and what remains uncommitted
- Anything left before `/ship`

## Hard rules

- **Never** push — this skill stops before `/ship`.
- **Never** commit outside the step-by-step validation above.
- After a `/ship`, any follow-up work stops at the working tree: show the diff and wait for a new go-ahead.
- Scope wider than the plan (from Explore, tests, or the backend PR) → pause and confirm before expanding.
