# Contributing to openagentic

Thanks for thinking about contributing — the project is much better with
outside eyes on it. This guide covers the practical bits: how to get a
local stack running, what we ship vs. what's behind the hosted/enterprise
edition, and the conventions we follow when reviewing PRs.

## Quickstart for contributors

The fastest path to a working dev environment is the same one users get:

```bash
git clone https://github.com/agentic-work/openagentic
cd openagentic
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD + ADMIN_SEED_PASSWORD + OLLAMA_HOST
docker compose up -d
```

Wait ~90s for `openagentic-api-1` to report healthy:

```bash
until [ "$(docker inspect --format '{{.State.Health.Status}}' openagentic-api-1)" = healthy ]; do sleep 5; done
curl -sS http://localhost:8080/api/health | jq .
```

Then sign in at `http://localhost:8080` with the admin email/password
from your `.env`.

### Need to rebuild a service?

```bash
docker compose build api    # or ui / workflows / mcp-proxy / proxy / synth
docker compose up -d --force-recreate api
docker logs -f openagentic-api-1
```

### Need to wipe and start over?

```bash
docker compose down
docker volume rm openagentic_pg-data    # ⚠️ destroys all data
docker compose up -d
```

## Running tests

The wizard PTY harness exercises the install path end-to-end and is the
fastest signal that you haven't broken the user-facing flow:

```bash
# first time only — create venv + install pexpect
python3 -m venv tools/setup/tests/.venv
tools/setup/tests/.venv/bin/pip install pexpect

tools/setup/tests/.venv/bin/python tools/setup/tests/pty_harness.py
# → minimal / all-mcps-inline / skip-all-cloud (3/3 pass)
```

API + UI typecheck (no docker needed, just node + pnpm):

```bash
pnpm install               # workspace install at repo root
pnpm -C services/openagentic-api type-check
pnpm -C services/openagentic-ui type-check
```

API unit tests (vitest) need postgres running:

```bash
docker compose up -d postgres redis
pnpm -C services/openagentic-api test
```

## What ships in OSS vs. the hosted edition

The OSS edition focuses on the local single-tenant install:

| Capability | OSS | Hosted / Enterprise |
|---|---|---|
| Chat + multi-provider LLMs | ✅ | ✅ |
| Visual Flows + 16 bundled MCPs | ✅ | ✅ |
| Local install + docker-compose | ✅ | ✅ |
| Helm chart for k8s | ✅ (templates) | ✅ (managed) |
| Admin: chargeback, audit logs, DLP rules, rate limits, per-tier fc | 402 upsell | ✅ |
| Multi-tenant, SSO, SAML, FedRAMP/HIPAA controls | — | ✅ |
| Managed model fleet + ops support | — | ✅ |

Some `/api/admin/*` routes return **402 Payment Required** with an
upgrade link to [agenticwork.io](https://agenticwork.io). That's
intentional — the funnel keeps the OSS install free and lets the team
fund continued development. Please don't strip those gates in PRs.

The 402 gate is implemented in
`services/openagentic-api/src/middleware/enterpriseOnly.ts` and applied
to specific admin routes by `tools/gate-enterprise-routes.py`.

## What we DO want in PRs

- Bug fixes in the core (chat, flows, MCP routing, install, wizard)
- Improvements to MCPs under `services/mcps/oap-*-mcp`
- New MCP servers (open an issue first to align on the surface)
- Better install UX — first-run wizard, docs, error messages
- Helm chart fixes for self-hosted Kubernetes deployments
- Frontend polish, accessibility, theme work
- Tests — anywhere. The test surface is thin; adding coverage is high-leverage.

## What we DON'T want in PRs

- Bypassing the enterprise 402 gates (see above)
- Reintroducing Code Mode (the per-user exec sandbox + coding CLI
  integration was deliberately removed for the OSS edition — too
  heavy to ship and operate at v1)
- Hardcoded model IDs in source outside of provider adapters + seeders
  (see `services/openagentic-api/src/services/llm-providers/`)
- Hardcoded deployment / tenant / registry strings (env vars or
  Helm values only)
- Anything that adds a hosted-service dependency on cloud-only APIs
  for the core install path (cloud MCPs are opt-in; the core has to
  run with just Ollama)

## Conventions

- **Commits**: keep them small and self-describing. We squash-merge PRs,
  so a clean PR description matters more than per-commit polish.
- **No comments unless the WHY is non-obvious.** Names should carry the
  meaning. Reserve comments for hidden constraints, subtle invariants,
  workarounds tied to specific bugs.
- **Don't add error handling for impossible cases.** Only validate at
  system boundaries (user input, external APIs).
- **Prefer editing existing files** over creating new ones, especially
  for docs.
- **Tests live next to source** in `__tests__/` directories. We use
  vitest for TS, pytest for python.
- **One service per PR** if you can — easier to review.

## CI

All CI runs on the project's self-hosted runner pool
(`openagentic-runners`). We deliberately don't use GitHub-hosted
runners — they're metered and we want zero ongoing cost exposure for
the OSS project. The `runner-guard.yml` workflow rejects any
`ubuntu-latest` / `macos-latest` / `windows-latest` runner label.

**What this means for fork PRs:** GitHub won't run our workflows on
your fork (jobs targeting self-hosted runners just sit pending until a
maintainer kicks them off on the trusted branch). Please run these
locally before opening a PR:

```bash
# Lint + typecheck
pnpm -C services/openagentic-api type-check
pnpm -C services/openagentic-ui type-check
pnpm -C services/openagentic-workflows exec tsc --noEmit

# OSS integrity (edition flag, upsell strings, runner-guard)
bash tools/verify-oss-integrity.sh
bash tools/verify-self-hosted-runners.sh

# Wizard end-to-end (catches install regressions)
tools/setup/tests/.venv/bin/python tools/setup/tests/pty_harness.py

# Compose syntax + key smoke check
POSTGRES_PASSWORD=ci docker compose config > /dev/null
```

A green local run + a clean PR description is enough for a maintainer
to start review. We'll re-run the same checks on our pool before merge.

## Reporting bugs

Use one of the issue templates under `.github/ISSUE_TEMPLATE/`:
- `bug_report.yml` — something's broken
- `feature_request.yml` — something missing
- `build_failure.yml` — install / docker / wizard failure
- `security_issue.yml` — please report privately to `hello@agenticwork.io`

When in doubt, open an issue first. A quick "is this in scope?" beats a
PR that gets closed.

## License

By contributing you agree that your contributions will be licensed under
the Apache-2.0 license that covers this repo.
