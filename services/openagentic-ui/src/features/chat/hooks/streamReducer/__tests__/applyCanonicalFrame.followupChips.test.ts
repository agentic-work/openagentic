/**
 * RED contract for applyCanonicalFrame's followup_chips case (G1).
 *
 * Wire emits one `followup_chips` frame per assistant turn (when quality
 * gate passes). Reducer routes the chips into `state.chipsByMessageId`
 * keyed by messageId so the per-message chip row hydrates on reload + on
 * live-stream complete.
 */
import { describe, it, expect } from 'vitest';
import {
  applyCanonicalFrame,
  initialFrameState,
} from '../applyCanonicalFrame';

describe('applyCanonicalFrame — followup_chips case (G1)', () => {
  it('writes chips into state.chipsByMessageId keyed by messageId', () => {
    const chips = [
      { label: 'drill into prod-west-rg →', prompt: 'show me prod-west-rg detail' },
      { label: 'apply nat-endpoint terraform plan →', prompt: 'apply the nat-endpoint terraform' },
      { label: 'make slide ⎘', prompt: 'render an exec slide from this' },
    ];
    const next = applyCanonicalFrame(initialFrameState(), {
      type: 'followup_chips',
      messageId: 'm-1',
      chips,
    });
    expect(next.chipsByMessageId).toBeDefined();
    expect(next.chipsByMessageId!['m-1']).toEqual(chips);
  });

  it('empty chips array does NOT add an entry (or removes existing)', () => {
    const seed = applyCanonicalFrame(initialFrameState(), {
      type: 'followup_chips',
      messageId: 'm-1',
      chips: [{ label: 'a', prompt: 'a-p' }],
    });
    expect(seed.chipsByMessageId!['m-1']).toBeDefined();
    const next = applyCanonicalFrame(seed, {
      type: 'followup_chips',
      messageId: 'm-1',
      chips: [],
    });
    // empty chips array → no entry for that messageId
    expect(next.chipsByMessageId?.['m-1']).toBeUndefined();
  });

  it('different messageIds accumulate independently', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'followup_chips',
      messageId: 'm-1',
      chips: [{ label: 'a', prompt: 'a-p' }],
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'followup_chips',
      messageId: 'm-2',
      chips: [{ label: 'b', prompt: 'b-p' }],
    });
    expect(s2.chipsByMessageId!['m-1']).toEqual([{ label: 'a', prompt: 'a-p' }]);
    expect(s2.chipsByMessageId!['m-2']).toEqual([{ label: 'b', prompt: 'b-p' }]);
  });

  it('initialFrameState carries chipsByMessageId={} so consumers never see undefined-of-undefined', () => {
    const s = initialFrameState();
    expect(s.chipsByMessageId).toEqual({});
  });
});
