import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import type { Logger } from 'pino';

import { validateAnyToken } from '../../auth/tokenValidator.js';
import { UserPermissionsService } from '../../services/UserPermissionsService.js';
import { ChatStorageService } from '../../services/ChatStorageService.js';
import type { ProviderManager } from '../../services/llm-providers/ProviderManager.js';
import { ModelConfigurationService } from '../../services/ModelConfigurationService.js';
import { prisma } from '../../utils/prisma.js';
import { executeToolViaPod } from './tool-dispatch.service.js';

/** Guardrail — at 20 tool rounds something is clearly wrong. */
const MAX_TOOL_ROUNDS = 20;

/**
 * Built-in codemode tools exposed to the LLM. These are plain
 * filesystem/shell primitives the exec pod knows how to run. We
 * deliberately keep the list tight — anything more exotic should be
 * delivered via MCP, not baked in. Schemas match what Claude Code
 * /openagentic CLI exposes so prompts and prior conversations port 1:1.
 */
const CODEMODE_TOOLS: Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> = [
  {
    type: 'function',
    function: {
      name: 'Bash',
      description:
        'Execute a shell command in the user workspace. Returns combined stdout+stderr. ' +
        'Use for compilation, tests, git, curl, package installs, and any shell-like task. ' +
        'Long-running commands (up to 60s) are supported.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute.' },
          description: {
            type: 'string',
            description: 'One-line description of what the command does (for activity log).',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in ms (default 60000, max 120000).',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Read',
      description:
        'Read a file from the workspace. Returns line-numbered content (cat -n style). ' +
        'Use offset+limit for large files. PDFs, notebooks, and images are supported.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file.' },
          offset: { type: 'number', description: '1-based start line for slicing.' },
          limit: { type: 'number', description: 'Max number of lines to return.' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description:
        'Create or fully overwrite a file with the given content. Prefer Edit for in-place ' +
        'modifications. The file must either not exist or have been Read this session.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file.' },
          content: { type: 'string', description: 'File contents to write.' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description:
        'Perform an exact string replacement inside a file. old_string must match a unique ' +
        'span in the current file contents; use replace_all=true to update every occurrence.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file.' },
          old_string: { type: 'string', description: 'Exact text to replace (must be unique).' },
          new_string: { type: 'string', description: 'Replacement text.' },
          replace_all: {
            type: 'boolean',
            description: 'If true, replaces every occurrence of old_string.',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description:
        'Find files by glob pattern (e.g. "src/**/*.ts"). Returns paths sorted by mtime desc.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match against.' },
          path: { type: 'string', description: 'Directory to search in (default: cwd).' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description:
        'Search file contents with ripgrep-compatible regex. Supports glob filters, file types, ' +
        'and line context. Use output_mode="files_with_matches" to list files or "content" for matches.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for.' },
          path: { type: 'string', description: 'File or directory to search in.' },
          glob: { type: 'string', description: 'Glob filter, e.g. "*.ts".' },
          type: { type: 'string', description: 'rg --type, e.g. "js", "py".' },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description: 'How results are formatted.',
          },
          '-i': { type: 'boolean', description: 'Case-insensitive match.' },
          '-n': { type: 'boolean', description: 'Include line numbers.' },
          '-C': { type: 'number', description: 'Lines of context before/after each match.' },
          multiline: { type: 'boolean', description: 'Enable dotall multiline matching.' },
        },
        required: ['pattern'],
      },
    },
  },
];

/** Inbound WS frame shape from the UI's useCodeModeChat hook. */
interface UserTurnFrame {
  type: 'user';
  message: { role: 'user'; content: string | unknown[] };
  model?: string;
  permissionMode?: string;
}

interface ControlFrame {
  type: 'control_request' | 'control_response';
  request_id?: string;
  request?: { subtype: string; [k: string]: unknown };
  response?: unknown;
}

type InboundFrame = UserTurnFrame | ControlFrame | { type: string; [k: string]: unknown };

/**
 * Conversation message in Anthropic shape — what we feed into
 * ProviderManager.createCompletion. We translate between this and
 * OpenAI-style tool_calls/tool role as needed per provider. The
 * ProviderManager's own convertMessages handles most of that (see
 * AnthropicProvider.convertMessages), but we normalize upstream so
 * a single message history drives every provider call.
 */
interface ConvMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

/** Active in-flight turn — tracked so cancel/interrupt works. */
interface ActiveTurn {
  aborted: boolean;
  startedAt: number;
  messagesSoFar: ConvMessage[];
}

/**
 * Dependencies the route needs from server startup. Passed in via the
 * register function so we don't depend on module-level globals — keeps
 * the handler testable and avoids circular imports with server.ts.
 */
export interface CodeModeV2Deps {
  chatStorage: ChatStorageService;
  providerManager: ProviderManager | null;
  logger: Logger;
}

/**
 * Send a single NDJSON frame to the client. Each frame is one JSON
 * object on its own line — matches what exec's stream-json emitter
 * writes, so the UI reducer sees the same wire format regardless of
 * which codemode backend (v1 or v2) produced it.
 */
function sendFrame(ws: any, frame: Record<string, unknown>): void {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(frame));
  } catch (err) {
    // Socket race between readyState check and send — drop quietly.
  }
}

/**
 * Convert a conversation history into the OpenAI-style messages array
 * that ProviderManager.createCompletion expects. Tool results and
 * tool_calls are kept in OpenAI format; the AnthropicProvider.ts
 * convertMessages method translates those to Anthropic content blocks
 * on the way out.
 */
function toCompletionMessages(messages: ConvMessage[]): ConvMessage[] {
  return messages;
}

/**
 * Resolve the model to use for this turn. Priority:
 *   1. Explicit per-turn model override from the UI frame
 *   2. Session's stored model (if any)
 *   3. Admin-curated default (ModelConfigurationService.getDefaultChatModel)
 */
async function resolveModel(
  turnModel: string | undefined,
  sessionModel: string | null | undefined,
  logger: Logger,
): Promise<string> {
  if (turnModel) return turnModel;
  if (sessionModel) return sessionModel;
  try {
    return await ModelConfigurationService.getDefaultChatModel();
  } catch (err: any) {
    // M9: fail-loud. Silent fallback to a hardcoded model masks misconfiguration
    // (no chat row in admin.model_role_assignments) and pollutes traces with a
    // model the operator never selected.
    logger.error({ err: err?.message }, '[codemode-v2] getDefaultChatModel failed — no chat model configured in registry');
    throw new Error('No chat model configured. Add a chat-role row to admin.model_role_assignments.');
  }
}

/**
 * Accumulator for an in-flight tool_use block. OpenAI-format
 * providers stream the arguments as a sequence of partial_json
 * fragments; we only dispatch once the block closes. Anthropic-format
 * providers give us the complete input upfront at content_block_start,
 * but we still wait for content_block_stop to stay aligned with the
 * stream-json wire format.
 */
interface ToolUseAccum {
  index: number;
  id: string;
  name: string;
  partialJson: string;
}

/**
 * Normalize one raw chunk from a provider stream into zero or more
 * Anthropic-format events (message_start, content_block_start, etc.)
 * and emit them as stream_event wrappers to the client. Returns any
 * tool_use info that closed on this chunk so the outer loop can
 * dispatch to the exec pod.
 *
 * Normalizes provider-shape chunks into Anthropic-shape events for
 * code-mode (re-emitted as stream-json instead of SSE). Tight and
 * focused — no RAG/MCP/memory plumbing that only matters for chat mode.
 */
class StreamNormalizer {
  private streamFormat: 'anthropic' | 'openai' | 'gemini';
  private sessionId: string;
  private ws: any;
  private logger: Logger;

  /** Anthropic-native path: the provider emits the correct events already. */
  private passthrough: boolean;

  /** OpenAI path state. */
  private openaiMessageStartEmitted = false;
  private openaiActiveBlockKind: 'text' | 'tool_use' | null = null;
  private openaiBlockIndex = -1;
  private openaiToolByIndex: Map<number, ToolUseAccum> = new Map();

  /** Captured usage from the final chunk — used to build the result event. */
  private usage: { input_tokens?: number; output_tokens?: number } = {};
  private stopReason: string | null = null;
  private model = '';
  private messageId = '';

  /** Tool uses observed in this turn, in order of appearance. */
  private completedToolUses: Array<{ id: string; name: string; input: unknown }> = [];

  /** Accumulated assistant text (for session persistence at end of turn). */
  private assistantText = '';

  /** Accumulated tool_calls for persistence to the assistant message row. */
  private assistantToolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> = [];

  constructor(opts: {
    streamFormat: 'anthropic' | 'openai' | 'gemini';
    sessionId: string;
    ws: any;
    logger: Logger;
    model: string;
  }) {
    this.streamFormat = opts.streamFormat;
    this.sessionId = opts.sessionId;
    this.ws = opts.ws;
    this.logger = opts.logger;
    this.model = opts.model;
    this.messageId = `msg_${randomUUID()}`;
    this.passthrough = opts.streamFormat === 'anthropic';
  }

  getCompletedToolUses(): Array<{ id: string; name: string; input: unknown }> {
    return this.completedToolUses;
  }

  getAssistantText(): string {
    return this.assistantText;
  }

  getAssistantToolCalls() {
    return this.assistantToolCalls;
  }

  getUsage() {
    return this.usage;
  }

  getStopReason(): string | null {
    return this.stopReason;
  }

  /** Emit a stream_event envelope. */
  private emitStreamEvent(event: Record<string, unknown>): void {
    sendFrame(this.ws, {
      type: 'stream_event',
      event,
      session_id: this.sessionId,
      parent_tool_use_id: null,
      uuid: randomUUID(),
    });
  }

  /** Anthropic-format passthrough — emit the chunk verbatim, tracking tool_use. */
  private handleAnthropicChunk(chunk: any): void {
    // Track tool_use content blocks so we can dispatch after the stream ends.
    // Accumulator keyed by index.
    if (chunk.type === 'message_start') {
      this.usage.input_tokens = chunk.message?.usage?.input_tokens;
      if (chunk.message?.model) this.model = chunk.message.model;
      if (chunk.message?.id) this.messageId = chunk.message.id;
    } else if (chunk.type === 'content_block_start') {
      const block = chunk.content_block;
      if (block?.type === 'tool_use') {
        this.openaiToolByIndex.set(chunk.index, {
          index: chunk.index,
          id: block.id,
          name: block.name,
          partialJson: '',
        });
      }
    } else if (chunk.type === 'content_block_delta') {
      if (chunk.delta?.type === 'text_delta' && chunk.delta.text) {
        this.assistantText += chunk.delta.text;
      }
      if (chunk.delta?.type === 'input_json_delta' && chunk.delta.partial_json) {
        const accum = this.openaiToolByIndex.get(chunk.index);
        if (accum) accum.partialJson += chunk.delta.partial_json;
      }
    } else if (chunk.type === 'content_block_stop') {
      const accum = this.openaiToolByIndex.get(chunk.index);
      if (accum) {
        let input: unknown = {};
        try {
          input = accum.partialJson ? JSON.parse(accum.partialJson) : {};
        } catch (e) {
          this.logger.warn(
            { toolName: accum.name, partial: accum.partialJson.slice(0, 200) },
            '[codemode-v2] tool input JSON parse failed',
          );
        }
        this.completedToolUses.push({ id: accum.id, name: accum.name, input });
        this.assistantToolCalls.push({
          id: accum.id,
          type: 'function',
          function: { name: accum.name, arguments: JSON.stringify(input) },
        });
      }
    } else if (chunk.type === 'message_delta') {
      if (chunk.delta?.stop_reason) this.stopReason = chunk.delta.stop_reason;
      if (chunk.usage?.output_tokens !== undefined) {
        this.usage.output_tokens = chunk.usage.output_tokens;
      }
    } else if (chunk.type === 'message_stop') {
      if (chunk.usage) {
        this.usage.input_tokens = chunk.usage.input_tokens ?? this.usage.input_tokens;
        this.usage.output_tokens = chunk.usage.output_tokens ?? this.usage.output_tokens;
      }
    }
    // Pass the event through verbatim.
    this.emitStreamEvent(chunk);
  }

  /**
   * OpenAI-format translation — convert choices[0].delta content and
   * tool_calls into Anthropic content_block_* events. We only emit one
   * message_start for the whole turn; one text block for any assistant
   * text; one tool_use block per tool call index.
   */
  private handleOpenAIChunk(chunk: any): void {
    if (!this.openaiMessageStartEmitted) {
      this.openaiMessageStartEmitted = true;
      this.usage.input_tokens = chunk.usage?.prompt_tokens;
      this.emitStreamEvent({
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: chunk.model || this.model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: this.usage.input_tokens ?? 0,
            output_tokens: 0,
          },
        },
      });
    }

    if (chunk.model && !this.model) this.model = chunk.model;

    const delta = chunk.choices?.[0]?.delta;
    const finish = chunk.choices?.[0]?.finish_reason;

    if (delta?.content) {
      // Ensure we're in a text block.
      if (this.openaiActiveBlockKind !== 'text') {
        this.closeActiveBlock();
        this.openaiBlockIndex++;
        this.openaiActiveBlockKind = 'text';
        this.emitStreamEvent({
          type: 'content_block_start',
          index: this.openaiBlockIndex,
          content_block: { type: 'text', text: '' },
        });
      }
      this.assistantText += delta.content;
      this.emitStreamEvent({
        type: 'content_block_delta',
        index: this.openaiBlockIndex,
        delta: { type: 'text_delta', text: delta.content },
      });
    }

    if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
      // Text block (if any) needs to close before switching to tool_use.
      if (this.openaiActiveBlockKind === 'text') {
        this.closeActiveBlock();
      }
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        let accum = this.openaiToolByIndex.get(idx);
        if (!accum) {
          // New tool call — allocate a fresh content block index.
          this.openaiBlockIndex++;
          const id = tc.id || `call_${idx}_${Date.now().toString(36)}`;
          const name = tc.function?.name || '';
          accum = { index: this.openaiBlockIndex, id, name, partialJson: '' };
          this.openaiToolByIndex.set(idx, accum);
          this.openaiActiveBlockKind = 'tool_use';
          this.emitStreamEvent({
            type: 'content_block_start',
            index: accum.index,
            content_block: { type: 'tool_use', id, name, input: {} },
          });
        } else {
          // Name may arrive in later chunks for some providers.
          if (tc.function?.name && !accum.name) accum.name = tc.function.name;
        }
        if (tc.function?.arguments) {
          accum.partialJson += tc.function.arguments;
          this.emitStreamEvent({
            type: 'content_block_delta',
            index: accum.index,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          });
        }
      }
    }

    if (chunk.usage) {
      this.usage.input_tokens = chunk.usage.prompt_tokens ?? this.usage.input_tokens;
      this.usage.output_tokens = chunk.usage.completion_tokens ?? this.usage.output_tokens;
    }

    if (finish) {
      this.stopReason =
        finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn';
    }
  }

  /**
   * Gemini-format translation. Google Vertex returns candidates with
   * parts[{text}] or functionCall blocks. We only need a minimal path:
   * Vertex is typically wrapped by ProviderManager into OpenAI-like
   * chunks already, so in practice this falls through to the OpenAI
   * handler. Kept as a separate branch so a future dedicated Gemini
   * normalizer can slot in without reshaping the call sites.
   */
  private handleGeminiChunk(chunk: any): void {
    // In the current ProviderManager wiring, Vertex already returns
    // OpenAI-shaped chunks via internal translation. If a raw Gemini
    // chunk ever lands here, fall through to the OpenAI path — those
    // chunks have `candidates` instead of `choices`, which our
    // handleOpenAIChunk ignores (no delta), so nothing breaks.
    this.handleOpenAIChunk(chunk);
  }

  /**
   * Close whatever content block is currently open. Only relevant for
   * the OpenAI path — the Anthropic passthrough path emits its own
   * content_block_stop events.
   */
  private closeActiveBlock(): void {
    if (this.openaiActiveBlockKind === 'text' && this.openaiBlockIndex >= 0) {
      this.emitStreamEvent({
        type: 'content_block_stop',
        index: this.openaiBlockIndex,
      });
    }
    // tool_use blocks are closed in finalize() so we can parse the JSON
    // once after the full arguments stream in.
    this.openaiActiveBlockKind = null;
  }

  processChunk(chunk: any): void {
    if (this.passthrough) return this.handleAnthropicChunk(chunk);
    if (this.streamFormat === 'gemini') return this.handleGeminiChunk(chunk);
    return this.handleOpenAIChunk(chunk);
  }

  /**
   * Emit the closing events that wrap up the Anthropic-format wire for
   * OpenAI-style providers. Parses accumulated tool_call JSON and
   * records the completed tool uses so the outer loop can dispatch.
   */
  finalize(): void {
    if (this.passthrough) return;

    // Close any still-active text block.
    if (this.openaiActiveBlockKind === 'text' && this.openaiBlockIndex >= 0) {
      this.emitStreamEvent({ type: 'content_block_stop', index: this.openaiBlockIndex });
      this.openaiActiveBlockKind = null;
    }

    // Close tool_use blocks in arrival order and record them.
    const byIndex = Array.from(this.openaiToolByIndex.values()).sort((a, b) => a.index - b.index);
    for (const accum of byIndex) {
      let input: unknown = {};
      try {
        input = accum.partialJson ? JSON.parse(accum.partialJson) : {};
      } catch (e) {
        this.logger.warn(
          { toolName: accum.name, partial: accum.partialJson.slice(0, 200) },
          '[codemode-v2] tool input JSON parse failed',
        );
      }
      this.emitStreamEvent({ type: 'content_block_stop', index: accum.index });
      this.completedToolUses.push({ id: accum.id, name: accum.name, input });
      this.assistantToolCalls.push({
        id: accum.id,
        type: 'function',
        function: { name: accum.name, arguments: JSON.stringify(input) },
      });
    }

    this.emitStreamEvent({
      type: 'message_delta',
      delta: { stop_reason: this.stopReason || 'end_turn', stop_sequence: null },
      usage: {
        input_tokens: this.usage.input_tokens ?? 0,
        output_tokens: this.usage.output_tokens ?? 0,
      },
    });
    this.emitStreamEvent({ type: 'message_stop' });
  }
}

/**
 * Run a single LLM call and stream the result. Returns the completed
 * tool_use list and the accumulated assistant turn metadata. Tool
 * dispatch itself lives in the outer agentic loop, not here.
 */
async function runLLMTurn(opts: {
  providerManager: ProviderManager;
  messages: ConvMessage[];
  model: string;
  sessionId: string;
  ws: any;
  logger: Logger;
}): Promise<{
  completedToolUses: Array<{ id: string; name: string; input: unknown }>;
  assistantText: string;
  assistantToolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage: { input_tokens?: number; output_tokens?: number };
  stopReason: string | null;
}> {
  // F0-3 (2026-05-12 audit) collapsed the broad 8-value union; code-mode's
  // inline StreamNormalizer (line 325) still only understands 3 values.
  // Narrow at the boundary: Anthropic-family (bedrock-anthropic /
  // vertex-anthropic / foundry-anthropic) → 'anthropic'; gemini → 'gemini';
  // everything else (openai / ollama / aif-responses) → 'openai'.
  const wideFormat = opts.providerManager.getStreamFormatForModel(opts.model);
  const streamFormat: 'anthropic' | 'openai' | 'gemini' =
    wideFormat === 'anthropic' ||
    wideFormat === 'bedrock-anthropic' ||
    wideFormat === 'vertex-anthropic' ||
    wideFormat === 'foundry-anthropic'
      ? 'anthropic'
      : wideFormat === 'gemini'
        ? 'gemini'
        : 'openai';
  const normalizer = new StreamNormalizer({
    streamFormat,
    sessionId: opts.sessionId,
    ws: opts.ws,
    logger: opts.logger,
    model: opts.model,
  });

  const result = await opts.providerManager.createCompletion({
    model: opts.model,
    messages: toCompletionMessages(opts.messages) as any,
    tools: CODEMODE_TOOLS,
    stream: true,
    max_tokens: 8192,
  });

  if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
    for await (const chunk of result as AsyncIterable<any>) {
      normalizer.processChunk(chunk);
    }
  } else {
    // Non-streaming fallback — shouldn't happen given stream:true, but
    // we tolerate it so a misconfigured provider doesn't deadlock.
    opts.logger.warn('[codemode-v2] provider returned non-stream response; synthesizing events');
    const resp = result as any;
    const choice = resp?.choices?.[0]?.message;
    if (choice?.content) {
      normalizer.processChunk({
        choices: [{ delta: { content: choice.content }, finish_reason: 'stop' }],
        model: resp.model,
        usage: resp.usage,
      });
    }
    if (choice?.tool_calls?.length) {
      normalizer.processChunk({
        choices: [
          {
            delta: { tool_calls: choice.tool_calls.map((tc: any, idx: number) => ({ index: idx, ...tc })) },
            finish_reason: 'tool_calls',
          },
        ],
        model: resp.model,
      });
    }
  }

  normalizer.finalize();

  return {
    completedToolUses: normalizer.getCompletedToolUses(),
    assistantText: normalizer.getAssistantText(),
    assistantToolCalls: normalizer.getAssistantToolCalls(),
    usage: normalizer.getUsage(),
    stopReason: normalizer.getStopReason(),
  };
}

/**
 * Convert a tool result from executeToolViaPod into the textual
 * content block an Anthropic tool_result expects. Strings pass
 * through, objects are JSON-stringified, errors get a clear prefix.
 */
function stringifyToolResult(result: unknown, error?: string): string {
  if (error) return `Error: ${error}`;
  if (typeof result === 'string') return result;
  if (result == null) return '';
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * Main per-connection handler. Keeps one persistent WebSocket open
 * for the session. Each incoming `type:'user'` frame kicks off a
 * full agentic loop. Interrupts are handled by setting aborted on
 * the ActiveTurn — the loop checks between rounds.
 */
async function handleConnection(
  ws: any,
  request: any,
  deps: CodeModeV2Deps,
): Promise<void> {
  const log = deps.logger;
  const sessionId = (request.query as any)?.sessionId;
  const authToken = (request.query as any)?.token;
  log.info({ sessionId, hasToken: !!authToken }, '[codemode-v2] WS connection initiated');

  if (!ws || typeof ws.send !== 'function') {
    log.error({ sessionId }, '[codemode-v2] invalid client socket');
    return;
  }

  if (!authToken) {
    ws.close(4001, 'Authentication required');
    return;
  }

  const tokenResult = await validateAnyToken(authToken, { logger: log });
  if (!tokenResult.isValid || !tokenResult.user) {
    log.warn({ sessionId, error: tokenResult.error }, '[codemode-v2] invalid token');
    ws.close(4001, 'Invalid authentication token');
    return;
  }

  const permissions = new UserPermissionsService(prisma, log);
  const canAccess = await permissions.canAccessAwcode(
    tokenResult.user.userId,
    tokenResult.user.isAdmin,
    tokenResult.user.groups || [],
  );
  if (!canAccess) {
    log.warn(
      { sessionId, userId: tokenResult.user.userId },
      '[codemode-v2] AWCode access denied',
    );
    ws.close(4003, 'AWCode access denied');
    return;
  }

  const userId = tokenResult.user.userId;

  // Lookup or create the backing chat session so history persists.
  let session = sessionId ? await deps.chatStorage.getSession(sessionId, userId) : null;
  if (!session && sessionId) {
    try {
      await deps.chatStorage.createSession(userId, {
        sessionId,
        title: 'Code Session',
      } as any);
      session = await deps.chatStorage.getSession(sessionId, userId);
    } catch (err: any) {
      log.warn(
        { err: err.message, sessionId },
        '[codemode-v2] failed to auto-create session, continuing without persistence',
      );
    }
  }

  // Emit system:init — the UI uses this to render tool chips + fast-mode badge.
  sendFrame(ws, {
    type: 'system',
    subtype: 'init',
    cwd: '/workspace',
    session_id: sessionId,
    tools: CODEMODE_TOOLS.map((t) => t.function.name),
    mcp_servers: [],
    model: session?.model || '',
    permissionMode: 'bypassPermissions',
    slash_commands: [],
    apiKeySource: 'platform',
    openagentic_version: 'codemode-v2',
    agents: [],
    skills: [],
    plugins: [],
    uuid: randomUUID(),
    fast_mode_state: 'off',
  });

  let activeTurn: ActiveTurn | null = null;

  const handleUserTurn = async (frame: UserTurnFrame): Promise<void> => {
    if (activeTurn) {
      log.warn({ sessionId }, '[codemode-v2] user frame received while turn in progress — ignoring');
      return;
    }
    if (!deps.providerManager) {
      sendFrame(ws, {
        type: 'error',
        message: 'ProviderManager not initialized — no LLM providers available',
        session_id: sessionId,
        uuid: randomUUID(),
      });
      return;
    }

    const startedAt = Date.now();
    activeTurn = { aborted: false, startedAt, messagesSoFar: [] };

    const turnModel = frame.model;
    const sessionModel = session?.model;
    const model = await resolveModel(turnModel, sessionModel, log);

    // Build the message history: prior persisted turns + this new user turn.
    const history = sessionId ? await deps.chatStorage.getMessages(sessionId) : [];
    const convMessages: ConvMessage[] = [];
    // System prompt — tight, codemode-specific.
    convMessages.push({
      role: 'system',
      content:
        'You are a coding assistant running inside the user\'s workspace. ' +
        'You have access to Bash, Read, Write, Edit, Glob, and Grep tools to explore and modify ' +
        'the codebase. Use them aggressively — do not guess file contents or command output. ' +
        'Prefer Edit over Write for in-place changes. Always use absolute file paths. ' +
        'When the task is complete, summarize what you changed in plain text.',
    });
    for (const m of history) {
      if (m.role === 'user') {
        convMessages.push({ role: 'user', content: m.content || '' });
      } else if (m.role === 'assistant') {
        const msgAny = m as any;
        const toolCalls = Array.isArray(msgAny.toolCalls) && msgAny.toolCalls.length > 0
          ? msgAny.toolCalls
          : undefined;
        convMessages.push({
          role: 'assistant',
          content: m.content || '',
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        });
      } else if (m.role === 'tool') {
        const msgAny = m as any;
        convMessages.push({
          role: 'tool',
          content: m.content || '',
          tool_call_id: msgAny.toolCallId || '',
        });
      }
    }

    // Append the incoming user turn.
    const userText =
      typeof frame.message?.content === 'string'
        ? frame.message.content
        : JSON.stringify(frame.message?.content ?? '');
    convMessages.push({ role: 'user', content: userText });

    // Persist the user message immediately.
    if (sessionId) {
      try {
        await deps.chatStorage.addMessageToSession(sessionId, userId, 'user', userText, {
          model,
        });
      } catch (err: any) {
        log.warn({ err: err.message }, '[codemode-v2] failed to persist user message');
      }
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastStopReason: string | null = null;
    let turnError: string | null = null;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (activeTurn?.aborted) {
          log.info({ sessionId, round }, '[codemode-v2] turn aborted mid-loop');
          break;
        }

        const turn = await runLLMTurn({
          providerManager: deps.providerManager,
          messages: convMessages,
          model,
          sessionId,
          ws,
          logger: log,
        });

        totalInputTokens += turn.usage.input_tokens ?? 0;
        totalOutputTokens += turn.usage.output_tokens ?? 0;
        lastStopReason = turn.stopReason;

        // Append assistant turn to history (even if it just has tool_use).
        convMessages.push({
          role: 'assistant',
          content: turn.assistantText,
          ...(turn.assistantToolCalls.length > 0 ? { tool_calls: turn.assistantToolCalls } : {}),
        });

        // Persist assistant message. Each round is its own DB row so the
        // UI can show intermediate tool-use cards after reloads.
        if (sessionId) {
          try {
            await deps.chatStorage.addMessageToSession(
              sessionId,
              userId,
              'assistant',
              turn.assistantText,
              {
                model,
                toolCalls: turn.assistantToolCalls.length > 0 ? turn.assistantToolCalls : undefined,
                tokenUsage: {
                  promptTokens: turn.usage.input_tokens,
                  completionTokens: turn.usage.output_tokens,
                  totalTokens: (turn.usage.input_tokens ?? 0) + (turn.usage.output_tokens ?? 0),
                },
              },
            );
          } catch (err: any) {
            log.warn({ err: err.message }, '[codemode-v2] failed to persist assistant message');
          }
        }

        // No tools called → turn is done.
        if (turn.completedToolUses.length === 0) {
          break;
        }

        // Dispatch all tool calls (sequentially for now — parallel
        // dispatch is safe but complicates the ordering of tool_result
        // frames the UI expects). Emit each result as a user frame
        // with tool_result content blocks, matching stream-json.
        for (const toolUse of turn.completedToolUses) {
          if (activeTurn?.aborted) break;
          const dispatched = await executeToolViaPod(
            userId,
            toolUse.name,
            toolUse.input,
            toolUse.id,
            log,
          );
          const textContent = stringifyToolResult(dispatched.result, dispatched.error);

          sendFrame(ws, {
            type: 'user',
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: textContent,
                  ...(dispatched.isError ? { is_error: true } : {}),
                },
              ],
            },
            parent_tool_use_id: null,
            session_id: sessionId,
            uuid: randomUUID(),
            tool_use_result: { stdout: textContent },
          });

          // Feed result back into the conversation for the next LLM turn.
          convMessages.push({
            role: 'tool',
            content: textContent,
            tool_call_id: toolUse.id,
            name: toolUse.name,
          });

          // Persist tool result. Uses the `tool` role which ChatStorage
          // normalizes — keeps parity with chat mode's tool persistence.
          if (sessionId) {
            try {
              await deps.chatStorage.addMessageToSession(sessionId, userId, 'tool', textContent, {
                toolCallId: toolUse.id,
                model,
              });
            } catch (err: any) {
              log.warn({ err: err.message }, '[codemode-v2] failed to persist tool result');
            }
          }
        }

        // Loop — next round the LLM sees the tool results.
      }
    } catch (err: any) {
      turnError = err?.message || String(err);
      log.error(
        { err: turnError, sessionId, stack: err?.stack },
        '[codemode-v2] turn failed',
      );
      sendFrame(ws, {
        type: 'error',
        message: `Codemode turn failed: ${turnError}`,
        session_id: sessionId,
        uuid: randomUUID(),
      });
    }

    const durationMs = Date.now() - startedAt;
    // Cost is provider-specific and only sporadically available on
    // streamed chunks — leave as 0 here. The UI aggregates duration +
    // token counts which is what most users care about.
    sendFrame(ws, {
      type: 'result',
      subtype: turnError ? 'error' : activeTurn?.aborted ? 'error' : 'success',
      is_error: !!turnError,
      duration_ms: durationMs,
      num_turns: 1,
      session_id: sessionId,
      total_cost_usd: 0,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
      result: turnError ? turnError : undefined,
      uuid: randomUUID(),
    });

    activeTurn = null;
  };

  ws.on('message', (raw: any) => {
    let frame: InboundFrame | null = null;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      log.warn({ sessionId }, '[codemode-v2] bad inbound frame — not JSON');
      return;
    }
    if (!frame || typeof frame.type !== 'string') return;

    if (frame.type === 'user') {
      // Fire-and-forget — errors are emitted to the socket, not raised.
      void handleUserTurn(frame as UserTurnFrame);
      return;
    }

    if (frame.type === 'control_request') {
      const req = (frame as ControlFrame).request;
      if (req?.subtype === 'interrupt') {
        if (activeTurn) {
          activeTurn.aborted = true;
          log.info({ sessionId }, '[codemode-v2] interrupt received');
        }
        return;
      }
      // Other control subtypes (can_use_tool responses, etc.) are no-ops
      // in v2 — the exec pod owns tool permission prompts in v2 so there's
      // no mid-flight ack to forward back. If a newer UI relies on them
      // we can wire it up here without changing the wire format.
      return;
    }

    // Unknown frame type — silently drop so we don't spam the logs on
    // v1-only frames the UI may still send out of habit.
  });

  ws.on('close', () => {
    log.info({ sessionId }, '[codemode-v2] WS closed');
    if (activeTurn) activeTurn.aborted = true;
  });

  ws.on('error', (err: Error) => {
    log.error({ err: err.message, sessionId }, '[codemode-v2] WS error');
  });
}

/**
 * Register the /api/code/v2/ws/chat WebSocket route on the given
 * Fastify server. Wrap in try/catch at the call site — the route
 * is non-essential and should never take down the whole API if its
 * dependencies aren't ready (pattern matches the existing v1 route
 * registration in server.ts).
 */
export function registerCodeModeV2ChatRoute(
  server: FastifyInstance,
  deps: CodeModeV2Deps,
): void {
  server.get(
    '/api/code/v2/ws/chat',
    { websocket: true } as any,
    async (connection: any, request: any) => {
      const ws = connection?.socket || connection;
      await handleConnection(ws, request, deps);
    },
  );
  deps.logger.info('[codemode-v2] chat-pipeline-direct WebSocket registered at /api/code/v2/ws/chat');
}
