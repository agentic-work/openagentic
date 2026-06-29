/**
 * AuthAuditLogger.logAuthEvent — TDD spec.
 *
 * The auth flow has no first-class persistence of login/logout/sso events
 * today (they were only ever buried in admin_audit_log.details JSON, or not
 * recorded at all for local logins). The new auth_audit_log table is a real
 * source for the unified admin audit feed. This logger writes one normalized
 * row per auth event.
 *
 * Requirements:
 *   - a successful login writes exactly one row with success:true
 *   - a failed login writes a row with success:false (and may have a null user_id)
 *   - event + provider + ip + user_agent are persisted as their own columns
 *   - the call is best-effort: a prisma failure NEVER throws into the auth path
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted prisma mock so we don't touch a real DB.
const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    authAuditLog: {
      create: createMock,
    },
  },
}));

import { logAuthEvent } from '../authAuditLogger.js';

describe('logAuthEvent', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({});
  });

  it('writes exactly one auth_audit_log row per call', async () => {
    await logAuthEvent({
      event: 'login',
      provider: 'local',
      success: true,
      userId: 'user-1',
      userEmail: 'admin@openagentic.local',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });
    expect(createMock).toHaveBeenCalledOnce();
  });

  it('maps a successful login to a normalized row (success:true)', async () => {
    await logAuthEvent({
      event: 'login',
      provider: 'local',
      success: true,
      userId: 'user-1',
      userEmail: 'admin@openagentic.local',
      ipAddress: '10.0.0.5',
      userAgent: 'Mozilla/5.0',
    });
    const row = createMock.mock.calls[0][0].data;
    expect(row.event).toBe('login');
    expect(row.provider).toBe('local');
    expect(row.success).toBe(true);
    expect(row.user_id).toBe('user-1');
    expect(row.user_email).toBe('admin@openagentic.local');
    expect(row.ip_address).toBe('10.0.0.5');
    expect(row.user_agent).toBe('Mozilla/5.0');
  });

  it('records a failed login with success:false and a null user_id', async () => {
    await logAuthEvent({
      event: 'login_failed',
      provider: 'local',
      success: false,
      userEmail: 'attacker@example.com',
      ipAddress: '203.0.113.7',
      detail: { reason: 'invalid_credentials' },
    });
    const row = createMock.mock.calls[0][0].data;
    expect(row.success).toBe(false);
    expect(row.event).toBe('login_failed');
    // user_id is unknown for a failed login against a non-existent / wrong-pw user
    expect(row.user_id ?? null).toBeNull();
    expect(row.user_email).toBe('attacker@example.com');
    expect(row.detail).toEqual({ reason: 'invalid_credentials' });
  });

  it('persists an sso_login event with its provider', async () => {
    await logAuthEvent({
      event: 'sso_login',
      provider: 'azure',
      success: true,
      userId: 'azure_oid-9',
      userEmail: 'sso@corp.example',
      ipAddress: '198.51.100.2',
    });
    const row = createMock.mock.calls[0][0].data;
    expect(row.event).toBe('sso_login');
    expect(row.provider).toBe('azure');
    expect(row.success).toBe(true);
  });

  it('is best-effort: a prisma failure does not throw into the caller', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      logAuthEvent({ event: 'logout', provider: 'local', success: true, userId: 'user-1' }),
    ).resolves.toBeUndefined();
  });
});
