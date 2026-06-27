# The `oa` CLI — headless control plane

`oa` is the official command-line client for OpenAgentic. It drives a running
deployment **entirely from the terminal** — chat, Flows, agents, health, and
API-key management — with no web UI involved. If you live on the command line,
automate against the platform from scripts/CI, or run OpenAgentic **headless**
(no UI container at all), `oa` is how you talk to it.

It is a thin, dependency-light client over the same HTTP API the web UI uses, so
anything you can do in chat or Flows you can do from `oa`.

- **Package:** `@agenticwork/oa` (source under [`tools/oa`](../../tools/oa))
- **Binary:** `oa`
- **Talks to:** any OpenAgentic instance's API (`/api/*`), local or remote

---

## What it's for

| You want to… | `oa` gives you |
|---|---|
| Run OpenAgentic with **no UI container** (lighter, smaller attack surface, air-gapped/regulated) | The control plane for the [headless install](#headless-install-no-ui-container) |
| **Ask the agent things from the terminal** | `oa chat "which pods are crashlooping and why?"` |
| **Automate / script** against the platform (cron, CI, runbooks) | Non-interactive auth + `--json` output for piping |
| **Run Flows and agents** programmatically | `oa flow run` / `oa agent run` |
| **Manage credentials** for machine access | `oa key create/list/revoke` (user-bound, revocable) |
| Drive **multiple instances** (dev / staging / prod) | Named profiles (`--profile`) |

> **Authentication model.** Everything programmatic uses an **API-issued,
> user-bound, revocable key** (`oa_…`). `oa login` exchanges your
> username/password for one and stores it; the short-lived login JWT is never
> persisted. There is no static "system" token — a key is always tied to a real
> user and can be revoked at any time (`oa key revoke`).

---

## Install

### Global (recommended)

```bash
npm install -g @agenticwork/oa
oa --version
```

### From a checkout

```bash
cd tools/oa
npm install
npm run build          # bundles dist/cli.js
npm install -g .       # or: npm link  (for live-reloading dev)
```

**Prerequisites:** Node 20+. That's it — `oa` has no runtime dependencies beyond
the Node standard library and a small argument parser, bundled into a single file.

---

## Quick start

```bash
# 1. Point oa at your instance and sign in (mints + stores a user-bound key).
oa login --instance http://localhost:8080
#    Username or email: admin@openagentic.local
#    Password: ********

# 2. Confirm who you are and that the instance is healthy.
oa whoami
oa health

# 3. Talk to the agent.
oa chat "summarize the error logs from the last hour"
```

`oa login` saves a **profile** (default name `default`) to
`~/.config/oa/config.json` (created mode `0600`). Subsequent commands reuse it —
no need to re-authenticate or pass `--instance` again.

---

## Headless install (no UI container)

`oa` is the companion to OpenAgentic's **headless** deploy mode, where the stack
runs API-only — no UI container at all. The web UI is *optional*; the API is the
entrypoint.

**Wizard:** choose **"Docker — headless (API only)"** at the deploy-target step.

**install.sh:** add `--headless`:

```bash
curl -sSL https://install.openagentics.io | bash -s -- --quick --headless
```

**Manual Compose:** the `ui` service is behind the `ui` profile, so simply omit it.
The API is published on the host (`API_HOST_PORT`, default `8080`):

```bash
docker compose up -d                       # API only — no UI container
#  (a full install is: docker compose --profile ui up -d)

oa login --instance http://localhost:8080
oa chat "which pods are crashlooping and why?"
```

A headless install writes `OPENAGENTIC_HEADLESS=true`, `DOCS_AUTO_INGEST=false`,
and `API_HOST_PORT` to `.env`. Everything else (providers, MCPs, audit, approval
gate) is identical to a full install — you just drive it with `oa` instead of a
browser.

---

## Commands

### Auth & connection

```bash
oa login [--instance URL] [-u USER] [-w PASSWORD] [--name PROFILE]
oa logout [--profile NAME]
oa whoami [--profile NAME]
oa health [--instance URL]          # unauthenticated; works before login
```

- `oa login` resolves the instance URL, username, and password from flags, then
  the `OA_PASSWORD` environment variable, then interactive prompts (password is
  masked). It detects whether the instance serves a web UI and tells you so.
- `--name` saves the profile under a chosen name so you can keep several
  instances side by side (see [Profiles](#profiles--multiple-instances)).

### API keys

```bash
oa key list                          # list your keys (id, name, created, last used)
oa key create <name>                 # mint a new user-bound key; printed ONCE
oa key revoke <id>                   # revoke immediately
```

Use `oa key create ci-runner` to mint a dedicated key for automation, then hand
it to CI as `OA_*`/header auth — and `oa key revoke` it the moment it's no longer
needed. Keys are tied to *your* user and inherit *your* permissions.

### Chat

```bash
oa chat <message...>                 # create a session and stream the reply
oa chat "..." --session <id>         # continue an existing session
oa chat "..." --json                 # one-shot machine-readable {sessionId,text}
```

The reply streams token-by-token (the platform speaks newline-delimited JSON; `oa`
renders the assistant text and omits the model's internal reasoning). Tool calls
the agent makes (MCP tools, approval gate) happen server-side exactly as in the UI.

### Flows (workflows)

```bash
oa flow list                         # id + name of every Flow
oa flow run <id> [--input '{"region":"us-east-1"}']
```

### Agents

```bash
oa agent list                        # id + name of every agent
oa agent run <id> <task...>          # run an agent on a task
```

### Global options (available on every command)

| Option | Meaning |
|---|---|
| `-p, --profile <name>` | Use a named profile instead of the default |
| `--instance <url>` | Target a specific instance URL (overrides the profile) |
| `--json` | Machine-readable JSON output (for scripting / piping) |

---

## Profiles — multiple instances

```bash
oa login --instance https://oa.prod.internal --name prod
oa login --instance http://localhost:8080   --name dev

oa health  -p prod
oa chat "deploy status?" -p dev
```

Profiles live in `~/.config/oa/config.json` (override with `OA_CONFIG_DIR`, or it
honors `XDG_CONFIG_HOME`). The file is written `0600`; it stores the instance URL
and the minted API key — never your password.

---

## Use cases

- **Headless / air-gapped / regulated deployments.** Run OpenAgentic with no UI
  container; operate it entirely over the API from a hardened jump host.
- **Terminal-native incident response.** `oa chat "what changed in the last
  deploy and is it the cause of the 5xx spike?"` — the agent investigates with the
  Kubernetes / Prometheus / Loki MCPs and proposes fixes behind the approval gate.
- **Scripted runbooks & cron.** Mint a key, drop it in a scheduled job, and call
  `oa flow run <incident-triage>` or `oa agent run` on a schedule.
- **CI/CD.** Use `--json` output to parse results in pipelines; revoke the key
  when the job finishes.
- **Fleet of instances.** Manage dev/staging/prod from one terminal with profiles.

---

## Scripting tips

```bash
# Non-interactive login (e.g. in CI):
OA_PASSWORD="$ADMIN_PW" oa login --instance "$OA_URL" -u "$OA_USER" --name ci

# Parse a chat reply as JSON:
oa chat "list the 3 noisiest namespaces" --json | jq -r .text

# Health-gate a deploy step:
oa health --instance "$OA_URL" --json | jq -e '.status=="healthy"'
```

`oa` exits non-zero on error and prints the server's message (never an opaque
`[object Object]`), so it composes cleanly in shell pipelines.

---

## See also

- **[Installation](03-installation.md)** — all install paths, including `--headless`.
- **[API Reference](11-api-reference.md)** — the HTTP API `oa` is built on.
- **[Chat & Artifacts](07-chat-and-artifacts.md)** — what the agent can do in a chat turn.
- **[Flows & Workflows](08-flows.md)** — authoring the Flows you run with `oa flow run`.
