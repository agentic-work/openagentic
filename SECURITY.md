# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes       |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in openagentic, please report it
responsibly:

1. **Email**: send a detailed report to **hello@agenticwork.io**, or message
   the maintainers via GitHub ([@agentic-work](https://github.com/agentic-work)).
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected service(s) and version(s)
   - Potential impact assessment
   - Suggested fix (if any)

You should receive an acknowledgment within **48 hours** and a detailed
response within **5 business days**.

## Security Architecture

openagentic follows a defense-in-depth approach:

### Inbound webhook security
1. **Network** — WAF, IP allowlisting, rate limiting, TLS 1.2+
2. **Authentication** — HMAC-SHA256 signature verification per source
3. **Payload validation** — JSON schema, size limits, prompt-injection detection
4. **Authorization & isolation** — namespace isolation, message-queue
   decoupling, RBAC
5. **Audit & observability** — structured logging, anomaly alerts,
   correlation IDs

### Secrets handling
- Pre-commit hook (`.githooks/pre-commit`) blocks known secret patterns
  from being committed (AWS access keys, private keys, OAuth tokens,
  openagentic API keys).
- Test fixtures may contain synthetic secrets — those are filtered by the
  hook's allowlist (`__tests__/`, `*test*.spec.*`, `*.test.*`).
- Cloud-provider credentials live in `~/.openagentic/cloud-secrets/*.env`,
  outside the repo, mounted into containers at runtime.

### Container build chain
- All `openagentic-*` images come from `harbor.agenticwork.io/openagentic/*`
  via the project's self-hosted runner pool (see `.github/workflows/`).
- No GitHub-hosted runners — there is no path for an outside contributor's
  PR to execute privileged builds.

## In scope

- The published `openagentic-*` services and the bundled MCP servers
  under `services/mcps/oap-*-mcp`.
- The install path (`install.sh`, `tools/setup/` wizard, the Docker
  Compose stack at the repo root).
- The Helm chart under `helm/openagentic/`.

## Out of scope

- Hosted edition (agenticwork.io) — report those privately at
  hello@agenticwork.io.
- Third-party model providers (Anthropic, OpenAI, Vertex AI, etc.) and
  third-party tools surfaced through MCP — report upstream first.
