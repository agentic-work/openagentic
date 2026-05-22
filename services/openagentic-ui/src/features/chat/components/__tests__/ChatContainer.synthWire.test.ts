/**
 * AC-C2 — ChatContainer threads synth state + approve/deny callbacks
 * into <ChatMessages />. The callbacks POST to
 * /api/synth/approvals/:id/[approve|reject].
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatContainer.tsx');

describe('ChatContainer synth wire (AC-C2)', () => {
  it('destructures synthsByMessageId from useChatStream', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/synthsByMessageId,/);
  });

  it('forwards synthsByMessageId into <ChatMessages />', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/synthsByMessageId=\{synthsByMessageId\}/);
  });

  it('passes onApproveSynth + onDenySynth handlers into <ChatMessages />', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/onApproveSynth=\{[^}]+\}/);
    expect(src).toMatch(/onDenySynth=\{[^}]+\}/);
  });

  it('handlers POST to /api/synth/approvals/:id/approve|reject', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/\/api\/synth\/approvals\/.*?\/approve/);
    expect(src).toMatch(/\/api\/synth\/approvals\/.*?\/reject/);
  });
});
