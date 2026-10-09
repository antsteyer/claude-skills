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

## Known test fixtures

Re-check them with psql before use: other sessions change local data.

| Use | Fixture |
|---|---|
| Public challenge page, server-rendered (SSR checks) | challenge 244, `/web/en/challenges/billie-challenge-test-alt` (`fr` slug: `billie-challenge-test`) |
| Team workspace with a leader and 3 members (SPA flag on) | team 7568 « Billie in a team », challenge 244; leader `billie+test@agorize-test.com`, members `mathieu.coquelet+test@agorize.com`, `billie+api@test.com` |

## Selectors

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
