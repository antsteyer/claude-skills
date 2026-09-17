---
name: resolve-conflicts
description: >-
  Resolve the merge conflicts of an open PR (or rebase a branch onto its
  updated base) by replaying it onto the PR's REAL base branch, detecting
  squash-merged or stacked ancestors first, resolving conflicts file by file,
  running the checks the conflicted files call for, then asking before the
  `--force-with-lease` push. Works in agorize-front and agorize-core. Use when
  the user says "/resolve-conflicts [PR#]", "résous les conflits", "la PR a des
  conflits", "rebase sur la base", "rebase ma branche", or "fix the PR
  conflicts".
---

# /resolve-conflicts — Get a PR back to mergeable

## Hard rules

- **The target is the PR's base branch** (`baseRefName`), never the branch's
  own `origin/<branch>` and never `master` by assumption: a stacked PR targets
  another feature branch.
- **Never work in the main checkout** and never `git checkout` another branch
  there. Run everything in the worktree that holds the PR branch (Step 1).
- **Ask before every force push**, even with `--force-with-lease`. A previous
  authorization does not carry over.
- Never `git push --force`, never `--no-verify`, never `git rebase -i`.
- Never resolve a conflict by blindly taking one side (`-X ours/theirs`,
  `git checkout --ours <file>`) on a code file: read both sides and merge the
  intent. Only exception: generated files, see Step 4.
- No commit other than the rebase replay itself (or the merge commit in merge
  mode) — no drive-by fix while resolving.

## Step 1 — Identify the PR and its worktree

Argument: optional PR number. Without one, use the PR of the current branch.

```bash
gh pr view [<PR#>] --json number,url,headRefName,baseRefName,mergeable,mergeStateStatus
```

Then find where the head branch is checked out:

```bash
git worktree list
```

- The current directory already holds `headRefName` → work here.
- Another worktree holds it → work there, with absolute paths (`git -C <path>`).
- No worktree holds it → stop and suggest `/worktree` (or ask which base to
  create one from). Never check the branch out in the main checkout.

Refuse to start if the working tree is dirty (`git status --short` not empty):
report the files and let the user decide (commit, stash, discard).

## Step 2 — Diagnose before touching anything

```bash
git fetch origin
git log --oneline origin/<base>..HEAD        # commits the PR brings
git log --oneline HEAD..origin/<base> | head -30   # what moved on the base
```

Look for the usual root cause — **a squash-merged or rewritten ancestor**:

- Was the branch stacked on another feature branch that has since been
  squash-merged into `<base>`? Check `gh pr list --state merged --search <that-branch>`
  and `git log origin/<base> --grep <ticket-id>`.
- Does `origin/<base>..HEAD` list commits that already landed on `<base>`
  under a squash commit? Compare with `git cherry -v origin/<base> HEAD`
  (`-` = patch already upstream; a squash hides them, so also compare subjects
  and ticket ids).
- Was `<base>` itself rebased (stacked PR whose parent was force-pushed)?
  Compare `git merge-base HEAD origin/<base>` with the parent's old tip.

Pick the replay command and **state the diagnosis in plain text** (cause +
commits that will be replayed + commits that will be dropped):

| Situation | Command |
|-----------|---------|
| Base simply moved forward | `git rebase origin/<base>` |
| Branch stacked on `<old-parent>` which is now squash-merged into `<base>` | `git rebase --onto origin/<base> <last-commit-of-old-parent> HEAD` |
| `<base>` was itself rewritten | `git rebase --onto origin/<base> <old-base-tip> HEAD` |

`<last-commit-of-old-parent>` is the last commit that belongs to the parent
branch, not to this PR — confirm it from `git log` before using it. When the
list of commits to drop is not obvious, ask the user rather than guess.

The PR's GitHub base should also be right: a stacked PR whose parent is merged
must be retargeted (`gh pr edit <PR#> --base <new-base>`) — **ask first**, it
is visible to reviewers.

### Merge mode (exception)

Rebase is the default. Use `git merge origin/<base>` instead only when the user
asks for it (e.g. the PR is under review and they want to keep the history).
Merge mode ends with a regular push — no force needed.

## Step 3 — Replay

Run the chosen command. On each stop:

```bash
git status --short
git diff --name-only --diff-filter=U
```

For each conflicted file, read the conflict hunks **and** the upstream change
that caused them (`git log -p -1 origin/<base> -- <file>` or
`git log origin/<base> -- <file>`), then write the merged version. Typical
agorize cases:

- A renamed constant, route, prop or store getter upstream → keep this PR's
  change, applied to the new name. Grep the whole tree for the old name after
  the rebase (`src/`, `tests/`, `tests/helpers/mocks/` or `app/`, `spec/`):
  a rename that did not conflict can still leave dead references.
- Both sides added an `it()`/`describe` or an import → keep both, respect the
  spec ordering conventions (negative case first, `when the api call fails` last).
- Both sides added translation keys in `config/locales/en.yml` / `fr.yml` →
  keep both, keep the alphabetical/nesting order, then run `ac_t` once at the
  end if a locale file changed.

In agorize-front, format each hand-resolved file before staging it
(`bunx eslint --fix` for `.ts`/`.js`/`.vue`, `bunx stylelint --fix` for
`.scss`, then `bunx prettier --write`). Then `git add <file>` and
`git rebase --continue` (with `GIT_EDITOR=true` to keep
the replayed message). If a commit becomes empty because its content already
landed, `git rebase --skip` is fine — say so in the report.

If the resolution turns into a real design question (both sides changed the
same logic differently), stop and ask with the two versions side by side.
`git rebase --abort` is always available and leaves the branch untouched.

## Step 4 — Generated files

Never hand-merge them; regenerate:

- `bun.lock` → take `<base>`'s version then `bun install`.
- `yarn.lock` (agorize-core) → take `<base>`'s version then `yarn install`.
- `Gemfile.lock` → take `<base>`'s version then `bundle install`.
- `db/schema.rb` → take `<base>`'s version, re-add this PR's tables/columns,
  set the `version:` to the highest migration timestamp of both sides; then
  `bin/rails db:migrate` and check `git diff db/schema.rb` only contains this
  PR's changes.

## Step 5 — Verify

Scale to what the conflicts touched:

- **agorize-front**
  - Conflicted or renamed-around `.ts`/`.vue` → run their specs:
    `npx vitest run <specs>`.
  - A signature, interface or exported symbol changed upstream → `bun run typecheck`.
  - Files resolved by hand are formatted in Step 3, before their `git add`
    (`bunx eslint --fix`, `bunx stylelint --fix`, `bunx prettier --write`), so
    the replayed commit already carries the formatted version.
- **agorize-core**
  - `bundle exec rspec <specs of the conflicted files>`.
  - Migrations in the diff → `bin/rails db:migrate` (Step 4).
- No conflict at all → no check needed beyond `git log --oneline origin/<base>..HEAD`.

Never run the full suite. Never run `bun run lint`: the `pre-push` hook does.

If a check fails, report it and stop — do not push.

## Step 6 — Push (with confirmation)

Show in plain text:

- the diagnosis (one sentence),
- `git log --oneline origin/<base>..HEAD`,
- the files resolved by hand and how,
- the checks run and their result.

Then ask (`AskUserQuestion`, in French) whether to push. On yes:

```bash
git push --force-with-lease origin <headRefName>   # rebase mode
git push -u origin <headRefName>                    # merge mode
```

Verify the current branch name first. If `--force-with-lease` is rejected,
someone pushed meanwhile: fetch, report the new remote commits, and stop.

## Step 7 — Confirm mergeability

GitHub recomputes asynchronously; one re-check is enough:

```bash
gh pr view <PR#> --json mergeable,mergeStateStatus
```

`UNKNOWN` right after the push is normal — report it as such, do not poll.

Final report: PR URL, cause, commits replayed/dropped, files resolved,
checks, push result, mergeable state. If the push dismissed approvals or
invalidated review threads, mention it.
