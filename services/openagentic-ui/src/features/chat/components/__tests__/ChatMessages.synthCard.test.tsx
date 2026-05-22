/**
 * AC-C2 — ChatMessages must thread `synthsByMessageId` into a strip
 * of <SynthCard /> renders, and pass an approve/deny callback through
 * to each card. Source-grep test (mirrors the inline-widget wire).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatMessages.tsx');

describe('ChatMessages synth-card wire (AC-C2)', () => {
  it('imports SynthCard from ./v2/SynthCard', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/from ['"]\.\/v2\/SynthCard['"]|SynthCard[^;]*from ['"]\.\/v2['"]/);
  });

  it('declares the synthsByMessageId prop on ChatMessagesProps', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/synthsByMessageId\??\s*:\s*Record<string,\s*[^>]*Synth\[\]>/);
  });

  it('declares onApproveSynth + onDenySynth props', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/onApproveSynth\??\s*:/);
    expect(src).toMatch(/onDenySynth\??\s*:/);
  });

  it('destructures all three synth props in the function body', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/synthsByMessageId,/);
    expect(src).toMatch(/onApproveSynth,/);
    expect(src).toMatch(/onDenySynth,/);
  });

  it('renders <SynthCard ... onApprove={onApproveSynth} onDeny={onDenySynth} /> per entry', () => {
    const src = readFileSync(SRC, 'utf8');
    // The strip body should contain the SynthCard JSX + the callback pass-through.
    expect(src).toMatch(/<SynthCard[\s\S]*?synth=/);
    expect(src).toMatch(/onApprove=\{onApproveSynth\}/);
    expect(src).toMatch(/onDeny=\{onDenySynth\}/);
  });
});
