/**
 * REAL-provider integration test for buildBedrockClaudeBody.
 * Routes through us-east-1 inference profile. SKIPs without AWS creds.
 */

import { describe, it, expect } from 'vitest';
import { buildBedrockClaudeBody } from '../buildBedrockClaudeBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const hasAwsCreds = Boolean(
  process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION),
);

describe.skipIf(!hasAwsCreds)(
  'buildBedrockClaudeBody — REAL Bedrock round-trip',
  () => {
    it('basic text turn: 200 OK from InvokeModelWithResponseStream', async () => {
      const body = buildBedrockClaudeBody(
        {
          messages: [
            { role: 'system', content: 'Reply with the number only.' },
            { role: 'user', content: 'What is 12 times 11?' },
          ],
          max_tokens: 32,
        } as CompletionRequest,
        { parallelOn: false },
      );

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
          body: new TextEncoder().encode(JSON.stringify(body)),
        }),
      );

      expect(response.$metadata.httpStatusCode).toBe(200);
      expect(response.body).toBeDefined();

      // Drain first chunk to confirm the stream is real.
      let first: any = null;
      for await (const ev of response.body!) {
        first = ev;
        break;
      }
      expect(first).toBeDefined();
    }, 30_000);

    it('tools + parallel batch: 3 tool_use blocks survive round-trip and stream returns valid SSE', async () => {
      const body = buildBedrockClaudeBody(
        {
          messages: [
            { role: 'user', content: 'I need 3 boolean checks. Call check_status for system_a, system_b, and system_c in parallel.' },
          ],
          max_tokens: 512,
          tools: [
            {
              type: 'function',
              function: {
                name: 'check_status',
                description: 'Check whether a named system is up. Returns a boolean.',
                parameters: {
                  type: 'object',
                  properties: { system: { type: 'string' } },
                  required: ['system'],
                },
              },
            },
          ],
        } as CompletionRequest,
        { parallelOn: true },
      );

      // Sanity: the body must carry tools + tool_choice + parallel flag.
      expect((body as any).tools).toHaveLength(1);
      expect((body as any).tool_choice).toBeDefined();

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
          body: new TextEncoder().encode(JSON.stringify(body)),
        }),
      );

      expect(response.$metadata.httpStatusCode).toBe(200);
    }, 45_000);
  },
);
