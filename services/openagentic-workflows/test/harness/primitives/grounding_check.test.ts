/**
 * grounding_check node — fact-checks LLM claims against upstream truth.
 *
 * Deterministic + LLM-free: extracts pod/component/IP tokens from the
 * claim, intersects with the ground-truth bundle, returns the unfounded
 * set. Catches the "model invented a Redis crash that didn't happen"
 * failure mode observed live in the dev environment 2026-05-15.
 */

import { describe, it, expect } from 'vitest';
import { runFlow } from '../runFlow.js';

const TRUTH_TEXT =
  'Cluster health: 9 prometheus scrape targets DOWN. 4 redis_exporter targets ' +
  '(10.42.5.41:9121, 10.42.6.211:9121, 10.42.7.119:9121, 10.42.7.121:9121). ' +
  'Other down: postgres_exporter 10.42.7.133:9187, nginx-exporter 10.42.6.135:9113, ' +
  'ollama 10.42.5.34:11434, minio 10.42.5.38:9000. ' +
  'Pods running: redis-master-0, redis-replicas-0, openagentic-api-6c8cddf76c-ckswm, ' +
  'openagentic-mcp-proxy-577878b8fb-sbpvw, oap-openagentic-aws-mcp-59797cc975-lzvmh.';

describe('grounding_check node', () => {
  it('valid=true when every entity in the claim appears in ground truth', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'check',
            type: 'grounding_check',
            data: {
              claim:
                '9 prometheus targets down including 4 redis_exporter pods. ' +
                'No application-layer errors on openagentic-api.',
              groundTruth: TRUTH_TEXT,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'check' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.check as {
      valid: boolean;
      unfoundedEntities: string[];
      groundedEntities: string[];
    };
    expect(out.valid).toBe(true);
    expect(out.unfoundedEntities).toEqual([]);
    expect(out.groundedEntities).toContain('redis_exporter');
    expect(out.groundedEntities).toContain('openagentic-api');
  });

  it('flags fabricated pod names + invented components', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'check',
            type: 'grounding_check',
            data: {
              // Mirror the exact hallucinations gpt-oss:20b produced live:
              // — invented MCP proxy "both replicas" failure
              // — invented Loki blackout
              // — invented admin dashboard outage
              claim:
                'The entire openagentic-mcp-proxy tier (both replicas) and ' +
                'oap-openagentic-azure-mcp pods are failing readiness probes. ' +
                'Loki has ingested zero log lines. Admin dashboard at ' +
                'admin.openagentic.io is unreachable. Redis crash wave detected.',
              groundTruth: TRUTH_TEXT,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'check' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.check as {
      valid: boolean;
      unfoundedEntities: string[];
      groundedEntities: string[];
      violationSummary: string;
    };
    expect(out.valid).toBe(false);
    // The truth has redis-master-0 + redis-replicas-0/1/2, no "loki" string.
    expect(out.unfoundedEntities).toContain('loki');
    expect(out.unfoundedEntities).toContain('admin.openagentic.io');
    expect(out.violationSummary).toMatch(/unfounded entity/i);
  });

  it('strictMode=true fails the workflow when unfounded entities present', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'check',
            type: 'grounding_check',
            data: {
              claim: 'totally-fabricated-service is down',
              groundTruth: TRUTH_TEXT,
              strictMode: true,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'check' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/grounding_check.*strict/i);
  });

  it('allowedTokens bypass the truth check for pre-approved (extractable) names', async () => {
    // kube-system and prometheus ARE extractable (component dict / hyphenated)
    // but neither appears in TRUTH_TEXT — except prometheus does. Use a token
    // that's extractable but NOT in the truth (e.g. 'openagentic-newsvc')
    // and confirm allowedTokens makes it pass.
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'check',
            type: 'grounding_check',
            data: {
              claim:
                'New finding: openagentic-newsvc-deploy-abc123 needs investigation.',
              groundTruth: TRUTH_TEXT,
              // Whitelist a token that IS extractable (has 2+ hyphens) but
              // doesn't appear in TRUTH_TEXT.
              allowedTokens: ['openagentic-newsvc-deploy-abc123'],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'check' }],
      },
      input: {},
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.check as {
      valid: boolean;
      groundedEntities: string[];
      unfoundedEntities: string[];
    };
    expect(out.valid).toBe(true);
    expect(out.unfoundedEntities).toEqual([]);
    expect(out.groundedEntities).toContain('openagentic-newsvc-deploy-abc123');
  });

  it('resolves {{trigger.X}} templates in claim + groundTruth fields', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'check',
            type: 'grounding_check',
            data: {
              claim: '{{trigger.claimText}}',
              groundTruth: '{{trigger.truthText}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'check' }],
      },
      input: {
        claimText: 'redis_exporter has 4 down targets — Redis itself looks fine.',
        truthText: TRUTH_TEXT,
      },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.check as { valid: boolean; groundedEntities: string[] };
    expect(out.valid).toBe(true);
    expect(out.groundedEntities).toContain('redis_exporter');
  });
});
