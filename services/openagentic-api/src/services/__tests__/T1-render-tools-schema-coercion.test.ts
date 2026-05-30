/**
 * T1 render tools — schema coercion + anti-bias gate regression tests.
 *
 * RED before GREEN discipline (CLAUDE.md Rule 3a).
 *
 * Covers the exact failure patterns observed in live WIRE-CAPTURE logs
 * on 2026-05-19:
 *
 * 1. cloud-run-grid rejects GCP native status values ('ready', 'serving', etc.)
 *    — model uses real GCP API response values which don't match our enum.
 * 2. cloud-run-grid rejects missing `id` field — model often omits it when
 *    GCP Cloud Run doesn't return a separate service ID field.
 * 3. cloud-run-grid rejects missing `title` inside params when title is at
 *    the outer compose_app level.
 * 4. anti-bias gate (#871) fires when GCP list responses contain no numbers —
 *    string-only tool_results (GCP resource lists) should unlock compose tools.
 * 5. savings-grid coerces numeric-string cost values to numbers.
 * 6. compose_visual sankey with tri-cloud values (numbers as strings) should
 *    coerce rather than hard-reject.
 */

import { describe, test, expect, vi } from 'vitest';
import { executeComposeApp } from '../ComposeAppTool.js';
import { executeComposeVisual } from '../ComposeVisualTool.js';
import {
  conversationHasNumericGrounding,
  hasNumericGroundingDeep,
} from '../../routes/chat/pipeline/chat/chatLoop.js';

function makeCtx() {
  const emits: Array<{ event: string; payload: unknown }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) => emits.push({ event, payload }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sessionId: 'test-session',
      userId: 'test-user',
    },
  };
}

// ---------------------------------------------------------------------------
// 1. cloud-run-grid — GCP native status values
// ---------------------------------------------------------------------------
describe('cloud-run-grid — GCP native status coercion', () => {
  test('RED: rejects "ready" status (GCP native) — must change to accept or coerce', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'cloud_run_services',
      template: 'cloud-run-grid',
      params: {
        title: 'Cloud Run Services Health',
        services: [
          {
            id: 's1',
            name: 'mta-sts',
            region: 'us-central1',
            status: 'ready', // GCP native — NOT in enum ['healthy','degraded','down']
            rps: 120,
            latencyP99Ms: 140,
            errorRatePct: 0.01,
          },
        ],
      },
    });
    // After fix: this should be ok=true (coerce 'ready' → 'healthy')
    // BEFORE fix: this will be ok=false
    expect(result.ok).toBe(true); // RED: will fail before fix
    if (result.ok) {
      expect(emits.some((e) => e.event === 'app_render')).toBe(true);
    }
  });

  test('RED: rejects missing id field — model omits it from GCP data', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'cloud_run_services',
      template: 'cloud-run-grid',
      params: {
        title: 'Cloud Run Services Health',
        services: [
          {
            // No `id` field — GCP API doesn't surface a separate ID
            name: 'api-gateway',
            region: 'us-central1',
            status: 'healthy',
          },
        ],
      },
    });
    // After fix: should auto-generate id from name+region
    expect(result.ok).toBe(true); // RED: will fail before fix
  });

  test('RED: rejects "serving" status (GCP native SERVING state)', async () => {
    const { ctx } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'test',
      template: 'cloud-run-grid',
      params: {
        title: 'Test',
        services: [
          { id: 's1', name: 'worker', region: 'us-east1', status: 'serving' },
        ],
      },
    });
    expect(result.ok).toBe(true); // RED: 'serving' → coerce to 'healthy'
  });

  test('RED: rejects "failed" status (GCP native FAILED state)', async () => {
    const { ctx } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'test',
      template: 'cloud-run-grid',
      params: {
        title: 'Test',
        services: [
          { id: 's1', name: 'worker', region: 'us-east1', status: 'failed' },
        ],
      },
    });
    expect(result.ok).toBe(true); // RED: 'failed' → coerce to 'down'
  });

  test('RED: rejects missing region (gpt-oss:20b emitted exactly this 2026-05-19)', async () => {
    // Live wire payload from openagentic-api-7f84785df5-hnnnr:
    //   { params: { services: [{ name: "mta-sts", status: "healthy", url: "..." }] },
    //     template: "cloud-run-grid", title: "Cloud Run Service Dashboard" }
    // → "services.0.region: Required" → tool_result is_error → empty Mini app.
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'Cloud Run Service Dashboard',
      template: 'cloud-run-grid',
      params: {
        services: [
          {
            name: 'mta-sts',
            status: 'healthy',
            url: 'https://mta-sts-gncpjvanna-uc.a.run.app',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(emits.some((e) => e.event === 'app_render')).toBe(true);
    }
  });

  test('RED: rejects missing status (status should default to "healthy" when absent)', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'Cloud Run Inventory',
      template: 'cloud-run-grid',
      params: {
        services: [{ name: 'mta-sts', region: 'us-central1' }],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(emits.some((e) => e.event === 'app_render')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. anti-bias gate — string-only tool_results should count as grounding
// ---------------------------------------------------------------------------
describe('anti-bias gate — string tool_results count as grounding', () => {
  test('hasNumericGroundingDeep: returns false for string-only GCP list response', () => {
    // GCP Cloud Run list: { services: [{ name: "worker", uri: "..." }] }
    const gcpListResult = {
      services: [
        { name: 'mta-sts', uri: 'https://mta-sts-xxx.run.app', region: 'us-central1' },
        { name: 'gnomus-site', uri: 'https://gnomus-xxx.run.app', region: 'us-east1' },
      ],
    };
    // Currently returns false because no numbers — this is correct for hasNumericGrounding
    // but the gate should ALSO accept string-only tool_results as grounding
    expect(hasNumericGroundingDeep(gcpListResult)).toBe(false);
  });

  test('RED: conversationHasNumericGrounding returns false for GCP list-only messages', () => {
    // This is the bug: GCP list response has no numbers but IS real cloud grounding
    const messages = [
      { role: 'user', content: 'Show me my Cloud Run services as a dashboard' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me list your Cloud Run services first.' },
          { type: 'tool_use', id: 'tu-001', name: 'gcp_list_cloud_run_services', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            tool_use_id: 'tu-001',
            content: JSON.stringify({
              services: [
                { name: 'mta-sts', uri: 'https://mta-sts.run.app', region: 'us-central1', status: 'SERVING' },
                { name: 'gnomus-site', uri: 'https://gnomus.run.app', region: 'us-east1', status: 'SERVING' },
              ],
            }),
            is_error: false,
          },
        ],
      },
    ];

    // Currently returns false → anti-bias gate fires → compose_app blocked
    // After fix: should return true (non-empty tool_result IS grounding data)
    expect(conversationHasNumericGrounding(messages)).toBe(true); // RED: currently false
  });

  test('RED: string-valued tool_result with rich content should count as grounding', () => {
    const messages = [
      { role: 'user', content: 'Show me all my Cloud Run services' },
      {
        role: 'tool',
        content: [
          {
            tool_use_id: 'tu-002',
            content: '{"services":[{"name":"api-gw","region":"us-central1","status":"SERVING"}]}',
            is_error: false,
          },
        ],
      },
    ];
    expect(conversationHasNumericGrounding(messages)).toBe(true); // RED: currently false
  });
});

// ---------------------------------------------------------------------------
// 3. savings-grid — numeric string coercion
// ---------------------------------------------------------------------------
describe('savings-grid — numeric string coercion', () => {
  test('RED: rejects string cost values (model emits "540.00" instead of 540)', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'savings',
      template: 'savings-grid',
      params: {
        title: 'AWS Savings Opportunities',
        rows: [
          {
            resource: 'i-0abc123',
            current_cost: '540.00', // string — model sometimes does this
            recommended_action: 'right-size to m5.xlarge',
            monthly_savings: '320', // string
            risk: 'low',
          },
        ],
      },
    });
    // After fix: coerce strings to numbers
    expect(result.ok).toBe(true); // RED: currently fails — z.number() rejects strings
    if (result.ok) {
      expect(emits.some((e) => e.event === 'app_render')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. compose_visual sankey — positive control (should work now + must stay green)
// ---------------------------------------------------------------------------
describe('compose_visual sankey — basic control', () => {
  test('GREEN control: sankey with valid flows must emit visual_render', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeVisual(ctx, {
      template: 'sankey',
      title: 'cloud_cost_flow',
      data: {
        flows: [
          { from: 'AWS', to: 'compute', value: 2000 },
          { from: 'AWS', to: 'storage', value: 800 },
          { from: 'Azure', to: 'compute', value: 1200 },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'visual_render')).toBe(true);
  });

  test('GREEN control: bar_chart emits visual_render', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeVisual(ctx, {
      template: 'bar_chart',
      title: 'tool_usage',
      data: {
        x: ['azure_list_subscriptions', 'k8s_list_pods', 'aws_list_accounts'],
        y: [240, 180, 95],
      },
    });
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'visual_render')).toBe(true);
  });

  test('GREEN control: kpi_grid emits visual_render', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeVisual(ctx, {
      template: 'kpi_grid',
      title: 'platform_health',
      data: {
        kpis: [
          { label: 'Uptime', value: '99.95%', delta: '+0.02%', trend: 'up' },
          { label: 'p99 latency', value: '240ms' },
          { label: 'Error rate', value: '0.12%' },
          { label: 'DAU', value: '1247' },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'visual_render')).toBe(true);
  });

  test('GREEN control: line_chart emits visual_render', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeVisual(ctx, {
      template: 'line_chart',
      title: 'api_volume_weekly',
      data: {
        x: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        y: [12000, 18000, 24000, 21000, 28000, 35000, 42000],
      },
    });
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'visual_render')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. cloud-run-grid — with ALL coercions applied (GREEN after fix)
// ---------------------------------------------------------------------------
describe('cloud-run-grid — coerced real-world model output (GREEN after fix)', () => {
  test('GREEN after fix: exact model output from 2026-05-19 WIRE-CAPTURE', async () => {
    // This is the EXACT payload the model emitted that was rejected
    // (from seq:500 in the WIRE-CAPTURE log)
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'cloud_run_services_health',
      template: 'cloud-run-grid',
      params: {
        title: 'Cloud Run Services Health',
        services: [
          {
            id: 'mta-sts-uc1',
            name: 'mta-sts',
            region: 'us-central1',
            status: 'healthy',
            lastUpdate: '2026-02-16T17:48:15Z', // Note: key is lastUpdate not lastDeployAt
            replicas: '1-100',             // string not in schema
            cpu: '1',                     // string not in schema
            memory: '128Mi',              // string not in schema
            uri: 'https://mta-sts.run.app', // key is uri not in schema
            ingress: 'all',              // extra field not in schema
          },
        ],
      },
    });
    // After fix: extra fields should be stripped via .passthrough() or .strip() (zod default)
    // The core issue was status enum — with 'healthy' this should work already
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'app_render')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. migration-plan — positive control (should already work)
// ---------------------------------------------------------------------------
describe('migration-plan template — positive control', () => {
  test('GREEN control: migration-plan emits app_render with valid params', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'migration_plan',
      template: 'migration-plan',
      params: {
        title: 'Azure → AWS migration',
        waves: [
          {
            wave: 'Wave 1 — non-prod',
            items: [
              { id: 'app-1', name: 'staging-api', status: 'done' },
              { id: 'app-2', name: 'staging-web', status: 'in_progress' },
            ],
          },
          {
            wave: 'Wave 2 — prod',
            items: [
              { id: 'app-3', name: 'prod-api', status: 'pending' },
            ],
            blockers: ['waiting on Stripe cutover approval'],
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'app_render')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. render_artifact — positive controls
// ---------------------------------------------------------------------------
describe('render_artifact — html and svg controls', () => {
  test('GREEN control: html renders inline widget', async () => {
    const { ctx, emits } = makeCtx();
    const { executeRenderArtifact } = await import('../RenderArtifactTool.js');
    const result = await executeRenderArtifact(ctx, {
      kind: 'html',
      content: '<!doctype html><html><head><title>Test</title></head><body><div style="padding:16px;background:var(--cm-bg)"><h1 style="color:var(--cm-fg)">Test User</h1></div></body></html>',
      title: 'test_widget',
    });
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'artifact_render')).toBe(true);
  });

  test('GREEN control: svg with 3 bars emits artifact_render', async () => {
    const { ctx, emits } = makeCtx();
    const { executeRenderArtifact } = await import('../RenderArtifactTool.js');
    const result = await executeRenderArtifact(ctx, {
      kind: 'svg',
      content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><rect x="10" y="70" width="20" height="20" fill="var(--cm-accent)"/><rect x="50" y="50" width="20" height="40" fill="var(--cm-accent)"/><rect x="90" y="30" width="20" height="60" fill="var(--cm-accent)"/></svg>',
      title: 'bars_chart',
    });
    expect(result.ok).toBe(true);
    expect(emits.some((e) => e.event === 'artifact_render')).toBe(true);
  });
});
