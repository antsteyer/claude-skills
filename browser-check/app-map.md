# App map — local Agorize stack

Navigation notes learned during runs, to go straight to a screen by URL instead of clicking through
menus. Read it at the start of a run; append what a run discovers (section 6 of `SKILL.md`). Keep only
stable facts: URL patterns, flows, selectors, where a role is found. Never dated data, never test
results.

## Entry points

| Screen | URL | Notes |
|---|---|---|
| Legacy login | `http://localhost/en/users/sign_in` | May render unstyled locally (no webpack-dev-server): expected |
| My space | `/web/<lang>/user_space` | `/web/<lang>/my-space` is a 404 |
| Platform users index (super admin) | `/web/<lang>/admin/users` | Search field at the top; each row has an « Actions » menu with « Login as » |
| Challenge admin participants index | _unknown — fill in on first use_ | Second place offering « Login as » |
| Team workspace (SPA project view) | `/web/<lang>/challenges/<challenge_id>/teams/<team_id>/<tab>` | Tabs: `details`, `members`, `mentors`, `workspace` (shared files). `challenge_id` is the numeric id. Only reachable as a team member (`owned_teams` endpoints answer 404 otherwise) → impersonate a member |
| Public challenge page | `/web/<lang>/challenges/<slug>` | |

Swap `<lang>` (`en` / `fr`) to check both translations.

## Toasts

`$addSuccessToast` / `$addDangerToast` render in a `role="alert"` (`aria-live="assertive"`) region at
the top centre. Read the text with `javascript_tool` right after the action; zoom on the region
`[400, 0, 920, 70]` for the visual — a screenshot taken under 1 s catches it mid-animation.

## Login as

- Faster than the UI: from any `localhost/web` page logged in as the super admin, one `javascript_tool` call:
  ```js
  await fetch('/en/api/v2/users/login_as', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { uuid: '<UUID>' }, meta: { admin_url: location.href } }),
  }).then(r => r.status) // 201 = impersonating
  ```
  Get the uuid with `psql -d agorize_development -Atc "SELECT uuid FROM users WHERE email = '<email>'"`.
  Back to the super admin: `fetch('/en/api/v2/users/login_as', { method: 'DELETE', credentials: 'include' })` → 204.
  Verified: POST → 201, DELETE → 204. Switching role = DELETE then POST in the same call; then
  navigate to the screen (the open page does not refresh by itself).
- UI path: users index → search the email → row « Actions » → « Login as ». While impersonating, a
  black banner « You are connected as X » shows a « Back to my admin space » button.
- 403 while already impersonating: stop the current impersonation first.

## Data lookups (psql)

- Teams with a leader and N members:
  ```sql
  WITH t AS (SELECT id, name, leader_id, step_id FROM teams WHERE leader_id IS NOT NULL ORDER BY id DESC LIMIT 300)
  SELECT t.id, t.name, count(m.id), s.challenge_id, u.email
  FROM t JOIN memberships m ON m.team_id = t.id JOIN steps s ON s.id = t.step_id JOIN users u ON u.id = t.leader_id
  GROUP BY 1, 2, 4, 5 HAVING count(m.id) BETWEEN 3 AND 5 ORDER BY t.id DESC LIMIT 6;
  ```
- Members of a team: `memberships.member_id` (not `user_id`) → `users`.
- Teams have no `challenge_id`: go through `teams.step_id` → `steps.challenge_id`.
- Challenges have no `slug` column: it lives in `challenge_translations.slug`, one row per locale
  (`SELECT locale, slug FROM challenge_translations WHERE challenge_id = <id>`).

- Participation questions live in `questions` with `type = 'Questions::Participation'` (`questions.step_id`);
  there is no `participation_questions` table.
- Owned teams whose participation is still editable (solo first), with a member email:
  ```sql
  SELECT t.id, s.challenge_id, c.max_team_size, min(u.email)
  FROM teams t JOIN steps s ON s.id = t.step_id JOIN challenges c ON c.id = s.challenge_id
  JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.member_id
  WHERE NOT c.archived AND NOT c.template AND NOT t.failed AND s.end_at > now()
    AND EXISTS (SELECT 1 FROM questions q WHERE q.step_id = s.id AND q.type = 'Questions::Participation')
  GROUP BY 1, 2, 3 ORDER BY (c.max_team_size = 1) DESC, t.id DESC LIMIT 10;
  ```

## Backend boot pitfalls

- Any pending migration makes every Rails request answer 500 (`ActiveRecord::PendingMigrationError`), even one
  unrelated to the branch. Run `bin/rails db:migrate:status | grep down` before starting the servers, and ask
  the user when a pending migration cannot run on the dev data.
- A fresh agorize-core worktree has no `node_modules`: the legacy sign-in page then answers 500
  (`File to import not found: bootstrap-select/...`). Run
  `ASDF_NODEJS_VERSION=16.18.1 PATH="$HOME/.asdf/installs/nodejs/16.18.1/bin:$PATH" yarn install --frozen-lockfile`
  in the worktree before starting Rails.
- `db:migrate` run from a worktree rewrites `db/schema.rb` with local DB drift (extensions, column order):
  `git checkout -- db/schema.rb` afterwards when the branch's schema change is already committed.

## Known test fixtures

Re-check them with psql before use: other sessions change local data.

| Use | Fixture |
|---|---|
| Public challenge page, server-rendered (SSR checks) | challenge 244, `/web/en/challenges/billie-challenge-test-alt` (`fr` slug: `billie-challenge-test`) |
| Team workspace with a leader and 3 members (SPA flag on) | team 7568 « Billie in a team », challenge 244; leader `billie+test@agorize-test.com`, members `mathieu.coquelet+test@agorize.com`, `billie+api@test.com` |

## Selectors

- Project view overview « … » menu: the first ArrowDown after opening focuses the first item; items are
  `[role=menuitem]`. The shared confirmation modal is `[role=alertdialog]` with focus on « Cancel ».

- `BaseMenuPopUpButton` triggers: `button[aria-controls^="dropdown-menu-"]`. The header profile menu is one
  (`aria-label="Open my profile menu"`). The member cards of the team workspace `members` tab have an icon-only
  « Actions » trigger: match it on `[aria-label="Actions"]`, its text content is empty.

## Headless fallback (no Claude in Chrome tools)

- When the `mcp__claude-in-chrome__*` tools are absent, `bun add playwright-core` in a scratch dir under `/tmp`
  and launch the cached Chromium (`~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`)
  with `executablePath`. Keep the script in a separate dir and import playwright by absolute path.
- Login: fill `input[name="user[email]"]` / `input[name="user[password]"]` on the legacy sign-in page, press Enter.
- The first `goto` to an SPA screen right after the `login_as` POST can fail with `net::ERR_ABORTED` (client-side
  redirect): catch it and navigate again. Wait for `networkidle` before looking for card-level controls.
