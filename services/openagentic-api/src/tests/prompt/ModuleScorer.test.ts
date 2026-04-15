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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptModule, ComposeContext } from '../../services/prompt/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock UniversalEmbeddingService — prevent real embedding calls in tests
vi.mock('../../services/UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: {
    getInstance: vi.fn().mockReturnValue({
      generateEmbedding: vi.fn().mockResolvedValue([]), // Return empty → no semantic search
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModule(overrides: Partial<PromptModule> = {}): PromptModule {
  return {
    id: 'uuid-1',
    name: 'test-module',
    category: 'domain',
    content: 'Some domain guidance.',
    description: 'A test domain module.',
    priority: 50,
    tokenCost: 100,
    enabled: true,
    injection: {},
    version: 1,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ComposeContext> = {}): ComposeContext {
  return {
    message: 'Help me with Azure deployments',
    mode: 'chat',
    model: 'claude-sonnet-4-6',
    availableTools: [],
    userId: 'user-1',
    sessionId: 'session-1',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ModuleScorer', () => {
  let scorer: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../services/prompt/ModuleScorer.js');
    scorer = new mod.ModuleScorer();
  });

  describe('tool rule matching', () => {
    it('sets toolRule=1.0 when module requiresTools matches available tool', async () => {
      const mod = makeModule({
        name: 'azure-ops',
        injection: { requiresTools: ['azure_*'] },
      });
      const ctx = makeContext({
        availableTools: [{ name: 'azure_list_vms' }, { name: 'azure_get_cost' }],
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores).toHaveLength(1);
      expect(scores[0].breakdown.toolRule).toBe(1.0);
    });

    it('sets toolRule=1.0 for exact tool name match (no glob)', async () => {
      const mod = makeModule({
        name: 'github-ops',
        injection: { requiresTools: ['github_create_pr'] },
      });
      const ctx = makeContext({
        availableTools: [{ name: 'github_create_pr' }],
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.toolRule).toBe(1.0);
    });

    it('sets toolRule=0 when no tools match', async () => {
      const mod = makeModule({
        name: 'azure-ops',
        injection: { requiresTools: ['azure_*'] },
      });
      const ctx = makeContext({
        availableTools: [{ name: 'github_create_pr' }],
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.toolRule).toBe(0);
    });

    it('sets toolRule=0 when availableTools is empty', async () => {
      const mod = makeModule({
        name: 'azure-ops',
        injection: { requiresTools: ['azure_*'] },
      });
      const ctx = makeContext({ availableTools: [] });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.toolRule).toBe(0);
    });
  });

  describe('alwaysInject', () => {
    it('sets toolRule=1.0 when alwaysInject is true', async () => {
      const mod = makeModule({
        name: 'error-recovery',
        injection: { alwaysInject: true },
      });
      const ctx = makeContext({ availableTools: [] });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.toolRule).toBe(1.0);
    });

    it('alwaysInject overrides empty requiresTools', async () => {
      const mod = makeModule({
        name: 'error-recovery',
        injection: { alwaysInject: true, requiresTools: [] },
      });

      const scores = await scorer.score([mod], makeContext());

      expect(scores[0].breakdown.toolRule).toBe(1.0);
    });
  });

  describe('history boost', () => {
    it('sets historyBoost=1.0 when module name contains azure and azure in summaryProviders', async () => {
      const mod = makeModule({
        name: 'azure-ops',
        injection: {},
      });
      const ctx = makeContext({
        structuredSummary: { cloudProviders: ['azure'], toolsUsed: [] },
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.historyBoost).toBe(1.0);
    });

    it('sets historyBoost=1.0 when module name contains aws and aws in summaryProviders', async () => {
      const mod = makeModule({ name: 'aws-cost', injection: {} });
      const ctx = makeContext({
        structuredSummary: { cloudProviders: ['aws'], toolsUsed: [] },
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.historyBoost).toBe(1.0);
    });

    it('sets historyBoost=1.0 when module name contains gcp and gcp in summaryProviders', async () => {
      const mod = makeModule({ name: 'gcp-billing', injection: {} });
      const ctx = makeContext({
        structuredSummary: { cloudProviders: ['gcp'], toolsUsed: [] },
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.historyBoost).toBe(1.0);
    });

    it('sets historyBoost=1.0 when module name contains k8s and kubernetes in summaryProviders', async () => {
      const mod = makeModule({ name: 'k8s-ops', injection: {} });
      const ctx = makeContext({
        structuredSummary: { cloudProviders: ['kubernetes'], toolsUsed: [] },
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.historyBoost).toBe(1.0);
    });

    it('sets historyBoost=0.7 when module required tools were used in conversation history', async () => {
      const mod = makeModule({
        name: 'github-ops',
        injection: { requiresTools: ['github_*'] },
      });
      const ctx = makeContext({
        structuredSummary: { cloudProviders: [], toolsUsed: ['github_create_pr', 'github_list_issues'] },
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.historyBoost).toBe(0.7);
    });

    it('sets historyBoost=0 when no provider or tool history matches', async () => {
      const mod = makeModule({
        name: 'azure-ops',
        injection: { requiresTools: ['azure_*'] },
      });
      const ctx = makeContext({
        structuredSummary: { cloudProviders: ['gcp'], toolsUsed: ['gcp_list_vms'] },
      });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.historyBoost).toBe(0);
    });

    it('sets historyBoost=0 when no structuredSummary', async () => {
      const mod = makeModule({ name: 'azure-ops', injection: {} });
      const ctx = makeContext({ structuredSummary: undefined });

      const scores = await scorer.score([mod], ctx);

      expect(scores[0].breakdown.historyBoost).toBe(0);
    });
  });

  describe('module category filtering', () => {
    it('only scores domain modules — skips core', async () => {
      const core = makeModule({ id: 'core-1', name: 'identity', category: 'core' });
      const domain = makeModule({ id: 'dom-1', name: 'azure-ops', category: 'domain' });

      const scores = await scorer.score([core, domain], makeContext());

      expect(scores).toHaveLength(1);
      expect(scores[0].module.name).toBe('azure-ops');
    });

    it('only scores domain modules — skips mode', async () => {
      const mode = makeModule({ id: 'mode-1', name: 'chat-mode', category: 'mode' });
      const domain = makeModule({ id: 'dom-1', name: 'k8s-ops', category: 'domain' });

      const scores = await scorer.score([mode, domain], makeContext());

      expect(scores).toHaveLength(1);
      expect(scores[0].module.name).toBe('k8s-ops');
    });

    it('only scores domain modules — skips capability', async () => {
      const cap = makeModule({ id: 'cap-1', name: 'thinking', category: 'capability' });
      const domain = makeModule({ id: 'dom-1', name: 'aws-cost', category: 'domain' });

      const scores = await scorer.score([cap, domain], makeContext());

      expect(scores).toHaveLength(1);
      expect(scores[0].module.name).toBe('aws-cost');
    });

    it('returns empty array when no domain modules present', async () => {
      const modules = [
        makeModule({ category: 'core' }),
        makeModule({ category: 'mode' }),
        makeModule({ category: 'capability' }),
      ];

      const scores = await scorer.score(modules, makeContext());

      expect(scores).toHaveLength(0);
    });
  });

  describe('score ordering', () => {
    it('sorts modules by score descending', async () => {
      // Module with alwaysInject (toolRule=1.0) should rank higher than one without
      const highScore = makeModule({
        id: 'high',
        name: 'error-recovery',
        injection: { alwaysInject: true },
      });
      const lowScore = makeModule({
        id: 'low',
        name: 'gcp-billing',
        injection: {},
      });

      const scores = await scorer.score([lowScore, highScore], makeContext());

      expect(scores[0].module.id).toBe('high');
      expect(scores[1].module.id).toBe('low');
      expect(scores[0].score).toBeGreaterThanOrEqual(scores[1].score);
    });

    it('returns all scored modules in descending score order', async () => {
      const modules = [
        makeModule({ id: 'a', name: 'gcp-billing', injection: {} }),
        makeModule({ id: 'b', name: 'aws-cost', injection: { alwaysInject: true } }),
        makeModule({ id: 'c', name: 'azure-ops', injection: { requiresTools: ['azure_*'] } }),
      ];
      const ctx = makeContext({
        availableTools: [{ name: 'azure_list_vms' }],
      });

      const scores = await scorer.score(modules, ctx);

      expect(scores).toHaveLength(3);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score);
      }
    });
  });

  describe('score breakdown', () => {
    it('returns all breakdown fields', async () => {
      const mod = makeModule();
      const scores = await scorer.score([mod], makeContext());

      expect(scores[0].breakdown).toMatchObject({
        semantic: expect.any(Number),
        toolRule: expect.any(Number),
        historyBoost: expect.any(Number),
        effectiveness: 0, // Cold start always 0 in Task 6
      });
    });

    it('effectiveness is always 0 (cold start — Task 15 wires Milvus)', async () => {
      const mod = makeModule({ injection: { alwaysInject: true } });
      const scores = await scorer.score([mod], makeContext());

      expect(scores[0].breakdown.effectiveness).toBe(0);
    });
  });
});
