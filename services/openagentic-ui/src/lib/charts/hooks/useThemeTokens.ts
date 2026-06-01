import { useEffect, useState, type RefObject } from 'react';
import type { ResolvedThemeTokens } from '../types';

/**
 * Fallback values, used ONLY when a CSS var isn't defined on the resolution
 * scope (e.g. a chart rendered in a detached subtree before the theme CSS is
 * applied). At runtime the SOT (src/styles/theme.css) always defines the
 * canonical tokens these resolve from, so these literals are a last-resort
 * snapshot of the brand DARK theme (terminal ramp + signal-orange accent) —
 * they are theme-allowlisted as a token snapshot, not call-site hardcoding.
 */
export const FALLBACK_TOKENS: ResolvedThemeTokens = {
  accent: '#FF5722', // signal-orange (brand accent)
  ok: '#22C55E',
  warn: '#F59E0B',
  err: '#FF453A',
  info: '#4DD0E1',
  fg0: '#F4EFE6', // terminal-fg (paper-on-dark)
  fg1: '#CDC4B2',
  fg2: '#968B76',
  fg3: '#968B76',
  bg0: '#18130C', // terminal-bg
  bg1: '#211A11', // terminal-surf
  bg2: '#2C2418', // terminal-surf-2
  line1: '#3A3024', // terminal-rule
  line2: '#3A3024',
  capThinking: '#FFB87E', // signal-soft
  capStreaming: '#4DD0E1',
  capTools: '#F59E0B',
  fontUi: 'var(--font-body, Inter, system-ui, sans-serif)',
  fontMono: 'var(--font-mono, "IBM Plex Mono", ui-monospace, monospace)',
};

/**
 * For each token, list the CSS vars to probe in order. First non-empty wins.
 * Chatmode-prefixed (`--cm-*`) comes first so charts inside the chatmode
 * transcript pick up that surface's palette without code branches; falls
 * back to the admin-style flat (`--accent`, `--bg-0`, …) names; finally
 * the FALLBACK_TOKENS const.
 *
 * Why two namespaces: chatmode-v2.css scopes its tokens under `.cm-v2` as
 * `--cm-bg-0`, `--cm-accent`, `--cm-fg-1`, etc. The admin shell uses
 * `--accent`, `--bg-0` on :root. A chart component rendered in either
 * surface should pick up the correct palette automatically — without any
 * surface-specific wiring at the call site.
 */
const VAR_MAP: Array<[keyof ResolvedThemeTokens, string[]]> = [
  ['accent',       ['--cm-accent', '--accent']],
  ['ok',           ['--cm-ok', '--ok']],
  ['warn',         ['--cm-warn', '--warn']],
  ['err',          ['--cm-err', '--err']],
  ['info',         ['--cm-info', '--info']],
  ['fg0',          ['--cm-fg-0', '--fg-0']],
  ['fg1',          ['--cm-fg-1', '--fg-1']],
  ['fg2',          ['--cm-fg-2', '--fg-2']],
  ['fg3',          ['--cm-fg-3', '--fg-3']],
  ['bg0',          ['--cm-bg-0', '--bg-0']],
  ['bg1',          ['--cm-bg-1', '--bg-1']],
  ['bg2',          ['--cm-bg-2', '--bg-2']],
  ['line1',        ['--cm-line-1', '--line-1']],
  ['line2',        ['--cm-line-2', '--line-2']],
  ['capThinking',  ['--cm-cap-thinking', '--cap-thinking']],
  ['capStreaming', ['--cm-cap-streaming', '--cap-streaming']],
  ['capTools',     ['--cm-cap-tools', '--cap-tools']],
  ['fontUi',       ['--cm-font-ui', '--font-ui', '--font-sans']],
  ['fontMono',     ['--cm-font-mono', '--font-mono']],
];

/**
 * Resolve theme tokens.
 *
 * Pass `scope` (an SVG/HTML element actually rendered inside the chart)
 * to inherit the surface's scoped CSS vars (`.cm-v2 { --cm-accent: ... }`
 * etc). If `scope` is omitted, falls back to `document.documentElement`,
 * which is correct for admin (vars defined on `:root`) but misses
 * chatmode's `.cm-v2`-scoped tokens.
 */
export function resolveThemeTokens(scope: Element = document.documentElement): ResolvedThemeTokens {
  const style = getComputedStyle(scope);
  const out: Partial<ResolvedThemeTokens> = {};
  for (const [key, cssVars] of VAR_MAP) {
    let value = '';
    for (const v of cssVars) {
      const raw = style.getPropertyValue(v).trim();
      if (raw) { value = raw; break; }
    }
    out[key] = value || FALLBACK_TOKENS[key];
  }
  return out as ResolvedThemeTokens;
}

/**
 * React hook that returns the current theme tokens. Re-resolves on:
 *   - document theme attr change (data-theme)
 *   - prefers-color-scheme media query change
 *   - user accent swap (via the `deps` parameter)
 *
 * Pass `scopeRef` (a ref to an element rendered inside the chart) so the
 * resolver picks up surface-scoped CSS vars — chatmode tokens (`--cm-*`)
 * are defined on `.cm-v2`, not `:root`. When omitted, falls back to
 * `:root` (correct for admin; misses chatmode-scoped overrides).
 */
export function useThemeTokens(
  scopeRef?: RefObject<Element | null>,
  deps: ReadonlyArray<unknown> = [],
): ResolvedThemeTokens {
  const [tokens, setTokens] = useState<ResolvedThemeTokens>(() =>
    resolveThemeTokens(scopeRef?.current ?? document.documentElement),
  );

  useEffect(() => {
    const refresh = () =>
      setTokens(resolveThemeTokens(scopeRef?.current ?? document.documentElement));
    refresh();
    const obs = new MutationObserver(refresh);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    // Also observe the scope itself, in case classes / inline style change
    // (e.g. ThemeContext flipping a `data-accent` on the chat-surface root).
    if (scopeRef?.current) {
      obs.observe(scopeRef.current, { attributes: true, attributeFilter: ['data-theme', 'class', 'style', 'data-accent'] });
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', refresh);

    return () => {
      obs.disconnect();
      mq.removeEventListener?.('change', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return tokens;
}
