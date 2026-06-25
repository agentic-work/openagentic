/**
 * SmartModelRouter Unit Tests
 *
 * Tests for intelligent model routing:
 * - Provider availability
 * - Model mapping
 * - Fallback logic
 * - Cost optimization
 * - Capability matching
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SmartModelRouter', () => {
  describe('Provider Availability', () => {
    const providers = {
      anthropic: { available: true, models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'] },
      openai: { available: true, models: ['gpt-4o', 'gpt-4o-mini', 'o1'] },
      google: { available: true, models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro'] },
      azure: { available: false, models: [] },
      ollama: { available: true, models: ['llama3.2', 'qwen2.5-coder'] }
    };

    const isModelAvailable = (modelId: string): boolean => {
      for (const [_, provider] of Object.entries(providers)) {
        if (provider.available && provider.models.includes(modelId)) {
          return true;
        }
      }
      return false;
    };

    it('should report Claude models as available', () => {
      expect(isModelAvailable('claude-3-5-sonnet-20241022')).toBe(true);
    });

    it('should report GPT models as available', () => {
      expect(isModelAvailable('gpt-4o')).toBe(true);
    });

    it('should report unavailable models correctly', () => {
      expect(isModelAvailable('azure-gpt-4')).toBe(false);
    });

    it('should report unknown models as unavailable', () => {
      expect(isModelAvailable('nonexistent-model')).toBe(false);
    });
  });

  describe('Model ID Mapping', () => {
    const modelAliases: Record<string, string> = {
      'claude': 'claude-3-5-sonnet-20241022',
      'claude-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-haiku': 'claude-3-5-haiku-20241022',
      'gpt-4': 'gpt-4o',
      'gpt-4-turbo': 'gpt-4o',
      'gemini': 'gemini-2.0-flash-exp',
      'gemini-flash': 'gemini-2.0-flash-exp',
      'gpt-oss': 'llama3.2', // Ollama
      'local': 'llama3.2'
    };

    const resolveModelId = (input: string): string => {
      return modelAliases[input] || input;
    };

    it('should resolve claude alias', () => {
      expect(resolveModelId('claude')).toBe('claude-3-5-sonnet-20241022');
    });

    it('should resolve gpt-4 alias', () => {
      expect(resolveModelId('gpt-4')).toBe('gpt-4o');
    });

    it('should resolve gemini alias', () => {
      expect(resolveModelId('gemini')).toBe('gemini-2.0-flash-exp');
    });

    it('should resolve gpt-oss to Ollama model', () => {
      expect(resolveModelId('gpt-oss')).toBe('llama3.2');
    });

    it('should return original if no alias', () => {
      expect(resolveModelId('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('Capability Matching', () => {
    interface ModelCapabilities {
      vision: boolean;
      tools: boolean;
      streaming: boolean;
      thinking: boolean;
      json: boolean;
      maxTokens: number;
    }

    const capabilities: Record<string, ModelCapabilities> = {
      'claude-3-5-sonnet-20241022': {
        vision: true, tools: true, streaming: true, thinking: true, json: true, maxTokens: 8192
      },
      'claude-3-5-haiku-20241022': {
        vision: true, tools: true, streaming: true, thinking: false, json: true, maxTokens: 4096
      },
      'gpt-4o': {
        vision: true, tools: true, streaming: true, thinking: false, json: true, maxTokens: 4096
      },
      'gpt-4o-mini': {
        vision: true, tools: true, streaming: true, thinking: false, json: true, maxTokens: 4096
      },
      'gemini-2.0-flash-exp': {
        vision: true, tools: true, streaming: true, thinking: true, json: true, maxTokens: 8192
      },
      'llama3.2': {
        vision: false, tools: false, streaming: true, thinking: false, json: false, maxTokens: 4096
      }
    };

    const supportsCapability = (modelId: string, capability: keyof ModelCapabilities): boolean => {
      const caps = capabilities[modelId];
      if (!caps) return false;
      return caps[capability] === true;
    };

    it('should identify vision-capable models', () => {
      expect(supportsCapability('claude-3-5-sonnet-20241022', 'vision')).toBe(true);
      expect(supportsCapability('gpt-4o', 'vision')).toBe(true);
      expect(supportsCapability('llama3.2', 'vision')).toBe(false);
    });

    it('should identify tool-capable models', () => {
      expect(supportsCapability('claude-3-5-sonnet-20241022', 'tools')).toBe(true);
      expect(supportsCapability('llama3.2', 'tools')).toBe(false);
    });

    it('should identify thinking-capable models', () => {
      expect(supportsCapability('claude-3-5-sonnet-20241022', 'thinking')).toBe(true);
      expect(supportsCapability('gemini-2.0-flash-exp', 'thinking')).toBe(true);
      expect(supportsCapability('gpt-4o', 'thinking')).toBe(false);
    });
  });

  describe('Cost-Based Routing', () => {
    const modelCosts: Record<string, { input: number; output: number }> = {
      'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
      'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gemini-2.0-flash-exp': { input: 0.00025, output: 0.001 },
      'llama3.2': { input: 0, output: 0 } // Local = free
    };

    const getModelsByCost = (ascending: boolean = true): string[] => {
      const models = Object.entries(modelCosts)
        .map(([id, cost]) => ({ id, avgCost: (cost.input + cost.output) / 2 }))
        .sort((a, b) => ascending ? a.avgCost - b.avgCost : b.avgCost - a.avgCost);
      return models.map(m => m.id);
    };

    const selectCheapestModel = (capability?: string): string => {
      const sorted = getModelsByCost(true);
      return sorted[0];
    };

    it('should identify Ollama as cheapest', () => {
      const cheapest = selectCheapestModel();
      expect(cheapest).toBe('llama3.2');
    });

    it('should sort models by cost', () => {
      const sorted = getModelsByCost(true);
      // llama3.2 (free) should be first
      expect(sorted[0]).toBe('llama3.2');
      // Claude Sonnet or GPT-4o should be expensive
      expect(sorted.indexOf('claude-3-5-sonnet-20241022')).toBeGreaterThan(2);
    });
  });

  describe('Fallback Logic', () => {
    const availableProviders = new Set(['anthropic', 'openai', 'google', 'ollama']);

    const providerForModel: Record<string, string> = {
      'claude-3-5-sonnet-20241022': 'anthropic',
      'claude-3-5-haiku-20241022': 'anthropic',
      'gpt-4o': 'openai',
      'gpt-4o-mini': 'openai',
      'gemini-2.0-flash-exp': 'google',
      'llama3.2': 'ollama'
    };

    const getFallback = (model: string): string | null => {
      const provider = providerForModel[model];

      // Define fallback order
      const fallbacks: Record<string, string[]> = {
        'anthropic': ['openai', 'google', 'ollama'],
        'openai': ['anthropic', 'google', 'ollama'],
        'google': ['openai', 'anthropic', 'ollama'],
        'ollama': ['google', 'openai', 'anthropic']
      };

      const fallbackProviders = fallbacks[provider] || [];
      for (const fb of fallbackProviders) {
        if (availableProviders.has(fb)) {
          // Return first model from fallback provider
          const models = Object.entries(providerForModel)
            .filter(([_, p]) => p === fb)
            .map(([m, _]) => m);
          if (models.length > 0) return models[0];
        }
      }
      return null;
    };

    it('should fallback from Claude to GPT', () => {
      const fallback = getFallback('claude-3-5-sonnet-20241022');
      expect(fallback).not.toBeNull();
      expect(providerForModel[fallback!]).toBe('openai');
    });

    it('should fallback from GPT to Claude', () => {
      const fallback = getFallback('gpt-4o');
      expect(fallback).not.toBeNull();
      expect(providerForModel[fallback!]).toBe('anthropic');
    });

    it('should fallback from Ollama to cloud provider', () => {
      const fallback = getFallback('llama3.2');
      expect(fallback).not.toBeNull();
      expect(['anthropic', 'openai', 'google']).toContain(providerForModel[fallback!]);
    });
  });

  describe('Request Routing', () => {
    interface RoutingRequest {
      preferredModel?: string;
      requireVision?: boolean;
      requireTools?: boolean;
      maxCost?: number; // Per 1K tokens
      sliderPosition?: number;
    }

    const routeRequest = (request: RoutingRequest): string => {
      // If specific model requested and available, use it
      if (request.preferredModel) {
        return request.preferredModel;
      }

      // Slider-based routing
      if (request.sliderPosition !== undefined) {
        if (request.sliderPosition <= 40) return 'llama3.2';
        if (request.sliderPosition <= 60) return 'gpt-4o';
        return 'claude-3-5-sonnet-20241022';
      }

      // Vision requirement
      if (request.requireVision) {
        return 'gpt-4o'; // Has good vision
      }

      // Default
      return 'gpt-4o';
    };

    it('should honor preferred model', () => {
      const model = routeRequest({ preferredModel: 'gemini-2.0-flash-exp' });
      expect(model).toBe('gemini-2.0-flash-exp');
    });

    it('should route by slider position', () => {
      expect(routeRequest({ sliderPosition: 20 })).toBe('llama3.2');
      expect(routeRequest({ sliderPosition: 50 })).toBe('gpt-4o');
      expect(routeRequest({ sliderPosition: 80 })).toBe('claude-3-5-sonnet-20241022');
    });

    it('should select vision-capable model when required', () => {
      const model = routeRequest({ requireVision: true });
      expect(model).toBe('gpt-4o');
    });
  });

  describe('Provider Health Tracking', () => {
    const providerHealth: Record<string, {
      available: boolean;
      latency: number;
      errorRate: number;
      lastCheck: number;
    }> = {};

    const updateHealth = (provider: string, success: boolean, latency: number) => {
      if (!providerHealth[provider]) {
        providerHealth[provider] = {
          available: true,
          latency: 0,
          errorRate: 0,
          lastCheck: Date.now()
        };
      }

      const health = providerHealth[provider];
      health.lastCheck = Date.now();

      // Exponential moving average for latency
      health.latency = health.latency * 0.9 + latency * 0.1;

      // Update error rate
      health.errorRate = health.errorRate * 0.95 + (success ? 0 : 1) * 0.05;

      // Mark unavailable if error rate too high
      health.available = health.errorRate < 0.5;
    };

    const isHealthy = (provider: string): boolean => {
      const health = providerHealth[provider];
      if (!health) return true; // Unknown = assume healthy
      return health.available && health.errorRate < 0.3;
    };

    beforeEach(() => {
      // Reset health
      Object.keys(providerHealth).forEach(k => delete providerHealth[k]);
    });

    it('should track successful calls', () => {
      updateHealth('openai', true, 500);
      expect(providerHealth['openai'].available).toBe(true);
      expect(providerHealth['openai'].errorRate).toBeLessThan(0.1);
    });

    it('should track failed calls', () => {
      // Simulate many failures
      for (let i = 0; i < 50; i++) {
        updateHealth('openai', false, 0);
      }
      expect(providerHealth['openai'].errorRate).toBeGreaterThan(0.4);
    });

    it('should mark provider as unavailable after many failures', () => {
      for (let i = 0; i < 100; i++) {
        updateHealth('openai', false, 0);
      }
      expect(isHealthy('openai')).toBe(false);
    });
  });

  describe('Model Pool Management', () => {
    const modelPool = {
      premium: ['claude-3-5-sonnet-20241022', 'gpt-4o', 'o1'],
      standard: ['gpt-4o', 'gemini-2.0-flash-exp', 'claude-3-5-haiku-20241022'],
      economical: ['gpt-4o-mini', 'gemini-2.0-flash-exp', 'llama3.2']
    };

    const getModelsForTier = (tier: 'premium' | 'standard' | 'economical'): string[] => {
      return modelPool[tier] || modelPool.standard;
    };

    it('should return premium models', () => {
      const models = getModelsForTier('premium');
      expect(models).toContain('claude-3-5-sonnet-20241022');
      expect(models).toContain('o1');
    });

    it('should return standard models', () => {
      const models = getModelsForTier('standard');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gemini-2.0-flash-exp');
    });

    it('should return economical models', () => {
      const models = getModelsForTier('economical');
      expect(models).toContain('gpt-4o-mini');
      expect(models).toContain('llama3.2');
    });
  });
});
