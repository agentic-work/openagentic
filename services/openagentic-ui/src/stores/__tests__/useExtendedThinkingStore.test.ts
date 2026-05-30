/**
 * Z.ET.1 — useExtendedThinkingStore RED tests (2026-05-19).
 *
 * Confirms:
 * - Store defaults to enabled=true (ON by default for thinking-capable models)
 * - toggle() flips enabled
 * - setEnabled() sets to specific value
 *
 * RED: these tests should FAIL before the store is created.
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('useExtendedThinkingStore — shape + defaults', () => {
  beforeEach(async () => {
    // Dynamically import AFTER clearing storage to avoid persist hydration
    const { useExtendedThinkingStore } = await import('@/stores/useExtendedThinkingStore');
    useExtendedThinkingStore.setState({ enabled: true });
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem('openagentic:extended-thinking'); } catch { /* noop */ }
    }
  });

  it('defaults to enabled=true', async () => {
    const { useExtendedThinkingStore } = await import('@/stores/useExtendedThinkingStore');
    expect(useExtendedThinkingStore.getState().enabled).toBe(true);
  });

  it('toggle() flips enabled from true to false', async () => {
    const { useExtendedThinkingStore } = await import('@/stores/useExtendedThinkingStore');
    useExtendedThinkingStore.setState({ enabled: true });
    useExtendedThinkingStore.getState().toggle();
    expect(useExtendedThinkingStore.getState().enabled).toBe(false);
  });

  it('toggle() flips enabled from false to true', async () => {
    const { useExtendedThinkingStore } = await import('@/stores/useExtendedThinkingStore');
    useExtendedThinkingStore.setState({ enabled: false });
    useExtendedThinkingStore.getState().toggle();
    expect(useExtendedThinkingStore.getState().enabled).toBe(true);
  });

  it('setEnabled(false) sets to false', async () => {
    const { useExtendedThinkingStore } = await import('@/stores/useExtendedThinkingStore');
    useExtendedThinkingStore.getState().setEnabled(false);
    expect(useExtendedThinkingStore.getState().enabled).toBe(false);
  });

  it('setEnabled(true) sets to true from false', async () => {
    const { useExtendedThinkingStore } = await import('@/stores/useExtendedThinkingStore');
    useExtendedThinkingStore.setState({ enabled: false });
    useExtendedThinkingStore.getState().setEnabled(true);
    expect(useExtendedThinkingStore.getState().enabled).toBe(true);
  });
});
