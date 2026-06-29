# verify-deployment — HELM/k8s acceptance harness

ONE credential-aware harness that proves a **live openagentic Helm/Kubernetes
deployment** is functional end-to-end and emits a `PASS / FAIL / SKIP` matrix
with a single process exit code.

It is **Helm-only**: application calls go over the deployment's **ingress URL**;
service health, MCP enablement, and credential detection come from
**Kubernetes** (`kubectl` / `helm`) against the target **namespace**. It does
**not** touch docker-compose and never reads a compose `.env`.

> Green means: *everything that is configured on this deployment works.* Anything
> not enabled/configured is reported as **SKIP with a reason** — never a false
> FAIL.

## What it checks (each = one matrix row)

| Row | Proves |
|---|---|
| `HEALTH` | `/api/health` is `healthy` with db/redis/milvus connected **and** every pod in the namespace is Ready (`kubectl`). |
| `AUTH` | Local login returns a JWT with `isAdmin`. |
| `CHAT` | A real chat turn returns a streamed assistant response. |
| `MCP:<id>` (×9) | For each of `aws, azure, gcp, kubernetes, prometheus, loki, github, admin, web`: detect enablement+creds from k8s → **SKIP** (with reason) if absent, else chat-probe one known READ tool and **verify it executed** by polling `GET /api/admin/audit-log` for a matching row (the audit log is the execution oracle) + a data sanity check. |
| `FLOW:<slug>` | Every seeded Flow template (`incident-triage`, `cost-anomaly`, `failed-deploy-rca`, `research-and-publish`, …) runs via the workflows API and produces non-empty output. Templates needing an absent MCP → **SKIP**. |
| `APPROVAL` | A MUTATING tool call raises `approval_required` → `POST /api/approvals/:auditId/approve` → executes → audit row `decision=approved`; and a READ tool is audited `decision=auto` (never gated). SKIP if no mutating tool is reachable. |
| `DASHBOARD` | The admin analytics/metrics endpoints (`/api/admin/cluster/health`, `/api/admin/analytics/stats`, `/api/admin/dashboard/counts`, `/api/admin/prom/query`) return data of the expected shape. |
| `MEMORY` | Store a fact in chat, start a **new** session, assert cross-session recall. |

**Exit code:** `0` iff no non-skipped check failed. Any FAIL → non-zero. An
empty matrix (nothing verified) is also non-zero.

## Run it

Defaults target the `openagentic` release at `https://openagentic.example.com`.

```bash
# one-liner (admin password via env)
DEPLOY_ADMIN_PASSWORD='…' python3 tests/verify-deployment/verify_deployment.py

# or the npm target (from repo root or tests/)
DEPLOY_ADMIN_PASSWORD='…' npm run verify:deployment

# any other helm deployment
python3 tests/verify-deployment/verify_deployment.py \
  --url https://my.ingress.example.com \
  --namespace my-namespace \
  --release my-release \
  --admin-email admin@openagentic.local \
  --admin-password '…' \
  --json /tmp/acceptance.json
```

### Flags / env

| Flag | Env | Default |
|---|---|---|
| `--url` | `DEPLOY_URL` | `https://openagentic.example.com` |
| `--namespace` | `DEPLOY_NAMESPACE` | `openagentic` |
| `--release` | `DEPLOY_RELEASE` | `openagentic` |
| `--context` | `DEPLOY_KUBE_CONTEXT` | current context |
| `--admin-email` | `DEPLOY_ADMIN_EMAIL` | `admin@openagentic.local` |
| `--admin-password` | `DEPLOY_ADMIN_PASSWORD` | *(required)* |
| `--json PATH` | — | write the machine-readable summary |
| `--only a,b,c` | — | run a subset: `health,auth,chat,mcps,flows,approval,dashboards,memory` |
| `--no-kube` | — | skip `kubectl` detection (HTTP-only; MCP enablement falls back to the proxy tool-list) |
| `--insecure` | — | don't verify the ingress TLS cert |
| `--chat-timeout` / `--audit-poll` | — | stream timeout / per-probe audit poll budget |

`kubectl` must be on `PATH` and pointed at (or `--context`-given) the cluster
hosting the namespace for full HEALTH + credential-aware SKIP detection. Without
it the harness still runs (HTTP-only) but reports reduced health/detection.

## Prerequisites

- `python3` (3.9+, stdlib only — no pip install needed for the runner).
- `kubectl` with access to the target namespace (optional but recommended).
- An admin password for the deployment's seeded local admin.

## The pure helpers + their unit tests

All matrix logic lives in `harness_lib.py` as **pure, importable, side-effect-free**
helpers — the per-MCP probe table (`MCP_PROBES`), the audit-oracle
(`audit_row_matches` / `find_audit_match`), the credential-aware skip policy
(`decide_mcp_skip`), and the matrix formatter / summary / exit-code rule
(`format_matrix`, `summarize`, `exit_code_for`). The live runner
(`verify_deployment.py`) does all the I/O and calls into these.

Run the helper unit tests (no cluster needed):

```bash
# dependency-free runner
python3 tests/verify-deployment/test_harness_lib.py
# or under pytest
python3 -m pytest tests/verify-deployment/test_harness_lib.py -q
# or the npm target
npm run verify:deployment:test
```

## Honest expectation (openagentic, today)

On `openagentic` only `web` and `admin` are enabled, so the other
**7 MCP rows SKIP** (no creds). Until the tool auto-resolve fix deploys, the
**MCP-in-chat and Flow rows that depend on tool execution may be RED** — that is
**correct**. This harness is the truth-teller: it reports the real state and
will flip green once tools execute. It is intentionally *not* built to pass
vacuously.

## Files

- `verify_deployment.py` — single entry point (all checks, matrix, exit code).
- `harness_lib.py` — pure helpers (probe table, audit oracle, skip policy, matrix formatter).
- `test_harness_lib.py` — unit tests for the helpers.
