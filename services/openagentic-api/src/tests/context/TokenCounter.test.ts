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

import { describe, it, expect } from 'vitest';
import { TokenCounter } from '../../services/context/TokenCounter.js';

describe('TokenCounter', () => {
  const counter = new TokenCounter();

  it('estimates tokens for short text', () => {
    const tokens = counter.estimateTokens('hello world');
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(tokens).toBeLessThanOrEqual(6);
  });

  it('estimates tokens for empty string', () => {
    expect(counter.estimateTokens('')).toBe(0);
  });

  it('counts message tokens including role overhead', () => {
    const msg = { role: 'user', content: 'hello world' };
    const tokens = counter.countMessage(msg);
    expect(tokens).toBeGreaterThan(counter.estimateTokens('hello world'));
  });

  it('counts tool call message tokens including function metadata', () => {
    const msg = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: '1', function: { name: 'test_tool', arguments: '{"key":"value"}' } }]
    };
    const tokens = counter.countMessage(msg);
    expect(tokens).toBeGreaterThan(10);
  });

  it('counts tool definition tokens', () => {
    const tool = {
      type: 'function',
      function: {
        name: 'azure_list_vms',
        description: 'List all VMs in a resource group',
        parameters: { type: 'object', properties: { resourceGroup: { type: 'string' } } }
      }
    };
    const tokens = counter.countToolDefinition(tool);
    expect(tokens).toBeGreaterThan(20);
  });

  it('batch counts messages', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    const total = counter.countMessages(msgs);
    expect(total).toBe(counter.countMessage(msgs[0]) + counter.countMessage(msgs[1]));
  });
});
