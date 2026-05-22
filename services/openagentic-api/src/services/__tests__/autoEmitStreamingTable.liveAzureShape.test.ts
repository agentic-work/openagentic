import { describe, it, expect, vi } from 'vitest';
import { autoEmitStreamingTable } from './src/services/autoEmitStreamingTable';

describe('LIVE Azure RG response shape', () => {
  it('emits streaming_table for the exact live shape', () => {
    const liveResponse = {
      success: true,
      subscription_id: '815a115d-bf32-495c-a89f-b5ce6b349b57',
      count: 6,
      resource_groups: [
        { name: 'NetworkWatcherRG', location: 'eastus', provisioning_state: 'Succeeded', tags: {} },
        { name: 'DefaultResourceGroup-EUS', location: 'eastus', provisioning_state: 'Succeeded', tags: {} },
        { name: 'rg-openagentic-aif-dev', location: 'eastus', provisioning_state: 'Succeeded', tags: {} },
        { name: 'rg-mcptester-ro', location: 'eastus', provisioning_state: 'Succeeded', tags: { purpose: 'uat-ro' } },
        { name: 'test', location: 'eastus', provisioning_state: 'Succeeded', tags: {} },
        { name: 'DefaultResourceGroup-EUS2', location: 'eastus2', provisioning_state: 'Succeeded', tags: {} },
      ],
      executed_as: { upn: 'mcp-tester@phatoldsungmail.onmicrosoft.com' },
    };
    const write = vi.fn();
    const okObj = autoEmitStreamingTable({
      toolCallId: 'live-1',
      toolName: 'azure_list_resource_groups',
      result: liveResponse,
      write,
    });
    expect(okObj).toBe(true);
    write.mockClear();

    const okStr = autoEmitStreamingTable({
      toolCallId: 'live-2',
      toolName: 'azure_list_resource_groups',
      result: JSON.stringify(liveResponse),
      write,
    });
    expect(okStr).toBe(true);
    expect(write.mock.calls[0][0].rows).toHaveLength(6);
    expect(write.mock.calls[0][0].columns.map((c: any) => c.key)).toEqual(['name', 'location', 'provisioning_state', 'tags']);
  });
});
