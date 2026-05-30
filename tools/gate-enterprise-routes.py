#!/usr/bin/env python3
"""
One-shot: inject `enterpriseOnly` preHandler into a list of admin route
files. Idempotent — skips files that already have it.

Usage: python3 tools/gate-enterprise-routes.py
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Tier 1 + 2 + 3 admin routes. Paths relative to repo root.
ROUTES = [
    # ─── Original gated set (governance + compliance core) ────────────
    'services/openagentic-api/src/routes/admin-chargeback.ts',
    'services/openagentic-api/src/routes/admin/dlp.ts',
    'services/openagentic-api/src/routes/admin-metrics.ts',
    'services/openagentic-api/src/routes/admin-llm-metrics.ts',
    'services/openagentic-api/src/routes/admin-dashboard-metrics.ts',
    'services/openagentic-api/src/routes/admin-user-permissions.ts',
    'services/openagentic-api/src/routes/admin-audit-logs.ts',
    'services/openagentic-api/src/routes/admin-audit-chat.ts',
    'services/openagentic-api/src/routes/admin-audit.ts',
    'services/openagentic-api/src/routes/admin-credential-audit.ts',
    'services/openagentic-api/src/routes/admin-rate-limits.ts',
    'services/openagentic-api/src/routes/admin-webhook-security.ts',
    'services/openagentic-api/src/routes/admin-tiered-fc.ts',
    'services/openagentic-api/src/routes/admin-slider.ts',
    # ─── 2026-05-26 expansion — multi-tenant / governance / analytics ───
    # Per-user observability (multi-tenant fleet view).
    'services/openagentic-api/src/routes/admin-user-activity.ts',
    'services/openagentic-api/src/routes/admin-usage-analytics.ts',
    # Feedback governance (user feedback collection + advisories).
    'services/openagentic-api/src/routes/admin-feedback.ts',
    'services/openagentic-api/src/routes/admin/feedback-advisories.ts',
    # Prompt governance (analytics + RBAC system prompts).
    'services/openagentic-api/src/routes/admin-prompt-analytics.ts',
    'services/openagentic-api/src/routes/admin-rbac-system-prompts.ts',
    # Tenant / role / access-control (multi-tenant identity stack).
    'services/openagentic-api/src/routes/admin-roles.ts',
    # admin-mcp-access.ts is gated PER-ROUTE — its GET /servers handler
    # serves the free MCP fleet listing. Adding a plugin-wide hook here
    # would 402-block Tools Management → Server Management for OSS users.
    'services/openagentic-api/src/routes/admin-mcp-tool-access.ts',
    # Flow governance (per-flow audit + change tracking).
    'services/openagentic-api/src/routes/admin-flow-audit.ts',
    # Agent governance — scheduled / cron-driven agent runs.
    'services/openagentic-api/src/routes/admin-agent-schedules.ts',
    # SRE / SLO governance — multi-tenant uptime tracking.
    'services/openagentic-api/src/routes/admin/slo.ts',
    'services/openagentic-api/src/routes/admin/agent-metrics.ts',
    # Admin test harness — internal QA tooling (not part of OSS surface).
    # `admin-test-harness-helpers.ts` is excluded — it's a pure helper module
    # invoked by admin-test-harness.ts, not a Fastify plugin. The gate on the
    # route file covers it transitively.
    'services/openagentic-api/src/routes/admin-test-harness.ts',
    'services/openagentic-api/src/routes/admin-test-harness-run-e2e.ts',
]

HOOK_BLOCK = (
    "\n  // OSS gate — all routes in this plugin return 402 with upgrade_url.\n"
    "  fastify.addHook('preHandler', enterpriseOnly);\n"
)


def import_line_for(path: str) -> str:
    """Compute the correct relative path to src/middleware/enterpriseOnly.js."""
    # Depth of the route file below src/routes/.
    # e.g. src/routes/admin-x.ts → ../middleware
    #      src/routes/admin/dlp.ts → ../../middleware
    parts = path.split('/')
    # Find 'routes' in the path and count segments after it, minus the filename.
    try:
        idx = parts.index('routes')
    except ValueError:
        return "import { enterpriseOnly } from '../middleware/enterpriseOnly.js';\n"
    depth_below_routes = len(parts) - idx - 2  # -1 for 'routes' itself, -1 for filename
    relative = '../' * (depth_below_routes + 1) + 'middleware/enterpriseOnly.js'
    return f"import {{ enterpriseOnly }} from '{relative}';\n"


def gate(path: str) -> str:
    full = os.path.join(REPO, path)
    if not os.path.isfile(full):
        return 'MISSING'
    src = open(full, encoding='utf-8').read()
    if 'enterpriseOnly' in src:
        return 'already-gated'
    IMPORT_LINE = import_line_for(path)

    # Insert import after last existing `from '../...'` or `from './...'`  line.
    import_re = re.compile(r"^import[^\n]*\n", re.MULTILINE)
    matches = list(import_re.finditer(src))
    if not matches:
        return 'no-imports'
    last = matches[-1]
    src2 = src[:last.end()] + IMPORT_LINE + src[last.end():]

    # Find the plugin body opening and inject hook at its top. Matches:
    #   export const fooRoutes: FastifyPluginAsync = async (...) => {
    #   const fooRoutes: FastifyPluginAsync = async (...) => {
    #   export const fooRoutes = async (fastify: FastifyInstance) => {
    #   export default async function fooRoutes(fastify: FastifyInstance) {
    plugin_re = re.compile(
        r"("
        r"(?:export\s+)?(?:const|default)\s+\w+\s*:?\s*FastifyPluginAsync[^{]*\{\s*\n"
        r"|"
        r"export\s+(?:default\s+)?async\s+function\s+\w+\s*\([^)]*fastify[^)]*\)\s*\{\s*\n"
        r"|"
        r"export\s+const\s+\w+\s*=\s*async\s*\([^)]*fastify[^)]*\)\s*=>\s*\{\s*\n"
        r")",
        re.MULTILINE,
    )
    m = plugin_re.search(src2)
    if not m:
        return 'no-plugin-body'
    src3 = src2[:m.end()] + HOOK_BLOCK + src2[m.end():]

    open(full, 'w', encoding='utf-8').write(src3)
    return 'gated'


def main() -> int:
    results: dict[str, list[str]] = {}
    for p in ROUTES:
        r = gate(p)
        results.setdefault(r, []).append(p)
    for kind, paths in results.items():
        print(f"{kind}: {len(paths)} file(s)")
        for p in paths:
            print(f"  {p}")
    return 0 if 'no-plugin-body' not in results and 'no-imports' not in results else 1


if __name__ == '__main__':
    sys.exit(main())
