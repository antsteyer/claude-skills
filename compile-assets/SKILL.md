---
name: compile-assets
description: >-
  Recompile the agorize-core assets for production (Sprockets + Webpacker).
  Use when the user asks to compile, precompile, or rebuild assets in agorize-core.
---

# Compile agorize-core assets

## Instructions

Recompile the production assets for agorize-core. This requires temporarily patching `config/database.yml` so the `production:` environment points to the local development database (required by the precompile script), then reverting the file afterwards.

### Step 1 — Patch database.yml

Read `config/database.yml` and replace the `production:` section so it is identical to the `development:` section.

The current production section looks like:
```yaml
production:
  <<: *default
  url: <%= ENV['DATABASE_URL'] %>
```

Replace it with:
```yaml
production:
  <<: *default
  encoding: unicode
  database: agorize_development
```

Use the Edit tool to make this change precisely.

### Step 2 — Run the precompile script

Run the following command (it may take several minutes):

```bash
sh bin/precompile_assets_for_production.sh
```

Wait for it to complete. Stream the output so the user can see progress.

### Step 3 — Revert database.yml

Restore the original `production:` section in `config/database.yml`:

```yaml
production:
  <<: *default
  url: <%= ENV['DATABASE_URL'] %>
```

### Step 4 — Commit the compiled assets

Stage and commit all changes in `public/assets/` and `public/packs/` with the message `compile assets`.

```bash
git add public/assets/ public/packs/
git commit -m "compile assets"
```

## Important notes

- Always revert `database.yml` even if the precompile script fails.
- Do not commit the temporary `database.yml` change.
- The script runs `assets:clobber` before `assets:precompile`, so old assets are deleted first.
