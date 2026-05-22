/**
 * Stream Handler for Chat API — NDJSON wire format.
 *
 * Emits one typed JSON object per line on /api/chat/stream. The wire
 * shape is `{type: "<eventName>", ...payload}\n` for every event. Clients
 * parse with `for (const line of buffer.split("\n")) JSON.parse(line)` —
 * no SSE `event:` / `data:` state machine, no `\n\n` delimiter.
 *
 * Content-Type is always `application/x-ndjson`. SSE was removed in
 * v0.6.6 (see `docs/releases/0.6.6/blockers/BLOCKER-004-*.md`). The prior
 * translator-based opt-in was broken by per-field .write() ordering and
 * left every payload without its `.type` field — the UI silently dropped
 * every delta and the user saw an empty bubble until they reloaded.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../../middleware/unifiedAuth.js';
import { ChatRequest } from '../interfaces/chat.types.js';
import { isPersistableInlineFrame } from './persistableInlineFrames.js';
// Track B Phase 7 (chatmode canonical rip): server consumes the SAME pure
// reducer the UI uses. Persistence shape ≡ live render shape by construction.
// The legacy server-only `contentBlocksAccumulator.ts` has been deleted.
import {
  consumeWireFrame,
  initialFrameState,
  type FrameState,
  type UIContentBlock,
} from '@agentic-work/llm-sdk';
import { stripArtifactJsonLeak } from '../pipeline/stripArtifactJsonLeak.js';
import type {
  RunChatDeps,
  RunChatInput,
} from '../pipeline/chat/types.js';
import { runChat } from '../pipeline/chat/runChat.js';
import { featureFlags } from '../../../config/featureFlags.js';
import { isUserLocked, analyzeMessageScope, recordScopeViolation } from '../../../services/ScopeEnforcementService.js';
import { EventSequencer } from '../../../infra/event-sequencer.js';
import { writeNDJSON, writeNDJSONDurable, ndjsonHeaders } from '../../../infra/ndjson.js';
import { maybeEmitWireCapture } from '../../../infra/wireCapture.js';
import { getStreamRingBuffer } from '../../../services/StreamRingBuffer.js';
import { registerActiveTurn, publishFrame, unregisterActiveTurn } from './stream-tail.registry.js';
import { getAgentEventStore } from '../../../services/AgentEventStore.js';
import { trackChatMessage, chatResponseTime } from '../../../metrics/index.js';
import { getProviderManager } from '../../../services/llm-providers/ProviderManager.js';
import { hydrateFileReferences, type FileRef } from './hydrateFileReferences.js';
import { BlobStorageService } from '../../../services/BlobStorageService.js';
import { getChatLoopConfigService } from '../../../services/ChatLoopConfigService.js';

// Re-export for any existing import site that pulled writeNDJSON from here.
export { writeNDJSON };

/**
 * Error response interface for frontend
 */
interface SanitizedError {
  code: string;
  message: string;
  retryable: boolean;
  isAdmin?: boolean;
  stage?: string;
  technicalDetails?: string;
  recommendations?: string[];
  timestamp?: string;
}

/**
 * Get default recommendations based on error stage/type
 */
function getDefaultRecommendations(stage: string, errorCode: string): string[] {
  const recommendations: Record<string, string[]> = {
    'completion': [
      'Check if the LLM provider is reachable',
      'Verify API keys in System Settings',
      'Check provider rate limits'
    ],
    'mcp': [
      'Verify MCP Proxy is running: docker logs openagentic-mcp-proxy',
      'Check MCP server configuration in mcp_servers.yaml',
      'Restart MCP Proxy: docker restart openagentic-mcp-proxy'
    ],
    'auth': [
      'Check Azure AD configuration',
      'Verify token expiration',
      'Check user permissions'
    ],
    'RATE_LIMIT_EXCEEDED': [
      'Wait 30-60 seconds before retrying',
      'Check provider rate limits in admin settings',
      'Consider switching to a different model'
    ],
    'NETWORK_ERROR': [
      'Check network connectivity to provider endpoints',
      'Verify firewall rules allow outbound HTTPS',
      'Check DNS resolution for provider domains'
    ],
    'MODEL_UNAVAILABLE': [
      'Verify model deployment in provider console',
      'Check model name/version in configuration',
      'Try an alternative model'
    ]
  };

  return recommendations[stage] || recommendations[errorCode] || [
    'Check system logs for more details',
    'Contact platform administrator if issue persists'
  ];
}

/**
 * Sanitize error messages for frontend consumption
 * Admins get detailed technical information, regular users get friendly messages
 */
/**
 * Extract a brief, user-readable error message from a raw error string.
 * Strips stack traces, object dumps, and technical noise.
 */
function extractBriefError(errorMessage: string): string {
  // Strip "Unhandled error. ({" wrapper and everything after
  let brief = errorMessage.replace(/^Unhandled error\.\s*\(?\{[\s\S]*/m, '').trim();

  // Look for the actual error message in common patterns
  const patterns = [
    /message:\s*['"]([^'"]+)['"]/,
    /INSTANT FAILURE.*?:\s*(.+?)(?:\n|$)/,
    /Ollama API error:\s*(.+?)(?:\n|$)/,
    /Bedrock.*?error[:\s]*(.+?)(?:\n|$)/i,
    /Error:\s*(.+?)(?:\n|$)/,
  ];
  for (const p of patterns) {
    const m = brief.match(p) || errorMessage.match(p);
    if (m) return m[1].trim().substring(0, 150);
  }

  // Just take the first line, cap at 150 chars
  const firstLine = (brief || errorMessage).split('\n')[0].trim();
  return firstLine.substring(0, 150) || 'Unknown error';
}

function sanitizeErrorForFrontend(error: any, isAdmin: boolean = false, stage?: string): SanitizedError {
  // Map of error patterns to user-friendly messages
  const errorPatterns = [
    {
      pattern: /rate limit|quota|throttl/i,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait a moment and try again.',
      retryable: true
    },
    {
      pattern: /timeout|timed out/i,
      code: 'REQUEST_TIMEOUT',
      message: 'The request took too long. Please try again.',
      retryable: true
    },
    {
      pattern: /authentication|unauthorized|401/i,
      code: 'AUTHENTICATION_ERROR',
      message: 'Authentication failed. Please sign in again.',
      retryable: false
    },
    {
      pattern: /not found|404/i,
      code: 'RESOURCE_NOT_FOUND',
      message: 'The requested resource was not found.',
      retryable: false
    },
    {
      pattern: /invalid.*argument|bad request|400/i,
      code: 'INVALID_REQUEST',
      message: 'Invalid request. Please check your input and try again.',
      retryable: false
    },
    {
      pattern: /network|connection|ECONNREFUSED|ENOTFOUND/i,
      code: 'NETWORK_ERROR',
      message: 'Network connection issue. Please check your connection and try again.',
      retryable: true
    },
    {
      pattern: /No.*chat-capable models available|No.*tool-capable models available/i,
      code: 'NO_CAPABLE_MODELS',
      message: 'No models available that can handle this request. Add a capable model (e.g., Claude, GPT-4o, qwen3.5) via Admin > LLM Providers.',
      retryable: false
    },
    {
      pattern: /does not support tools/i,
      code: 'MODEL_NO_TOOL_SUPPORT',
      message: 'The selected model does not support tool calling. Try switching to a different model or set the Smart Router slider higher to use a more capable model.',
      retryable: true
    },
    {
      pattern: /model.*not.*found|model.*unavailable/i,
      code: 'MODEL_UNAVAILABLE',
      message: 'The AI model is currently unavailable. Please try again later or select a different model.',
      retryable: true
    },
    {
      pattern: /Ollama API error.*400/i,
      code: 'OLLAMA_MODEL_ERROR',
      message: 'The local Ollama model returned an error. This usually means the model cannot handle this type of request (e.g., tool calls, large context). Try using a cloud model or adjusting the Smart Router slider.',
      retryable: true
    },
    {
      pattern: /No models available from any provider/i,
      code: 'NO_MODELS_AVAILABLE',
      message: 'No AI models are available. Please configure at least one LLM provider in Admin > LLM Providers.',
      retryable: false
    },
    {
      pattern: /cost.*cap|daily.*limit|budget.*exceeded/i,
      code: 'COST_CAP_EXCEEDED',
      message: 'The daily cost limit has been reached for this model. Try using a more economical model or wait until tomorrow.',
      retryable: false
    },
    {
      pattern: /context.*window|context.*length|too many tokens|max.*tokens.*exceeded/i,
      code: 'CONTEXT_OVERFLOW',
      message: 'Your conversation exceeds the model\'s context window. Try starting a new chat or using a model with a larger context window.',
      retryable: false
    },
    {
      pattern: /tool.*execution|function.*call/i,
      code: 'TOOL_EXECUTION_ERROR',
      message: 'A tool execution error occurred. Please try rephrasing your request.',
      retryable: true
    },
    {
      pattern: /mcp.*proxy|mcp.*server|mcp.*failed/i,
      code: 'MCP_ERROR',
      message: 'An MCP tool server error occurred. The tool may be temporarily unavailable.',
      retryable: true
    },
    {
      pattern: /azure.*cost|cost.*management|subscription.*not.*found/i,
      code: 'AZURE_COST_ERROR',
      message: 'Azure Cost Management query failed. Check your permissions or date range.',
      retryable: true
    },
    {
      pattern: /date.*range.*exceed|time.*period.*invalid|1.*year/i,
      code: 'INVALID_DATE_RANGE',
      message: 'The date range specified is invalid or exceeds the maximum allowed period.',
      retryable: false
    },
    {
      pattern: /thinking.*not.*support|does not support thinking/i,
      code: 'THINKING_NOT_SUPPORTED',
      message: 'The selected model does not support extended thinking. Chat continues normally.',
      retryable: true
    },
    {
      pattern: /bedrock|inference.*profile|invocation.*not.*supported/i,
      code: 'BEDROCK_MODEL_ERROR',
      message: 'AWS Bedrock model invocation error. Check model configuration.',
      retryable: true
    },
    {
      pattern: /Failed to parse URL|baseUrl.*not.*configured|OLLAMA.*not.*configured/i,
      code: 'PROVIDER_CONFIG_ERROR',
      message: 'LLM provider not configured correctly. Check provider settings in Admin > LLM Providers.',
      retryable: false
    },
    {
      pattern: /No.*providers.*initialized|No.*providers.*configured/i,
      code: 'NO_PROVIDERS_ERROR',
      message: 'No LLM providers are configured. Add providers in Admin > LLM Providers.',
      retryable: false
    },
    {
      pattern: /unique.*constraint|duplicate.*key|session.*creation.*failed|P2002/i,
      code: 'SESSION_ERROR',
      message: 'Session creation failed. Please refresh the page and start a new chat.',
      retryable: true
    },
    {
      pattern: /prisma|database|sql|postgres/i,
      code: 'DATABASE_ERROR',
      message: 'A database error occurred. Please try again in a moment.',
      retryable: true
    }
  ];

  const errorMessage = error?.message || String(error);
  const errorCode = error?.code || 'UNKNOWN_ERROR';

  // SPECIAL CASE: Scope violations should preserve their custom message
  // These are APPLICATION-LEVEL enforcement messages that are user-friendly
  if (errorCode === 'SCOPE_VIOLATION' || error?.blockedByScope === true) {
    return {
      code: 'SCOPE_VIOLATION',
      message: errorMessage, // Preserve the formatted violation message
      retryable: false,
      stage: 'validation'
    };
  }

  // Find matching error pattern
  let matchedPattern = null;
  for (const pattern of errorPatterns) {
    if (pattern.pattern.test(errorMessage) || pattern.pattern.test(errorCode)) {
      matchedPattern = pattern;
      break;
    }
  }

  // Build base response with stage-specific fallback messages
  const stageFriendlyName: Record<string, string> = {
    validation: 'request validation',
    auth: 'authentication',
    prompt: 'prompt preparation',
    mcp: 'tool discovery',
    completion: 'AI response generation',
    response: 'response formatting',
    pipeline: 'request processing',
    stream: 'response streaming'
  };

  const response: SanitizedError = matchedPattern
    ? {
        code: matchedPattern.code,
        message: matchedPattern.message,
        retryable: matchedPattern.retryable
      }
    : {
        code: stage ? `${stage.toUpperCase()}_ERROR` : 'PROCESSING_ERROR',
        message: stage && stageFriendlyName[stage]
          ? `Error during ${stageFriendlyName[stage]}: ${extractBriefError(errorMessage)}. Try again or switch models.`
          : `Error: ${extractBriefError(errorMessage)}. Try again or switch models.`,
        retryable: true
      };

  // For admin users, include technical details and recommendations
  if (isAdmin) {
    response.isAdmin = true;
    response.stage = stage || 'unknown';
    response.technicalDetails = errorMessage;
    response.recommendations = getDefaultRecommendations(stage || '', response.code);
    response.timestamp = new Date().toISOString();

    // Include stack trace for admins (first few lines only)
    if (error?.stack) {
      const stackLines = error.stack.split('\n').slice(0, 5).join('\n');
      response.technicalDetails += `\n\nStack trace:\n${stackLines}`;
    }
  }

  return response;
}

export interface StreamRequest extends AuthenticatedRequest {
  body: {
    message: string;
    sessionId: string;
    model?: string;
    promptTechniques?: string[];
    attachments?: Array<{
      originalName: string;
      mimeType: string;
      size: number;
      data: string;
    }>;
    files?: Array<{
      name: string;
      type: string;
      content: string;
      size?: number;
    }>;
    toolCalls?: any[];
    responseFormat?: any;
    // P1 #940 (2026-05-18) — per-turn grounding T1 opt-in flag from the
    // chat-input-toolbar SearchCheck toggle. When true the system prompt
    // gets a one-line addendum instructing the model to invoke web_search
    // and emit a final verdict line. Defaults false → no behavior change.
    groundingEnabled?: boolean;
  };
}

/**
 * Active SSE connections tracking for autonomous job notifications
 * Map: sessionId -> Set of FastifyReply objects
 */
const activeConnections = new Map<string, Set<FastifyReply>>();

/**
 * Broadcast job completion event to all active SSE connections for a session
 */
export function broadcastJobCompletion(params: {
  jobId: string;
  sessionId?: string;
  userId?: string;
  result?: string;
  error?: string;
}): void {
  const { jobId, sessionId, userId, result, error } = params;

  if (!sessionId) {
    return; // No session to broadcast to
  }

  const connections = activeConnections.get(sessionId);
  if (!connections || connections.size === 0) {
    return; // No active connections for this session
  }

  const eventData = {
    jobId,
    status: error ? 'failed' : 'completed',
    result,
    error,
    completedAt: Date.now()
  };

  // Broadcast to all connections as NDJSON
  for (const reply of connections) {
    if (!writeNDJSON(reply, 'job_completed', eventData)) {
      connections.delete(reply);
    }
  }
}

/**
 * Per-request helpers the chat pipeline needs. The handler builds the
 * pipeline input shape from these (model + MCP tools + prior messages) so
 * `runChat` stays generic.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §240. The handler
 * imports `runChat` directly; deps are built once at chatPlugin init (see
 * chat.plugin / routes/chat/index).
 */
export interface ChatStreamHandlerDeps {
  /** Chat pipeline deps — built once at chatPlugin init via buildChatV2Deps. */
  v2Deps: RunChatDeps;
  /**
   * Resolve MCP tools for this request. Per-user RBAC + per-tenant
   * filtering happens here. The full set goes to the model — V2 has NO
   * semantic top-K filter for chat (Plan §117).
   */
  listMcpTools: (
    authHeader: string | undefined,
    userId: string,
  ) => Promise<any[]>;
  /**
   * Resolve the model id for this turn. Wraps SmartModelRouter.pickModel()
   * with admin-tunable cost / latency budgets and FCA-floor escalation.
   * Returning a concrete model string short-circuits the router.
   */
  pickModel: (input: {
    sessionId: string;
    message: string;
    user: any;
    requestedModel?: string;
  }) => Promise<string>;
  /**
   * Optional: load prior conversation turns for this session so the model
   * sees context. When omitted, V2 runs with the current user message
   * only — fine for first-message tests, not for multi-turn UX.
   */
  loadPriorMessages?: (
    sessionId: string,
    userId: string,
  ) => Promise<Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>>;
  /**
   * Optional (Wave 5): persist the incoming user message before the V2
   * pipeline runs. Wired at chatPlugin init from the chatStorage singleton.
   * Errors are swallowed inside the helper so a db blip never aborts the
   * live stream.
   */
  persistUserMessage?: (
    sessionId: string,
    content: string,
    opts: { userId: string; metadata?: Record<string, any> },
  ) => Promise<void>;
  /**
   * Optional (Wave 5): persist the final assistant message after the V2
   * pipeline emits `assistant_message_stop`. Carries the model id +
   * accumulated content text. Errors swallowed.
   */
  persistAssistantMessage?: (
    sessionId: string,
    content: string,
    opts: {
      userId: string;
      model?: string;
      tokenUsage?: any;
      toolNamesUsed?: string[];
      metadata?: Record<string, any>;
      // Persistence Sev-1: inline render frames captured during the V2 turn,
      // forwarded to chatStorage.addMessage so chat_messages.visualizations
      // is populated. Without this widgets vanish on session reload.
      visualizations?: any[];
      // Sev-0 2026-05-08: structured tool fan-out (from tool_executing /
      // tool_result frames). Persisted to chat_messages.tool_calls /
      // tool_results so ToolCallGroup rehydrates on session reload.
      toolCalls?: any[];
      toolResults?: any[];
      // Sev-0 #924/#925/#926: canonical ContentBlock[] chronology for
      // chat_messages.content_blocks. Restores byte-identical rehydration
      // of the post-`done` DOM (every interleaved text block, viz_render,
      // app_render, follow_up chip row, tool input/result correlation).
      contentBlocks?: any[];
    },
  ) => Promise<void>;
  /**
   * OBO PLUMB (LIVE 2026-04-30):
   * Load Azure tokens from DB for Azure-AD users. V2 has no auth
   * stage, so we plumb directly into the stream handler. When this
   * returns fresh tokens, they're attached to
   * `v2Ctx.user.{accessToken,idToken}` and
   * `buildChatV2Deps.makeExecuteMcpTool` injects them as
   * `Authorization: Bearer` + `X-Azure-ID-Token` headers on /mcp/tool.
   * Without this, oap-azure-mcp returns "No user token provided".
   */
  getAzureTokenInfo?: (
    userId: string,
  ) => Promise<{ accessToken: string; idToken?: string; expiresAt: Date | string } | null>;
  /**
   * Companion to getAzureTokenInfo: predicate the handler uses to decide
   * whether to use the loaded token. Mirrors AuthStage.isTokenExpired.
   */
  isTokenExpired?: (expiresAt: Date | string | undefined) => boolean;
}

/**
 * Create stream handler.
 *
 * Wave 4 cutover (Plan §240): the legacy V1 `ChatPipeline` is GONE. Every
 * chat turn now flows through `runChat`, which mirrors Claude Code's
 * QueryEngine main loop:
 *   - static system prompt (legacy 7-section assembler)
 *   - full tool array (~30-40 tools, no semantic top-K)
 *   - tool_choice: 'auto' + ReAct loop until stop_reason === 'end_turn'
 *
 * NDJSON contract preserved: every existing frame type the UI consumes
 * (stream_start, stream, tool_executing, tool_result, thinking_complete,
 * stream_complete, error, agent_progress) is emitted with the same shape.
 * V2-new frames (artifact_render, sub_agent_started/completed, etc.) are
 * additions, not replacements.
 */
export function streamHandler(deps: ChatStreamHandlerDeps, logger: any) {
  return async (request: StreamRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();
    // Event sequencer for gap detection and ordering (v0.5.0). The
    // sequencer's `runId` doubles as the turnId for durable streams
    // (task #154) — it's a fresh UUID per pipeline run and matches
    // the `_runId` field stamped onto every wire frame.
    const sequencer = new EventSequencer();
    const turnId = sequencer.runId;
    // Durable stream ring buffer — every frame emitted on the wire is
    // dual-written into Redis keyed by (sessionId, turnId) so a
    // reconnected client can replay gaps via GET /api/chat/stream/:s/tail.
    const ringBuffer = getStreamRingBuffer(logger);
    let durableSink: ((line: string) => void) | undefined;
    
    try {
      // Validate request
      if (!request.user) {
        return reply.code(401).send({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      if (!request.body.message?.trim()) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_MESSAGE',
            message: 'Message cannot be empty'
          }
        });
      }

      if (!request.body.sessionId?.trim()) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_SESSION',
            message: 'Session ID is required'
          }
        });
      }

      const userId = request.user!.id;

      // ═══════════════════════════════════════════════════════════════════════════
      // SESSION OWNERSHIP CHECK: Verify this session belongs to the requesting user
      // Prevents cross-session message injection.
      //
      // L2-1 five-layer audit fix (2026-05-12): prior code wrapped the lookup
      // in a try/catch whose catch arm logged a warn and proceeded — that let
      // a DB hiccup bypass the security control. Now we hard-fail:
      //   - missing row → 403 SESSION_NOT_OWNED
      //   - DB throws   → 500 SESSION_LOOKUP_FAILED (operator-visible)
      // ═══════════════════════════════════════════════════════════════════════════
      {
        const { prisma: db } = await import('../../../utils/prisma.js');
        const {
          assertSessionOwnership,
          SessionNotOwnedError,
          SessionLookupFailedError,
        } = await import('./assertSessionOwnership.js');
        try {
          await assertSessionOwnership(db, request.body.sessionId.trim(), userId);
        } catch (err) {
          if (err instanceof SessionNotOwnedError) {
            logger.warn({ userId, sessionId: request.body.sessionId }, '[STREAM] Session ownership check failed');
            return reply.code(403).send({
              error: { code: 'SESSION_NOT_OWNED', message: 'Session does not belong to this user' }
            });
          }
          if (err instanceof SessionLookupFailedError) {
            logger.error({ err: err.cause, userId, sessionId: request.body.sessionId }, '[STREAM] Session-ownership DB lookup failed — refusing request');
            return reply.code(500).send({
              error: { code: 'SESSION_LOOKUP_FAILED', message: 'Could not verify session ownership; please retry' }
            });
          }
          throw err;
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // SCOPE ENFORCEMENT: account-lock + topic classifier for non-admin users.
      //
      // [scope-rewire 2026-05-19] Two bugs fixed here:
      //
      // Bug 1 — confidence threshold was 0.7; single off-topic keyword only
      //   reaches 0.6 (0.5 + 0.1×1), so "recipe for chocolate cake", "write me
      //   a poem", etc. were never blocked. Threshold lowered to 0.5 so any
      //   off-topic signal with zero allowed-keyword counterbalance blocks.
      //
      // Bug 2 — violations returned reply.code(400/403).send({error:{...}}).
      //   The UI's !response.ok handler at useChatStream.ts:2472 swallowed the
      //   body and threw a generic "HTTP error! status: 400", so the warning
      //   message was never shown in the chat bubble. Fixed: all enforcement
      //   responses now write 200 NDJSON headers + stream the message as a
      //   `stream` text frame + `stream_complete`, matching the shape the UI
      //   renders as an assistant message.
      //
      // Admin users bypass both checks entirely (isAdmin check is first).
      // ═══════════════════════════════════════════════════════════════════════════
      const isAdmin = request.user?.isAdmin === true;

      if (!isAdmin) {
        // ── 1. Account lock check (admin-manual locks and auto-locks after 4th violation) ──
        const locked = await isUserLocked(userId);
        if (locked) {
          logger.warn({
            userId,
            message: request.body.message.substring(0, 100)
          }, '[SCOPE] Blocked request from locked user');

          // Stream the lockout message as an assistant text frame so the UI
          // renders it in the chat bubble (not as a generic error toast).
          reply.raw.writeHead(200, ndjsonHeaders());
          if (reply.raw.socket) {
            (reply.raw.socket as any).setNoDelay?.(true);
          }
          const lockedMsg = '🔒 **ACCOUNT LOCKED** — Your account has been locked due to repeated policy violations. Please contact your administrator to restore access.';
          writeNDJSON(reply, 'stream', { content: lockedMsg, index: 0 });
          writeNDJSON(reply, 'stream_complete', { success: false, blockedByScope: true, code: 'ACCOUNT_LOCKED' });
          // Sev-0 persist-non-empty-content Bug A: persist the lockout message to
          // chat_messages so session reload shows it instead of an empty bubble.
          if (deps.persistAssistantMessage) {
            try {
              const ts = Date.now();
              await deps.persistAssistantMessage(request.body.sessionId, lockedMsg, {
                userId,
                contentBlocks: [
                  {
                    id: `scope-lock-${ts}`,
                    index: 0,
                    type: 'text',
                    content: lockedMsg,
                    isComplete: true,
                    timestamp: ts,
                  },
                ],
              });
            } catch (persistErr: any) {
              logger.warn({ err: persistErr?.message }, '[STREAM] scope-lock persistAssistantMessage failed (non-blocking)');
            }
          }
          reply.raw.end();
          return;
        }

        // ── 2. Topic classifier: block off-topic messages before they reach the model ──
        const scopeAnalysis = analyzeMessageScope(request.body.message);

        // [scope-rewire] Threshold lowered from 0.7 → 0.5.
        // Single prohibited keyword with zero allowed keywords → confidence=0.6,
        // which was previously below the gate. 0.5 is the base score for
        // "off-topic, no allowed keywords" — any score above that is blockable.
        if (!scopeAnalysis.isInScope && scopeAnalysis.confidence >= 0.5) {
          const violationResult = await recordScopeViolation(userId, scopeAnalysis.reason);

          logger.warn({
            userId,
            message: request.body.message.substring(0, 100),
            scopeReason: scopeAnalysis.reason,
            confidence: scopeAnalysis.confidence,
            warningCount: violationResult.warningCount,
            isLocked: violationResult.isLocked
          }, '[SCOPE] Out-of-scope message detected');

          // Stream the warning/lockout message as an assistant text frame so the
          // UI renders it inline in the chat bubble.
          reply.raw.writeHead(200, ndjsonHeaders());
          if (reply.raw.socket) {
            (reply.raw.socket as any).setNoDelay?.(true);
          }
          writeNDJSON(reply, 'stream', { content: violationResult.message, index: 0 });
          writeNDJSON(reply, 'stream_complete', {
            success: false,
            blockedByScope: true,
            code: violationResult.isLocked ? 'ACCOUNT_LOCKED' : 'SCOPE_VIOLATION',
            warningCount: violationResult.warningCount,
          });
          // Sev-0 persist-non-empty-content Bug A: persist the violation warning to
          // chat_messages so session reload shows it instead of an empty bubble.
          if (deps.persistAssistantMessage) {
            try {
              const ts = Date.now();
              await deps.persistAssistantMessage(request.body.sessionId, violationResult.message, {
                userId,
                contentBlocks: [
                  {
                    id: `scope-violation-${ts}`,
                    index: 0,
                    type: 'text',
                    content: violationResult.message,
                    isComplete: true,
                    timestamp: ts,
                  },
                ],
              });
            } catch (persistErr: any) {
              logger.warn({ err: persistErr?.message }, '[STREAM] scope-violation persistAssistantMessage failed (non-blocking)');
            }
          }
          reply.raw.end();
          return;
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // REGISTRY GUARD (task #6): reject concrete body.model values that
      // aren't in admin.model_role_assignments with enabled=true. Sentinels
      // ('smart-router' / 'auto' / '' / null) flow through to Smart Router
      // unchanged. This is the fix for #293: the selected-model used to be
      // silently swapped by the chat pipeline whenever it wasn't routable
      // through ProviderManager.discoveredCapabilities.
      // ═══════════════════════════════════════════════════════════════════════════
      try {
        const { prisma: guardPrisma } = await import('../../../utils/prisma.js');
        const { resolveRequestedModel } = await import('../../../services/model-routing/RegistryModelGuard.js');
        const requested = request.body.model;
        const resolution = await resolveRequestedModel(requested as any, guardPrisma as any);
        if (resolution.kind === 'not-in-registry') {
          logger.warn({
            userId,
            sessionId: request.body.sessionId,
            requestedModel: resolution.requested,
            availableCount: resolution.availableCount,
          }, '[STREAM] Rejected body.model — not in Registry');
          return reply.code(400).send({
            error: 'ModelNotInRegistry',
            model: resolution.requested,
            availableCount: resolution.availableCount,
            message: `Model "${resolution.requested}" is not enabled in the Model Registry. Either enable it on the Admin Models page or omit body.model to let the Smart Router pick.`,
          });
        }
      } catch (guardErr) {
        // Non-fatal: guard failures (e.g., DB blip) degrade to pre-guard
        // behavior so we don't trade a 400-wall for broken chat.
        logger.warn({ err: guardErr }, '[STREAM] Registry guard failed (non-blocking)');
      }

      // v0.6.6: NDJSON-only. SSE support removed (BLOCKER-004). Every
      // internal stream endpoint shares the same headers via
      // `ndjsonHeaders()` — see `infra/ndjson.ts`. Legacy SSE callers
      // that hit this endpoint still receive the stream, they'll just
      // see `{...}\n` frames instead of `data: {...}\n\n`.
      reply.raw.writeHead(200, ndjsonHeaders());

      // CRITICAL: Flush headers immediately and disable Nagle's algorithm for real-time streaming
      // This ensures SSE events are sent as soon as they're written, not batched
      if (reply.raw.socket) {
        // Disable Nagle's algorithm - send small packets immediately.
        // Guard for socket shapes that lack setNoDelay (e.g. light-my-request
        // mock socket when this handler runs under inject()) — without this
        // the whole stream handler crashes pre-HITL gate (Sev-0 2026-05-08).
        if (typeof reply.raw.socket.setNoDelay === 'function') {
          reply.raw.socket.setNoDelay(true);
        }
        // Disable TCP cork - don't wait to accumulate data
        if (typeof reply.raw.socket.uncork === 'function') {
          reply.raw.socket.uncork();
        }
      }
      // Flush headers to client immediately
      if (typeof reply.raw.flushHeaders === 'function') {
        reply.raw.flushHeaders();
      }

      // Log SSE connection setup for debugging
      const sseDebug = process.env.SSE_DEBUG === 'true';
      if (sseDebug) {
        logger.info({
          sessionId: request.body.sessionId,
          userId: request.user!.id,
          sseConnectionTime: Date.now() - startTime
        }, '[SSE-DEBUG] Connection established');
      }

      // Track this connection for autonomous job notifications
      const sessionId = request.body.sessionId;
      if (!activeConnections.has(sessionId)) {
        activeConnections.set(sessionId, new Set());
      }
      activeConnections.get(sessionId)!.add(reply);

      logger.debug({
        sessionId,
        userId: request.user!.id,
        activeConnectionsCount: activeConnections.get(sessionId)!.size
      }, 'SSE connection registered for autonomous job notifications');

      // Durable-stream registration (task #154). Every frame we write
      // to `reply.raw` from this point on is dual-written into the
      // Redis ring buffer + published to any attached `/tail` listeners.
      // When WIRE_CAPTURE_ENABLED=true, each frame also emits a structured
      // [WIRE-CAPTURE] log line so the chronological wire shape is
      // reconstructible from kubectl logs (CLAUDE.md rule 8(a) diagnostic).
      registerActiveTurn(sessionId, turnId);
      durableSink = (line: string) => {
        // Fire-and-forget: ring buffer and tail listeners MUST NOT
        // stall the live wire. `append` already swallows errors; we
        // wrap publishFrame in a try too for good measure.
        ringBuffer.append(sessionId, turnId, line).catch(() => { /* swallow */ });
        try {
          publishFrame(sessionId, turnId, line);
        } catch { /* swallow */ }
        // Wire-capture diagnostic — gated by env var, default off.
        if (process.env.WIRE_CAPTURE_ENABLED === 'true') {
          try {
            const parsed = JSON.parse(line) as { type?: string; [k: string]: unknown };
            const { type, ...rest } = parsed;
            maybeEmitWireCapture(logger, turnId, type ?? 'unknown', rest);
          } catch { /* swallow malformed lines — diagnostic must never break stream */ }
        }
      };

      // Wire-in B (feature #84): subscribe to the AgentEventStore on
      // this turn's id and re-emit every sub-agent progress event as
      // an `agent_progress` NDJSON frame. The legacy in-api orchestrator
      // / openagentic-proxy publish into the store keyed by `turnId`;
      // this is the point where those cross-process events rejoin
      // the parent chat stream so the UI can render nested sub-agent
      // cards. Unsubscribe on socket close so closed clients don't
      // leak subscribers.
      // HITL event types that must be re-emitted as TOP-LEVEL NDJSON frames
      // (not wrapped in agent_progress). useChatStream.ts:4165 handles
      // 'mcp_approval_required' at the top level — the case is never reached
      // if the frame arrives as an agent_progress wrapper.
      const HITL_TOP_LEVEL_EVENTS = new Set([
        'mcp_approval_required',
        'hitl_approval',
        'mcp_approval_resolved',
      ]);

      const unsubscribeAgentProgress = getAgentEventStore().subscribe(turnId, (ev) => {
        if (HITL_TOP_LEVEL_EVENTS.has(ev.event)) {
          // HITL approval events: re-emit as top-level frames so the UI's
          // inline HITL chip handler (useChatStream case 'mcp_approval_required')
          // can pick them up at the correct position. The payload is forwarded
          // verbatim — openagentic-proxy stamps requestId, toolName, parentToolUseId,
          // riskLevel, reason, timeoutMs, source, timestamp.
          writeNDJSONDurable(reply, ev.event, sequencer.wrap(ev.payload as any), durableSink);
        } else {
          writeNDJSONDurable(reply, 'agent_progress', sequencer.wrap(ev as any), durableSink);
        }
      });
      reply.raw.on('close', unsubscribeAgentProgress);

      // Keepalive ping every 3s. Clients ignore type="ping" lines; the
      // write itself keeps the TCP connection warm + flushes any proxy
      // buffering. Tighter than the 7s Firefox idle-stream timeout.
      const keepAliveInterval = setInterval(() => {
        writeNDJSONDurable(reply, 'ping', { timestamp: new Date().toISOString() }, durableSink);
      }, 3000);

      // AbortController: propagates cancellation to LLM calls, tool executions,
      // and sub-agent spawns when the client disconnects.
      const pipelineAbortController = new AbortController();

      // Handle client disconnect
      request.raw.on('close', () => {
        clearInterval(keepAliveInterval);

        // Abort all in-flight operations for this pipeline run
        if (!pipelineAbortController.signal.aborted) {
          pipelineAbortController.abort(new Error('Client disconnected'));
          logger.info({
            userId: request.user!.id,
            sessionId: request.body.sessionId
          }, 'Client disconnected — pipeline abort signal sent');
        }

        // Remove from active connections
        const connections = activeConnections.get(sessionId);
        if (connections) {
          connections.delete(reply);
          if (connections.size === 0) {
            activeConnections.delete(sessionId);
          }
        }

        logger.info({
          userId: request.user!.id,
          sessionId: request.body.sessionId
        }, 'Client disconnected from stream');
      });

      // Save user message immediately to prevent loss
      // Note: The pipeline will handle message persistence internally
      // This ensures the message is saved even if streaming fails

      // Create chat request
      const authHeader = request.headers.authorization || '';
      const chatRequest: ChatRequest = {
        message: request.body.message.trim(),
        sessionId: request.body.sessionId.trim(),
        model: request.body.model,
        attachments: [],
        toolCalls: request.body.toolCalls,
        responseFormat: request.body.responseFormat,
        rawBearerToken: authHeader.startsWith('Bearer ') ? authHeader.substring(7) : undefined,
      };
      
      // Handle attachments from old format
      if (request.body.attachments && request.body.attachments.length > 0) {
        chatRequest.attachments = request.body.attachments.map((att: any) => ({
          id: att.id || `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          originalName: att.originalName,
          mimeType: att.mimeType,
          size: att.size,
          url: att.url,
          base64Data: att.data || att.base64Data,
          metadata: att.metadata
        }));
      }
      
      // Handle files from new format (from frontend).
      // The UI may send either:
      //   - {id: "file_..."}           — previously uploaded via POST /api/files/upload,
      //                                   we fetch the bytes from MinIO + authorize against userId.
      //   - {name,type,content,size}   — legacy inline base64 path (kept for small-file fallback + tests).
      // hydrateFileReferences normalizes either form to {name,type,content,size}.
      if (request.body.files && request.body.files.length > 0) {
        const { prisma } = await import('../../../utils/prisma.js');
        const blobStorage = new BlobStorageService(logger, { bucket: 'openagentic-uploads' });
        await blobStorage.init();

        let hydrated;
        try {
          hydrated = await hydrateFileReferences(
            request.body.files as FileRef[],
            { userId: request.user!.id, prisma: prisma as any, blobStorage },
          );
        } catch (err: any) {
          logger.warn({
            err: err.message,
            userId: request.user!.id,
            fileCount: request.body.files.length,
          }, '[FILES] Hydration failed');
          // Sev-1 #833 — NDJSON headers were already flushed at line 702 via
          // `reply.raw.writeHead(200, ndjsonHeaders())`. `reply.code().send()`
          // here triggers Fastify's onSendEnd hook → `safeWriteHead` →
          // ERR_HTTP_HEADERS_SENT (unhandled rejection, kills the stream).
          // Mirror the validator path below: write the error as an NDJSON
          // `error` frame on the open raw stream so the UI's useChatStream
          // renders it as an inline error toast.
          const errFrame = JSON.stringify({
            type: 'error',
            data: {
              code: 'FILE_HYDRATION_FAILED',
              message: err.message || 'attachment hydration failed',
              retryable: false,
            },
          });
          reply.raw.write(errFrame + '\n');
          reply.raw.end();
          return;
        }

        chatRequest.attachments = hydrated.map((file, index) => {
          // MIME sniff fallback for clients that still don't set type on inline content.
          let mimeType = file.type;
          if (!mimeType || mimeType === '') {
            const ext = (file.name || '').toLowerCase().split('.').pop();
            const mimeMap: Record<string, string> = {
              'txt': 'text/plain', 'md': 'text/markdown', 'json': 'application/json',
              'csv': 'text/csv', 'xml': 'text/xml', 'html': 'text/html', 'htm': 'text/html',
              'js': 'text/javascript', 'ts': 'text/typescript', 'jsx': 'text/javascript', 'tsx': 'text/typescript',
              'py': 'text/x-python', 'java': 'text/x-java', 'cpp': 'text/x-c++', 'c': 'text/x-c', 'h': 'text/x-c',
              'sh': 'text/x-sh', 'yaml': 'text/yaml', 'yml': 'text/yaml',
              'pdf': 'application/pdf', 'doc': 'application/msword',
              'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
              'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml'
            };
            mimeType = mimeMap[ext || ''] || 'application/octet-stream';
          }

          return {
            id: `file_${Date.now()}_${index}`,
            originalName: file.name || `file_${index}`,
            mimeType,
            size: file.size ?? 0,
            base64Data: file.content,
            metadata: {}
          };
        });

        logger.info({
          userId: request.user!.id,
          fileCount: request.body.files.length,
          attachmentsCreated: chatRequest.attachments.map(att => ({
            id: att.id,
            name: att.originalName,
            type: att.mimeType,
            hasBase64: !!att.base64Data,
            base64Length: att.base64Data?.length,
          }))
        }, 'VISION DEBUG: Processing files in stream request');
      }

      // Per-attachment size + mime gate — surfaces clear 413/415 errors
      // to the user instead of silently sending unsupported binary as a
      // useless data: url to the LLM. See attachmentValidator.ts for the
      // current limit (25 MiB) + supported-type list.
      //
      // The NDJSON headers were flushed at line 680, so reply.code().send()
      // is a no-op here. Emit the error as an NDJSON `error` frame on the
      // open stream instead — UI hooks (useChatStream) already render
      // this frame's `data.message` as a visible toast/inline error.
      if (chatRequest.attachments && chatRequest.attachments.length > 0) {
        const { validateAttachments } = await import('./attachmentValidator.js');
        const valid = validateAttachments(chatRequest.attachments);
        if (valid.ok === false) {
          const failure = valid as { ok: false; status: 413 | 415; message: string };
          logger.warn(
            { userId: request.user!.id, status: failure.status, message: failure.message },
            '[STREAM] Attachment rejected by validator',
          );
          const errFrame = JSON.stringify({
            type: 'error',
            data: {
              code: failure.status === 413 ? 'ATTACHMENT_TOO_LARGE' : 'ATTACHMENT_UNSUPPORTED',
              message: failure.message,
              retryable: false,
            },
          });
          reply.raw.write(errFrame + '\n');
          reply.raw.end();
          return;
        }
      }

      // Let Azure OpenAI's natural streaming rhythm flow through - no artificial buffering
      
      // SSE Debug mode and TTFT tracking
      const sseDebugEnabled = process.env.SSE_DEBUG === 'true';
      let firstContentChunkTime: number | null = null;
      let contentChunkCount = 0;
      let totalContentLength = 0; // Track content length for token estimation
      const pipelineStartTime = Date.now();

      // Wave 5 — accumulate the assistant's streamed text deltas so we can
      // persist the final assistant message after V2 emits
      // assistant_message_stop. Tool names are tracked too so the saved row
      // carries `toolNamesUsed` (kept compatible with V1's persistence shape).
      // Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §272-302.
      let accumulatedAssistantContent = '';
      const toolNamesUsed: string[] = [];

      // Sev-0 (2026-05-21) — stream-emit-path scrub for leaked
      // compose_visual / compose_app tool_use JSON args. Persistence-time
      // scrub already lands in commits ab42fe9b + 374e968a but the live
      // streaming bubble still shows raw JSON for seconds because text_delta
      // frames hit the wire BEFORE persistence runs.
      //
      // Strategy (simpler-alternative from the design): once a compose_*
      // tool_use fires this turn, BUFFER every subsequent assistant text
      // delta instead of emitting it. At end-of-turn (completion_complete /
      // assistant_message_stop / stream_complete), run stripArtifactJsonLeak
      // over the buffered chunk and emit the scrubbed result as a single
      // `stream` + canonical `content_block_delta` pair. Tradeoff: the
      // post-artifact synthesis paragraph no longer streams token-by-token
      // for compose_* turns. The clean-content invariant beats the
      // incremental-stream-feel for this prompt class (per CLAUDE.md rule
      // 8(b) — artifact paths must not leak control args into prose).
      let composeDispatchedInTurn = false;
      let postComposeBuffer = '';
      let postComposeBufferFlushed = false;

      const flushPostComposeBuffer = () => {
        if (postComposeBufferFlushed) return;
        postComposeBufferFlushed = true;
        if (!postComposeBuffer) return;
        const scrubbed = stripArtifactJsonLeak(postComposeBuffer);
        postComposeBuffer = '';
        if (!scrubbed) return;
        try {
          const seqCanonical = sequencer.wrap({
            delta: { type: 'text_delta', text: scrubbed },
          });
          writeNDJSONDurable(reply, 'content_block_delta', seqCanonical, durableSink);
        } catch (flushErr: any) {
          logger.warn(
            { err: flushErr?.message },
            '[STREAM] post-compose buffer flush failed (non-blocking)',
          );
        }
      };

      // Stream callback to send events to client
      const streamCallback = async (event: any) => {
        try {
          let eventData = event.data || {};

          // V2 -> handler-event translation. The V2 pipeline emits its own
          // frame vocabulary (assistant_message_delta, assistant_message_stop,
          // tool_use, etc.) that pre-dates this handler's V1 contract. Map
          // the V2 frame names onto the existing handler events so the
          // downstream sink (sequencer + ring-buffer + ndjson) keeps emitting
          // the contracted UI types (`stream`, `tool_executing`, etc.).
          //
          // Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §130-135.
          if (event.type === 'assistant_message_delta') {
            // Wave 5 — accumulate the text for end-of-turn persistence.
            const txt = typeof eventData?.text === 'string' ? eventData.text : '';
            accumulatedAssistantContent += txt;
            // V2 emits {text} blocks for streaming assistant content.
            // Translate to the handler's `content_delta` event so the
            // existing `content_delta -> stream` mapper picks it up and
            // emits a `stream` frame with `content`.
            event = {
              type: 'content_delta',
              data: {
                content: txt,
              },
            };
            eventData = event.data;
          } else if (event.type === 'tool_use' || event.type === 'tool_executing') {
            // Wave 5 — track tools used for the persisted assistant row.
            const name = typeof eventData?.name === 'string' ? eventData.name : undefined;
            if (name && !toolNamesUsed.includes(name)) toolNamesUsed.push(name);
            // Sev-0 stream-scrub — arm the post-compose buffer once a
            // compose_visual / compose_app tool_use opens. Any prose that
            // arrives after this point is buffered + scrubbed at flush so
            // the user never sees the raw JSON args echoed by the model.
            if (name === 'compose_visual' || name === 'compose_app') {
              composeDispatchedInTurn = true;
            }
          } else if (event.type === 'assistant_message_stop') {
            // V2's end-of-turn marker. The handler already emits its own
            // `stream_complete` after pipeline returns; this frame is
            // informational. Pass through as a `done` event.
            event = { type: 'completion_complete', data: eventData };
          }

          // Handle normalized stream events (Unified Activity Stream)
          // These bypass all legacy mapping — the `normalized` envelope
          // is written verbatim for the UnifiedActivityTree consumer.
          if (event.type === 'normalized') {
            writeNDJSONDurable(reply, 'normalized', eventData, durableSink);
            return;
          }

          // Track TTFT (Time to First Token) for debugging slow responses
          if ((event.type === 'content_delta' || event.type === 'stream') && !firstContentChunkTime) {
            firstContentChunkTime = Date.now();
            const ttft = firstContentChunkTime - pipelineStartTime;

            if (sseDebugEnabled) {
              logger.info({
                ttftMs: ttft,
                sessionId: request.body.sessionId
              }, '[STREAM-DEBUG] 🚀 TTFT (Time to First Token)');
            }

            // Send TTFT event to frontend for display
            writeNDJSONDurable(reply, 'ttft', { ttftMs: ttft, timestamp: Date.now() }, durableSink);
          }

          // Track content chunk count and length for token estimation
          if (event.type === 'content_delta' || event.type === 'stream') {
            contentChunkCount++;
            const chunkContent = eventData.content || eventData.text || eventData.delta || '';
            if (typeof chunkContent === 'string') totalContentLength += chunkContent.length;
            else if (typeof chunkContent === 'object' && chunkContent?.content) totalContentLength += String(chunkContent.content).length;
            if (sseDebugEnabled && contentChunkCount % 10 === 0) {
              logger.debug({
                chunkCount: contentChunkCount,
                elapsedMs: Date.now() - pipelineStartTime
              }, '[SSE-DEBUG] Content chunk progress');
            }
          }

          // CRITICAL: Sanitize error events before sending to frontend
          // Log full error details to server logs, but only send user-friendly messages to client
          // Admins receive additional technical details and recommendations
          if (event.type === 'error') {
            // Log full error details to server
            logger.error({
              userId: request.user!.id,
              sessionId: request.body.sessionId,
              fullError: eventData,
              debugInfo: eventData.debugInfo,
              stack: eventData.stack,
              allErrors: eventData.allErrors
            }, 'Pipeline error occurred - full details logged here');

            // Replace with sanitized error for frontend
            // Admins get detailed technical information, regular users get friendly messages
            const isAdmin = request.user?.isAdmin === true;
            const errorStage = eventData.stage || 'unknown';
            eventData = sanitizeErrorForFrontend(eventData, isAdmin, errorStage);
          }

          // Send all events directly with Azure OpenAI's natural rhythm
          // Map backend events to frontend-expected events (same as ChatPipeline.ts)
          let frontendEvent = event.type;
          if (event.type === 'content_delta') {
            frontendEvent = 'stream';
          }
          if (event.type === 'completion_complete') {
            frontendEvent = 'done';
          }
          if (event.type === 'thinking') {
            frontendEvent = 'thinking_event';
          }
          // CRITICAL: Keep tool events with original names for frontend processing
          // tool_executing, tool_result, tool_error - these keep SSE alive during MCP calls

          if (event.type === 'content_delta' && eventData.content) {
            // Sev-0 stream-scrub (2026-05-21) — if a compose_visual /
            // compose_app tool_use already opened in this turn, BUFFER
            // the delta instead of emitting. Buffer is flushed (scrubbed
            // through stripArtifactJsonLeak) on completion_complete /
            // stream_complete. See `flushPostComposeBuffer` above.
            if (composeDispatchedInTurn) {
              postComposeBuffer += eventData.content;
              logger.debug({
                eventType: 'content_delta',
                bufferedLength: postComposeBuffer.length,
              }, '[STREAM] buffering post-compose delta for end-of-turn scrub');
            } else {
              // Canonical Anthropic-shape content_block_delta with text_delta —
              // the SOLE wire shape for assistant text post-Track-B-Phase-2.
              // The UI's applyCanonicalFrame reducer builds a chronologically-
              // positioned ContentBlock of type 'text' — AAS renderContentBlock
              // then renders it as `.interleaved-text-block` BETWEEN the
              // tool_group / thinking_group blocks instead of collapsing all
              // prose into one trailing markdown block.
              //
              // Closes CLAUDE.md rule 8(a) interleave Sev-0. Q7 wire-capture
              // diagnostic (commit a62e32e8) proved the wire IS chronologically
              // interleaved at the round boundary but text deltas bypassed
              // the canonical reducer.
              //
              // Track B Phase 2 (rip plan sprightly-percolating-brook.md):
              // the legacy `stream` envelope dual-emit was deleted from this
              // site. UI's `case 'stream':` arm goes no-op then gets ripped
              // in Phase 3.
              const seqCanonical = sequencer.wrap({
                delta: { type: 'text_delta', text: eventData.content },
              });
              writeNDJSONDurable(reply, 'content_block_delta', seqCanonical, durableSink);
              logger.debug({
                eventType: 'content_block_delta',
                contentLength: eventData.content.length
              }, '[STREAM] content chunk');
            }
          } else {
            // Sev-0 stream-scrub — flush the post-compose buffer on any
            // end-of-turn lifecycle frame BEFORE the frame itself is
            // emitted. Ordering matters: the UI receives the scrubbed
            // synthesis prose, THEN the lifecycle close, so the bubble
            // contents settle before the typing indicator clears.
            if (
              composeDispatchedInTurn &&
              !postComposeBufferFlushed &&
              (event.type === 'completion_complete' ||
                event.type === 'stream_complete' ||
                event.type === 'done')
            ) {
              flushPostComposeBuffer();
            }
            // All other events use their (mapped) frontend event name.
            const seqData = sequencer.wrap(eventData);
            writeNDJSONDurable(reply, frontendEvent, seqData, durableSink);

            if (['tool_executing', 'tool_result', 'tool_error'].includes(event.type)) {
              logger.info({
                eventType: frontendEvent,
                originalType: event.type,
                toolName: eventData.name,
              }, '[STREAM] Tool event');
            } else if (['error', 'completion_complete', 'done', 'completion_start'].includes(event.type)) {
              logger.info({
                eventType: frontendEvent,
                originalType: event.type,
              }, '[STREAM] Lifecycle event');
            } else {
              logger.debug({ eventType: frontendEvent }, '[STREAM] chunk');
            }
          }

          // Log significant events
          if (['error', 'completion_complete', 'tool_call_complete', 'tool_executing', 'tool_result', 'tool_error'].includes(event.type)) {
            logger.debug({
              userId: request.user!.id,
              eventType: event.type,
              sessionId: request.body.sessionId,
              dataSize: JSON.stringify(eventData).length
            }, 'Stream event sent');
          }
        } catch (error) {
          logger.error({
            error: error.message,
            eventType: event.type,
            dataPreview: JSON.stringify(event.data || {}).substring(0, 100)
          }, 'Failed to send stream event');
        }
      };

      // Send initial event. `turnId` is the durable-streams key —
      // clients save it alongside sessionId + the last _seq seen and
      // resume via GET /api/chat/stream/:sessionId/tail?turnId=...&after=<seq>
      // when the underlying fetch stream terminates mid-turn.
      await streamCallback({
        type: 'stream_start',
        data: {
          sessionId: chatRequest.sessionId,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          turnId,
        }
      });

      // Process through V2 pipeline (Wave 4 cutover — Plan §240).
      //
      // The handler maps `ctx.emit(frame, payload)` from the V2 loop into
      // the existing streamCallback envelope `{type, data}`. Every frame
      // type the UI consumes — stream / tool_executing / tool_result /
      // artifact_render / sub_agent_* / thinking_event / done / error —
      // flows through the same NDJSON sink as before.
      try {
        // Build per-request input.
        const v2UserId = request.user!.id;
        const authHeader = request.headers.authorization || '';

        // Resolve MCP tools (full set; ranking happens inside V2 pipeline).
        let mcpTools: any[] = [];
        try {
          mcpTools = await deps.listMcpTools(authHeader, v2UserId);
        } catch (mcpErr: any) {
          logger.warn(
            { err: mcpErr?.message, userId: v2UserId },
            '[STREAM] listMcpTools failed — continuing with meta-tools only',
          );
        }
        // Cascade-debug seam #1 — what the chat handler actually received
        // from listMcpTools (post-normalize). Read this against
        // ChatMCPService's "Loaded tools from MCP Proxy" log on the same
        // userId/timestamp; if the source-of-truth log shows 270 but this
        // shows 0, the gap is in the listMcpTools wrapper / normalizer.
        // Pinned by `__tests__/architecture/cascade-tool-array-instrumentation.source-regression.test.ts`.
        logger.info(
          { userId: v2UserId, listMcpToolsCount: mcpTools.length },
          '[STREAM] V2 mcpTools loaded',
        );
        // TASK #524 — historical narrowing happened inside the legacy
        // pipeline via `deps.v2Deps.toolRanker.rankAndSubset(...)`. The
        // ranker is ripped (Phase E.2); the full mcpTools array now flows
        // through to the model verbatim and discovery happens mid-turn via
        // `tool_search`. The full mcpTools array is forwarded.

        // Resolve model id via Smart Router (or admin override).
        let v2Model: string;
        try {
          v2Model = await deps.pickModel({
            sessionId: chatRequest.sessionId,
            message: chatRequest.message,
            user: request.user,
            requestedModel: chatRequest.model,
          });
        } catch (modelErr: any) {
          logger.error(
            { err: modelErr?.message, userId: v2UserId },
            '[STREAM] pickModel failed — aborting turn',
          );
          throw modelErr;
        }

        // Q1-fix-10 — classify THIS turn so we can stamp the result on the
        // assistant message metadata. The next turn's pickModel reads this
        // back as `priorClassification` for conversation-context
        // inheritance. Computing here (not inside pickModel) keeps the
        // closure flat and avoids re-querying the router. Defensive: any
        // failure yields undefined and we just don't stamp this turn.
        let thisTurnTaskType: string | undefined;
        try {
          const [{ classifyTaskType }, { prisma: classifierPrisma }] = await Promise.all([
            import('../../../services/router/PromptClassifier.js'),
            import('../../../utils/prisma.js'),
          ]);
          let priorTaskType: string | undefined;
          try {
            const last = await classifierPrisma.chatMessage.findFirst({
              where: { session_id: chatRequest.sessionId, role: 'assistant' },
              orderBy: { created_at: 'desc' },
              select: { metadata: true },
            });
            const m: any = last?.metadata ?? null;
            priorTaskType = m && typeof m.taskType === 'string' ? m.taskType : undefined;
          } catch {
            /* swallow */
          }
          thisTurnTaskType = classifyTaskType(
            chatRequest.message,
            priorTaskType
              ? { priorClassification: priorTaskType as any }
              : undefined,
          );
          logger.info(
            {
              sessionId: chatRequest.sessionId,
              promptHead: (chatRequest.message ?? '').slice(0, 120),
              priorTaskType,
              thisTurnTaskType,
              selectedModel: v2Model,
            },
            '[STREAM] Q1-fix-10 — classified turn for conversation-context stamping',
          );
        } catch {
          /* swallow — stamping is best-effort */
        }

        // Optional: load prior messages for multi-turn context.
        let priorMessages:
          | Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>
          | undefined;
        if (deps.loadPriorMessages) {
          try {
            priorMessages = await deps.loadPriorMessages(
              chatRequest.sessionId,
              v2UserId,
            );
          } catch (priorErr: any) {
            logger.warn(
              { err: priorErr?.message, sessionId: chatRequest.sessionId },
              '[STREAM] loadPriorMessages failed — continuing with current message only',
            );
          }
        }

        // Wave 5 — persist the incoming user message BEFORE invoking V2.
        // The helper swallows errors internally so a transient db blip
        // never aborts the live stream. V1 used the same fail-open pattern.
        // Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §272-302.
        if (deps.persistUserMessage) {
          try {
            await deps.persistUserMessage(
              chatRequest.sessionId,
              chatRequest.message,
              { userId: v2UserId },
            );
          } catch (persistErr: any) {
            logger.warn(
              { err: persistErr?.message, sessionId: chatRequest.sessionId },
              '[STREAM] persistUserMessage failed (non-blocking)',
            );
          }
        }

        // OBO HEADER PLUMB (LIVE 2026-04-30):
        // For Azure-AD users, load the user's accessToken + idToken from
        // DB so V2's executeMcpTool can inject them as
        // `Authorization: Bearer` + `X-Azure-ID-Token` headers on every
        // /mcp/tool POST. Without this, oap-azure-mcp returns
        // "No user token provided (expected 'userAccessToken')".
        // V2 has no auth stage, so we plumb it here at the request
        // boundary.
        let azureAccessToken: string | undefined;
        let azureIdToken: string | undefined;
        let resolvedAuthMethod = (request.user as any)?.authMethod;
        const isAzureUser = !!(
          (request.user as any)?.azureOid ||
          v2UserId?.startsWith('azure_')
        );
        if (isAzureUser && deps.getAzureTokenInfo) {
          try {
            const tokenInfo = await deps.getAzureTokenInfo(v2UserId);
            if (tokenInfo && !deps.isTokenExpired?.(tokenInfo.expiresAt)) {
              azureAccessToken = tokenInfo.accessToken;
              azureIdToken = tokenInfo.idToken;
              if (resolvedAuthMethod !== 'azure-ad') {
                resolvedAuthMethod = 'azure-ad';
              }
              logger.info(
                {
                  userId: v2UserId,
                  hasAccessToken: !!azureAccessToken,
                  hasIdToken: !!azureIdToken,
                },
                '[STREAM] V2 OBO context loaded — Azure tokens attached to ctx.user',
              );
            } else {
              logger.warn(
                { userId: v2UserId, hasToken: !!tokenInfo },
                '[STREAM] V2 OBO context: Azure token expired or missing — MCP tool calls will lack OBO',
              );
            }
          } catch (oboErr: any) {
            logger.warn(
              { err: oboErr?.message, userId: v2UserId },
              '[STREAM] V2 OBO context load failed (non-fatal — falling back to internal JWT)',
            );
          }
        }

        // Persistence Sev-0 2026-05-08: collect inline render frames during
        // streaming so chat_messages.visualizations is populated. Without
        // this every ToolCard / sub-agent card / mermaid / sankey / iframe
        // widget vanishes on session reload — only the assistant prose
        // survives. Frame catalogue lives in persistableInlineFrames.ts so
        // tests can pin the set; expanding requires updating that file +
        // its sibling test (regression cage).
        const inlineFrameAccumulator: Array<{ type: string; data: unknown }> = [];
        // Parallel structured accumulators for the dedicated tool_calls /
        // tool_results columns the UI's ToolCallGroup component reads from
        // (message.toolCalls + message.toolResults). Without these the
        // ToolCard fan-out doesn't rehydrate even though the frames are in
        // visualizations — ToolCallGroup is keyed off the structured arrays.
        const toolCallsAccumulator: Array<Record<string, unknown>> = [];
        const toolResultsAccumulator: Array<Record<string, unknown>> = [];

        // Sev-0 #924/#925/#926 + Track B Phase 7 — server-side canonical
        // content_blocks accumulator uses the SAME SDK reducer the UI
        // consumes (`@agentic-work/llm-sdk` exported `consumeWireFrame` /
        // `applyCanonicalFrame`). Persisted `chat_messages.content_blocks`
        // Json column carries the byte-identical chronology the live stream
        // rendered. End_turn snapshots NEVER drop text_delta /
        // input_json_delta / etc by construction — one reducer, one shape.
        let cbState: FrameState = initialFrameState();

        // B.2 — extended thinking metrics accumulator. Tracks thinking_delta
        // events so we can record the metric row fire-and-forget at turn end.
        // Zero overhead on non-thinking turns (booleans stay false, counters 0).
        let thinkingDeltaFirstAt: number | undefined;
        let thinkingDeltaLastAt: number | undefined;
        let thinkingTokensAccumulated = 0;

        // ctx adapter: V2's `ctx.emit(frame, payload)` translates into the
        // existing streamCallback envelope `{type, data}`. The downstream
        // sink already handles sequencer-wrapping + ring-buffer dual-write.
        const v2Ctx = {
          emit: (frame: string, payload: unknown) => {
            if (isPersistableInlineFrame(frame)) {
              inlineFrameAccumulator.push({ type: frame, data: payload });
            }
            // Tool fan-out → structured arrays for ToolCallGroup rehydrate.
            // tool_executing payload shape: { toolName, args, id?, ... }
            // tool_result payload shape:    { toolName, result|content, id?, ... }
            if (frame === 'tool_executing' && payload && typeof payload === 'object') {
              toolCallsAccumulator.push(payload as Record<string, unknown>);
            } else if (frame === 'tool_result' && payload && typeof payload === 'object') {
              toolResultsAccumulator.push(payload as Record<string, unknown>);
            }
            // Sev-0 #924 + Track B Phase 7 — feed the SDK reducer with
            // every frame it understands; non-chronology frames are
            // silently ignored. Reducer is pure (state in, state out) so
            // we re-assign cbState each call. fail-open: never break the
            // live stream on a reducer error.
            try {
              cbState = consumeWireFrame(cbState, frame, payload);
            } catch {
              // reducer is fail-open — never break the live stream.
            }
            // B.2 — track thinking_delta events for the metric row.
            // content_block_delta with delta.type='thinking_delta' is the
            // canonical wire frame for thinking content (from chatLoop.ts).
            if (frame === 'content_block_delta' && payload && typeof payload === 'object') {
              const delta = (payload as any)?.delta;
              if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                const now = Date.now();
                if (thinkingDeltaFirstAt === undefined) thinkingDeltaFirstAt = now;
                thinkingDeltaLastAt = now;
                // Approximate token count: ~4 chars per token (Anthropic heuristic).
                thinkingTokensAccumulated += Math.ceil(delta.thinking.length / 4);
              }
            }
            // Fire-and-forget — streamCallback handles its own errors.
            const cbResult = streamCallback({ type: frame, data: payload });
            if (cbResult && typeof (cbResult as any).then === 'function') {
              (cbResult as Promise<unknown>).catch((err: unknown) => {
                logger.warn(
                  { err: (err as any)?.message ?? String(err), frame },
                  '[STREAM] V2 ctx.emit -> streamCallback rejected',
                );
              });
            }
          },
          logger: {
            info: (...args: unknown[]) => logger.info(...args),
            warn: (...args: unknown[]) => logger.warn(...args),
            error: (...args: unknown[]) => logger.error(...args),
            debug: (...args: unknown[]) => logger.debug(...args),
          },
          sessionId: chatRequest.sessionId,
          userId: v2UserId,
          // #648 — propagate the per-turn id so sub-agent dispatch can
          // route progress events back to the parent NDJSON stream via
          // the AgentEventStore keyed on turnId.
          turnId,
          // OBO plumb — buildChatV2Deps.makeExecuteMcpTool reads this when
          // constructing /mcp/tool headers. See buildChatV2Deps.ts comment.
          user: {
            id: v2UserId,
            email: (request.user as any)?.email,
            name: (request.user as any)?.name,
            isAdmin: (request.user as any)?.isAdmin,
            groups: (request.user as any)?.groups,
            authMethod: resolvedAuthMethod,
            accessToken: azureAccessToken,
            idToken: azureIdToken,
          },
        };

        // Resolve admin-tunable max_turns from SystemConfiguration
        // (SoT). Fail-open to the in-memory default if the service
        // throws — the chat path MUST NOT crash on a config lookup.
        let resolvedMaxTurns: number;
        try {
          resolvedMaxTurns = await getChatLoopConfigService().getMaxTurns();
        } catch (err) {
          logger.warn(
            { err: (err as Error).message },
            '[STREAM] ChatLoopConfigService.getMaxTurns() failed — using in-memory default 24',
          );
          resolvedMaxTurns = 24;
        }

        const v2Input: RunChatInput = {
          userMessage: chatRequest.message,
          mcpTools,
          model: v2Model,
          priorMessages,
          maxTurns: resolvedMaxTurns,
          // Drag-drop multimodal threading — without this the V2 pipeline
          // never sees the image bytes hydrateFileReferences put on
          // chatRequest.attachments, the model gets a text-only message,
          // and replies "please upload the image first". Pinned by
          // stream.handler.v2-wired.test.ts "forwards body.files
          // attachments to providerManager.createCompletion as multimodal
          // blocks".
          attachments: chatRequest.attachments,
          // P1 #940 (2026-05-18) — grounding T1 opt-in. Forwarded into
          // runChat → system-prompt addendum.
          groundingEnabled: (request.body as any)?.groundingEnabled === true,
          // Z.ET (2026-05-19) — per-turn extended thinking toggle from the
          // chat-input-toolbar Brain icon. When the UI sends false, the api
          // MUST NOT enable thinking even for capable models. Undefined/true
          // preserves the default (thinking on for capable models).
          extendedThinkingEnabled: (request.body as any)?.extendedThinkingEnabled !== false
            ? undefined  // undefined = "don't override" → provider decides per capability
            : false,     // explicit false = user turned it OFF
        };

        // Single chat path — runChat is the only dispatcher. The legacy
        // strangler is gone (B-vrip step 5) and the legacy V2 pipeline is
        // fully deleted (B-vrip step 6 / #741).
        const v2Result = await runChat(v2Ctx, v2Input, deps.v2Deps);

        if (!v2Result.ok) {
          // V2 returns ok:false on max_tokens / max_turns / provider error
          // without throwing. Surface as a non-fatal error frame so the UI
          // shows the message instead of an empty bubble.
          await streamCallback({
            type: 'error',
            data: {
              code: 'V2_PIPELINE_ERROR',
              message: v2Result.error ?? 'Pipeline returned without an end_turn',
              retryable: true,
            },
          });
        }

        // Wave 5 — persist the final assistant message AFTER V2 completes.
        // The accumulator collected every assistant_message_delta the V2
        // loop emitted; tools-used was tracked in parallel. Persisted before
        // the title-generation step so the new title (if generated) sees
        // the assistant turn in the session row count.
        // Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §272-302.
        if (deps.persistAssistantMessage) {
          try {
            // Sev-0 #924/#925/#926 + Track B Phase 7 — snapshot the SDK
            // reducer's contentBlocks chronology so the persisted row
            // carries the full wire-emit ordering. ChatStorageService.addMessage
            // writes it to the `chat_messages.content_blocks` Json column.
            // Same shape (UIContentBlock[]) the UI's live render produces.
            const persistedContentBlocks: UIContentBlock[] = cbState.contentBlocks;

            // Sev-0 (2026-05-21) — strip compose_visual / compose_app
            // tool_use JSON args leaked into the assistant prose body.
            // gpt-oss:20b in particular dispatches the tool (iframe mounts)
            // BUT also echoes the JSON args as prose, so the user sees raw
            // JSON in the chat bubble next to the rendered chart. Same
            // class as #492 / #807 / #880; the legacy scrubber was deleted
            // in the v3 pipeline rip and never re-wired. Scope the scrub
            // to turns that actually dispatched compose_* tools so we don't
            // corrupt legitimate conversational JSON snippets.
            const composeDispatched =
              toolNamesUsed.includes('compose_visual') ||
              toolNamesUsed.includes('compose_app');
            const scrubbedAssistantContent = composeDispatched
              ? stripArtifactJsonLeak(accumulatedAssistantContent)
              : accumulatedAssistantContent;
            const scrubbedContentBlocks = composeDispatched
              ? persistedContentBlocks.map((b) =>
                  b.type === 'text' && typeof b.content === 'string'
                    ? { ...b, content: stripArtifactJsonLeak(b.content) }
                    : b,
                )
              : persistedContentBlocks;

            await deps.persistAssistantMessage(
              chatRequest.sessionId,
              scrubbedAssistantContent,
              {
                userId: v2UserId,
                model: v2Model,
                toolNamesUsed: toolNamesUsed.length > 0 ? toolNamesUsed : undefined,
                visualizations:
                  inlineFrameAccumulator.length > 0 ? inlineFrameAccumulator : undefined,
                // Sev-0 2026-05-08 — also persist structured tool fan-out so
                // ToolCallGroup (which reads message.toolCalls/toolResults)
                // rehydrates on session reload, not just the visualizations
                // strip. Both paths feed the UI; both must be populated.
                toolCalls:
                  toolCallsAccumulator.length > 0 ? toolCallsAccumulator : undefined,
                toolResults:
                  toolResultsAccumulator.length > 0 ? toolResultsAccumulator : undefined,
                contentBlocks:
                  scrubbedContentBlocks.length > 0 ? scrubbedContentBlocks : undefined,
                metadata: {
                  turns: v2Result.turns,
                  toolUses: v2Result.toolUses,
                  ok: v2Result.ok,
                  // Q1-fix-10 — stamp the classified task type so the next
                  // turn's pickModel can inherit capability requirements
                  // via PromptClassifier.ClassifyContext.priorClassification.
                  ...(thisTurnTaskType ? { taskType: thisTurnTaskType } : {}),
                },
              },
            );
          } catch (persistErr: any) {
            logger.warn(
              { err: persistErr?.message, sessionId: chatRequest.sessionId },
              '[STREAM] persistAssistantMessage failed (non-blocking)',
            );
          }
        }

        // B.2 — extended thinking metric write (fire-and-forget).
        // Uses the extracted writeExtendedThinkingMetric helper so the logic
        // is unit-testable in isolation. Never throws — a metric hiccup MUST
        // NOT break the live chat turn.
        try {
          const { prisma: metricPrisma } = await import('../../../utils/prisma.js');
          const { getModelCapabilityRegistry: getRegistry } = await import('../../../services/ModelCapabilityRegistry.js');
          const { writeExtendedThinkingMetric, computeThinkingRequested } = await import('./extendedThinkingMetricWriter.js');
          const registry = getRegistry();
          const thinkingUserEnabled = (request.body as any)?.extendedThinkingEnabled !== false;
          const modelSupportsThinking = registry?.supportsThinking(v2Model) ?? false;
          const thinkingRequested = computeThinkingRequested(thinkingUserEnabled ? undefined : false, modelSupportsThinking);
          // `delivered` = at least one thinking_delta arrived on the wire.
          const snapshotBlocks = cbState.contentBlocks;
          const thinkingDelivered =
            thinkingTokensAccumulated > 0 ||
            snapshotBlocks.some((b) => b.type === 'thinking');
          const thinkingDurationMs =
            thinkingDeltaFirstAt !== undefined && thinkingDeltaLastAt !== undefined
              ? thinkingDeltaLastAt - thinkingDeltaFirstAt
              : undefined;
          const totalTurnMs = Date.now() - pipelineStartTime;
          // Resolve provider_id from ProviderManager for the chosen model.
          let resolvedProviderId = 'unknown';
          try {
            const pm = getProviderManager();
            const providerEntry = pm?.getProviderForModel?.(v2Model);
            if (providerEntry && typeof (providerEntry as any).id === 'string') {
              resolvedProviderId = (providerEntry as any).id;
            } else if (providerEntry && typeof (providerEntry as any).name === 'string') {
              resolvedProviderId = (providerEntry as any).name;
            }
          } catch {
            // best-effort
          }
          writeExtendedThinkingMetric(metricPrisma as any, {
            userId: v2UserId,
            sessionId: chatRequest.sessionId,
            turnId,
            providerId: resolvedProviderId,
            model: v2Model,
            requested: thinkingRequested,
            delivered: thinkingDelivered,
            thinkingTokensApprox: thinkingTokensAccumulated > 0 ? thinkingTokensAccumulated : undefined,
            thinkingDurationMs,
            totalTurnMs,
          }).catch((e: unknown) => {
            logger.warn(
              { err: (e as any)?.message, model: v2Model },
              '[STREAM] extended thinking metric write failed (non-blocking)',
            );
          });
        } catch (metricSetupErr: any) {
          logger.warn(
            { err: metricSetupErr?.message },
            '[STREAM] extended thinking metric setup failed (non-blocking)',
          );
        }

        // No buffering - events sent directly

        // Auto-generate title if this is the first meaningful message in session
        try {
          await generateTitleIfNeeded(chatRequest, request.user, logger);
        } catch (titleError) {
          // Don't fail the entire request if title generation fails
          logger.warn({ 
            error: titleError.message,
            sessionId: chatRequest.sessionId 
          }, 'Failed to auto-generate title');
        }
        
        // Send thinking_complete to clear the thinking box
        await streamCallback({
          type: 'thinking_complete',
          data: {
            stage: 'complete'
          }
        });

        // Send completion event
        const processingTime = Date.now() - startTime;
        await streamCallback({
          type: 'stream_complete',
          data: {
            success: true,
            processingTime
          }
        });

        // Track metrics for Grafana dashboards
        const userId = request.user?.id || 'unknown';
        const model = request.body?.model || 'auto';
        trackChatMessage(userId, model, 'user');
        trackChatMessage(userId, model, 'assistant');
        chatResponseTime.observe({ model, user_id: userId }, processingTime / 1000);

        // Token usage tracked in completion-simple.stage.ts with real provider token counts
        // Cost tracked via LLMMetricsService → llm_request_logs (database, not Prometheus)

      } catch (error) {
        // Log FULL error details to server logs
        logger.error({
          userId: request.user.id,
          sessionId: request.body.sessionId,
          error: error.message,
          errorCode: error.code,
          errorStack: error.stack,
          errorDetails: error
        }, 'Pipeline processing failed');

        // Send SANITIZED error to frontend
        // Admins get detailed technical information, regular users get friendly messages
        const isAdmin = request.user?.isAdmin === true;
        const sanitizedError = sanitizeErrorForFrontend(error, isAdmin, 'pipeline');
        await streamCallback({
          type: 'error',
          data: sanitizedError
        });

        // CRITICAL: Send stream_complete even on error so UI stops loading
        await streamCallback({
          type: 'stream_complete',
          data: {
            success: false,
            error: true,
            processingTime: Date.now() - startTime
          }
        });
      }

      // Clean up
      clearInterval(keepAliveInterval);

      // Durable-stream: mark the turn finalized. Any subscribed /tail
      // listeners wake up and close. The ring buffer entry stays for
      // TTL (5 min) so clients that reconnect after finalization can
      // still see the final few frames (e.g. `done`, `stream_complete`).
      unregisterActiveTurn(sessionId, turnId);

      // CRITICAL FIX: Force flush of TCP buffers before closing
      // This ensures the stream_complete event reaches the client before the connection closes
      // Use uncork to flush any corked writes, then wait for the buffer to drain
      if (reply.raw.socket && reply.raw.socket.uncork) {
        reply.raw.socket.uncork();
      }

      // Wait longer for TCP buffer to flush completely (increased from setImmediate)
      await new Promise(resolve => setTimeout(resolve, 250));

      reply.raw.end();
      return; // Explicit return for successful completion

    } catch (error) {
      // Log FULL error details to server logs
      logger.error({
        userId: request.user?.id,
        error: error.message,
        errorCode: error.code,
        errorStack: error.stack,
        errorDetails: error
      }, 'Stream handler error');

      // Unregister the turn even on handler-level error so tail listeners
      // don't block forever waiting for frames that will never come.
      try {
        const sid = request.body?.sessionId;
        if (sid) unregisterActiveTurn(sid, turnId);
      } catch { /* ignored */ }

      // Sev-1 #833 — branch on whether the NDJSON headers were already
      // flushed via reply.raw.writeHead(). If yes, the only safe path is
      // to write an `error` NDJSON frame on the open raw stream and end
      // the response; calling reply.code().send() in that state triggers
      // Fastify's onSendEnd hook → writeHead crash. If no (request never
      // reached the stream phase, e.g. failed in a pre-flight check),
      // the conventional reply.code().send() path is correct.
      const isAdmin = request.user?.isAdmin === true;
      const sanitizedError = sanitizeErrorForFrontend(error, isAdmin, 'stream');
      if (reply.raw.headersSent) {
        try {
          const errFrame = JSON.stringify({
            type: 'error',
            data: {
              code: 'STREAM_ERROR',
              message: sanitizedError.message || 'stream error',
              retryable: false,
            },
          });
          reply.raw.write(errFrame + '\n');
          reply.raw.end();
        } catch {
          // socket already closed; nothing to do
        }
      } else if (!reply.sent) {
        return reply.code(500).send({
          error: sanitizedError
        });
      }
      return; // Explicit return for error case
    }
  };
}

/**
 * Auto-generate title if session has generic name and this is first meaningful message
 */
async function generateTitleIfNeeded(chatRequest: ChatRequest, user: any, logger: any): Promise<void> {
  try {
    // Import services we need (dynamic import to avoid circular dependencies)
    const { prisma } = await import('../../../utils/prisma.js');
    const { AITitleGenerationService } = await import('../../../services/AITitleGenerationService.js');
    const { TitleGenerationClient } = await import('../../../services/TitleGenerationClient.js');
    
    // Get session to check current title
    const session = await prisma.chatSession.findFirst({
      where: {
        id: chatRequest.sessionId,
        user_id: user.id
      },
      include: {
        messages: {
          select: {
            id: true
          }
        }
      }
    });
    
    if (!session) {
      logger.debug({ sessionId: chatRequest.sessionId }, 'Session not found for title generation');
      return;
    }
    
    // Only auto-generate for sessions with generic titles and few messages
    const hasGenericTitle = !session.title || 
                           session.title === 'New Chat' || 
                           session.title.startsWith('Chat ') ||
                           session.title.trim() === '';
    
    const isFirstMessage = session.messages.length <= 2; // User + assistant message
    
    if (!hasGenericTitle || !isFirstMessage) {
      logger.debug({ 
        sessionId: chatRequest.sessionId,
        currentTitle: session.title,
        messageCount: session.messages.length,
        hasGenericTitle,
        isFirstMessage
      }, 'Skipping title generation - not needed');
      return;
    }
    
    logger.info({ 
      sessionId: chatRequest.sessionId,
      currentTitle: session.title,
      messageCount: session.messages.length
    }, 'Auto-generating title for session');

    // Initialize title generation services
    // Use singleton providerManager for LLM access
    const providerManager = getProviderManager();
    const titleClient = new TitleGenerationClient(logger, { providerManager });
    const titleService = new AITitleGenerationService(
      logger,
      {
        useLLM: !!providerManager, // Only use LLM if providerManager is available
        maxLength: 60
      },
      titleClient
    );
    
    // Get recent messages for context
    const messages = await prisma.chatMessage.findMany({
      where: {
        session_id: chatRequest.sessionId
      },
      orderBy: {
        created_at: 'asc'
      },
      take: 5,
      select: {
        role: true,
        content: true
      }
    });
    
    if (messages.length === 0) {
      logger.debug({ sessionId: chatRequest.sessionId }, 'No messages found for title generation');
      return;
    }
    
    // Generate title based on conversation
    const title = await titleService.generateTitle(messages);
    
    // Update session with new title
    await prisma.chatSession.update({
      where: {
        id: chatRequest.sessionId
      },
      data: {
        title,
        metadata: {
          ...session.metadata as any,
          titleGeneratedAt: new Date().toISOString(),
          titleGeneratedBy: 'ai-auto',
          // DB is SoT — the title model is whatever ModelConfigurationService
          // currently returns, not a stale env var read at pod start.
          titleModel: await (async () => {
            try {
              const { ModelConfigurationService } = await import('../../../services/ModelConfigurationService.js');
              const m = await ModelConfigurationService.getServiceModel('titleGeneration');
              return m?.modelId ?? await ModelConfigurationService.getDefaultChatModel();
            } catch {
              return undefined;
            }
          })()
        }
      }
    });
    
    logger.info({
      sessionId: chatRequest.sessionId,
      userId: user.id,
      oldTitle: session.title,
      newTitle: title
    }, 'Auto-generated session title successfully');
    
  } catch (error) {
    logger.error({ 
      error: error.message,
      sessionId: chatRequest.sessionId,
      userId: user.id
    }, 'Failed to auto-generate session title');
    throw error;
  }
}

/**
 * Test stream endpoint (for debugging)
 */
export function testStreamHandler(logger: any) {
  return async (request: StreamRequest, reply: FastifyReply): Promise<void> => {
    try {
      // NDJSON stream for smoke tests — same headers as the real chat
      // stream so proxy behaviour is consistent between dev and prod.
      reply.raw.writeHead(200, ndjsonHeaders());

      const messages = [
        'Hello! This is a test stream.',
        'I can perform basic math calculations.',
        'For example: 20 + 14 = 34',
        'The stream is working correctly!',
      ];

      for (let i = 0; i < messages.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        writeNDJSON(reply, 'content_delta', {
          content: messages[i],
          index: i,
          timestamp: new Date().toISOString(),
        });
      }

      writeNDJSON(reply, 'stream_complete', { success: true, timestamp: new Date().toISOString() });
      reply.raw.end();
      return;
    } catch (error) {
      logger.error({ error: error.message }, 'Test stream error');
      // Sev-1 #833 — same branch as the main stream handler: if headers
      // are flushed, errors must go as NDJSON frames on the raw stream.
      if (reply.raw.headersSent) {
        try {
          reply.raw.write(JSON.stringify({
            type: 'error',
            data: { code: 'TEST_STREAM_ERROR', message: 'Test stream failed', retryable: false },
          }) + '\n');
          reply.raw.end();
        } catch { /* socket closed */ }
      } else if (!reply.sent) {
        return reply.code(500).send({
          error: { code: 'TEST_STREAM_ERROR', message: 'Test stream failed' },
        });
      }
      return;
    }
  };
}

// WebSocket handler removed - using Server-Sent Events (SSE) only