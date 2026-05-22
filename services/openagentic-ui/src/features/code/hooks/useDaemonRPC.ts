import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/** Single pending RPC entry — the resolver/rejector for a Promise. */
interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  /** Cleanup handle for the 30s timeout so onResponse can cancel it. */
  timeoutId: ReturnType<typeof setTimeout>;
}

/** Shape of an incoming daemon_response frame, as delivered by the WS owner. */
export interface DaemonResponseFrame {
  request_id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface UseDaemonRPCReturn {
  /**
   * Issue a daemon RPC. Generates a uuid request_id, fires the
   * `daemon_request` frame via sendWsFrame, and returns a Promise that
   * resolves with the daemon's `result` payload (typed as the caller's `T`).
   */
  call: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
  /**
   * Forward an incoming daemon_response frame. Looks up the matching
   * pending entry and resolves/rejects it. Unknown request_ids are
   * silently ignored — the daemon may emit responses for requests that
   * were already cleaned up (e.g. timeout, unmount).
   */
  onResponse: (frame: DaemonResponseFrame) => void;
}

/** Default time before a pending RPC rejects with a timeout error. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Hook factory: wraps a `sendWsFrame` callable to provide a typed RPC
 * surface. The hook owns a pendings ref-map (mutated; not React state)
 * because resolving a Promise is a fire-and-forget side effect — the
 * map's contents have no UI consequence.
 */
export function useDaemonRPC(
  sendWsFrame: (frame: Record<string, unknown>) => void,
): UseDaemonRPCReturn {
  const pendingsRef = useRef<Map<string, Pending>>(new Map());

  const call = useCallback(
    <T = unknown>(
      method: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      const request_id = generateRequestId();
      return new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const entry = pendingsRef.current.get(request_id);
          if (!entry) return;
          pendingsRef.current.delete(request_id);
          reject(new Error(`daemon_request timeout: ${method}`));
        }, DEFAULT_TIMEOUT_MS);

        pendingsRef.current.set(request_id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timeoutId,
        });

        sendWsFrame({
          type: 'daemon_request',
          request_id,
          method,
          args,
        });
      });
    },
    [sendWsFrame],
  );

  const onResponse = useCallback((frame: DaemonResponseFrame): void => {
    const entry = pendingsRef.current.get(frame.request_id);
    if (!entry) return;
    pendingsRef.current.delete(frame.request_id);
    clearTimeout(entry.timeoutId);
    if (frame.ok) {
      entry.resolve(frame.result);
    } else {
      entry.reject(new Error(frame.error ?? 'daemon error'));
    }
  }, []);

  // Reject every pending on unmount so consumers don't hang. The WS
  // owner that mounts this hook will also tear it down on session
  // change; both paths funnel through here.
  useEffect(() => {
    return () => {
      const map = pendingsRef.current;
      for (const entry of map.values()) {
        clearTimeout(entry.timeoutId);
        entry.reject(new Error('daemon RPC channel closed'));
      }
      map.clear();
    };
  }, []);

  return { call, onResponse };
}

// ────────────────────────────────────────────────────────────────────
// React context — exposes `call` to deeply-nested consumers (pickers).
//
// useCodeModeChat owns the WS and the RPC hook; it wraps the message
// tree in `<DaemonRPCContext.Provider value={rpc}>`. SkillsPicker /
// PluginsPicker / MCPPicker (Slices 1/2/3) call `useDaemonRPC()` (the
// context-consuming convenience hook below) to access `call`.
//
// Pickers don't need `onResponse` — the WS owner routes incoming
// frames into the hook directly. We expose it on the context shape
// anyway so the same context can also serve future use cases without
// a breaking change.
// ────────────────────────────────────────────────────────────────────

export const DaemonRPCContext = createContext<UseDaemonRPCReturn | null>(null);

/**
 * Convenience hook for picker components — reads the RPC surface from
 * the context provider mounted by the chat view. Throws when used
 * outside a provider so misuse fails loudly.
 */
export function useDaemonRPCContext(): UseDaemonRPCReturn {
  const ctx = useContext(DaemonRPCContext);
  if (!ctx) {
    throw new Error('useDaemonRPCContext used outside a DaemonRPCContext.Provider');
  }
  return ctx;
}

/**
 * Generate a unique request_id. Prefers `crypto.randomUUID()` when
 * available (modern browsers + jsdom 22+); falls back to a Math.random
 * string in environments that lack the WebCrypto API. The id only needs
 * to be unique within a single browser session — the daemon echoes it
 * verbatim in the response.
 */
function generateRequestId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
