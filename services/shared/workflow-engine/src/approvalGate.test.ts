import { describe, it, expect } from 'vitest';
import { canAutoApprove } from './approvalGate.js';

describe('canAutoApprove', () => {
  const goodCtx = {
    input: { autoApprove: true },
    triggerType: 'test' as const,
    userPermissions: ['flows:test:auto-approve']
  };

  it('returns false when input is missing', () => {
    expect(canAutoApprove({})).toBe(false);
  });

  it('returns false when autoApprove flag is absent', () => {
    expect(canAutoApprove({ input: {} })).toBe(false);
  });

  it('returns false when autoApprove flag is false', () => {
    expect(canAutoApprove({ ...goodCtx, input: { autoApprove: false } })).toBe(false);
  });

  it('returns false when triggerType is manual (not test)', () => {
    expect(canAutoApprove({ ...goodCtx, triggerType: 'manual' })).toBe(false);
  });

  it('returns false when triggerType is api (not test)', () => {
    expect(canAutoApprove({ ...goodCtx, triggerType: 'api' })).toBe(false);
  });

  it('returns false when triggerType is webhook (not test)', () => {
    expect(canAutoApprove({ ...goodCtx, triggerType: 'webhook' })).toBe(false);
  });

  it('returns false when triggerType is schedule (not test)', () => {
    expect(canAutoApprove({ ...goodCtx, triggerType: 'schedule' })).toBe(false);
  });

  it('returns false when triggerType is undefined', () => {
    const { triggerType, ...ctx } = goodCtx;
    expect(canAutoApprove(ctx)).toBe(false);
  });

  it('returns false when userPermissions is undefined', () => {
    const { userPermissions, ...ctx } = goodCtx;
    expect(canAutoApprove(ctx)).toBe(false);
  });

  it('returns false when userPermissions is empty', () => {
    expect(canAutoApprove({ ...goodCtx, userPermissions: [] })).toBe(false);
  });

  it('returns false when userPermissions has wrong permission', () => {
    expect(canAutoApprove({ ...goodCtx, userPermissions: ['flows:execute', 'flows:read'] })).toBe(false);
  });

  it('returns true when all three conditions are met', () => {
    expect(canAutoApprove(goodCtx)).toBe(true);
  });

  it('treats string "true" the same as boolean true (defensive)', () => {
    expect(canAutoApprove({ ...goodCtx, input: { autoApprove: 'true' as any } })).toBe(true);
  });

  it('rejects string "false" (only truthy strings count)', () => {
    expect(canAutoApprove({ ...goodCtx, input: { autoApprove: 'false' as any } })).toBe(false);
  });

  it('rejects 1 / 0 numeric values defensively', () => {
    expect(canAutoApprove({ ...goodCtx, input: { autoApprove: 1 as any } })).toBe(false);
    expect(canAutoApprove({ ...goodCtx, input: { autoApprove: 0 as any } })).toBe(false);
  });

  it('does not throw on null inputs', () => {
    expect(() => canAutoApprove(null as any)).not.toThrow();
    expect(canAutoApprove(null as any)).toBe(false);
  });
});
