/**
 * Phase H wire-contract tests (task #153).
 * ========================================
 *
 * Verifies the five Phase H envelopes (`artifact_open`, `artifact_close`,
 * `image_progress`, `session_rename`, `memory_write`) emit correctly
 * shaped payloads.
 *
 * Strategy — drive `writeNDJSON()` into an in-memory Fastify reply stub
 * and assert:
 *   1. Each emitted type is declared in `CHAT_STREAM_EVENTS`
 *   2. Payload shape matches the schema documented in
 *      `docs/core/streaming-contract.md`
 *
 * Mirrors `phase-g-events.test.ts` exactly — same helper, same pattern.
 */

import { describe, test, expect } from 'vitest';
import { writeNDJSON } from '../infra/ndjson.js';

// ---------------------------------------------------------------------------
// Mini reply stub — captures writeNDJSON output line-by-line so we can
// parse each line and assert type + payload.
// ---------------------------------------------------------------------------
interface CapturedLine {
  type: string;
  payload: Record<string, unknown>;
  raw: string;
}

function makeReplyStub() {
  const lines: string[] = [];
  const reply = {
    raw: {
      write: (chunk: string) => {
        for (const part of chunk.split('\n')) {
          if (part.trim()) lines.push(part);
        }
        return true;
      },
      writable: true,
      destroyed: false,
    },
  } as any;

  function captured(): CapturedLine[] {
    return lines.map(raw => {
      const obj = JSON.parse(raw);
      const { type, ...rest } = obj;
      return { type: String(type), payload: rest as Record<string, unknown>, raw };
    });
  }

  return { reply, captured };
}

describe('Phase H (task #153) — NDJSON envelope wire contract', () => {
  test('artifact_open envelope carries artifactId/kind/title/language/fileName', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'artifact_open', {
      artifactId: 'art-123',
      kind: 'code',
      title: 'Cluster health report',
      language: 'typescript',
      fileName: 'report.ts',
    });
    const lines = captured();
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('artifact_open');
    expect(lines[0].payload).toMatchObject({
      artifactId: 'art-123',
      kind: 'code',
      title: 'Cluster health report',
      language: 'typescript',
      fileName: 'report.ts',
    });
  });

  test('artifact_close envelope carries artifactId + stats', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'artifact_close', {
      artifactId: 'art-456',
      stats: { bytes: 2048, lines: 42 },
    });
    const lines = captured();
    expect(lines[0].type).toBe('artifact_close');
    expect(lines[0].payload.artifactId).toBe('art-456');
    expect(lines[0].payload.stats).toEqual({ bytes: 2048, lines: 42 });
  });

  test('image_progress envelope carries imageGenId + progress + optional partialUrl', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'image_progress', {
      imageGenId: 'img-789',
      progress: 0.5,
      partialUrl: 'https://example.com/partial.png',
      eta: 12,
    });
    const lines = captured();
    expect(lines[0].type).toBe('image_progress');
    expect(lines[0].payload).toMatchObject({
      imageGenId: 'img-789',
      progress: 0.5,
      partialUrl: 'https://example.com/partial.png',
      eta: 12,
    });
  });

  test('image_progress terminal envelope fires with progress=1', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'image_progress', {
      imageGenId: 'img-final',
      progress: 1,
      partialUrl: 'image://ref-1',
      eta: 0,
    });
    expect(captured()[0].payload.progress).toBe(1);
  });

  test('session_rename envelope carries sessionId/from/to/reason', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'session_rename', {
      sessionId: 'sess-1',
      from: 'New Chat',
      to: 'Kubernetes Health Review',
      reason: 'auto-title',
    });
    const lines = captured();
    expect(lines[0].type).toBe('session_rename');
    expect(lines[0].payload).toMatchObject({
      sessionId: 'sess-1',
      from: 'New Chat',
      to: 'Kubernetes Health Review',
      reason: 'auto-title',
    });
  });

  test('memory_write envelope carries key/summary/scope', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'memory_write', {
      key: 'mem-42',
      summary: 'User prefers Sonnet 4.6 for coding tasks',
      scope: 'user',
      entryId: 'entry-42',
      tokenCount: 15,
    });
    const lines = captured();
    expect(lines[0].type).toBe('memory_write');
    expect(lines[0].payload).toMatchObject({
      key: 'mem-42',
      summary: 'User prefers Sonnet 4.6 for coding tasks',
      scope: 'user',
      entryId: 'entry-42',
      tokenCount: 15,
    });
  });

  test('all Phase H event types are declared in streaming-contract.types.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const typesFile = resolve(
      here,
      '..', '..', '..', '..',
      'docs', 'core', 'streaming-contract.types.ts',
    );
    const src = readFileSync(typesFile, 'utf8');
    const declared = new Set<string>();
    const literalRe = /'([a-z][a-z0-9_]*)'/g;
    let m: RegExpExecArray | null;
    while ((m = literalRe.exec(src)) !== null) declared.add(m[1]);
    for (const t of [
      'artifact_open',
      'artifact_close',
      'image_progress',
      'session_rename',
      'memory_write',
    ]) {
      expect(declared.has(t)).toBe(true);
    }
  });
});
