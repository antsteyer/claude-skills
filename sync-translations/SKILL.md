---
name: sync-translations
description: >-
  Synchronize agorize-core translations (pull from Phrase, then upload to S3).
  Use when the user asks to sync, synchronize, pull, or update translations,
  including "synchroniser les trad", "sync les trads", or "/sync-translations".
---

# Synchronize agorize-core translations

## Instructions

Run the two commands sequentially. Stream the output so the user can see progress.

```bash
bundle exec rake translations:synchronize && bundle exec rails translations:upload_to_s3
```

- The first task pulls translations from Phrase into `config/locales/`.
- The second task uploads the resulting locale files to S3.
- If the first task fails, the second one will not run (`&&` short-circuits).

Report whether each step succeeded and surface any errors verbatim.
