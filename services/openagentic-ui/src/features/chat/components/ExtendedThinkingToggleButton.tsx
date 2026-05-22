/**
 * ExtendedThinkingToggleButton (Z.ET.2, 2026-05-19)
 *
 * A toolbar toggle that enables / disables extended thinking for the next
 * chat turn. ONLY visible when the currently-selected model's
 * `capabilities.thinking` flag is true (sourced from the Registry row, NOT
 * from hardcoded model-name patterns — CLAUDE.md Rule 7).
 *
 * Default: ON — user direction: "ON by default for models that DO support
 * it." The store persists to localStorage so the preference survives reload.
 *
 * Positioning: rendered adjacent to the Model Selector in ChatInputToolbar
 * (right side, same flex row — see ChatInputToolbar.tsx).
 *
 * Styling mirrors GroundingToggleButton / FollowupChipsToggleButton: same
 * outline border, same accent tint when ON, same `--text-secondary` when
 * OFF. All colors via `var(--cm-*) / var(--text-secondary)` — no hex
 * literals (CLAUDE.md rule 8b).
 *
 * C2 interaction: the server-side `buildAnthropicWireBody.ts` already strips
 * thinking when `tool_choice` forces a named function call (the C2 fix
 * landed earlier this session). The UI toggle controls the REQUEST layer;
 * the C2 strip handles the WIRE-LEVEL conflict on forced turns. They are
 * additive and independent.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { Brain } from '@/shared/icons';
import clsx from 'clsx';
import { useExtendedThinkingStore } from '@/stores/useExtendedThinkingStore';
import { useModelStore } from '@/stores/useModelStore';

export interface ExtendedThinkingToggleButtonProps {
  disabled?: boolean;
}

/**
 * Returns the `thinking` flag for the currently selected model from the
 * model store. Returns false when no model is selected (auto-routing) or
 * when the model list hasn't loaded yet.
 */
function useSelectedModelSupportsThinking(): boolean {
  const selectedModel = useModelStore((s) => s.selectedModel);
  const availableModels = useModelStore((s) => s.availableModels);

  if (!selectedModel) return false;
  const model = availableModels.find((m) => m.id === selectedModel);
  return Boolean(model?.thinking);
}

/**
 * ExtendedThinkingToggleButton — Brain glyph toggle that flips the global
 * useExtendedThinkingStore.enabled flag. Only visible when the selected
 * model has `thinking: true` in the Registry. ON = bright accent outline +
 * filled tint, OFF = muted secondary text token. Persists via localStorage.
 * Theme tokens only — no hex literals (CLAUDE.md rule 8b).
 *
 * Exported for test isolation (same pattern as FollowupChipsToggleButton).
 */
export const ExtendedThinkingToggleButton: React.FC<ExtendedThinkingToggleButtonProps> = ({
  disabled,
}) => {
  const enabled = useExtendedThinkingStore((s) => s.enabled);
  const toggle = useExtendedThinkingStore((s) => s.toggle);
  const supportsThinking = useSelectedModelSupportsThinking();

  // Invisible for non-thinking models
  if (!supportsThinking) return null;

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={toggle}
      disabled={disabled}
      role="switch"
      aria-checked={enabled}
      aria-pressed={enabled}
      aria-label={
        enabled
          ? 'Extended thinking on — model will show reasoning process'
          : 'Extended thinking off — toggle on to see model reasoning'
      }
      data-testid="chat-extended-thinking-toggle"
      data-enabled={enabled ? 'true' : 'false'}
      className={clsx(
        'p-2 rounded-lg transition-colors',
        disabled && 'opacity-50 cursor-not-allowed',
        'hover:bg-theme-bg-secondary',
      )}
      style={{
        color: enabled ? 'var(--cm-accent, var(--accent, var(--text-primary)))' : 'var(--text-secondary)',
        border: enabled
          ? '1px solid var(--cm-accent, var(--accent, var(--color-border)))'
          : '1px solid transparent',
        backgroundColor: enabled
          ? 'color-mix(in srgb, var(--cm-accent, var(--accent, var(--text-primary))) 12%, transparent)'
          : 'transparent',
      }}
      title={
        enabled
          ? 'Extended thinking on — model reasons step-by-step before answering'
          : 'Extended thinking off — click to enable model reasoning'
      }
    >
      <Brain size={18} aria-hidden="true" />
    </motion.button>
  );
};

export default ExtendedThinkingToggleButton;
