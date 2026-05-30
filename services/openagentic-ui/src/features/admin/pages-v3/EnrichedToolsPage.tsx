/**
 * EnrichedToolsPage — V3 Phase 5 stub.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §5
 *
 * Surfaces the EnrichedTool registry (per-T1-tool outputTemplate +
 * truncate_summary metadata) for admin operators. Phase 11 (UX
 * primitives) builds the full editable form; this stub is the route
 * landing page so the sidebar leaf resolves and operators see the
 * intent + API surface ahead of the real UI.
 */

import React from 'react'

export const EnrichedToolsPage: React.FC = () => {
  return (
    <div style={{ padding: 24, color: 'var(--fg-1)' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: 'var(--fg-0)' }}>
        Enriched Tools
      </h1>
      <p style={{ marginBottom: 12, color: 'var(--fg-2)', maxWidth: 720 }}>
        The EnrichedTool registry holds per-T1-tool metadata
        (<code>outputTemplate</code>, <code>truncate_summary</code> template,
        input/output JSON Schemas, MCP server, category, tier). It drives the
        V3 envelope splitter — the model channel gets a compact
        <code> structuredContent.summary</code>, the UI channel gets
        <code> _meta.outputTemplate</code> for FrameRendererRegistry lookup.
      </p>
      <p style={{ marginBottom: 12, color: 'var(--fg-2)', maxWidth: 720 }}>
        Default rows are seeded at boot by <code>EnrichedToolSeeder</code>
        (~14 T1 tools across cloud-ops / k8s / data / meta categories).
        Subsequent boots refresh structural fields but preserve admin-set
        <code> enabled</code> flags.
      </p>
      <p style={{ marginBottom: 24, color: 'var(--fg-3)', fontSize: 13 }}>
        Full edit UI ships in Phase 11. For now the API is live:
      </p>
      <pre
        style={{
          background: 'var(--bg-2)',
          padding: 16,
          borderRadius: 8,
          color: 'var(--fg-1)',
          fontSize: 13,
          maxWidth: 720,
          overflow: 'auto',
        }}
      >
{`GET    /api/admin/enriched-tools[?category|mcp_server|enabled]
GET    /api/admin/enriched-tools/:slug
POST   /api/admin/enriched-tools                 (upsert; admin only)
PATCH  /api/admin/enriched-tools/:slug/toggle    (enable/disable; admin only)
DELETE /api/admin/enriched-tools/:slug           (admin only)`}
      </pre>
    </div>
  )
}

export default EnrichedToolsPage
