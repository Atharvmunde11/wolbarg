# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-07-14

### Added

- Constructor dependency injection with factory helpers (`sqlite`, `postgres`, `openaiEmbedding`, `openaiLlm`, `bm25`, …)
- PostgreSQL storage provider (`pg` peer) with optional pgvector
- Document `ingest()` for TXT/MD/CSV/JSON, PDF (`pdf-parse`), DOCX (`mammoth`), and images (OCR/vision)
- Hybrid recall (semantic + BM25), metadata filters (`meta.*`), MMR, pluggable rerankers
- Pluggable chunking strategies and optional vision / OCR providers
- Website docs for v0.2 including Limitations and What’s New
- Dual-backend (SQLite + Postgres) test harness

### Changed

- LLM / `compress()` is optional (typed `AgentOrc<true>` when configured)
- Schema migrates to v2; storage moved behind `StorageProvider`
- Prefer constructor DI; `init()` remains as a compatibility shim

### Fixed

- Clearer configuration errors when optional ingest peers are missing
- PDF parser compatibility with `pdf-parse` v1 function API and v2 `PDFParse` class

### Notes / limitations

- PDF/DOCX/OCR require optional peers installed in the consumer app (not bundled)
- Scan/image-only PDFs need OCR/vision or a text-layer PDF
- Node `node:sqlite` is experimental; Node.js **22.5+** required

## [0.1.1] — previous

- Initial npm release path (pre–modular storage / ingest)

[0.2.0]: https://github.com/Atharvmunde11/agentOrc/releases/tag/v0.2.0
[0.1.1]: https://www.npmjs.com/package/agentorc/v/0.1.1
