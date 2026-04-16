/**
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 *
 * Unit tests for theme utility functions
 */

import { describe, it, expect } from 'vitest';
import { alpha, cssVar, theme, supportsColorMix } from '../theme';

describe('Theme Utilities', () => {
  describe('alpha()', () => {
    it('should generate color-mix for CSS variable with percentage opacity', () => {
      const result = alpha('--color-primary', 0.3);
      expect(result).toBe('color-mix(in srgb, var(--color-primary) 30%, transparent)');
    });

    it('should handle opacity of 0', () => {
      const result = alpha('--color-primary', 0);
      expect(result).toBe('color-mix(in srgb, var(--color-primary) 0%, transparent)');
    });

    it('should handle opacity of 1', () => {
      const result = alpha('--color-primary', 1);
      expect(result).toBe('color-mix(in srgb, var(--color-primary) 100%, transparent)');
    });

    it('should clamp opacity values below 0 to 0', () => {
      const result = alpha('--color-primary', -0.5);
      expect(result).toBe('color-mix(in srgb, var(--color-primary) 0%, transparent)');
    });

    it('should clamp opacity values above 1 to 100%', () => {
      const result = alpha('--color-primary', 1.5);
      expect(result).toBe('color-mix(in srgb, var(--color-primary) 100%, transparent)');
    });

    it('should handle CSS variable without -- prefix', () => {
      const result = alpha('color-primary', 0.5);
      expect(result).toBe('color-mix(in srgb, var(--color-primary) 50%, transparent)');
    });

    it('should round opacity to whole percentage', () => {
      const result = alpha('--color-primary', 0.333);
      expect(result).toBe('color-mix(in srgb, var(--color-primary) 33%, transparent)');
    });

    it('should handle decimal percentages correctly', () => {
      const result = alpha('--color-success', 0.15);
      expect(result).toBe('color-mix(in srgb, var(--color-success) 15%, transparent)');
    });

    it('should work with various CSS variable names', () => {
      expect(alpha('--color-text', 0.5)).toBe('color-mix(in srgb, var(--color-text) 50%, transparent)');
      expect(alpha('--color-border', 0.2)).toBe('color-mix(in srgb, var(--color-border) 20%, transparent)');
      expect(alpha('--color-bg-secondary', 0.8)).toBe('color-mix(in srgb, var(--color-bg-secondary) 80%, transparent)');
    });
  });

  describe('cssVar', () => {
    it('should provide correct var() references for primary colors', () => {
      expect(cssVar.primary).toBe('var(--color-primary)');
      expect(cssVar.primaryLight).toBe('var(--color-primaryLight)');
      expect(cssVar.primaryDark).toBe('var(--color-primaryDark)');
      expect(cssVar.secondary).toBe('var(--color-secondary)');
      expect(cssVar.accent).toBe('var(--color-accent)');
    });

    it('should provide correct var() references for text colors', () => {
      expect(cssVar.text).toBe('var(--color-text)');
      expect(cssVar.textMuted).toBe('var(--color-textMuted)');
      expect(cssVar.textSecondary).toBe('var(--color-textSecondary)');
      expect(cssVar.textInverse).toBe('var(--color-textInverse)');
    });

    it('should provide correct var() references for semantic colors', () => {
      expect(cssVar.success).toBe('var(--color-success)');
      expect(cssVar.warning).toBe('var(--color-warning)');
      expect(cssVar.error).toBe('var(--color-error)');
      expect(cssVar.info).toBe('var(--color-info)');
    });

    it('should provide correct var() references for surface colors', () => {
      expect(cssVar.surface).toBe('var(--color-surface)');
      expect(cssVar.surfaceSecondary).toBe('var(--color-surfaceSecondary)');
      expect(cssVar.surfaceTertiary).toBe('var(--color-surfaceTertiary)');
      expect(cssVar.background).toBe('var(--color-background)');
    });

    it('should provide correct var() references for border colors', () => {
      expect(cssVar.border).toBe('var(--color-border)');
      expect(cssVar.borderLight).toBe('var(--color-borderLight)');
    });

    it('should provide correct var() references for gradients', () => {
      expect(cssVar.gradientPrimary).toBe('var(--color-gradientPrimary)');
      expect(cssVar.gradientSecondary).toBe('var(--color-gradientSecondary)');
    });
  });

  describe('theme background helpers', () => {
    it('should generate default 10% opacity primary background', () => {
      expect(theme.bgPrimary()).toBe('color-mix(in srgb, var(--color-primary) 10%, transparent)');
    });

    it('should accept custom opacity for bgPrimary', () => {
      expect(theme.bgPrimary(0.25)).toBe('color-mix(in srgb, var(--color-primary) 25%, transparent)');
    });

    it('should generate default 10% opacity success background', () => {
      expect(theme.bgSuccess()).toBe('color-mix(in srgb, var(--color-success) 10%, transparent)');
    });

    it('should generate default 10% opacity error background', () => {
      expect(theme.bgError()).toBe('color-mix(in srgb, var(--color-error) 10%, transparent)');
    });

    it('should generate default 10% opacity warning background', () => {
      expect(theme.bgWarning()).toBe('color-mix(in srgb, var(--color-warning) 10%, transparent)');
    });

    it('should generate default 10% opacity info background', () => {
      expect(theme.bgInfo()).toBe('color-mix(in srgb, var(--color-info) 10%, transparent)');
    });

    it('should generate full opacity surface background', () => {
      expect(theme.bgSurface()).toBe('color-mix(in srgb, var(--color-surface) 100%, transparent)');
    });
  });

  describe('theme border helpers', () => {
    it('should generate default 20% opacity primary border', () => {
      expect(theme.borderPrimary()).toBe('color-mix(in srgb, var(--color-primary) 20%, transparent)');
    });

    it('should accept custom opacity for borderPrimary', () => {
      expect(theme.borderPrimary(0.5)).toBe('color-mix(in srgb, var(--color-primary) 50%, transparent)');
    });

    it('should generate full opacity default border', () => {
      expect(theme.borderDefault()).toBe('color-mix(in srgb, var(--color-border) 100%, transparent)');
    });

    it('should generate default 20% opacity success border', () => {
      expect(theme.borderSuccess()).toBe('color-mix(in srgb, var(--color-success) 20%, transparent)');
    });
  });

  describe('theme text helpers', () => {
    it('should generate full opacity primary text', () => {
      expect(theme.textPrimary()).toBe('color-mix(in srgb, var(--color-text) 100%, transparent)');
    });

    it('should generate full opacity secondary text', () => {
      expect(theme.textSecondary()).toBe('color-mix(in srgb, var(--color-textSecondary) 100%, transparent)');
    });

    it('should generate full opacity muted text', () => {
      expect(theme.textMuted()).toBe('color-mix(in srgb, var(--color-textMuted) 100%, transparent)');
    });

    it('should accept custom opacity for text helpers', () => {
      expect(theme.textPrimary(0.7)).toBe('color-mix(in srgb, var(--color-text) 70%, transparent)');
      expect(theme.textMuted(0.5)).toBe('color-mix(in srgb, var(--color-textMuted) 50%, transparent)');
    });
  });

  describe('theme gradient helpers', () => {
    it('should provide direct gradient CSS variable references', () => {
      expect(theme.gradient.primary).toBe('var(--color-gradientPrimary)');
      expect(theme.gradient.secondary).toBe('var(--color-gradientSecondary)');
    });

    it('should generate subtle gradient between two colors', () => {
      const result = theme.gradient.subtle('--color-primary', '--color-secondary', 0.1);
      expect(result).toContain('linear-gradient(135deg');
      expect(result).toContain('var(--color-primary) 10%');
      expect(result).toContain('var(--color-secondary) 5%');
    });

    it('should generate radial gradient', () => {
      const result = theme.gradient.radial('--color-primary', 0.15);
      expect(result).toContain('radial-gradient');
      expect(result).toContain('var(--color-primary) 15%');
    });

    it('should generate directional gradient', () => {
      const result = theme.gradient.directional('to right', '--color-primary', '--color-secondary', 0.2, 0.1);
      expect(result).toContain('linear-gradient(to right');
      expect(result).toContain('var(--color-primary) 20%');
      expect(result).toContain('var(--color-secondary) 10%');
    });
  });

  describe('theme shadow helpers', () => {
    it('should generate glow shadow with default values', () => {
      const result = theme.shadow.glow();
      expect(result).toContain('0 0 20px');
      expect(result).toContain('var(--color-primary) 15%');
    });

    it('should generate glow shadow with custom values', () => {
      const result = theme.shadow.glow(0.3, 30);
      expect(result).toContain('0 0 30px');
      expect(result).toContain('var(--color-primary) 30%');
    });

    it('should generate elevated shadow', () => {
      const result = theme.shadow.elevated();
      expect(result).toContain('0 4px 12px');
      expect(result).toContain('var(--color-primary) 10%');
      expect(result).toContain('rgba(0, 0, 0, 0.05)');
    });
  });

  describe('supportsColorMix()', () => {
    it('should return a boolean', () => {
      const result = supportsColorMix();
      expect(typeof result).toBe('boolean');
    });

    it('should not throw when called', () => {
      expect(() => supportsColorMix()).not.toThrow();
    });
  });
});

describe('Integration Patterns', () => {
  it('should work in inline style objects with alpha()', () => {
    const style = {
      background: alpha('--color-primary', 0.1),
      border: `1px solid ${alpha('--color-border', 0.3)}`,
    };

    expect(style.background).toBe('color-mix(in srgb, var(--color-primary) 10%, transparent)');
    expect(style.border).toBe('1px solid color-mix(in srgb, var(--color-border) 30%, transparent)');
  });

  it('should work with theme helpers in style objects', () => {
    const style = {
      background: theme.bgPrimary(0.15),
      borderColor: theme.borderPrimary(0.4),
      color: cssVar.text,
    };

    expect(style.background).toBe('color-mix(in srgb, var(--color-primary) 15%, transparent)');
    expect(style.borderColor).toBe('color-mix(in srgb, var(--color-primary) 40%, transparent)');
    expect(style.color).toBe('var(--color-text)');
  });

  it('should support combining multiple theme utilities', () => {
    const style = {
      background: theme.gradient.subtle('--color-primary', '--color-secondary'),
      boxShadow: theme.shadow.glow(0.2, 15),
      border: `1px solid ${theme.borderPrimary(0.3)}`,
    };

    expect(style.background).toContain('linear-gradient');
    expect(style.boxShadow).toContain('0 0 15px');
    expect(style.border).toContain('1px solid');
  });
});
