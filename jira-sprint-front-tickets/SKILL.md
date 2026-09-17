---
name: jira-sprint-front-tickets
description: List all FRONT tickets for a given sprint in the Agorize PROD Jira project (agorize.atlassian.net) with content summaries and story point estimates. Use this skill when the user asks to list, show, summarize, or review front-end/FRONT tickets for a sprint, mentions a sprint number (e.g. "W17", "W18", "sprint W20"), or asks "quels tickets FRONT arrivent en W17", "résume-moi le sprint FRONT", "c'est quoi les tickets front du sprint". Always invoke this skill when a Jira sprint review for FRONT tickets is requested, even if the user just says the week number.
---

## Purpose

Fetch all `[FRONT]` tickets from a given sprint in the `PROD` Jira project on `agorize.atlassian.net`, then produce a per-ticket summary with estimated effort and a final recap table.

## Sprint name resolution

The user may provide the sprint in different formats:
- Short: `W17` → expand to `<YYYY> Q1 - W17`, where `<YYYY>` is the current year (`date +%Y`)
- Full: `2026 Q1 - W17` → use as-is

If the quarter prefix is ambiguous, infer from the week number: Q1 = W1–W13, Q2 = W14–W26, Q3 = W27–W39, Q4 = W40–W52.

## Step 1 — Fetch all tickets in the sprint

Call `mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql` with:
- `cloudId`: `agorize.atlassian.net`
- `jql`: `project = PROD AND sprint = "{sprint_name}" ORDER BY created DESC`
- `fields`: `["summary", "status", "issuetype", "labels", "components", "assignee"]`
- `maxResults`: 100
- `responseContentFormat`: `markdown`

**If the result is saved to a file (too large):** Use `jq` to extract only the needed fields before filtering:
```bash
jq '[.issues.nodes[] | {key: .key, summary: .fields.summary, status: .fields.status.name, type: .fields.issuetype.name, assignee: .fields.assignee.displayName}]' <path-to-file>
```

## Step 2 — Filter FRONT tickets

Keep only tickets whose `summary` contains `[FRONT]` (case-sensitive). The tag may appear anywhere in the summary, including after `TBD` (e.g. `TBD [FRONT] ...`).

Flag tickets whose summary starts with `TBD` as **not yet qualified** — they lack specs and should not be precisely estimated.

## Step 3 — Fetch full details (all in parallel)

For every FRONT ticket identified, call `mcp__plugin_atlassian_atlassian__getJiraIssue` **simultaneously in a single turn** (do not wait between calls):
- `cloudId`: `agorize.atlassian.net`
- `issueIdOrKey`: ticket key (e.g. `PROD-7515`)
- `fields`: `["summary", "description", "status", "assignee", "issuetype", "customfield_10016"]`
- `responseContentFormat`: `markdown`

## Step 4 — Write the report

For each ticket, output a section using this format:

```
### [PROD-XXXX](https://agorize.atlassian.net/browse/PROD-XXXX) — {title without the [FRONT] tag}
**Statut:** {status} | **Type:** {Bug/Story/...} | **Assigné:** {displayName ou "—"}

{2-4 sentences describing what the ticket is about, based on the functional rules and description context. Be concrete: what the user does, what changes, what the expected behaviour is.}

**Effort estimé: {N}-{M} pts** — {1-2 sentence justification based on scope, number of states, API interactions, UI complexity, etc.}

{questions block — see below}

---
```

For TBD tickets, add: *"Ticket non qualifié — specs non définies, à ne pas démarrer avant qualification."* and give a rough range only as a post-qualification estimate.

For tickets already in **Final Review** or **Done**, note the status clearly — estimate anyway for sprint load context.

### Questions block

After the effort estimate, assess whether the ticket has enough information to be implemented without ambiguity. Include a questions block **only when there are genuine gaps** — missing edge cases, unclear scope, undefined states, missing designs, no flag specified, etc.

If the ticket is well-specified (clear GIVEN/WHEN/THEN, mockup linked, translations provided, API dependency documented), omit the block entirely — don't invent fake questions.

Format when questions are needed:
```
> **Questions pour le PO :**
> - {specific, actionable question targeting a concrete gap in the spec}
> - {another question — e.g. missing error state, unclear condition, ambiguous scope}
```

Good questions are targeted and unblocking — they identify exactly what a developer would be stuck on. Avoid vague questions like "can you clarify the scope?" — instead ask "what happens if the user clears the field after adding a pending invitation?" or "is the 50% opacity applied to the logo on hover too, or only in the default state?"

TBD tickets get a fixed note instead: *"Ticket non qualifié — la description est vide. Questions minimales à poser avant de démarrer :"* followed by the most important missing elements to unblock spec writing (expected behaviour, mockup, flag, translations).

### Effort estimation heuristics (story points)

| Points | What it covers |
|--------|---------------|
| 1 pt | Pure CSS/styling, wording change, simple hint text — no logic |
| 2-3 pts | Small conditional/display logic, alignment with existing legacy behaviour |
| 3-5 pts | New UI component with multiple states, form interaction, API integration |
| 5-8 pts | Complex feature with multiple flows, cross-component impact, new data model |

## Step 5 — Recap table

Close the report with:

```markdown
### Récapitulatif

| Ticket | Titre court | Effort | Statut |
|--------|-------------|--------|--------|
| [PROD-XXXX](https://agorize.atlassian.net/browse/PROD-XXXX) | ... | X-Y pts | ... |

**Total estimé (hors TBD) : ~{min}–{max} pts**
```
