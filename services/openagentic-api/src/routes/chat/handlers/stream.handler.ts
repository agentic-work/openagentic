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
import { ChatPipeline } from '../pipeline/ChatPipeline.js';
import { ChatRequest } from '../interfaces/chat.types.js';
import { isUserLocked, analyzeMessageScope, recordScopeViolation } from '../../../services/ScopeEnforcementService.js';
import { EventSequencer } from '../../../infra/event-sequencer.js';
import { writeNDJSON, ndjsonHeaders } from '../../../infra/ndjson.js';
import { trackChatMessage, chatResponseTime } from '../../../metrics/index.js';

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
 * Create stream handler
 */
export function streamHandler(pipeline: ChatPipeline, logger: any) {
  return async (request: StreamRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();
    // Event sequencer for gap detection and ordering (v0.5.0)
    const sequencer = new EventSequencer();
    
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
      // Prevents cross-session message injection
      // ═══════════════════════════════════════════════════════════════════════════
      try {
        const { prisma: db } = await import('../../../utils/prisma.js');
        const session = await db.chatSession.findFirst({
          where: { id: request.body.sessionId.trim(), user_id: userId },
          select: { id: true },
        });
        if (!session) {
          logger.warn({ userId, sessionId: request.body.sessionId }, '[STREAM] Session ownership check failed');
          return reply.code(403).send({
            error: { code: 'SESSION_NOT_OWNED', message: 'Session does not belong to this user' }
          });
        }
      } catch (ownershipErr) {
        // Non-blocking: if check fails (e.g., DB error), proceed with request
        // The session may be new (not yet in DB) during rapid creation
        logger.warn({ err: ownershipErr }, '[STREAM] Session ownership check failed (non-blocking)');
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // ACCOUNT LOCK CHECK: Only check if user account is locked
      // Scope enforcement is handled by the system prompt (Default Assistant template)
      // ═══════════════════════════════════════════════════════════════════════════

      // Check if user account is locked (admin can lock accounts manually)
      const locked = await isUserLocked(userId);
      if (locked) {
        logger.warn({
          userId,
          message: request.body.message.substring(0, 100)
        }, '[SCOPE] Blocked request from locked user');

        return reply.code(403).send({
          error: {
            code: 'ACCOUNT_LOCKED',
            message: '🔒 Your account has been locked due to policy violations. Please contact your administrator to restore access.'
          }
        });
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // SCOPE ENFORCEMENT: Pre-analyze messages for non-admin users
      // This enforces scope BEFORE sending to LLM and persists warnings in DB
      // ═══════════════════════════════════════════════════════════════════════════
      const isAdmin = request.user?.isAdmin === true;
      
      if (!isAdmin) {
        // Analyze message scope for non-admin users
        const scopeAnalysis = analyzeMessageScope(request.body.message);
        
        if (!scopeAnalysis.isInScope && scopeAnalysis.confidence >= 0.7) {
          // Record the violation and get the appropriate response
          const violationResult = await recordScopeViolation(userId, scopeAnalysis.reason);
          
          logger.warn({
            userId,
            message: request.body.message.substring(0, 100),
            scopeReason: scopeAnalysis.reason,
            confidence: scopeAnalysis.confidence,
            warningCount: violationResult.warningCount,
            isLocked: violationResult.isLocked
          }, '[SCOPE] Out-of-scope message detected');
          
          if (violationResult.isLocked) {
            // Account is now locked after this violation
            return reply.code(403).send({
              error: {
                code: 'ACCOUNT_LOCKED',
                message: violationResult.message
              }
            });
          }
          
          // Return warning message (warnings 1-3)
          return reply.code(400).send({
            error: {
              code: 'SCOPE_VIOLATION',
              message: violationResult.message,
              warningCount: violationResult.warningCount
            }
          });
        }
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
        // Disable Nagle's algorithm - send small packets immediately
        reply.raw.socket.setNoDelay(true);
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

      // Keepalive ping every 3s. Clients ignore type="ping" lines; the
      // write itself keeps the TCP connection warm + flushes any proxy
      // buffering. Tighter than the 7s Firefox idle-stream timeout.
      const keepAliveInterval = setInterval(() => {
        writeNDJSON(reply, 'ping', { timestamp: new Date().toISOString() });
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
      
      // Handle files from new format (from frontend)
      if (request.body.files && request.body.files.length > 0) {
        chatRequest.attachments = request.body.files.map((file: any, index: number) => {
          // Detect MIME type from file extension if not provided
          let mimeType = file.type;
          if (!mimeType || mimeType === '') {
            const ext = (file.name || '').toLowerCase().split('.').pop();
            const mimeMap: Record<string, string> = {
              'txt': 'text/plain',
              'md': 'text/markdown',
              'json': 'application/json',
              'csv': 'text/csv',
              'xml': 'text/xml',
              'html': 'text/html',
              'htm': 'text/html',
              'js': 'text/javascript',
              'ts': 'text/typescript',
              'jsx': 'text/javascript',
              'tsx': 'text/typescript',
              'py': 'text/x-python',
              'java': 'text/x-java',
              'cpp': 'text/x-c++',
              'c': 'text/x-c',
              'h': 'text/x-c',
              'sh': 'text/x-sh',
              'yaml': 'text/yaml',
              'yml': 'text/yaml',
              'pdf': 'application/pdf',
              'doc': 'application/msword',
              'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'svg': 'image/svg+xml'
            };
            mimeType = mimeMap[ext || ''] || 'application/octet-stream';
          }

          return {
            id: `file_${Date.now()}_${index}`,
            originalName: file.name || `file_${index}`,
            mimeType,
            size: file.size || 0,
            base64Data: file.content,
            metadata: {}
          };
        });

        logger.info({
          userId: request.user!.id,
          fileCount: request.body.files.length,
          files: request.body.files.map((f: any) => ({
            name: f.name,
            type: f.type,
            hasContent: !!f.content,
            contentLength: f.content?.length
          })),
          attachmentsCreated: chatRequest.attachments.map(att => ({
            id: att.id,
            name: att.originalName,
            type: att.mimeType,
            hasBase64: !!att.base64Data,
            base64Length: att.base64Data?.length
          }))
        }, 'VISION DEBUG: Processing files in stream request');
      }

      // Let Azure OpenAI's natural streaming rhythm flow through - no artificial buffering
      
      // SSE Debug mode and TTFT tracking
      const sseDebugEnabled = process.env.SSE_DEBUG === 'true';
      let firstContentChunkTime: number | null = null;
      let contentChunkCount = 0;
      let totalContentLength = 0; // Track content length for token estimation
      const pipelineStartTime = Date.now();

      // Stream callback to send events to client
      const streamCallback = async (event: any) => {
        try {
          let eventData = event.data || {};

          // Handle normalized stream events (Unified Activity Stream)
          // These bypass all legacy mapping — the `normalized` envelope
          // is written verbatim for the UnifiedActivityTree consumer.
          if (event.type === 'normalized') {
            writeNDJSON(reply, 'normalized', eventData);
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
            writeNDJSON(reply, 'ttft', { ttftMs: ttft, timestamp: Date.now() });
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
            // Content deltas are emitted as `stream` events for the UI.
            const seqContent = sequencer.wrap({ content: eventData.content });
            writeNDJSON(reply, 'stream', seqContent);
            logger.debug({
              eventType: 'stream',
              contentLength: eventData.content.length
            }, '[STREAM] content chunk');
          } else {
            // All other events use their (mapped) frontend event name.
            const seqData = sequencer.wrap(eventData);
            writeNDJSON(reply, frontendEvent, seqData);

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

      // Send initial event
      await streamCallback({
        type: 'stream_start',
        data: {
          sessionId: chatRequest.sessionId,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }
      });

      // Process through pipeline
      try {
        await pipeline.process(chatRequest, request.user, streamCallback, pipelineAbortController);
        
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

      if (!reply.sent) {
        // Send SANITIZED error to frontend
        // Admins get detailed technical information, regular users get friendly messages
        const isAdmin = request.user?.isAdmin === true;
        const sanitizedError = sanitizeErrorForFrontend(error, isAdmin, 'stream');
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
    // Use global providerManager for LLM access
    const providerManager = (global as any).providerManager;
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
          titleModel: process.env.TITLE_GENERATION_MODEL || process.env.DEFAULT_MODEL
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
      if (!reply.sent) {
        return reply.code(500).send({
          error: { code: 'TEST_STREAM_ERROR', message: 'Test stream failed' },
        });
      }
      return;
    }
  };
}

// WebSocket handler removed - using Server-Sent Events (SSE) only