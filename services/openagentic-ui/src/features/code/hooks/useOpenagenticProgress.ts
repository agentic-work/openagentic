/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * useOpenagenticProgress — consume the Phase 3 structured-events side
 * channel from openagentic-exec.
 *
 * Architecture (top to bottom):
 *
 *   browser            <- this hook
 *      │   WebSocket
 *      ▼
 *   /api/code/ws/progress?sessionId=&token=
 *      │   (proxied through nginx)
 *      ▼
 *   openagentic-manager /ws/progress
 *      │   (1:1 proxy, no translation)
 *      ▼
 *   openagentic-exec    /ws/progress/:id
 *      │   (tails the openagentic pino log)
 *      ▼
 *   ~/.openagentic/logs/openagentic-${pid}.jsonl
 *      │   (file written by openagentic CLI as it runs)
 *      ▼
 *   The interactive Ink TUI rendering inside the xterm.js panel
 *
 * The xterm.js terminal channel runs in parallel and is unchanged —
 * this hook only adds the structured event overlay. If the progress
 * connection fails the terminal still works, just without the
 * floating tool cards.
 *
 * Event filtering: the openagentic-exec daemon already filters the
 * pino log down to tool/api events before forwarding. We do a second
 * pass here to discard the api_query/api_success spam that would
 * otherwise create one card per LLM call (too noisy for the user).
 * The card overlay only cares about tool execution events.
 */

import { useEffect, useRef } from 'react';
import { create } from 'zustand';

// =============================================================================
// Event types — match the shape forwarded by progressTail.ts
// =============================================================================

/**
 * One row from openagentic's pino log, post-filter. Field names follow
 * openagentic's logEvent() conventions exactly so we can pattern-match
 * on `event` to know which schema applies.
 */
export interface OpenagenticProgressEvent {
  event: string;
  time?: string;
  level?: number;
  /** Tool name as registered in openagentic (e.g. "Bash", "Edit", "Write"). */
  tool_name?: string;
  /** Tool use id from the assistant turn — pairs start/end events. */
  tool_use_id?: string;
  /** Pre-rendered duration when the event represents a completion. */
  durationMs?: number;
  /** Free-form passthrough for any other field. */
  [key: string]: unknown;
}

export type ProgressConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

/**
 * One in-flight tool call, tracked while we're waiting for its
 * completion event. Used by the floating card UI to render
 * "currently running" state.
 */
export interface InFlightTool {
  toolUseId: string;
  toolName: string;
  startedAt: number;
}

/**
 * One completed tool call, retained briefly for the "card animates
 * out" exit transition. Cards older than RECENT_RETENTION_MS are
 * pruned by the next event tick.
 */
export interface RecentTool {
  toolUseId: string;
  toolName: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  ok: boolean;
  reason?: string;
}

interface ProgressStore {
  connectionState: ProgressConnectionState;
  /** Map keyed by tool_use_id of currently running tools. */
  inFlight: Map<string, InFlightTool>;
  /** Bounded list of recently-completed tools, newest last. */
  recent: RecentTool[];
  /** Last error event observed (cleared on next tool start). */
  lastError: string | null;
  /** Internal action: set connection state. */
  _setConnectionState: (state: ProgressConnectionState) => void;
  /** Internal action: handle a parsed event from the wire. */
  _ingest: (event: OpenagenticProgressEvent) => void;
  /** Reset state — used on session change / unmount. */
  _reset: () => void;
}

/** How long completed tools stick around in `recent` (ms). */
const RECENT_RETENTION_MS = 4_000;
/** Max number of recent tools retained at once. */
const RECENT_MAX = 12;

export const useProgressStore = create<ProgressStore>((set, get) => ({
  connectionState: 'idle',
  inFlight: new Map(),
  recent: [],
  lastError: null,
  _setConnectionState: (state) => set({ connectionState: state }),
  _ingest: (event) => {
    const name = event.event;
    if (!name) return;

    // Tool started — openagentic logs `agw_tool_use_can_use_tool_allowed`
    // when the permission gate clears, which is the closest thing to
    // "tool is about to run." Some paths use `agw_tool_use_progress`
    // for in-flight progress beats; we treat both as "in flight."
    if (
      name === 'agw_tool_use_can_use_tool_allowed' ||
      name === 'agw_tool_use_progress'
    ) {
      const toolUseId = event.tool_use_id as string | undefined;
      const toolName = event.tool_name as string | undefined;
      if (!toolUseId || !toolName) return;
      set((s) => {
        const next = new Map(s.inFlight);
        if (!next.has(toolUseId)) {
          next.set(toolUseId, {
            toolUseId,
            toolName,
            startedAt: Date.now(),
          });
        }
        return { inFlight: next, lastError: null };
      });
      return;
    }

    // Tool completed (success or error) — move from inFlight to recent.
    if (
      name === 'agw_tool_use_success' ||
      name === 'agw_tool_use_error' ||
      name === 'agw_tool_use_cancelled'
    ) {
      const toolUseId = event.tool_use_id as string | undefined;
      if (!toolUseId) return;
      const ok = name === 'agw_tool_use_success';
      const reason =
        name !== 'agw_tool_use_success'
          ? (typeof event.reason === 'string' ? event.reason : undefined) ??
            (typeof event.message === 'string' ? event.message : undefined) ??
            (name === 'agw_tool_use_cancelled' ? 'cancelled' : 'error')
          : undefined;

      set((s) => {
        const inFlight = new Map(s.inFlight);
        const inflight = inFlight.get(toolUseId);
        inFlight.delete(toolUseId);

        const completed: RecentTool = {
          toolUseId,
          toolName: inflight?.toolName ?? (event.tool_name as string) ?? 'Tool',
          startedAt: inflight?.startedAt ?? Date.now(),
          endedAt: Date.now(),
          durationMs:
            (event.durationMs as number | undefined) ??
            (inflight ? Date.now() - inflight.startedAt : 0),
          ok,
          reason,
        };

        const now = Date.now();
        const recent = [...s.recent, completed]
          .filter((t) => now - t.endedAt < RECENT_RETENTION_MS)
          .slice(-RECENT_MAX);

        return {
          inFlight,
          recent,
          lastError: ok ? s.lastError : reason ?? 'tool error',
        };
      });
      return;
    }

    // File mutation event (`agw_file_changed`) — useful as a passive
    // signal that an Edit/Write actually wrote bytes. Doesn't need
    // its own card; the success event already produces one.
  },
  _reset: () =>
    set({
      connectionState: 'idle',
      inFlight: new Map(),
      recent: [],
      lastError: null,
    }),
}));

// =============================================================================
// Convenience selectors
// =============================================================================

export const useProgressConnectionState = () =>
  useProgressStore((s) => s.connectionState);

export const useInFlightTools = () => useProgressStore((s) => s.inFlight);

export const useRecentTools = () => useProgressStore((s) => s.recent);

export const useProgressLastError = () => useProgressStore((s) => s.lastError);

// =============================================================================
// The hook itself
// =============================================================================

interface UseOpenagenticProgressOptions {
  /** Session id to subscribe to. When null, the hook idles. */
  sessionId: string | null;
  /** Auth token to pass to the WebSocket query string. */
  token: string;
  /** User id (matches the terminal channel auth model). */
  userId: string;
  /** Optional override for the WebSocket URL prefix. */
  wsUrl?: string;
}

/**
 * Open and maintain a WebSocket connection to /api/code/ws/progress.
 * Auto-reconnects with exponential backoff. Stops when sessionId
 * becomes null. Side-effect-only — components should read the parsed
 * state from useInFlightTools / useRecentTools.
 */
export function useOpenagenticProgress({
  sessionId,
  token,
  userId,
  wsUrl,
}: UseOpenagenticProgressOptions): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const setConnectionState = useProgressStore((s) => s._setConnectionState);
  const ingest = useProgressStore((s) => s._ingest);
  const reset = useProgressStore((s) => s._reset);

  useEffect(() => {
    if (!sessionId) {
      reset();
      return;
    }

    const baseUrl =
      wsUrl ?? `${window.location.origin.replace(/^http/, 'ws')}/api/code/ws/progress`;

    let cancelled = false;
    const MAX_RECONNECT_ATTEMPTS = 8;

    const connect = () => {
      if (cancelled) return;
      const params = new URLSearchParams({ sessionId, token, userId });
      const url = `${baseUrl}?${params.toString()}`;
      setConnectionState('connecting');

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        reconnectAttemptsRef.current = 0;
        setConnectionState('open');
        // Optional keepalive every 30s — matches the terminal channel
        // pattern so the same proxy timeouts apply.
        const keepalive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'keepalive' }));
          } else {
            clearInterval(keepalive);
          }
        }, 30_000);
        // Stash on the WS so the close handler can clear it
        (ws as unknown as { _keepalive?: ReturnType<typeof setInterval> })._keepalive = keepalive;
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(typeof evt.data === 'string' ? evt.data : '');
          // Two envelope types: the daemon's progress_init handshake,
          // and the per-event records from the pino tail. We dispatch
          // pino events through the store; init messages we ignore
          // (just used by the daemon to confirm the channel opened).
          if (parsed && typeof parsed === 'object') {
            if (parsed.type === 'progress_init') return;
            if (typeof parsed.event === 'string') {
              ingest(parsed as OpenagenticProgressEvent);
            }
          }
        } catch {
          // non-JSON line — drop silently
        }
      };

      ws.onclose = () => {
        const ka = (ws as unknown as { _keepalive?: ReturnType<typeof setInterval> })._keepalive;
        if (ka) clearInterval(ka);
        setConnectionState('closed');

        if (cancelled) return;
        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30_000);
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after onerror; do nothing here so we don't
        // double-schedule the reconnect.
        setConnectionState('error');
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      reset();
    };
  }, [sessionId, token, userId, wsUrl, ingest, reset, setConnectionState]);
}
