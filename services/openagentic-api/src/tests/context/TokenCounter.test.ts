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
