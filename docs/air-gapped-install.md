# Air-gapped install

Run OpenAgentic fully offline, inside your own perimeter, with **nothing leaving
the box**. This guide covers mirroring every image into a private registry,
serving models from a local or remote Ollama, and proving that no traffic
egresses.

OpenAgentic is built for exactly this posture: zero telemetry, no phone-home, no
license check, no update ping. Every outbound path is either localhost,
in-cluster, or an endpoint **you** configure (your Ollama, your collector, your
cloud APIs driven by your own creds). Air-gapped is not a bolt-on — it is the
default behaviour once you stop pointing it at the public internet.

> Scope: this guide is Kubernetes-first (the Helm chart at `helm/openagentic`).
> A Docker Compose air-gap variant is at the end. All registry hostnames here are
> **placeholders** (`registry.internal:5000`, `ollama.internal`) — substitute
> your own.

---

## What you need to mirror

The platform is five first-party app images plus a fixed set of third-party
dependency images. Nothing else is pulled at runtime.

### First-party app images

Built and published as `<registry>/openagentic-<service>:<tag>`. The public
default registry is `ghcr.io/agentic-work`; you will re-tag these into your
private registry.

| Image | Used by |
|---|---|
| `openagentic-api` | Platform API (chat, flows, RAG, admin) |
| `openagentic-ui` | React UI |
| `openagentic-workflows` | Workflow engine |
| `openagentic-mcp-proxy` | MCP server proxy |
| `openagentic-proxy` | Egress proxy (optional; `proxy.enabled`) |

> The Helm chart renders image refs as `{{ .Values.image.registry }}/openagentic-<service>:{{ .Values.image.tag }}`
> (see `helm/openagentic/templates/_helpers.tpl`), so a single `image.registry`
> override re-points all five at once.

### Third-party dependency images

These are the exact pins the chart and Compose stack reference today. Confirm
against `helm/openagentic/values.yaml` and `docker-compose.yml` for your
checkout before mirroring — pins move with releases.

| Image | Role | Required when |
|---|---|---|
| `pgvector/pgvector:pg16` | PostgreSQL + pgvector | always |
| `redis:7-alpine` | Redis | always |
| `ollama/ollama:latest` | Model server (chat + embeddings) | when running Ollama in-cluster |
| `milvusdb/milvus:v2.4.15` | Vector DB (tool semantic cache) | `milvus.enabled: true` (default) |
| `quay.io/coreos/etcd:v3.5.18` | Milvus metadata | with Milvus |
| `minio/minio:RELEASE.2024-12-18T13-15-44Z` | Milvus object store + artifacts | with Milvus |
| `searxng/searxng:latest` | Web-search backend for the `web` MCP | if `web` MCP enabled |
| `prom/prometheus:v2.54.1` | Metrics for the admin dashboard | `prometheus.enabled: true` |

> **Trim the list to what you enable.** Milvus (with its etcd + MinIO) is
> required — the API connects to it on boot. A minimal air-gapped install can
> still skip Prometheus and drop SearXNG if you don't need the `web` MCP. Fewer
> optional images to mirror, fewer moving parts behind the perimeter.

> **Compose note:** under Docker Compose, the milvus/etcd/minio images are only
> used when you bring the stack up with `docker compose --profile milvus up -d`.
> A bare `up` runs pgvector-only and never pulls those three.

---

## Step 1 — Mirror images into your private registry

Do this on a **connected** workstation (the "low side" / DMZ jump host), then
carry the registry — or an image tarball — across the air gap.

Set your coordinates once:

```bash
SRC_REGISTRY=ghcr.io/agentic-work        # public source
DST_REGISTRY=registry.internal:5000      # your private registry (placeholder)
TAG=latest                               # pin to a release tag for production
```

### Option A — `skopeo` (no Docker daemon, copies manifests directly)

```bash
APP_IMAGES="openagentic-api openagentic-ui openagentic-workflows openagentic-mcp-proxy openagentic-proxy"

for img in $APP_IMAGES; do
  skopeo copy --all \
    docker://$SRC_REGISTRY/$img:$TAG \
    docker://$DST_REGISTRY/$img:$TAG
done

# Third-party deps (mirror only the ones you enable)
DEP_IMAGES="\
docker.io/pgvector/pgvector:pg16 \
docker.io/library/redis:7-alpine \
docker.io/ollama/ollama:latest \
docker.io/milvusdb/milvus:v2.4.15 \
quay.io/coreos/etcd:v3.5.18 \
docker.io/minio/minio:RELEASE.2024-12-18T13-15-44Z \
docker.io/searxng/searxng:latest \
docker.io/prom/prometheus:v2.54.1"

for ref in $DEP_IMAGES; do
  name="${ref#*/}"                       # strip the source registry host
  skopeo copy --all docker://$ref docker://$DST_REGISTRY/$name
done
```

`--all` copies every architecture in the manifest list — keep it if your cluster
is mixed amd64/arm64; drop it to mirror a single arch and save space.

### Option B — Docker, when there is no path between registries

Pull on the low side, save to a tarball, sneakernet it across, load and push on
the high side.

```bash
# Low side: pull + save
for img in $APP_IMAGES; do docker pull $SRC_REGISTRY/$img:$TAG; done
docker save $(for img in $APP_IMAGES; do echo $SRC_REGISTRY/$img:$TAG; done) \
  -o openagentic-images.tar

# High side: load, re-tag to your registry, push
docker load -i openagentic-images.tar
for img in $APP_IMAGES; do
  docker tag  $SRC_REGISTRY/$img:$TAG $DST_REGISTRY/$img:$TAG
  docker push $DST_REGISTRY/$img:$TAG
done
```

Repeat the same pull/save/load/tag/push for each dependency image you enable.

---

## Step 2 — Create the image pull secret

If your private registry needs auth, create a pull secret in the release
namespace. The chart wires it through `imagePullSecrets`.

```bash
kubectl create namespace openagentic

kubectl create secret docker-registry registry-pull-secret \
  --docker-server=registry.internal:5000 \
  --docker-username='<user>' \
  --docker-password='<token>' \
  -n openagentic
```

If your registry is anonymous-pull inside the perimeter, skip this — leave
`imagePullSecrets: []`.

---

## Step 3 — Models: local or remote Ollama, both offline

OpenAgentic always serves **embeddings** from the in-cluster Ollama
(`nomic-embed-text` is light and CPU-only). The **chat** model is served by
`ollama.chatHost`:

- `ollama.chatHost: ""` → chat runs on the **in-cluster** Ollama. The chart's
  init job pulls `ollama.chatModel` in-cluster. All-local, zero external deps.
- `ollama.chatHost: "http://ollama.internal:11434"` → chat runs on a **remote**
  Ollama you already operate (e.g. a GPU box inside the perimeter). The
  in-cluster Ollama then pulls **only** the embed model — no GPU needed in the
  cluster.

Both are fully offline as long as the models are present before first boot.

### Pre-pull models (no internet at deploy time)

`ollama pull` reaches `ollama.com` for the blobs — do this **on the connected
side**, then move the blobs across the gap. Ollama stores everything under its
models dir (`~/.ollama/models`, or `OLLAMA_MODELS`):

```bash
# Connected side — fetch into a staging models dir
OLLAMA_MODELS=/staging/ollama ollama pull nomic-embed-text
OLLAMA_MODELS=/staging/ollama ollama pull llama3.2:3b     # your chat model
```

Then make those blobs available to the Ollama that will serve them:

- **Remote Ollama box:** copy `/staging/ollama/*` into that host's
  `OLLAMA_MODELS` dir and restart Ollama. Confirm with
  `curl http://ollama.internal:11434/api/tags`.
- **In-cluster Ollama:** pre-seed the Ollama PVC with the staged blobs (e.g.
  `kubectl cp` into the running pod's models dir, or restore from a
  volume snapshot), then let the init job find them already present.

> Tip: keep model names in `values.yaml` only — never hardcode model IDs in
> source. The chart pulls exactly what `ollama.chatModel` / `ollama.embedModel`
> name.

---

## Step 4 — Air-gapped values

Start from the in-repo template and fill it in:

```bash
cp helm/openagentic/values-local-airgapped.yaml.template \
   my-airgapped-values.yaml
# Edit my-airgapped-values.yaml — DO NOT commit it (it holds secrets).
```

The load-bearing overrides, mapped to the chart's keys:

```yaml
# Re-point ALL five app images at your private registry.
image:
  registry: registry.internal:5000   # placeholder — your registry
  tag: latest                        # pin to a release for production
  pullPolicy: IfNotPresent           # set Never if images are pre-loaded onto nodes

# Private-registry auth (omit if anonymous-pull inside the perimeter).
imagePullSecrets:
  - name: registry-pull-secret

# Models — pick ONE posture.
ollama:
  embedModel: nomic-embed-text
  chatModel: llama3.2:3b
  # chatHost: ""                          # in-cluster chat (all-local)
  chatHost: "http://ollama.internal:11434"  # OR remote Ollama (placeholder)
  gpu: false

# Only cred-free local MCPs. The cloud MCPs (aws/azure/gcp) need outbound
# cloud APIs — leave them OUT of an air-gapped install.
mcps:
  enabled: "knowledge,admin"   # add "web" only if SearXNG is mirrored + enabled

# Rotate every secret away from the dev defaults.
secrets:
  postgresPassword: "<generate>"
  jwtSecret: "<generate-32+>"
  signingSecret: "<generate-32+>"
  internalApiKey: "<generate>"
  frontendSecret: "<generate>"
  adminEmail: admin@openagentic.local
  adminPassword: "<generate>"

# Optional: keep Milvus, or go pgvector-only to shrink the footprint.
milvus:
  enabled: true     # set false + run the API with MILVUS_ENABLED=false for pgvector-only

# Web search (the `web` MCP) — drop entirely if you don't enable that MCP.
# SearXNG itself makes outbound search-engine calls; behind a strict perimeter,
# leave the `web` MCP disabled or point SearXNG at an internal search source.
```

> The `web` MCP performs internet searches via SearXNG by design. In a true
> air gap, either leave `web` out of `mcps.enabled`, or constrain SearXNG to an
> internal search backend. Everything else — chat, flows, RAG, memory, the
> infra MCPs (kubernetes/prometheus/loki/alertmanager pointed at **your**
> in-perimeter endpoints) — runs with zero internet.

### About the cloud MCPs

The `aws`, `azure`, and `gcp` MCPs exist to operate those clouds and require
reachable cloud control-plane APIs. They have no place in an air-gapped install
and should stay disabled. The infra MCPs (`kubernetes`, `prometheus`, `loki`,
`alertmanager`) are perfectly air-gap-friendly — point them at your in-perimeter
cluster, Prometheus, Loki, and Alertmanager.

---

## Step 5 — Install

The stateful deps (Postgres/pgvector, Redis, Milvus) ship as in-chart
`Deployment`s — there is nothing to install separately. Milvus is gated on
`milvus.enabled` (and bundles its own etcd + MinIO). Then:

```bash
helm install openagentic ./helm/openagentic -n openagentic \
  -f my-airgapped-values.yaml --wait --timeout 10m
```

Verify rollout (the api Deployment + Service are named `api`):

```bash
kubectl get pods -n openagentic
kubectl rollout status deploy/api -n openagentic

kubectl port-forward -n openagentic svc/api 8080:8000 &
curl -s http://localhost:8080/api/health | jq .
```

---

## Step 6 — Confirm nothing egresses

A clean install already makes no outbound calls of its own. To **prove** it
inside your perimeter:

### Network policy — deny egress by default

Pin the namespace shut, then allow only the in-perimeter endpoints you actually
use (DNS, your registry, your remote Ollama, your Prometheus/Loki). Anything the
platform tries beyond these will fail loudly instead of silently leaking.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: openagentic
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    # in-namespace traffic (api <-> ui <-> workflows <-> mcp-proxy <-> deps)
    - to:
        - podSelector: {}
    # cluster DNS
    - to:
        - namespaceSelector: {}
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
    # ADD explicit allows for: your private registry, a remote Ollama host,
    # in-perimeter Prometheus/Loki/Alertmanager — and NOTHING else.
```

### Observe the traffic

```bash
# Watch DNS — there should be no lookups for public hostnames during a
# login + chat round-trip. Names you'll see are in-namespace services only.
kubectl logs -n kube-system -l k8s-app=kube-dns -f | grep -v 'svc.cluster.local'

# Drive a chat through the API and confirm the deny-egress policy holds:
# no connection attempts to anything outside your allow-list.
```

### Keep telemetry off (it already is)

The shipped defaults emit nothing. To stay certain across upgrades, assert these
never get set to a non-local value in your overlay:

- `OBSERVABILITY_PROVIDER` — unset → `none` (no exporter). Leave it unset, or set
  it only to a collector **inside** your perimeter.
- `OTEL_EXPORTER_OTLP_ENDPOINT`, `PHOENIX_HOST`, `LANGFUSE_*` — leave unset, or
  point only at an in-perimeter collector. Default is localhost / discard.
- `AUDIT_LOG_SINK` — defaults to `stdout` (local). Only `datadog`/`splunk`/`s3`
  egress, and only to **your** account with **your** keys. Leave it `stdout` for
  a fully self-contained audit trail.

### Browser-side caveat (disclose, not telemetry)

The server never phones home. The **UI in a user's browser** may fetch a few
third-party assets when a user renders a model-generated artifact (some chart /
math / Python-runtime libraries) or for brand webfonts. These are sandboxed,
user-action-triggered resource loads — not analytics — but a strict reviewer
watching the browser network tab will see them. For a fully sealed browser
experience, serve the UI behind your perimeter and self-host the fonts and
artifact runtime; the vendored copies already live under
`services/openagentic-ui/public/artifact-runtime/`.

---

## Docker Compose (air-gapped variant)

The Compose stack reads the registry and tag from env vars, so the same mirrored
images work without editing `docker-compose.yml`:

```bash
# After mirroring all images into your private registry (Step 1):
export OPENAGENTIC_REGISTRY=registry.internal:5000   # placeholder
export OPENAGENTIC_TAG=latest

# Log the Docker daemon into your private registry if it needs auth:
docker login registry.internal:5000

# Models: point the stack at a reachable Ollama (local or remote), pre-pulled.
# In .env:
#   OLLAMA_HOST=http://ollama.internal:11434   # remote, or host.docker.internal for a host Ollama

# Include `--profile milvus` for the Milvus-backed stack (etcd/minio/milvus are
# profile-gated); drop the profile for a pgvector-only install.
docker compose --profile milvus pull   # pulls every service image from your registry
docker compose --profile milvus up -d
docker compose --profile milvus ps     # all services healthy/running
curl -s http://localhost:8080/api/health | jq .
```

To go fully offline at runtime, `docker save`/`docker load` every image listed
above onto the host, set `OPENAGENTIC_REGISTRY` to match the loaded tags, and the
daemon will use the local images without reaching out.

---

## Reproducibility checklist

- [ ] All app + dependency images mirrored to your private registry (Step 1)
- [ ] `image.registry` (Helm) / `OPENAGENTIC_REGISTRY` (Compose) re-pointed
- [ ] `imagePullSecrets` set, or registry is anonymous-pull
- [ ] Embed + chat models pre-staged into local/remote Ollama (Step 3)
- [ ] `ollama.chatHost` set for remote, or empty for in-cluster
- [ ] Cloud MCPs (aws/azure/gcp) disabled; only cred-free local MCPs enabled
- [ ] `web` MCP / SearXNG left out or pointed at an internal search source
- [ ] All `secrets.*` rotated off the dev defaults
- [ ] Default-deny egress NetworkPolicy applied, with explicit in-perimeter allows
- [ ] `OBSERVABILITY_PROVIDER` / `OTEL_*` / `AUDIT_LOG_SINK` left local
- [ ] Login + chat round-trip produces zero off-box connection attempts

---

Backed by **Agenticwork™** — the OpenAgentic core here is free forever, Apache-2.0,
and complete. Enterprise edition and support are available at
[agenticwork.io](https://agenticwork.io); the self-hosted build in this repo
needs none of it to run air-gapped.
