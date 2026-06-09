# P3 Wave 1 — Leak & dead-surface removal (B5–B8, B11)

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp` · **Commit:** `448d60f48` (+ B5 in `eccbe453e`)

Mechanical removals of the launch-blocking leak + dead-surface findings. Each
target was verified **tracked and unreferenced** before deletion, and the
`ui vite build` gate was run green afterward.

| ID | Finding | Action | NIST | Verification |
|---|---|---|---|---|
| B5 | `docs/fedramp-remediation/` re-leaked the PII it documents removing | Added `redact.py` (idempotent + `--check` gate); scrubbed all evidence/ledger to `<REDACTED-*>`; defanged secret-scanner trigger phrases | AU-9, PM-12, RA-5 | `redact.py --check` exits 0; repo pre-commit passes |
| B6 | `tests/demos/*` leaked Harbor host, internal IPs, `agentic-dev` ns, enterprise internals | `git rm` the entire `tests/demos/` dir (20 files: 4 md + recordings + scripts) | RA-5, SA-5, SC-28 | `git ls-files tests/demos/` = 0; `harbor.agenticwork.io` = 0 tracked refs |
| B7 | 25 root `*.jpeg` screenshot/mockup dumps (2 Code-Mode brand re-leaks) | `git rm` all 25 + add `*.jpeg`/`*.jpg` to `.gitignore` | hygiene / brand-leak | all 25 confirmed unreferenced in source pre-delete; 0 remain |
| B8 | `Dockerfile.overlay*` leaked `harbor.agenticwork.io` (internal fast-deploy, unbuildable externally) | `git rm` the 4 overlay files | SR-3, SR-11 | 0 `*Dockerfile.overlay*` tracked |
| B11 | 5 orphan MCP dirs removed upstream, never wired in `mcp_manager.initialize_servers` | `git rm` the 5 dirs (alertmanager/agent-architect/incident/knowledge/runbook); dropped the dead `oap-agent-architect-mcp` pip-install from `mcp-proxy/Dockerfile` (would have broken the build); changed the 5 rename targets to `None` in `sync-upstream.py` so a sync never re-creates them; regenerated docs manifests | SA-11, CM-6 | 0 orphan dirs tracked; `mcp-servers.json` has 0 refs; `git grep oap-*-mcp` clean |

**Build gate:** `ui vite build` ✓ (16.7s) — prebuild regenerated docs manifests cleanly (directory-scan auto-dropped the deleted MCP dirs). `api tsc` unaffected (0 errors, baseline). No compiled source logic touched.

**Process note (recovered error):** a diagnostic `git stash -u` mid-wave silently
swallowed the staged deletions; a post-commit file-count check caught that the
first commit attempt held only the regenerated manifests. Recovered via
`git stash pop` + conflict-resolve on the generated manifests + `--amend`. Final
commit verified to contain all 91 file changes. Lesson: never `git stash` with
deletions staged mid-task; verify commit file-count against expectation.
