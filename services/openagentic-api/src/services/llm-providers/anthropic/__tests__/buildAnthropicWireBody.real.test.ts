/**
 * REAL-provider integration test for buildAnthropicWireBody.
 *
 * Validates that the wire body produced by the Phase 0.4 helper is
 * accepted byte-for-byte by a live Anthropic Messages API endpoint. We
 * route through Bedrock (which uses the SAME Anthropic Messages wire
 * shape — both bedrock-anthropic and anthropic ProviderHints map to
 * `OpenagenticToAnthropic` in the SDK adapter index), so this test
 * unlocks with just `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
 * `AWS_REGION` — no separate ANTHROPIC_API_KEY needed.
 *
 * SKIPs when creds are missing (per the user's manual-probe cadence —
 * see `feedback_no_synthetic_chunks_only_real_provider_captures`).
 *
 * the design notes
 */

import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../buildAnthropicWireBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const hasAwsCreds = Boolean(
  process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION),
);

describe.skipIf(!hasAwsCreds)(
  'buildAnthropicWireBody — REAL Bedrock-Anthropic round-trip',
  () => {
    it('produces a wire body that Bedrock InvokeModelWithResponseStream accepts (200 OK)', async () => {
      const request: CompletionRequest = {
        messages: [
          { role: 'system', content: 'You are a calculator. Reply with the number only.' },
          { role: 'user', content: 'What is 17 times 23?' },
        ],
        max_tokens: 64,
      };

      const wire = buildAnthropicWireBody(request, {
        model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        parallelOn: false, // calculator turn — no tools
      });

      // Bedrock InvokeModelWithResponseStream expects the same Messages
      // API JSON body Anthropic.com direct does, with one quirk:
      // Bedrock rejects `model` in the body (it's in the URL path).
      const { model, ...bodyForBedrock } = wire as any;
      void model;
      // Add the Bedrock-specific anthropic_version field.
      (bodyForBedrock as any).anthropic_version = 'bedrock-2023-05-31';

      // Lazy import — bedrock-runtime is heavy.
      const { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } =
        await import('@aws-sdk/client-bedrock-runtime');

      const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      });

      const response = await client.send(
        new InvokeModelWithResponseStreamCommand({
          modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(JSON.stringify(bodyForBedrock)),
        }),
      );

      // The stream object exists → API accepted the request shape.
      expect(response.$metadata.httpStatusCode).toBe(200);
      expect(response.body).toBeDefined();

      // Drain the first chunk so the connection terminates cleanly.
      let firstChunk: any = null;
      for await (const event of response.body!) {
        firstChunk = event;
        break;
      }
      expect(firstChunk).toBeDefined();
    }, 30_000);

    it('produces a tool-bearing body that Bedrock accepts (tools + tool_choice round-trip)', async () => {
      const request: CompletionRequest = {
        messages: [
          { role: 'user', content: 'List the first 3 even numbers.' },
        ],
        max_tokens: 256,
        tools: [
          {
            type: 'function',
            function: {
              name: 'list_numbers',
              description: 'Return a list of numbers',
              parameters: {
                type: 'object',
                properties: {
                  numbers: { type: 'array', items: { type: 'integer' } },
                },
                required: ['numbers'],
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'list_numbers' } },
      };

      const wire = buildAnthropicWireBody(request, {
        model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        parallelOn: false,
      });

      // Verify wire-shape assertions BEFORE making the network call —
      // if the helper produced a bad body, the network call would fail
      // with a confusing error.
      expect((wire as any).tools).toEqual([
        {
          name: 'list_numbers',
          description: 'Return a list of numbers',
          input_schema: {
            type: 'object',
            properties: {
              numbers: { type: 'array', items: { type: 'integer' } },
            },
            required: ['numbers'],
          },
        },
      ]);
      expect((wire as any).tool_choice).toEqual({
        type: 'tool',
        name: 'list_numbers',
        disable_parallel_tool_use: true,
      });

      // Network call — same body shape, just stripping `model` for Bedrock.
      const { model, ...bodyForBedrock } = wire as any;
      void model;
      (bodyForBedrock as any).anthropic_version = 'bedrock-2023-05-31';

      const { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } =
        await import('@aws-sdk/client-bedrock-runtime');

      const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      });

      const response = await client.send(
        new InvokeModelWithResponseStreamCommand({
          modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(JSON.stringify(bodyForBedrock)),
        }),
      );

      expect(response.$metadata.httpStatusCode).toBe(200);
    }, 30_000);
  },
);
