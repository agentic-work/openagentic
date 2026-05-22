/**
 * slash-dispatcher — server-side intercept for codemode slash commands.
 *
 * Phase 0 of the codemode-bridge plan (`logical-kindling-horizon.md`):
 *
 * The api relay is now a thin pass-through for slash commands. The
 * openagentic daemon in the user's pod has the REAL handlers via
 * `tryDispatchHeadlessSlashCommand` (see
 * `openagentic/src/cli/headlessSlashDispatch.ts`) — for /help, /agents,
 * /skills, /mcp, /plugin*, /model, /compact, /context, /cost,
 * /permissions, /theme, /plan, /resume, /status, /config, /login,
 * /logout, /btw, plus skill-provided and plugin-provided commands.
 *
 * The api intercepts ONLY two commands that are purely
 * browser-transport concerns:
 *
 *   /exit  — close this WebSocket from the api side. The daemon
 *            doesn't need to know; we just hang up the browser leg.
 *
 *   /clear — emit a synthetic assistant-text frame "Chat cleared."
 *            so the user sees a visual confirmation. Actual transcript
 *            clearing happens in the UI's local store; the daemon's
 *            session is unaffected.
 *
 * Every other input (slash or plain text) returns false → the relay
 * forwards the frame verbatim to the pod.
 *
 * The earlier behaviour — interceptSlashCommand emitting static
 * placeholder text for /help, /skills, /mcp, etc. — was removed
 * because it actively misled users (the responses were paragraphs
 * about UI panels that don't exist). The daemon's real handlers
 * return real data; that's where the work belongs.
 */

import type WebSocket from 'ws';

export interface SlashDispatchContext {
  sessionId: string;
  userId: string;
  browserWs: Pick<WebSocket, 'readyState' | 'send' | 'close'> & {
    readyState: number;
    send: (data: string) => void;
    close?: (code?: number, reason?: string) => void;
  };
  /**
   * Optional pino-shaped logger. When provided, every successful
   * intercept emits one info-level line so live api logs are
   * grep-able evidence the dispatcher fired.
   */
  logger?: { info: (obj: Record<string, unknown>, msg?: string) => void };
}

const LOCAL_HANDLERS: Record<string, 'exit' | 'clear'> = {
  '/exit': 'exit',
  '/clear': 'clear',
};

function uuid(): string {
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return 'sd-' + Math.random().toString(16).slice(2, 10) + '-' + Date.now().toString(16);
}

function sendFrame(ws: SlashDispatchContext['browserWs'], frame: unknown): void {
  if (ws.readyState !== 1 /* OPEN */) return;
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // best-effort; connection may have closed
  }
}

/**
 * Emit a minimal assistant-text turn — message_start through `result` —
 * so the browser's stream reducer renders it as if the daemon spoke.
 * Used only for /clear today.
 */
function emitTextTurn(text: string, ctx: SlashDispatchContext): void {
  const ws = ctx.browserWs;
  const sessionId = ctx.sessionId;
  const messageId = 'msg_' + uuid();
  const turnUuid = uuid();
  const base = { session_id: sessionId, parent_tool_use_id: null as string | null, uuid: turnUuid };

  sendFrame(ws, {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'slash-command',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
    ...base,
  });
  sendFrame(ws, {
    type: 'stream_event',
    event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...base,
  });
  sendFrame(ws, {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    ...base,
  });
  sendFrame(ws, {
    type: 'stream_event',
    event: { type: 'content_block_stop', index: 0 },
    ...base,
  });
  sendFrame(ws, {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 0, output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
    },
    ...base,
  });
  sendFrame(ws, { type: 'stream_event', event: { type: 'message_stop' }, ...base });
  sendFrame(ws, {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1,
    duration_api_ms: 0,
    num_turns: 1,
    result: text,
    session_id: sessionId,
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: Math.max(1, Math.ceil(text.length / 4)),
      server_tool_use: { web_search_requests: 0 },
    },
    modelUsage: {},
    permission_denials: [],
    uuid: turnUuid,
  });
}

/**
 * Extract the leading `/<cmd>` token from raw text or a JSON-envelope
 * `{type:'user', message:{role:'user', content:'/foo bar'}}` frame.
 * Returns null when the input doesn't start with a slash command we
 * could possibly intercept.
 */
function extractCommand(text: string): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  // JSON envelope first.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const content = parsed?.message?.content;
      if (typeof content === 'string' && content.startsWith('/')) {
        return splitCmd(content);
      }
      if (Array.isArray(content)) {
        const first = content.find((b: any) => b && typeof b.text === 'string');
        if (first && first.text.startsWith('/')) return splitCmd(first.text);
      }
      return null;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('/')) return splitCmd(trimmed);
  return null;
}

function splitCmd(line: string): string {
  const t = line.trim();
  const m = /^(\/[A-Za-z0-9_\-]+)/.exec(t);
  return m ? m[1] : t.split(/\s+/, 1)[0];
}

/**
 * Returns true ONLY for /exit and /clear. Caller (relay-ws.handler.ts
 * `browserWs.on('message', ...)`) skips the pod-forward when true and
 * forwards as-is when false.
 */
export function interceptSlashCommand(text: string, ctx: SlashDispatchContext): boolean {
  const cmd = extractCommand(text);
  if (!cmd) return false;
  const handler = LOCAL_HANDLERS[cmd];
  if (!handler) return false;

  ctx.logger?.info(
    { event: 'slash_intercept', cmd, sessionId: ctx.sessionId, userId: ctx.userId },
    'codemode slash intercepted (local-only)',
  );

  if (handler === 'clear') {
    emitTextTurn('Chat cleared. (Local browser transcript reset; daemon session unchanged.)', ctx);
    return true;
  }

  // /exit
  emitTextTurn('Session closed. Reconnect to start a new chat.', ctx);
  try {
    ctx.browserWs.close?.(1000, 'user invoked /exit');
  } catch {
    // best-effort
  }
  return true;
}

/** Exported for the slash-validator harness. */
export const LOCAL_INTERCEPTED_COMMANDS: ReadonlyArray<string> = Object.keys(LOCAL_HANDLERS);
