import React from 'react';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

/**
 * Truncate long fully-qualified model ids to fit the footer pill while
 * keeping the meaningful suffix. The full id is preserved in the title
 * attribute so hover surfaces it verbatim.
 *
 *   us.anthropic.claude-sonnet-4-5-20250929-v1:0 → claude-sonnet-4-5
 *   openai/gpt-4o-mini                           → gpt-4o-mini
 *   gpt-oss:20b                                  → gpt-oss:20b
 */
function abbreviateModel(raw: string): string {
  if (!raw) return 'auto';
  // Trim known provider prefixes.
  let s = raw.replace(/^(us\.|eu\.|apac\.)?(anthropic|openai|bedrock|vertex|azure)[.:/]/i, '');
  // Drop dated suffixes like `-20250929-v1:0`.
  s = s.replace(/-\d{6,8}-v\d+:\d+$/, '');
  // Cap at 28 chars.
  if (s.length > 28) s = s.slice(0, 27) + '…';
  return s;
}

export const CodemodeFooterModelPill: React.FC = () => {
  const rawModel = useCodeModeStore((st) => st.session?.model ?? '');
  const display = rawModel ? abbreviateModel(rawModel) : 'auto';
  const fullId = rawModel || 'auto (Smart Router)';

  return (
    <span
      data-testid="cm-composer-model-chip"
      title={fullId}
      style={{
        fontFamily:
          'var(--cm-prose-font, "Inter", "IBM Plex Sans", system-ui, sans-serif)',
        fontSize: 12,
        padding: '4px 12px',
        background: 'color-mix(in srgb, var(--cm-accent, #58a6ff) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--cm-accent, #58a6ff) 25%, transparent)',
        borderRadius: 999,
        color: 'var(--cm-text-muted, #6e7681)',
        lineHeight: 1.4,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: 280,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      <span style={{ opacity: 0.7 }}>model</span>
      <span style={{ color: 'var(--cm-accent, #58a6ff)' }}>{display}</span>
    </span>
  );
};

export default CodemodeFooterModelPill;
