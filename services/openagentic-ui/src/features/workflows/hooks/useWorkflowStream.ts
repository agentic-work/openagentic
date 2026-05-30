/**
 * useWorkflowStream — Phase E₂.3
 *
 * Thin wrapper around `parseNDJSONStream` for the workflow execution
 * NDJSON endpoint (`GET /api/workflows/executions/:id/stream`). Consumes
 * the same canonical `AgenticStreamEvent` union the chat pipeline
 * produces, plus the flow-specific envelopes
 * (`execution_start / node_start / node_stream / node_complete /
 *  execution_complete`).
 *
 * This hook exists so workflow consumers don't re-roll the fetch +
 * async-iterator dance in every component. The chat's `useChatStream`
 * and this hook share `parseNDJSONStream` (services/openagentic-ui/src/utils/ndjsonStream.ts)
 * — the ONLY difference is which events each hook's switch renders.
 *
 * Note: `workflowApi.ts:executeWorkflow()` still owns the async
 * executeId-handshake + stream-open sequence for back-compat. This hook
 * is the preferred API for new surfaces that want a direct NDJSON feed
 * off a ready-made executionId (e.g. the flow timeline panel, admin
 * execution replays, load-tests).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseNDJSONStream } from '@/utils/ndjsonStream';
import type { AgenticStreamEvent } from '@/types/AnthropicStreamEvent';
import { workflowEndpoint } from '@/utils/api';

/**
 * Flow-specific events not in AgenticStreamEvent (they're platform
 * envelopes wrapping the canonical LLM events).
 */
export type WorkflowFlowEvent =
  | { type: 'execution_start'; executionId: string; [k: string]: unknown }
  | { type: 'execution_complete'; executionId: string; [k: string]: unknown }
  | { type: 'execution_error'; executionId: string; [k: string]: unknown }
  | { type: 'execution_paused'; executionId: string; [k: string]: unknown }
  | { type: 'execution_resumed'; executionId: string; [k: string]: unknown }
  | { type: 'node_start'; nodeId: string; nodeType?: string; [k: string]: unknown }
  | { type: 'node_complete'; nodeId: string; output?: unknown; [k: string]: unknown }
  | { type: 'node_error'; nodeId: string; error?: string; reason?: string; errorMessage?: string; [k: string]: unknown }
  | { type: 'node_retry'; nodeId: string; [k: string]: unknown }
  | { type: 'node_fallback'; nodeId: string; [k: string]: unknown }
  | {
      type: 'node_stream';
      nodeId: string;
      /**
       * Inner canonical event — an AgenticStreamEvent emitted by the
       * LLM running inside this node (Phase E₂.2 / nested format).
       */
      event?: AgenticStreamEvent;
      /**
       * Flat delta — a text chunk to append to the node's streaming buffer
       * (new flat format used by streaming UI layer).
       */
      delta?: string;
      /**
       * Flat fullText — replaces the node's streaming buffer entirely.
       * Takes precedence over delta when both are present.
       */
      fullText?: string;
      [k: string]: unknown;
    }
  | { type: 'keepalive'; [k: string]: unknown }
  | { type: 'connected'; [k: string]: unknown }
  | { type: 'ping'; [k: string]: unknown }
  | { type: 'timeout'; [k: string]: unknown };

export type WorkflowStreamEvent = WorkflowFlowEvent | AgenticStreamEvent;

export interface UseWorkflowStreamOpts {
  executionId: string | null;
  /**
   * Auth headers — re-resolved on every open so a token refresh isn't
   * baked in. Caller is expected to pass their usual getAuthHeaders() fn.
   */
  getAuthHeaders?: () => Record<string, string>;
}

export interface UseWorkflowStreamResult {
  events: WorkflowStreamEvent[];
  isConnected: boolean;
  error: Error | null;
  disconnect: () => void;
  /**
   * Per-node accumulated streaming text. Populated by `node_stream` events
   * (both flat `delta`/`fullText` and nested inner `event` payloads).
   * Cleared when the node emits `node_complete` or `node_error`.
   * Keyed by nodeId.
   */
  streamingText: Record<string, string>;
}

/**
 * Subscribe to an in-flight workflow execution. Emits every event the
 * server sends in NDJSON format — caller's responsibility to render
 * each via a `switch` on `ev.type`.
 */
export function useWorkflowStream(opts: UseWorkflowStreamOpts): UseWorkflowStreamResult {
  const { executionId, getAuthHeaders } = opts;
  const [events, setEvents] = useState<WorkflowStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  // Keep the caller's getAuthHeaders latest without re-triggering the
  // stream effect when they pass a new function reference each render.
  // Without this, inline `() => ({...})` in the caller would tear down
  // and re-open the NDJSON connection on every re-render.
  const authHeadersRef = useRef(getAuthHeaders);
  useEffect(() => {
    authHeadersRef.current = getAuthHeaders;
  }, [getAuthHeaders]);

  const disconnect = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!executionId) {
      disconnect();
      return;
    }

    const url = workflowEndpoint(`/workflows/executions/${executionId}/stream`);
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setEvents([]);
    setStreamingText({});

    (async () => {
      try {
        const headers = authHeadersRef.current ? authHeadersRef.current() : {};
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            ...headers,
            'Accept': 'application/x-ndjson',
          },
          signal: abort.signal,
        });
        setIsConnected(true);

        for await (const ev of parseNDJSONStream<WorkflowStreamEvent>(resp, {
          onParseError: (err, line) => {
            console.warn('[useWorkflowStream] parse error', err, line.slice(0, 80));
          },
        })) {
          setEvents(prev => [...prev, ev]);

          // ── Streaming text accumulation ──────────────────────────────
          if (ev.type === 'node_stream') {
            const nodeId = ev.nodeId;
            const streamEv = ev as Extract<WorkflowFlowEvent, { type: 'node_stream' }>;

            if (typeof streamEv.fullText === 'string') {
              // fullText replaces the buffer for this node
              setStreamingText(prev => ({ ...prev, [nodeId]: streamEv.fullText as string }));
            } else if (typeof streamEv.delta === 'string') {
              // delta appends to the buffer
              setStreamingText(prev => ({ ...prev, [nodeId]: (prev[nodeId] || '') + streamEv.delta }));
            } else if (streamEv.event) {
              // Nested canonical event (Phase E₂.2 format) — extract text_delta
              const inner = streamEv.event as any;
              if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && typeof inner.delta.text === 'string') {
                setStreamingText(prev => ({ ...prev, [nodeId]: (prev[nodeId] || '') + inner.delta.text }));
              }
            }
          } else if (ev.type === 'node_complete') {
            // S3: clear streaming buffer when node completes
            const nodeId = (ev as Extract<WorkflowFlowEvent, { type: 'node_complete' }>).nodeId;
            setStreamingText(prev => {
              if (!(nodeId in prev)) return prev;
              const next = { ...prev };
              delete next[nodeId];
              return next;
            });
          } else if (ev.type === 'node_error') {
            // S4: clear streaming buffer on error (don't show partial text)
            const nodeId = (ev as Extract<WorkflowFlowEvent, { type: 'node_error' }>).nodeId;
            setStreamingText(prev => {
              if (!(nodeId in prev)) return prev;
              const next = { ...prev };
              delete next[nodeId];
              return next;
            });
          }

          if (ev.type === 'execution_complete' || ev.type === 'execution_error' || ev.type === 'timeout') {
            break;
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        setIsConnected(false);
      }
    })();

    return () => disconnect();
    // Only re-open on executionId change — `getAuthHeaders` latest
    // value is read via authHeadersRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionId, disconnect]);

  return { events, isConnected, error, disconnect, streamingText };
}
