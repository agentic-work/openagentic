/**
 * Extended Thinking Toggle Store (Z.ET, 2026-05-19)
 *
 * User-facing per-session toggle for extended thinking. When ON and the
 * currently-selected model supports extended thinking, the chat request
 * body includes `extendedThinkingEnabled: true` and the api enables
 * the thinking channel on the CompletionRequest.
 *
 * Default: ENABLED — user direction: "ON by default for models that DO
 * support it."
 *
 * Visibility: the toggle is ONLY rendered in ChatInputToolbar when the
 * selected model's `capabilities.thinking` flag is true (read from
 * `mapRegistryRowToToolbarModel`). For non-thinking models the component
 * returns null — the store state is simply ignored.
 *
 * State is persisted to localStorage so the preference survives page
 * reload. Follows the same shape as useGroundingStore and
 * useFollowupChipsStore (enabled / toggle / setEnabled).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ExtendedThinkingState {
  /** When true, extended thinking is requested on the next turn (for models
   * that support it). */
  enabled: boolean;
  toggle: () => void;
  setEnabled: (next: boolean) => void;
}

export const useExtendedThinkingStore = create<ExtendedThinkingState>()(
  persist(
    (set) => ({
      enabled: true,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      setEnabled: (next: boolean) => set({ enabled: next }),
    }),
    {
      name: 'openagentic:extended-thinking',
      version: 1,
    },
  ),
);

/** Convenience selector — returns the current enabled flag. */
export const useExtendedThinkingEnabled = (): boolean =>
  useExtendedThinkingStore((s) => s.enabled);
