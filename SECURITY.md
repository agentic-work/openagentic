# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x (omhs) | Yes |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in the OpenAgentic platform, please report it responsibly:

1. **Email**: Send a detailed report to the repository owner via GitHub ([@agentic-work](https://github.com/agentic-work))
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected service(s) and version(s)
   - Potential impact assessment
   - Suggested fix (if any)

You should receive an acknowledgment within **48 hours** and a detailed response within **5 business days**.

## Security Architecture

OpenAgentic follows a defense-in-depth approach:

### Source Code Isolation
- Source code **never** touches target deployment machines
- Only container images reach AKS clusters via private ACR
- ARC self-hosted runners build images inside the cluster network

### Inbound Webhook Security (6 Layers)
See [Issue #1](https://github.com/agentic-work/openagentic-omhs/issues/1) for the full specification:
1. **Network** — WAF, IP allowlisting, rate limiting, TLS 1.2+
2. **Authentication** — HMAC-SHA256 signature verification per source
3. **Payload Validation** — JSON schema, size limits, prompt injection detection
4. **Authorization & Isolation** — Namespace isolation, message queue decoupling, RBAC
5. **Audit & Observability** — Structured logging, anomaly alerts, correlation IDs
6. **Admin Console** — Dashboard, circuit breakers, manual replay

### Secret Management
- No secrets in source code or environment variables
- Azure Key Vault via External Secrets Operator (ESO)
- WorkloadIdentity authentication (no static credentials)
- Automatic rotation with pod restart on secret change

### Container Security
- Multi-stage Docker builds (minimal final images)
- Non-root container execution
- Read-only root filesystem where possible
- No privileged containers
- Pod Security Standards: `restricted` profile

### Network Security
- Kubernetes NetworkPolicy isolation per service
- Default-deny ingress and egress
- Explicit allow-list for service-to-service communication
- Separate ingress controller for webhook traffic

### AI/LLM Safety
- Prompt injection detection on all external inputs
- `[EXTERNAL_INPUT]` wrapper tags for untrusted text
- Token budget limits on external content
- Sandboxed execution for agent tools (OpenAgentic Synth)

## Security Contacts

- Repository Owner: [@agentic-work](https://github.com/agentic-work)

## Security Updates

Security patches are applied as priority:critical issues and deployed immediately upon verification.
