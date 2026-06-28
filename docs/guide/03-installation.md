# Installation

OpenAgentic is a self-hosted, single-binary-feel platform that ships as a small
set of Docker images (or a Helm chart). There is no SaaS tier, no phone-home, and
no license key for the open-source edition — you run the whole thing on your own
infrastructure.

This guide covers everything you need to go from a clean machine to a working
chat UI that can drive your cloud, Kubernetes, and observability tooling. There
are three install paths:

| Path | Command | When to use |
|---|---|---|
| **Docker Compose (quick)** | `curl -sSL .../install.sh \| bash` then `docker compose up -d` | A laptop, a VM, or any box with Docker. The fastest way to a running stack. |
| **Kubernetes (Helm)** | `curl -sSL .../install.sh \| bash -s -- --helm` | You already run Kubernetes and want to manage OpenAgentic like everything else. |
| **Interactive wizard** | `curl -sSL .../install.sh \| bash` (default) or `--wizard` | Guided setup — pick providers, MCPs, and credentials in a TUI before launch. |

> **Repository access during the pre-launch window.** The `install.openagentics.io`
> / `raw.githubusercontent.com/agentic-work/openagentic` URLs in this guide go
> live when the repository is made public. Until then, clone the repository you
> already have access to and run `./install.sh` from the checkout — the script
> auto-detects a local checkout and uses it directly (see
> [Installing from a local checkout](#installing-from-a-local-checkout)).

---

## Prerequisites

What you need depends on which path you take. The installer's built-in doctor
(`install.sh --doctor`) checks all of these for you and reports exactly what is
missing — run it first if anything is unclear.

### Common to every path

- **git** — used to fetch/update the source on a local-checkout install.
- **An Ollama endpoint.** OpenAgentic uses Ollama for embeddings
  (`nomic-embed-text`) — this powers semantic tool indexing, RAG, and memory.
  The Compose stack ships its own `ollama` container and pulls the embedding
  model for you on first boot, so you do not need a separate Ollama install for
  the Docker path. For Helm you point the chart at an in-cluster or external
  Ollama.

### Docker Compose path

| Requirement | Notes |
|---|---|
| **Docker Engine / Docker Desktop** | The daemon must be running (`docker info` must succeed). |
| **Docker Compose v2** | The `docker compose` plugin (not the legacy `docker-compose`). `docker compose version` must succeed. |
| **~8–10 GB free disk** | The images plus the Ollama model pull. The installer warns below ~6 GB. |
| **Port 8080 free** | The UI is published on `8080` by default. Override with `UI_HOST_PORT` if it is taken. |

### Kubernetes (Helm) path

| Requirement | Notes |
|---|---|
| **Kubernetes 1.27+** | k3s, kind, Docker Desktop Kubernetes, EKS, AKS, GKE — all fine. |
| **Helm 3.12+** | `helm version`. |
| **kubectl + a reachable cluster** | `kubectl cluster-info` must succeed. |
| **A default `StorageClass`** | For the Postgres, Redis, Milvus, and MinIO PVCs. |
| **cert-manager** | Only if you terminate ingress TLS in-cluster. |

### Interactive wizard path

| Requirement | Notes |
|---|---|
| **Node.js 20+** | The wizard is an Ink TUI (`@openagentic/setup`). The Compose `--env` path and Helm path do **not** need Node. |

> **macOS note.** When the wizard sets up the Compose stack on macOS it defaults
> `OLLAMA_HOST` to `http://host.docker.internal:11434` so the containers can
> reach an Ollama running on the host. If you mount host cloud credentials
> (`~/.openagentic/cloud-secrets`, `~/.aws`, `~/.azure`, `~/.config/gcloud`,
> `~/.kube`), make sure your home directory is in Docker Desktop's file-sharing
> list (Settings → Resources → File sharing — it is by default).

### Run the doctor first

```bash
curl -fsSL https://install.openagentics.io | bash -s -- --doctor
# …or from a local checkout:
./install.sh --doctor
```

The doctor checks git/curl, Docker (CLI + daemon + Compose v2), helm/kubectl/cluster,
Node 20+, free disk in `$HOME`, whether port 8080 is in use, and whether an
existing install is present under `~/.openagentic`. It fixes nothing — it just
reports.

---

## Path 1 — Docker Compose (quick)

This is the supported, batteries-included path. One command brings up the whole
stack: Postgres (pgvector), Redis, Ollama, SearXNG, Prometheus, and all five
application services. The default stack uses **pgvector** as the vector backend,
so a bare `docker compose up -d` boots healthy with no extra services. Milvus
(with its etcd + MinIO) is an **optional** add-on behind the `--profile milvus`
flag — see [The optional `--profile milvus` add-on](#the-optional---profile-milvus-add-on).

### 1. Run the installer

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
```

Run with **no flags**, the installer launches the interactive
[wizard](#path-3--interactive-wizard) (the default mode). For the
**zero-config, five-minute** Docker path, pass `--quick`:

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash -s -- --quick
```

`--quick` does the following, in order:

1. **Probes Ollama** at `localhost:11434`. If found, it points the containers at
   it via `host.docker.internal`. If not found, it stops and tells you to install
   Ollama (the quick path requires it — use the wizard for cloud-LLM-only setups).
2. **Ensures the models exist.** It pulls the embedding model
   (`nomic-embed-text`, ~270 MB) if missing, and auto-detects an existing
   tool-capable chat model (`qwen2.5`, `qwen3`, `gpt-oss`, `llama3.x`, `mistral`,
   `gemma`). If none is present it pulls `qwen2.5:7b` (~4.7 GB, roughly 3 minutes
   on broadband).
3. **Generates strong random secrets** and writes `.env` — `POSTGRES_PASSWORD`,
   the admin password, `JWT_SECRET`, `SIGNING_SECRET`, `INTERNAL_API_KEY`,
   `FRONTEND_SECRET`, and `INTERNAL_SERVICE_SECRET` (each via `openssl rand`). No
   weak defaults ship. The admin credentials are also written to
   `~/.openagentic/admin-credentials.txt` (mode `600`).
4. **Detects host cloud CLIs** (`~/.aws`, `~/.azure`, `~/.config/gcloud`,
   `~/.kube`) and reports which ones will be mounted read-only into the MCP proxy.
5. **Brings the stack up** with `docker compose up -d` (the default pgvector-only
   stack — no etcd/minio/milvus).
6. **Waits for the API to report healthy** (~90 s on first boot), then prints the
   UI URL and opens your browser auto-logged-in via a one-shot magic link.

By default a `curl … | bash` install lands in `~/.openagentic` (overridable with
`OPENAGENTIC_HOME`). If you run the script from inside a checkout that contains
`docker-compose.yml` and `services/openagentic-api`, it uses that checkout in
place instead.

### 2. The optional `--profile milvus` add-on

The default vector backend is **pgvector** (Postgres), so the everyday up command
is just:

```bash
docker compose up -d
```

This boots healthy on its own — no etcd, MinIO, or Milvus required. The API uses
pgvector for MCP tool search and RAG by default (`isMilvusEnabled()` in
`server.ts` returns `false` unless you opt in), so a bare `up` is the supported
path for a laptop, a VM, or a single-node deploy.

**Milvus is optional** — reach for it only when you want a dedicated vector
database for high-availability or large-scale RAG. It and its two dependencies
(etcd, MinIO) sit behind the `milvus` profile so they can be pulled and started
as one unit. To enable it, pass the profile **and** turn the API's Milvus path on
with `MILVUS_ENABLED=true`:

```bash
# DEFAULT — pgvector-only, boots healthy with no extra services
docker compose up -d

# OPTIONAL — add the Milvus trio for HA / large-scale RAG
MILVUS_ENABLED=true docker compose --profile milvus up -d
```

> When you opt into Milvus, the API connects to it on boot and will exit if it
> cannot reach it — so only set `MILVUS_ENABLED=true` together with
> `--profile milvus` (or point `MILVUS_HOST` at a reachable external Milvus).
> Prometheus, SearXNG, and the app services are in the **default** profile, so
> the only thing the `milvus` profile adds is `etcd`, `minio`, and `milvus`.

### 3. First boot

First boot pulls the application images (a few GB) and pulls the embedding model
into the bundled Ollama (~270 MB) before the API becomes healthy. **Plan ~3–5
minutes on the first start; under 30 seconds thereafter.** The `ollama-init`
one-shot container does the model pull and then exits — that is expected.

A few first-boot behaviors are intentional and idempotent on later boots:

- The API runs `prisma db push` on startup to create its schema (the first boot
  has no tables yet).
- The Postgres init script enables the `vector` extension so the embedding
  columns can be created.
- The MCP tool semantic index is empty on the very first boot; the first chat
  request re-triggers indexing. This is a warning, not a failure.

### 4. The UI and the port

The UI is published on the host at **`http://localhost:8080`** by default. The
host port comes from `UI_HOST_PORT` in `.env` (the container always listens on
`80` internally):

```yaml
# docker-compose.yml (ui service)
ports:
  - "${UI_HOST_PORT:-8080}:80"
```

If port 8080 is already in use, set `UI_HOST_PORT=8088` (or any free port) in
`.env` and re-run the up command.

---

## Path 2 — Kubernetes (Helm)

Use this if you already run Kubernetes. The chart is **self-contained**: Postgres
(pgvector), Redis, Ollama, Milvus (bundling its own etcd + MinIO), SearXNG, and
Prometheus all ship as plain `Deployment`s — there are no external subcharts to
install first. A single `helm install` brings up the whole stack.

### One-line install

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash -s -- --helm
```

In `--helm` mode the installer:

1. Verifies `helm`, `kubectl`, and a reachable cluster.
2. **Generates strong random secrets once** and persists them to
   `~/.openagentic/helm-secrets.yaml` (mode `600`) — so a re-run never rotates
   the trust roots out from under a running release (which would 401 every
   session). The admin credentials are also written to
   `~/.openagentic/admin-credentials.txt`.
3. Runs `helm upgrade --install` of the chart into the `openagentic` namespace
   (created if missing) and waits up to 10 minutes for the rollout.

The namespace and release name default to `openagentic` and are overridable via
`OPENAGENTIC_NAMESPACE` / `OPENAGENTIC_RELEASE`.

After it completes, open the UI by port-forwarding the `ui` service:

```bash
kubectl -n openagentic port-forward svc/ui 8080:80
# → http://localhost:8080
```

### Manual install (full control)

If you prefer to drive Helm yourself:

```bash
# 1. Namespace
kubectl create namespace openagentic

# 2. (Optional) TLS for in-cluster ingress termination
kubectl create secret tls openagentic-tls \
  --cert=path/to/tls.crt --key=path/to/tls.key -n openagentic

# 3. Install (supply your own values overlay carrying the secrets)
helm upgrade --install openagentic ./helm/openagentic -n openagentic \
  -f your-values.yaml
```

> The OpenAgentic image registry defaults to the public `ghcr.io/agentic-work`,
> so no image-pull secret is needed unless you mirror the images to a private
> registry.

#### Secrets are required — there are no weak defaults

Every secret value in the chart is `required`-guarded. An unset value **aborts
`helm install`** with a clear message — the same fail-fast posture as Compose's
`${VAR:?}`. The guarded values are:

| Values key | Suggested generator |
|---|---|
| `secrets.postgresPassword` | `openssl rand -hex 16` |
| `secrets.jwtSecret` | `openssl rand -hex 32` |
| `secrets.signingSecret` | `openssl rand -hex 32` |
| `secrets.internalApiKey` | `openssl rand -hex 32` |
| `secrets.frontendSecret` | `openssl rand -hex 32` |
| `secrets.adminPassword` | your first-boot admin login password |

Either run `./install.sh --helm` (which generates and persists all of these for
you), or supply your own overlay:

```yaml
# your-values.yaml
secrets:
  postgresPassword: "<openssl rand -hex 16>"
  jwtSecret: "<openssl rand -hex 32>"
  signingSecret: "<openssl rand -hex 32>"
  internalApiKey: "<openssl rand -hex 32>"
  frontendSecret: "<openssl rand -hex 32>"
  adminEmail: admin@openagentic.local
  adminPassword: "<your-admin-password>"
```

> The chart wires the `internalApiKey` value into every internal trust root
> (`INTERNAL_API_KEY`, `API_INTERNAL_KEY`, `INTERNAL_SERVICE_SECRET`,
> `OPENAGENTIC_PROXY_INTERNAL_KEY`) so the inter-service auth all agrees out of
> the box.

#### Milvus, Ollama, and providers

- **Milvus** is enabled by default (`milvus.enabled: true`) and bundles its own
  etcd + MinIO inline. Set `milvus.enabled: false` only if you wire the API to
  pgvector-only mode.
- **Ollama** — point `ollama.host` at an in-cluster or external endpoint, or
  enable the in-cluster Ollama under `ollama.*`. The chart pulls `ollama.embedModel`
  (default `nomic-embed-text`) and `ollama.chatModel` (default `llama3.2:3b`) on
  first boot.
- **Providers** — a bare install seeds the local Ollama bootstrap provider only.
  Every other provider, including **AWS Bedrock** (Claude Sonnet / Opus), is
  added once at runtime in **Admin → LLM → Provider Management** and persisted in
  the database. For Bedrock you can put `secrets.awsAccessKeyId` /
  `secrets.awsSecretAccessKey` / `secrets.awsRegion` in your values so the
  cluster carries the credentials, then add the Bedrock provider in the Admin UI.

#### Verify

```bash
kubectl get pods -n openagentic
kubectl rollout status deploy/api -n openagentic

# API health — the Service is named `api` on port 8000
kubectl port-forward -n openagentic svc/api 8080:8000 &
curl -s http://localhost:8080/api/health | jq .
```

#### Uninstall

```bash
helm uninstall openagentic -n openagentic
# Postgres/Redis/Milvus are in-chart, so this removes them too.
# PVCs are retained by default — delete them explicitly to wipe the data:
kubectl delete pvc -l app.kubernetes.io/instance=openagentic -n openagentic
```

---

## Path 3 — Interactive wizard

The wizard is the **default** mode of `install.sh` (no flags), and can be invoked
explicitly with `--wizard`. It is an Ink TUI published as the npm package
`@openagentic/setup` and **requires Node.js 20+**.

```bash
# default mode launches the wizard
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
# …or explicitly
./install.sh --wizard
```

The wizard walks you through, on screen:

1. **Deploy target** — Docker (Compose) or Helm (Kubernetes).
2. **Admin user** — email + password for the first-boot local admin.
3. **Ollama** — endpoint and model strategy.
4. **LLM providers** — which providers to configure (e.g. local Ollama, AWS
   Bedrock for Claude).
5. **MCP selection** — which of the built-in MCP servers to enable.
6. **Per-MCP auth** — credentials for the MCPs that need them.
7. **Review → launch** — it writes `.env` (the same shape `--env` consumes) and
   brings the stack up.

### Running the wizard against a local checkout directly

If you have the source on disk and want the wizard without `install.sh` wrapping
it:

```bash
# first run only — install the wizard's dependencies
(cd tools/setup && npm install)

# launch
./tools/setup/node_modules/.bin/tsx tools/setup/src/index.tsx

# then bring the stack up (pgvector-only default — boots healthy as-is)
docker compose up -d
# …or opt into the optional Milvus backend:
# MILVUS_ENABLED=true docker compose --profile milvus up -d
```

---

## Reusing a `.env` (the `--env` path)

Once you have a known-good `.env` (from a previous wizard run, or hand-written),
you can skip **all** prompts and auto-generation on a second machine or in CI:

```bash
./install.sh --env /path/to/your.env
```

This copies your file to `./.env` (mode `600`), mints a `MAGIC_BOOT_TOKEN` if one
isn't present (so first-run autologin still works), brings the stack up with
`docker compose up -d` (the default pgvector stack; add `--milvus` to opt into
Milvus), waits for the API to go healthy, and prints the UI + autologin URLs. The
wizard writes exactly this `.env` shape, so `--env` is the "I already configured
it once, now do it again" path.

### Configuring `.env` by hand

Copy `.env.example` to `.env` and replace every `REPLACE_ME_AT_INSTALL_TIME`
placeholder before bringing the stack up. The required secrets (no weak
defaults — Compose fails fast via `${VAR:?}` if any is unset) are:

| Variable | Purpose | Generator |
|---|---|---|
| `POSTGRES_PASSWORD` | Postgres password | `openssl rand -hex 16` |
| `JWT_SECRET` | Signs/validates user + session JWTs | `openssl rand -hex 32` |
| `SIGNING_SECRET` | Signs internal HS256 inter-service tokens | `openssl rand -hex 32` |
| `INTERNAL_API_KEY` | api ↔ mcp-proxy service-account bearer | `openssl rand -hex 32` |
| `FRONTEND_SECRET` | UI session secret | `openssl rand -hex 32` |
| `INTERNAL_SERVICE_SECRET` | Mints/HMAC-verifies the `oa_sys_` inter-service token (api and mcp-proxy must share it) | `openssl rand -hex 32` |
| `ADMIN_SEED_PASSWORD` | First-boot admin password | your choice |

Useful optional knobs:

| Variable | Default | What it does |
|---|---|---|
| `UI_HOST_PORT` | `8080` | Host port the UI is published on. |
| `ADMIN_USER_EMAIL` | `admin@openagentic.local` | First-boot admin email. |
| `OLLAMA_HOST` | bundled `http://ollama:11434` | Point at a remote/host Ollama (e.g. `http://host.docker.internal:11434`). |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model pulled on boot. |
| `OLLAMA_CHAT_MODEL` | _(empty)_ | Pre-pull a local chat model so you can chat with zero API keys. |
| `OPENAGENTIC_REGISTRY` | `ghcr.io/agentic-work` | Where Compose pulls the images from. |
| `OPENAGENTIC_TAG` | `latest` | Image tag to pull. |

LLM provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, the `AZURE_OPENAI_*`
pair, the `AWS_*` family, `GOOGLE_GENERATIVE_AI_API_KEY`) are all optional — set
whatever you have. The Smart Model Router selects models per request, so you do
not configure model IDs here.

---

## Cloud MCP credentials

The built-in MCP servers fall into two groups:

- **No credentials needed:** `web`, `admin` (and the in-process knowledge/memory
  tooling). These work the moment the stack is up.
- **Credential-backed:** `aws`, `azure`, `gcp`, `kubernetes`, `github`,
  `prometheus`, `loki`. All of these still **spawn** out of the box — an
  unconfigured one simply returns a "needs config" / connection error on a tool
  call.

The Compose stack mounts your host CLI configs **read-only** into the MCP proxy
so the cloud MCPs use the same credentials you already have:

```yaml
# docker-compose.yml (mcp-proxy service) — mounted into the non-root HOME (uid 1000)
volumes:
  - ${HOME}/.azure:/home/mcpuser/.azure:ro
  - ${HOME}/.aws:/home/mcpuser/.aws:ro
  - ${HOME}/.config/gcloud:/home/mcpuser/.config/gcloud:ro
  - ${HOME}/.kube:/home/mcpuser/.kube:ro
```

The mcp-proxy runs unprivileged (uid 1000). On Linux the host cred files must be
readable by uid 1000 (the default first-user UID, so usually they already are);
macOS Docker Desktop maps file-share ownership transparently.

If a host config directory is absent, the proxy falls back to
`~/.openagentic/cloud-secrets/{aws,azure,gcp}.env` (the installer creates empty
stubs so the mounts never fail). Fill those in by hand, or let the wizard write
them. To wire up the cloud CLIs the usual way, run `az login` / `aws configure`
/ `gcloud auth login` on the host and restart the proxy.

> The `prometheus` MCP is pre-wired to the in-stack Prometheus
> (`http://prometheus:9090`) and works out of the box. `github` needs a PAT
> (`GITHUB_TOKEN`); `loki` needs an external `LOKI_URL` — both still start
> without them.

---

## Health check and first login

After the stack is up (give it ~90 s on first boot), confirm everything is
healthy.

### Container status

```bash
# all services should be healthy or running
# (etcd/minio/milvus appear only if you opted into `--profile milvus`)
docker compose ps

# wait for the api to report healthy
docker inspect --format '{{.State.Health.Status}}' openagentic-api-1
```

### API health

The API self-reports its connection status to each dependency:

```bash
curl -s http://localhost:8080/api/health | jq .
```

### Log in

The seeded admin account is `admin@openagentic.local` with the password the
installer generated (in `~/.openagentic/admin-credentials.txt`, or whatever you
set as `ADMIN_SEED_PASSWORD`). Log in through the UI at
`http://localhost:8080`, or via the API:

```bash
curl -sX POST http://localhost:8080/api/auth/local/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@openagentic.local","password":"<from-installer>"}'
```

The quick/`--env` paths also print a one-shot **magic link**
(`http://localhost:8080/auth/magic?token=…`) and open your browser
auto-logged-in. Pass `--no-open` to skip the browser launch.

> **Auth in OSS is local-only:** username/password stored in Postgres, plus JWTs
> and API keys. There is no SSO / federated identity in the open-source edition.

---

## Updating an existing install

```bash
# Docker: pull latest source, rebuild, restart (keeps your .env)
./install.sh --update

# Kubernetes: helm upgrade in place (auto-detected if a release exists)
./install.sh --update    # with --helm, or when a Helm release is found
```

`--update` is safe to re-run. On the Docker path it runs
`docker compose up -d --build` (matching whichever vector backend you installed
with — it adds `--profile milvus` only if you pass `--milvus`) and waits for the
API to return to healthy; on the Helm path it runs `helm upgrade` and waits for
the rollout.

---

## Installing from a local checkout

While the repository is private (pre-launch), the public `curl | bash` URLs
404. Clone the repository and run the script from the checkout — `install.sh`
detects a local checkout (it looks for `docker-compose.yml` +
`services/openagentic-api`) and uses it directly, building the images locally
instead of pulling from GHCR:

```bash
git clone git@github.com:agentic-work/openagentic.git
cd openagentic

# any mode works against the checkout
./install.sh --quick          # zero-config Docker
./install.sh --wizard         # interactive TUI
./install.sh --helm           # Kubernetes
./install.sh --doctor         # diagnose only
```

---

## Troubleshooting first boot

These are the landmines that trip a first install. If the API crashloops, check
the logs against this list first (`docker logs openagentic-api-1 --tail=100`):

| Symptom | Cause / fix |
|---|---|
| API exits immediately, never goes healthy | If you opted into Milvus (`MILVUS_ENABLED=true`) but started a **bare** `docker compose up`, the api can't reach Milvus. Either drop `MILVUS_ENABLED` to run pgvector-only, or start with `MILVUS_ENABLED=true docker compose --profile milvus up -d`. The default pgvector-only `docker compose up -d` boots healthy on its own. |
| `table … does not exist` | Prisma schema push hadn't run — it now runs on entrypoint and is idempotent; restart the api. |
| `type "halfvec" does not exist` | pgvector extension. The Postgres init script enables it on first boot; if you reused an old volume, recreate it. |
| `Post-indexing verification failed — 0 results` | Expected on first boot (empty tool index). The first chat request re-triggers indexing — not fatal. |
| mcp-proxy returns 401 on tool calls | `JWT_SECRET` / `SIGNING_SECRET` / `INTERNAL_API_KEY` / `INTERNAL_SERVICE_SECRET` must agree across api, ui, mcp-proxy, workflows, and proxy. The installer-generated `.env` keeps them in sync. |
| Port 8080 unreachable | Something else holds 8080. Set `UI_HOST_PORT` in `.env` and re-run. |

When in doubt, run `./install.sh --doctor` and check `docker compose ps`.
