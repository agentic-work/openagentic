/**
 * scanMissingSecrets — finds {{secret:NAME}} references across node configs
 * that don't yet exist in the provided list of known secret names.
 *
 * Used to populate the MissingSecretsWizard before Run when the workflow
 * references credentials the user hasn't created yet.
 */

import { describe, it, expect } from 'vitest';
import { scanMissingSecrets } from '../scanMissingSecrets';

describe('scanMissingSecrets', () => {
  it('returns [] when no nodes reference any secrets', () => {
    const nodes = [
      { id: 'n1', type: 'agent_single', data: { task: 'Hello world' } },
    ];
    expect(scanMissingSecrets(nodes, [])).toEqual([]);
  });

  it('returns [] when every referenced secret is already known', () => {
    const nodes = [
      { id: 'n1', type: 'http', data: { headers: { Authorization: 'Bearer {{secret:API_KEY}}' } } },
    ];
    expect(scanMissingSecrets(nodes, ['API_KEY', 'OTHER'])).toEqual([]);
  });

  it('returns one entry per unique missing secret with the nodes that reference it', () => {
    const nodes = [
      { id: 'n1', type: 'http', data: { url: 'https://api.example.com', headers: { Authorization: 'Bearer {{secret:STRIPE_KEY}}' } } },
      { id: 'n2', type: 'pagerduty_incident', data: { routingKey: '{{secret:PD_ROUTING_KEY}}' } },
      { id: 'n3', type: 'http', data: { headers: { 'X-Auth': '{{secret:STRIPE_KEY}}' } } },
    ];
    const result = scanMissingSecrets(nodes, []);
    expect(result).toHaveLength(2);
    const stripe = result.find((r) => r.name === 'STRIPE_KEY');
    expect(stripe).toBeTruthy();
    expect(stripe!.nodeIds).toEqual(['n1', 'n3']);
    const pd = result.find((r) => r.name === 'PD_ROUTING_KEY');
    expect(pd).toBeTruthy();
    expect(pd!.nodeIds).toEqual(['n2']);
  });

  it('finds references in deeply nested object/array values', () => {
    const nodes = [
      {
        id: 'deep',
        type: 'multi_agent',
        data: {
          agents: [
            { role: 'a', tools: [], systemPrompt: 'Use key {{secret:NESTED_KEY}} carefully.' },
            { role: 'b', config: { nested: { deeper: '{{secret:DEEP_KEY}}' } } },
          ],
        },
      },
    ];
    const result = scanMissingSecrets(nodes, []);
    expect(result.map((r) => r.name).sort()).toEqual(['DEEP_KEY', 'NESTED_KEY']);
  });

  it('treats names case-sensitively and trims surrounding whitespace inside braces', () => {
    const nodes = [
      { id: 'n1', type: 'http', data: { url: '{{secret: api_key }}' } },
    ];
    const result = scanMissingSecrets(nodes, ['api_key']);
    expect(result).toEqual([]);
  });

  it('ignores {{secret:NAME}} when NAME is empty', () => {
    const nodes = [
      { id: 'n1', type: 'http', data: { url: '{{secret:}}' } },
    ];
    expect(scanMissingSecrets(nodes, [])).toEqual([]);
  });
});
