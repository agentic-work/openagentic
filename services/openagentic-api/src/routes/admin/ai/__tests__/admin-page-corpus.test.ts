/**
 * Tests for the Admin AI corpus.
 *
 * Two important contracts:
 *   1. buildAdminCorpusPromptBlock() returns a stable markdown block
 *      grouped by section with deep-link tokens the LLM can mimic.
 *   2. Every slug in the UI sidebar must have a corpus entry — keeps
 *      the AI from ever pointing at a page it doesn't know about.
 *      Drift detector: when sidebar adds a page, this test fails.
 */

import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE_CORPUS, buildAdminCorpusPromptBlock } from '../admin-page-corpus.js';

describe('admin-page-corpus', () => {
  it('exports a non-empty corpus', () => {
    expect(ADMIN_PAGE_CORPUS.length).toBeGreaterThan(40);
  });

  it('every entry has slug, label, group, purpose', () => {
    for (const e of ADMIN_PAGE_CORPUS) {
      expect(e.slug).toBeTruthy();
      expect(e.label).toBeTruthy();
      expect(e.group).toBeTruthy();
      expect(e.purpose).toBeTruthy();
      expect(e.purpose.length).toBeGreaterThan(20);
    }
  });

  it('slugs are unique', () => {
    const seen = new Set<string>();
    for (const e of ADMIN_PAGE_CORPUS) {
      expect(seen.has(e.slug)).toBe(false);
      seen.add(e.slug);
    }
  });

  it('every essential admin page is covered (drift guard)', () => {
    // These slugs come from sidebar-items.ts. If a page is added to the
    // sidebar without a corpus entry the AI silently can't link to it.
    // Update both lists together.
    const required = [
      'overview',
      // System
      'users', 'settings', 'rate-limits',
      // LLM
      'providers', 'llm-default-models', 'model-management', 'ollama',
      'tiered-fc', 'llm-router-tuning', 'llm-performance',
      // Tools
      'mcp-management', 'mcp-logs', 'mcp-kubernetes',
      'synth-management', 'synth-approvals', 'synth-stats', 'tool-execution-mode',
      // Flows
      'native-workflow-list', 'native-execution-list', 'native-workflow-costs',
      'native-workflow-credentials', 'native-workflow-settings',
      'flows-kpis', 'flows-audit-logs', 'teams',
      // Code Mode
      'codemode-settings', 'codemode-global', 'codemode-mcp',
      'codemode-skills', 'codemode-users', 'openagentic-metrics',
      // Agents
      'agent-registry', 'agent-skills', 'agent-executions',
      // Integrations
      'slack-integration', 'teams-integration', 'integration-logs',
      // Prompts ('prompts' Legacy Templates retired — tracked in task #94)
      'prompt-modules', 'prompt-effectiveness', 'prompt-metrics',
      // Content
      'templates', 'pipeline-settings', 'shared-kb', 'data-layer', 'user-context',
      // Chargeback
      'chargeback-dashboard',
      // Monitoring (standalone 'performance' folded into Dashboard Overview tabs — task #76)
      'user-activity', 'analytics', 'feedback', 'audit',
      'errors', 'context-window', 'embeddings', 'grafana', 'test-harness',
      // Security
      'auth-access', 'permissions', 'user-lockout', 'tokens',
      'network', 'webhook-security', 'dlp-config',
    ];
    const corpusSlugs = new Set(ADMIN_PAGE_CORPUS.map(e => e.slug));
    const missing = required.filter(s => !corpusSlugs.has(s));
    expect(missing).toEqual([]);
  });

  it('buildAdminCorpusPromptBlock returns markdown grouped by section', () => {
    const block = buildAdminCorpusPromptBlock();
    expect(block).toContain('ADMIN CONSOLE PAGE CATALOG');
    expect(block).toContain('## Overview');
    expect(block).toContain('## LLM');
    expect(block).toContain('## Security');
  });

  it('buildAdminCorpusPromptBlock emits clickable [Open …](#slug) tokens', () => {
    const block = buildAdminCorpusPromptBlock();
    expect(block).toMatch(/\[Provider Management\]\(#providers\)/);
    expect(block).toMatch(/\[Models\]\(#model-management\)/);
    expect(block).toMatch(/\[DLP Configuration\]\(#dlp-config\)/);
  });

  it('buildAdminCorpusPromptBlock fits in a reasonable LLM context (under 30k chars)', () => {
    // ~30k chars ≈ 7-8k tokens. The Smart Router default model has
    // at least 64k context, so this leaves plenty for user message + reply.
    const block = buildAdminCorpusPromptBlock();
    expect(block.length).toBeGreaterThan(2000);
    expect(block.length).toBeLessThan(30000);
  });
});
