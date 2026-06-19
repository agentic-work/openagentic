/**
 * Agenticode provider endpoint (OSS).
 *
 * Lets the agenticode desktop app use THIS openagentic instance as its LLM
 * provider. The app points `agenticwork_base_url` at the instance and calls:
 *
 *   POST /api/agenticode/v1/messages   Anthropic Messages API (SSE / NDJSON / JSON)
 *   GET  /api/agenticode/config        discovery + connection test (models, default)
 *   GET  /api/agenticode/health        liveness
 *
 * This is a thin bridge over the OSS LLM layer (ProviderManager + the DB model
 * registry) — NOT the enterprise code-mode IDE. There are no sessions, no pty/
 * ws-chat, no storage, no capability gate. OSS exposes only a `chat` role, so a
 * caller-supplied model is honored when the registry knows it, otherwise the
 * request falls back to the admin default chat model.
 *
 * Auth: the OSS unifiedAuth — an `oa_` API key (Authorization: Bearer / x-api-key)
 * or a session JWT.
 */
import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { getProviderManager } from '../services/llm-providers/ProviderManager.js';
import { ModelConfigurationService } from '../services/ModelConfigurationService.js';
import { prisma } from '../utils/prisma.js';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const log = loggers.routes || loggers;

/** Human-readable byte size for the downloads manifest. */
function humanSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

/**
 * Resolve the model + provider for an agenticode request. Honor the caller's
 * model when the registry can route it; otherwise fall back to the admin
 * default chat model. OSS has no `code` role and no capability gate.
 */
async function resolveAgenticodeRouting(
  pm: ReturnType<typeof getProviderManager>,
  callerModel?: string,
): Promise<{ model: string; provider: string }> {
  if (!pm) throw new Error('PROVIDER_MANAGER_UNAVAILABLE');
  if (callerModel && callerModel.trim()) {
    try {
      const alias = pm.resolveModelAlias(callerModel.trim());
      const provider = pm.getProviderForModel(alias);
      if (provider) return { model: alias, provider };
    } catch {
      // caller model not in registry — fall through to the admin default
    }
  }
  const fallback = await ModelConfigurationService.getDefaultChatModel();
  if (!fallback || !fallback.trim()) throw new Error('NO_DEFAULT_CHAT_MODEL');
  const provider = pm.getProviderForModel(fallback);
  return { model: fallback, provider };
}

export const agenticodeRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // ─── GET /health — unauthenticated liveness ──────────────────────────────
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', service: 'agenticode', timestamp: new Date().toISOString() });
  });

  // ─── GET /config — discovery + connection test ───────────────────────────
  fastify.get('/config', { onRequest: authMiddleware }, async (request, reply) => {
    const userId = (request as any).user?.userId || (request as any).user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const models: Array<{ id: string; name: string; providerId: string; available: boolean }> = [];
    try {
      const dbProviders = await prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null },
        orderBy: { priority: 'asc' },
      });
      const seen = new Set<string>();
      for (const dbp of dbProviders) {
        const caps = (dbp.capabilities as any) || {};
        if (caps.chat === false) continue;
        const mc = (dbp.model_config as any) || {};
        const pc = (dbp.provider_config as any) || {};
        const disabled: string[] = Array.isArray(mc.disabledModels) ? mc.disabledModels : [];
        const ids: string[] = [];
        if (Array.isArray(pc.models)) {
          for (const m of pc.models) {
            if (typeof m === 'string') ids.push(m);
            else if (m?.id) ids.push(m.id);
          }
        }
        for (const id of ids) {
          if (!id || seen.has(id) || disabled.includes(id)) continue;
          const lower = id.toLowerCase();
          if (lower.includes('embed') || lower.startsWith('imagen') || lower.includes('image-generation')) continue;
          seen.add(id);
          models.push({ id, providerId: 'openagentic-api', name: id, available: true });
        }
      }
    } catch (err) {
      log.warn({ err }, '[Agenticode] /config — failed to read model registry');
    }

    let defaultModel: string | undefined;
    try {
      defaultModel = (await ModelConfigurationService.getDefaultChatModel()) || undefined;
    } catch {
      /* best-effort */
    }

    // The downloaded app already holds the base URL it was configured with; we
    // report the single in-instance provider + the discoverable chat models.
    return reply.send({
      ok: true,
      status: 'ok',
      service: 'agenticode',
      providers: [{ type: 'openagentic-api', id: 'openagentic-api', name: 'OpenAgentic', enabled: true }],
      models,
      defaultModel,
      messagesEndpoint: '/api/agenticode/v1/messages',
      backend: 'chat-pipeline-direct',
    });
  });

  // ─── POST /v1/messages — Anthropic Messages API (SSE / NDJSON / JSON) ─────
  fastify.post<{
    Body: {
      model?: string;
      max_tokens?: number;
      messages: Array<{ role: string; content: any; [k: string]: any }>;
      system?: string | Array<{ type: string; text: string }>;
      tools?: Array<{ name: string; description?: string; input_schema?: Record<string, any>; [k: string]: any }>;
      stream?: boolean;
      temperature?: number;
      top_p?: number;
      thinking?: { type: string; budget_tokens?: number };
      metadata?: Record<string, any>;
    };
  }>(
    '/v1/messages',
    {
      preHandler: async (request, reply) => {
        // Anthropic clients send x-api-key; bridge it to the Bearer header
        // unifiedAuth expects, then run the normal auth gate.
        const xApiKey = request.headers['x-api-key'];
        if (xApiKey && !request.headers['authorization']) {
          request.headers['authorization'] = `Bearer ${Array.isArray(xApiKey) ? xApiKey[0] : xApiKey}`;
        }
        return authMiddleware(request, reply);
      },
    },
    async (request, reply): Promise<void> => {
      const userId = (request as any).user?.userId || (request as any).user?.id;
      if (!userId) {
        await reply.code(401).send({ type: 'error', error: { type: 'authentication_error', message: 'Unauthorized' } });
        return;
      }

      const pm = getProviderManager();
      if (!pm) {
        await reply.code(503).send({ type: 'error', error: { type: 'overloaded_error', message: 'Provider manager not ready' } });
        return;
      }

      let { model, max_tokens, messages, system, tools, stream = false, temperature, top_p, thinking } = request.body;

      // ── Message normalization (Claude-Code-shaped clients) ──────────────
      // Backfill tool_use_id on tool_result blocks (paired by order), dedup
      // duplicate tool_results (keep the last), and convert OpenAI-style
      // role:'tool' messages to Anthropic user/tool_result — so every provider
      // converter downstream sees one consistent shape.
      if (Array.isArray(messages)) {
        const allToolUseIds: string[] = [];
        for (const m of messages) {
          if (Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'tool_use' && b.id) allToolUseIds.push(b.id);
          if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) for (const tc of (m as any).tool_calls) if (tc?.id) allToolUseIds.push(tc.id);
        }
        let openAiToolIdx = 0;
        messages = messages.map((m: any) => {
          if (m.role !== 'tool') return m;
          const id = (typeof m.tool_call_id === 'string' && m.tool_call_id) ? m.tool_call_id : allToolUseIds[openAiToolIdx];
          openAiToolIdx++;
          const text = typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((b: any) => (typeof b === 'string' ? b : b?.text || JSON.stringify(b))).join('\n')
              : JSON.stringify(m.content ?? '');
          return { role: 'user', content: id ? [{ type: 'tool_result', tool_use_id: id, content: text }] : [{ type: 'text', text }] };
        });

        let trIdx = 0;
        messages = messages.map((m: any) => {
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            const filtered = m.content.filter((b: any) =>
              (b.type === 'thinking' || b.type === 'redacted_thinking') ? b.signature && b.signature.length > 10 : true,
            );
            if (filtered.length === 0) filtered.push({ type: 'text', text: '' });
            return { ...m, content: filtered };
          }
          if (m.role === 'user' && Array.isArray(m.content)) {
            const fixed = m.content
              .map((b: any) => {
                if (b.type !== 'tool_result') return b;
                const id = (typeof b.tool_use_id === 'string' && b.tool_use_id) ? b.tool_use_id : allToolUseIds[trIdx];
                trIdx++;
                return id ? { ...b, tool_use_id: id } : null;
              })
              .filter(Boolean);
            if (fixed.length === 0) fixed.push({ type: 'text', text: '' });
            return { ...m, content: fixed };
          }
          return m;
        });

        // Dedup tool_results by id — keep the chronologically last.
        const seenTr = new Set<string>();
        const deduped: any[] = [];
        for (let i = messages.length - 1; i >= 0; i--) {
          const m: any = messages[i];
          if (m.role !== 'user' || !Array.isArray(m.content)) { deduped.unshift(m); continue; }
          const kept: any[] = [];
          for (let j = m.content.length - 1; j >= 0; j--) {
            const b: any = m.content[j];
            if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string' && b.tool_use_id) {
              if (seenTr.has(b.tool_use_id)) continue;
              seenTr.add(b.tool_use_id);
            }
            kept.unshift(b);
          }
          if (kept.length) deduped.unshift({ ...m, content: kept });
        }
        messages = deduped;
      }

      // ── Resolve model + provider ────────────────────────────────────────
      let effectiveModel: string;
      let providerName: string;
      try {
        const routed = await resolveAgenticodeRouting(pm, model);
        effectiveModel = routed.model;
        providerName = routed.provider;
      } catch (err: any) {
        log.warn({ err: err?.message, requestedModel: model }, '[Agenticode] no usable model');
        await reply.code(400).send({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'No model could be resolved. Register a provider with a chat model in Admin → Models and set a default chat model.',
          },
        });
        return;
      }

      // ── Anthropic → internal message conversion ─────────────────────────
      // Providers that speak OpenAI shape (Ollama / OpenAI / Azure / Foundry)
      // reject Anthropic tool_use blocks in assistant.content — hoist those
      // into assistant.tool_calls and rewrite tool_result → role:'tool'.
      const providerLower = providerName.toLowerCase();
      const wantsOpenAIShape = ['openai', 'foundry', 'azure-ai', 'ollama', 'aif'].some((p) => providerLower.includes(p));

      const internalMessages: any[] = [];
      if (system) {
        internalMessages.push({ role: 'system', content: typeof system === 'string' ? system : system.map((s) => s.text).join('\n') });
      }
      for (const msg of messages) {
        const raw: any = (msg as any).content;
        if (typeof raw === 'string' || raw == null) {
          const copied: any = { role: msg.role, content: raw };
          if ((msg as any).tool_calls) copied.tool_calls = (msg as any).tool_calls;
          if ((msg as any).tool_call_id) copied.tool_call_id = (msg as any).tool_call_id;
          internalMessages.push(copied);
          continue;
        }
        if (!Array.isArray(raw) || !wantsOpenAIShape) {
          const copied: any = { role: msg.role, content: raw };
          if ((msg as any).tool_calls) copied.tool_calls = (msg as any).tool_calls;
          if ((msg as any).tool_call_id) copied.tool_call_id = (msg as any).tool_call_id;
          internalMessages.push(copied);
          continue;
        }
        if (msg.role === 'assistant') {
          const text: string[] = [];
          const toolCalls: any[] = [];
          for (const b of raw) {
            if (!b || typeof b !== 'object') continue;
            if (b.type === 'text' && typeof b.text === 'string') text.push(b.text);
            else if (b.type === 'tool_use') toolCalls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}) } });
          }
          const out: any = { role: 'assistant', content: text.join('') || null };
          if (toolCalls.length) out.tool_calls = toolCalls;
          internalMessages.push(out);
        } else if (msg.role === 'user') {
          const text: string[] = [];
          const toolResults: Array<{ id: string; content: string }> = [];
          for (const b of raw) {
            if (!b || typeof b !== 'object') continue;
            if (b.type === 'text' && typeof b.text === 'string') text.push(b.text);
            else if (b.type === 'tool_result') {
              const c = typeof b.content === 'string'
                ? b.content
                : Array.isArray(b.content) ? b.content.map((x: any) => (x?.type === 'text' ? x.text : JSON.stringify(x))).join('\n') : JSON.stringify(b.content ?? '');
              toolResults.push({ id: b.tool_use_id || b.id || '', content: c });
            }
          }
          for (const tr of toolResults) internalMessages.push({ role: 'tool', tool_call_id: tr.id, content: tr.content });
          if (text.length) internalMessages.push({ role: 'user', content: text.join('') });
        } else {
          internalMessages.push({ role: msg.role, content: raw });
        }
      }

      // Tools: accept Anthropic {name,description,input_schema} OR OpenAI-nested
      // and always emit OpenAI-nested for the provider layer.
      const internalTools = tools?.map((raw: any) => ({
        type: 'function' as const,
        function: {
          name: raw?.function?.name ?? raw?.name ?? '',
          description: raw?.function?.description ?? raw?.description,
          parameters: raw?.function?.parameters ?? raw?.input_schema ?? raw?.parameters,
        },
      }));

      const completionRequest: any = {
        model: effectiveModel,
        messages: internalMessages,
        tools: internalTools,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 8192,
        stream,
        top_p,
      };
      if (thinking) completionRequest.thinking = thinking;

      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      if (!stream) {
        try {
          const response = await pm.createCompletion(completionRequest, providerName) as any;
          const content: any[] = [];
          const message = response?.choices?.[0]?.message;
          if (message?.thinking || message?.reasoning) content.push({ type: 'thinking', thinking: message.thinking || message.reasoning });
          if (message?.content) content.push({ type: 'text', text: message.content });
          if (Array.isArray(message?.tool_calls)) {
            for (const tc of message.tool_calls) {
              let input: unknown;
              if (typeof tc.function?.arguments === 'string') {
                try { input = JSON.parse(tc.function.arguments || '{}'); }
                catch { input = { __malformed_args: true, __raw_args: tc.function.arguments }; }
              } else input = tc.function?.arguments || {};
              content.push({ type: 'tool_use', id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: tc.function?.name, input });
            }
          }
          const finish = response?.choices?.[0]?.finish_reason;
          const stopReason = finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn';
          await reply.send({
            id: messageId,
            type: 'message',
            role: 'assistant',
            content,
            model: effectiveModel,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
              input_tokens: response?.usage?.prompt_tokens || 0,
              output_tokens: response?.usage?.completion_tokens || 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          });
        } catch (error: any) {
          log.error({ error: error?.message, userId }, '[Agenticode] /v1/messages non-streaming error');
          await reply.code(500).send({ type: 'error', error: { type: 'api_error', message: error?.message || 'completion failed' } });
        }
        return;
      }

      // ── Streaming: Anthropic SSE (default) or NDJSON (Accept negotiation) ──
      const useNDJSON = String(request.headers['accept'] || '').toLowerCase().includes('application/x-ndjson');
      const writeEvent = (evt: any) => {
        if (useNDJSON) reply.raw.write(JSON.stringify(evt) + '\n');
        else reply.raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
      };
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': useNDJSON ? 'application/x-ndjson' : 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        const gen = (await pm.createCompletion(completionRequest, providerName)) as AsyncGenerator<any>;
        writeEvent({
          type: 'message_start',
          message: { id: messageId, type: 'message', role: 'assistant', content: [], model: effectiveModel, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
        });

        let blockIndex = 0;
        let currentBlock: string | null = null;
        const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
        let outputTokens = 0;
        let chars = 0;

        for await (const chunk of gen) {
          if (chunk.usage?.output_tokens) outputTokens = chunk.usage.output_tokens;
          if (chunk.usage?.completion_tokens) outputTokens = chunk.usage.completion_tokens;

          // OllamaProvider (and other Anthropic-native providers) already emit
          // content_block_* — forward verbatim.
          if (typeof chunk.type === 'string' && (chunk.type === 'content_block_start' || chunk.type === 'content_block_delta' || chunk.type === 'content_block_stop')) {
            if (chunk.type === 'content_block_start') { currentBlock = chunk.content_block?.type ?? null; blockIndex = (chunk.index ?? blockIndex) + 1; }
            if (chunk.type === 'content_block_delta' && chunk.delta?.text) chars += chunk.delta.text.length;
            writeEvent(chunk);
            continue;
          }

          // OpenAI-shape (Bedrock, OpenAI, etc.) → Anthropic blocks.
          if (chunk.choices && chunk.choices[0]) {
            const choice = chunk.choices[0];
            const delta = choice.delta || {};
            if (delta.thinking || delta.reasoning) {
              if (currentBlock !== 'thinking') {
                if (currentBlock) writeEvent({ type: 'content_block_stop', index: blockIndex - 1 });
                writeEvent({ type: 'content_block_start', index: blockIndex, content_block: { type: 'thinking', thinking: '' } });
                currentBlock = 'thinking'; blockIndex++;
              }
              writeEvent({ type: 'content_block_delta', index: blockIndex - 1, delta: { type: 'thinking_delta', thinking: delta.thinking || delta.reasoning } });
            }
            if (delta.content) {
              if (currentBlock !== 'text') {
                if (currentBlock) writeEvent({ type: 'content_block_stop', index: blockIndex - 1 });
                writeEvent({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } });
                currentBlock = 'text'; blockIndex++;
              }
              chars += delta.content.length;
              writeEvent({ type: 'content_block_delta', index: blockIndex - 1, delta: { type: 'text_delta', text: delta.content } });
            }
            if (delta.tool_calls?.length) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const existing = pendingToolCalls.get(idx);
                if (tc.id) {
                  pendingToolCalls.set(idx, { id: tc.id, name: tc.function?.name || '', arguments: tc.function?.arguments || '' });
                  if (currentBlock) writeEvent({ type: 'content_block_stop', index: blockIndex - 1 });
                  writeEvent({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: tc.id, name: tc.function?.name || '', input: {} } });
                  currentBlock = 'tool_use'; blockIndex++;
                  if (tc.function?.arguments) {
                    const argsStr = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
                    writeEvent({ type: 'content_block_delta', index: blockIndex - 1, delta: { type: 'input_json_delta', partial_json: argsStr } });
                  }
                } else if (existing && tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                  writeEvent({ type: 'content_block_delta', index: blockIndex - 1, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } });
                }
              }
            }
            if (choice.finish_reason) {
              if (currentBlock) writeEvent({ type: 'content_block_stop', index: blockIndex - 1 });
              const stop = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
              writeEvent({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: outputTokens } });
            }
          } else if (chunk.type) {
            if (chunk.type === 'content_block_start' && chunk.content_block) {
              if (chunk.content_block.type === 'text' && !('text' in chunk.content_block)) chunk.content_block.text = '';
              if (chunk.content_block.type === 'thinking' && !('thinking' in chunk.content_block)) chunk.content_block.thinking = '';
            }
            writeEvent(chunk);
          }
        }

        writeEvent({
          type: 'message_delta',
          delta: { stop_reason: pendingToolCalls.size > 0 ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: outputTokens || Math.ceil(chars / 4) },
        });
        writeEvent({ type: 'message_stop' });
        reply.raw.end();
      } catch (error: any) {
        log.error({ error: error?.message, userId }, '[Agenticode] /v1/messages stream error');
        try { writeEvent({ type: 'error', error: { type: 'api_error', message: error?.message || 'stream failed' } }); reply.raw.end(); } catch { /* socket already closed */ }
      }
    },
  );

  // ─── agenticode desktop downloads — served BY this instance ──────────────
  // Installers live outside git in AGENTICODE_BUNDLE_DIR (a mounted volume), so
  // the download origin IS this openagentic endpoint — exactly the provider the
  // app binds to. Public (the binaries aren't secret; the bind key is minted
  // separately by the codemode page's Connect action).
  const BUNDLE_DIR = process.env.AGENTICODE_BUNDLE_DIR || '/app/agenticode-bundles';
  // PLACEHOLDER GATE: downloads stay "coming soon" until signed + notarized
  // builds exist — an unsigned .exe/.dmg trips Windows SmartScreen / macOS
  // Gatekeeper "unknown developer". Flip CODEMODE_DOWNLOADS_PUBLISHED=true (and
  // drop the signed installers in AGENTICODE_BUNDLE_DIR) to publish them.
  const DOWNLOADS_PUBLISHED = process.env.CODEMODE_DOWNLOADS_PUBLISHED === 'true';
  const PLATFORM_FILES: Record<string, { file: string; mime: string }> = {
    windows: { file: 'agenticode-windows-x64.exe', mime: 'application/vnd.microsoft.portable-executable' },
    macos: { file: 'agenticode-macos.dmg', mime: 'application/x-apple-diskimage' },
  };

  // GET /api/agenticode/downloads — manifest. `published:false` => placeholder.
  fastify.get('/downloads', async (_request, reply) => {
    const out: Record<string, any> = { published: DOWNLOADS_PUBLISHED };
    for (const [platform, meta] of Object.entries(PLATFORM_FILES)) {
      const p = join(BUNDLE_DIR, meta.file);
      if (DOWNLOADS_PUBLISHED && existsSync(p)) {
        const st = statSync(p);
        out[platform] = { available: true, filename: meta.file, size: humanSize(st.size), bytes: st.size };
      } else {
        out[platform] = { available: false };
      }
    }
    return reply.send(out);
  });

  // GET /api/agenticode/download/:platform — stream the installer (gated).
  fastify.get<{ Params: { platform: string } }>('/download/:platform', async (request, reply) => {
    if (!DOWNLOADS_PUBLISHED) return reply.code(404).send({ error: 'Signed builds coming soon' });
    const meta = PLATFORM_FILES[request.params.platform];
    if (!meta) return reply.code(404).send({ error: 'Unknown platform' });
    const p = join(BUNDLE_DIR, meta.file);
    if (!existsSync(p)) return reply.code(404).send({ error: `No ${request.params.platform} build published yet` });
    reply.header('Content-Type', meta.mime);
    reply.header('Content-Disposition', `attachment; filename="${basename(meta.file)}"`);
    reply.header('Content-Length', String(statSync(p).size));
    return reply.send(createReadStream(p));
  });
};

export default agenticodeRoutes;
