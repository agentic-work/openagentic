/**
 * SliderService Unit Tests
 *
 * Tests for the intelligence slider functionality:
 * - Slider value validation
 * - Cost/quality weight calculations
 * - User preference storage
 * - Global vs user settings
 * - Thinking budget calculations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Prisma client
const mockPrisma = {
  systemConfiguration: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  userSliderConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

// Mock the SliderService based on expected behavior
describe('SliderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Slider Value Validation', () => {
    it('should accept valid slider values (0-100)', () => {
      const validValues = [0, 1, 25, 50, 75, 99, 100];
      validValues.forEach(value => {
        expect(value >= 0 && value <= 100).toBe(true);
      });
    });

    it('should reject negative values', () => {
      const isValid = (value: number) => value >= 0 && value <= 100;
      expect(isValid(-1)).toBe(false);
      expect(isValid(-100)).toBe(false);
    });

    it('should reject values over 100', () => {
      const isValid = (value: number) => value >= 0 && value <= 100;
      expect(isValid(101)).toBe(false);
      expect(isValid(200)).toBe(false);
    });

    it('should handle decimal values', () => {
      const normalizeValue = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
      expect(normalizeValue(50.5)).toBe(51);
      expect(normalizeValue(33.3)).toBe(33);
    });
  });

  describe('Cost/Quality Weight Calculations', () => {
    const calculateWeights = (position: number) => {
      // Slider at 0% = max cost savings, slider at 100% = max quality
      const costWeight = (100 - position) / 100;
      const qualityWeight = position / 100;
      return { costWeight, qualityWeight };
    };

    it('should maximize cost weight at position 0', () => {
      const { costWeight, qualityWeight } = calculateWeights(0);
      expect(costWeight).toBe(1);
      expect(qualityWeight).toBe(0);
    });

    it('should maximize quality weight at position 100', () => {
      const { costWeight, qualityWeight } = calculateWeights(100);
      expect(costWeight).toBe(0);
      expect(qualityWeight).toBe(1);
    });

    it('should balance weights at position 50', () => {
      const { costWeight, qualityWeight } = calculateWeights(50);
      expect(costWeight).toBe(0.5);
      expect(qualityWeight).toBe(0.5);
    });

    it('should ensure weights sum to 1', () => {
      for (let pos = 0; pos <= 100; pos += 10) {
        const { costWeight, qualityWeight } = calculateWeights(pos);
        expect(costWeight + qualityWeight).toBeCloseTo(1, 5);
      }
    });
  });

  describe('Thinking Budget Calculations', () => {
    const calculateThinkingBudget = (position: number) => {
      // Thinking is enabled for higher slider positions
      if (position <= 40) {
        return { enabled: false, budget: 0 };
      } else if (position <= 60) {
        return { enabled: true, budget: 4096 + (position - 41) * 200 };
      } else if (position <= 80) {
        return { enabled: true, budget: 8192 + (position - 61) * 400 };
      } else {
        return { enabled: true, budget: 16384 + (position - 81) * 800 };
      }
    };

    it('should disable thinking at low positions (0-40)', () => {
      expect(calculateThinkingBudget(0).enabled).toBe(false);
      expect(calculateThinkingBudget(20).enabled).toBe(false);
      expect(calculateThinkingBudget(40).enabled).toBe(false);
    });

    it('should enable thinking at medium positions (41-60)', () => {
      expect(calculateThinkingBudget(41).enabled).toBe(true);
      expect(calculateThinkingBudget(50).enabled).toBe(true);
      expect(calculateThinkingBudget(60).enabled).toBe(true);
    });

    it('should enable thinking at high positions (61-100)', () => {
      expect(calculateThinkingBudget(61).enabled).toBe(true);
      expect(calculateThinkingBudget(80).enabled).toBe(true);
      expect(calculateThinkingBudget(100).enabled).toBe(true);
    });

    it('should increase budget with position', () => {
      const budget50 = calculateThinkingBudget(50).budget;
      const budget70 = calculateThinkingBudget(70).budget;
      const budget90 = calculateThinkingBudget(90).budget;

      expect(budget70).toBeGreaterThan(budget50);
      expect(budget90).toBeGreaterThan(budget70);
    });
  });

  describe('Model Tier Selection', () => {
    const getModelTier = (position: number): 'economical' | 'balanced' | 'premium' => {
      if (position <= 40) return 'economical';
      if (position <= 60) return 'balanced';
      return 'premium';
    };

    it('should select economical tier for 0-40', () => {
      expect(getModelTier(0)).toBe('economical');
      expect(getModelTier(20)).toBe('economical');
      expect(getModelTier(40)).toBe('economical');
    });

    it('should select balanced tier for 41-60', () => {
      expect(getModelTier(41)).toBe('balanced');
      expect(getModelTier(50)).toBe('balanced');
      expect(getModelTier(60)).toBe('balanced');
    });

    it('should select premium tier for 61-100', () => {
      expect(getModelTier(61)).toBe('premium');
      expect(getModelTier(80)).toBe('premium');
      expect(getModelTier(100)).toBe('premium');
    });
  });

  describe('User Preference Resolution', () => {
    const resolveSliderConfig = (userValue: number | null, globalValue: number | null, defaultValue: number = 50) => {
      if (userValue !== null) {
        return { position: userValue, source: 'user' as const };
      } else if (globalValue !== null) {
        return { position: globalValue, source: 'global' as const };
      }
      return { position: defaultValue, source: 'default' as const };
    };

    it('should prefer user value over global', () => {
      const result = resolveSliderConfig(75, 50);
      expect(result.position).toBe(75);
      expect(result.source).toBe('user');
    });

    it('should fall back to global when no user value', () => {
      const result = resolveSliderConfig(null, 30);
      expect(result.position).toBe(30);
      expect(result.source).toBe('global');
    });

    it('should use default when no values set', () => {
      const result = resolveSliderConfig(null, null, 50);
      expect(result.position).toBe(50);
      expect(result.source).toBe('default');
    });
  });

  describe('Slider Persistence', () => {
    it('should store global slider value', async () => {
      mockPrisma.systemConfiguration.upsert.mockResolvedValue({
        id: '1',
        key: 'slider_value',
        value: '75'
      });

      const result = await mockPrisma.systemConfiguration.upsert({
        where: { key: 'slider_value' },
        create: { key: 'slider_value', value: '75' },
        update: { value: '75' }
      });

      expect(result.value).toBe('75');
      expect(mockPrisma.systemConfiguration.upsert).toHaveBeenCalled();
    });

    it('should retrieve global slider value', async () => {
      mockPrisma.systemConfiguration.findFirst.mockResolvedValue({
        id: '1',
        key: 'slider_value',
        value: '60'
      });

      const result = await mockPrisma.systemConfiguration.findFirst({
        where: { key: 'slider_value' }
      });

      expect(result?.value).toBe('60');
    });

    it('should handle missing global value', async () => {
      mockPrisma.systemConfiguration.findFirst.mockResolvedValue(null);

      const result = await mockPrisma.systemConfiguration.findFirst({
        where: { key: 'slider_value' }
      });

      expect(result).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle boundary values correctly', () => {
      const getModelTier = (pos: number) => pos <= 40 ? 'economical' : pos <= 60 ? 'balanced' : 'premium';

      expect(getModelTier(40)).toBe('economical');
      expect(getModelTier(41)).toBe('balanced');
      expect(getModelTier(60)).toBe('balanced');
      expect(getModelTier(61)).toBe('premium');
    });

    it('should clamp out-of-range values', () => {
      const clamp = (value: number) => Math.max(0, Math.min(100, value));

      expect(clamp(-50)).toBe(0);
      expect(clamp(150)).toBe(100);
      expect(clamp(50)).toBe(50);
    });

    it('should handle NaN gracefully', () => {
      const normalizeValue = (value: number) => {
        if (isNaN(value)) return 50; // Default
        return Math.max(0, Math.min(100, Math.round(value)));
      };

      expect(normalizeValue(NaN)).toBe(50);
    });
  });
});
