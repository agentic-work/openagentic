/**
 * Admin AI Assistant — SSE handler for /api/admin/ai/ask.
 *
 * Mirrors the docs-chat architecture (routes/docs/chat.handler.ts) but
 * scoped to the admin console: knows about every sidebar page (corpus
 * in admin-page-corpus.ts), can suggest deep-link tokens
 * `[Open <Label>](#<slug>)` that the UI's pageRouter resolves into a
 * setActive(slug) navigation, and uses the Smart Router default model
 * for completions.
 *
 * Replaces the 5-key client-side dictionary stub previously in
 * AdminShellV2.tsx (CANNED). Frontend wire-up is via a useAdminAi hook
 * that mirrors useDocsChat.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../../../utils/logger.js';
import { ProviderManager, getProviderManager } from '../../../services/llm-providers/ProviderManager.js';
import type { CompletionRequest } from '../../../services/llm-providers/ILLMProvider.js';
import { buildAdminCorpusPromptBlock } from './admin-page-corpus.js';

interface AdminAiBody {
  message: string;
  sessionId: string;
  /** Slug of the admin page the user was on when they opened the assistant.
   *  Used to bias answers toward "you're already here" suggestions. */
  currentSection?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const SYSTEM_PROMPT = `You are OpenAgentic's Admin Console assistant. You ONLY answer questions about the admin console itself — its pages, settings, model registry, providers, agents, security, monitoring, integrations.

When you mention a page, ALWAYS link it with a markdown deep-link token of the form:

  [Open <exact label>](#<slug>)

The UI converts those tokens to in-shell navigation buttons. Do NOT use external URLs, do NOT invent slugs. Only use slugs from the catalog below.

Be terse. Three sentences max for explanations. For "how do I..." questions, give a numbered list of the exact UI steps and link the destination page on the first step.

If the user is already on the page they're asking about, lead with that fact and skip the deep-link.

If the question is off-topic (anything not about the admin console), reply:
"I'm scoped to the OpenAgentic admin console. Try one of the suggested questions, or ask about a page in the catalog."

ADMIN STATE — knowledge base baked into your context:`;

export async function adminAiAskHandler(
  request: FastifyRequest<{ Body: AdminAiBody }>,
  reply: FastifyReply,
): Promise<void> {
  const startTime = Date.now();
  const { message, sessionId, currentSection, conversationHistory } = request.body;
  const user = (request as any).user;
  const logger = loggers.routes;

  if (!message || !sessionId) {
    reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'message and sessionId are required' } });
    return;
  }

  logger.info({
    sessionId,
    userId: user?.id,
    currentSection,
    messageLength: message.length,
    historyLength: conversationHistory?.length ?? 0,
  }, '[admin-ai] request received');

  const providerManager: ProviderManager | null = getProviderManager();
  if (!providerManager) {
    reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'LLM provider not ready' } });
    return;
  }

  // Resolve default chat model via the Registry-backed config service.
  let resolvedModel = '';
  try {
    const { ModelConfigurationService } = await import('../../../services/ModelConfigurationService.js');
    const config = await ModelConfigurationService.getConfig();
    resolvedModel = config.defaultModel?.modelId ?? '';
  } catch (err: any) {
    logger.warn({ err: err?.message }, '[admin-ai] could not resolve default model — handler will fail');
  }
  if (!resolvedModel) {
    reply.code(503).send({ error: { code: 'NO_DEFAULT_MODEL', message: 'No default chat model is enabled in the Model Registry. Open #model-management and enable a row.' } });
    return;
  }

  const corpus = buildAdminCorpusPromptBlock();
  const contextLine = currentSection ? `\n\nUSER IS CURRENTLY ON: ${currentSection}` : '';
  const systemContent = `${SYSTEM_PROMPT}\n\n${corpus}${contextLine}`;

  const messages: CompletionRequest['messages'] = [
    { role: 'system', content: systemContent },
  ];
  for (const entry of (conversationHistory ?? []).slice(-8)) {
    messages.push({ role: entry.role, content: entry.content });
  }
  messages.push({ role: 'user', content: message });

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Transfer-Encoding': 'chunked',
  });
  if (reply.raw.socket) {
    reply.raw.socket.setNoDelay(true);
  }
  if (typeof reply.raw.flushHeaders === 'function') {
    reply.raw.flushHeaders();
  }

  const keepAliveInterval = setInterval(() => {
    reply.raw.write(`event: ping\ndata: {"t":${Date.now()}}\n\n`);
  }, 3000);

  const abortController = new AbortController();
  request.raw.on('close', () => {
    clearInterval(keepAliveInterval);
    if (!abortController.signal.aborted) abortController.abort(new Error('Client disconnected'));
  });
  const timeout = setTimeout(() => {
    if (!abortController.signal.aborted) abortController.abort(new Error('Timeout'));
  }, 30_000);

  try {
    reply.raw.write(`event: completion_start\ndata: ${JSON.stringify({ model: resolvedModel, sessionId })}\n\n`);

    const req: CompletionRequest = {
      messages,
      model: resolvedModel,
      temperature: 0.2,
      max_tokens: 1024,
      stream: true,
    } as CompletionRequest;

    const stream = await providerManager.createCompletion(req) as AsyncGenerator<any>;
    let fullContent = '';
    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      let token: string | undefined;
      if (chunk.choices?.[0]) {
        token = chunk.choices[0].delta?.content;
        if (chunk.choices[0].finish_reason) break;
      } else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        token = chunk.delta.text;
      } else if (chunk.type === 'text_delta' && chunk.content) {
        token = chunk.content;
      }
      if (token) {
        fullContent += token;
        reply.raw.write(`event: content\ndata: ${JSON.stringify({ content: token })}\n\n`);
      }
    }

    // Brief follow-up suggestions. Keep client-side simple — no extra LLM hop.
    const suggestions = [
      'How do I add a model?',
      'How do I disable a provider?',
      'Where are DLP rules configured?',
    ];
    reply.raw.write(`event: suggestions\ndata: ${JSON.stringify({ suggestions })}\n\n`);
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ sessionId, durationMs: Date.now() - startTime, length: fullContent.length })}\n\n`);
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, sessionId }, '[admin-ai] stream failed');
    if (!abortController.signal.aborted) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: err?.message ?? 'stream error' })}\n\n`);
    }
  } finally {
    clearInterval(keepAliveInterval);
    clearTimeout(timeout);
    if (!reply.raw.writableEnded) reply.raw.end();
  }
}
