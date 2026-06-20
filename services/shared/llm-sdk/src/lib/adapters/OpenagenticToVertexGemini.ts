/**
 * Canonical → Vertex AI Gemini request body (`generateContent` /
 * `streamGenerateContent` endpoints).
 *
 * Gemini's wire shape is the most different of the five providers:
 *
 *   {
 *     contents: [
 *       { role: 'user',  parts: [{ text: '...' }, { inlineData: {...} }] },
 *       { role: 'model', parts: [{ text: '...' }, { functionCall: { name, args } }] },
 *       { role: 'user',  parts: [{ functionResponse: { name, response: {...} } }] }
 *     ],
 *     system_instruction: { parts: [{ text: '...' }] },
 *     tools: [{ functionDeclarations: [{ name, description, parameters }] }],
 *     toolConfig: { functionCallingConfig: { mode: 'AUTO'|'ANY'|'NONE', allowedFunctionNames?: [...] } },
 *     generationConfig: {
 *       maxOutputTokens, temperature, topP, stopSequences
 *     }
 *   }
 *
 * Critical contracts:
 *   - Role naming: `assistant` → `model`. `user` stays `user`.
 *   - System prompt is a TOP-LEVEL field, NOT a message role.
 *   - functionResponse pairs to prior functionCall BY NAME, not by id (Gemini's
 *     wire has no id slot). The adapter MUST emit name-equality for parallel
 *     tool batches; if two functionCalls share a name, results may be paired
 *     ambiguously. Caller responsibility: avoid same-name parallel batches OR
 *     accept first-match pairing. The canonical toolu_* id is dropped on the
 *     outbound wire (preserved upstream in canonical history).
 *   - Tool calls embed `args` (not `arguments` JSON-string like OpenAI).
 *   - functionResponse.response is an OBJECT, not a string. The adapter wraps
 *     plain-string canonical tool_result content in `{ result: <string> }`.
 *
 * Thinking blocks: Gemini doesn't accept thinking blocks on the request wire.
 * Adapter drops; thoughtSignature reinforces this — the inbound normalizer
 * surfaces it but the outbound adapter has no slot to put it back.
 *
 * Context caching: when canonical.cached_content is set, emits top-level
 * `cachedContent` (camelCase) on the wire body. Gemini's caching surface is
 * stateful — caller manages the cachedContents resource lifecycle via Vertex's
 * REST API (POST/PATCH/DELETE /cachedContents). Min cache size: 32k tokens
 * for Gemini 1.5, 4k for Gemini 2.5. The adapter only emits the reference.
 *
 * Spec: https://ai.google.dev/api/generate-content +
 *       https://ai.google.dev/gemini-api/docs/caching +
 * the design notes
 */

import type {
  CanonicalRequest,
  CanonicalMessage,
} from '../canonical/types.js';
import type { ProviderHint } from '../canonical/toolIdNormalize.js';
import type { IOutboundAdapter } from './AdapterContract.js';

interface VertexGeminiBody {
  contents: Array<{
    role: 'user' | 'model';
    parts: VertexPart[];
  }>;
  system_instruction?: { parts: [{ text: string }] };
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  }>;
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE';
      allowedFunctionNames?: string[];
      /** Q2 — per-turn serial dispatch override. */
      parallelFunctionCalling?: boolean;
    };
  };
  generationConfig: {
    maxOutputTokens: number;
    stopSequences?: string[];
  };
  /**
   * Vertex AI context-cache reference. Top-level on `generateContent` body.
   * When set, Gemini prepends the cached content (system + tools + fixed
   * content prefix) before processing this request's contents[].
   * Resource format: `projects/{P}/locations/{L}/cachedContents/{ID}` (Vertex)
   *                  or `cachedContents/{ID}` (Google AI Studio).
   */
  cachedContent?: string;
}

type VertexPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export class OpenagenticToVertexGemini implements IOutboundAdapter {
  readonly format: ProviderHint = 'vertex';

  adaptRequest(req: CanonicalRequest): VertexGeminiBody {
    // Track the most-recent functionCall name for each tool_use_id so we can
    // pair a downstream tool_result's name correctly. The pairing relies on
    // canonical tool_use blocks immediately preceding their tool_result blocks
    // in conversation order, which the chatLoop guarantees.
    const toolUseIdToName = new Map<string, string>();

    const contents: VertexGeminiBody['contents'] = [];
    for (const m of req.messages) {
      const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
      const parts: VertexPart[] = [];

      for (const b of m.content) {
        switch (b.type) {
          case 'text':
            parts.push({ text: b.text });
            break;
          case 'thinking':
            // Drop — Gemini outbound has no thinking slot.
            break;
          case 'tool_use':
            toolUseIdToName.set(b.id, b.name);
            parts.push({ functionCall: { name: b.name, args: b.input } });
            break;
          case 'tool_result': {
            // Look up the paired name from a prior assistant turn.
            const name = toolUseIdToName.get(b.tool_use_id) ?? 'unknown_function';
            const responseObj =
              typeof b.content === 'string'
                ? { result: b.content }
                : Array.isArray(b.content)
                  ? { result: b.content.map((sub) => (sub.type === 'text' ? sub.text : '')).join('') }
                  : { result: JSON.stringify(b.content) };
            parts.push({
              functionResponse: { name, response: responseObj },
            });
            break;
          }
          case 'image':
            if (b.source.type === 'base64' && b.source.data) {
              parts.push({
                inlineData: {
                  mimeType: b.source.media_type ?? 'image/png',
                  data: b.source.data,
                },
              });
            }
            // URL-source images: Gemini supports `fileData` with a `fileUri`
            // pointing at a GCS object. Skip URL images that aren't GCS for now;
            // future work to upload via Files API.
            break;
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    const body: VertexGeminiBody = {
      contents,
      generationConfig: {
        maxOutputTokens: req.max_tokens,
      },
    };

    if (req.system) {
      body.system_instruction = { parts: [{ text: req.system }] };
    }

    if (req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          })),
        },
      ];
      if (req.tool_choice) {
        const mode =
          req.tool_choice.type === 'any'
            ? 'ANY'
            : req.tool_choice.type === 'none'
              ? 'NONE'
              : 'AUTO';
        const config: VertexGeminiBody['toolConfig'] = {
          functionCallingConfig: { mode },
        };
        if (req.tool_choice.type === 'tool') {
          config.functionCallingConfig.mode = 'ANY';
          config.functionCallingConfig.allowedFunctionNames = [req.tool_choice.name];
        }
        body.toolConfig = config;
      }
      // Q2 — per-turn serial dispatch override. Vertex Gemini accepts
      // `parallelFunctionCalling: false` inside functionCallingConfig.
      if (req.disable_parallel_tool_use === true) {
        if (!body.toolConfig) {
          body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
        }
        body.toolConfig.functionCallingConfig.parallelFunctionCalling = false;
      }
    }

    if (req.stop_sequences && req.stop_sequences.length > 0) {
      body.generationConfig.stopSequences = req.stop_sequences;
    }

    // F1 (Gemini) — pass-through context-cache reference. The caller is
    // responsible for the cachedContents lifecycle (create / refresh / delete
    // via Vertex AI's `cachedContents` REST resource). Empty string is treated
    // as unset to avoid emitting an invalid wire field.
    if (req.cached_content && req.cached_content.length > 0) {
      body.cachedContent = req.cached_content;
    }

    return body;
  }
}
