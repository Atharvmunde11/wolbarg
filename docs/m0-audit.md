# Milestone 0 — Current-State Audit (v0.4.0)

Audit of Wolbarg SDK behavior prior to implementing concurrency hardening,
subscribe(), embedding cache, and memory upsert. Findings are from code review
of the 0.3.x baseline (package version 0.3.2 at audit time).

## Findings

| Question | Finding | Implication for 0.4 |
|----------|---------|---------------------|
| WAL default? | Yes — `PRAGMA journal_mode = WAL` on open in `SqliteStorageProvider.open()` | Concurrency work builds on WAL; do not re-enable |
| Transaction mode? | Deferred `BEGIN` via `withTransaction` | Switch mutating paths to `BEGIN IMMEDIATE` |
| Busy handling? | `PRAGMA busy_timeout = 5000`, then throw → `DatabaseError`; no app-level retry | Add exponential backoff + `WOLBARG_STORAGE_LOCKED` |
| Same-process writers? | Serialized by `AsyncMutex` in `Wolbarg.withWriteLock` for SQLite | Multi-process contention is the real gap |
| `rememberBatch` storage TX? | One transaction for the whole batch (`insertMemoriesBatch`) | One commit boundary; subscribe emits after batch commit |
| `rememberBatch` embeddings? | One `embedBatch` when available via `embedMany`; else parallel `embed` (concurrency 8) | Embedding cache sits **above** batch assembly |
| Memory write dedupe? | None — always `createId()` + `insertMemory` | Feature 4 (upsert) is greenfield above storage |
| `updateMemory`? | Implemented on SQLite + Postgres; zero public callers | Feature 4 wires this up |
| History events? | `'created' \| 'archived' \| 'compressed'` only | Need `'updated'` for upsert |

## Notes

- Embedding cache must check per-item before assembling the provider batch.
- Unique content-hash index (schema v3) plus `BEGIN IMMEDIATE` retry closes exact-dup races under multi-process writers.
- Postgres path already uses row-level locking; concurrency config is SQLite-focused.
