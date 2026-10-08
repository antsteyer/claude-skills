---
name: browser-check
description: >-
  Test a feature end to end in Chrome on the local Agorize stack (agorize-front
  SSR + agorize-core): launch the servers on the right worktrees, log in or
  impersonate the right role, walk the acceptance criteria, then run a keyboard
  and screen reader pass. Shared procedure called by /implement (Step 6b) and
  /review-requested-prs (4d-bis); also usable on its own when the user says
  "teste la feature dans Chrome", "vérifie dans le navigateur", or
  "/browser-check [PR# | ticket]".
---

# /browser-check — End-to-end check in Chrome

The caller decides **which code** runs (the worktrees) and **what to do with a problem** (fix it or
write a review point). This file is the shared procedure. Used alone, the code is the current
worktree, and problems are reported to the user without fixing anything.

All user-facing text is in **French**.

Two companion files live next to this one:
- `app-map.md` — URLs, the login-as shortcut, psql lookups and known fixtures. **Read it first**, and
  enrich it at the end of the run (section 6).
- `a11y-audit.js` — a one-call accessibility audit of the current page state.

## When to run it

Only when the change is testable in the app and can have a visual impact (template, styles,
routing, displayed data). Skip it for a back-only API, store-only, spec-only, tooling or CI change,
and say why.

## 1. Plan the run before touching the browser

Write the test plan in a few lines from the criteria the caller gives: for each state to reach, the
role, the fixture, the URL (from `app-map.md`) and the expected result. Group the states by role, so
each role is impersonated once. Find every fixture in one psql round (section 3) before opening
Chrome. This plan is what keeps the browser part short.

## 2. Servers

Launching them is my job, always on the code under test. Never edit a main checkout; running one as
it is, is fine.

- **Reuse before restarting** — a server already listening on 8080 / 3000 from the right directory
  is kept as is. Find its directory with
  `lsof -a -p "$(lsof -ti tcp:<port> -sTCP:LISTEN | head -1)" -d cwd -Fn | tail -1`. Wrong directory
  → stop it, then start the right one.
- **Front** — `PORT=8080 bun run dev` in the background from the front directory given by the
  caller. The worktree needs its `.env*` files and `node_modules` (`bun install`).
- **Back** — `rails server` in the background (port 3000 by default) from the core directory given
  by the caller: the agorize-core worktree of the ticket, otherwise the main agorize-core checkout.
  Check that its migrations are applied (`bin/rails db:migrate:status | grep down`). Pending
  migrations from a branch that is not mine → ask before running them: they alter the local DB.
- **Translations** — when the core branch adds or changes keys
  (`git -C <core dir> diff --name-only origin/master...HEAD -- config/locales/` is not empty), run
  `bundle exec rake translations:synchronize && bundle exec rails translations:upload_to_s3` (the
  `ac_t` alias, unavailable in a non-interactive shell) once in that core directory, in the
  background while the servers boot. Without it the SPA shows raw `spa.…` keys and texts cannot be
  checked against Figma.
- **Sidekiq** — only when the feature triggers async work (export, duplication, batch update,
  mailing…): same core directory, `bundle exec sidekiq -C config/sidekiq_k8s.yml` in the background,
  after checking with `pgrep -fl sidekiq` that none from another checkout is running (it would
  process the jobs with the wrong code).
- Start everything in the **same turn** (parallel background commands), then a single background
  readiness loop on both ports (`until` + `lsof`), never `sleep` polling. Use that wait to run the
  psql lookups.
- Always browse through nginx: `http://localhost/web/<locale>/...`, never `localhost:8080`.

## 3. Test data

- Query the local DB with `psql -d agorize_development` (well under a second). `rails runner` boots
  the whole app and is very slow on joins over `teams` / `memberships`: never use it for lookups.
- Start from the known fixtures and ready-made queries of `app-map.md`; check a table's columns with
  `\d <table>` before guessing one.
- Feature flags (`Flag.enabled?`) are served by Flagr, not stored in the DB: check them on the page
  itself (does the SPA screen render?).
- Creating local test data to reach a state is fine. When a test changes existing data (transfer,
  role change…), put it back afterwards and check it in the DB.

## 4. Browser and roles

- Load the `claude-in-chrome` skill, work in new tabs of the MCP tab group only, never in the
  user's tabs.
- The user is usually logged in. Otherwise log in on `localhost` only with the super admin test
  account `antoine.steyer+superadmin@agorize.com` (password: the same string as the email).
- **Other roles** — a workflow a super admin cannot reach (participant, team leader, jury, mentor,
  evaluator…) is tested by impersonating a real user of that role with « Login as ». Use the API
  shortcut of `app-map.md` (one call with the uuid from psql); the UI path (users index → row
  « Actions » → « Login as ») is the fallback. Switch back to the super admin before the next role.
- Go to each screen **by URL** from `app-map.md`, never by clicking through menus.
- Ask before any irreversible action (real send, delete, publish, leaving a team…) even locally.
  Open the confirmation and cancel it when the confirmed action is not needed for the test.

## 5. What to check

1. **The feature** — every acceptance criterion, the nominal path and the edge cases (empty, error,
   other roles when relevant). Screenshot each meaningful state. When the caller has Figma frames,
   compare texts, states, spacing and colours.
2. **Console and network** — no error, no `[Vue warn]` (`read_console_messages` with a pattern); no
   failed request triggered by the feature (`read_network_requests`, cleared right before the action).
   Check the outcome of a write in the network response and the DB rather than with extra screenshots.
3. **Keyboard** — every new interactive element reachable with Tab / Shift+Tab in a logical order,
   visible focus, activation with Enter / Space, arrows inside menus, Escape closes overlays, and
   the focus returns to the trigger after closing a menu or a modal.
4. **Screen reader coherence** — run `a11y-audit.js` in one `javascript_tool` call on each
   meaningful state (menu open, dialog open, after an action). It reports the focused element,
   dialogs (role, `aria-modal`, name, and a `MISSING #id` when `aria-labelledby` points nowhere),
   menu items, popup triggers without `aria-expanded`, duplicated or missing accessible names, live
   regions and headings. Then judge: names unique enough to tell repeated items apart, labels on
   fields, async feedback (toasts, errors, success) announced, what is announced matches what is
   displayed.

**Pitfalls**
- Wait ~1 s after closing an overlay before asserting it is gone: PrimeVue keeps it in the DOM during
  the leave transition (a false « Escape does not close » finding happened that way).
- Raw `spa.…` keys after the translation sync: check the key in the core branch
  (`config/locales/en.yml`) before reporting it as missing.
- Tell apart what the change introduced from what already existed: check the diff (`gh pr diff
  --name-only`, `git diff`) before attributing a problem. A pre-existing problem in a shared component
  is out of scope: list it separately and offer a GitHub issue, one issue per problem.
- `rtk` truncates long `grep` output in the worktrees: use `rtk proxy grep` when searching code.

**Keep the browser part short**
- `browser_batch` for any predictable sequence (click, wait, screenshot, audit), `find` refs rather
  than reading coordinates off a screenshot, screenshots at `scale: 0.5`–`0.6` unless a detail matters.
- One `javascript_tool` call answers more than several screenshots: prefer it for states and
  attributes.

## 6. Wrap up

1. Return to the super admin if impersonating, close my tabs, stop the servers I started (exit code
   143 on their background tasks is the expected kill).
2. **Enrich `app-map.md`** with what this run discovered: new URLs, a flow that worked, a fallback
   that was needed, a reusable psql query, a fixture worth keeping. Fix any entry that turned out
   wrong. Stable facts only.
3. Report in a few lines: what was tested, the screenshots, what the change got wrong, the
   pre-existing problems, what could not be tested and why.
