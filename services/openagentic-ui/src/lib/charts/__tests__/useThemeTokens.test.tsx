import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useThemeTokens, resolveThemeTokens, FALLBACK_TOKENS } from '../hooks/useThemeTokens';

function setVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

describe('useThemeTokens / resolveThemeTokens', () => {
  beforeEach(() => {
    // Reset all the vars we'll touch
    for (const v of [
      '--accent', '--ok', '--warn', '--err', '--info',
      '--fg-0', '--fg-1', '--fg-2', '--fg-3',
      '--bg-0', '--bg-1', '--bg-2', '--line-1', '--line-2',
      '--cap-thinking', '--cap-streaming', '--cap-tools',
      '--font-ui', '--font-mono',
    ]) {
      document.documentElement.style.removeProperty(v);
    }
  });

  it('returns FALLBACK_TOKENS when no CSS vars are set', () => {
    const tokens = resolveThemeTokens();
    expect(tokens.accent).toBe(FALLBACK_TOKENS.accent);
    expect(tokens.ok).toBe(FALLBACK_TOKENS.ok);
    expect(tokens.fontMono).toBe(FALLBACK_TOKENS.fontMono);
  });

  it('reads live CSS vars when set on :root', () => {
    setVar('--accent', '#ff0099');
    setVar('--ok', '#00ff00');
    const tokens = resolveThemeTokens();
    expect(tokens.accent).toBe('#ff0099');
    expect(tokens.ok).toBe('#00ff00');
  });

  it('hook returns the same shape as direct resolver', () => {
    setVar('--accent', '#aabbcc');
    const { result } = renderHook(() => useThemeTokens());
    expect(result.current.accent).toBe('#aabbcc');
    expect(typeof result.current.fontMono).toBe('string');
  });

  it('falls back per-var when only some are set (does not 0-out the others)', () => {
    setVar('--accent', '#deadbe');
    const tokens = resolveThemeTokens();
    expect(tokens.accent).toBe('#deadbe');
    expect(tokens.ok).toBe(FALLBACK_TOKENS.ok);
    expect(tokens.fg0).toBe(FALLBACK_TOKENS.fg0);
  });

  it('trims whitespace from CSS values (getPropertyValue often returns " #foo")', () => {
    setVar('--accent', '   #112233   ');
    const tokens = resolveThemeTokens();
    expect(tokens.accent).toBe('#112233');
  });
});
