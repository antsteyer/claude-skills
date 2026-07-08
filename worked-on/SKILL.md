---
name: worked-on
description: >-
  Summarize what the user has worked on since a relative date ("depuis hier",
  "hier midi", "cette semaine", "ce mois-ci", "depuis lundi", etc.), across the
  current git repo and its related sibling repo/worktrees (e.g. agorize-front
  + agorize-core). Reports commits grouped by ticket/branch, worktree status
  (clean/uncommitted/unpushed), and associated PR state. Use when the user
  asks "sur quoi j'ai travaillé depuis X", "qu'est-ce que j'ai fait cette
  semaine", "résume mon activité depuis hier", or similar.
---

# /worked-on — Activity summary since a relative date

Read-only. Never commits, pushes, or modifies anything — pure reporting.

## Step 1 — Resolve the date boundary

Take the relative-date argument (e.g. `depuis hier`, `hier midi`, `cette
semaine`, `la semaine dernière`, `ce mois-ci`, `depuis lundi`, `il y a 3
jours`). Convert it to a concrete `--since` value (and `--until` if the phrase
implies a closed range, e.g. "la semaine dernière" or "le mois dernier").

Use the `currentDate` from the system reminder as "today", and compute the
boundary with the `date` shell command (macOS/BSD syntax) rather than
guessing — verify before using it in `git log`:

| Phrase | Boundary |
|---|---|
| `aujourd'hui` | today 00:00 → `date -v0H -v0M -v0S +"%Y-%m-%d %H:%M"` |
| `hier` / `depuis hier` | yesterday 00:00 → `date -v-1d -v0H -v0M -v0S +"%Y-%m-%d %H:%M"` |
| `hier midi` | yesterday 12:00 → `date -v-1d -v12H -v0M -v0S +"%Y-%m-%d %H:%M"` |
| `cette semaine` | most recent Monday 00:00 → `date -v-mon -v0H -v0M -v0S +"%Y-%m-%d %H:%M"` (if today is Monday, `date -v0H -v0M -v0S ...`) |
| `la semaine dernière` | Monday-to-Sunday of the previous week (since + until) |
| `ce mois-ci` | first day of current month 00:00 → `date -v1d -v0H -v0M -v0S +"%Y-%m-%d %H:%M"` |
| `le mois dernier` | first day → last day of previous month (since + until) |
| `il y a N jours/semaines` | `date -v-Nd` / `date -v-Nw` |

For anything ambiguous, pick the most natural reading and state the resolved
boundary in the final answer (e.g. "depuis lundi 2026-06-30 00:00") so the
user can correct it if wrong.

## Step 2 — Identify the git identity to filter on

```bash
git config user.name
```

Use this as `--author` in every `git log` call below.

## Step 3 — Identify repos to scan

Start with the current repo's root. Then check whether it's part of the
Agorize workspace pair: if the current repo is `agorize-front`, also scan
`agorize-core` (and vice versa) at
`/Users/antoinesteyer/workspaces/agorize/<other-repo>`, since front/back
tickets are frequently shipped as linked PRs. If the sibling doesn't exist or
isn't a git repo, skip it silently.

## Step 4 — Collect commits per repo

For each repo's **main working copy** (not the `.worktrees` clones — worktrees
share the same refs/object database, so `--all` from the main repo already
surfaces commits made in worktree branches):

```bash
git -C <repo> log --all --author="<name>" --since="<X>" [--until="<Y>"] \
  --pretty=format:"%h %ad %s" --date=format:"%Y-%m-%d %H:%M"
```

Group the results by ticket prefix parsed from the subject (`PROD-XXXX` or
`#N`), preserving branch/topic when the prefix repeats across unrelated work.

## Step 5 — Check worktree status per ticket/branch

For each distinct ticket/branch found, locate its worktree. Worktree folders
live at `<repo>.worktrees/<branch-name>/`, but branch names containing `/`
(e.g. `PROD-7507-feat/edit-mentor-team-assigned`) are nested one level
further (`<repo>.worktrees/PROD-7507-feat/edit-mentor-team-assigned/`) — list
the directory if the direct path isn't a git repo:

```bash
git -C <worktree-path> status --short --branch
```

Flag anything with uncommitted changes or commits ahead of the remote
(`ahead N` in the branch line, or output before `---`/no upstream).

## Step 6 — Check PR status per ticket/branch

```bash
gh pr list --search "<branch-name-or-ticket>" --state all --json number,title,state,url
```

Do this for every distinct branch found, in both repos when relevant (a
`PROD-XXXX` ticket often has one PR in `agorize-front` and one in
`agorize-core`).

## Step 7 — Report

Group the final summary by ticket (not by raw commit), most recent first:

- **Ticket/issue id + short title** (from the PR title if found, else the
  first commit's summary)
- 2-4 bullets of what was done, collapsed from commit subjects — skip noise
  commits (`style: run bun format`, "apply PR review feedback") unless
  nothing else is available
- Worktree state: clean/pushed, or call out uncommitted/unpushed work
  explicitly
- PR number + state (OPEN/MERGED/CLOSED) with a link, per repo

Do not fabricate PR numbers, links, or ticket titles — if `gh pr list` found
nothing, say no PR was found rather than guessing.
