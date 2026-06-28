/**
 * Theme-token namespace fallback tests.
 *
 * Chats charts must respect chatmode's --cm-* CSS vars (scoped to .cm-v2)
 * AND admin's --* vars (on :root). Same chart component, two surfaces,
 * one resolver — no per-surface code branches.
 *
 * Per user direction 2026-05-14: "these charts when they are rendered in
 * chatmode have to adhere to the global css themes/accent colors".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveThemeTokens } from '../hooks/useThemeTokens';

function setVar(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value);
}
function clearVars(el: HTMLElement) {
  for (const v of [
    '--accent', '--ok', '--warn', '--err', '--info', '--fg-0', '--bg-0',
    '--cm-accent', '--cm-ok', '--cm-warn', '--cm-err', '--cm-info', '--cm-fg-0', '--cm-bg-0',
  ]) el.style.removeProperty(v);
}

describe('useThemeTokens — namespace fallback', () => {
  beforeEach(() => {
    clearVars(document.documentElement);
    document.body.innerHTML = '';
  });

  it('prefers --cm-accent over --accent when both are set on :root', () => {
    setVar(document.documentElement, '--accent', '#ff0000');
    setVar(document.documentElement, '--cm-accent', '#00ff00');
    const tokens = resolveThemeTokens();
    expect(tokens.accent).toBe('#00ff00');
  });

  it('falls through to --accent when --cm-accent is not set', () => {
    setVar(document.documentElement, '--accent', '#abc123');
    const tokens = resolveThemeTokens();
    expect(tokens.accent).toBe('#abc123');
  });

  it('reads scoped vars when given a non-root element', () => {
    // Simulate chatmode: .cm-v2 wrapper with --cm-accent scoped to it
    const scope = document.createElement('div');
    scope.classList.add('cm-v2');
    setVar(scope, '--cm-accent', '#deadbe');
    document.body.appendChild(scope);
    const tokens = resolveThemeTokens(scope);
    expect(tokens.accent).toBe('#deadbe');
  });

  it('--cm-fg-0 wins over --fg-0', () => {
    setVar(document.documentElement, '--fg-0', '#aaa');
    setVar(document.documentElement, '--cm-fg-0', '#bbb');
    const tokens = resolveThemeTokens();
    expect(tokens.fg0).toBe('#bbb');
  });

  it('--cm-ok/warn/err/info all win over the bare variants', () => {
    setVar(document.documentElement, '--ok', '#000');
    setVar(document.documentElement, '--cm-ok', '#0a0');
    setVar(document.documentElement, '--warn', '#000');
    setVar(document.documentElement, '--cm-warn', '#aa0');
    setVar(document.documentElement, '--err', '#000');
    setVar(document.documentElement, '--cm-err', '#a00');
    setVar(document.documentElement, '--info', '#000');
    setVar(document.documentElement, '--cm-info', '#00a');
    const tokens = resolveThemeTokens();
    expect(tokens.ok).toBe('#0a0');
    expect(tokens.warn).toBe('#aa0');
    expect(tokens.err).toBe('#a00');
    expect(tokens.info).toBe('#00a');
  });
});
