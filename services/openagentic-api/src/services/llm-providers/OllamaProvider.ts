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
 * Ollama Provider
 *
 * Implements ILLMProvider for Ollama local models
 * Supports function calling via native Ollama tool support
 */

import type { Logger } from 'pino';
import { randomUUID } from 'crypto';
import {
  BaseLLMProvider,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth,
  type ProviderConfig,
  type DiscoveredModel,
  type NormalizerState,
} from './ILLMProvider.js';
import { getRedisClient } from '../../utils/redis-client.js';
import { NormalizedStreamEvent } from '../NormalizedStreamTypes.js';

// Simple semaphore for single-GPU concurrency control
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  get pending() { return this.queue.length; }
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next(); else this.permits++;
  }
}

export class OllamaProvider extends BaseLLMProvider {
  readonly name = 'ollama';
  readonly type = 'ollama' as const;
  readonly streamFormat = 'openai' as const; // Uses OpenAI-compatible format
  private baseUrl: string;
  private healthCheckModel: string;
  private readonly instanceId: string; // Unique ID for this instance (used for distributed locks)
  private apiKey?: string; // Optional API key for authenticated Ollama endpoints
  private keepAlive: string; // Model caching - how long to keep model in GPU memory
  // Concurrency control for single-GPU Ollama: prevents OOM + long queuing
  private readonly completionSemaphore: Semaphore;

  constructor(logger: Logger, config?: { baseUrl?: string; healthCheckModel?: string; apiKey?: string; keepAlive?: string }) {
    super(logger, 'ollama');
    // Generate unique instance ID for distributed locking (prevents multiple pods from pulling simultaneously)
    this.instanceId = `ollama-${process.env.HOSTNAME || 'unknown'}-${randomUUID().slice(0, 8)}`;
    // No hardcoded defaults - all values must come from config or environment
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || '';
    this.healthCheckModel = config?.healthCheckModel || process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || '';
    this.apiKey = config?.apiKey || process.env.OLLAMA_API_KEY;
    // Model caching: keep_alive controls how long Ollama keeps the model in GPU memory
    // See: https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately
    // Valid values: "5m" (5 minutes), "1h" (1 hour), "-1" (forever), "0" (unload immediately)
    // Default: "30m" (30 minutes) - keeps model loaded for faster subsequent requests
    this.keepAlive = config?.keepAlive || process.env.OLLAMA_KEEP_ALIVE || '30m';

    if (!this.baseUrl) {
      this.logger.warn('[OllamaProvider] OLLAMA_BASE_URL not configured');
    }
    if (!this.healthCheckModel) {
      this.logger.warn('[OllamaProvider] OLLAMA_CHAT_MODEL not configured');
    }

    // Max concurrent completions — single GPU can handle 2-3 concurrent requests
    // before context thrashing kills throughput
    const maxConcurrent = parseInt(process.env.OLLAMA_MAX_CONCURRENT || '2', 10);
    this.completionSemaphore = new Semaphore(maxConcurrent);

    this.initialized = true; // Ollama doesn't require async init

    this.logger.info({
      baseUrl: this.baseUrl,
      healthCheckModel: this.healthCheckModel,
      hasApiKey: !!this.apiKey,
      keepAlive: this.keepAlive,
      maxConcurrent,
    }, '[OllamaProvider] Initialized with model caching (keep_alive)');
  }

  /**
   * Get headers for Ollama API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    // Apply config from database/provider configuration
    if (config) {
      if (config.baseUrl) {
        this.baseUrl = config.baseUrl;
        this.logger.info({ baseUrl: this.baseUrl }, '[OllamaProvider] Applied baseUrl from config');
      }
      if (config.chatModel || config.healthCheckModel || config.modelId) {
        this.healthCheckModel = config.chatModel || config.healthCheckModel || config.modelId;
        this.logger.info({ healthCheckModel: this.healthCheckModel }, '[OllamaProvider] Applied model from config');
      }
      if (config.apiKey) {
        this.apiKey = config.apiKey;
      }
      if (config.keepAlive) {
        this.keepAlive = config.keepAlive;
      }
    }

    if (!this.baseUrl) {
      throw new Error('[OllamaProvider] baseUrl not configured - check database provider_config.baseUrl');
    }

    this.initialized = true;
    this.logger.info({
      baseUrl: this.baseUrl,
      healthCheckModel: this.healthCheckModel,
      hasApiKey: !!this.apiKey,
      keepAlive: this.keepAlive
    }, '[OllamaProvider] Initialized with config from database');
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    // Query Ollama API for locally loaded/pulled models only — no hardcoded catalog
    const models: Array<{ id: string; name: string; provider: string; description?: string; parameterSize?: string }> = [];
    const addedModelIds = new Set<string>();

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        for (const m of (data.models || [])) {
          const id = m.name || m.model;
          if (id && !addedModelIds.has(id)) {
            addedModelIds.add(id);
            models.push({
              id,
              name: m.name || id,
              provider: 'ollama',
              description: `Loaded locally — ${m.details?.parameter_size || 'unknown size'}`,
              parameterSize: m.details?.parameter_size
            });
          }
        }
      }
    } catch (error) {
      this.logger.error({ error }, '[OllamaProvider] Failed to query Ollama API for loaded models');
    }

    this.logger.info({
      totalModels: models.length,
      models: models.map(m => m.id),
    }, '[OllamaProvider] Listed locally loaded models');

    return models;
  }

  /**
   * Check if model exists locally
   */
  private async modelExists(modelName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders()
      });
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      const models = data.models || [];
      // Ollama returns names with `:latest` suffix (e.g., "gpt-oss:latest")
      // but requests often use short names (e.g., "gpt-oss"). Match both forms.
      const normalizedName = modelName.includes(':') ? modelName : `${modelName}:latest`;
      return models.some((m: any) => m.name === modelName || m.name === normalizedName);
    } catch (error) {
      this.logger.error({ error, modelName }, '[OllamaProvider] Failed to check if model exists');
      return false;
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  private async pullModel(modelName: string): Promise<void> {
    try {
      this.logger.info({ modelName }, '[OllamaProvider] Pulling model from registry');

      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body from Ollama pull');
      }

      // Stream the pull progress
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line);
            if (chunk.status) {
              this.logger.debug({ modelName, status: chunk.status }, '[OllamaProvider] Pull progress');
            }
            if (chunk.error) {
              throw new Error(chunk.error);
            }
          } catch (parseError) {
            // Ignore parse errors, continue streaming
          }
        }
      }

      this.logger.info({ modelName }, '[OllamaProvider] Model pulled successfully');
    } catch (error) {
      this.logger.error({ error, modelName }, '[OllamaProvider] Failed to pull model');
      throw error;
    }
  }

  /**
   * Ensure model exists on Ollama host — throws if not found.
   * NEVER auto-pulls models. Models must be explicitly managed via Ollama CLI or admin API.
   * Auto-pull caused deleted models to reappear (e.g. qwen deleted from host, re-pulled on next request).
   */
  private async ensureModelExists(modelName: string): Promise<void> {
    try {
      const exists = await this.modelExists(modelName);
      if (exists) {
        this.logger.debug({ modelName }, '[OllamaProvider] Model exists locally');
        return;
      }

      this.logger.warn({ modelName }, '[OllamaProvider] Model not found on Ollama host — will NOT auto-pull');
      throw new Error(`Model '${modelName}' is not available on the Ollama host. Use 'ollama pull ${modelName}' or the admin API to add it.`);
    } catch (error) {
      if ((error as Error).message?.includes('not available on the Ollama host')) {
        throw error; // Re-throw our own error
      }
      this.logger.error({ error, modelName }, '[OllamaProvider] Failed to check model availability');
      throw error;
    }
  }

  /**
   * Create chat completion
   */
  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    // Concurrency gate — wait for a permit before hitting the GPU
    const queueDepth = this.completionSemaphore.pending;
    if (queueDepth > 0) {
      this.logger.info({ queueDepth, model: request.model }, '[OllamaProvider] ⏳ Waiting for GPU slot');
    }
    await this.completionSemaphore.acquire();
    let semaphoreReleased = false;
    const releaseSemaphore = () => {
      if (!semaphoreReleased) {
        semaphoreReleased = true;
        this.completionSemaphore.release();
      }
    };

    const startTime = Date.now();

    try {
      this.metrics.totalRequests++;

      // DEBUG: Log incoming tools to verify pipeline is passing them
      this.logger.info({
        hasTools: !!request.tools,
        toolCount: request.tools?.length || 0,
        toolNames: request.tools?.slice(0, 5).map((t: any) => t.function?.name || t.name) || [],
        model: request.model
      }, '[OllamaProvider] 📥 createCompletion called - checking incoming tools');

      // Strip 'ollama/' or 'ollama:' prefix if present
      // The API may receive "ollama/devstral" or "ollama:gpt-oss" but Ollama needs just "devstral" or "gpt-oss"
      let modelName = request.model || this.healthCheckModel;
      if (modelName.startsWith('ollama/')) {
        modelName = modelName.substring(7);
      } else if (modelName.startsWith('ollama:')) {
        modelName = modelName.substring(7);
      }

      // Ensure model exists, pull if necessary
      await this.ensureModelExists(modelName);

      // Convert OpenAI-style tools to Ollama format
      const tools = request.tools ? this.convertToolsToOllama(request.tools) : undefined;

      // Detect gpt-oss model - for special handling of thinking output chunking
      // NOTE: gpt-oss DOES support native Ollama tool calling (confirmed via testing)
      const isGptOss = modelName.toLowerCase().includes('gpt-oss');

      // DEBUG: Log gpt-oss detection (all models use native tools now)
      if (isGptOss) {
        this.logger.info({
          modelName,
          isGptOss,
          hasTools: !!tools,
          toolCount: tools?.length || 0,
          usingNativeTools: true
        }, '[OllamaProvider] 🔍 gpt-oss detected - using native Ollama tool calling');
      }

      // gpt-oss thinking chunk size: break thinking into smaller chunks for interleaved display
      // gpt-oss outputs all thinking at once, so we artificially chunk it for better UX
      // Set via OLLAMA_GPT_OSS_THINKING_CHUNK_SIZE env var (default: 100 chars per chunk)
      const gptOssThinkingChunkSize = parseInt(process.env.OLLAMA_GPT_OSS_THINKING_CHUNK_SIZE || '100', 10);

      // Thinking detection: enable if the request asks for it (adaptive or enabled)
      // OR if env var OLLAMA_THINKING_MODELS lists it. No env vars needed for the
      // common case — the CLI/API tells us whether to enable thinking via the request.
      const modelLower = modelName.toLowerCase();
      const requestThinkingType = (request as any).thinking?.type;
      const thinkingModels = (process.env.OLLAMA_THINKING_MODELS || '').split(',').map(m => m.trim().toLowerCase()).filter(Boolean);
      const supportsThinking = requestThinkingType === 'enabled' || requestThinkingType === 'adaptive' ||
                               thinkingModels.some(m => modelLower.includes(m));

      // REMOVED: gpt-oss system prompt injection - gpt-oss DOES support native Ollama tool calling!
      // Testing confirmed gpt-oss outputs tool_calls in the response when passed tools via the tools API.
      // See: curl test showing tool_calls: [{ "id": "call_xxx", "function": { "name": "...", "arguments": {...} } }]

      // Build Ollama request
      const ollamaRequest: any = {
        model: modelName,
        messages: this.convertMessages(request.messages),
        options: {
          temperature: request.temperature ?? 0.7,
          top_p: request.top_p ?? 1,
          num_predict: request.max_tokens ?? 8192
        },
        stream: request.stream ?? true,
        // Model caching: keep_alive controls how long model stays in GPU memory
        // This is Ollama's form of "caching" - keeps model loaded for faster subsequent requests
        keep_alive: this.keepAlive
      };

      // Enable thinking for supported models
      // This will cause Ollama to return message.thinking field with reasoning content
      if (supportsThinking) {
        ollamaRequest.think = true;
        this.logger.info({
          model: modelName,
          thinkingEnabled: true
        }, '[OllamaProvider] 🧠 Thinking mode enabled for Ollama model');
      }

      // Add tools if present — but only for models that support them.
      // Models like gemma3 return 400 if tools are included.
      if (tools && tools.length > 0) {
        // Check discovered capabilities to see if this model supports tools
        let modelSupportsTools = true;
        try {
          const { getProviderManager } = await import('./ProviderManager.js');
          const pm = getProviderManager();
          const disc = pm?.getDiscoveredCapabilities(modelName);
          if (disc && disc.capabilities.tools === false) {
            modelSupportsTools = false;
          }
        } catch { /* ignore — default to including tools */ }

        if (modelSupportsTools) {
          ollamaRequest.tools = tools;
          this.logger.info({
            model: modelName,
            toolCount: tools.length,
            toolNames: tools.slice(0, 5).map((t: any) => t.function?.name || t.name)
          }, '[OllamaProvider] 🔧 Native tools added to Ollama request');
        } else {
          this.logger.warn({
            model: modelName,
            toolCount: tools.length,
          }, '[OllamaProvider] ⚠️ Stripping tools — model does not support tool calling');
        }
      }

      this.logger.info({
        model: modelName,
        messageCount: request.messages.length,
        toolCount: tools?.length || 0,
        stream: request.stream,
        thinkingEnabled: supportsThinking,
        isGptOss
      }, '[OllamaProvider] Creating completion');

      if (request.stream) {
        // For streaming: wrap generator to release semaphore when stream completes
        const innerGen = this.streamCompletion(ollamaRequest, modelName, startTime, isGptOss, gptOssThinkingChunkSize);
        const release = releaseSemaphore;
        async function* wrappedStream() {
          try { yield* innerGen; }
          finally { release(); }
        }
        return wrappedStream();
      } else {
        try {
          return await this.nonStreamCompletion(ollamaRequest, modelName, startTime);
        } finally {
          releaseSemaphore();
        }
      }
    } catch (error) {
      releaseSemaphore();
      this.trackFailure();
      this.logger.error({ error }, '[OllamaProvider] Completion failed');
      throw error;
    }
  }

  /**
   * Stream completion (returns AsyncGenerator)
   * For gpt-oss: breaks thinking into smaller chunks for interleaved display
   */
  private async *streamCompletion(
    ollamaRequest: any,
    modelName: string,
    startTime: number,
    isGptOss: boolean = false,
    gptOssThinkingChunkSize: number = 100
  ): AsyncGenerator<any> {
    try {
      const url = `${this.baseUrl}/api/chat`;

      // CRITICAL: Merge consecutive system messages into one.
      // Ollama models (especially gpt-oss) break with multiple system messages —
      // they stop generating content after tool results when confused by the message structure.
      if (ollamaRequest.messages?.length > 1) {
        const merged: any[] = [];
        for (const msg of ollamaRequest.messages) {
          const prev = merged[merged.length - 1];
          if (prev && prev.role === 'system' && msg.role === 'system') {
            // Merge consecutive system messages
            prev.content = (prev.content || '') + '\n\n' + (msg.content || '');
          } else {
            merged.push({ ...msg });
          }
        }
        if (merged.length < ollamaRequest.messages.length) {
          this.logger.info({
            original: ollamaRequest.messages.length,
            merged: merged.length,
            systemMerged: ollamaRequest.messages.length - merged.length
          }, '[OllamaProvider] Merged consecutive system messages');
        }
        ollamaRequest.messages = merged;
      }

      // CRITICAL: Trim system messages for local models.
      // Session history often contains the FULL 10K+ system prompt from cloud models.
      // gpt-oss chokes on massive system prompts — trim to 6K with tool instructions suffix.
      const MAX_SYSTEM_CHARS = 6000;
      for (let i = 0; i < (ollamaRequest.messages?.length || 0); i++) {
        const msg = ollamaRequest.messages[i];
        if (msg.role === 'system' && (msg.content || '').length > MAX_SYSTEM_CHARS) {
          const originalLen = msg.content.length;
          msg.content = msg.content.substring(0, MAX_SYSTEM_CHARS) +
            '\n\n---\n## CRITICAL INSTRUCTIONS\nYou have tools. ALWAYS use them for Azure/AWS/GCP operations — do NOT ask the user for IDs. ' +
            'After getting tool results:\n1. Write a brief TEXT SUMMARY first (e.g., "Azure: $31.85 across 9 services. AWS: $471 across 6 services.")\n' +
            '2. Then create the visualization using ```artifact:html\n3. Do NOT just output code — always include human-readable text explaining the results.';
          this.logger.info({
            index: i,
            originalLen,
            trimmedLen: msg.content.length,
            maxChars: MAX_SYSTEM_CHARS,
          }, '[OllamaProvider] Trimmed oversized system message for local model');
        }
      }

      // Log request summary
      const msgSummary = ollamaRequest.messages?.map((m: any) => ({
        role: m.role,
        contentLen: (m.content || '').length,
        hasToolCalls: !!(m.tool_calls?.length),
        toolCallCount: m.tool_calls?.length || 0
      }));
      this.logger.info({
        url,
        model: ollamaRequest.model,
        baseUrl: this.baseUrl,
        messageCount: ollamaRequest.messages?.length,
        messages: msgSummary,
        hasTools: !!ollamaRequest.tools,
        toolCount: ollamaRequest.tools?.length || 0
      }, '[OllamaProvider] 🚀 Sending request to Ollama');

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(ollamaRequest)
      });

      if (!response.ok) {
        // DEBUG: Log the failed response details
        const errorText = await response.text().catch(() => 'unable to read response body');
        this.logger.error({
          url,
          status: response.status,
          statusText: response.statusText,
          errorText: errorText.substring(0, 500),
          model: ollamaRequest.model
        }, '[OllamaProvider] ❌ Ollama API request failed');
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body from Ollama');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalTokens = 0;
      let accumulatedContent = ''; // Accumulate content for gpt-oss tool call parsing
      let hasNativeToolCalls = false;
      let storedToolCalls: any[] = []; // Store tool calls when they arrive (before done:true)

      // INTERLEAVED THINKING: Track block indices for proper interleaving
      let blockIndex = 0;
      let currentBlockType: 'thinking' | 'text' | null = null;
      let accumulatedThinking = ''; // Track thinking content to detect duplicates

      while (true) {
        const { done, value } = await reader.read();

        // Add any new data to buffer
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        // Split buffer into lines
        const lines = buffer.split('\n');

        // CRITICAL FIX: If stream is done, process ALL lines including the final chunk
        // The final chunk from Ollama contains tool_calls and may not end with newline
        if (done) {
          // Stream complete - process all remaining lines
          buffer = '';
        } else {
          // Keep incomplete line in buffer for next iteration
          buffer = lines.pop() || '';
        }

        // Process all complete lines
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line);

            // DEBUG: Log every chunk to trace tool call detection
            if (chunk.done || chunk.message?.tool_calls) {
              this.logger.info({
                model: modelName,
                done: chunk.done,
                hasToolCalls: !!chunk.message?.tool_calls,
                toolCallsLength: chunk.message?.tool_calls?.length || 0,
                toolNames: chunk.message?.tool_calls?.map((tc: any) => tc.function?.name) || [],
                hasContent: !!chunk.message?.content,
                hasThinking: !!chunk.message?.thinking,
                chunkKeys: Object.keys(chunk),
                messageKeys: chunk.message ? Object.keys(chunk.message) : []
              }, '[OllamaProvider] 🔍 DEBUG: Chunk with done=true or tool_calls');
            }

            // Track if we have native tool calls and STORE them
            // Tool calls can arrive in the FINAL chunk (done:true) - this is the norm for gpt-oss
            if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
              hasNativeToolCalls = true;
              storedToolCalls = chunk.message.tool_calls;
              this.logger.info({
                model: modelName,
                toolCount: storedToolCalls.length,
                tools: storedToolCalls.map((tc: any) => tc.function?.name),
                chunkDone: chunk.done
              }, '[OllamaProvider] 🔧 Detected native tool calls');
            }

            // Accumulate content for potential gpt-oss tool call parsing
            if (chunk.message?.content) {
              accumulatedContent += chunk.message.content;
            }

            // INTERLEAVED THINKING: Handle thinking content from Ollama (when think=true)
            // Ollama returns thinking in message.thinking field for models like DeepSeek, Qwen3
            const thinkingText = chunk.message?.thinking;
            const contentText = chunk.message?.content;

            // Track thinking content to detect duplicates
            if (thinkingText) {
              accumulatedThinking += thinkingText;

              // For gpt-oss: break large thinking into smaller chunks for interleaved display
              // This simulates the interleaved thinking behavior of Anthropic models
              if (isGptOss && thinkingText.length > gptOssThinkingChunkSize) {
                // Break into chunks and emit as separate thinking blocks
                const chunks: string[] = [];
                for (let i = 0; i < thinkingText.length; i += gptOssThinkingChunkSize) {
                  chunks.push(thinkingText.slice(i, i + gptOssThinkingChunkSize));
                }

                for (const chunk of chunks) {
                  // Close previous block if switching from text
                  if (currentBlockType === 'text') {
                    yield { type: 'content_block_stop', index: blockIndex };
                    blockIndex++;
                  }

                  // Start new thinking block
                  yield {
                    type: 'content_block_start',
                    index: blockIndex,
                    content_block: { type: 'thinking' }
                  };
                  currentBlockType = 'thinking';

                  // Emit thinking delta
                  yield {
                    type: 'content_block_delta',
                    index: blockIndex,
                    delta: { type: 'thinking_delta', thinking: chunk }
                  };

                  // Close this thinking block to simulate interleaving
                  yield { type: 'content_block_stop', index: blockIndex };
                  blockIndex++;
                  currentBlockType = null;
                }
              } else {
                // Non-gpt-oss or small thinking: emit normally
                // Start a new thinking block if not already in one
                if (currentBlockType !== 'thinking') {
                  // Close previous block if any
                  if (currentBlockType !== null) {
                    yield {
                      type: 'content_block_stop',
                      index: blockIndex
                    };
                    blockIndex++;
                  }

                  // Start new thinking block
                  yield {
                    type: 'content_block_start',
                    index: blockIndex,
                    content_block: { type: 'thinking' }
                  };
                  currentBlockType = 'thinking';
                }

                // Emit thinking delta with block index
                yield {
                  type: 'content_block_delta',
                  index: blockIndex,
                  delta: {
                    type: 'thinking_delta',
                    thinking: thinkingText
                  }
                };
              }
            }

            // INTERLEAVED THINKING: Handle text content
            // Skip if content matches thinking (prevents doubling)
            if (contentText) {
              // Check if this content was already shown as thinking (duplicate detection)
              const isDuplicate = thinkingText && contentText === thinkingText;

              if (!isDuplicate) {
                // Start a new text block if switching from thinking
                if (currentBlockType !== 'text') {
                  // Close previous block if any
                  if (currentBlockType !== null) {
                    yield {
                      type: 'content_block_stop',
                      index: blockIndex
                    };
                    blockIndex++;
                  }

                  // Start new text block
                  yield {
                    type: 'content_block_start',
                    index: blockIndex,
                    content_block: { type: 'text' }
                  };
                  currentBlockType = 'text';
                }

                // Emit text delta with block index
                yield {
                  type: 'content_block_delta',
                  index: blockIndex,
                  delta: {
                    type: 'text_delta',
                    text: contentText
                  }
                };
              } else {
                this.logger.debug({
                  contentLength: contentText.length
                }, '[OllamaProvider] Skipping duplicate content (matches thinking)');
              }
            }
            // NOTE: Do NOT yield OpenAI-compatible format here - pipeline handles content_block events
            // This prevents doubled content in the UI

            // Check if done
            if (chunk.done) {
              // INTERLEAVED THINKING: Close the final block
              if (currentBlockType !== null) {
                yield {
                  type: 'content_block_stop',
                  index: blockIndex
                };
              }
              totalTokens = (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0);
              const latency = Date.now() - startTime;
              this.trackSuccess(latency, totalTokens, 0); // Ollama is free

              // Handle native tool calls from Ollama
              // Tool calls arrive in an intermediate chunk (done:false), so use storedToolCalls
              if (hasNativeToolCalls && storedToolCalls.length > 0) {
                this.logger.info({
                  model: modelName,
                  toolCount: storedToolCalls.length,
                  tools: storedToolCalls.map((tc: any) => tc.function?.name)
                }, '[OllamaProvider] 🔧 Emitting stored native tool calls at stream completion');

                // Emit the native tool calls in OpenAI-compatible format
                yield {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: modelName,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: storedToolCalls.map((tc: any, index: number) => ({
                        index,
                        id: tc.id || `call_${Date.now()}_${index}`,
                        type: 'function',
                        function: {
                          name: this.sanitizeToolName(tc.function?.name),
                          arguments: typeof tc.function?.arguments === 'string'
                            ? tc.function.arguments
                            : JSON.stringify(tc.function?.arguments || {})
                        }
                      }))
                    },
                    finish_reason: 'tool_calls'
                  }],
                  usage: {
                    prompt_tokens: chunk.prompt_eval_count || 0,
                    completion_tokens: chunk.eval_count || 0,
                    total_tokens: totalTokens
                  }
                };
              } else if (!hasNativeToolCalls && accumulatedContent) {
                // FALLBACK: If no native tool calls, try to parse channel-based tool calls
                const parsed = this.parseGptOssToolCalls(accumulatedContent);
                if (parsed && parsed.toolCalls.length > 0) {
                  this.logger.info({
                    model: modelName,
                    toolCount: parsed.toolCalls.length,
                    tools: parsed.toolCalls.map(t => t.function.name)
                  }, '[OllamaProvider] Detected gpt-oss channel-based tool calls in streamed content');

                  // Emit a final chunk with the parsed tool calls
                  yield {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: modelName,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: parsed.toolCalls.map((tc, index) => ({
                          index,
                          ...tc
                        }))
                      },
                      finish_reason: 'tool_calls'
                    }],
                    // Include cleaned content info
                    _gptoss_clean_content: parsed.cleanContent,
                    usage: {
                      prompt_tokens: chunk.prompt_eval_count || 0,
                      completion_tokens: chunk.eval_count || 0,
                      total_tokens: totalTokens
                    }
                  };
                }
              }

              this.logger.info({
                model: modelName,
                duration: latency,
                totalTokens,
                hasNativeToolCalls,
                hadChannelBasedToolCalls: !hasNativeToolCalls && accumulatedContent.includes('<|start|>')
              }, '[OllamaProvider] Stream completed');
            }
          } catch (parseError) {
            this.logger.warn({ line, error: parseError }, '[OllamaProvider] Failed to parse chunk');
          }
        }

        // Exit loop after processing all remaining lines when stream is done
        if (done) {
          break;
        }
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[OllamaProvider] Stream failed');
      throw error;
    }
  }

  /**
   * Non-streaming completion
   */
  private async nonStreamCompletion(
    ollamaRequest: any,
    modelName: string,
    startTime: number
  ): Promise<CompletionResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...ollamaRequest, stream: false })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const totalTokens = (data.prompt_eval_count || 0) + (data.eval_count || 0);
      const latency = Date.now() - startTime;
      this.trackSuccess(latency, totalTokens, 0);

      this.logger.info({
        model: modelName,
        duration: latency,
        totalTokens
      }, '[OllamaProvider] Completion completed');

      // Convert to OpenAI format
      return this.convertOllamaResponseToOpenAI(data, modelName);
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[OllamaProvider] Non-stream completion failed');
      throw error;
    }
  }

  /**
   * Convert OpenAI messages to Ollama format (handles multimodal content with images)
   */
  private convertMessages(messages: CompletionRequest['messages']): any[] {
    const result: any[] = [];

    for (const msg of messages) {
      // Handle Anthropic-format content blocks (from /v1/messages endpoint)
      // These contain tool_result, tool_use, thinking blocks that need special handling
      if (Array.isArray(msg.content)) {
        const hasToolResult = msg.content.some((p: any) => p.type === 'tool_result');
        const hasToolUse = msg.content.some((p: any) => p.type === 'tool_use');

        // Anthropic tool_result blocks → Ollama "tool" role messages
        if (hasToolResult) {
          for (const part of msg.content) {
            if (part.type === 'tool_result') {
              const toolContent = typeof part.content === 'string'
                ? part.content
                : Array.isArray(part.content)
                  ? part.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
                  : JSON.stringify(part.content || '');
              result.push({ role: 'tool', content: toolContent });
            } else if (part.type === 'text' && part.text?.trim()) {
              result.push({ role: 'user', content: part.text });
            }
          }
          continue;
        }

        // Anthropic assistant messages with tool_use and thinking blocks
        if (hasToolUse || msg.role === 'assistant') {
          const textParts: string[] = [];
          const toolCalls: any[] = [];

          for (const part of msg.content) {
            if (part.type === 'text' && part.text) {
              textParts.push(part.text);
            } else if (part.type === 'tool_use') {
              toolCalls.push({
                function: {
                  name: part.name,
                  arguments: typeof part.input === 'string' ? JSON.parse(part.input) : (part.input || {}),
                },
              });
            }
            // Skip thinking/redacted_thinking blocks — Ollama doesn't need them
          }

          const assistantMsg: any = {
            role: 'assistant',
            content: textParts.join('\n'),
          };
          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls;
          }
          result.push(assistantMsg);
          continue;
        }

        // Standard multimodal content (text + images)
        const textParts: string[] = [];
        const images: string[] = [];

        for (const part of msg.content) {
          if (part.type === 'text') {
            textParts.push(part.text);
          } else if (part.type === 'image_url' || part.type === 'image') {
            const imageUrl = part.image_url?.url || part.url;
            if (imageUrl) {
              const base64Data = imageUrl.replace(/^data:image\/[a-z]+;base64,/, '');
              images.push(base64Data);
            }
          }
        }

        const ollamaMsg: any = {
          role: (msg as any).role === 'tool' ? 'tool' : (msg as any).role === 'assistant' ? 'assistant' : (msg as any).role === 'system' ? 'system' : 'user',
          content: textParts.join('\n'),
        };
        if (images.length > 0) {
          ollamaMsg.images = images;
        }
        result.push(ollamaMsg);
        continue;
      }

      // Simple string content
      const ollamaMsg: any = {
        role: msg.role === 'tool' ? 'tool' : msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
        content: msg.content,
      };

      // Handle tool calls in assistant messages (OpenAI format)
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        ollamaMsg.tool_calls = msg.tool_calls.map(tc => {
          let args: any;
          if (typeof tc.function.arguments === 'string' && tc.function.arguments.trim()) {
            try {
              args = JSON.parse(tc.function.arguments);
            } catch (e) {
              args = {};
            }
          } else if (!tc.function.arguments) {
            args = {};
          } else {
            args = tc.function.arguments;
          }

          return {
            function: {
              name: tc.function.name,
              arguments: args
            }
          };
        });
      }

      result.push(ollamaMsg);
    }

    return result;
  }

  /**
   * Convert OpenAI tools to Ollama format
   */
  private convertToolsToOllama(tools: any[]): any[] {
    return tools
      .filter(tool => tool?.function?.name) // Skip tools with missing function definition
      .map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters || { type: 'object', properties: {} }
        }
      }));
  }

  /**
   * Sanitize tool names from Ollama model output.
   * gpt-oss sometimes appends special tokens like <|channel|>, <|end|>, <|call|> to tool names.
   */
  private sanitizeToolName(name: string | undefined): string {
    if (!name) return '';
    // Strip any special tokens like <|channel|>, <|end|>, <|call|>, <|constrain|>, etc.
    return name.replace(/<\|[^|]*\|>/g, '').trim();
  }

  /**
   * Parse gpt-oss channel-based tool calls from content
   * gpt-oss format for non-built-in tools:
   * <|start|>assistant<|channel|>commentary to=functions.{tool_name} <|constrain|>json<|message|>{json}<|call|>
   * gpt-oss format for built-in tools:
   * <|start|>assistant<|channel|>analysis to={tool_name} <|constrain|>json<|message|>{json}<|call|>
   */
  private parseGptOssToolCalls(content: string): { cleanContent: string; toolCalls: any[] } | null {
    if (!content) return null;

    // Log the content we're trying to parse
    if (content.includes('<|start|>') || content.includes('<|channel|>')) {
      this.logger.info({
        contentLength: content.length,
        hasStartTag: content.includes('<|start|>'),
        hasChannelTag: content.includes('<|channel|>'),
        preview: content.substring(0, 500)
      }, '[OllamaProvider] Attempting to parse gpt-oss tool calls');
    }

    // Pattern to match gpt-oss tool call format
    // For non-built-in: <|start|>assistant<|channel|>commentary to=functions.tool_name <|constrain|>json<|message|>{...}<|call|>
    // For built-in: <|start|>assistant<|channel|>analysis to=tool_name <|constrain|>json<|message|>{...}<|call|>
    // Also handle "to= " with space after equals
    const toolCallPattern = /<\|start\|>assistant<\|channel\|>(?:analysis|commentary)\s+to=\s*(?:functions\.)?(\w+)(?:\s+code)?(?:\s*<\|constrain\|>json)?<\|message\|>(\{[\s\S]*?\})(?:<\|call\|>)?/g;

    const toolCalls: any[] = [];
    let match;
    let cleanContent = content;

    while ((match = toolCallPattern.exec(content)) !== null) {
      const toolName = match[1];
      const argsJson = match[2];

      this.logger.info({
        toolName,
        argsJsonLength: argsJson.length,
        argsPreview: argsJson.substring(0, 200)
      }, '[OllamaProvider] Found gpt-oss tool call match');

      try {
        const args = JSON.parse(argsJson);
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(args)
          }
        });

        // Remove the tool call syntax from content
        cleanContent = cleanContent.replace(match[0], '').trim();
      } catch (e) {
        // Failed to parse JSON, skip this match
        this.logger.warn({ toolName, argsJson, error: e }, '[OllamaProvider] Failed to parse gpt-oss tool call JSON');
      }
    }

    if (toolCalls.length > 0) {
      this.logger.info({
        toolCount: toolCalls.length,
        tools: toolCalls.map(t => t.function.name)
      }, '[OllamaProvider] Parsed gpt-oss channel-based tool calls');
      return { cleanContent, toolCalls };
    }

    return null;
  }


  /**
   * Injects tool descriptions into the system prompt for gpt-oss models.
   * gpt-oss uses a channel-based syntax instead of the native Ollama tools API.
   * 
   * gpt-oss tool call format:
   * <|start|>assistant<|channel|>commentary to=functions.tool_name <|constrain|>json<|message|>{"arg": "value"}<|call|>
   */
  private injectGptOssToolPrompt(messages: CompletionRequest['messages'], tools: any[]): CompletionRequest['messages'] {
    if (!tools || tools.length === 0) {
      return messages;
    }

    // Build tool descriptions
    const toolDescriptions = tools.map(tool => {
      const fn = tool.function || tool;
      const name = fn.name;
      const description = fn.description || 'No description provided';
      const params = fn.parameters || {};
      
      let paramStr = '';
      if (params.properties) {
        const required = params.required || [];
        paramStr = Object.entries(params.properties).map(([pName, pSchema]: [string, any]) => {
          const isRequired = required.includes(pName);
          const typeStr = pSchema.type || 'any';
          const desc = pSchema.description || '';
          return `  - ${pName} (${typeStr}${isRequired ? ', required' : ''}): ${desc}`;
        }).join('\n');
      }

      return `### ${name}
${description}
${paramStr ? `Parameters:\n${paramStr}` : 'No parameters'}`;
    }).join('\n\n');

    // Create the tool injection system prompt
    const toolPrompt = `
## Available Tools

You have access to the following tools. To use a tool, you MUST use this EXACT format:

<|start|>assistant<|channel|>commentary to=functions.TOOL_NAME <|constrain|>json<|message|>{"param1": "value1", "param2": "value2"}<|call|>

IMPORTANT:
- Replace TOOL_NAME with the actual tool name
- The JSON after <|message|> must contain valid JSON with the tool parameters
- You can add brief commentary before "to=" to explain your reasoning
- Always end the tool call with <|call|>

${toolDescriptions}

When you need information from a tool, use the format above. After receiving tool results, incorporate them into your response.
`;

    // Find existing system message or create one
    const result = [...messages];
    const systemIndex = result.findIndex(m => m.role === 'system');
    
    if (systemIndex >= 0) {
      // Append to existing system message
      const existingContent = typeof result[systemIndex].content === 'string' 
        ? result[systemIndex].content 
        : (result[systemIndex].content as any[]).map((c: any) => c.text || '').join('\n');
      
      result[systemIndex] = {
        ...result[systemIndex],
        content: existingContent + '\n\n' + toolPrompt
      };
    } else {
      // Insert new system message at the beginning
      result.unshift({
        role: 'system',
        content: toolPrompt
      });
    }

    return result;
  }

  /**
   * Convert Ollama streaming chunk to OpenAI format
   */
  private convertOllamaChunkToOpenAI(chunk: any, model: string): any | null {
    if (!chunk.message) return null;

    const delta: any = {};

    // Handle thinking content from Ollama (when think=true is set)
    // See: https://docs.ollama.com/capabilities/thinking
    // Ollama returns thinking in message.thinking field for models like DeepSeek, Qwen3
    if (chunk.message.thinking) {
      delta.thinking = chunk.message.thinking;
    }

    // Handle content delta
    if (chunk.message.content) {
      delta.content = chunk.message.content;
    }

    // Handle tool calls (native Ollama format)
    if (chunk.message.tool_calls) {
      delta.tool_calls = chunk.message.tool_calls.map((tc: any, index: number) => ({
        index,
        id: `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: this.sanitizeToolName(tc.function.name),
          arguments: JSON.stringify(tc.function.arguments)
        }
      }));
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta,
        finish_reason: chunk.done ? 'stop' : null
      }],
      usage: chunk.done ? {
        prompt_tokens: chunk.prompt_eval_count || 0,
        completion_tokens: chunk.eval_count || 0,
        total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
      } : undefined
    };
  }

  /**
   * Convert Ollama response to OpenAI format
   */
  private convertOllamaResponseToOpenAI(data: any, model: string): CompletionResponse {
    let content = data.message.content || '';
    let toolCalls: any[] | undefined;

    // Handle thinking content from Ollama (when think=true is set)
    const thinking = data.message.thinking;

    // Handle native Ollama tool calls first
    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      toolCalls = data.message.tool_calls.map((tc: any, index: number) => ({
        id: `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: this.sanitizeToolName(tc.function.name),
          arguments: JSON.stringify(tc.function.arguments)
        }
      }));
    } else {
      // Try to parse gpt-oss channel-based tool calls from content
      const parsed = this.parseGptOssToolCalls(content);
      if (parsed) {
        content = parsed.cleanContent;
        toolCalls = parsed.toolCalls;
      }
    }

    const message: any = {
      role: 'assistant',
      content
    };

    if (thinking) {
      message.thinking = thinking;
    }

    if (toolCalls && toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop'
      }],
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
      }
    };
  }

  /**
   * Embed text (optional)
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    try {
      const model = process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;

      // Ensure embedding model exists, pull if necessary
      await this.ensureModelExists(model);

      const inputs = Array.isArray(text) ? text : [text];
      const embeddings = [];

      for (const input of inputs) {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ model, prompt: input })
        });

        if (!response.ok) {
          throw new Error(`Ollama embeddings API error: ${response.status}`);
        }

        const data = await response.json();
        embeddings.push(data.embedding);
      }

      return Array.isArray(text) ? embeddings : embeddings[0];
    } catch (error) {
      this.logger.error({ error }, '[OllamaProvider] Embedding creation failed');
      throw error;
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<ProviderHealth> {
    try {
      // Check if Ollama is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return {
          status: 'unhealthy',
          provider: this.name,
          endpoint: this.baseUrl,
          error: `HTTP ${response.status}`,
          lastChecked: new Date()
        };
      }

      const data = await response.json();
      const models = data.models || [];
      const hasHealthCheckModel = models.some((m: any) => m.name.includes(this.healthCheckModel.split(':')[0]));

      return {
        status: hasHealthCheckModel ? 'healthy' : 'unhealthy',
        provider: this.name,
        endpoint: this.baseUrl,
        error: hasHealthCheckModel ? undefined : `Model ${this.healthCheckModel} not found`,
        lastChecked: new Date()
      };
    } catch (error) {
      this.logger.error({ error }, '[OllamaProvider] Health check failed');
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.baseUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Discover models available from Ollama — locally loaded + curated downloadable catalog.
   * Queries GET /api/tags for loaded models and merges with popular downloadable models.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    const models: DiscoveredModel[] = [];
    const loadedIds = new Set<string>();

    // 1. Query locally loaded models from Ollama API
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        for (const m of (data.models || [])) {
          const id = m.name || m.model;
          if (id && !loadedIds.has(id)) {
            loadedIds.add(id);
            // Probe tool support: use streaming mode and abort after first response
            // Ollama returns an error message immediately for unsupported tools (no model loading needed)
            // For supported models, we get a streaming response — abort after confirming
            let supportsTools = true; // Default to true — only set false if Ollama explicitly says no
            const isEmbedding = id.toLowerCase().includes('embed') || id.toLowerCase().includes('nomic');
            if (isEmbedding) {
              supportsTools = false;
            } else {
              try {
                const toolProbe = await fetch(`${this.baseUrl}/api/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: id,
                    messages: [{ role: 'user', content: 'hi' }],
                    tools: [{ type: 'function', function: { name: '_probe', description: 'probe', parameters: { type: 'object', properties: {} } } }],
                    stream: true, // Stream mode — Ollama rejects unsupported tools before loading model
                  }),
                  signal: AbortSignal.timeout(30000), // 30s — model may need to load into VRAM
                });
                // Read just enough to see if it's an error or a valid stream
                const text = await toolProbe.text();
                const firstLine = text.split('\n')[0];
                try {
                  const parsed = JSON.parse(firstLine);
                  if (parsed.error?.includes('does not support tools')) {
                    supportsTools = false;
                  }
                } catch { /* streaming JSON chunks = tools are working */ }
              } catch {
                supportsTools = true; // Timeout = model is loading (supports tools, just slow)
              }
            }

            // Get context window from /api/show
            let contextWindow: number | undefined;
            let supportsVision = id.includes('llava') || id.includes('vision') || id.includes('vl');
            try {
              const showResp = await fetch(`${this.baseUrl}/api/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: id }),
                signal: AbortSignal.timeout(3000),
              });
              const showData = await showResp.json();
              const info = showData.model_info || {};
              // Look for context_length in model_info (various key patterns)
              for (const [k, v] of Object.entries(info)) {
                if (k.includes('context_length') && typeof v === 'number') {
                  contextWindow = v;
                  break;
                }
              }
              // Check for vision support from model_info keys
              if (info[`${m.details?.family || ''}.vision.embedding_length`]) {
                supportsVision = true;
              }
            } catch { /* ignore */ }

            this.logger.info({
              model: id,
              supportsTools,
              supportsVision,
              contextWindow,
              family: m.details?.family,
              parameterSize: m.details?.parameter_size,
            }, '[OllamaProvider] Model capability probe results');

            models.push({
              id,
              name: id,
              provider: 'ollama',
              description: `Loaded locally — ${m.details?.parameter_size || 'unknown size'}`,
              family: m.details?.family || undefined,
              costTier: 'free',
              configured: true,
              pullRequired: false,
              contextWindow,
              capabilities: {
                chat: true,
                vision: supportsVision,
                tools: supportsTools,
                thinking: id.includes('deepseek-r1') || id.includes('qwq') || id.includes('qwen3'),
                embeddings: id.includes('embed') || id.includes('nomic'),
                imageGeneration: false,
                streaming: true,
              },
            });
          }
        }
      }
    } catch (error) {
      this.logger.warn({ error }, '[OllamaProvider] Failed to query loaded models for discovery');
    }

    return models;
  }

  /**
   * Query Ollama's /api/show endpoint for a model's actual parameters and defaults.
   * Returns real model info from the running Ollama instance.
   */
  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return null;

      const data = await response.json();
      const params = data.model_info || {};
      const modelfile = data.parameters || '';

      // Parse Modelfile parameters (e.g., "temperature 0.8\nnum_predict 128\n...")
      const parseParam = (name: string): number | undefined => {
        const match = modelfile.match(new RegExp(`^${name}\\s+([\\d.eE+-]+)`, 'm'));
        return match ? parseFloat(match[1]) : undefined;
      };

      // Extract context length from model_info
      const contextLength = params['general.context_length']
        || params['llama.context_length']
        || params['qwen2.context_length']
        || params['gemma2.context_length']
        || params['mistral.context_length']
        || undefined;

      const result: Partial<import('./ILLMProvider.js').ProviderDefaultConfig> = {
        supportsTopK: true,
        supportsFreqPenalty: false,
        supportsThinking: false,
        thinkingMode: 'budget' as const,
      };

      // Apply values only if found from the model
      const temp = parseParam('temperature');
      if (temp !== undefined) result.temperature = temp;

      const topP = parseParam('top_p');
      if (topP !== undefined) result.topP = topP;

      const topK = parseParam('top_k');
      if (topK !== undefined) result.topK = topK;

      const numPredict = parseParam('num_predict');
      if (numPredict !== undefined) result.maxTokens = numPredict > 0 ? numPredict : 8192;

      if (contextLength) {
        result.maxTokensRange = [1, contextLength];
      }

      // Detect thinking model
      if (modelId.includes('deepseek-r1') || modelId.includes('qwq') || data.template?.includes('<think>')) {
        result.supportsThinking = true;
      }

      this.logger.info({ modelId, result }, '[OllamaProvider] Got model defaults from /api/show');
      return result;
    } catch (error) {
      this.logger.warn({ modelId, error }, '[OllamaProvider] Failed to get model defaults');
      return null;
    }
  }

  /**
   * Provider-level defaults (not model-specific) — reflects Ollama runtime defaults.
   */
  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 8192, temperature: 0.8, topP: 0.9, topK: 40,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: false, thinkingBudget: 0, thinkingLevel: '',
      supportsTopK: true, supportsFreqPenalty: false, supportsThinking: false,
      thinkingMode: 'budget',
      temperatureRange: [0, 2], maxTokensRange: [256, 131072], topKRange: [1, 100],
      defaultChatModel: '', defaultEmbeddingModel: 'nomic-embed-text',
    };
  }

  /**
   * Normalize a raw Ollama stream chunk into NormalizedStreamEvents.
   * Delegates to the exported pure function for testability.
   */
  normalizeChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
    return normalizeOllamaChunk(rawChunk, state);
  }

  async generateImage(request: import('./ILLMProvider.js').ImageGenerationRequest): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    if (!this.initialized || !this.baseUrl) {
      throw new Error('[OllamaProvider] Not initialized or baseUrl not configured');
    }

    const model = request.model || process.env.OLLAMA_IMAGE_MODEL || 'stable-diffusion';
    const startTime = Date.now();

    this.logger.info({ model, promptLength: request.prompt.length }, '[OllamaProvider] generateImage started');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`[OllamaProvider] Image generation failed (${response.status}): ${errorText}`);
    }

    const result = await response.json() as any;

    if (!result.images || !result.images[0]) {
      throw new Error(`[OllamaProvider] Model "${model}" does not support image generation or returned no images`);
    }

    const durationMs = Date.now() - startTime;
    this.logger.info({ model, durationMs }, '[OllamaProvider] generateImage completed');

    return {
      imageBase64: result.images[0],
      model,
      provider: 'ollama',
      format: 'png',
      generationTimeMs: durationMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Exported normalizer function — pure, per-chunk, state-mutating
// ---------------------------------------------------------------------------

/**
 * Normalizes a single raw Ollama streaming chunk into zero or more
 * NormalizedStreamEvents. Handles two formats:
 *
 * Format A: Anthropic-style content_block_* events (emitted by OllamaProvider.streamCompletion()
 *           when converting message.thinking/message.content to interleaved blocks)
 * Format B: OpenAI-style choices[0].delta chunks (tool calls and finish)
 *
 * State is mutated in place to track block types, thinking accumulation,
 * synthetic thinking, and pending tools across chunk boundaries.
 */
export function normalizeOllamaChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
  const events: NormalizedStreamEvent[] = [];

  // Format A: Anthropic-style content_block events
  if (typeof rawChunk.type === 'string' && rawChunk.type.startsWith('content_block')) {
    return normalizeOllamaContentBlockChunk(rawChunk, state, events);
  }

  // Format B: OpenAI-style chunks
  return normalizeOllamaOpenAIStyleChunk(rawChunk, state, events);
}

/**
 * Handles Anthropic-style content_block_start/delta/stop events emitted by
 * OllamaProvider.streamCompletion() for models that support thinking (e.g. Qwen3, DeepSeek).
 */
function normalizeOllamaContentBlockChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[]
): NormalizedStreamEvent[] {
  // Emit stream_start on the first Format A event
  if (!state.streamStartEmitted) {
    state.streamStartEmitted = true;
    events.push({
      type: 'stream_start',
      messageId: '',
      model: state.model || '',
      provider: 'ollama',
    });
  }

  const blockTypes = state.blockTypes;

  switch (rawChunk.type) {
    case 'content_block_start': {
      const block = rawChunk.content_block;
      const index: number = rawChunk.index;
      if (block?.type === 'thinking') {
        const id = `tk-${index}`;
        state.thinkingId = id;
        state.thinkingStartTime = Date.now();
        state.thinkingAccumulated = '';
        blockTypes.set(index, { type: 'thinking', id });
        events.push({ type: 'thinking_start', id });
      } else if (block?.type === 'text') {
        const id = `txt-${index}`;
        state.textBlockId = id;
        blockTypes.set(index, { type: 'text', id });
        events.push({ type: 'text_start', id });
      } else if (block?.type === 'tool_use') {
        const id = block.id || `tool-${index}`;
        blockTypes.set(index, { type: 'tool_use', id });
        events.push({ type: 'tool_start', id, toolName: block.name || '', serverName: '' });
      }
      break;
    }

    case 'content_block_delta': {
      const delta = rawChunk.delta;
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);

      if (delta?.type === 'thinking_delta') {
        state.thinkingAccumulated += delta.thinking || '';
        events.push({
          type: 'thinking_delta',
          id: blockInfo?.id || state.thinkingId || `tk-${index}`,
          content: delta.thinking || '',
          accumulated: state.thinkingAccumulated,
        });
      } else if (delta?.type === 'text_delta') {
        events.push({
          type: 'text_delta',
          id: blockInfo?.id || state.textBlockId || `txt-${index}`,
          content: delta.text || '',
        });
      } else if (delta?.type === 'input_json_delta') {
        const toolId = blockInfo?.id || `tool-${index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: delta.partial_json || '' });
      }
      break;
    }

    case 'content_block_stop': {
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);
      if (blockInfo?.type === 'thinking') {
        const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
        events.push({ type: 'thinking_stop', id: blockInfo.id, elapsedMs: elapsed });
        state.thinkingId = null;
        state.thinkingStartTime = null;
        state.thinkingAccumulated = '';
      } else if (blockInfo?.type === 'text') {
        events.push({ type: 'text_stop', id: blockInfo.id });
        state.textBlockId = null;
      } else if (blockInfo?.type === 'tool_use') {
        events.push({ type: 'tool_stop', id: blockInfo.id, result: null, durationMs: 0 });
      }
      blockTypes.delete(index);
      break;
    }
  }

  return events;
}

/**
 * Handles OpenAI-style streaming chunks (choices[0].delta).
 * Emits a synthetic thinking block on the first chunk so every response
 * has a thinking node in the activity tree.
 */
function normalizeOllamaOpenAIStyleChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[]
): NormalizedStreamEvent[] {
  const pendingTools = state.pendingTools;

  const choice = rawChunk.choices?.[0];

  // Usage-only chunk (no choices)
  if (!choice && rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
    return events;
  }

  if (!choice) return events;

  const delta = choice.delta;
  if (!delta && !choice.finish_reason) return events;

  // -----------------------------------------------------------------------
  // First chunk — role === 'assistant': emit stream_start + synthetic thinking
  // -----------------------------------------------------------------------
  if (delta?.role === 'assistant' && !state.streamStartEmitted) {
    state.streamStartEmitted = true;
    state.model = rawChunk.model || '';
    events.push({
      type: 'stream_start',
      messageId: rawChunk.id || '',
      model: rawChunk.model || '',
      provider: 'ollama',
    });

    // Emit synthetic thinking block (closed when real content or tools arrive)
    const thinkId = 'tk-synth-0';
    state.thinkingId = thinkId;
    state.thinkingStartTime = Date.now();
    events.push({ type: 'thinking_start', id: thinkId });
    events.push({ type: 'thinking_delta', id: thinkId, content: 'Processing', accumulated: 'Processing' });
    return events;
  }

  // -----------------------------------------------------------------------
  // Helper: close synthetic thinking if still active
  // -----------------------------------------------------------------------
  const closeSyntheticThinking = () => {
    if (state.thinkingId) {
      const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
      events.push({ type: 'thinking_stop', id: state.thinkingId, elapsedMs: elapsed });
      state.thinkingId = null;
      state.thinkingStartTime = null;
    }
  };

  // -----------------------------------------------------------------------
  // Text content delta
  // -----------------------------------------------------------------------
  if (delta?.content) {
    closeSyntheticThinking();
    if (!state.textBlockId) {
      state.textBlockId = 'txt-0';
      events.push({ type: 'text_start', id: state.textBlockId });
    }
    events.push({ type: 'text_delta', id: state.textBlockId, content: delta.content });
  }

  // -----------------------------------------------------------------------
  // Tool call deltas
  // -----------------------------------------------------------------------
  if (delta?.tool_calls) {
    closeSyntheticThinking();
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) {
        const toolId = tc.id || `tool-${tc.index}`;
        pendingTools.set(toolId, tc.function.name);
        state.toolIndexToId.set(tc.index, toolId);
        events.push({ type: 'tool_start', id: toolId, toolName: tc.function.name, serverName: '' });
      }
      if (tc.function?.arguments) {
        const toolId = tc.id || state.toolIndexToId.get(tc.index) || `tool-${tc.index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: tc.function.arguments });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Finish reason
  // -----------------------------------------------------------------------
  if (choice.finish_reason) {
    if (choice.finish_reason === 'tool_calls') {
      for (const [id] of pendingTools) {
        events.push({ type: 'tool_stop', id, result: null, durationMs: 0 });
      }
      pendingTools.clear();
    }

    if (state.textBlockId) {
      events.push({ type: 'text_stop', id: state.textBlockId });
      state.textBlockId = null;
    }

    // Close any still-open synthetic thinking (e.g. response with no content)
    closeSyntheticThinking();

    events.push({
      type: 'stream_end',
      finishReason: choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason,
      totalDurationMs: 0,
    });
  }

  // -----------------------------------------------------------------------
  // Usage embedded in the same chunk
  // -----------------------------------------------------------------------
  if (rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
  }

  return events;
}
