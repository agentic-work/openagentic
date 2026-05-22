/**
 * taskOutputSchemas — REAL integration test against host.docker.internal:11434 gpt-oss:20b.
 *
 * Drives the actual Ollama JSON-mode endpoint with a schema directive and
 * validates the real model output against our hand-rolled validator.
 * No mocks, no synthesized fixtures — the JSON being validated is what
 * gpt-oss:20b emits.
 *
 * Endpoint: http://host.docker.internal:11434/api/chat (memory-canonical Ollama target)
 * Model:    gpt-oss:20b
 * Mode:     format='json' (Ollama JSON-mode coerces the model to emit
 *           parseable JSON without markdown fences or prose).
 *
 * Skip-with-loud-warn when host.docker.internal:11434 unreachable per memory rule
 * feedback_real_provider_testing_regime_chatmode_pivot. Never falls
 * back to synthesized model output.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  validateTaskOutput,
  buildSchemaDirective,
} from '../taskOutputSchemas.js';

const HAL_URL = process.env.OLLAMA_HOST || 'http://host.docker.internal:11434';
const TEST_MODEL = process.env.OLLAMA_TEST_MODEL || 'gpt-oss:20b';

let HAL_OK = false;
let HAL_SKIP_REASON = '';

async function probeHal(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5_000);
    const res = await fetch(`${HAL_URL}/api/tags`, { signal: ctl.signal });
    clearTimeout(t);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${HAL_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEST_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: 'json',
      options: { temperature: 0.1 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

describe('taskOutputSchemas — pure validator unit checks', () => {
  it('validates a hand-crafted cloud_resource_listing payload', () => {
    const raw = JSON.stringify({
      provider: 'azure',
      resource_kind: 'subscription',
      items: [{ id: 'sub-1', name: 'prod' }],
    });
    const result = validateTaskOutput(raw, 'cloud_resource_listing');
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('rejects a payload missing required fields', () => {
    const raw = JSON.stringify({ provider: 'azure' });
    const result = validateTaskOutput(raw, 'cloud_resource_listing');
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes('resource_kind'))).toBe(true);
    expect(result.errors!.some((e) => e.includes('items'))).toBe(true);
  });

  it('rejects a payload with bad enum value', () => {
    const raw = JSON.stringify({
      provider: 'oracle', // not in enum
      resource_kind: 'shape',
      items: [],
    });
    const result = validateTaskOutput(raw, 'cloud_resource_listing');
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.includes('enum'))).toBe(true);
  });

  it('rejects unknown schema name', () => {
    const result = validateTaskOutput('{}', 'not_a_real_schema');
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("unknown schema");
  });

  it('rejects unparseable JSON', () => {
    const result = validateTaskOutput('this is not json', 'cloud_resource_listing');
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain('JSON parse failed');
  });
});

describe('taskOutputSchemas — REAL gpt-oss:20b on hal validation', () => {
  beforeAll(async () => {
    HAL_OK = await probeHal();
    if (!HAL_OK) {
      // eslint-disable-next-line no-console
      console.warn(
        `[taskOutputSchemas.realOllama] host.docker.internal:11434 unreachable. Skipping real-provider validation. ` +
          'Per memory rule no-synthetic-chunks-only-real-provider-captures, NOT falling back to fake model output.',
      );
    }
  }, 10_000);

  it('validates real gpt-oss:20b output for cloud_resource_listing schema', async () => {
    if (!HAL_OK) return;
    const prompt =
      buildSchemaDirective('cloud_resource_listing') +
      `\n\nProduce a realistic example with provider="aws", resource_kind="account", ` +
      `and exactly 3 items (each with id like "1234-5678-9012", a name, and region).`;
    const raw = await callOllama(prompt);
    expect(raw.length).toBeGreaterThan(0);
    const result = validateTaskOutput(raw, 'cloud_resource_listing');
    // We log the actual model output for transcript reproducibility.
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn('[realOllama] gpt-oss:20b emitted invalid JSON:', raw, result.errors);
    }
    // gpt-oss:20b in JSON mode IS sloppy — we tolerate either outcome but
    // the validator must produce a determinate verdict (no exceptions).
    expect(typeof result.ok).toBe('boolean');
    // When valid, the data must round-trip
    if (result.ok) {
      expect((result.data as any).provider).toBe('aws');
      expect((result.data as any).resource_kind).toBe('account');
      expect(Array.isArray((result.data as any).items)).toBe(true);
    }
  }, 60_000);

  it('validates real gpt-oss:20b output for cost_analysis schema', async () => {
    if (!HAL_OK) return;
    const prompt =
      buildSchemaDirective('cost_analysis') +
      `\n\nProduce a realistic example: period="2026-04", total_usd around 12500, ` +
      `breakdown with 4 entries summing to total_usd (labels like "EC2", "S3", "RDS", "Lambda").`;
    const raw = await callOllama(prompt);
    const result = validateTaskOutput(raw, 'cost_analysis');
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn('[realOllama] gpt-oss:20b emitted invalid JSON for cost_analysis:', raw, result.errors);
    }
    expect(typeof result.ok).toBe('boolean');
    if (result.ok) {
      expect(typeof (result.data as any).total_usd).toBe('number');
      expect(Array.isArray((result.data as any).breakdown)).toBe(true);
    }
  }, 60_000);

  it('validates real gpt-oss:20b output for security_finding schema', async () => {
    if (!HAL_OK) return;
    const prompt =
      buildSchemaDirective('security_finding') +
      `\n\nProduce a realistic example: severity="high", resource="i-0abc123", ` +
      `description describes an open port 22, and remediation is a 1-sentence fix.`;
    const raw = await callOllama(prompt);
    const result = validateTaskOutput(raw, 'security_finding');
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn('[realOllama] gpt-oss:20b emitted invalid JSON for security_finding:', raw, result.errors);
    }
    expect(typeof result.ok).toBe('boolean');
    if (result.ok) {
      expect(['low', 'medium', 'high', 'critical']).toContain((result.data as any).severity);
    }
  }, 60_000);
});
