# Security & Compliance Posture

OpenAgentic is built to run inside *your* trust boundary. It is self-hosted,
model-agnostic, and sends **zero telemetry**. Every piece of state — chat
history, audit logs, credentials, embeddings — lives in infrastructure you
control. Nothing phones home.

This page documents the security model in detail: how authentication works,
how secrets are handled, how untrusted model output is sandboxed, how egress is
constrained, how every privileged action is audited, and how the codebase
maps onto common security-control frameworks for regulated deployments.

> **Scope note.** The OSS edition is **single-user, local-auth**. There is no
> SSO, no Azure AD / OBO, no Google federation, and no MFA broker in the open
> source build — those are enterprise concerns. Everything described here is
> what ships in the Apache-2.0 core, grounded in the actual source.

---

## Threat model in one paragraph

OpenAgentic gives a language model the ability to operate real infrastructure
(AWS, Azure, GCP, Kubernetes, Prometheus, Loki, GitHub) through MCP tools. The
two structural risks that creates are (1) the model performing a **destructive
action** you did not intend, and (2) **untrusted content** (a model-authored
artifact, a fetched web page) doing something hostile in your browser or
reaching your cloud metadata endpoint. The platform's trust moat answers both
at the infrastructure layer, not the prompt layer: **human approval on every
mutating tool call**, an **immutable local audit trail**, a **scoped egress /
SSRF guard**, and a **sandboxed artifact runtime**. None of these can be
talked around by a clever prompt.

---

## Authentication

### Local accounts only

Authentication is username/password against a local `users` table, backed by
**bcrypt** password hashing (cost factor 10):

```ts
// services/openagentic-api/src/routes/local-auth.ts
const hashPassword = async (password: string): Promise<string> =>
  await bcrypt.hash(password, 10);

const verifyPassword = async (password: string, hashedPassword: string) =>
  await bcrypt.compare(password, hashedPassword);
```

On a successful `POST /api/auth/local/login` the server issues a **JWT signed
with HS256** and records a row in `user_sessions`:

```ts
const token = jwt.sign(
  { userId: user.id, email: user.email, name: user.name, isAdmin: user.is_admin },
  signingSecret,         // JWT_SECRET, or SIGNING_SECRET as fallback
  { expiresIn: '24h' },
);
```

Tokens are intentionally minimal — group membership stays in the database, not
in the token, to keep tokens small and avoid stale-claim drift. Sessions expire
after 24h, are validated against the `user_sessions` table on every request
(so a logout truly invalidates the token), and a background sweep deactivates
expired sessions hourly.

### One unified validator, algorithm-pinned

All token validation flows through a single function so there is exactly one
trust decision in the codebase:

```ts
// services/openagentic-api/src/auth/tokenValidator.ts
const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
```

Pinning `algorithms: ['HS256']` is deliberate — it forecloses the classic
`alg: none` and RS256/HS256 confusion downgrade attacks. The pin is enforced by
a source-regression test (`jwt-algorithms-pinned.source-regression.test.ts`)
that fails the build if anyone calls `jwt.verify` without an explicit
algorithm allow-list.

If `JWT_SECRET` is missing or contains a literal `placeholder`, the validator
**logs a CRITICAL warning and generates an ephemeral runtime secret** rather
than trusting a forgeable one — sessions simply won't survive a restart, which
surfaces the misconfiguration loudly instead of silently accepting a weak key.

### API keys

Non-interactive clients authenticate with API keys. Keys carry the `oa_`
prefix and are stored only as **bcrypt hashes** — the plaintext is shown once
at creation and never persisted. The same `validateAnyToken` entry point routes
any `oa_`-prefixed credential to bcrypt verification against the active,
non-expired keys, updates `last_used_at`, and resolves the owning user's admin
flag:

| Credential | Format | Validated by |
|---|---|---|
| Session token | HS256 JWT, `userId` claim | `jwt.verify(..., { algorithms: ['HS256'] })` + session row |
| User API key | `oa_<43-char base64url>` | `bcrypt.compare` against `api_keys.key_hash` |
| Inter-service token | `oa_sys_<hmac>` | constant-time HMAC (see below) |

### Admin gating

Admin-only routes require `requireAdmin`, and the validator returns
`Administrator access required` for a non-admin token rather than leaking the
resource. Local-issued tokens are tagged `tenantId: 'local'`; the validator
keys the admin decision on the `isAdmin` / `is_admin` claim, supporting both
casings for compatibility.

### First-run convenience: the one-shot magic token

To keep the five-minute install from ending on a credentials grep, `install.sh`
can generate a `MAGIC_BOOT_TOKEN`. The UI exchanges it once at
`POST /api/auth/local/magic` for a normal JWT. It is **single-use** (the server
clears it from memory after the first successful exchange), only works if the
env var was non-empty at startup, and is explicitly *not* a generic
magic-link-by-email flow. Every subsequent request 401s.

---

## Secret management

### No weak defaults — ever

OpenAgentic ships with **no baked-in secret defaults**. Every credential is
operator-supplied and fail-fast at boot. There are two install paths and both
enforce this.

**Docker Compose** uses Bash's `${VAR:?error}` fail-fast substitution, so the
stack refuses to come up if a required secret is unset:

```yaml
# docker-compose.yml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
JWT_SECRET:        ${JWT_SECRET:?set JWT_SECRET in .env — generate with openssl rand -hex 32}
SIGNING_SECRET:    ${SIGNING_SECRET:?set SIGNING_SECRET in .env — generate with openssl rand -hex 32}
INTERNAL_API_KEY:  ${INTERNAL_API_KEY:?set INTERNAL_API_KEY in .env — generate with openssl rand -hex 32}
INTERNAL_SERVICE_SECRET: ${INTERNAL_SERVICE_SECRET:?set INTERNAL_SERVICE_SECRET in .env — generate with openssl rand -hex 32}
FRONTEND_SECRET:   ${FRONTEND_SECRET:?set FRONTEND_SECRET in .env — generate with openssl rand -hex 32}
```

**Helm** required-guards every secret in the chart, so `helm install` aborts
with an actionable message rather than templating in a blank or default value:

```yaml
# helm/openagentic/templates/secret.yaml
{{- $jwt     := required "secrets.jwtSecret is required — run `./install.sh --helm` ..." .Values.secrets.jwtSecret -}}
{{- $signing := required "secrets.signingSecret is required ..." .Values.secrets.signingSecret -}}
{{- $internal:= required "secrets.internalApiKey is required ..." .Values.secrets.internalApiKey -}}
{{- $frontend:= required "secrets.frontendSecret is required ..." .Values.secrets.frontendSecret -}}
{{- $adminPass:= required "secrets.adminPassword is required ..." .Values.secrets.adminPassword -}}
```

`install.sh` generates strong random values once and persists them so they are
stable across upgrades:

```bash
# install.sh
gen_secret() { local n="$1"; openssl rand -hex "$n" 2>/dev/null || ...; }

# Compose path → written to .env
JWT_SECRET=$(gen_secret 32)
SIGNING_SECRET=$(gen_secret 32)
INTERNAL_API_KEY=$(gen_secret 32)
INTERNAL_SERVICE_SECRET=$(gen_secret 32)

# Helm path → persisted to ~/.openagentic/helm-secrets.yaml and reused on upgrade
```

A `.githooks/pre-commit` script blocks known secret patterns, so nothing
sensitive lands in the repo by accident.

### Cloud credentials live out-of-tree

Provider credentials for the cloud MCPs (AWS, Azure, GCP) are **never** in the
repo, the image, or the database. They live in
`~/.openagentic/cloud-secrets/*.env` (or mounted host CLI credentials) and are
injected at runtime. The three credential-free MCPs (`web`, `admin`, `github`'s
read paths) spawn with no secrets at all. The `cloud-secrets` directory stubs
are created by `install.sh` and mounted read-only.

### Optional Vault

`src/utils/secrets.ts` provides a unified accessor that prefers HashiCorp Vault
when initialized and falls back to environment variables otherwise. The JWT and
signing-secret accessors **have no hardcoded fallback** — if neither Vault nor
env provides a secret, they throw:

```ts
// services/openagentic-api/src/utils/secrets.ts
const secret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!secret) throw new Error('JWT_SECRET or SIGNING_SECRET must be set');
```

---

## Inter-service trust: the `oa_sys_` HMAC token

The API talks to the MCP proxy (which spawns the built-in MCP servers) over an
internal channel. That channel is authenticated with a **constant-time HMAC**
token, not a bare prefix check.

The API mints the token as `oa_sys_` + `base64url(HMAC_SHA256(secret, label))`,
where `secret` is `INTERNAL_SERVICE_SECRET` and `label` is the fixed string
`openagentic-system-token`. The proxy recomputes and compares it in constant
time:

```python
# services/openagentic-mcp-proxy/src/main.py
def verify_system_token(token: str) -> bool:
    if not token or not token.startswith(SYSTEM_TOKEN_PREFIX):  # "oa_sys_"
        return False
    secret = os.getenv("INTERNAL_SERVICE_SECRET", "")
    if not secret:
        logger.warning("INTERNAL_SERVICE_SECRET unset — rejecting system token (fail closed)")
        return False
    expected = SYSTEM_TOKEN_PREFIX + compute_system_token_suffix(secret)
    return hmac.compare_digest(token, expected)
```

This is hardened in three load-bearing ways:

- **The prefix alone is never trusted.** A pre-hardening bypass granted
  system-root to any `Bearer oa_sys_<anything>`. Now a forged token fails the
  HMAC and falls through to rejection.
- **Fail-closed on a missing secret.** If `INTERNAL_SERVICE_SECRET` is unset,
  `verify_system_token` returns `False` — a missing secret can never
  authenticate a system caller.
- **Refuses to boot with a weak signing key.** `bootstrap_jwt_keys()` raises a
  `BootError` (the process exits) if the JWT signing key is missing or begins
  with the `dev-secret` placeholder — the proxy will not run with a forgeable
  trust root.

Requests with **no** `Authorization` header are rejected with 401 when
`ENABLE_AUTH` is true (the default). A no-token "local system admin" context is
only granted when an operator has *explicitly* set `ENABLE_AUTH=false` for
local development. The internal HS256 JWT path likewise fail-closes: with no
shared secret configured, internal tokens are rejected rather than decoded with
a default key. The MCP Inspector debug surface defaults **off**
(`ENABLE_MCP_INSPECTOR=false`) so production images never expose it.

---

## Untrusted-code sandboxing (artifacts)

When a model emits a rich visual artifact (a chart, diagram, mini-app, or a
small React preview) and you choose to render it, that output is **untrusted by
construction** — it is model-generated text. OpenAgentic renders it inside a
hardened iframe modeled on the Claude.ai artifact sandbox.

### Opaque-origin, scripts-only iframe

```tsx
// services/openagentic-ui/src/features/chat/components/v2/AppRenderer.tsx
<iframe sandbox="allow-scripts" srcDoc={srcdoc} ... />
```

- `sandbox="allow-scripts"` **without** `allow-same-origin`. That single
  omission is what makes the iframe a true isolation boundary: the browser
  assigns it an **opaque origin**, so `document.cookie`, `localStorage`,
  `sessionStorage` all throw, and the child cannot walk `window.parent` to
  reach the host app.
- `srcdoc` (rather than a real URL) creates that opaque origin automatically.

### Per-render CSP nonce

Every artifact carries an inline Content-Security-Policy `<meta>` tag. The
server-side validator generates a per-render **nonce** and stamps it onto every
legitimate `<script>` tag; the CSP then grants `'nonce-XXX'` and drops
`'unsafe-inline'`, so any model-injected script *without* the nonce is refused
by the browser at parse time:

```ts
// AppRenderer.tsx — buildCspMeta()
const parts = [
  "default-src 'none'",                                   // deny everything by default
  `script-src 'self' ${origin}/api/cdn/lib/ ${origin}/artifact-runtime/ 'nonce-${nonce}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${origin}`,
  "font-src 'self' data:",
];
```

Note `script-src` is **path-scoped** to `/api/cdn/lib/` and `/artifact-runtime/`
only — the iframe cannot load script from an arbitrary same-origin endpoint that
happens to emit `application/javascript`.

### `connect-src 'none'` for arbitrary HTML

The strictest renderer, `SafeHtmlIframe` (used for arbitrary model-emitted HTML),
goes further and sets **`connect-src 'none'`** — untrusted rendered HTML gets
**no outbound network at all**:

```ts
// services/openagentic-ui/src/shared/components/SafeHtmlIframe.tsx
const csp = [
  "default-src 'none'",
  `script-src 'nonce-${effectiveNonce}'`,
  `style-src 'nonce-${effectiveNonce}' 'unsafe-inline'`,
  "img-src 'self' data: blob:",
  "connect-src 'none'",   // no fetch/XHR/WebSocket from untrusted HTML
];
```

### JS evaluation sandbox

When the chat needs to *execute* a JS snippet (the browser sandbox tool), it
runs in an ephemeral `<iframe sandbox="allow-scripts">` (again, no
`allow-same-origin`) loaded from a Blob URL, with a 5-second wall-clock timeout
the parent enforces by tearing down the child realm. `postMessage` is the only
channel in or out. This is the tightest untrusted-code container a browser
offers without extensions.

### Air-gap note

Rendering an artifact may load a charting/runtime library. Those libraries ship
**same-origin** under the UI's `public/artifact-runtime/` (react, d3, plotly,
mermaid, katex, pyodide bootstrap, etc.), so a default install does not reach a
public CDN for them. For the strictest posture, the runtime is fully vendorable
and the Helm chart includes an air-gapped values template.

---

## Egress & SSRF guards

The model drives outbound calls, so any URL it can influence is a potential
SSRF primitive. Two seams are explicitly guarded.

### The unauthenticated `probe-ollama` setup route

During first-run setup the wizard probes a user-supplied Ollama host. Because
this route is unauthenticated, it is double-guarded:

```ts
// services/openagentic-api/src/routes/setup.ts
const METADATA_HOSTS = new Set([
  '169.254.169.254',         // AWS/GCP/Azure IMDS (IPv4)
  '[fd00:ec2::254]', 'fd00:ec2::254',
  'metadata.google.internal', 'metadata.goog',
]);
```

1. **SSRF denylist** — the cloud-metadata (IMDS) endpoints are blocked, and any
   non-`http(s)` scheme (`file://`, `gopher://`, …) is rejected before any
   fetch. A legitimate Ollama host is on the LAN / loopback / docker-internal,
   so private space is *not* blanket-blocked (that would break the install) —
   only the IMDS targets and dangerous schemes are.
2. **Setup-gate** — the durable fix: once an admin user exists, setup is
   complete and the route returns `409` and is effectively dead, so it cannot
   linger as an SSRF primitive for the life of the deployment.

### The web MCP fetch guard

The `web` MCP, which fetches arbitrary URLs on the model's behalf, has a
dedicated DNS-aware SSRF guard (`services/mcps/oap-web-mcp/ssrf_guard.py`). It
**pre-flight resolves** the target hostname and rejects RFC1918, link-local,
loopback, reserved/multicast (IPv4 + IPv6), and IMDS literal hostnames — and it
follows redirects **manually**, re-checking every hop so a `302 → 169.254.169.254`
cannot smuggle the agent into your cloud metadata service.

### Source-enforced no-exfiltration

A repo-wide architecture test (`no-telemetry.source-regression.test.ts`) also
fails the build on any outbound `fetch`/`axios` call to a hardcoded external
host that is not on a small, in-the-open allow-list of legitimate
LLM-provider / cloud-ops control planes (operated with *your* credentials).
Local / private / env-derived URLs are always allowed; analytics or
Agenticwork-owned hosts are forbidden.

---

## Audit & accountability

Every privileged action is recorded. There are several first-class audit
streams, all persisted to your own Postgres.

### Tool-call audit + human-approval gate

This is the launch-headline trust feature. **Every tool call is audited**, and
**mutating tool calls are gated on human approval**.

A single primitive, `runAuditAndGate`, is invoked at the one seam every live
tool call passes through (the MCP-execution convergence point), so a tool call
cannot execute without a row:

```ts
// services/openagentic-api/src/services/approval/auditAndGate.ts
const classification = classifyTool(input.toolName, args);   // READ | MUTATING
const policy = await resolveApprovalGatePolicy();

if (classification === 'READ' || !policy.gateMutating) {
  // audit decision='auto', execute immediately
}
// MUTATING + gate ON → persist a decision='pending' row,
// emit an `approval_required` SSE event, await human approve/deny
```

Key properties:

- **READ vs MUTATING** is decided by `classifyTool` — a pure verb classifier.
  Read verbs (`get`, `list`, `describe`, `status`, `tool_search`, `web_search`,
  …) are never gated, so chat never hangs on a benign read. Write/destructive
  verbs (`create`, `apply`, `delete`, `terminate`, `scale`, `rollout`, …) are.
  Unknown tools default to READ to avoid over-gating, while genuine mutating
  verb tokens always win.
- **The gate fails SAFE.** If a `pending` row cannot even be recorded for a
  mutating call, the call is **blocked** — an un-audited mutation can never slip
  through. A failure on a READ degrades to allow-and-log.
- **Audit is always on; the gate is policy.** `APPROVAL_GATE_MUTATING` defaults
  to `true`; the gate can be turned off via policy, but **auditing is never part
  of that policy** — it always happens.
- **The decision transition is concurrency-guarded.** A pending row moves to
  `approved` / `denied` / `timed_out` exactly once via an `updateMany WHERE
  decision='pending'` (a race between a human approve and a timeout deny can
  only win once). The default timeout is 300s → deny.

### Auth audit

Login, logout, failed login, and password-change events are written as
normalized rows to `auth_audit_log` (provider, success flag, IP, user-agent,
structured detail). This write is **best-effort and never throws into the auth
path** — a degraded audit table can never block a user from logging in — and it
**never records the password or hash**, only that the event occurred and by
whom.

### Admin-action audit — cryptographic hash chain (AU-10)

Every `admin_audit_log` row is chained for **non-repudiation / tamper-evidence**:

```ts
// services/openagentic-api/src/services/audit/adminAuditChain.ts
chain_hash = SHA256(previous_hash + 'admin_action' + userId + action + ts + details)
```

Tampering with any row breaks every subsequent hash. A single shared writer
serializes appends through a promise queue (so concurrent writes link to the
correct predecessor rather than forking the chain), and `verifyAdminAuditChain`
walks the chain to detect a break and report `brokenAt`.

### App-enforced append-only immutability (AU-2 / AU-9)

The audit tables are treated as **append-only at the application layer**:

- The governance audit service is explicit about its rules — *"NEVER update or
  delete `flow_audit_log` rows; every governance event produces exactly one
  INSERT"* (`AuditLogService.ts`, SOC 2 CC6/CC7).
- The tool-call audit log exposes **only an INSERT and a one-way pending→terminal
  transition** — there is no general update or delete path
  (`approval/auditLog.ts`).
- The admin audit-log API (`/api/admin/audit-logs`) is **read-only** — the route
  registers only `GET` handlers; there is no exposed endpoint to edit or delete
  history.

This gives you AU-2 (auditable events) and AU-9 (protection of audit
information at the application boundary) without depending on a per-row database
trigger. (Operators who need OS-level write-once storage can additionally pin
the Postgres volume / WAL archive to immutable storage — the app contract
already never issues an UPDATE/DELETE against these tables.)

---

## Zero telemetry

**The server never sends data to Agenticwork, or to any third party, ever.**
There is no analytics SDK, no usage beacon, no license check, no update ping,
and no install registration anywhere in the product. Every outbound network
path is one of: localhost (own Postgres/Redis/Milvus), an endpoint you
configured (your Ollama, your LLM keys, your MCP servers, your OTLP collector),
or a cloud API the product exists to operate — driven entirely by *your*
credentials.

This is not a promise; it is enforced by a build-failing source-regression test
(`no-telemetry.source-regression.test.ts`) with three guards:

1. **No analytics / error-reporting SDK imports** — posthog, `@sentry/*`,
   segment, mixpanel, amplitude, `dd-trace`/`@datadog`, bugsnag, rollbar,
   fullstory, heap, hotjar, plausible, fathom, matomo, rudderstack — by
   `import`, `require`, or dynamic `import()`.
2. **No phone-home verbs** — `sendBeacon`, `callHome`, `reportUsage`,
   `registerInstall`, `checkForUpdate`, `version-check`, `license-check`,
   `phone-home`.
3. **No hardcoded external host** in any outbound `fetch`/`axios` call that is
   not on the in-the-open allow-list of legitimate LLM-provider / cloud-ops
   endpoints. Local / private / env-derived URLs are always allowed; an
   analytics or Agenticwork-owned host is never permitted.

You can run the proof yourself:

```bash
# No analytics/beacon SDKs in product source
grep -rEi 'posthog|segment|@sentry|mixpanel|amplitude|dd-trace|gtag|bugsnag|fullstory|heap|hotjar|plausible|fathom|matomo' \
  services --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' | grep -v node_modules
```

Observability is **opt-in and default-off**: `OBSERVABILITY_PROVIDER` defaults
to `none` (a no-op adapter, zero emission), and the OTLP/Phoenix/Langfuse
adapters are skipped unless you point them at *your* collector. The only honest
caveat is browser-side: when you choose to render an artifact, the sandboxed
preview iframe may load a rendering library — in *your* browser, user-triggered,
CSP-scoped — and even that is vendorable locally for an air-gapped posture. See
[`docs/zero-telemetry.md`](../zero-telemetry.md) for the full proof.

---

## Security control mapping (NIST 800-53)

The security controls above map onto NIST 800-53 control families — useful
when deploying into a regulated or compliance-conscious environment:

| Control family | What the platform provides |
|---|---|
| **AC-3 / AC-6** (access enforcement, least privilege) | Local-auth + admin gating; MCP proxy fail-closed on missing/forged credentials; cloud MCPs scoped to operator-supplied service accounts |
| **AC-4 / SC-7** (information flow, boundary protection) | SSRF/IMDS denylist on the probe route + DNS-aware web-MCP fetch guard; source-enforced no-exfiltration; sandboxed artifact iframes |
| **IA-2 / IA-5** (identification, authenticator management) | bcrypt password storage; HS256-pinned JWTs; bcrypt-hashed API keys; constant-time HMAC inter-service tokens; no weak secret defaults (compose `${VAR:?}` + helm `required`) |
| **AU-2 / AU-9 / AU-10** (audit events, protection of audit info, non-repudiation) | Append-only auth/tool-call/admin/flow audit logs; cryptographic hash chain on admin actions; read-only audit API |
| **CM-7 / SA-15** (least functionality) | MCP Inspector debug surface defaults off in production images |

> **This is a control-mapping reference, not a certification.** OpenAgentic is
> software, not a hosted service. **You deploy it inside your own authorization
> boundary**, with your own compliance processes layered on top — those are
> organizational artifacts that exist outside any codebase. What the project
> provides is the **technical control implementation** a regulated deployment
> can build on. The zero-telemetry, self-hosted design is precisely what lets a
> sovereignty-bound team run it where a SaaS AI tool may not be permitted.

---

## Quick reference

| Concern | Mechanism | Source |
|---|---|---|
| Password storage | bcrypt (cost 10) | `routes/local-auth.ts` |
| Session tokens | HS256 JWT, 24h, algorithm-pinned, DB-validated | `auth/tokenValidator.ts` |
| API keys | `oa_` prefix, bcrypt-hashed | `auth/tokenValidator.ts` |
| Inter-service auth | `oa_sys_` constant-time HMAC, fail-closed | `mcp-proxy/src/main.py` |
| Secret defaults | none — compose `${VAR:?}` + helm `required` | `docker-compose.yml`, `helm/.../secret.yaml` |
| Cloud creds | out-of-tree (`~/.openagentic/cloud-secrets/*.env`) | `install.sh` |
| Artifact sandbox | `allow-scripts` opaque-origin iframe + nonce-CSP | `AppRenderer.tsx`, `SafeHtmlIframe.tsx` |
| Untrusted-HTML egress | `connect-src 'none'` | `SafeHtmlIframe.tsx` |
| SSRF guards | IMDS denylist + setup-gate; DNS-aware web-MCP guard | `routes/setup.ts`, `oap-web-mcp/ssrf_guard.py` |
| Mutating-call approval | human gate, fail-safe, audit-always-on | `approval/auditAndGate.ts` |
| Audit immutability | append-only app contract + admin hash chain | `audit/adminAuditChain.ts`, `AuditLogService.ts` |
| Zero telemetry | build-failing regression test | `no-telemetry.source-regression.test.ts` |

---

[Apache-2.0](../../LICENSE) · © Agenticwork™ LLC
