# The `oa` agent gateway — programmatic & CI/CD automation

The [`oa` CLI](13-oa-cli.md) and the platform's HTTP API are two faces of the same
thing: a **governed execution gateway** you can drive from any script, pipeline,
or other agent. OpenAgentic is not a coding model — it's a tool-discovery and
tool-execution plane (chat + Flows) wired to ops/cloud/git MCP servers, wrapped
in a hard human-in-the-loop (HITL) approval gate and a tamper-evident audit
chain, and reachable with **user-bound, revocable API keys**. That combination —
*autonomous action with a non-repudiable approval seam at every mutating step* —
is what makes it usable as a CI/CD and GitOps agent gateway.

This guide is for everything beyond an interactive terminal session: GitHub
Actions, GitLab CI, cron runbooks, and "an agent that opens a PR and waits for a
human to approve the merge."

> **Honesty up front.** Everything in the "Today" sections below ships in this
> repo and is callable now. Where a capability is part of the planned SCM-aware
> automation work (epics #118–#122) and *not yet built*, it's labelled
> **#118–122 (planned)** and the honest current path is described instead. The
> in-PTY managed coding runner (**agenticode / Code Mode**) is **enterprise-only
> and not in this OSS repo** — see [Coding muscle in OSS](#coding-muscle-in-oss).

---

## What the gateway is, and why

A CI agent needs four things that a raw LLM endpoint doesn't give you:

1. **Action primitives** — real tools that touch GitHub, Kubernetes, the cloud,
   metrics, logs, and the browser (the [MCP servers](#actionprimitives-mcp--synth--brainbow)).
2. **A human checkpoint on consequential actions** — so an agent can't merge,
   deploy, or delete on its own ([the approval gate](#securitygovernance)).
3. **An attributable, tamper-evident record** of who did what ([the audit chain](#securitygovernance)).
4. **Credentials that are scoped, attributable, and revocable** — not a static
   token baked into a repo secret.

OpenAgentic ships all four as core, open-source properties, not paid add-ons. The
gateway is the seam where your pipeline hands a task to the platform and the
platform runs it through that governance, on infrastructure **you** control, with
**your** models and **zero phone-home**.

---

## `oa` and the native API — when to use which

Both speak to the same `/api/*` surface. `oa` is a thin, dependency-light client
over it.

- **Use `oa`** for ergonomics: login/profile management, streaming chat rendered
  to your terminal, `--json` output ready for `jq`, and key lifecycle. It's the
  fastest way to wire a pipeline step.
- **Use the native API** when you don't want a Node toolchain on the runner, when
  you need an endpoint `oa` doesn't wrap (Flow CRUD, webhooks, approvals,
  execution history), or when you're integrating from another language.

Every `oa` command maps to concrete endpoints — drop down to `curl` for anything
not surfaced by the CLI:

| `oa` command | HTTP endpoint(s) |
|---|---|
| `oa login -u … -w … [--instance …]` | `POST /api/auth/local/login` → then `POST /api/workflows/user/api-keys` (mints + stores the user-bound key); best-effort `GET /` (UI probe) |
| `oa logout` | *(local only — removes the profile; no API call)* |
| `oa whoami` | `POST /api/auth/validate-token` |
| `oa health` | `GET /api/health` *(unauthenticated)* |
| `oa key list` | `GET /api/workflows/user/api-keys` |
| `oa key create <name>` | `POST /api/workflows/user/api-keys` body `{name}` |
| `oa key revoke <id>` | `DELETE /api/workflows/user/api-keys/:id` |
| `oa flow list` | `GET /api/workflows` |
| `oa flow run <id> [--input …]` | `POST /api/workflows/:id/execute` body `{input, trigger_type:"manual"}` |
| `oa agent list` | `GET /api/agents` |
| `oa agent run <id> <task…>` | `POST /api/agents/:id/execute` body `{task, context}` |
| `oa chat <msg…> [--session …]` | `POST /api/chat/sessions` body `{title}` (only when `--session` omitted) → then `POST /api/chat/stream` body `{sessionId, message}`, streamed as NDJSON |

Notes that bite you if you script the API directly:

- **API-key management lives under `/api/workflows/user/api-keys`** — there is no
  `/api/keys` route. Keys are returned **once** at creation (bcrypt-hashed
  server-side), format `oa_<base64url>`, with optional 1–365-day expiry.
- **Chat streams newline-delimited JSON** (`application/x-ndjson`). The reader
  tolerates an optional `data:` SSE prefix and skips `[DONE]`/keepalives. The
  `sessionId` is at `json.session.id` on the create-session response.
- The full, live OpenAPI 3.1 spec is served at **`/api/swagger`** (interactive
  UI) and **`/api/swagger/json`** (raw, unauthenticated) on any running instance.
  Don't rely on the committed `openapi.json` — it's generated at runtime.

---

## GitHub Actions integration

The pattern: **mint a scoped key → run the gateway with `--json` → parse with
`jq` → revoke the key**. The key lives only for the job, and every action it
takes is attributable to it in the audit log.

This workflow runs a failed-deploy RCA Flow on demand and posts the result as a
PR comment. It assumes a reachable OpenAgentic instance (e.g. a self-hosted
runner that can reach your in-cluster API) and two repo secrets: `OA_URL`,
`OA_USER`, `OA_PASSWORD`.

```yaml
name: oa-rca
on:
  workflow_dispatch:
  issue_comment:
    types: [created]   # e.g. trigger on "/oa rca" in a PR comment

jobs:
  rca:
    # self-hosted keeps the agent + model + secrets entirely on your infra
    runs-on: self-hosted
    permissions:
      contents: read
      pull-requests: write
    env:
      OA_URL:      ${{ secrets.OA_URL }}
      OA_USER:     ${{ secrets.OA_USER }}
      OA_PASSWORD: ${{ secrets.OA_PASSWORD }}
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Install the oa CLI
        run: npm install -g @agenticwork/oa

      # 1. Mint a short-lived, user-bound, revocable key for THIS job only.
      #    oa login exchanges user/pw for a key and stores it in a job-scoped profile.
      - name: Mint a job-scoped key
        run: |
          oa login --instance "$OA_URL" -u "$OA_USER" --name ci
          # capture the key id so we can revoke it in the always() step
          oa key create "gha-${GITHUB_RUN_ID}" --json -p ci > key.json
          echo "OA_KEY_ID=$(jq -r .id key.json)" >> "$GITHUB_ENV"

      # 2. Health-gate: bail before doing work if the instance is unhealthy.
      - name: Health gate
        run: oa health --instance "$OA_URL" --json | jq -e '.status=="healthy"'

      # 3. Run a Flow (or `oa chat`) with --json for machine-readable output.
      - name: Run failed-deploy RCA
        id: rca
        run: |
          FLOW_ID=$(oa flow list --json -p ci \
            | jq -r '.[] | select(.name=="failed-deploy-rca") | .id')
          oa flow run "$FLOW_ID" -p ci \
            --input "{\"ref\":\"${GITHUB_SHA}\",\"repo\":\"${GITHUB_REPOSITORY}\"}" \
            --json > rca.json
          # 4. Parse with jq and hand to the next step.
          jq -r '.output.summary // .text' rca.json > rca.md

      # Equivalent one-shot via chat instead of a Flow:
      #   oa chat "RCA the failed deploy at ${GITHUB_SHA}" --json -p ci | jq -r .text

      - name: Comment the RCA on the PR
        if: github.event.issue.pull_request
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: gh pr comment "${{ github.event.issue.number }}" --body-file rca.md

      # 5. ALWAYS revoke the key — even if a step above failed.
      - name: Revoke the job key
        if: always()
        run: oa key revoke "$OA_KEY_ID" -p ci || true
```

Pure-`curl` variant of the mint→run→revoke core, for runners without Node:

```bash
# mint
KEY=$(curl -sX POST "$OA_URL/api/auth/local/login" -H 'Content-Type: application/json' \
        -d "{\"username\":\"$OA_USER\",\"password\":\"$OA_PASSWORD\"}" | jq -r .token)
APIKEY=$(curl -sX POST "$OA_URL/api/workflows/user/api-keys" \
        -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
        -d '{"name":"gha-run"}')
TOKEN=$(echo "$APIKEY" | jq -r .key); KEY_ID=$(echo "$APIKEY" | jq -r .id)
# run
curl -sX POST "$OA_URL/api/workflows/$FLOW_ID/execute" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"input":{"ref":"'"$GITHUB_SHA"'"},"trigger_type":"manual"}' | jq .
# revoke
curl -sX DELETE "$OA_URL/api/workflows/user/api-keys/$KEY_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## GitLab CI equivalent

Same shape, GitLab syntax. `after_script` runs even when the job fails, so the
revoke always fires.

```yaml
oa-rca:
  image: node:20
  tags: [self-hosted]            # keep the agent + model on your infra
  variables:
    OA_URL: "$OA_URL"
    OA_USER: "$OA_USER"
    OA_PASSWORD: "$OA_PASSWORD"  # set as masked/protected CI variables
  before_script:
    - npm install -g @agenticwork/oa jq || apt-get update && apt-get install -y jq
    - oa login --instance "$OA_URL" -u "$OA_USER" --name ci
    - oa key create "gl-$CI_PIPELINE_ID" --json -p ci > key.json
    - export OA_KEY_ID=$(jq -r .id key.json)
  script:
    - oa health --instance "$OA_URL" --json | jq -e '.status=="healthy"'
    - FLOW_ID=$(oa flow list --json -p ci | jq -r '.[]|select(.name=="failed-deploy-rca")|.id')
    - oa flow run "$FLOW_ID" -p ci --input "{\"ref\":\"$CI_COMMIT_SHA\"}" --json > rca.json
    - jq -r '.output.summary // .text' rca.json
  after_script:
    - oa key revoke "$OA_KEY_ID" -p ci || true
  artifacts:
    paths: [rca.json]
```

---

## Autonomous Flow & object creation

Flows are first-class API objects — you can create, version, run, and trigger
them programmatically. This is real today:

- **Create / list / read / update / delete:** `POST /api/workflows`,
  `GET /api/workflows`, `GET|PUT|DELETE /api/workflows/:id`.
- **Run:** `POST /api/workflows/:id/execute`; history at
  `GET /api/workflows/:id/executions`.
- **Versioning:** `POST|GET /api/workflows/:id/versions`,
  `PUT /:id/versions/:versionId/activate`, `POST /:id/duplicate`.
- **Webhook triggers:** `POST|GET|DELETE /api/workflows/:id/webhooks` mint a
  `wh_<uuid>` key; an external system fires the Flow at
  `POST /api/v1/hooks/:key`.
- **Client codegen:** `GET /api/workflows/:id/snippets` emits ready-to-paste
  `curl` / Python / JS / TS / MCP examples for invoking a Flow — the explicit
  "drive me from your pipeline" affordance.
- **Cron:** `WorkflowSchedule` rows (`cron_expression`) are polled by the
  in-platform `WorkflowScheduler` and dispatched unattended — the trigger for a
  nightly RCA or hourly drift check.

A Flow is a typed React-Flow node graph (trigger / `http_request` /
`llm_completion` / `openagentic_llm` / RAG / agent nodes). LLM nodes resolve
`model:"auto"` at run time — **no hardcoded model IDs**.

**On the "AI Flow Builder":** what exists today is **template-seeding + LLM-assisted
scaffolding**, not a black-box "one sentence → production Flow" generator. Built-in
seed templates ship with the platform (multi-agent research, `incident-triage`,
`cost-anomaly`, `failed-deploy-rca`, `rag-knowledge-qa`); a `flowsExpertAgent` +
`ComposeVisualTool` can scaffold/compose graphs, and `WorkflowCompiler` compiles a
graph to an executable plan. So the honest autonomous-creation path is:
**duplicate/seed a template → `PUT` your parameters → activate a version → run**,
optionally with the compose agent assisting the graph authoring. A true
natural-language Flow generator is on the roadmap, not shipped.

**SCM-event-driven creation/triggering (#118–122, planned).** Today a GitHub
webhook can fire a Flow through the *generic, security-hardened* webhook ingress
(`POST /api/v1/hooks/:key`, with HMAC-SHA256 verification + a GitHub source-IP
allowlist + DLP/injection scanning). What does **not** exist yet: a GitHub/GitLab
*event-aware* layer — no `/hooks/github` route, no `push` vs `pull_request`
parsing/filtering, no GitLab token-auth support, no SCM trigger node or template,
and no GitHub-App auto-registration. Setup today is manual: create a workflow
webhook, paste the `wh_…` URL into the repo settings, set the shared secret on the
webhook to engage HMAC. Frame the SCM-aware integration as work building **on top
of** this existing substrate.

---

## The autonomous-dev loop with HITL at PR / code-review

These primitives compose into a governed GitOps loop:

```
 TRIGGER          OBSERVE              REASON            ACT (governed)              REVIEW
 ───────          ───────              ──────            ─────────────               ──────
 cron schedule    prometheus MCP       chat V2 pipeline  github MCP (PR/issue/file)  approval gate
 webhook          loki MCP             (tool_search →    synth (one-shot Py tools)   → approval_required
 oa flow run      kubernetes MCP       executeMcpTool)   brainbow (browser verify)   → inline HITL card
 (job key)        web MCP              flow LLM nodes    (BYO Claude Code via key)   → POST /api/approvals/:id
                                       (model:"auto")                                → hash-chained audit
```

Concretely: a **cron `WorkflowSchedule`** (or a CI **webhook** / `oa flow run`)
fires a Flow → an `llm_completion`/agent node reasons over **prometheus + loki +
kubernetes** signal → it drafts a fix and calls the **github MCP
`create_pull_request`** (or `create_issue`, or `synth_execute` to run a bespoke
remediation script, or **brainbow** to screenshot-verify a deploy).

Because PR creation, synth execution, and cluster mutation classify as
**mutating/destructive**, each is intercepted by the **approval gate** → an
`approval_required` (NDJSON) frame → the inline HITL approval card in the UI **or**
a `POST /api/approvals/:auditId/approve|deny` call. **That is the HITL-at-PR/code-
review seam:** a human approves the code-affecting action before it lands, and the
decision is written into the tamper-evident `tool_call_audit_log`. Inside
scheduled/unattended Flows, a `human_input` node gives the same gate (resume via
`POST /api/workflows/executions/:executionId/data-requests/:requestId`), and a
separate multi-approver gate (`required_approvers[]`, `approval_progress`) gives
four-eyes on Flow steps.

Run the runner **self-hosted** so the model, the orchestration, and the secrets
never leave your network — and so a poisoned PR title can't fan a static token
across prod, because the loop authenticates with a **job-scoped, user-bound,
revocable** key and every action is gated and audited.

---

## Action primitives: MCP / synth / brainbow

The MCP proxy spawns each server as a subprocess (or wires a remote URL); each is
env-gated.

- **github** — the GitOps read/write surface: `list_repos` / `get_file_contents`
  / `create_issue` / `update_issue` / `create_pull_request` / `list_workflows` /
  `get_workflow_runs`, etc. Per-user token (OBO).
- **kubernetes** *(admin-only)*, **prometheus**, **loki**, **web** — observe,
  query, and browse.
- **aws / azure / gcp** — cloud control + cost (need creds).
- **admin** *(admin-only)* — Postgres/Redis/health.
- **synth** *(vendored)* — synthesize-and-run one-shot Python tools for any API
  you don't have an MCP for. **Two-call HITL by design:** `synth_synthesize`
  (read-only — authors code + self-graded risk + declared credential scopes,
  never executes) then `synth_execute` (destructive — runs in a hardened sandbox
  **only with `approve=true`**, after a human reviews the code). Scoped creds are
  injected at runtime; the LLM never sees tokens. Gated twice: synth's own
  `approve` flag *and* the platform's tool classifier.
- **brainbow** *(vendored, opt-in, default OFF)* — Chromium browser automation
  (`goto`/`click`/`type`/`snapshot`/`screenshot`/`record_*`). In CI: post-deploy
  smoke-verify a URL, screenshot/record a deploy, drive a web admin no API covers.
  Enable with `docker compose --profile brainbow up` +
  `OPENAGENTIC_BRAINBOW_MCP_DISABLED=false`.

The model never gets the whole catalog: in V2 discovery it calls a synthetic
`tool_search("what I need")` → gets matching tool defs → calls the real tool.
Every MCP call converges on a single `executeMcpTool` seam that runs it through
the audit + approval gate.

<a id="coding-muscle-in-oss"></a>**Bring-your-own coding agent.** The explicit
seam is `POST /api/chat/local-executor/subscribe` (a long-lived NDJSON dispatch
stream) + `POST /api/chat/local-executor/tool-result`. Pattern: **the platform is
the brain, your local editor/agent is the hands** — the platform dispatches
tool-execution frames, your local executor (a VS Code extension, Claude Code,
etc.) runs them and posts canonical results back, all still flowing through the
approval gate + audit governance. The in-PTY managed coding runner (**agenticode
/ Code Mode**, `/api/code`, the `/v1/messages` shim, the `openagentic-exec`
service) is **enterprise-only and not in this OSS repo** — in OSS the coding
muscle is synth + MCP tools + Flows + chat + your own agent over a user-bound key.

---

## Security & governance

This is the reason to put the gateway in front of an agent instead of giving the
agent raw credentials.

- **Approval gate.** Risk is classified per tool call (LOW → auto-approve + log;
  MEDIUM → gated by policy unless user trust is high; **HIGH/CRITICAL → always a
  human, structurally non-configurable**). On gate it emits an approval frame,
  waits, and **times out to auto-deny**. Resolve via
  `POST /api/approvals/:auditId/approve|deny` or the inline HITL card.
- **Immutable audit chain (AU-10).** Both `tool_call_audit_log` and
  `admin_audit_log` are cryptographic hash chains. The tool-call chain is
  two-phase: `chain_hash` is written at insert (covers tool/server/args/who/when),
  `decision_hash` at the decide step — editing any field of any row breaks the
  chain and is detectable. Append-only is enforced by source-level regression
  cages. **Every tool call is logged.**
- **User-bound, revocable keys — no static system token.** Programmatic access is
  always tied to a real user, bcrypt-hashed, optionally expiring, and revocable
  via `DELETE`. There is **no** env-derived run-as-system token. So every action a
  CI agent takes is attributable to a key and lands in the hash-chained audit log
  — and you `oa key revoke` it the moment the job ends.
- **Sovereign by default.** Self-hosted, runs on your own (local/open-weight)
  models, **zero telemetry / no phone-home** — the loop and its secrets stay on
  your infra. Run the runner self-hosted to keep the SCM webhook ingress, the
  agent, and the model all inside your network.

CI hygiene that follows from the above: mint a **job-scoped** key, **health-gate**
before doing work, use `--json` + `jq` for deterministic parsing, treat all
repo-sourced content (PR/issue bodies, commit messages) as untrusted input, and
**always revoke** in an `always()` / `after_script` step.

---

## See also

- **[The `oa` CLI — headless control plane](13-oa-cli.md)** — the command surface this guide automates.
- **[API Reference](11-api-reference.md)** — the HTTP API; live spec at `/api/swagger`.
- **[Flows & Workflows](08-flows.md)** — authoring the Flows you run from CI.
- **[Installation](03-installation.md)** — `--headless` and self-hosted-runner deploys.