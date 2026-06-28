/**
 * RED contract for buildFollowupChipsFrame — the canonical wire frame
 * that drives the end-of-message follow-up chip row (G1).
 *
 * Shape: { type: 'followup_chips', messageId, chips, ts }
 *   - chips: Array<{ label: string; prompt: string }>
 *   - 0-5 chips allowed (0 collapses to a no-op on the UI side)
 *   - 6+ chips REJECTED (builder throws)
 *   - each chip must carry non-empty label + non-empty prompt
 */
import { describe, it, expect } from 'vitest';
import { buildFollowupChipsFrame } from '../builders.js';

describe('buildFollowupChipsFrame — canonical follow-up chip-row builder', () => {
  it('stamps type=followup_chips + ts and returns chips verbatim', () => {
    const frame = buildFollowupChipsFrame(
      {
        messageId: 'msg-1',
        chips: [
          { label: 'drill into prod-west-rg →', prompt: 'show me prod-west-rg detail' },
          { label: 'apply nat-endpoint terraform plan →', prompt: 'apply the nat-endpoint terraform' },
          { label: 'make slide ⎘', prompt: 'render an exec slide from this' },
        ],
      },
      1700000000000,
    );
    expect(frame.type).toBe('followup_chips');
    expect(frame.messageId).toBe('msg-1');
    expect(frame.ts).toBe(1700000000000);
    expect(frame.chips).toHaveLength(3);
    expect(frame.chips[0].label).toBe('drill into prod-west-rg →');
    expect(frame.chips[0].prompt).toBe('show me prod-west-rg detail');
  });

  it('accepts 0-5 chips', () => {
    expect(() => buildFollowupChipsFrame({ messageId: 'm', chips: [] })).not.toThrow();
    expect(() =>
      buildFollowupChipsFrame({
        messageId: 'm',
        chips: [
          { label: 'a', prompt: 'a-p' },
          { label: 'b', prompt: 'b-p' },
          { label: 'c', prompt: 'c-p' },
          { label: 'd', prompt: 'd-p' },
          { label: 'e', prompt: 'e-p' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects 6+ chips', () => {
    expect(() =>
      buildFollowupChipsFrame({
        messageId: 'm',
        chips: [
          { label: 'a', prompt: 'a-p' },
          { label: 'b', prompt: 'b-p' },
          { label: 'c', prompt: 'c-p' },
          { label: 'd', prompt: 'd-p' },
          { label: 'e', prompt: 'e-p' },
          { label: 'f', prompt: 'f-p' },
        ],
      }),
    ).toThrow();
  });

  it('rejects chips missing label or prompt', () => {
    expect(() =>
      buildFollowupChipsFrame({
        messageId: 'm',
        // @ts-expect-error — testing runtime rejection of malformed input
        chips: [{ label: 'a', prompt: '' }],
      }),
    ).toThrow();
    expect(() =>
      buildFollowupChipsFrame({
        messageId: 'm',
        // @ts-expect-error — testing runtime rejection of malformed input
        chips: [{ label: '', prompt: 'p' }],
      }),
    ).toThrow();
    expect(() =>
      buildFollowupChipsFrame({
        messageId: 'm',
        // @ts-expect-error — testing runtime rejection of malformed input
        chips: [{ label: 'a' }],
      }),
    ).toThrow();
  });

  it('rejects empty messageId', () => {
    expect(() =>
      buildFollowupChipsFrame({ messageId: '', chips: [] }),
    ).toThrow();
  });
});
