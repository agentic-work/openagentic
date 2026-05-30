/**
 * Phase 3.7 source-regression test — admin-extras domain routes extraction.
 *
 * Asserts that after Phase 3.7:
 *  1. server.ts does NOT dynamic-import any of the 32 route modules moved
 *     into admin-extras sub-plugins.
 *  2. server.ts DOES contain `register(adminExtrasRoutesPlugin` (call site, not
 *     bare symbol — per Phase 3.1 lesson #1: assert the call site).
 *  3. server.ts DOES import adminExtrasRoutesPlugin from plugins/admin-extras.plugin.js
 *
 * Run from any CWD; all paths resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'services/openagentic-api/src');

const serverTs = readFileSync(join(API_SRC, 'server.ts'), 'utf-8');

// ── admin-audit sub-plugin routes ────────────────────────────────────────────

describe('Phase 3.7 — admin-audit sub-plugin routes removed from server.ts', () => {
  it('server.ts does NOT dynamic-import admin-audit.js (moved to admin-extras/admin-audit.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-audit.js'");
    expect(serverTs).not.toContain('routes/admin-audit.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminAuditRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-audit-logs.js (moved to admin-extras/admin-audit.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-audit-logs.js'");
    expect(serverTs).not.toContain('routes/admin-audit-logs.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminAuditLogsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-credential-audit.js (moved to admin-extras/admin-audit.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-credential-audit.js'");
    expect(serverTs).not.toContain('routes/admin-credential-audit.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminCredentialAuditRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-dashboard-metrics.js (moved to admin-extras/admin-audit.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-dashboard-metrics.js'");
    expect(serverTs).not.toContain('routes/admin-dashboard-metrics.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminDashboardMetricsRoutes\s*\}/);
  });
});

// ── admin-mcp sub-plugin routes ──────────────────────────────────────────────

describe('Phase 3.7 — admin-mcp sub-plugin routes removed from server.ts', () => {
  it('server.ts does NOT dynamic-import admin-mcp-inspector.js (moved to admin-extras/admin-mcp.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-mcp-inspector.js'");
    expect(serverTs).not.toContain('routes/admin-mcp-inspector.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminMCPInspectorRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin/mcp-management.js (moved to admin-extras/admin-mcp.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/mcp-management.js'");
    expect(serverTs).not.toContain('routes/admin/mcp-management.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*mcpManagementRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-tools.js (moved to admin-extras/admin-mcp.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-tools.js'");
    expect(serverTs).not.toContain('routes/admin-tools.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminToolsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-mcp-access.js (moved to admin-extras/admin-mcp.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-mcp-access.js'");
    expect(serverTs).not.toContain('routes/admin-mcp-access.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminMCPAccessRoutes\s*\}/);
  });
});

// ── admin-observability sub-plugin routes ────────────────────────────────────

describe('Phase 3.7 — admin-observability sub-plugin routes removed from server.ts', () => {
  it('server.ts does NOT dynamic-import admin-analytics.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-analytics.js'");
    expect(serverTs).not.toContain('routes/admin-analytics.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminAnalyticsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-roles.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-roles.js'");
    expect(serverTs).not.toContain('routes/admin-roles.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminRolesRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-messages.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-messages.js'");
    expect(serverTs).not.toContain('routes/admin-messages.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminMessagesRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-metrics.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-metrics.js'");
    expect(serverTs).not.toContain('routes/admin-metrics.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminMetricsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin-aif-metrics.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-aif-metrics.js'");
    expect(serverTs).not.toContain('routes/admin-aif-metrics.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminAIFMetricsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin/grafana-proxy.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/grafana-proxy.js'");
    expect(serverTs).not.toContain('routes/admin/grafana-proxy.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*grafanaProxyRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin/pipeline-log.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/pipeline-log.js'");
    expect(serverTs).not.toContain('routes/admin/pipeline-log.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*pipelineLogRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin/pipeline-control.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/pipeline-control.js'");
    expect(serverTs).not.toContain('routes/admin/pipeline-control.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*pipelineControlRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin/pipeline.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/pipeline.js'");
    expect(serverTs).not.toContain('routes/admin/pipeline.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*pipelineStatusRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import monitoring-websocket.js (moved to admin-extras/admin-observability.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/monitoring-websocket.js'");
    expect(serverTs).not.toContain('routes/monitoring-websocket.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*monitoringWebSocketRoutes\s*\}/);
  });
});

// ── admin-misc sub-plugin routes ─────────────────────────────────────────────

describe('Phase 3.7 — admin-misc sub-plugin routes removed from server.ts', () => {
  it('server.ts does NOT dynamic-import admin-user-permissions.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-user-permissions.js'");
    expect(serverTs).not.toContain('routes/admin-user-permissions.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminUserPermissionsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin/auth-access.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/auth-access.js'");
    expect(serverTs).not.toContain('routes/admin/auth-access.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*authAccessRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import openagentic.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/openagentic.js'");
    expect(serverTs).not.toContain('routes/openagentic.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*openagenticRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import routes/health.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/health.js'");
    expect(serverTs).not.toContain('routes/health.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*healthRoutes\s*\}\s*=\s*await import\('\.\/routes\/health/);
  });

  it('server.ts does NOT dynamic-import system-config.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/system-config.js'");
    expect(serverTs).not.toContain('routes/system-config.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*systemConfigRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import internal/result-storage.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/internal/result-storage.js'");
    expect(serverTs).not.toContain('routes/internal/result-storage.js"');
    expect(serverTs).not.toMatch(/registerResultStorageRoutes/);
  });

  it('server.ts does NOT dynamic-import internal/hitl-policy.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/internal/hitl-policy.js'");
    expect(serverTs).not.toContain('routes/internal/hitl-policy.js"');
    expect(serverTs).not.toMatch(/registerHitlPolicyRoutes/);
  });

  it('server.ts does NOT dynamic-import internal/agent-persistence.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/internal/agent-persistence.js'");
    expect(serverTs).not.toContain('routes/internal/agent-persistence.js"');
    expect(serverTs).not.toMatch(/registerAgentPersistenceRoutes/);
  });

  it('server.ts does NOT dynamic-import mcp-logs.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/mcp-logs.js'");
    expect(serverTs).not.toContain('routes/mcp-logs.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*mcpLogsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import awcode.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/awcode.js'");
    expect(serverTs).not.toContain('routes/awcode.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*awcodeRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import routes/docs/index.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/docs/index.js'");
    expect(serverTs).not.toContain('routes/docs/index.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*docsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import background-jobs.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/background-jobs.js'");
    expect(serverTs).not.toContain('routes/background-jobs.js"');
    expect(serverTs).not.toMatch(/backgroundJobsRoutes/);
  });

  it('server.ts does NOT dynamic-import admin-integrations.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-integrations.js'");
    expect(serverTs).not.toContain('routes/admin-integrations.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminIntegrationRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import admin/dlp.js (moved to admin-extras/admin-misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/dlp.js'");
    expect(serverTs).not.toContain('routes/admin/dlp.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*dlpRoutes\s*\}/);
  });
});

// ── wrapper plugin registration ──────────────────────────────────────────────

describe('Phase 3.7 — adminExtrasRoutesPlugin is registered in server.ts', () => {
  it('server.ts DOES contain register(adminExtrasRoutesPlugin (the call site, not just symbol)', () => {
    // Lock the actual register call site per Phase 3.1 lesson #1:
    // a bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(adminExtrasRoutesPlugin');
  });

  it('server.ts DOES import adminExtrasRoutesPlugin from plugins/admin-extras.plugin.js', () => {
    expect(serverTs).toContain('admin-extras.plugin');
  });
});
