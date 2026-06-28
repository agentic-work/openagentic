/**
 * useSubagentStream — Phase E₂.3
 *
 * Thin wrapper for the admin sub-agent debugging endpoint
 * `POST /api/orchestrate/stream/canonical`. Emits the canonical
 * `AgenticStreamEvent` union (same types the chat stream emits) stamped
 * with `_agentId` / `_seq` / `_runId` / `_ts` by `EventSequencer.child()`
 * on the server. Consumers demultiplex multi-agent streams by
 * grouping on `_agentId`.
 *
 * Sister hook: `useWorkflowStream` (same backing util
 * `parseNDJSONStream`, different endpoint + different event mix).
 * Sister hook: `useChatStream` (identical AgenticStreamEvent vocabulary).
 *
 * Phase E₂.3 contract: all three hooks share `parseNDJSONStream` as the
 * single wire-parsing implementation — no custom per-surface parsers.
 * Different hooks only differ in:
 *   1. Which endpoint URL they fetch.
 *   2. Which event shapes their switch-statement renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseNDJSONStream, type NDJSONEvent } from '@/utils/ndjsonStream';
import type { AgenticStreamEvent } from '@/types/AnthropicStreamEvent';

/** Event with the server-added sequencer metadata. */
export type SubagentStreamEvent = AgenticStreamEvent & {
  _agentId?: string;
  _seq?: number;
  _runId?: string;
  _ts?: number;
};

export interface UseSubagentStreamOpts {
  /**
   * Endpoint URL to POST to. Typically
   * `/api/orchestrate/stream/canonical` but exposed as a prop so
   * customer forks that re-host the admin endpoint can redirect.
   */
  endpointUrl: string;
  /**
   * Request body. The `/canonical` endpoint expects
   * `{ request: string, availableTools?: string[] }`.
   */
  body: { request: string; availableTools?: string[] } | null;
  /**
   * Auth headers — resolved on every open so token refresh works.
   */
  getAuthHeaders?: () => Record<string, string>;
}

export interface UseSubagentStreamResult {
  events: SubagentStreamEvent[];
  /** Events grouped by `_agentId` for easy per-agent rendering. */
  eventsByAgent: Map<string, SubagentStreamEvent[]>;
  isConnected: boolean;
  error: Error | null;
  start: () => void;
  stop: () => void;
}

/**
 * Subscribe to a sub-agent orchestration NDJSON stream. The hook does
 * NOT auto-start — call `start()` when ready (typical pattern: on
 * button click). `stop()` aborts the fetch.
 */
export function useSubagentStream(opts: UseSubagentStreamOpts): UseSubagentStreamResult {
  const { endpointUrl, body, getAuthHeaders } = opts;
  const [events, setEvents] = useState<SubagentStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const eventsByAgentRef = useRef<Map<string, SubagentStreamEvent[]>>(new Map());
  const [eventsByAgent, setEventsByAgent] = useState<Map<string, SubagentStreamEvent[]>>(new Map());

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const start = useCallback(() => {
    if (!body) return;
    stop();
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setEvents([]);
    eventsByAgentRef.current = new Map();
    setEventsByAgent(new Map());

    (async () => {
      try {
        const resp = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/x-ndjson',
            ...(getAuthHeaders ? getAuthHeaders() : {}),
          },
          body: JSON.stringify(body),
          signal: abort.signal,
        });
        setIsConnected(true);

        // SubagentStreamEvent = AgenticStreamEvent & {…} — the AgenticStreamEvent
        // base is a closed discriminated union with no index signature, so it
        // doesn't satisfy parseNDJSONStream's `T extends NDJSONEvent` constraint.
        // Intersecting with NDJSONEvent adds the index signature — type-only, no
        // runtime change.
        for await (const ev of parseNDJSONStream<SubagentStreamEvent & NDJSONEvent>(resp, {
          onParseError: (err, line) => {
            console.warn('[useSubagentStream] parse error', err, line.slice(0, 80));
          },
        })) {
          setEvents(prev => [...prev, ev]);
          const agentId = ev._agentId;
          if (agentId) {
            const map = eventsByAgentRef.current;
            const existing = map.get(agentId) ?? [];
            existing.push(ev);
            map.set(agentId, existing);
            // Copy the ref into state so React can see the change.
            setEventsByAgent(new Map(map));
          }
          if (ev.type === 'error') break;
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        setIsConnected(false);
      }
    })();
  }, [endpointUrl, body, getAuthHeaders, stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { events, eventsByAgent, isConnected, error, start, stop };
}
