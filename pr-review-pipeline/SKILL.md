---
name: pr-review-pipeline
description: >-
  Chain the three PR passes on the PRs awaiting my review, in one go: build
  the comprehension brief (pr-brief), draw the flow when the mechanism is spread
  out (pr-flow), then leave a pending review (review-requested-prs) that reads
  both as context. Use when the user says "/pr-review-pipeline", "brief, flow et
  review", "prépare et review les PRs", or wants the three passes chained on one
  or several PRs. Pick this over review-requested-prs whenever the brief (and
  flow) must be built before the review; review-requested-prs alone is the
  review pass without that preparation.
---

# PR Review Pipeline Skill

Goal: chain the three PR skills without me relaunching each one, **without a pause**:

1. `pr-brief` — the reading path (always);
2. `pr-flow` — the diagram (only when the PR calls for it, see Step 3);
3. `review-requested-prs` — the PENDING review, fed with the brief **and** the flow.

This skill only orchestrates. Every rule of the three skills (read-only passes, named refs, no
checkout, `🤖` prefix, PENDING only, never submit) applies unchanged — read them from
`~/.claude/skills/<skill>/SKILL.md`, never paraphrase them from memory.

`gh` is authenticated. Resolve my login once: `gh api user --jq .login` (`ME`).

## Arguments

- A PR reference (URL, `<OWNER>/<REPO>#<N>`, or `#<N>` / `<N>` from inside a repo) → that PR only,
  skip Step 1. Parse out `REPO` as `<OWNER>/<REPO>` (never the bare repo name — `blocks.py report`
  builds the report path from it) and `N`; for `#<N>` / `<N>`, resolve it with
  `gh repo view --json nameWithOwner --jq .nameWithOwner`.
- `dry-run` / `--dry-run` → forwarded to the review pass only (brief and flow are read-only anyway).
- `flow` → force the flow for every PR; `no-flow` → never draw it.

State the PR list, the mode (live / dry-run) and the flow policy up front.

## Step 1 — Pick the PRs (once for all three passes)

Apply Steps 1–3 of `review-requested-prs` (discovery with `review-requested:@me`, drafts dropped,
repo then PR selection, default = all). The selection is made **once, here**: every pass below is
invoked with an explicit PR reference, so none of them asks again.

## Step 2 — Snapshot the refs and worktrees before touching anything

In each local clone involved (found as `pr-brief`, step 2 describes) **and** in
`~/workspaces/agorize/agorize-core` (a companion branch may be fetched there), record:
- the existing refs: `git for-each-ref --format='%(refname)' refs/pr-brief`;
- the existing sibling worktrees the passes may create:
  `git worktree list --porcelain | grep -E '^worktree .*/(pr-brief|pr-review)-[^/]+$'`.

The passes below share these refs and worktrees and are told to keep them; Step 5 removes only what
is absent from this snapshot — a ref or worktree already there belongs to another session.

## Step 3 — One subagent per PR, three passes in sequence

Several PRs → one `general-purpose` subagent per PR, launched in a single message so they run
concurrently. A single PR → one subagent too: the diff dumps, excerpts and probes of three passes
stay out of the main conversation, which only receives the report. **Never
`isolation: "worktree"`** (it creates the worktree inside the repo).

Give each subagent the PR (`<OWNER>/<REPO>#<N>`, URL), the mode, the flow policy and these
instructions verbatim:

> Run three passes on this PR, in order, without stopping between them. For each pass, invoke the
> skill with the Skill tool, passing the PR URL plus the extra args given below; if the Skill tool
> is unavailable, read `~/.claude/skills/<skill>/SKILL.md` and apply it as written, single-PR path.
>
> **Pass 1 — `pr-brief`.** Args: `<PR URL> — another pass follows: keep the refs/pr-brief refs`.
> Note the report path (`python3 ~/.claude/skills/pr-brief/blocks.py report <REPO> <N> brief`)
> and keep the builder `build_<N>.py` importable.
>
> **Pass 2 — `pr-flow`, only when justified.** Policy `flow` → always; `no-flow` → never;
> otherwise decide from the brief you just wrote. Draw the flow when the mechanism is spread:
> a store shared by several components or views, an event relayed across several `$emit` levels,
> route guards or redirections choosing the path, SSR vs client behaviour, a front + agorize-core
> pair forming one flow, callbacks / jobs / services on a backend, **or state and a lifecycle split
> across files that run in sequence** (config → setup files → workers, build steps, CI jobs,
> middleware chains). A plain UI change, a rename, a one-hop change, mechanical edits repeated
> across files → no flow. Either way, write down the one-line reason. Args: `<PR URL> — reuse the brief and
> build_<N>.py; another pass follows: keep the refs/pr-brief refs`. Note the report path
> (`... report <REPO> <N> flow`).
>
> **Pass 3 — `review-requested-prs`, targeted-PR mode.** Args: `<PR URL> [dry-run]` followed by:
> `Context already built: read <brief report>.json first` and, when a flow was drawn,
> `and <flow report>.json (its nodes, edges, facts and blocks are verified context)` — both only
> if their `head_sha` equals the PR's current head, otherwise ignore them and rebuild the context.
> `Do not delete the refs/pr-brief refs: the orchestrator cleans them up.`
>
> Report back — only this, never the diff or the excerpts you read: the brief path, the flow path
> or the reason there is none, the companion agorize-core PR number if any, and the review outcome
> (live: review id + state + comment count; dry-run: the full review — body and every inline
> comment with `path`, `line`, `side`, `body`).

A pass that fails does not silently stop the chain: a failed brief stops that PR (the flow and the
review depend on it) and is reported; a failed flow is reported and the review still runs with the
brief alone.

## Step 4 — Report

One table: `Repo#PR | Brief | Flow | Review`, with the brief and flow file paths (or the reason
there is no flow), then the review column as `review-requested-prs` Step 5 describes it (live:
review id, `PENDING`, comment count, key points; dry-run: the rendered review per PR, below the
table). Remind me that pending reviews stay visible only to me until I submit them on GitHub.

## Step 5 — Cleanup

After every subagent has finished, in each clone snapshotted at Step 2:
- delete the `refs/pr-brief/*` refs **absent from the snapshot** (`git update-ref -d …`);
- remove the `pr-brief-*` / `pr-review-*` sibling worktrees **absent from the snapshot**
  (`git worktree remove --force …`, then `git worktree prune`) — never one that was already there;
- confirm the working tree and current branch are exactly as they were.

Keep the report JSON and HTML files.

Publishing a review stays out of scope: if I later ask to submit one, follow Step 6 of
`review-requested-prs`.
