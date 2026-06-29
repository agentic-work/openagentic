/**
 * Followup Chips Toggle Store (Z.8a, 2026-05-19)
 *
 * User-facing per-session toggle for the follow-up chip pills rendered below
 * assistant messages. When ON, the ChipsRow renders its contextual action
 * chips ("Pull GCP regions next →", etc.). When OFF, ChipsRow returns null.
 *
 * Default: ENABLED — the user stated "they DO fucking rock".
 *
 * State is persisted to localStorage so the preference survives page reload.
 * Follows the same shape as useGroundingStore (enabled / toggle / setEnabled).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FollowupChipsState {
  /** When true, ChipsRow renders follow-up chips below assistant messages. */
  enabled: boolean;
  toggle: () => void;
  setEnabled: (next: boolean) => void;
}

export const useFollowupChipsStore = create<FollowupChipsState>()(
  persist(
    (set) => ({
      enabled: true,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      setEnabled: (next: boolean) => set({ enabled: next }),
    }),
    {
      name: 'openagentic:followup-chips',
      version: 1,
    },
  ),
);
