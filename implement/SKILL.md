---
name: implement
description: >-
  Analyse a Jira or GitHub ticket, propose an implementation plan for
  validation, then implement the changes and run tests. Does NOT create a
  worktree (use /worktree first) and does NOT commit or push (use /ship after).
  Use when the user says "/implement <url>", "implémente ce ticket", or provides
  a Jira/GitHub link and wants the code written.
---

# /implement — Analyse and implement a ticket (no worktree, no ship)

Takes a single argument: a Jira ticket URL (`https://agorize.atlassian.net/browse/PROD-XXXX`),
a GitHub issue URL, or a bare GitHub issue number.

Assumes the worktree is already created and the working directory is set to it.

## Step 1 — Parse the argument

- Jira URL or `PROD-XXXX` → **Jira mode**, extract `PROD-XXXX` as `ID`
- GitHub URL or bare number → **GitHub mode**, extract the issue number as `ID`
- Anything else → ask the user to clarify

## Step 2 — Fetch ticket metadata

**Jira mode** — use `mcp__plugin_atlassian_atlassian__getJiraIssue` with `cloudId: agorize.atlassian.net`,
fields `["summary", "description", "issuetype", "status"]`, `responseContentFormat: "markdown"`.

**GitHub mode** — `gh issue view <ID> --json title,body,labels`

Extract:
- `SUMMARY` — one-line title
- `DESCRIPTION` — full body / acceptance criteria

## Step 3 — Analyse the ticket and codebase

Explore the codebase to understand what needs to change.

Use an `Explore` subagent briefed with:
- The full ticket description / acceptance criteria
- The suspected area (component names, routes, stores mentioned in the ticket)
- The question: "Which files need to change, and what exactly needs to change in each?"

The agent must return:
- A list of files to create or modify, with the minimal change needed in each
- Any shared serializer / utility impact
- Known edge cases from the ticket AC

**Do not write any code yet.**

## Step 4 — Propose an implementation plan

Present the plan to the user as a numbered list:

```
Files to modify:
1. src/components/Foo/Bar.vue — [what changes]
2. src/stores/foo.ts — [what changes]
3. tests/components/Foo/Bar.spec.ts — [what tests to add/update]

Shared impact: none / [describe if any]
Edge cases: [from AC]
```

Then use `AskUserQuestion` to ask:
- "Plan looks good?" with options **Approve** / **Needs changes** (+ free-text for changes)

**Do not write any code until the plan is approved.**

If the user requests changes, update the plan and re-present it before proceeding.

## Step 5 — Implement

Follow the approved plan strictly. Rules:
- Minimal, targeted changes — do not refactor unrelated code.
- Options API only (no Composition API / `setup()`).
- Use `...mapStores(useXxxStore)` in `computed` for store access.
- Bootstrap 5 utilities over custom CSS wherever possible.
- No `!` non-null assertions — use real types or `?? fallback`.
- Always update the `.spec.ts` file alongside any `.vue` or `.ts` change.
- For every changed `.spec.ts`, run `npx vitest run <path>` immediately after editing.

When touching a shared serializer, utility, or module used elsewhere:
stop, list the broader impact, and confirm scope with the user before editing.

## Step 6 — Run tests

After all files are written, run the full set of affected specs:

```bash
npx vitest run <spec1> <spec2> ...
```

If tests fail:
- Fix the root cause (do not suppress or skip).
- Re-run until green.
- Report any test that could not be fixed and why.

## Step 7 — Report

Summarise what was done:
- Files created / modified (with line counts)
- Tests: pass / fail count
- Anything left to do before `/ship`

## Hard rules

- **Never** commit or push — this skill stops before `/ship`.
- If the Explore agent or tests surface scope wider than the plan, pause and confirm before expanding.
