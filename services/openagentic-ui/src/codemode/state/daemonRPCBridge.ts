import { create } from 'zustand';

/** Generic call signature matching `UseDaemonRPCReturn['call']` from
 * `services/openagentic-ui/src/features/code/hooks/useDaemonRPC.ts`. */
export type DaemonCall = <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;

interface DaemonRPCBridgeState {
  /** Active call function, or null when no codemode WS is up. */
  call: DaemonCall | null;
  /** Producer setter — CodeModeChatView calls this on mount/update, null on unmount. */
  setCall: (next: DaemonCall | null) => void;
  /** User-scoped workspace path (e.g., /workspaces/<userId>), or null when no session. */
  cwd: string | null;
  /** Producer setter — CodeModeChatView writes sessionMeta.cwd, null on unmount. */
  setCwd: (cwd: string | null) => void;
}

export const useDaemonRPCBridge = create<DaemonRPCBridgeState>((set) => ({
  call: null,
  setCall: (next) => {
    if (typeof window !== 'undefined' && (window as unknown as { __cmDebug?: boolean }).__cmDebug !== false) {
      // eslint-disable-next-line no-console
      console.log('[A15-bridge] setCall:', next ? typeof next : null);
    }
    set({ call: next });
  },
  cwd: null,
  setCwd: (cwd) => {
    if (typeof window !== 'undefined' && (window as unknown as { __cmDebug?: boolean }).__cmDebug !== false) {
      // eslint-disable-next-line no-console
      console.log('[A15-bridge] setCwd:', cwd);
    }
    set({ cwd });
  },
}));

// A.15 TEMP DEBUG — expose the bridge to window so we can read live state
// from Playwright. Will be removed after diagnostics confirm the fix.
if (typeof window !== 'undefined') {
  (window as unknown as { __codemodeBridge?: typeof useDaemonRPCBridge }).__codemodeBridge = useDaemonRPCBridge;
}

/** Selector hook for consumers — returns the current call function or null. */
export const useDaemonRPCBridgeCall = (): DaemonCall | null =>
  useDaemonRPCBridge((s) => s.call);

/** Selector hook for consumers — returns the current user-scoped cwd or null. */
export const useDaemonRPCBridgeCwd = (): string | null =>
  useDaemonRPCBridge((s) => s.cwd);
