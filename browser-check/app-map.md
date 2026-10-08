# App map — local Agorize stack

Navigation notes learned during runs, to go straight to a screen by URL instead of clicking through
menus. Read it at the start of a run; append what a run discovers (section 5 of `SKILL.md`). Keep only
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
  Not verified yet as a direct call: if it answers 401/403/422, fall back to the UI and note why here.
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

## Known test fixtures

Re-check them with psql before use: other sessions change local data.

| Use | Fixture |
|---|---|
| Team workspace with a leader and 3 members (SPA flag on) | team 7568 « Billie in a team », challenge 244; leader `billie+test@agorize-test.com`, members `mathieu.coquelet+test@agorize.com`, `billie+api@test.com` |
