# OpenAgentic Helm Chart

Kubernetes deployment for the OpenAgentic platform (API, UI, workflow
engine, MCP proxy, and the bundled MCP servers).

> **Status:** templates-first. The chart renders the full platform, but
> the supported, batteries-included install path today is the
> Docker Compose stack at the repo root (`docker compose --profile milvus up -d`
> — the `milvus` profile is required; the API connects to Milvus on boot).
> Use Helm if you already run Kubernetes and want to manage OpenAgentic the
> same way you manage everything else. Env-specific values
> (hostnames, storage classes, GPU node selectors) are yours to supply.

## Prerequisites

- Kubernetes 1.27+ (k3s, kind, EKS, AKS, GKE — all fine)
- Helm 3.12+
- A default `StorageClass` for PVCs (Postgres, Redis, Milvus, MinIO)
- An Ollama endpoint reachable from the cluster (in-cluster or external),
  with at least an embedding model (`nomic-embed-text`) and one chat model
- Optional: a GPU node if you want to run Milvus GPU or in-cluster Ollama

## Architecture

OpenAgentic is a set of stateless services backed by four stateful
dependencies:

| Layer | Components |
|---|---|
| **App** | `api`, `ui`, `workflows`, `mcp-proxy`, `proxy`, `synth` |
| **MCP servers** | aws, azure, gcp, kubernetes, prometheus, loki, github, admin, web |
| **Data** | PostgreSQL (pgvector), Redis, Milvus (bundles etcd + MinIO) |
| **Models** | Ollama (chat + embeddings), or external LLM providers |

This chart is **self-contained** (`Chart.yaml: dependencies: []`). PostgreSQL
(pgvector), Redis, Ollama, and Milvus all ship as plain `Deployment`s in this
chart — there are no external subcharts to install first. Milvus is gated on
`.Values.milvus.enabled` (default `true`) and bundles its own etcd + MinIO
inline (there is no separate MinIO release). A single `helm install` brings up
the whole stack.

## Install

### 1. Namespace + secrets

```bash
kubectl create namespace openagentic

# TLS (if terminating in-cluster with an existing cert)
kubectl create secret tls openagentic-tls \
  --cert=path/to/tls.crt --key=path/to/tls.key -n openagentic

# Image pull secret — ONLY if pulling from a private registry.
# Skip for public registries (default images: ghcr.io/agentic-work).
kubectl create secret docker-registry registry-pull-secret \
  --docker-server=<your-registry-host> \
  --docker-username=<user> --docker-password=<token> \
  -n openagentic
```

### 2. Stateful dependencies

There is nothing to install separately. PostgreSQL (pgvector), Redis, and
Milvus (with its bundled etcd + MinIO) all ship as in-chart `Deployment`s and
come up with the core `helm install` in the next steps. Set `milvus.enabled:
false` in your values to run pgvector-only and skip the Milvus/etcd/MinIO pods.

> **pgvector:** OpenAgentic needs the `vector` extension. The bundled Postgres
> image (`pgvector/pgvector`) already includes it, and the chart enables it on
> first boot — no manual `CREATE EXTENSION` step required.

### 3. Ollama / models

Point the chart at your Ollama endpoint with `ollama.host` (or enable the
in-cluster Ollama under `ollama.*` in `values.yaml`). Ensure the models
you reference exist:

```bash
ollama pull nomic-embed-text     # embeddings (required)
ollama pull <your-chat-model>    # e.g. a general chat model
```

### 4. Install OpenAgentic

```bash
helm install openagentic ./helm/openagentic -n openagentic \
  -f your-values.yaml
```

Two starter values files are included:

- `values-local-k8s.yaml.template` — single-node / k3s, external deps
- `values-local-airgapped.yaml.template` — air-gapped / private registry

Copy one, fill in the placeholders, and pass it with `-f`.

### 5. Verify

```bash
kubectl get pods -n openagentic
kubectl rollout status deploy/api -n openagentic

# API health (port-forward or via your ingress). The Service is named `api`
# on port 8000. For the UI, port-forward `svc/ui 8080:80` instead.
kubectl port-forward -n openagentic svc/api 8080:8000 &
curl -s http://localhost:8080/api/health | jq .
```

### 6. Providers & models (via values)

A bare install ships with **local Ollama** — zero API keys, everything runs
in-cluster. Override the models that get pulled on first boot:

```yaml
# values.yaml
ollama:
  chatModel: llama3.2:3b        # local chat model (pulled on first boot)
  embedModel: nomic-embed-text  # embeddings — required for RAG + memory
  gpu: false                    # set true if your nodes have GPUs
```

`ollama-local` is the **only auto-seeded bootstrap provider** (from `ollama.*`).
Every other provider — including **AWS Bedrock** (Claude Sonnet / Opus) — is added
once at runtime in **Admin → LLM → Provider Management** and persisted in the
database.

For Bedrock, put the AWS credentials in values so the cluster has them, then add
the Bedrock provider in the Admin UI (it uses these creds; the Smart Router then
picks Bedrock models per request — no model IDs in app config):

```yaml
secrets:
  awsAccessKeyId: "AKIA…"
  awsSecretAccessKey: "…"
  awsRegion: us-east-1
```

> **Compose users:** you don't need any of this — the default local Ollama model
> is enough to chat out of the box. Bedrock is a Kubernetes-deployment nicety.

> **Note:** only the bootstrap (Ollama) provider is seeded from `values.yaml`
> today. Auto-seeding a Bedrock provider directly from `secrets.aws*` is a
> planned chart enhancement; until then, add it once in the Admin UI (it's
> persisted, so it survives pod restarts — though not a full DB wipe).

## Configuration

All knobs live in `values.yaml`. The most common ones:

| Key | What it controls |
|---|---|
| `image.registry` / `image.tag` | Where the app images are pulled from |
| `api.*`, `ui.*`, `workflows.*`, `mcpProxy.*` | Per-service replicas, resources, env |
| `mcps.enabled` | CSV of bundled MCPs to enable (e.g. `"web,knowledge,admin,kubernetes,prometheus"`) |
| `postgres.*`, `redis.*`, `milvus.*`, `ollama.*` | Tuning for the in-chart deps (Milvus gated on `milvus.enabled`) |
| `ingress.*` | Ingress class, hosts, TLS |
| `imagePullSecrets` | Private-registry pull secrets (empty by default) |

GPU scheduling (for Milvus GPU or in-cluster Ollama) is done with standard
`nodeSelector` / `tolerations` / `resources.limits['nvidia.com/gpu']`
entries on the relevant service in your values file — there are no
hardcoded node names in the chart.

## Templates

Flat under `templates/`, one file per concern: `api.yaml`, `ui.yaml`,
`workflows.yaml`, `mcp-proxy.yaml` (+ `mcp-proxy-rbac.yaml`), `proxy.yaml`,
`postgres.yaml`, `redis.yaml`, `ollama.yaml`, `milvus.yaml` (gated on
`milvus.enabled`; bundles etcd + MinIO), `searxng.yaml`, `prometheus.yaml`,
`ingress.yaml`, and `secret.yaml`, plus `_helpers.tpl`.

## Uninstall

```bash
helm uninstall openagentic -n openagentic
# Postgres/Redis/Milvus are in-chart, so this removes them too.
# PVCs are retained by default — delete them explicitly if you want the data gone:
kubectl delete pvc -l app.kubernetes.io/instance=openagentic -n openagentic
```
