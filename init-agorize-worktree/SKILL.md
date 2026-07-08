---
name: init-agorize-worktree
description: >-
  Initialize an agorize-core worktree environment: copy .env and .tool-versions
  files from the main workspace, install Bundler + Yarn dependencies,
  run pending migrations, and start the Rails server. Use whenever the user
  says "init ce worktree", "initialise ce worktree", "init this worktree", or
  similar, from inside a directory under
  /Users/antoinesteyer/workspaces/agorize/agorize-core.worktrees/.
---

# Initialize an agorize-core worktree

## Preflight

Verify the current working directory is inside an agorize-core worktree before
doing anything. The path must contain `agorize-core.worktrees/`. If it doesn't,
stop and tell the user — this skill is only safe inside a worktree of
agorize-core (it copies envs from a fixed source and runs Rails commands).

```bash
pwd
```

If `pwd` does not contain `agorize-core.worktrees/`, abort with a short message.

## Steps

Run the steps in order. Stream output so the user can see progress. If any
step fails, stop and report the failure — do not blindly proceed to the next
step.

### 1. Copy .env files and .tool-versions from the main workspace

Source: `/Users/antoinesteyer/workspaces/agorize/agorize-core/`
Destination: the current worktree.

```bash
cp /Users/antoinesteyer/workspaces/agorize/agorize-core/.env \
   /Users/antoinesteyer/workspaces/agorize/agorize-core/.env.development \
   /Users/antoinesteyer/workspaces/agorize/agorize-core/.env.production \
   /Users/antoinesteyer/workspaces/agorize/agorize-core/.env.sample \
   /Users/antoinesteyer/workspaces/agorize/agorize-core/.env.test \
   .
cp /Users/antoinesteyer/workspaces/agorize/agorize-core/.tool-versions .
```

If one of the source files doesn't exist, fall back to a glob copy
(`cp /Users/antoinesteyer/workspaces/agorize/agorize-core/.env* .`) and report
which ones were copied.

### 2. Verify tool versions are pinned

`.tool-versions` is gitignored, so a fresh worktree won't inherit it — copying
it in step 1 pins the same Ruby/Node/Python versions as the main repo and
avoids a `Bundler::RubyVersionMismatch`. Confirm it landed:

```bash
cat .tool-versions && ruby -v
```

If the file wasn't copied (e.g. the main repo lacks one), pin manually with
`asdf set ruby 3.1.6 && asdf set nodejs 16.18.1`.

### 3. Install Ruby dependencies

```bash
bundle install
```

This may take a few minutes the first time. Use a generous timeout (e.g.
`timeout: 600000`).

### 4. Install JS dependencies

```bash
yarn install
```

Also potentially long — same generous timeout.

### 5. Run database migrations

```bash
bundle exec rake db:migrate
```

If this fails because the database does not yet exist, surface the error to
the user rather than auto-creating it — the user should choose between
`db:create db:migrate` and `db:schema:load`, since the right answer depends on
whether this worktree shares the dev DB with the main repo.

### 6. Start the Rails server (background)

Rails is a long-running process. Start it in the background so the skill can
return control to the user.

```bash
bundle exec rails s
```

Run this with `run_in_background: true` in the Bash tool. After launching,
report the background shell ID and tell the user the server is starting; they
can tail logs or stop it from there.

## Notes

- Do not run `git checkout` or otherwise change branches in the main repo —
  this skill operates only on the current worktree's working directory.
- Do not commit `.env*` files. They are gitignored by agorize-core but worth
  double-checking with `git status` after step 1 if anything looks off.
- If the user has already partially run these steps (e.g. `.env` already
  present, deps already installed), still run each step — Bundler and Yarn
  are idempotent and `asdf set` is harmless to re-run.
