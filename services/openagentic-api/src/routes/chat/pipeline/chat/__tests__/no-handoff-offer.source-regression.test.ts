/**
 * F0-2 (2026-05-12 audit) + Phase 2.4.2 §A6 (2026-05-12): the Phase 10
 * handoff_offer code path was intended to surface mid-loop model swaps
 * when the current model fell below a capability-score threshold. After
 * the Phase E.1 intent-classifier rip (2026-05-10), the path lost its
 * intent signal and `emitHandoffIfNeeded` became dead code — defined at
 * runChat.ts:498 with ZERO call sites. The comment at runChat.ts:405
 * acknowledged this and queued the rip for a "follow-up phase".
 *
 * This test pins the rip — `emitHandoffIfNeeded`, the
 * `model_handoff_offer` emit, and the `buildModelHandoffOffer` builder
 * import are all gone from runChat.ts. Phase 2.4.2 §A6 also retired the
 * builder itself from `routes/chat/pipeline/chat/builders.ts` since it
 * had zero production callers; we now pin that retirement here too.
 *
 * Source-regression test — catches re-introduction of the dead code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUNCHAT = join(__dirname, '..', 'runChat.ts');
const BUILDERS = join(__dirname, '..', 'builders.ts');

describe('runChat — handoff_offer dead-code rip (F0-2 + Phase 2.4.2 §A6)', () => {
  const src = readFileSync(RUNCHAT, 'utf8');

  it('does NOT import buildModelHandoffOffer', () => {
    expect(/import\s+\{[^}]*buildModelHandoffOffer/.test(src)).toBe(false);
  });

  it('does NOT define emitHandoffIfNeeded', () => {
    expect(/const\s+emitHandoffIfNeeded\s*=/.test(src)).toBe(false);
  });

  it('does NOT emit model_handoff_offer', () => {
    expect(/['"]model_handoff_offer['"]/.test(src)).toBe(false);
  });

  it('does NOT declare handoffDecision in RunChatDeps', () => {
    expect(/handoffDecision\s*\?:/.test(src)).toBe(false);
  });
});

describe('builders — Phase 2.4.2 §A6 retired buildModelHandoffOffer', () => {
  const src = readFileSync(BUILDERS, 'utf8');

  it('does NOT export buildModelHandoffOffer (handoff path fully ripped)', () => {
    expect(/export\s+function\s+buildModelHandoffOffer/.test(src)).toBe(false);
  });

  it('does NOT define ModelHandoffOfferPayload interface', () => {
    expect(/export\s+interface\s+ModelHandoffOfferPayload/.test(src)).toBe(false);
  });
});
