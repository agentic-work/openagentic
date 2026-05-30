/**
 * Canonical → AWS Bedrock Converse API request body.
 *
 * Bedrock Converse is Anthropic-shape with renamed fields. The mapping is
 * straightforward but the renames are load-bearing — the AWS SDK rejects any
 * Anthropic-native field name.
 *
 *   Anthropic               Bedrock Converse
 *   ---------------------------------------------------
 *   tool_use                toolUse
 *   tool_result             toolResult
 *   tool_use_id             toolUseId
 *   input_schema            inputSchema
 *   max_tokens              inferenceConfig.maxTokens
 *   stop_sequences          inferenceConfig.stopSequences
 *   tools[]                 tools[{toolSpec:...}]    (one level deeper)
 *   tool_choice {auto|any|tool}  toolChoice {auto:{}|any:{}|tool:{name}}
 *
 * Tool ids stay canonical `toolu_*` (Bedrock-Anthropic preserves them).
 *
 * Thinking blocks: only certain Bedrock models (Claude on Bedrock Reasoning)
 * accept the `additionalModelRequestFields.thinking` slot. For now we drop
 * thinking on outbound — the model emits its own; we just don't re-inject
 * prior-turn thinking. Multi-turn reasoning continuity is best-effort on
 * Bedrock (Anthropic direct preserves it through signature; Bedrock doesn't
 * surface signature in the response, so re-injection would fail validation
 * anyway).
 *
 * cache_control: Bedrock-Anthropic supports prompt-caching via a `cachePoint`
 * trailer appended to the array you want cached (tools, messages, or system).
 * F1 — when `tools[]` is non-empty we append `{cachePoint:{type:'default'}}`
 * after the last toolSpec so Bedrock caches the tool prefix. Cost reduction
 * mirrors Anthropic native (~80-90% of tool-prefix input tokens). Future-work:
 * surface a separate `cache_points` array for messages and system caching.
 * Source: AWS Bedrock Converse — prompt-caching wire spec.
 *
 * Spec: AWS Bedrock Converse API docs +
 *       docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 */

import type {
  CanonicalRequest,
  CanonicalMessage,
} from '../canonical/types.js';
import type { ProviderHint } from '../canonical/toolIdNormalize.js';
import type { IOutboundAdapter } from './AdapterContract.js';

interface BedrockConverseBody {
  modelId?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: any[];
  }>;
  system?: Array<{ text: string }>;
  toolConfig?: {
    tools: Array<
      | {
          toolSpec: {
            name: string;
            description: string;
            inputSchema: { json: Record<string, unknown> };
          };
        }
      | { cachePoint: { type: 'default' } }
    >;
    toolChoice?: { auto: {} } | { any: {} } | { tool: { name: string } };
  };
  inferenceConfig: {
    maxTokens: number;
    stopSequences?: string[];
  };
}

export class OpenagenticToBedrock implements IOutboundAdapter {
  readonly format: ProviderHint = 'bedrock-anthropic';

  adaptRequest(req: CanonicalRequest): BedrockConverseBody {
    const messages = req.messages.map((m) => ({
      role: m.role,
      content: this.adaptContent(m),
    }));

    const body: BedrockConverseBody = {
      messages,
      inferenceConfig: {
        maxTokens: req.max_tokens,
      },
    };

    if (req.system) {
      body.system = [{ text: req.system }];
    }

    if (req.tools.length > 0) {
      const toolConfig: BedrockConverseBody['toolConfig'] = {
        tools: [
          ...req.tools.map((t) => ({
            toolSpec: {
              name: t.name,
              description: t.description,
              inputSchema: { json: t.input_schema },
            },
          })),
          // F1 — append cachePoint trailer after the last toolSpec.
          // Bedrock caches everything in the tools array back to this
          // marker, mirroring Anthropic's last-tool cache_control marker.
          { cachePoint: { type: 'default' as const } },
        ],
      };
      if (req.tool_choice) {
        switch (req.tool_choice.type) {
          case 'auto':
            toolConfig.toolChoice = { auto: {} };
            break;
          case 'any':
            toolConfig.toolChoice = { any: {} };
            break;
          case 'tool':
            toolConfig.toolChoice = { tool: { name: req.tool_choice.name } };
            break;
          // 'none' has no Bedrock equivalent; omit toolConfig.toolChoice
        }
      }
      body.toolConfig = toolConfig;
    }

    if (req.stop_sequences && req.stop_sequences.length > 0) {
      body.inferenceConfig.stopSequences = req.stop_sequences;
    }

    return body;
  }

  private adaptContent(m: CanonicalMessage): any[] {
    const out: any[] = [];
    for (const b of m.content) {
      switch (b.type) {
        case 'text':
          out.push({ text: b.text });
          break;
        case 'thinking':
          // Drop on outbound — see file header. Bedrock's reasoning-model
          // outbound shape requires `additionalModelRequestFields.thinking`
          // at the top level, not inline; future work.
          break;
        case 'tool_use':
          out.push({
            toolUse: {
              toolUseId: b.id,
              name: b.name,
              input: b.input,
            },
          });
          break;
        case 'tool_result':
          out.push({
            toolResult: {
              toolUseId: b.tool_use_id,
              content: typeof b.content === 'string'
                ? [{ text: b.content }]
                : b.content.map((sub) => {
                    if (sub.type === 'text') return { text: sub.text };
                    if (sub.type === 'image') {
                      return {
                        image: {
                          format: (sub.source.media_type ?? 'image/png').split('/')[1] as 'png' | 'jpeg' | 'gif' | 'webp',
                          source: { bytes: sub.source.data ?? '' },
                        },
                      };
                    }
                    return { text: '' };
                  }),
              status: b.is_error ? 'error' : 'success',
            },
          });
          break;
        case 'image':
          out.push({
            image: {
              format: (b.source.media_type ?? 'image/png').split('/')[1] as 'png' | 'jpeg' | 'gif' | 'webp',
              source: { bytes: b.source.data ?? '' },
            },
          });
          break;
      }
    }
    return out;
  }
}
