# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-20

Initial open-source release.

### Added

- Self-hosted, single-user platform with local username/password authentication
  (bcrypt password storage, HS256 session JWTs validated against the database).
- 9 first-party MCP servers wired by the MCP proxy: `aws`, `azure`, `gcp`,
  `github`, `kubernetes`, `loki`, `prometheus`, `admin`, and `web`. All disabled
  by default; cloud credentials live out-of-tree and are injected at runtime.
- Multi-provider chat with persistent history and semantic search over past
  conversations and uploaded documents.
- Visual workflow (Flows) engine for building agent runbooks on a canvas, with
  three ready-to-run ops templates: incident-triage, cost-anomaly, and
  failed-deploy RCA.
- Human-approval gate on mutating tool calls — read calls run immediately;
  mutating calls pause for explicit approve/deny — paired with an immutable,
  hash-chained audit log that records every tool call, proposed and executed.
- Bring-your-own-models support: local Ollama inference plus pluggable hosted
  providers (Anthropic, OpenAI, Azure OpenAI, AWS Bedrock, Google Vertex AI).
  No model IDs are hardcoded outside provider adapters and seeders.
- Milvus-backed RAG and per-user memory that persists across sessions.
- Admin console with live Prometheus-driven dashboards for usage, cost, and
  model behavior.
- Docker Compose and Helm install paths, driven by an Ink TUI setup wizard.
- Zero telemetry — no analytics SDKs, no phone-home, no license check —
  enforced by a build-failing source-regression test.

### License

- Released under [Apache-2.0](./LICENSE).

[Unreleased]: https://github.com/agentic-work/openagentic/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/agentic-work/openagentic/releases/tag/v1.0.0
