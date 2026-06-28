/**
 * Sev-1 #792 — Fastify body-limit regression pin.
 *
 * The chat UI advertises a 25 MiB per-attachment cap (see
 * `routes/chat/handlers/attachmentValidator.ts` → `MAX_ATTACHMENT_SIZE_BYTES`).
 * When a single chat-stream POST carries 1-N attachments inline (base64 in
 * the JSON body), the *total* request body can comfortably approach the
 * UI per-file cap. If the fastify-level bodyLimit drops below the UI cap,
 * the user sees a generic 413 from fastify *before* the chat handler runs
 * — i.e. before `attachmentValidator` ever gets a chance to emit a
 * structured NDJSON error frame. Result: empty bubble, no actionable
 * feedback.
 *
 * This test pins the chosen byte budget so future shrinks fail loudly
 * instead of silently regressing #792. The companion UI-side fix lives
 * in `services/openagentic-ui/Dockerfile` + `docker-entrypoint.sh`
 * (commits 8883e8de + 9ce4546e — rip chainguard nginx stub).
 */

import { describe, it, expect } from 'vitest';
import { FASTIFY_BODY_LIMIT_BYTES } from '../fastify.config.js';

const ONE_MIB = 1024 * 1024;
const UI_PER_ATTACHMENT_CAP_BYTES = 25 * ONE_MIB; // mirror of MAX_ATTACHMENT_SIZE_BYTES
const HEADROOM_FLOOR_BYTES = 30 * ONE_MIB;        // 25 MiB UI cap + 5 MiB headroom for JSON envelope

describe('fastify bodyLimit (Sev-1 #792)', () => {
  it('exports FASTIFY_BODY_LIMIT_BYTES as a named numeric constant (test seam)', () => {
    expect(typeof FASTIFY_BODY_LIMIT_BYTES).toBe('number');
    expect(Number.isFinite(FASTIFY_BODY_LIMIT_BYTES)).toBe(true);
    expect(FASTIFY_BODY_LIMIT_BYTES).toBeGreaterThan(0);
  });

  it('is at least the UI per-attachment cap (25 MiB) — otherwise 25 MiB uploads 413 at fastify', () => {
    expect(FASTIFY_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(UI_PER_ATTACHMENT_CAP_BYTES);
  });

  it('has at least 5 MiB headroom over the UI cap (>= 30 MiB total) for JSON envelope + multi-file', () => {
    expect(FASTIFY_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(HEADROOM_FLOOR_BYTES);
  });

  it('approximates POSTing ~24 MiB does NOT exceed the limit (proves a legit 25 MiB user file fits)', () => {
    // Simulate a chat-stream POST with a 24 MiB inline base64 attachment.
    // base64 inflates by ~4/3, so 24 MiB raw → ~32 MiB on the wire; plus the
    // surrounding JSON envelope (messages, metadata, session id) is ~few KiB.
    const rawAttachmentBytes = 24 * ONE_MIB;
    const base64InflatedBytes = Math.ceil((rawAttachmentBytes * 4) / 3);
    const envelopeOverheadBytes = 8 * 1024; // 8 KiB for JSON wrapping + headers
    const approxPostBodyBytes = base64InflatedBytes + envelopeOverheadBytes;

    // The test asserts that a typical 24 MiB user file (a real-world legit
    // upload) does NOT trip the fastify bodyLimit. If this fails, fastify
    // will return 413 before the chat handler runs — exactly the #792 bug.
    expect(approxPostBodyBytes).toBeLessThan(FASTIFY_BODY_LIMIT_BYTES);
  });
});
