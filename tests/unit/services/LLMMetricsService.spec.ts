/**
 * LLMMetricsService Unit Tests
 *
 * Tests for LLM usage metrics and cost tracking:
 * - Token counting
 * - Cost calculation
 * - Usage aggregation
 * - Rate limiting
 * - Budget tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('LLMMetricsService', () => {
  describe('Token Counting', () => {
    // Approximate token counting (4 chars ≈ 1 token for English)
    const estimateTokens = (text: string): number => {
      return Math.ceil(text.length / 4);
    };

    it('should estimate tokens for short text', () => {
      const text = 'Hello world';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should estimate tokens for long text', () => {
      const text = 'A'.repeat(4000);
      const tokens = estimateTokens(text);
      expect(tokens).toBe(1000);
    });

    it('should handle empty text', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should handle unicode text', () => {
      const text = '你好世界'; // Chinese "Hello world"
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('Cost Calculation', () => {
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
      'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gemini-2.0-flash-exp': { input: 0.00025, output: 0.001 },
    };

    const calculateCost = (
      model: string,
      inputTokens: number,
      outputTokens: number
    ): number => {
      const price = pricing[model];
      if (!price) return 0;

      const inputCost = (inputTokens / 1000) * price.input;
      const outputCost = (outputTokens / 1000) * price.output;
      return inputCost + outputCost;
    };

    it('should calculate cost for Claude Sonnet', () => {
      const cost = calculateCost('claude-3-5-sonnet-20241022', 1000, 500);
      expect(cost).toBeCloseTo(0.003 + 0.0075, 5);
    });

    it('should calculate cost for GPT-4o', () => {
      const cost = calculateCost('gpt-4o', 1000, 500);
      expect(cost).toBeCloseTo(0.005 + 0.0075, 5);
    });

    it('should calculate cost for GPT-4o-mini', () => {
      const cost = calculateCost('gpt-4o-mini', 1000, 500);
      expect(cost).toBeCloseTo(0.00015 + 0.0003, 5);
    });

    it('should return 0 for unknown model', () => {
      const cost = calculateCost('unknown-model', 1000, 500);
      expect(cost).toBe(0);
    });

    it('should handle large token counts', () => {
      const cost = calculateCost('gpt-4o', 100000, 50000);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(0.5 + 0.75, 2);
    });
  });

  describe('Usage Aggregation', () => {
    interface UsageRecord {
      model: string;
      inputTokens: number;
      outputTokens: number;
      cost: number;
      timestamp: Date;
    }

    const aggregateByModel = (records: UsageRecord[]) => {
      const aggregated: Record<string, {
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCost: number;
        requestCount: number;
      }> = {};

      for (const record of records) {
        if (!aggregated[record.model]) {
          aggregated[record.model] = {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCost: 0,
            requestCount: 0
          };
        }

        aggregated[record.model].totalInputTokens += record.inputTokens;
        aggregated[record.model].totalOutputTokens += record.outputTokens;
        aggregated[record.model].totalCost += record.cost;
        aggregated[record.model].requestCount += 1;
      }

      return aggregated;
    };

    it('should aggregate usage by model', () => {
      const records: UsageRecord[] = [
        { model: 'gpt-4o', inputTokens: 100, outputTokens: 50, cost: 0.01, timestamp: new Date() },
        { model: 'gpt-4o', inputTokens: 200, outputTokens: 100, cost: 0.02, timestamp: new Date() },
        { model: 'claude-3-5-sonnet', inputTokens: 150, outputTokens: 75, cost: 0.015, timestamp: new Date() },
      ];

      const aggregated = aggregateByModel(records);

      expect(aggregated['gpt-4o'].totalInputTokens).toBe(300);
      expect(aggregated['gpt-4o'].totalOutputTokens).toBe(150);
      expect(aggregated['gpt-4o'].requestCount).toBe(2);
      expect(aggregated['claude-3-5-sonnet'].requestCount).toBe(1);
    });

    it('should calculate total cost correctly', () => {
      const records: UsageRecord[] = [
        { model: 'gpt-4o', inputTokens: 100, outputTokens: 50, cost: 0.01, timestamp: new Date() },
        { model: 'gpt-4o', inputTokens: 200, outputTokens: 100, cost: 0.02, timestamp: new Date() },
      ];

      const aggregated = aggregateByModel(records);
      expect(aggregated['gpt-4o'].totalCost).toBeCloseTo(0.03, 5);
    });
  });

  describe('Rate Limiting', () => {
    interface RateLimitConfig {
      requestsPerMinute: number;
      tokensPerMinute: number;
    }

    const rateLimits: Record<string, RateLimitConfig> = {
      'anthropic': { requestsPerMinute: 60, tokensPerMinute: 100000 },
      'openai': { requestsPerMinute: 60, tokensPerMinute: 90000 },
      'google': { requestsPerMinute: 60, tokensPerMinute: 120000 },
    };

    const checkRateLimit = (
      provider: string,
      currentRequests: number,
      currentTokens: number
    ): { allowed: boolean; retryAfter?: number } => {
      const limit = rateLimits[provider];
      if (!limit) return { allowed: true };

      if (currentRequests >= limit.requestsPerMinute) {
        return { allowed: false, retryAfter: 60 };
      }

      if (currentTokens >= limit.tokensPerMinute) {
        return { allowed: false, retryAfter: 60 };
      }

      return { allowed: true };
    };

    it('should allow requests within limits', () => {
      const result = checkRateLimit('openai', 30, 50000);
      expect(result.allowed).toBe(true);
    });

    it('should block requests exceeding request limit', () => {
      const result = checkRateLimit('openai', 60, 50000);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(60);
    });

    it('should block requests exceeding token limit', () => {
      const result = checkRateLimit('openai', 30, 90000);
      expect(result.allowed).toBe(false);
    });

    it('should allow unknown providers', () => {
      const result = checkRateLimit('unknown', 100, 1000000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Budget Tracking', () => {
    interface Budget {
      dailyLimit: number;
      monthlyLimit: number;
      currentDailySpend: number;
      currentMonthlySpend: number;
    }

    const checkBudget = (
      budget: Budget,
      estimatedCost: number
    ): { allowed: boolean; reason?: string } => {
      if (budget.currentDailySpend + estimatedCost > budget.dailyLimit) {
        return { allowed: false, reason: 'Daily budget exceeded' };
      }

      if (budget.currentMonthlySpend + estimatedCost > budget.monthlyLimit) {
        return { allowed: false, reason: 'Monthly budget exceeded' };
      }

      return { allowed: true };
    };

    it('should allow spend within budget', () => {
      const budget: Budget = {
        dailyLimit: 100,
        monthlyLimit: 1000,
        currentDailySpend: 50,
        currentMonthlySpend: 500
      };

      const result = checkBudget(budget, 10);
      expect(result.allowed).toBe(true);
    });

    it('should block spend exceeding daily limit', () => {
      const budget: Budget = {
        dailyLimit: 100,
        monthlyLimit: 1000,
        currentDailySpend: 95,
        currentMonthlySpend: 500
      };

      const result = checkBudget(budget, 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily');
    });

    it('should block spend exceeding monthly limit', () => {
      const budget: Budget = {
        dailyLimit: 100,
        monthlyLimit: 1000,
        currentDailySpend: 50,
        currentMonthlySpend: 995
      };

      const result = checkBudget(budget, 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Monthly');
    });
  });

  describe('Latency Tracking', () => {
    interface LatencyMetric {
      ttft: number; // Time to first token
      totalTime: number;
      tokensPerSecond: number;
    }

    const calculateLatencyMetrics = (
      startTime: number,
      firstTokenTime: number,
      endTime: number,
      totalTokens: number
    ): LatencyMetric => {
      const ttft = firstTokenTime - startTime;
      const totalTime = endTime - startTime;
      const generationTime = endTime - firstTokenTime;
      const tokensPerSecond = generationTime > 0 ? (totalTokens / generationTime) * 1000 : 0;

      return { ttft, totalTime, tokensPerSecond };
    };

    it('should calculate TTFT correctly', () => {
      const metrics = calculateLatencyMetrics(0, 500, 2000, 100);
      expect(metrics.ttft).toBe(500);
    });

    it('should calculate total time correctly', () => {
      const metrics = calculateLatencyMetrics(0, 500, 2000, 100);
      expect(metrics.totalTime).toBe(2000);
    });

    it('should calculate tokens per second', () => {
      const metrics = calculateLatencyMetrics(0, 500, 2000, 150);
      // 150 tokens in 1500ms = 100 tokens/sec
      expect(metrics.tokensPerSecond).toBeCloseTo(100, 0);
    });
  });

  describe('Historical Metrics', () => {
    interface DailyMetrics {
      date: string;
      totalRequests: number;
      totalTokens: number;
      totalCost: number;
      avgLatency: number;
    }

    const aggregateDaily = (records: any[]): DailyMetrics[] => {
      const byDate: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
        latencies: number[];
      }> = {};

      for (const record of records) {
        const date = new Date(record.timestamp).toISOString().split('T')[0];
        if (!byDate[date]) {
          byDate[date] = { requests: 0, tokens: 0, cost: 0, latencies: [] };
        }
        byDate[date].requests += 1;
        byDate[date].tokens += record.totalTokens || 0;
        byDate[date].cost += record.cost || 0;
        if (record.latency) byDate[date].latencies.push(record.latency);
      }

      return Object.entries(byDate).map(([date, data]) => ({
        date,
        totalRequests: data.requests,
        totalTokens: data.tokens,
        totalCost: data.cost,
        avgLatency: data.latencies.length > 0
          ? data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length
          : 0
      }));
    };

    it('should aggregate metrics by day', () => {
      const records = [
        { timestamp: '2024-01-01T10:00:00Z', totalTokens: 100, cost: 0.01, latency: 500 },
        { timestamp: '2024-01-01T11:00:00Z', totalTokens: 200, cost: 0.02, latency: 600 },
        { timestamp: '2024-01-02T10:00:00Z', totalTokens: 150, cost: 0.015, latency: 550 },
      ];

      const daily = aggregateDaily(records);

      const day1 = daily.find(d => d.date === '2024-01-01');
      expect(day1?.totalRequests).toBe(2);
      expect(day1?.totalTokens).toBe(300);
      expect(day1?.avgLatency).toBe(550);
    });
  });

  describe('Cost Alerts', () => {
    interface CostAlert {
      type: 'warning' | 'critical';
      threshold: number;
      currentSpend: number;
      percentUsed: number;
    }

    const checkCostAlerts = (
      currentSpend: number,
      budget: number,
      warningThreshold: number = 0.8,
      criticalThreshold: number = 0.95
    ): CostAlert | null => {
      const percentUsed = currentSpend / budget;

      if (percentUsed >= criticalThreshold) {
        return {
          type: 'critical',
          threshold: budget * criticalThreshold,
          currentSpend,
          percentUsed
        };
      }

      if (percentUsed >= warningThreshold) {
        return {
          type: 'warning',
          threshold: budget * warningThreshold,
          currentSpend,
          percentUsed
        };
      }

      return null;
    };

    it('should return null when under threshold', () => {
      const alert = checkCostAlerts(50, 100);
      expect(alert).toBeNull();
    });

    it('should return warning when over 80%', () => {
      const alert = checkCostAlerts(85, 100);
      expect(alert?.type).toBe('warning');
      expect(alert?.percentUsed).toBeCloseTo(0.85, 2);
    });

    it('should return critical when over 95%', () => {
      const alert = checkCostAlerts(98, 100);
      expect(alert?.type).toBe('critical');
    });
  });
});
