/**
 * #647 Layer 2 — AWSBedrockProvider non-stream paths must surface thinking
 * blocks (Claude `thinking` via InvokeModel + non-Claude `reasoningContent`
 * via Converse) so downstream V2 chat / codemode can render Sonnet
 * reasoning. Streaming paths already handle this; non-stream silently
 * dropped them.
 *
 * Two paths, two contracts:
 *
 * 1. Claude / InvokeModel (parseBedrockResponse, line ~1821):
 *    - Anthropic API returns content[] with `{type:'thinking', thinking:'…'}`
 *    - Today line 1830-1849 only extracts `text` + `tool_use`.
 *    - Fix: also extract `thinking` blocks → message.reasoning_content.
 *
 * 2. Non-Claude / Converse (nonStreamWithConverseAPI, line ~879):
 *    - Converse returns content[] with `{reasoningContent: {reasoningText:
 *      {text: '…'}}}`
 *    - Today line 911 only extracts `text` + `toolUse`.
 *    - Fix: also extract `reasoningContent` blocks → message.reasoning_content.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeModelCommand: vi.fn().mockImplementation((input) => ({ __input: input })),
  InvokeModelWithResponseStreamCommand: vi.fn(),
  ConverseCommand: vi.fn().mockImplementation((input) => ({ __input: input })),
  ConverseStreamCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock', () => ({
  BedrockClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  ListFoundationModelsCommand: vi.fn(),
  GetFoundationModelCommand: vi.fn(),
  ListInferenceProfilesCommand: vi.fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import { AWSBedrockProvider } from '../AWSBedrockProvider.js';

const fakeLogger: any = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => fakeLogger,
};

function makeProvider(): AWSBedrockProvider {
  const provider = new AWSBedrockProvider(fakeLogger, {
    type: 'aws-bedrock',
    authType: 'iam-keys',
    accessKeyId: 'AKIA-TEST',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
  } as any);
  (provider as any).initialized = true;
  (provider as any).runtimeClient = { send: mockSend };
  (provider as any).getBedrockClient = vi.fn().mockResolvedValue({ send: mockSend });
  return provider;
}

function encodeBody(obj: unknown): { body: Uint8Array } {
  return { body: new TextEncoder().encode(JSON.stringify(obj)) };
}

describe('#647 Layer 2a — Claude InvokeModel non-stream surfaces thinking', () => {
  let provider: AWSBedrockProvider;

  beforeEach(() => {
    mockSend.mockReset();
    provider = makeProvider();
  });

  afterEach(() => vi.clearAllMocks());

  it('surfaces content[].type=thinking as message.reasoning_content', async () => {
    mockSend.mockResolvedValueOnce(encodeBody({
      id: 'msg_01',
      content: [
        { type: 'thinking', thinking: 'Let me work through this carefully.' },
        { type: 'text', text: 'Here is my answer.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    const result = await provider.createCompletion({
      model: 'us.anthropic.claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
      stream: false,
    } as any);

    expect((result as any).choices[0].message.reasoning_content).toBe(
      'Let me work through this carefully.',
    );
    expect((result as any).choices[0].message.content).toBe('Here is my answer.');
  });

  it('concatenates multiple thinking blocks', async () => {
    mockSend.mockResolvedValueOnce(encodeBody({
      content: [
        { type: 'thinking', thinking: 'First thought.' },
        { type: 'thinking', thinking: ' Second thought.' },
        { type: 'text', text: 'Final answer.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    const result = await provider.createCompletion({
      model: 'us.anthropic.claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
      stream: false,
    } as any);

    expect((result as any).choices[0].message.reasoning_content).toBe(
      'First thought. Second thought.',
    );
  });

  it('omits reasoning_content when no thinking blocks', async () => {
    mockSend.mockResolvedValueOnce(encodeBody({
      content: [{ type: 'text', text: 'No thinking here.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    const result = await provider.createCompletion({
      model: 'us.anthropic.claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
      stream: false,
    } as any);

    expect((result as any).choices[0].message.reasoning_content).toBeUndefined();
    expect((result as any).choices[0].message.content).toBe('No thinking here.');
  });

  it('preserves tool_use extraction alongside thinking', async () => {
    mockSend.mockResolvedValueOnce(encodeBody({
      content: [
        { type: 'thinking', thinking: 'I need to call a tool.' },
        { type: 'tool_use', id: 'tu_1', name: 'azure_list_resource_groups', input: { subscription: 'abc' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 100 },
    }));

    const result = await provider.createCompletion({
      model: 'us.anthropic.claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
      stream: false,
    } as any);

    expect((result as any).choices[0].message.reasoning_content).toBe('I need to call a tool.');
    expect((result as any).choices[0].message.tool_calls).toHaveLength(1);
    expect((result as any).choices[0].message.tool_calls[0].function.name).toBe(
      'azure_list_resource_groups',
    );
  });
});

describe('#647 Layer 2b — Non-Claude Converse non-stream surfaces reasoningContent', () => {
  let provider: AWSBedrockProvider;

  beforeEach(() => {
    mockSend.mockReset();
    provider = makeProvider();
  });

  afterEach(() => vi.clearAllMocks());

  it('surfaces reasoningContent.reasoningText.text as message.reasoning_content', async () => {
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          role: 'assistant',
          content: [
            { reasoningContent: { reasoningText: { text: 'Let me think.' } } },
            { text: 'Here is my answer.' },
          ],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await provider.createCompletion({
      model: 'amazon.nova-pro-v1:0',
      messages: [{ role: 'user', content: 'test' }],
      stream: false,
    } as any);

    expect((result as any).choices[0].message.reasoning_content).toBe('Let me think.');
    expect((result as any).choices[0].message.content).toBe('Here is my answer.');
  });

  it('omits reasoning_content when Converse response has no reasoningContent', async () => {
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          role: 'assistant',
          content: [{ text: 'Plain text reply.' }],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await provider.createCompletion({
      model: 'amazon.nova-pro-v1:0',
      messages: [{ role: 'user', content: 'test' }],
      stream: false,
    } as any);

    expect((result as any).choices[0].message.reasoning_content).toBeUndefined();
    expect((result as any).choices[0].message.content).toBe('Plain text reply.');
  });
});
