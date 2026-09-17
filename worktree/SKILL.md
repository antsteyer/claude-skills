---
name: worktree
description: >-
  Create a git worktree as a sibling of the current repo for a GitHub issue or
  Jira ticket. Auto-detects the arg type (numeric = GitHub issue,
  `PROD-XXXX` = Jira ticket), proposes a branch name, asks the base branch,
  copies `.env*` and `.tool-versions` files, installs dependencies
  (`bun install` by default; `bundle install` + `yarn install` for
  agorize-core), runs the pending migrations for agorize-core, and (for GitHub issues) assigns the issue to the current GitHub user. Use
  when the user says
  "create a worktree", "worktree for #N", "worktree PROD-XXXX", or
  "/worktree".
---

# Worktree Setup Workflow

## Instructions

### Step 1: Parse the argument

The skill takes one positional argument:

- Numeric (e.g. `2969`) → **GitHub issue mode**
- `PROD-XXXX` → **Jira ticket mode**
- Anything else → ask the user to clarify

Store the detected mode as `MODE` and the identifier as `ID`.

### Step 2: Fetch metadata to propose a branch name

**GitHub issue mode** — fetch the issue title and labels:

```bash
gh issue view <ID> --json title,labels
```

**Jira ticket mode** — fetch the ticket summary via the Atlassian MCP (`mcp__plugin_atlassian_atlassian__getJiraIssue`) with the cloud ID for `agorize.atlassian.net`.

From the title/summary, generate a short kebab-case slug (≤ 5 words, no stop words). Combine with the prefix convention:

- GitHub issue: `<ID>-<type>/<slug>` — e.g. `2969-fix/dropdown-mapping`
- Jira: `PROD-XXXX-<type>/<slug>` — e.g. `PROD-7540-fix/dropdown-mapping`

Pick `<type>` from the issue labels/summary (`fix`, `feat`, `chore`, `perf`, `refactor`, `docs`). Default to `feat` if uncertain.

### Step 3: Confirm branch name and base branch with the user

Use `AskUserQuestion` to confirm both at once:

1. The proposed branch name (offer to edit).
2. The base branch — **always ask**, even if `origin/master` is the obvious default. Offer `origin/master` first, then `origin/main`, then "Other".

Do **not** proceed without explicit confirmation on both.

### Step 4: Create the worktree

Determine the repo name from the current working directory (e.g. `agorize-front`). Create the worktree as a **sibling** of the repo, never nested inside it:

```bash
git worktree add ../<repo-name>.worktrees/<branch-name> -b <branch-name> <base-branch>
```

If the branch already exists on the remote, drop `-b` and let git check it out.

### Step 5: Copy `.env*` and `.tool-versions` files

```bash
cp .env* ../<repo-name>.worktrees/<branch-name>/ 2>/dev/null || true
cp .tool-versions ../<repo-name>.worktrees/<branch-name>/ 2>/dev/null || true
```

`.tool-versions` is gitignored (untracked), so a fresh worktree won't inherit
it — copying it from the main repo pins the same Ruby/Node/Python versions and
avoids a `Bundler::RubyVersionMismatch` when running `bundle exec` (this bites
agorize-core in particular). If no `.env*` or `.tool-versions` files exist,
skip silently.

**agorize-core only — pin Ruby 3.4.9.** `origin/master`'s `Gemfile` requires
`ruby '3.4.9'`, but the main repo's copied `.tool-versions` may still be on an
older Ruby (e.g. `3.1.6` if it's checked out on a pre-bump branch). Always
overwrite the worktree's Ruby to 3.4.9 so `bundle` and `ac_t` resolve correctly:

```bash
(cd ../agorize-core.worktrees/<branch-name> && asdf set ruby 3.4.9)
```

If Ruby 3.4.9 isn't installed yet, install it first: `asdf plugin update ruby
&& asdf install ruby 3.4.9` (the ruby-build plugin must be current or 3.4.9
reports "Version not found").

### Step 6: Install dependencies

The install commands depend on the repo.

**agorize-core** — the Ruby/Node/Python versions come from the `.tool-versions` copied in Step 5; just install Ruby and JS deps:

```bash
(cd ../agorize-core.worktrees/<branch-name> && \
  bundle install && \
  yarn install)
```

Use a generous timeout (e.g. `timeout: 600000`) — `bundle install` and `yarn install` can each take several minutes on a cold worktree. Run in the foreground so the user sees completion. If Step 5 found no `.tool-versions` to copy (e.g. the main repo lacks one), pin manually first with `asdf set ruby 3.4.9 && asdf set nodejs 16.18.1`.

**Any other repo** (e.g. agorize-front) — run `bun install`:

```bash
(cd ../<repo-name>.worktrees/<branch-name> && bun install)
```

This can take 1–2 minutes; run it in the foreground so the user sees completion before continuing.

### Step 7: Run the pending migrations (agorize-core only)

Skip this step for any other repo, and when the dependency install of Step 6 failed.

```bash
(cd ../agorize-core.worktrees/<branch-name> && bundle exec rake db:migrate)
```

The worktree uses the same local database as the main repo (`.env*` copied in Step 5), so
this applies the migrations of the base branch that the local database hasn't run yet.
If the database does not exist, report the error and stop this step — don't create it:
choosing between `db:create db:migrate` and `db:schema:load` is the user's call.

`db:migrate` rewrites `db/schema.rb` from the local database, which can carry columns or
versions from other branches. The worktree must start clean, so revert it:

```bash
(cd ../agorize-core.worktrees/<branch-name> && git status --short db/schema.rb)
```

If it shows a change, restore the committed version — this touches only the new worktree,
never the main repo:

```bash
(cd ../agorize-core.worktrees/<branch-name> && git restore db/schema.rb)
```

Then confirm `git status --short` is empty in the worktree (the copied `.env*` and
`.tool-versions` are gitignored).

### Step 8: Assign GitHub issue (GitHub mode only)

```bash
gh issue edit <ID> --add-assignee @me
```

Skip this step in Jira mode.

### Step 9: Report

Return a short summary:

- Worktree path: `../<repo-name>.worktrees/<branch-name>`
- Branch: `<branch-name>` (based on `<base-branch>`)
- `.env*` and `.tool-versions` copied: yes/no
- Dependency install: ok/failed (`bun install`, or `bundle install` + `yarn install` for agorize-core)
- Migrations (agorize-core): applied / nothing pending / failed, and whether `db/schema.rb` was reverted
- Issue assigned: yes (GitHub mode) / skipped (Jira mode)

Remind the user that subsequent work for this branch must happen from the worktree directory, not the main repo.

## Rules

- **Never** create the worktree inside the main repo (e.g. under `.claude/worktrees/`). It breaks Vitest 4 `setupFiles` resolution and the Vite 8 dev-server watcher (see CLAUDE.md).
- **Always** ask the base branch — do not assume `origin/master` even when it's the obvious choice.
- **Never** run `git checkout` in the main repo as a fallback if the worktree creation fails — surface the error to the user.
- Do not commit, push, or run tests as part of this skill. Setup only. The only command
  touching the database is `db:migrate` (Step 7); never create, drop or load a schema.
- If the dependency install fails (`bun install`, or for agorize-core `bundle install` / `yarn install`), report it but do not retry or attempt to fix — the worktree is still valid.
