/**
 * #656 Sev-2 — AzureAIFoundryProvider Anthropic-shape non-stream path must
 * surface thinking blocks. Mirrors the Bedrock #647 Layer 2 fix:
 * `convertAnthropicResponseToOpenAI` (line ~1067) extracts text + tool_use
 * but drops `thinking` blocks. Sonnet on AIF emits them when thinking is
 * enabled; the V2 chat pipeline expects them in `message.reasoning_content`.
 *
 * The OpenAI-shape branch (`nonStreamCompletion`) doesn't need a fix —
 * it returns `data` verbatim, so `message.reasoning_content` from the
 * upstream model passes through. Only the Anthropic-shape converter
 * dropped them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import { AzureAIFoundryProvider } from '../AzureAIFoundryProvider.js';

const fakeLogger: any = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => fakeLogger,
};

function makeProvider(): AzureAIFoundryProvider {
  const config: any = {
    type: 'azure-ai-foundry',
    endpoint: 'https://test.cognitiveservices.azure.com',
    apiKey: 'test-key',
    deploymentName: 'gpt-test',
    apiVersion: '2024-12-01-preview',
  };
  // @ts-expect-error skip async initialize for offline tests
  return new AzureAIFoundryProvider(fakeLogger, config);
}

describe('#656 — AIF convertAnthropicResponseToOpenAI surfaces thinking', () => {
  let provider: AzureAIFoundryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = makeProvider();
  });

  it('surfaces Anthropic content[].type=thinking blocks as message.reasoning_content', () => {
    const anthropicResponse = {
      id: 'msg_test',
      content: [
        { type: 'thinking', thinking: 'Let me think through this carefully.' },
        { type: 'text', text: 'Here is my reasoned answer.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 30 },
    };

    const result = (provider as any).convertAnthropicResponseToOpenAI(
      anthropicResponse,
      'claude-sonnet-4-6',
    );

    expect(result.choices[0].message.reasoning_content).toBe(
      'Let me think through this carefully.',
    );
    expect(result.choices[0].message.content).toBe('Here is my reasoned answer.');
  });

  it('concatenates multiple thinking blocks into one reasoning_content string', () => {
    const anthropicResponse = {
      id: 'msg_test',
      content: [
        { type: 'thinking', thinking: 'First step.' },
        { type: 'thinking', thinking: ' Second step.' },
        { type: 'text', text: 'Final answer.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 30 },
    };

    const result = (provider as any).convertAnthropicResponseToOpenAI(
      anthropicResponse,
      'claude-sonnet-4-6',
    );
    expect(result.choices[0].message.reasoning_content).toBe(
      'First step. Second step.',
    );
  });

  it('omits reasoning_content when no thinking blocks present', () => {
    const anthropicResponse = {
      id: 'msg_test',
      content: [{ type: 'text', text: 'No thinking here.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const result = (provider as any).convertAnthropicResponseToOpenAI(
      anthropicResponse,
      'claude-sonnet-4-6',
    );
    expect(result.choices[0].message.reasoning_content).toBeUndefined();
    expect(result.choices[0].message.content).toBe('No thinking here.');
  });

  it('preserves tool_use extraction alongside thinking blocks', () => {
    const anthropicResponse = {
      id: 'msg_test',
      content: [
        { type: 'thinking', thinking: 'I need a tool here.' },
        { type: 'tool_use', id: 'tu_1', name: 'azure_list_subscriptions', input: { tenant: 'abc' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 30 },
    };

    const result = (provider as any).convertAnthropicResponseToOpenAI(
      anthropicResponse,
      'claude-sonnet-4-6',
    );
    expect(result.choices[0].message.reasoning_content).toBe('I need a tool here.');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });
});
