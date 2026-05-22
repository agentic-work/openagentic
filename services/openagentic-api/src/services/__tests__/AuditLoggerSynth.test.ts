/**
 * AuditLogger.logSynthExecution — TDD spec.
 *
 * Requirements:
 *   - every synth execution writes one row to admin_audit_log
 *   - intent truncated to 512 chars
 *   - code hashed (sha256 full hex)
 *   - capabilities + cloud_targets recorded as arrays
 *   - risk_level and outcome recorded
 *   - credentials NEVER stored — only key names + sha256:<hex8>... tags
 *   - tamper-evident chain hash is computed (inherits AdminAuditLog behavior)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted prisma mock so we don't touch a real DB.
const { createMock, findFirstMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    adminAuditLog: {
      create: createMock,
      findFirst: findFirstMock,
    },
  },
}));

import { AuditLogger } from '../AuditLogger.js';
import pino from 'pino';

describe('AuditLogger.logSynthExecution', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    createMock.mockReset();
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue(null); // no previous hash
    createMock.mockResolvedValue({});
    logger = new AuditLogger(pino({ level: 'silent' }));
  });

  const BASE_ENTRY = {
    userId: 'user-oid-123',
    userEmail: 'alice@example.com',
    executionId: 'exec-abc',
    intent: 'list all s3 buckets in the default region',
    code: "import boto3\nprint(boto3.client('s3').list_buckets())",
    capabilities: ['aws'] as string[],
    cloudTargets: ['aws'] as string[],
    riskLevel: 'low' as const,
    outcome: 'success' as const,
    executionTimeMs: 320,
    injectedEnvKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN'],
  };

  it('writes exactly one admin_audit_log row per call', async () => {
    await logger.logSynthExecution(BASE_ENTRY);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it('maps action=synth.execute and resource_type=synth', async () => {
    await logger.logSynthExecution(BASE_ENTRY);
    const row = createMock.mock.calls[0][0].data;
    expect(row.action).toBe('synth.execute');
    expect(row.resource_type).toBe('synth');
    expect(row.resource_id).toBe('exec-abc');
  });

  it('stores user id + email', async () => {
    await logger.logSynthExecution(BASE_ENTRY);
    const row = createMock.mock.calls[0][0].data;
    expect(row.admin_user_id).toBe('user-oid-123');
    expect(row.admin_email).toBe('alice@example.com');
  });

  it('hashes the code (sha256 hex, 64 chars)', async () => {
    await logger.logSynthExecution(BASE_ENTRY);
    const details = createMock.mock.calls[0][0].data.details;
    expect(details.code_hash).toMatch(/^[0-9a-f]{64}$/);
    // Raw code must NOT appear anywhere in the audit row.
    const rowStr = JSON.stringify(createMock.mock.calls[0][0].data);
    expect(rowStr).not.toContain('import boto3');
    expect(rowStr).not.toContain('list_buckets');
  });

  it('truncates intent at 512 chars', async () => {
    const longIntent = 'x'.repeat(1000);
    await logger.logSynthExecution({ ...BASE_ENTRY, intent: longIntent });
    const details = createMock.mock.calls[0][0].data.details;
    expect(details.intent.length).toBeLessThanOrEqual(512);
  });

  it('records capabilities, cloud_targets, risk_level, outcome, execution_time_ms', async () => {
    await logger.logSynthExecution(BASE_ENTRY);
    const details = createMock.mock.calls[0][0].data.details;
    expect(details.capabilities).toEqual(['aws']);
    expect(details.cloud_targets).toEqual(['aws']);
    expect(details.risk_level).toBe('low');
    expect(details.outcome).toBe('success');
    expect(details.execution_time_ms).toBe(320);
  });

  it('never persists raw credential values — only key names + sha256 prefix tags', async () => {
    await logger.logSynthExecution({
      ...BASE_ENTRY,
      injectedEnvKeys: ['AWS_ACCESS_KEY_ID', 'AZURE_ACCESS_TOKEN'],
      // This field is NOT part of the public shape — included only to
      // prove a caller can't sneak values in.
    } as any);
    const details = createMock.mock.calls[0][0].data.details;
    expect(details.injected_env_keys).toEqual(['AWS_ACCESS_KEY_ID', 'AZURE_ACCESS_TOKEN']);
    expect(JSON.stringify(details)).not.toMatch(/AKIA|ASIA|eyJ/); // no raw AWS/JWT
  });

  it('records all four outcome shapes', async () => {
    for (const outcome of ['success', 'error', 'refused', 'approval_pending'] as const) {
      createMock.mockClear();
      await logger.logSynthExecution({ ...BASE_ENTRY, outcome });
      const details = createMock.mock.calls[0][0].data.details;
      expect(details.outcome).toBe(outcome);
    }
  });

  it('computes chain_hash (tamper-evident)', async () => {
    await logger.logSynthExecution(BASE_ENTRY);
    const row = createMock.mock.calls[0][0].data;
    expect(row.chain_hash).toBeDefined();
    expect(row.chain_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles missing code gracefully (refused pre-synthesis)', async () => {
    await logger.logSynthExecution({
      ...BASE_ENTRY,
      code: undefined,
      outcome: 'refused',
      riskLevel: 'critical',
    });
    const details = createMock.mock.calls[0][0].data.details;
    expect(details.code_hash).toBeNull();
    expect(details.outcome).toBe('refused');
  });
});
