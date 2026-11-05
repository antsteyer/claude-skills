---
name: sync-translations
description: >-
  Synchronize agorize-core translations (load the locale files into the local
  translations table, then upload them to S3) — the same commands as the `ac_t` alias.
  Use when the user asks to sync, synchronize, pull, or update translations,
  including "synchroniser les trad", "sync les trads", or "/sync-translations".
---

# Synchronize agorize-core translations

## Instructions

Run the two commands sequentially. Stream the output so the user can see progress.

```bash
bundle exec rake translations:synchronize && bundle exec rails translations:upload_to_s3
```

- The first task loads `config/locales/*.yml` into the local `translations` table
  (`TranslationSynchronizer`); it writes no file.
- The second task uploads the translations to S3.
- Nothing changes in the working tree: never check git status for what they "produced".
- If the first task fails, the second one will not run (`&&` short-circuits).

Report whether each step succeeded and surface any errors verbatim.
