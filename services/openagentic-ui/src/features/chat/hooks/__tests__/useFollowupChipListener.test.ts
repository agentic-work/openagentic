// RED test for #921 — followup-chip click submits prompt as next user message.
//
// The chip render in AgenticActivityStream dispatches a window-level CustomEvent
// `followup-chip-clicked` with `{ detail: { prompt: string } }`. This hook
// listens for that event and invokes the supplied submit callback with the
// prompt text — wiring chips to the existing composer submit path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFollowupChipListener } from '../useFollowupChipListener';

describe('useFollowupChipListener', () => {
  let onSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSubmit = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fire(prompt: unknown) {
    const ev = new CustomEvent('followup-chip-clicked', {
      detail: { prompt },
    });
    window.dispatchEvent(ev);
  }

  it('calls onSubmit with the chip prompt when a followup-chip-clicked event fires', () => {
    renderHook(() => useFollowupChipListener(onSubmit));
    fire('How do I enable GCP billing export?');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('How do I enable GCP billing export?');
  });

  it('ignores events with non-string prompts', () => {
    renderHook(() => useFollowupChipListener(onSubmit));
    fire(undefined);
    fire(null);
    fire(123);
    fire({ obj: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('ignores empty / whitespace-only prompts', () => {
    renderHook(() => useFollowupChipListener(onSubmit));
    fire('');
    fire('   ');
    fire('\n\t');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses the latest onSubmit callback after re-render', () => {
    const onSubmit2 = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (s: string) => void }) =>
      useFollowupChipListener(cb), {
      initialProps: { cb: onSubmit },
    });
    rerender({ cb: onSubmit2 });
    fire('drill into Bedrock token metrics');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSubmit2).toHaveBeenCalledWith('drill into Bedrock token metrics');
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useFollowupChipListener(onSubmit));
    unmount();
    fire('this should be ignored');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
