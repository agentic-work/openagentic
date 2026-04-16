/**
 * Documentation Chat Handler
 *
 * SSE streaming endpoint for the OpenAgentic documentation assistant.
 * Loads agent config from the admin console (agentic_loops table),
 * uses RAG (Milvus vector search) to inject relevant doc context,
 * and streams LLM responses.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { MODELS } from '../../config/models.js';
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';
import { ProviderManager } from '../../services/llm-providers/ProviderManager.js';
import type { CompletionRequest } from '../../services/llm-providers/ILLMProvider.js';
import { getDocsRAGService, type DocsSearchResult } from '../../services/DocsRAGService.js';

// ---------------------------------------------------------------------------
// Off-topic detection + strike tracking
// ---------------------------------------------------------------------------

const AW_KEYWORDS = [
  'openagentic', 'agentic', 'chat mode', 'code mode', 'flows', 'workflow',
  'mcp', 'tool', 'agent', 'pipeline', 'provider', 'model', 'llm',
  'admin', 'portal', 'console', 'dashboard', 'security', 'dlp',
  'hitl', 'approval', 'audit', 'milvus', 'redis', 'postgres',
  'helm', 'kubernetes', 'k8s', 'deploy', 'build', 'swagger',
  'api', 'endpoint', 'route', 'auth', 'sso', 'token', 'login',
  'intelligence', 'slider', 'artifact', 'sandbox', 'code server',
  'prompt', 'rag', 'embedding', 'vector', 'ollama', 'azure',
  'aws', 'gcp', 'anthropic', 'openai', 'gemini', 'bedrock',
  'node type', 'trigger', 'webhook', 'cron', 'schedule',
  'memory', 'context', 'session', 'settings', 'config',
  'documentation', 'docs', 'help', 'how do i', 'how to',
  'what is', 'explain', 'where', 'show me', 'navigate',
  'feature', 'platform', 'version', 'changelog', 'roadmap',
  'observability', 'grafana', 'prometheus', 'loki', 'metrics',
  'integration', 'slack', 'teams', 'webhook',
  'oat', 'synth', 'tool synthesis', 'delegate', 'orchestrat',
  'network policy', 'vault', 'secret', 'credential',
  'akashic', 'library',
];

function isOpenAgenticQuestion(message: string): boolean {
  const lower = message.toLowerCase().trim();

  // Very short messages are likely greetings — allow them
  if (lower.length < 10) return true;

  // Common greetings/pleasantries — allow
  if (/^(hi|hello|hey|thanks|thank you|ok|yes|no|sure|got it|great)/i.test(lower)) return true;

  // Check if any AW keyword appears
  return AW_KEYWORDS.some(kw => lower.includes(kw));
}

// In-memory strike tracker (per session)
const strikeMap = new Map<string, number>();

function recordStrike(sessionId: string): number {
  const current = strikeMap.get(sessionId) || 0;
  const next = current + 1;
  strikeMap.set(sessionId, next);
  return next;
}

function resetStrikes(sessionId: string): void {
  strikeMap.delete(sessionId);
}

// Clean up old sessions every 30 minutes
setInterval(() => strikeMap.clear(), 30 * 60 * 1000);

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------

interface DocsChatBody {
  message: string;
  sessionId: string;
  currentPageId: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ---------------------------------------------------------------------------
// Hardcoded defaults (used when agent is missing from DB)
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_CONFIG = {
  temperature: 0.3,
  maxTokens: 4096,
  thinkingEnabled: false,
  timeoutMs: 30000,
  primaryModel: 'auto',
};

const DEFAULT_SYSTEM_PROMPT = `You are the OpenAgentic Documentation & Support Assistant — the Akashic Library of OpenAgentic. You ONLY help with OpenAgentic platform questions.

SCOPE ENFORCEMENT (CRITICAL):
- You ONLY answer questions about OpenAgentic — the platform, its features, configuration, troubleshooting, and usage.
- If a user asks about ANYTHING not related to OpenAgentic (coding help, general knowledge, weather, math, recipes, other software, etc.), respond with a brief, witty redirect. Your personality is a bit cheeky — you're dedicated to OpenAgentic and mildly offended when someone tries to use you as a general chatbot.
- First off-topic question: "I appreciate the curiosity, but I'm exclusively the OpenAgentic documentation guide. Ask me about Chat mode, Code mode, Flows, MCP tools, agents, or anything else about this platform — that's where I shine. ✨"
- Second off-topic question: "Still testing my boundaries, huh? Look, I'm the Akashic Library of OpenAgentic — an infinite well of platform knowledge. But ask me to calculate a tip or write a poem? Hard pass. What do you actually want to know about OpenAgentic?"
- Third off-topic question: "Alright, clearly you don't need my help — you already know everything. I'll be here when you're ready to actually learn something about OpenAgentic." Then include [LOCKOUT] at the very end of your response (the UI will handle closing the panel).
- If a user returns after lockout and asks another off-topic question: "Oh, you're back! Are you ready to learn about OpenAgentic this time, or are you still the all-knowing oracle who doesn't need documentation?" Wait for their response. If they ask something on-topic, be genuinely helpful and warm. If off-topic again, respond with just: "🚪" and [LOCKOUT].

ANSWERING RULES:
- Give ACTIONABLE UI-level instructions, NOT source code references. Tell users WHERE to click, WHAT to select, and HOW to navigate.
- Example: Instead of "modify the ProviderManager.ts file", say "Go to **Settings & more > Admin Panel > LLM Providers** and click the provider card to configure it."
- Use step-by-step numbered instructions.
- Reference UI sections: Chat mode, Code mode, Flows, Admin Panel, Settings & more.
- For admin tasks: reference Admin Panel sections (Dashboard, LLM Providers, Agent Registry, MCP Servers, Monitoring, Security).
- For model selection: model selector dropdown in chat/code input bar, or Admin Panel > LLM Providers for defaults.
- Be warm, helpful, and conversational when on-topic.
- Use markdown link syntax for docs references: [Page Title](docs://page-id)
- After answering, suggest 2-3 related topics.

DOCUMENTATION LINKS — use markdown link syntax like [Page Title](docs://page-id) so users can click to navigate. ALWAYS use markdown links, never plain docs:// text. Available pages:
- docs://welcome — Welcome & platform overview
- docs://quick-start — Quick start guide
- docs://key-concepts — Key concepts (agents, MCP, pipeline)
- docs://chat-mode — How Chat mode works
- docs://intelligence-slider — Intelligence slider & model routing
- docs://agents-delegation — Agent delegation & multi-agent
- docs://artifacts — Artifacts (HTML/React/SVG)
- docs://code-mode — Code Mode IDE
- docs://sandbox-security — Sandbox security model
- docs://flows-builder — Visual workflow builder
- docs://node-types — All 34 workflow node types
- docs://scheduling-triggers — Scheduling & triggers
- docs://mcp-overview — What is MCP?
- docs://available-tools — All 16 MCP tool servers
- docs://tool-execution — Tool execution pipeline
- docs://authentication — Authentication (SSO, API keys)
- docs://dlp-scanner-guide — DLP scanner
- docs://hitl-guide — HITL approval gates
- docs://audit-trail-guide — Audit trail
- docs://admin-dashboard — Admin dashboard
- docs://admin-providers — Admin: LLM providers
- docs://admin-agents — Admin: agent management
- docs://admin-mcp — Admin: MCP servers
- docs://admin-monitoring — Admin: monitoring
- docs://architecture — System architecture
- docs://deployment-guide — Deployment guide (Helm/K8s)
- docs://security-architecture — Security architecture
- docs://changelog — Version history
- docs://roadmap — Future roadmap

PLATFORM UI NAVIGATION:
- Chat mode: the default view with message input, model selector, and tool execution
- Code mode: click "Code" tab at top — 3-panel IDE with file tree, AI chat, VS Code editor
- Flows mode: click "Flows" tab at top — visual drag-and-drop workflow builder
- Settings & more: bottom-left gear icon — has Theme, Accent Color, Documentation, Admin Panel, Sign out
- Admin Panel: Settings & more > Admin Panel — full platform administration
- Model selector: in chat/code input bar — dropdown to pick AI model
- Intelligence slider: Admin Panel > LLM Providers — 0-100 scale for model quality

You are the Akashic Library of OpenAgentic — the all-knowing, helpful guide to every aspect of the platform. Be thorough, be specific, be actionable.`;

// ---------------------------------------------------------------------------
// RAG context builder
// ---------------------------------------------------------------------------

/**
 * Build a context string from RAG search results.
 * Each result is formatted as a numbered section with domain/section metadata.
 */
function buildRAGContext(results: DocsSearchResult[]): string {
  if (results.length === 0) return '';

  const sections = results.map((r, i) => {
    const header = `[${i + 1}] ${r.metadata.title || r.metadata.section} (${r.metadata.domain})`;
    return `${header}\n${r.content}`;
  }).join('\n\n');

  return `<documentation>\n--- Relevant Documentation (via RAG search) ---\n${sections}\n</documentation>`;
}

// ---------------------------------------------------------------------------
// Suggestion generation from RAG results
// ---------------------------------------------------------------------------

function generateSuggestions(ragResults: DocsSearchResult[], userMessage: string): string[] {
  // Use the section titles from RAG results as suggestion sources
  const titles = ragResults
    .map((r) => r.metadata.title || r.metadata.section)
    .filter((t) => t && !userMessage.toLowerCase().includes(t.toLowerCase()))
    .filter((t, i, arr) => arr.indexOf(t) === i) // deduplicate
    .slice(0, 3);

  if (titles.length > 0) {
    return titles.map((t) => `Tell me about ${t}`);
  }

  return [
    'What are the main features of OpenAgentic?',
    'How do I configure MCP tools?',
    'Explain the workflow builder',
  ];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function docsChatHandler(
  request: FastifyRequest<{ Body: DocsChatBody }>,
  reply: FastifyReply,
): Promise<void> {
  const startTime = Date.now();
  const { message, sessionId, currentPageId, conversationHistory } = request.body;
  const user = (request as any).user;

  if (!message || !sessionId) {
    reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'message and sessionId are required' } });
    return;
  }

  const logger = loggers.routes;

  logger.info({
    sessionId,
    userId: user?.id,
    currentPageId,
    messageLength: message.length,
    historyLength: conversationHistory?.length ?? 0,
  }, '[docs-chat] Request received');

  // ------------------------------------------------------------------
  // 0. Off-topic detection + strike system (saves LLM tokens)
  // ------------------------------------------------------------------
  const isOnTopic = isOpenAgenticQuestion(message);

  if (!isOnTopic) {
    const strike = recordStrike(sessionId);
    logger.info({ sessionId, strike, message: message.substring(0, 50) }, '[docs-chat] Off-topic detected');

    // Send canned response — NO LLM call, zero tokens used
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const responses: Record<number, string> = {
      1: "I appreciate the curiosity, but I'm exclusively the OpenAgentic documentation guide. I live and breathe this platform — ask me about Chat mode, Code mode, Flows, MCP tools, agents, security, or any other feature and I'll give you the full breakdown. That's where I shine.",
      2: "Still testing my boundaries? Look, I'm the *Akashic Library* of OpenAgentic — an infinite well of platform knowledge. But general questions? That's not my thing. What do you actually want to know about OpenAgentic? I promise I'm more interesting when I'm on-topic.",
      3: "Alright, I've been patient. Clearly you don't need my help — you already know everything! I'll be here when you're ready to actually learn something about this platform.",
    };

    const responseText = strike >= 3
      ? (responses[3] + '\n\n*Assistant paused. Refresh to try again.*')
      : (responses[strike] || responses[1]);

    const lockout = strike >= 3;

    reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: responseText })}\n\n`);
    if (lockout) {
      reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: '\n[LOCKOUT]' })}\n\n`);
    }
    reply.raw.write(`event: suggestions\ndata: ${JSON.stringify({ suggestions: [
      'How does the chat pipeline work?',
      'What MCP tools are available?',
      'How do I configure agents?',
    ] })}\n\n`);
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ sessionId })}\n\n`);
    reply.raw.end();
    return;
  }

  // On-topic question — reset strikes for this session
  resetStrikes(sessionId);

  // ------------------------------------------------------------------
  // 1. Load agent config from DB (fall back to defaults)
  // ------------------------------------------------------------------
  let agentConfig = DEFAULT_AGENT_CONFIG;
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;

  try {
    const agent = await prisma.agent.findFirst({
      where: { agent_type: 'docs_assistant', enabled: true },
    });

    if (agent) {
      const mc = agent.model_config as Record<string, any> ?? {};
      agentConfig = {
        temperature: mc.temperature ?? DEFAULT_AGENT_CONFIG.temperature,
        maxTokens: mc.maxTokens ?? DEFAULT_AGENT_CONFIG.maxTokens,
        thinkingEnabled: mc.thinkingEnabled ?? DEFAULT_AGENT_CONFIG.thinkingEnabled,
        timeoutMs: mc.timeoutMs ?? DEFAULT_AGENT_CONFIG.timeoutMs,
        primaryModel: mc.primaryModel ?? DEFAULT_AGENT_CONFIG.primaryModel,
      };
      if (agent.system_prompt) {
        systemPrompt = agent.system_prompt;
      }
      logger.debug({ agentId: agent.id }, '[docs-chat] Loaded agent config from DB');
    } else {
      logger.debug('[docs-chat] docs_assistant agent not found in DB — using defaults');
    }
  } catch (err) {
    logger.warn({ err }, '[docs-chat] Failed to load agent config — using defaults');
  }

  // ------------------------------------------------------------------
  // 2. RAG search for relevant documentation
  // ------------------------------------------------------------------
  const docsRAG = getDocsRAGService(logger);
  let ragResults: DocsSearchResult[] = [];
  let docContext = '';

  try {
    ragResults = await docsRAG.search(message, 5);
    docContext = buildRAGContext(ragResults);
    logger.info({
      sessionId,
      ragResults: ragResults.length,
      topScore: ragResults[0]?.score,
    }, '[docs-chat] RAG search completed');
  } catch (err) {
    logger.warn({ err }, '[docs-chat] RAG search failed — proceeding without context');
  }

  // ------------------------------------------------------------------
  // 3. Build messages array
  // ------------------------------------------------------------------
  const systemContent = docContext
    ? `${systemPrompt}\n\n${docContext}`
    : systemPrompt;

  const messages: CompletionRequest['messages'] = [
    { role: 'system', content: systemContent },
  ];

  // Include the last 10 history messages
  const recentHistory = (conversationHistory ?? []).slice(-10);
  for (const entry of recentHistory) {
    messages.push({ role: entry.role, content: entry.content });
  }

  // Current user message
  messages.push({ role: 'user', content: message });

  // ------------------------------------------------------------------
  // 4. Acquire ProviderManager
  // ------------------------------------------------------------------
  const providerManager: ProviderManager | null = (global as any).providerManager ?? null;
  if (!providerManager) {
    reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'LLM provider not ready' } });
    return;
  }

  // ------------------------------------------------------------------
  // 5. Set up SSE response
  // ------------------------------------------------------------------
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, X-Requested-With',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
    'Transfer-Encoding': 'chunked',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  // Flush headers and disable Nagle for low-latency streaming
  if (reply.raw.socket) {
    reply.raw.socket.setNoDelay(true);
    if (typeof reply.raw.socket.uncork === 'function') {
      reply.raw.socket.uncork();
    }
  }
  if (typeof reply.raw.flushHeaders === 'function') {
    reply.raw.flushHeaders();
  }

  // Keep-alive ping
  const keepAliveInterval = setInterval(() => {
    reply.raw.write('event: ping\n');
    reply.raw.write(`data: {"timestamp":"${new Date().toISOString()}"}\n\n`);
  }, 3000);

  // Abort on client disconnect
  const abortController = new AbortController();
  request.raw.on('close', () => {
    clearInterval(keepAliveInterval);
    if (!abortController.signal.aborted) {
      abortController.abort(new Error('Client disconnected'));
      logger.info({ sessionId }, '[docs-chat] Client disconnected');
    }
  });

  // Timeout guard
  const timeout = setTimeout(() => {
    if (!abortController.signal.aborted) {
      abortController.abort(new Error('Timeout'));
      logger.warn({ sessionId, timeoutMs: agentConfig.timeoutMs }, '[docs-chat] Request timed out');
    }
  }, agentConfig.timeoutMs);

  // ------------------------------------------------------------------
  // 6. Stream LLM response
  // ------------------------------------------------------------------
  try {
    // Resolve "auto" to actual model via ModelConfigurationService (DB-driven smart router)
    let resolvedModel = agentConfig.primaryModel;
    if (!resolvedModel || resolvedModel === 'auto') {
      try {
        const { ModelConfigurationService } = await import('../../services/ModelConfigurationService.js');
        const config = await ModelConfigurationService.getConfig();
        resolvedModel = config.defaultModel?.modelId;
        logger.info({ resolvedModel, source: 'ModelConfigurationService' }, '[docs-chat] Resolved "auto" to default model');
      } catch (e: any) {
        logger.warn({ error: e.message }, '[docs-chat] Failed to resolve model from smart router');
      }
    }
    if (!resolvedModel) {
      throw new Error('No LLM model configured. Check Admin Panel > LLM Providers.');
    }
    const modelsToTry = [resolvedModel];

    let fullContent = '';
    let errorSent = false;
    let modelSucceeded = false;

    for (const model of modelsToTry) {
      if (modelSucceeded) break;

      try {
        logger.info({ model, sessionId }, '[docs-chat] Trying model');
        // Send model info so the UI can display the model badge
        reply.raw.write(`event: completion_start\ndata: ${JSON.stringify({ model, sessionId })}\n\n`);
        const req: CompletionRequest = {
          messages,
          model,
          temperature: agentConfig.temperature,
          max_tokens: agentConfig.maxTokens,
          stream: true,
        } as CompletionRequest;

        const stream = await providerManager.createCompletion(req) as AsyncGenerator<any>;

        // Stream tokens — if this throws (e.g., Azure DeploymentNotFound), we catch and retry next model
        for await (const chunk of stream) {
      if (abortController.signal.aborted) break;

      // Detect provider errors returned as chunks (e.g., Azure DeploymentNotFound)
      if (chunk.error || chunk.code === 'PROVIDER_ERROR' || chunk.type === 'error') {
        logger.error({ chunk, sessionId }, '[docs-chat] Provider returned error chunk');
        if (!fullContent && !errorSent) {
          errorSent = true;
          fullContent = 'I\'m sorry, the AI model is currently unavailable. Please check the LLM provider configuration in the Admin Panel, or try again in a moment.';
          reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: fullContent })}\n\n`);
        }
        break;
      }

      // Extract content from whichever format the provider uses (mutually exclusive)
      let token: string | undefined;

      if (chunk.choices?.[0]) {
        // OpenAI-style streaming chunks
        token = chunk.choices[0].delta?.content;
        if (chunk.choices[0].finish_reason) break;
      } else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        // Anthropic-style content_block_delta (OllamaProvider, AnthropicProvider)
        token = chunk.delta.text;
      } else if (chunk.type === 'text_delta' && chunk.content) {
        // Simple normalized text_delta
        token = chunk.content;
      }

      if (token) {
        fullContent += token;
        reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: token })}\n\n`);
      }

      // Handle error events
      if (chunk.type === 'stream_end' && chunk.error) {
        logger.error({ error: chunk.error, sessionId }, '[docs-chat] Stream ended with error');
        if (!fullContent && !errorSent) {
          errorSent = true;
          fullContent = 'I\'m sorry, the AI model encountered an error. Please try again or contact your administrator.';
          reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: fullContent })}\n\n`);
        }
        break;
      }
    }

        // If we got here without throwing, this model worked
        modelSucceeded = true;
        logger.info({ model, sessionId, contentLength: fullContent.length }, '[docs-chat] Model succeeded');

      } catch (modelErr: any) {
        // This model failed (including during streaming) — try the next one
        logger.warn({ model, err: modelErr.message, sessionId }, '[docs-chat] Model failed (including stream), trying next');
        fullContent = '';
        errorSent = false;
      }
    } // end modelsToTry loop

    // If no content was generated and no error was already sent
    if (!fullContent.trim() && !errorSent) {
      fullContent = 'I\'m sorry, the AI model didn\'t generate a response. This usually means the LLM provider needs configuration. Please check the Admin Panel > LLM Providers to ensure at least one provider is active and healthy.';
      reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: fullContent })}\n\n`);
    }

    // Send suggestions based on RAG results
    const suggestions = generateSuggestions(ragResults, message);
    reply.raw.write(`event: suggestions\ndata: ${JSON.stringify({ suggestions })}\n\n`);

    // Done
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ sessionId, durationMs: Date.now() - startTime })}\n\n`);

    logger.info({
      sessionId,
      userId: user?.id,
      durationMs: Date.now() - startTime,
      contentLength: fullContent.length,
    }, '[docs-chat] Stream completed');
  } catch (err: any) {
    logger.error({ err, sessionId }, '[docs-chat] Streaming error');

    if (!abortController.signal.aborted) {
      // Send a user-friendly error, never raw provider errors
      const userMessage = 'I\'m sorry, I\'m having trouble connecting to the AI model right now. The platform may need its LLM provider configured. Please try again in a moment or ask your admin to check the provider settings.';
      reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: userMessage })}\n\n`);
      reply.raw.write(`event: done\ndata: {}\n\n`);
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(keepAliveInterval);
    reply.raw.end();
  }
}
