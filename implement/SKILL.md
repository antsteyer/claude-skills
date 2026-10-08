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
- Jira: `mcp__plugin_atlassian_atlassian__getJiraIssue` with `cloudId: agorize.atlassian.net`, `view: "full"`, `responseContentFormat: "markdown"`. Never narrow it with `fields`: the call then returns `fields: {}` for `parent` and `issuelinks`.
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

**Jira mode — move the ticket to Ongoing.** Once the plan is approved, if the ticket status is not already `Ongoing`, call `mcp__plugin_atlassian_atlassian__transitionJiraIssue` (`cloudId: agorize.atlassian.net`, `issueIdOrKey: <ID>`, `transitionName: "Start work"`). If that transition is not available from the current status, say so in the report — never pick another transition.

## Step 5 — Implement

Follow the approved plan. Minimal changes, no unrelated refactor.

- **Before writing or editing any `.spec.ts`**, re-read the "Spec Conventions" section of the global CLAUDE.md and the spec-related `feedback_*` memories (tooltips, grouped expects, router in `buildComponent`, mocks…). These are the rules most often corrected on this skill.
- Update the matching `.spec.ts` alongside every `.vue` / `.ts` change.
- Translations: only in the agorize-core worktree **of this ticket** (`ID`, or `BACK_ID` when the back ticket carries the core branch), `en.yml` + `fr.yml`, reuse existing keys first, then run `ac_t` once. Never write into the core worktree of another ticket, not even the parent the front branch is stacked on. No worktree for this ticket → stop and propose creating one stacked on the parent's core branch (`/worktree <ID>`, « Front + core »); don't create it without approval.
- Shared serializer, utility or module → stop, list the impact, confirm before editing.

### Step-by-step mode

When the plan was split, at the end of each step:
1. Run the specs of that step (see Step 6 rules).
   On the **last** step, also run the Chrome check (Step 6b) before showing the summary.
2. Format only the changed files: `bash ~/.claude/skills/_shared/format-files.sh` (non-zero exit = an unfixable error to fix first).
3. Show a short summary of the changes produced by this step — one bullet per file (or tight group of files): what changed and, when not obvious, why (e.g. "`MainFooter.vue` — lien cookies : classe `optanon-show-settings` en mode OneTrust, Entrée → `ToggleInfoDisplay()`"). Keep it to a few lines; no raw diff dump. Then the test/typecheck results and the proposed commit message (`PROD-XXXX ` / `#N ` prefix), then ask « Je commite cette étape ? » — **Commiter** / **À ajuster**.
4. Commit only on **Commiter**. Never push. Approving the plan does not approve the commits.

## Step 6 — Tests

- Run each changed spec **once** after editing: `npx vitest run <path>`. After a fix, re-run only the failing spec.
- At the end, run only the specs not already green since their last edit — never re-run a green spec "to confirm".
- **Never** run the full suite, `bun format` or `bun run lint` — the scope is always enumerable by grep (store name, component name, endpoint).
- `bun run typecheck` only when a signature, interface or exported symbol changes across files.
- Treat every `[Vue warn]` as a failure.
- On failure, fix the root cause; report anything left unfixed and why.

## Step 6b — End-to-end check in Chrome

Run it **once, at the end of the last step** (or of the single diff), after the specs are green and before the report / the commit question. Follow `~/.claude/skills/browser-check/SKILL.md`, with:

- **Code under test**: front = the current worktree; back = the agorize-core worktree of this ticket (`ID` or `BACK_ID`), otherwise the main agorize-core checkout.
- **Criteria**: the AC of the ticket and the Figma frames read in Step 3.
- **On a problem introduced by the change**: a clear-cut bug or a11y defect → fix it right away (code + spec), re-run the affected spec, re-check in the browser. Doubt about the expected behaviour or the scope → ask before touching anything. A pre-existing problem → don't fix it, list it in the report and offer a GitHub issue.

## Step 7 — Report

In French:
- Jira ticket (Jira mode): moved to Ongoing / already Ongoing / transition unavailable
- Files created / modified, each with a one-line summary of what changed (same format as the per-step summary)
- Tests: pass / fail count
- Chrome check (Step 6b): what was tested, fixed, still open — or why it was skipped
- Commits made (step-by-step mode) and what remains uncommitted
- Anything left before `/ship`

## Hard rules

- **Never** push — this skill stops before `/ship`.
- **Never** commit outside the step-by-step validation above.
- After a `/ship`, any follow-up work stops at the working tree: show the diff and wait for a new go-ahead.
- Scope wider than the plan (from Explore, tests, or the backend PR) → pause and confirm before expanding.
