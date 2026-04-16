# Enterprise cloud setup

Hooks openagentic's cloud MCPs (`oap-aws-mcp`, `oap-azure-mcp`, `oap-gcp-mcp`, plus kubernetes / logging / monitoring variants) into real Azure, AWS, and GCP accounts so the agent can introspect and operate against them.

Everything provisioned here is **read-only** by default. Grant write scopes deliberately, per-use-case.

## Reference deployment

This doc captures the exact resources we created for the first reference instance. Use them as templates for your own org — nothing here is tenant-specific beyond the IDs.

| Cloud | What we created | Identity for the MCP |
|---|---|---|
| Azure | App Registration + Service Principal + security group + Reader role | Service Principal (client credentials flow) |
| AWS   | IAM user with `ReadOnlyAccess` | Access key pair |
| GCP   | Service Account with viewer roles | JSON service-account key |

Deep-dive in each cloud's page:

- [azure.md](./azure.md) — Entra ID App Reg, admin group, Reader on sub, SSO wiring
- [aws.md](./aws.md) — Read-only IAM user (quick path) and IAM Identity Center federation (full SSO)
- [gcp.md](./gcp.md) — Service Account with least-privilege viewer roles
- [secrets.md](./secrets.md) — Where credentials live, how the MCPs consume them

## Secrets storage

All credentials from these steps are written to `~/.openagentic/cloud-secrets/`, chmod `0700`, never committed to git. The compose stack mounts this directory read-only into the MCP containers that need it. See [secrets.md](./secrets.md).

## Prerequisites

- `az` CLI (≥ 2.60) with an account that can create App Registrations + assign subscription roles.
- `aws` CLI (v2) with a principal that has `iam:*` on the target account (the Organizations management account if you want the full IdC path).
- `gcloud` CLI with permission to create Service Accounts + set IAM policy on the target project.
- A tenant / account / project you're willing to use for the openagentic instance — do **not** run this against a production cloud tenant.

## One-shot setup

All of the below runs from this repo root assuming the three CLIs are authenticated to the right place:

```bash
bash docs/enterprise-setup/setup.sh
```

That script is a thin wrapper over the commands documented in `azure.md`, `aws.md`, and `gcp.md`. Prefer running those step-by-step the first time so you understand what lands where.
