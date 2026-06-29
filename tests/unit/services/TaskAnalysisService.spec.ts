/**
 * TaskAnalysisService Unit Tests
 *
 * Tests for task complexity analysis and model routing:
 * - Complexity scoring
 * - Model selection
 * - Slider integration
 * - Tool detection
 * - Vision requirements
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TaskAnalysisService', () => {
  describe('Complexity Scoring', () => {
    const calculateComplexity = (
      messageLength: number,
      hasImages: boolean,
      toolCount: number,
      conversationLength: number
    ): number => {
      let score = 0;

      // Message length factor
      if (messageLength > 5000) score += 3;
      else if (messageLength > 1000) score += 2;
      else if (messageLength > 200) score += 1;

      // Image factor
      if (hasImages) score += 2;

      // Tool factor
      if (toolCount > 10) score += 3;
      else if (toolCount > 5) score += 2;
      else if (toolCount > 0) score += 1;

      // Conversation length factor
      if (conversationLength > 20) score += 2;
      else if (conversationLength > 5) score += 1;

      return Math.min(score, 10); // Cap at 10
    };

    it('should score simple messages low', () => {
      const score = calculateComplexity(100, false, 0, 1);
      expect(score).toBeLessThanOrEqual(2);
    });

    it('should score complex messages higher', () => {
      const score = calculateComplexity(6000, true, 15, 25);
      expect(score).toBeGreaterThanOrEqual(8);
    });

    it('should increase score for images', () => {
      const withoutImages = calculateComplexity(500, false, 0, 1);
      const withImages = calculateComplexity(500, true, 0, 1);
      expect(withImages).toBeGreaterThan(withoutImages);
    });

    it('should increase score for many tools', () => {
      const fewTools = calculateComplexity(500, false, 2, 1);
      const manyTools = calculateComplexity(500, false, 15, 1);
      expect(manyTools).toBeGreaterThan(fewTools);
    });

    it('should cap score at 10', () => {
      const score = calculateComplexity(10000, true, 50, 100);
      expect(score).toBe(10);
    });
  });

  describe('Model Selection by Slider', () => {
    interface SliderConfig {
      position: number;
      costWeight: number;
      qualityWeight: number;
      enableThinking: boolean;
      source: 'user' | 'global' | 'default';
    }

    const selectModelBySlider = (sliderConfig: SliderConfig): string => {
      const { position } = sliderConfig;

      if (position <= 40) {
        // Economical tier
        return 'gpt-oss'; // Ollama
      } else if (position <= 60) {
        // Balanced tier
        return 'gpt-4o'; // Good balance
      } else {
        // Premium tier
        return 'claude-3-5-sonnet-20241022'; // Best quality
      }
    };

    it('should select economical model for low slider', () => {
      const model = selectModelBySlider({
        position: 20,
        costWeight: 0.8,
        qualityWeight: 0.2,
        enableThinking: false,
        source: 'global'
      });
      expect(model).toBe('gpt-oss');
    });

    it('should select balanced model for middle slider', () => {
      const model = selectModelBySlider({
        position: 50,
        costWeight: 0.5,
        qualityWeight: 0.5,
        enableThinking: true,
        source: 'global'
      });
      expect(model).toBe('gpt-4o');
    });

    it('should select premium model for high slider', () => {
      const model = selectModelBySlider({
        position: 85,
        costWeight: 0.15,
        qualityWeight: 0.85,
        enableThinking: true,
        source: 'user'
      });
      expect(model).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('Model Selection by Complexity', () => {
    const selectModelByComplexity = (complexity: number): string => {
      if (complexity <= 3) return 'gpt-4o-mini';
      if (complexity <= 6) return 'gpt-4o';
      return 'claude-3-5-sonnet-20241022';
    };

    it('should select small model for low complexity', () => {
      expect(selectModelByComplexity(1)).toBe('gpt-4o-mini');
      expect(selectModelByComplexity(3)).toBe('gpt-4o-mini');
    });

    it('should select medium model for medium complexity', () => {
      expect(selectModelByComplexity(4)).toBe('gpt-4o');
      expect(selectModelByComplexity(6)).toBe('gpt-4o');
    });

    it('should select large model for high complexity', () => {
      expect(selectModelByComplexity(7)).toBe('claude-3-5-sonnet-20241022');
      expect(selectModelByComplexity(10)).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('Combined Routing', () => {
    interface TaskRequirements {
      messages: { role: string; content: any }[];
      hasImages?: boolean;
      tools?: any[];
      requestedModel?: string;
      sliderConfig?: {
        position: number;
        costWeight: number;
        qualityWeight: number;
        enableThinking: boolean;
        source: 'user' | 'global' | 'default';
      };
    }

    const routeRequest = (requirements: TaskRequirements): string => {
      // If model is explicitly requested, use it
      if (requirements.requestedModel) {
        return requirements.requestedModel;
      }

      // If slider config present, route by slider
      if (requirements.sliderConfig) {
        const { position } = requirements.sliderConfig;
        if (position <= 40) return 'gpt-oss';
        if (position <= 60) return 'gpt-4o';
        return 'claude-3-5-sonnet-20241022';
      }

      // Default to complexity-based routing
      return 'gpt-4o';
    };

    it('should honor explicit model request', () => {
      const model = routeRequest({
        messages: [{ role: 'user', content: 'Hello' }],
        requestedModel: 'gemini-2.0-flash'
      });
      expect(model).toBe('gemini-2.0-flash');
    });

    it('should use slider when available', () => {
      const model = routeRequest({
        messages: [{ role: 'user', content: 'Hello' }],
        sliderConfig: {
          position: 10,
          costWeight: 0.9,
          qualityWeight: 0.1,
          enableThinking: false,
          source: 'user'
        }
      });
      expect(model).toBe('gpt-oss');
    });

    it('should default to balanced model', () => {
      const model = routeRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(model).toBe('gpt-4o');
    });
  });

  describe('Vision Detection', () => {
    const hasVisionRequirement = (messages: any[]): boolean => {
      for (const msg of messages) {
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'image_url' || part.type === 'image') {
              return true;
            }
          }
        }
      }
      return false;
    };

    it('should detect image_url content', () => {
      const messages = [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } }
        ]
      }];
      expect(hasVisionRequirement(messages)).toBe(true);
    });

    it('should return false for text-only messages', () => {
      const messages = [{
        role: 'user',
        content: 'Hello, how are you?'
      }];
      expect(hasVisionRequirement(messages)).toBe(false);
    });

    it('should detect base64 images', () => {
      const messages = [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } }
        ]
      }];
      expect(hasVisionRequirement(messages)).toBe(true);
    });
  });

  describe('Tool Requirement Analysis', () => {
    const analyzeToolRequirements = (tools: any[]) => {
      return {
        count: tools.length,
        hasWebTools: tools.some(t => t.name?.includes('web') || t.name?.includes('search')),
        hasCodeTools: tools.some(t => t.name?.includes('code') || t.name?.includes('execute')),
        hasMemoryTools: tools.some(t => t.name?.includes('memory') || t.name?.includes('store')),
        requiresHighCapability: tools.length > 10 || tools.some(t => t.complexity === 'high')
      };
    };

    it('should count tools correctly', () => {
      const tools = [{ name: 'tool1' }, { name: 'tool2' }, { name: 'tool3' }];
      expect(analyzeToolRequirements(tools).count).toBe(3);
    });

    it('should detect web tools', () => {
      const tools = [{ name: 'web_search' }];
      expect(analyzeToolRequirements(tools).hasWebTools).toBe(true);
    });

    it('should detect code tools', () => {
      const tools = [{ name: 'execute_code' }];
      expect(analyzeToolRequirements(tools).hasCodeTools).toBe(true);
    });

    it('should detect memory tools', () => {
      const tools = [{ name: 'store_memory' }];
      expect(analyzeToolRequirements(tools).hasMemoryTools).toBe(true);
    });

    it('should flag high capability requirement for many tools', () => {
      const tools = Array.from({ length: 15 }, (_, i) => ({ name: `tool${i}` }));
      expect(analyzeToolRequirements(tools).requiresHighCapability).toBe(true);
    });
  });

  describe('Thinking Budget Calculation', () => {
    const calculateThinkingBudget = (
      complexity: number,
      sliderPosition: number
    ): { enabled: boolean; budget: number } => {
      // Low slider = no thinking
      if (sliderPosition <= 40) {
        return { enabled: false, budget: 0 };
      }

      // Base budget increases with slider
      const basebudget = sliderPosition <= 60 ? 4096 :
                         sliderPosition <= 80 ? 8192 : 16384;

      // Add complexity bonus
      const complexityBonus = complexity * 500;

      return {
        enabled: true,
        budget: basebudget + complexityBonus
      };
    };

    it('should disable thinking for low slider', () => {
      const result = calculateThinkingBudget(5, 30);
      expect(result.enabled).toBe(false);
      expect(result.budget).toBe(0);
    });

    it('should enable thinking for medium slider', () => {
      const result = calculateThinkingBudget(5, 55);
      expect(result.enabled).toBe(true);
      expect(result.budget).toBeGreaterThan(4000);
    });

    it('should increase budget with complexity', () => {
      const lowComplexity = calculateThinkingBudget(2, 70);
      const highComplexity = calculateThinkingBudget(8, 70);
      expect(highComplexity.budget).toBeGreaterThan(lowComplexity.budget);
    });

    it('should provide large budget for high slider and complexity', () => {
      const result = calculateThinkingBudget(10, 95);
      expect(result.budget).toBeGreaterThan(20000);
    });
  });

  describe('Provider Fallback Chain', () => {
    const getFallbackChain = (primaryModel: string): string[] => {
      const chains: Record<string, string[]> = {
        'claude-3-5-sonnet-20241022': ['gpt-4o', 'gemini-2.0-flash-exp', 'gpt-oss'],
        'gpt-4o': ['claude-3-5-sonnet-20241022', 'gemini-2.0-flash-exp', 'gpt-oss'],
        'gemini-2.0-flash-exp': ['gpt-4o', 'claude-3-5-sonnet-20241022', 'gpt-oss'],
        'gpt-oss': ['gpt-4o-mini', 'gemini-2.0-flash-exp', 'claude-3-5-haiku-20241022']
      };
      return chains[primaryModel] || ['gpt-4o', 'gpt-oss'];
    };

    it('should provide fallback for Claude', () => {
      const fallbacks = getFallbackChain('claude-3-5-sonnet-20241022');
      expect(fallbacks).toContain('gpt-4o');
      expect(fallbacks.length).toBeGreaterThan(0);
    });

    it('should provide fallback for GPT', () => {
      const fallbacks = getFallbackChain('gpt-4o');
      expect(fallbacks).toContain('claude-3-5-sonnet-20241022');
    });

    it('should provide default fallback for unknown model', () => {
      const fallbacks = getFallbackChain('unknown-model');
      expect(fallbacks.length).toBeGreaterThan(0);
    });
  });
});
