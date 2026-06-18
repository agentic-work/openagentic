# LLM Providers & Models

OpenAgentic is **model-agnostic by design**. The platform never hardcodes a model
identifier in its business logic — every model that chat, flows, RAG, and image
generation use is resolved at runtime from a **model registry** that you control
through the admin UI and a one-time bootstrap step. This page explains the
provider model, how the always-on Smart Router picks a model per turn, the
registry and its roles, embeddings, image generation, and how to add a new
provider or model.

---

## The provider model

A *provider* is a single configured backend that can serve completions and/or
embeddings — for example an Ollama endpoint, or an AWS Bedrock region. Providers
are stored as rows in the `admin.llm_providers` table; the admin UI owns provider
CRUD after first boot. The two providers that the OSS edition is built around are:

| Provider type    | Auth model                              | Typical use                                              |
|------------------|-----------------------------------------|----------------------------------------------------------|
| `ollama`         | none (local/remote HTTP endpoint)       | Local chat models + the `nomic-embed-text` embedder      |
| `aws-bedrock`    | AWS IAM creds / instance role (no API keys) | Claude (Sonnet / Opus) chat, Nova / Titan / Stability image gen, Titan / Cohere embeddings |

> The codebase also contains adapters for other provider types (`vertex-ai`,
> `azure-openai`, `azure-ai-foundry`, `anthropic`, `openai`). They share the same
> `ILLMProvider` interface, but the OSS first-run experience and the setup wizard
> are oriented around **Ollama** (local, zero-cost) and **AWS Bedrock** (frontier
> Claude via IAM). This guide focuses on those two.

### Ollama (local or remote, embed + chat)

Ollama is the zero-API-key path. It serves two distinct roles in OpenAgentic:

- **Chat** — a local model tag such as `gpt-oss:20b` or `llama3.2:3b`, served by
  whatever Ollama endpoint you point the platform at.
- **Embeddings** — `nomic-embed-text` (768 dimensions) is the default embedder
  used for RAG and the tool semantic cache. The embed model is light and runs
  fine CPU-only — no GPU required.

The Ollama endpoint is configured via environment variables, in this resolution
order (first non-empty wins):

```
OLLAMA_BASE_URL  →  OLLAMA_HOST  →  http://ollama:11434   (compose default)
```

On macOS the setup wizard defaults the host to `http://host.docker.internal:11434`
so containers can reach an Ollama running on the host. The embed model is set by
`OLLAMA_EMBED_MODEL` (default `nomic-embed-text`), and the local chat tag — when
you want a *second*, selectable local chat model alongside a cloud default — by
`OLLAMA_CHAT_MODEL`.

### AWS Bedrock (Claude Sonnet / Opus)

Bedrock is the frontier path. It authenticates with **AWS IAM credentials or an
instance/pod role — never a raw API key**. The setup wizard's Bedrock strategy
seeds Claude Sonnet as the default chat and flows model. Bedrock also serves
image generation (Amazon Nova Canvas / Titan Image / Stability) and can serve
embeddings (Amazon Titan / Cohere) if you prefer not to use Ollama for that role.

Bedrock credentials flow through the standard AWS SDK credential chain
(`~/.openagentic/cloud-secrets/aws.env`, environment variables, or an instance
role). The provider also supports AWS OIDC federation
(`AWSOIDCFederation`) for keyless STS web-identity flows.

---

## The Smart Router (always on, picks per turn)

OpenAgentic's `SmartModelRouter` is **always on**. You do **not** select a model
on a chat request — the router picks one per turn based on the prompt's
structural complexity, the required capabilities, model availability, and cost.

> **Rule of thumb:** never pass a `model:` field in chat API request bodies. The
> router owns model selection. (An explicit pin is honored if present, but the
> intended OSS usage is to let the router decide.)

### How a model is resolved for a chat turn

`resolveChatModel()` (in `services/openagentic-api/src/routes/chat/resolveChatModel.ts`)
applies a strict precedence. The database registry is the source of truth — it
never reads `process.env` for model selection:

1. **Explicit model** — if the caller pinned a model in the request body, use it.
2. **Session model** — if the chat session row persisted a model, use it.
3. **Smart Router** — when neither of the above is set, consult `SmartModelRouter`.
   The router runs a structural classifier and capability gates and returns a
   pick. Its pick is honored **in both directions**: *down* to a cheap local
   model (e.g. `gpt-oss:20b`) for trivial prompts like "what is 2+2", and *up* to
   a frontier model for hard, multi-step, multi-cloud, or agentic prompts. The
   router only ever returns a candidate that passes the configured capability
   floor for the prompt's complexity, so its pick is authoritative.
4. **DB default** — `ModelConfigurationService.getDefaultChatModel()` (the
   highest-priority enabled `role='chat'` registry row) is the fallback when the
   router yields no valid pick.
5. **Emergency sentinel** — `'default'` if everything above fails.

A deliberate capability *refusal* the router raises (for example
`NO_T3_MODEL_IN_REGISTRY`, "No models available for routing", or `NO_VISION_MODEL`
on an image turn with no vision-capable model) is **propagated** to the caller —
it is never silently downgraded to the cheap default. This prevents, e.g., an
image being routed to a blind text model that would ignore it.

### How the router classifies a prompt

The router's classifier (`services/router/PromptClassifier.ts`) scores a prompt
on **structural signals only** — it does *not* match domain nouns or pick a model
by name. Signals include prompt length, count of numbered list items, parallel-
intent phrases ("across each cluster", "all my subscriptions"), synthesis verbs
(audit / analyze / migrate / design / plan…), compose-frame asks (sankey /
runbook / KPI / topology…), and the count of distinct cloud "admin boundaries"
present. The score maps to a `TaskType`:

| TaskType                       | Reasoning need | Example                                              |
|--------------------------------|----------------|------------------------------------------------------|
| `pure-chat`                    | none           | "hi", "thanks", "what is 2+2"                        |
| `single-system-read`           | none           | "list my EC2 instances"                              |
| `file-read`                    | none           | a literal source path with an extension              |
| `cost-analysis-agentic`        | high           | "break down cost by service"                         |
| `security-audit-agentic`       | high           | "find publicly exposed buckets"                      |
| `multi-system-agentic`         | high           | "for every account, …"                               |
| `multi-cloud-agentic`          | high           | a prompt touching ≥2 distinct clouds                 |
| `cost-audit`                   | high (T3)      | multi-cloud finops reconciliation                    |
| `architecture-design-agentic`  | high (T3)      | a long, numbered, multi-frame design ask             |

Each task type maps to a **capability profile** — a function-calling-accuracy
(FCA) floor, a context-window floor, and a reasoning preference. Those floors are
**admin-editable** (stored on the `RouterTuning` DB row, not hardcoded), and the
router uses them to filter the registry's candidate pool before it scores and
picks. The classifier maps prompt shape → *capability requirements*, never to a
specific model.

---

## The model registry + roles

The registry is the single source of truth (SoT) for "which model serves which
role". It lives in the `admin.model_role_assignments` table; each row binds a
`(role, model, provider)` triple with capabilities, priority, and an
enabled flag.

### Roles

The platform resolves models by **role** (`services/model-routing/types.ts`,
`Mode`):

| Role        | Used by                                                        | Resolved via                                                 |
|-------------|----------------------------------------------------------------|--------------------------------------------------------------|
| `chat`      | chat completions, flow agents (`model:"auto"`)                 | Smart Router → highest-priority enabled `role='chat'` row    |
| `code`      | code-oriented assignments                                      | Registry role row                                            |
| `vision`    | image-input turns                                              | Registry role row (capabilities.vision)                      |
| `embedding` | RAG indexing, tool semantic cache, memory                      | Registry role row (capabilities.embeddings)                  |
| `imageGen`  | the chat `generate_image` tool                                 | `system_configuration.default_models.imageGen` (no router)   |

Role-based resolution (`resolveModel.ts` → `resolveRoleDefault`) filters by the
`role` **column** — which is the SoT for routability — and orders enabled rows by
`priority DESC, created_at ASC`. Capabilities on the row are *advisory* refinements,
not the routing key; a row whose `role` does not match the request is rejected with
`ROLE_MISMATCH`. Disabled rows and rows pointing at a disabled or deleted provider
are rejected with typed errors (`REGISTRY_ROW_DISABLED`, `PROVIDER_DISABLED`,
`PROVIDER_DELETED`) — a disabled row never silently passes through.

> **Image generation is special:** unlike chat/code/embedding (which the Smart
> Router resolves from the role rows), image generation has no router. The chat
> `generate_image` tool reads its model id directly from
> `system_configuration.default_models.imageGen`. The bootstrap seeder writes both
> a `role='imageGen'` row *and* that `default_models.imageGen` entry when an image
> model is configured.

### How the registry gets seeded (first boot)

OpenAgentic ships with an **empty** registry and seeds exactly one bootstrap
provider on first boot. There are three boot-time seeders, run in order from
`startup/04-providers`:

1. **`LLMProviderSeeder.seedLLMProviders()`** — creates the single bootstrap
   *provider row* in `admin.llm_providers` from the `BOOTSTRAP_PROVIDER_*` env
   vars, only when the table is empty. If any provider row already exists, the
   seeder no-ops (admin edits always win). It also best-effort inserts the
   bootstrap `role='chat'` row so a fresh install can chat immediately.
2. **`RegistryBootstrapSeeder.seedRegistryFromHelm()`** — writes the registry
   *role rows* (`chat`, `code`, `vision`, `imageGen`, `embedding`) derived from
   the bootstrap `DEFAULTS`, each as a distinct `(role, model, provider)` row.
   It is gated on `SEEDER_VERSION` (a warm restart at the same version is a true
   no-op), honors tombstones, never clobbers `managed_by='admin'` rows, and
   hash-chains an audit event per write.
3. **`seedSecondaryOllamaProvider()`** — additive: under the wizard's "Both"
   strategy (cloud default + local model), this lands a *second*, lower-precedence
   Ollama chat provider/row so a local model like `gpt-oss:20b` is selectable
   alongside the cloud default, without disturbing the default.

The bootstrap inputs are parsed from these env vars
(`services/llm-providers/bootstrapProviderEnv.ts`):

```
BOOTSTRAP_PROVIDER_NAME           # unique key; unset/empty → seeder is a no-op
BOOTSTRAP_PROVIDER_DISPLAY_NAME   # friendly label for the admin UI
BOOTSTRAP_PROVIDER_TYPE           # ollama | aws-bedrock | vertex-ai | ...
BOOTSTRAP_PROVIDER_CONFIG         # JSON authConfig (endpoint/region/...)
BOOTSTRAP_PROVIDER_DEFAULTS       # JSON { chat, codemode, vision, imageGen, embedding, embeddingDimension }
SEEDER_VERSION                    # bump to (re)write the registry rows on boot
```

#### Docker Compose default (Ollama-local)

The compose stack ships an Ollama bootstrap by default — a bare install can chat
and embed with zero API keys:

```yaml
BOOTSTRAP_PROVIDER_NAME: ${BOOTSTRAP_PROVIDER_NAME-ollama-local}
BOOTSTRAP_PROVIDER_TYPE: ${BOOTSTRAP_PROVIDER_TYPE-ollama}
BOOTSTRAP_PROVIDER_CONFIG: '{"endpoint":"http://ollama:11434"}'
BOOTSTRAP_PROVIDER_DEFAULTS: '{"chat":"${OLLAMA_CHAT_MODEL}","embedding":"nomic-embed-text","embeddingDimension":768}'
```

The wizard's AWS Bedrock strategy overrides these (`TYPE=aws-bedrock`,
`CONFIG={"region":...}`, `DEFAULTS` with a Claude chat model) so Claude becomes
the default, and bumps `SEEDER_VERSION` so the `role='chat'` row is rewritten.

#### Helm default

The Helm chart's `bootstrapProvider:` block mirrors the same path:

```yaml
# helm/openagentic/values.yaml
bootstrapProvider:
  enabled: false          # false → falls back to the in-cluster Ollama bootstrap
  name: aws-bedrock
  displayName: AWS Bedrock
  type: aws-bedrock
  chatModel: anthropic.claude-sonnet-4-6   # operator-supplied; no literal in code
  seederVersion: 6

ollama:
  embedModel: nomic-embed-text   # embeddings stay on the in-cluster Ollama (768)
  chatModel: llama3.2:3b
  chatHost: ""                   # "" = in-cluster Ollama; or a remote GPU box URL
```

When `bootstrapProvider.enabled: true`, the chart seeds that provider (and its
chat model) as the default; embeddings stay on the in-cluster Ollama
(`nomic-embed-text`, 768). When `false`, the chart falls back to the local Ollama
bootstrap provider.

---

## The no-hardcoded-models rule

Model identifiers must **not** appear as bare string literals in business logic.
Every model id flows from operator-supplied env vars (the bootstrap block) or from
the registry / admin UI. This is enforced by an architecture cage test
(`__tests__/architecture/no-hardcoded-model-literals.source-regression.test.ts`)
that scans every `.ts` file under `services/openagentic-api/src/` for forbidden
model-literal patterns (`nomic-embed-text`, `gpt-oss*`, `gpt-4o*`, `gpt-5*`,
`gemini-*`, `claude-*`, `anthropic.claude-*`, `us.anthropic.claude-*`, and the
`text-embedding-*` family).

Only a small allow-list of canonical files may carry model literals — and even
those are wire-format / dimension defaults, not routing decisions:

- `services/LLMProviderSeeder*`
- `services/UniversalEmbeddingService*`
- `services/llm-providers/ProviderManager*`
- `services/model-routing/RegistryBootstrapSeeder*`
- test fixtures and harnesses

New non-allow-listed files that introduce a model literal hard-fail the test.
The same rule applies to deployment: no hardcoded deployment / tenant / registry
strings — everything environment-specific flows through env vars or Helm values.

---

## Embeddings

Embeddings power RAG retrieval, the MCP tool semantic cache, and the memory
system. The default embedder is **`nomic-embed-text` at 768 dimensions**, served
by Ollama.

- The embedding provider is selected by `EMBEDDING_PROVIDER` (default `ollama`).
- The model is `OLLAMA_EMBED_MODEL` / `OLLAMA_EMBEDDING_MODEL` (default
  `nomic-embed-text`).
- The dimension is 768. `UniversalEmbeddingService` resolves dimensions from a
  per-model table and falls back to **768** for unknown models (and when
  `EMBEDDING_DIMENSIONS` is unset).

`UniversalEmbeddingService` is multi-provider — it can also embed via AWS Bedrock
(Amazon Titan, Cohere), Azure OpenAI, Google Vertex AI, or any OpenAI-compatible
endpoint — auto-detecting the provider from configuration. It performs conservative
character-based chunking for small-context models (`nomic-embed-text` is treated
as an ~8000-char context) and caps embedding dimensions for the pgvector HNSW
index.

> **First-boot note:** the compose stack ships `DISABLE_RAG=true` and
> `SKIP_TOOL_SEMANTIC_CACHE=true` by default to avoid embedding-timeout stalls
> when Ollama is shared between chat, tools, and embeddings on first boot. Re-enable
> them once you have a dedicated embedding endpoint or sufficient capacity.

---

## Image generation

Image generation is exposed to chat through the `generate_image` tool and routed
by `ProviderManager.generateImage()`. It is gated on the **`imageGen` role**:

- The chat tool resolves its model id from
  `system_configuration.default_models.imageGen` (seeded by
  `RegistryBootstrapSeeder` when an image model is configured).
- `ProviderManager` looks the model up in its `modelToProviderMap` (built from the
  registry rows) and dispatches to the provider whose adapter implements
  `generateImage()`, with priority-ordered failover and a configurable timeout.
- If no model resolves and no provider has an image-capable model, the call throws
  `No providers with image generation capability are configured`.

On **AWS Bedrock**, `buildBedrockImageBody()` auto-detects the wire shape from the
model family — this is required protocol dispatch, since sending the wrong envelope
yields a `400 ValidationException`:

| Model family                                    | Request envelope                                          | Response       |
|-------------------------------------------------|-----------------------------------------------------------|----------------|
| Modern Stability (`stability.sd3-*`, `stable-image-*`) | `{ prompt, aspect_ratio, output_format, mode }`           | `{ images:[] }`|
| Legacy Stability SDXL (`stable-diffusion-xl-*`) | `{ text_prompts, cfg_scale, steps, width, height, samples }` | `{ artifacts:[] }` |
| Amazon Nova Canvas / Titan Image                | `{ taskType:'TEXT_IMAGE', textToImageParams, imageGenerationConfig }` | `{ images:[] }`|

Pixel dimensions for the SDXL and Amazon envelopes are clamped to a model-valid
allow-list so a DALL-E-shaped size never produces a validation error or a NaN.

> Image model ids (e.g. `amazon.nova-canvas-v1:0`) are **operator-supplied** —
> added through the admin UI or the bootstrap `DEFAULTS.imageGen` field. No image
> model id is hardcoded in business logic.

---

## How to add a provider or model

There are two paths: the **admin UI** (the normal day-2 path) and the **bootstrap**
env block (first-boot / IaC). Both write to the same `admin.llm_providers` +
`admin.model_role_assignments` tables — the admin UI owns CRUD after first boot,
and the seeder never clobbers `managed_by='admin'` rows.

### Via the admin UI (recommended)

The admin LLM-provider routes live under `/api/admin/llm-providers`
(`routes/admin/llm-providers.ts`). The Add-Provider / Add-Model flow is:

1. **Add the provider.** Choose a type (`ollama`, `aws-bedrock`, …), supply its
   auth config (endpoint for Ollama; region + IAM for Bedrock). Credentials are
   encrypted at rest (`CredentialEncryptionService`).
2. **Test the connection.** `POST /api/admin/llm-providers/:name/test` validates
   credentials and reachability.
3. **Discover models.** `GET /api/admin/llm-providers/:nameOrId/discover-models`
   returns a read-only catalog from the live provider SDK
   (`provider.discoverModels()` / `listModels()`) for the Add-Model dropdown. (The
   discover response is read-only — it does not write registry rows.)
4. **Add a model to a role.** Pick a discovered model and assign it a role; this
   writes a `model_role_assignments` registry row. You can list, inspect, enable/
   disable, re-prioritize, and delete registry rows via
   `GET/PATCH/DELETE /api/admin/llm-providers/registry[/:id]`. Deleting a row
   writes a tombstone so the bootstrap seeder won't re-create it on the next boot.

Because the Smart Router resolves the `role='chat'` row by `priority DESC`, set a
new chat model's priority above the current default to make it the platform
default, or below it to make it a selectable-but-secondary model.

### Via the bootstrap block (first boot / IaC)

For a reproducible first-boot default, configure the `BOOTSTRAP_PROVIDER_*` env
vars (compose) or the `bootstrapProvider:` Helm block (above), then bump
`SEEDER_VERSION` so `RegistryBootstrapSeeder` (re)writes the role rows. The setup
wizard does exactly this when you pick a strategy:

| Wizard strategy | What gets seeded                                                                 |
|-----------------|----------------------------------------------------------------------------------|
| Local only      | An Ollama bootstrap provider; local chat model + `nomic-embed-text` embeddings.  |
| AWS Bedrock      | A Bedrock bootstrap provider; Claude Sonnet as the default chat + flows model, authenticated via AWS IAM. |
| Both            | Bedrock Claude as the **default** chat model + a selectable local `gpt-oss:20b`, with Ollama embeddings — all via AWS IAM (no raw keys). |
| Skip            | Nothing — the stack boots, but chat/embedding calls fail until you wire a provider from the admin panel. |

After first boot, all further provider and model changes go through the admin UI;
the bootstrap seeder is for the *initial* row only and respects admin ownership
thereafter.
