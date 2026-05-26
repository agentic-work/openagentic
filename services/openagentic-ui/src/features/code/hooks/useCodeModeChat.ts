import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useCodeModeStore } from '@/stores/useCodeModeStore';
import { summarizeSystemEvent, type SessionMetaShape } from '../chat/sdkAdapter';
import {
  reduce,
  INITIAL_STATE,
  type ChatAction,
  type ChatState,
} from '../state/streamReducer';
import {
  useDaemonRPC,
  type UseDaemonRPCReturn,
} from './useDaemonRPC';
import { classifySlashInput } from './slashIntercept';
import { formatContextUsage } from '../contextUsageFormatter';
import type {
  CanUseToolRequest,
  StreamJsonEvent,
  VdomNode,
} from '../types/_sdk-bindings';
import type { ChatMessage } from '../types/uiState';

interface UseCodeModeChatOptions {
  sessionId: string | null;
  authToken?: string;
}

interface SendMessageOptions {
  model?: string;
  /**
   * Openagentic permission mode for this turn. Forwarded to the exec
   * daemon which translates it to --permission-mode / --permissive CLI
   * flags. See ../permissionMode.ts for the mapping. Defaults to
   * bypassPermissions server-side if unset.
   */
  permissionMode?: string;
  /**
   * Base64-encoded image attachments for vision-capable models. Each
   * image is sent as a content block alongside the text in the
   * stream-json user message. Non-vision models ignore them.
   */
  images?: Array<{ name: string; mediaType: string; base64: string }>;
}

interface UseCodeModeChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string, opts?: SendMessageOptions) => Promise<void>;
  clear: () => void;
  /**
   * Interrupt the in-flight turn without clearing the transcript.
   * Sends control_request{interrupt} over the WS and dispatches an
   * `interrupt` action that closes the in-flight assistant with a
   * marker so the user sees where the turn was cut off.
   */
  cancel: () => void;
  /**
   * Current pending permission request from openagentic. Non-null
   * when a `control_request` with subtype `can_use_tool` has arrived
   * on the stream and the user hasn't yet responded. Rendered by the
   * PermissionDialog component in CodeModeChatView. Cleared on
   * approve/deny via respondToPermission.
   *
   * Phase F (codemode-permanent-plan §4): the augmented shape carries
   * an optional `parent_tool_use_id` lifted off the daemon's
   * control_request envelope. When present, the UI mounts the
   * `InlinePermissionCard` inside the matching subagent panel rather
   * than at the assistant message tail (see
   * MessageTree.AssistantMessageBody routing). Optional + null-default
   * keeps single-agent flows unchanged.
   */
  pendingPermission:
    | (CanUseToolRequest & {
        request_id: string;
        parent_tool_use_id?: string | null;
      })
    | null;
  /**
   * Approve or deny a pending permission prompt. Writes a matching
   * control_response frame back to the exec daemon's stdin via
   * the persistent WS. `updatedInput` lets the user modify the tool's
   * arguments before approval (e.g. narrowing a Bash command). Clears
   * `pendingPermission` on send.
   */
  respondToPermission: (
    decision:
      | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
      | { behavior: 'deny'; message?: string; interrupt?: boolean },
  ) => Promise<void>;
  /**
   * Send an arbitrary control frame to openagentic's stdin. Used by
   * cancel() for interrupt requests and by respondToPermission for
   * can_use_tool responses. Most callers should use the higher-level
   * helpers instead of calling this directly.
   */
  sendControl: (frame: Record<string, unknown>) => Promise<void>;
  /**
   * Current session context-window usage. Populated from the latest
   * result-event usage.input_tokens (since openagentic uses --continue,
   * each turn's input_tokens = total context at that moment).
   * undefined until the first turn completes.
   */
  contextTokens: number | undefined;
  /**
   * Briefly non-null when a compact boundary arrives (system event
   * with subtype: 'compact_boundary'). Lets the header strip flash a
   * "compacted" pulse animation. Reset to null after ~2 seconds.
   */
  compactionFlash: 'manual' | 'auto' | null;
  /** Model name reported by openagentic's system init event. */
  model: string | undefined;
  /** Fast-mode state reported by openagentic's system init event. */
  fastMode: string | undefined;
  /** Accumulated session cost across all turns in this browser session. */
  totalCostUsd: number;
  /** Total output tokens emitted in the session. */
  totalOutputTokens: number;
  /** Duration (ms) of the most recent turn. */
  lastTurnMs: number | undefined;
  /**
   * Session metadata from openagentic's system init event. Shape lives in
   * `chat/sdkAdapter.ts::SessionMetaShape` so both the reducer and the
   * UI consume a single canonical definition (Phase C: no inline drift).
   *
   * `budgetCapUsd` semantics: null means "no cap" (admin opted into
   * unlimited); undefined means we haven't received system/init yet.
   * The metadata strip renders em-dash for both — never $5.
   */
  sessionMeta: SessionMetaShape | null;
  /**
   * Phase E (codemode-permanent-plan §4) — per-viewId mounted ink-DOM
   * UIs from `local-jsx` slash-command dispatch. Keyed by viewId; each
   * value carries the latest vdom snapshot (mutated in place by
   * `ui_patch` ops). The chat view feeds this into
   * `InkDomViewContext` so `InkDomView` instances can resolve their
   * vdom by id. Empty object until the user types a slash command
   * that resolves to a JSX picker.
   */
  inkDomViews: Record<string, { vdom: VdomNode }>;
  /**
   * Phase E — emit a `ui_event` frame back to the daemon for a given
   * mounted ink-DOM view. Called by `InkDomView` when the user
   * presses a key, clicks, or focuses/blurs a rendered node. The hook
   * owns the WS lifecycle; this function builds the frame and writes
   * it via `sendWsFrame`.
   */
  sendUiEvent: (
    viewId: string,
    nodeId: string,
    kind: 'key' | 'click' | 'focus' | 'blur',
    payload: Record<string, unknown>,
  ) => void;
  /**
   * Slice 1 of the codemode native React pickers plan — current picker
   * overlay state. `null` when no picker is active. Set when the user
   * types `/skills` (intercepted in sendMessage). The CodeModeChatView
   * renders the matching picker overlay.
   */
  activePicker: 'skills' | 'mcp' | 'plugins' | 'model' | 'agents' | null;
  /** Dismiss any active picker — wraps `dispatch({ type:'close_picker' })`. */
  closePicker: () => void;
  /**
   * Daemon RPC surface — wired by `useDaemonRPC`. Exposed so the chat
   * view can mount it under `<DaemonRPCContext.Provider>` for picker
   * components to consume via `useDaemonRPCContext`.
   */
  daemonRPC: UseDaemonRPCReturn;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build the WebSocket URL for the chat channel via the API proxy.
 * v0.6.7 codemode is v2-only; the route is fixed as
 * `/api/code/v2/ws/chat`.
 */
async function buildChatWsUrl(
  sessionId: string,
  authToken?: string,
  _backend: 'chat-pipeline-direct' = 'chat-pipeline-direct',
): Promise<string> {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const qs = new URLSearchParams();
  qs.set('sessionId', sessionId);
  if (authToken) qs.set('token', authToken);
  return `${proto}//${host}/api/code/v2/ws/chat?${qs.toString()}`;
}

// Persist/restore chat transcript in localStorage so navigating
// away and back doesn't lose the conversation. Keyed by sessionId.
const STORAGE_PREFIX = 'cm-chat:';

function loadPersistedMessages(sid: string | null): ChatMessage[] {
  if (!sid) return [];
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sid);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistMessages(sid: string | null, msgs: ChatMessage[]) {
  if (!sid) return;
  try {
    // Persist EVERY message. Freeze any streaming flags in the
    // snapshot so a reload mid-turn restores cleanly even if the
    // CLI never emitted the result event that would close the turn.
    const safe = msgs.map((m) => {
      if (m.role !== 'assistant') return m;
      const am = m as any;
      const frozenBlocks = Array.isArray(am.blocks)
        ? am.blocks.map((b: any) => (b && b.streaming ? { ...b, streaming: false } : b))
        : am.blocks;
      return { ...am, streaming: false, blocks: frozenBlocks };
    });
    localStorage.setItem(STORAGE_PREFIX + sid, JSON.stringify(safe));
  } catch {
    /* quota exceeded — degrade silently */
  }
}

function loadPersistedMeta(
  sid: string | null,
): { model?: string; contextTokens?: number; sessionMeta?: any } {
  if (!sid) return {};
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sid + ':meta');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistMeta(sid: string | null, data: Record<string, unknown>) {
  if (!sid) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + sid + ':meta', JSON.stringify(data));
  } catch {}
}

/**
 * Build the initial reducer state from any persisted localStorage data.
 * Called once on mount — subsequent sessionId changes flow through a
 * `restore` action.
 */
function buildInitialState(sessionId: string | null): ChatState {
  const persisted = loadPersistedMessages(sessionId);
  const persistedMeta = loadPersistedMeta(sessionId);
  return {
    ...INITIAL_STATE,
    messages: persisted,
    model: (persistedMeta.model as string | undefined) ?? INITIAL_STATE.model,
    contextTokens:
      (persistedMeta.contextTokens as number | undefined) ?? INITIAL_STATE.contextTokens,
    sessionMeta: (persistedMeta.sessionMeta as any) ?? null,
  };
}

export function useCodeModeChat({
  sessionId,
  authToken,
}: UseCodeModeChatOptions): UseCodeModeChatReturn {
  console.log('[useCodeModeChat] HOOK CALLED', { sessionId, hasAuth: !!authToken });

  // Phase C: a single useReducer drives every state transition.
  // The reducer is pure; the hook is responsible for IO + impure
  // side effects (timeouts, fetches, dispatching actions wrapping
  // wire frames received over the WS).
  const [state, dispatch] = useReducer(reduce, sessionId, buildInitialState);

  const {
    messages,
    error,
    contextTokens,
    compactionFlash,
    model,
    fastMode,
    totalCostUsd,
    totalOutputTokens,
    lastTurnMs,
    pendingPermission,
    sessionMeta,
    streamingMessageId,
    inkDomViews,
    activePicker,
  } = state;

  // Derived: streaming state is "is there an in-flight assistant id?"
  // — single source of truth, no boolean to drift out of sync.
  const isStreaming = streamingMessageId !== null;

  // ── Persistence effect ───────────────────────────────────────────
  // Persist messages to localStorage. Debounce while streaming so we
  // don't thrash on every delta, but always persist on quiescence.
  useEffect(() => {
    if (!isStreaming) {
      persistMessages(sessionId, messages);
      return;
    }
    const handle = setTimeout(() => persistMessages(sessionId, messages), 750);
    return () => clearTimeout(handle);
  }, [messages, isStreaming, sessionId]);

  useEffect(() => {
    persistMeta(sessionId, { model, contextTokens, sessionMeta });
  }, [model, contextTokens, sessionMeta, sessionId]);

  // Restore session transcript on sessionId change (covers Chat→Code,
  // Flows→Code, logout→login). Skip first mount because buildInitialState
  // already seeded from persistence.
  const prevSidRef = useRef<string | null>(sessionId);
  useEffect(() => {
    if (prevSidRef.current === sessionId) return;
    prevSidRef.current = sessionId;
    const restored = loadPersistedMessages(sessionId);
    const restoredMeta = loadPersistedMeta(sessionId);
    dispatch({
      type: 'restore',
      messages: restored,
      meta: {
        model: restoredMeta.model as string | undefined,
        contextTokens: restoredMeta.contextTokens as number | undefined,
        sessionMeta: (restoredMeta.sessionMeta as any) ?? null,
      },
    });
  }, [sessionId]);

  // Clear the compaction flash after 2s so the pulse animation doesn't
  // stick on. Sub-second feels like a glitch; longer feels broken.
  useEffect(() => {
    if (!compactionFlash) return;
    const t = setTimeout(() => dispatch({ type: 'clear_compaction_flash' }), 2000);
    return () => clearTimeout(t);
  }, [compactionFlash]);

  // Codemode v2 backend selector.
  const backend = useCodeModeStore((s) => s.backend);
  const setBackend = useCodeModeStore((s) => s.setBackend);

  // Persistent WS to exec pod.
  const wsRef = useRef<WebSocket | null>(null);
  const pendingFramesRef = useRef<string[]>([]);
  // Reconnect plumbing — chat WS drops on idle proxy timeouts (1005/1006)
  // and on transient pod-side hiccups. Without auto-reconnect the next
  // sendMessage queues into pendingFramesRef forever and the placeholder
  // "Agent is working…" never clears. Mirrors useCodeModeWebSocket's
  // exponential-backoff scheme but lives here because this hook owns the
  // chat WS lifecycle.
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsCancelledRef = useRef<boolean>(false);
  // Holds the (re)open function so onclose can call it without forming a
  // closure over a stale WebSocket variable. Set by the WS-open effect.
  const openWsRef = useRef<(() => void) | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 8;

  /**
   * Send a WS text frame. Queues if the socket isn't open yet.
   * Never throws — WS errors surface via onerror/onclose.
   */
  const sendWsFrame = useCallback((frame: Record<string, unknown>): void => {
    const payload = JSON.stringify(frame);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      return;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      pendingFramesRef.current.push(payload);
      return;
    }
    pendingFramesRef.current.push(payload);
  }, []);

  // Slice 1 of the codemode native React pickers plan — daemon RPC for
  // pickers (SkillsPicker today; PluginsPicker / MCPPicker in slices
  // 2/3). The hook owns the WS, so it owns the RPC. The chat view
  // mounts `daemonRPC` under `<DaemonRPCContext.Provider>` for picker
  // components to consume.
  const daemonRPC = useDaemonRPC(sendWsFrame);

  // Parity-fix 2026-04-30 — outstanding /reload-plugins and /compact
  // control_request request_ids. Map keyed by request_id → kind so that
  // when a `control_response` arrives we can shape the system row that
  // surfaces the result. The reducer's `control_response` branch only
  // knows about can_use_tool permission responses; correlating these
  // intercept-driven responses lives here on the impure side because
  // the system row needs `genId('sys-resp')` and `Date.now()`.
  const pendingControlRequestsRef = useRef<
    Map<string, 'reload_plugins' | 'compact' | 'get_context_usage'>
  >(new Map());

  /**
   * Process a single NDJSON record arriving from the exec pod.
   * Phase C: this is now a thin wrapper that dispatches the wire frame
   * to the reducer plus handles two impure side effects (system-message
   * inline injection via genId, exec-envelope error→setError).
   *
   * Slice 1 of the codemode native React pickers plan: route
   * `daemon_response` frames to the useDaemonRPC correlator instead of
   * the reducer (the reducer doesn't model them — they're a non-stream
   * RPC channel that lives alongside the SDKMessage stream).
   */
  const processRecord = useCallback(
    (record: StreamJsonEvent | { type: string; [k: string]: unknown }): void => {
      // daemon_response: route to the RPC correlator. Pickers (SkillsPicker
      // / PluginsPicker / MCPPicker) call `daemonRPC.call(method, args)`,
      // which writes a daemon_request and waits for the matching response
      // here. Bypasses the reducer entirely.
      if ((record as { type: string }).type === 'daemon_response') {
        const frame = record as unknown as {
          request_id: string;
          ok: boolean;
          result?: unknown;
          error?: string;
        };
        daemonRPC.onResponse(frame);
        return;
      }

      // Parity-fix 2026-04-30 — control_response correlation for the
      // /reload-plugins and /compact intercepts. If the response's
      // request_id matches one we tracked at sendMessage time, build a
      // human-readable system row from the response payload and inject
      // it before falling through to the reducer's permission-only
      // control_response branch.
      if ((record as { type: string }).type === 'control_response') {
        const frame = record as unknown as {
          response?: {
            subtype?: string;
            request_id?: string;
            response?: Record<string, unknown>;
            error?: string;
          };
        };
        const reqId = frame.response?.request_id;
        const kind = reqId ? pendingControlRequestsRef.current.get(reqId) : undefined;
        if (reqId && kind) {
          pendingControlRequestsRef.current.delete(reqId);
          const resp = frame.response ?? {};
          let text: string;
          if (resp.subtype === 'error') {
            const errMsg = typeof resp.error === 'string' ? resp.error : 'control request failed';
            text =
              kind === 'reload_plugins'
                ? `/reload-plugins failed: ${errMsg}`
                : kind === 'compact'
                  ? `/compact failed: ${errMsg}`
                  : `/context failed: ${errMsg}`;
          } else if (kind === 'reload_plugins') {
            const r = (resp.response ?? {}) as {
              commands?: unknown[];
              agents?: unknown[];
              plugins?: unknown[];
              mcpServers?: unknown[];
              error_count?: number;
            };
            const parts: string[] = [];
            if (Array.isArray(r.plugins)) parts.push(`${r.plugins.length} plugins`);
            if (Array.isArray(r.commands)) parts.push(`${r.commands.length} commands`);
            if (Array.isArray(r.agents)) parts.push(`${r.agents.length} agents`);
            if (Array.isArray(r.mcpServers)) parts.push(`${r.mcpServers.length} MCP servers`);
            const summary = parts.length > 0 ? parts.join(' · ') : 'reload complete';
            const errs = typeof r.error_count === 'number' && r.error_count > 0
              ? ` (${r.error_count} errors)`
              : '';
            text = `Reloaded plugins: ${summary}${errs}`;
          } else if (kind === 'compact') {
            const r = (resp.response ?? {}) as {
              summary?: string;
              displayText?: string;
              userDisplayMessage?: string;
              originalCount?: number;
              compactedCount?: number;
            };
            if (typeof r.summary === 'string' && r.summary.length > 0) {
              text = `Compacted: ${r.summary}`;
            } else if (typeof r.displayText === 'string' && r.displayText.length > 0) {
              text = r.displayText;
            } else if (typeof r.userDisplayMessage === 'string' && r.userDisplayMessage.length > 0) {
              text = `Compacted: ${r.userDisplayMessage}`;
            } else if (
              typeof r.originalCount === 'number' &&
              typeof r.compactedCount === 'number'
            ) {
              text = `Compacted ${r.originalCount} messages → ${r.compactedCount}`;
            } else {
              text = 'Conversation compacted.';
            }
          } else {
            // get_context_usage — daemon returns a ContextData payload;
            // formatContextUsage renders a one-screen markdown table
            // (model, total/max tokens, percentage, per-category
            // breakdown). See formatContextUsage tests for the shape.
            text = formatContextUsage(
              (resp.response ?? {}) as Parameters<typeof formatContextUsage>[0],
            );
          }
          dispatch({
            type: 'system_message_inject',
            id: genId('sys-resp'),
            text,
            createdAt: Date.now(),
          });
          // Fall through so the reducer's permission-clear logic still runs
          // for any other state it tracks (defensive, no-op when reqId
          // doesn't match pendingPermission).
        }
      }

      // Mid-turn system events render as inline italic system rows. The
      // reducer doesn't generate the id (impure), so the hook injects.
      if (record.type === 'system') {
        const summary = summarizeSystemEvent(record as any);
        if (summary) {
          dispatch({
            type: 'system_message_inject',
            id: genId('sys'),
            text: summary,
            createdAt: Date.now(),
          });
        }
        // Then dispatch the wire event so the reducer captures init/
        // compact_boundary state.
        dispatch({ type: 'event', event: record as StreamJsonEvent });
        return;
      }

      // All other wire frames: dispatch to the reducer.
      dispatch({ type: 'event', event: record as StreamJsonEvent });
    },
    [daemonRPC],
  );

  /**
   * Fetch the admin-selected codemode v2 backend from
   * `/api/openagentic/config` and cache it in the store.
   */
  useEffect(() => {
    if (backend !== null) return;
    if (!authToken) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/openagentic/config', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (cancelled) return;
        if (!resp.ok) {
          console.warn(
            '[useCodeModeChat] /api/openagentic/config fetch failed',
            resp.status,
            '— defaulting to v2',
          );
        }
        if (!cancelled) setBackend('chat-pipeline-direct');
      } catch (err) {
        console.warn(
          '[useCodeModeChat] /api/openagentic/config fetch threw',
          err,
          '— defaulting to v2',
        );
        if (!cancelled) setBackend('chat-pipeline-direct');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken, backend, setBackend]);

  /**
   * Open the persistent chat WS when sessionId becomes available.
   *
   * Reconnect contract: ws.onclose() calls openWsRef.current() with
   * exponential backoff when the close was NOT initiated by the
   * effect cleanup (which sets wsCancelledRef = true and code 1000).
   */
  useEffect(() => {
    if (!sessionId) {
      console.log('[useCodeModeChat] WS effect: no sessionId, skip');
      return;
    }
    if (backend === null) {
      console.log('[useCodeModeChat] WS effect: backend unresolved, waiting');
      return;
    }
    wsCancelledRef.current = false;
    reconnectAttemptsRef.current = 0;

    const openWs = () => {
      if (wsCancelledRef.current) return;
      (async () => {
        const url = await buildChatWsUrl(sessionId, authToken, backend);
        if (wsCancelledRef.current) return;
        console.log('[useCodeModeChat] WS effect: opening', {
          backend,
          attempt: reconnectAttemptsRef.current,
          url: url.replace(/token=[^&]+/, 'token=***'),
        });
        const ws = new WebSocket(url);
        wsRef.current = ws;
        attachWsHandlers(ws);
      })();
    };
    openWsRef.current = openWs;
    openWs();

    return () => {
      wsCancelledRef.current = true;
      openWsRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      try {
        ws?.close(1000, 'component unmount');
      } catch {}
      if (wsRef.current === ws) wsRef.current = null;
      pendingFramesRef.current = [];
    };
  }, [sessionId, authToken, backend]);

  // Extract WS handler attachment so the async URL-build wrapper can
  // hook them once the socket is created.
  const attachWsHandlers = useCallback(
    (ws: WebSocket) => {
      ws.onopen = () => {
        // Successful open — reset reconnect attempts so future drops
        // start fresh from a 1s backoff.
        reconnectAttemptsRef.current = 0;
        const pending = pendingFramesRef.current;
        pendingFramesRef.current = [];
        for (const payload of pending) {
          try {
            ws.send(payload);
          } catch {
            /* keep going */
          }
        }
        // Browser→api keepalive — every 25s so intermediate proxies don't
        // RST the half-connection while the model is thinking.
        const ka = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send('{"type":"keepalive"}\n');
            } catch {
              /* tolerant */
            }
          }
        }, 25_000);
        (ws as unknown as { _keepalive?: ReturnType<typeof setInterval> })._keepalive = ka;
      };

      ws.onmessage = (event) => {
        const raw = typeof event.data === 'string' ? event.data : '';
        if (!raw) return;
        // Drop relay keepalive heartbeat frames silently.
        if (raw.length < 80 && /"type"\s*:\s*"keepalive"/.test(raw)) return;
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          console.warn('[useCodeModeChat] WS frame parse failed', err, raw.slice(0, 200));
          return;
        }
        // Exec-envelope frames: `{type: '_exec', kind: ...}`.
        if (parsed && parsed.type === '_exec') {
          if (parsed.kind === 'error' && parsed.message) {
            console.warn('[useCodeModeChat] exec envelope error', parsed.message);
            dispatch({ type: 'set_error', message: parsed.message });
          }
          return;
        }
        processRecord(parsed as StreamJsonEvent);
      };

      ws.onerror = (err) => {
        console.error('[useCodeModeChat] WS error', err);
        dispatch({ type: 'set_error', message: 'chat socket error' });
      };

      ws.onclose = (event) => {
        const ka = (ws as unknown as { _keepalive?: ReturnType<typeof setInterval> })
          ._keepalive;
        if (ka) clearInterval(ka);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        // Mark any in-flight assistant turn as ended so the UI doesn't
        // spin forever.
        dispatch({ type: 'connection_closed', code: event.code });

        // Auto-reconnect on transient drops. Skip when the effect
        // cleanup initiated the close (component unmount or sessionId
        // change — wsCancelledRef set + code 1000) or when we've burned
        // through the attempt budget (surface a permanent error).
        if (wsCancelledRef.current) return;
        if (event.code === 1000) return;
        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          dispatch({
            type: 'set_error',
            message: `Chat connection lost — reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Reload to retry.`,
          });
          return;
        }
        const attempt = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempt;
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
        console.log(
          `[useCodeModeChat] WS closed code=${event.code} — reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
        );
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (wsCancelledRef.current) return;
          openWsRef.current?.();
        }, delay);
      };
    },
    [processRecord],
  );

  const clear = useCallback(() => {
    // Sweep any orphaned slash-intercept request IDs alongside the
    // transcript reset. If the daemon never responds (pod kill mid-RPC)
    // these would otherwise leak across /clear into the next exchange's
    // expected response set.
    pendingControlRequestsRef.current.clear();
    dispatch({ type: 'clear' });
  }, []);

  const sendControl = useCallback(
    async (frame: Record<string, unknown>): Promise<void> => {
      if (!sessionId) return;
      sendWsFrame(frame);
    },
    [sessionId, sendWsFrame],
  );

  const respondToPermission = useCallback(
    async (
      decision:
        | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
        | { behavior: 'deny'; message?: string; interrupt?: boolean },
    ): Promise<void> => {
      const pending = pendingPermission;
      if (!pending) return;
      const responseBody =
        decision.behavior === 'allow'
          ? {
              behavior: 'allow',
              updatedInput: decision.updatedInput ?? pending.input ?? {},
              toolUseID: pending.tool_use_id,
            }
          : {
              behavior: 'deny',
              message: decision.message ?? 'User denied',
              interrupt: decision.interrupt,
              toolUseID: pending.tool_use_id,
            };
      const frame = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: pending.request_id,
          response: responseBody,
        },
      };
      dispatch({ type: 'permission_response', requestId: pending.request_id });
      await sendControl(frame);
    },
    [pendingPermission, sendControl],
  );

  const cancel = useCallback(() => {
    if (sessionId) {
      sendWsFrame({
        type: 'control_request',
        request_id: `int-${Date.now().toString(36)}`,
        request: { subtype: 'interrupt' },
      });
    }
    dispatch({ type: 'interrupt', markerCreatedAt: Date.now() });
  }, [sessionId, sendWsFrame]);

  /**
   * Phase E — send a `ui_event` frame to the daemon for an inline
   * `local-jsx` slash-command UI. Build the frame in the canonical
   * shape (matches `UiEventFrame` from `@agentic-work/openagentic-sdk/vdom`)
   * and write it over the chat WS. The daemon's WS handler routes it
   * to the matching mount handle's `dispatch()`, which fires the
   * `useInput` / `useFocus` subscribers on the React tree.
   */
  const sendUiEvent = useCallback(
    (
      viewId: string,
      nodeId: string,
      kind: 'key' | 'click' | 'focus' | 'blur',
      payload: Record<string, unknown>,
    ) => {
      sendWsFrame({
        type: 'ui_event',
        viewId,
        nodeId,
        kind,
        payload,
      });
    },
    [sendWsFrame],
  );

  const sendMessage = useCallback(
    async (text: string, opts: SendMessageOptions = {}): Promise<void> => {
      const { model: turnModel, permissionMode, images } = opts;
      if (!sessionId) {
        dispatch({ type: 'set_error', message: 'No active session' });
        return;
      }
      if (isStreaming) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      // Slash classification — pure helper in `slashIntercept.ts` returns
      // either a picker decision (open the native React overlay), a
      // control_request decision (write a daemon control frame), or
      // 'forward' (fall through to the user-text path).
      //
      // Pickers (Slice 1+ of the codemode native React pickers plan):
      //   /skills, /plugin(s), /model, /mcp, /agents
      //
      // Control-request bridges (parity-fix 2026-04-30):
      //   /reload-plugins → daemon's `reload_plugins` control_request
      //     (cli/print.ts:3167). Sending as user prompt would forward to
      //     the LLM (hallucinated reply) because the slash command sets
      //     `supportsNonInteractive:false`.
      //   /compact [args] → daemon's `compact` control_request. The slash
      //     dispatcher returns a "rerun in interactive REPL to view"
      //     placeholder because it can't stub a full ToolUseContext; the
      //     control_request path uses the agent loop's live context so
      //     compactConversation actually runs.
      const intercept = classifySlashInput(trimmed);
      if (intercept.kind === 'picker') {
        dispatch({ type: 'open_picker', picker: intercept.picker });
        return;
      }
      if (intercept.kind === 'control_request') {
        // Echo the user's typed slash command into the transcript so they
        // see what they sent — without this the input box clears with no
        // visible record. Use a synthetic system message instead of a
        // user message so it doesn't get LLM-attributed.
        const requestId = genId('cr');
        const echoId = genId('sys');
        dispatch({
          type: 'system_message_inject',
          id: echoId,
          text: `Sent ${trimmed}`,
          createdAt: Date.now(),
        });
        // Track the request_id so when the daemon responds we can build a
        // result-shaped system row (see processRecord control_response
        // branch). Map cleared per-id on response receipt; orphan entries
        // don't accumulate because the daemon ALWAYS responds (success or
        // error) — pod-die is the only edge that strands an entry, and
        // the next session-clear or hook-remount sweeps the ref.
        pendingControlRequestsRef.current.set(requestId, intercept.subtype);
        const requestPayload: Record<string, unknown> = {
          subtype: intercept.subtype,
        };
        if (intercept.subtype === 'compact' && intercept.args) {
          requestPayload.args = intercept.args;
        }
        sendWsFrame({
          type: 'control_request',
          request_id: requestId,
          request: requestPayload,
        });
        return;
      }

      const userMsgId = genId('user');
      const asstMsgId = genId('asst');

      dispatch({
        type: 'submit_user',
        userMsgId,
        asstMsgId,
        text: trimmed,
        createdAt: Date.now(),
      });

      sendWsFrame({
        type: 'user',
        message: { role: 'user', content: trimmed },
        ...(turnModel ? { model: turnModel } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(images && images.length > 0 ? { images } : {}),
      });
    },
    [sessionId, isStreaming, sendWsFrame],
  );

  // Slice 1 — convenience helper for the chat view.
  const closePicker = useCallback(() => {
    dispatch({ type: 'close_picker' });
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clear,
    cancel,
    contextTokens,
    compactionFlash,
    model,
    fastMode,
    totalCostUsd,
    totalOutputTokens,
    lastTurnMs,
    pendingPermission,
    respondToPermission,
    sendControl,
    sessionMeta,
    inkDomViews,
    sendUiEvent,
    activePicker,
    closePicker,
    daemonRPC,
  };
}
