import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Tests are written BEFORE the implementation — RED phase.
// ---------------------------------------------------------------------------

describe('daemonRPCBridge store', () => {
  beforeEach(async () => {
    // Reset store between tests by importing fresh and re-setting
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    useDaemonRPCBridge.getState().setCall(null);
    useDaemonRPCBridge.getState().setCwd(null);
  });

  it('1. initial state — call is null', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    expect(useDaemonRPCBridge.getState().call).toBeNull();
  });

  it('2. setCall stores a function', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    const fn = vi.fn().mockResolvedValue({});
    useDaemonRPCBridge.getState().setCall(fn);
    expect(useDaemonRPCBridge.getState().call).toBe(fn);
  });

  it('3. setCall(null) clears the stored function', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    const fn = vi.fn().mockResolvedValue({});
    useDaemonRPCBridge.getState().setCall(fn);
    expect(useDaemonRPCBridge.getState().call).toBe(fn);
    useDaemonRPCBridge.getState().setCall(null);
    expect(useDaemonRPCBridge.getState().call).toBeNull();
  });

  it('4. selector hook returns store value and re-renders on change', async () => {
    const { useDaemonRPCBridge, useDaemonRPCBridgeCall } = await import('../daemonRPCBridge');
    const fn = vi.fn().mockResolvedValue({});

    const { result } = renderHook(() => useDaemonRPCBridgeCall());
    expect(result.current).toBeNull();

    act(() => {
      useDaemonRPCBridge.getState().setCall(fn);
    });
    expect(result.current).toBe(fn);

    act(() => {
      useDaemonRPCBridge.getState().setCall(null);
    });
    expect(result.current).toBeNull();
  });

  it('5. multiple setCalls — last wins', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    const fnA = vi.fn().mockResolvedValue('a');
    const fnB = vi.fn().mockResolvedValue('b');
    useDaemonRPCBridge.getState().setCall(fnA);
    useDaemonRPCBridge.getState().setCall(fnB);
    expect(useDaemonRPCBridge.getState().call).toBe(fnB);
  });
});

describe('daemonRPCBridge cwd channel', () => {
  beforeEach(async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    useDaemonRPCBridge.getState().setCall(null);
    useDaemonRPCBridge.getState().setCwd(null);
  });

  it('6. initial cwd is null', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    expect(useDaemonRPCBridge.getState().cwd).toBeNull();
  });

  it('7. setCwd stores the path string', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    useDaemonRPCBridge.getState().setCwd('/workspaces/u-123');
    expect(useDaemonRPCBridge.getState().cwd).toBe('/workspaces/u-123');
  });

  it('8. setCwd(null) clears the path', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    useDaemonRPCBridge.getState().setCwd('/workspaces/u-123');
    useDaemonRPCBridge.getState().setCwd(null);
    expect(useDaemonRPCBridge.getState().cwd).toBeNull();
  });

  it('9. useDaemonRPCBridgeCwd selector returns current value and re-renders on change', async () => {
    const { useDaemonRPCBridge, useDaemonRPCBridgeCwd } = await import('../daemonRPCBridge');

    const { result } = renderHook(() => useDaemonRPCBridgeCwd());
    expect(result.current).toBeNull();

    act(() => {
      useDaemonRPCBridge.getState().setCwd('/workspaces/u-abc');
    });
    expect(result.current).toBe('/workspaces/u-abc');

    act(() => {
      useDaemonRPCBridge.getState().setCwd(null);
    });
    expect(result.current).toBeNull();
  });

  it('10. cwd and call channels are independent', async () => {
    const { useDaemonRPCBridge } = await import('../daemonRPCBridge');
    const fn = vi.fn().mockResolvedValue({});
    useDaemonRPCBridge.getState().setCall(fn);
    useDaemonRPCBridge.getState().setCwd('/workspaces/u-xyz');
    expect(useDaemonRPCBridge.getState().call).toBe(fn);
    expect(useDaemonRPCBridge.getState().cwd).toBe('/workspaces/u-xyz');
    useDaemonRPCBridge.getState().setCall(null);
    expect(useDaemonRPCBridge.getState().cwd).toBe('/workspaces/u-xyz');
    useDaemonRPCBridge.getState().setCwd(null);
    expect(useDaemonRPCBridge.getState().call).toBeNull();
  });
});
