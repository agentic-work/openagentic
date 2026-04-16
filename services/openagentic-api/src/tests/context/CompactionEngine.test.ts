/**
 * Tests for CompactionEngine
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

import { CompactionEngine } from '../../services/context/CompactionEngine.js';

describe('CompactionEngine', () => {
  let engine: CompactionEngine;

  beforeEach(() => {
    engine = new CompactionEngine();
  });

  describe('generateHeuristicSummary', () => {
    it('returns empty summary for empty messages array', () => {
      const summary = engine.generateHeuristicSummary([]);
      expect(summary.text).toBe('');
      expect(summary.topics).toHaveLength(0);
      expect(summary.toolsUsed).toHaveLength(0);
      expect(summary.cloudProviders).toHaveLength(0);
      expect(summary.errorsSeen).toHaveLength(0);
      expect(summary.tokenCount).toBe(0);
    });

    it('extracts tool names from tool_calls', () => {
      const messages = [
        { role: 'user', content: 'Deploy the service' },
        {
          role: 'assistant',
          content: 'Running deployment...',
          tool_calls: [
            { function: { name: 'k8s_apply_manifest', arguments: '{}' } },
            { function: { name: 'k8s_get_pods', arguments: '{}' } },
          ],
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.toolsUsed).toContain('k8s_apply_manifest');
      expect(summary.toolsUsed).toContain('k8s_get_pods');
    });

    it('extracts cloud providers from tool name prefixes', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Checking AWS and Azure...',
          tool_calls: [
            { function: { name: 'aws_list_instances', arguments: '{}' } },
            { function: { name: 'azure_get_vms', arguments: '{}' } },
            { function: { name: 'gcp_list_buckets', arguments: '{}' } },
            { function: { name: 'github_list_repos', arguments: '{}' } },
          ],
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.cloudProviders).toContain('AWS');
      expect(summary.cloudProviders).toContain('Azure');
      expect(summary.cloudProviders).toContain('GCP');
      expect(summary.cloudProviders).toContain('GitHub');
    });

    it('detects Kubernetes cloud provider from k8s_ prefix', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Checking k8s...',
          tool_calls: [
            { function: { name: 'k8s_list_pods', arguments: '{}' } },
          ],
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.cloudProviders).toContain('Kubernetes');
    });

    it('detects call_aws_ prefix as AWS', () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'call_aws_describe_instances', arguments: '{}' } },
          ],
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.cloudProviders).toContain('AWS');
    });

    it('extracts topics from user messages', () => {
      const messages = [
        { role: 'user', content: 'What is the current AWS cost and billing status?' },
        { role: 'assistant', content: 'Let me check...' },
        { role: 'user', content: 'Also check for security vulnerabilities.' },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.topics).toContain('cost-management');
      expect(summary.topics).toContain('security');
    });

    it('extracts errors from message content', () => {
      const messages = [
        {
          role: 'tool',
          content: 'Error: ConnectionRefused - could not connect to database',
          name: 'db_query',
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.errorsSeen.length).toBeGreaterThan(0);
      expect(summary.errorsSeen[0]).toContain('ConnectionRefused');
    });

    it('handles toolCalls (camelCase) in addition to tool_calls (snake_case)', () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { function: { name: 'azure_deploy_app', arguments: '{}' } },
          ],
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.toolsUsed).toContain('azure_deploy_app');
      expect(summary.cloudProviders).toContain('Azure');
    });

    it('handles array content format', () => {
      const messages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'monitor the kubernetes cluster' }],
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.topics).toContain('monitoring');
    });

    it('generates non-empty summary text when messages present', () => {
      const messages = [
        { role: 'user', content: 'Deploy the app to production' },
        {
          role: 'assistant',
          content: 'Deploying...',
          tool_calls: [{ function: { name: 'k8s_apply_manifest', arguments: '{}' } }],
        },
      ];

      const summary = engine.generateHeuristicSummary(messages);
      expect(summary.text.length).toBeGreaterThan(0);
      expect(summary.tokenCount).toBeGreaterThan(0);
    });
  });

  describe('generateLLMSummary', () => {
    it('falls back to heuristic on provider error', async () => {
      const mockProviderManager = {
        createCompletion: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      };

      const messages = [
        { role: 'user', content: 'Check AWS cost' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'aws_get_costs', arguments: '{}' } }],
        },
      ];

      const summary = await engine.generateLLMSummary(messages, mockProviderManager as any);
      // Should fall back to heuristic
      expect(summary.toolsUsed).toContain('aws_get_costs');
      expect(summary.cloudProviders).toContain('AWS');
    });

    it('returns empty summary for empty messages', async () => {
      const mockProviderManager = {
        createCompletion: vi.fn(),
      };

      const summary = await engine.generateLLMSummary([], mockProviderManager as any);
      expect(summary.text).toBe('');
      expect(summary.tokenCount).toBe(0);
      // provider should not have been called
      expect(mockProviderManager.createCompletion).not.toHaveBeenCalled();
    });

    it('parses JSON response from LLM', async () => {
      const llmResult = {
        text: 'Deployed service to k8s cluster',
        topics: ['deployment'],
        toolsUsed: ['k8s_apply'],
        keyDecisions: ['Used rolling update'],
        cloudProviders: ['Kubernetes'],
        artifacts: [],
        errorsSeen: [],
      };

      const mockProviderManager = {
        createCompletion: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(llmResult) } }],
        }),
      };

      const messages = [
        { role: 'user', content: 'Deploy the app' },
        { role: 'assistant', content: 'Deploying...' },
      ];

      const summary = await engine.generateLLMSummary(messages, mockProviderManager as any);
      expect(summary.text).toBe('Deployed service to k8s cluster');
      expect(summary.topics).toContain('deployment');
      expect(summary.toolsUsed).toContain('k8s_apply');
      expect(summary.cloudProviders).toContain('Kubernetes');
    });

    it('handles non-JSON prose response from LLM', async () => {
      const mockProviderManager = {
        createCompletion: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'The session covered a deployment of the web service.' } }],
        }),
      };

      const messages = [{ role: 'user', content: 'Deploy' }];
      const summary = await engine.generateLLMSummary(messages, mockProviderManager as any);
      expect(summary.text).toContain('deployment');
      expect(summary.tokenCount).toBeGreaterThan(0);
    });
  });
});
