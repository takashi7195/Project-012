# v0.1.11 race ingestion stage 1

This directory contains the API adapter, structural normalizer, and database payload builder. It intentionally does not change Gemini, comments, the roulette, or the public site.

Run the local tests from the repository root:

```powershell
node --test race-ingestion/*.test.mjs
node race-ingestion/evidence-smoke.mjs
```

`evidence-smoke.mjs` reads the five raw samples outside the repository from `C:\codex\project-012\research\v0.1.11-api-20260920`. Set `RACE_EVIDENCE_DIR` to another evidence directory when needed.

The SQL migration is intentionally not applied to Project-012. It creates the isolated `race_data` schema and an atomic `race_data.ingest_snapshot` RPC for a dedicated development project. Production Project-012 remains the v0.1.10 environment until a separate development Supabase project is available and verified.
