# v0.1.11 race ingestion

This directory contains the API adapter, structural normalizer, database payload builder, task scheduler, and worker core. It does not change Gemini, comments, or the roulette.

Run the local tests from the repository root:

```powershell
node --test race-ingestion/*.test.mjs
node race-ingestion/evidence-smoke.mjs
```

受入試験ハーネスも同じテストコマンドに含まれる。ハーネスは実DB停止や提供元への負荷を発生させず、並行workerのclaim排他と上流429/タイムアウトをローカルで再現する。実プロセス同時実行、DB停止・再開、7日間観測は経過または専用環境が必要なため、ハーネス合格を実環境合格とは扱わない。

`capacity-acceptance.mjs` は容量観測RPCの行を集計し、7つの異なる観測日が揃うまで `pending` を返す。テストfixtureで `ready` になることだけを確認し、実際の7日経過を早送りしない。

`evidence-smoke.mjs` reads the five raw samples outside the repository from `C:\codex\project-012\research\v0.1.11-api-20260920`. Set `RACE_EVIDENCE_DIR` to another evidence directory when needed.

The `race_data` migrations and the `race-ingest` Edge Function are applied to Project-012 by explicit user approval. The schema is private, while service-role-only wrapper RPCs are used by the worker. Cron jobs are configured for today, yesterday, and historical backfill. The current implementation is still limited to the staged ingestion pipeline; Gemini, comments, and roulette do not read this data yet.
