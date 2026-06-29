/**
 * Phase G wire-contract tests (task #152).
 * ========================================
 *
 * Verifies the six Phase G envelopes (`handoff`, `retry`, `stage_change`,
 * `rag_citation`, `correction`, `warning`) emit correctly shaped payloads.
 *
 * Strategy — drive `writeNDJSON()` into an in-memory Fastify reply stub
 * and assert:
 *   1. Each emitted type is declared in `CHAT_STREAM_EVENTS`
 *   2. Payload shape matches the schema documented in
 *      `docs/core/streaming-contract.md`
 *
 * The full pipeline run is covered by `smoke.test.ts` (which spawns a
 * real server). This test runs in-process against the NDJSON helper
 * directly so it's fast (<100ms) and independent of the API server.
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
        // Split on newlines in case a single chunk contains multiple lines.
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

describe('Phase G (task #152) — NDJSON envelope wire contract', () => {
  test('handoff envelope carries fromModel/toModel/reason/complexityScore', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'handoff', {
      fromModel: 'gpt-oss:20b',
      toModel: 'gpt-5.2',
      reason: 'smart-router selection',
      complexityScore: 73,
    });
    const lines = captured();
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('handoff');
    expect(lines[0].payload).toMatchObject({
      fromModel: 'gpt-oss:20b',
      toModel: 'gpt-5.2',
      reason: 'smart-router selection',
      complexityScore: 73,
    });
  });

  test('retry envelope carries attempt/maxAttempts/reason/elapsedMs', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'retry', {
      toolCallId: 'call-1',
      name: 'azure_list_vms',
      attempt: 2,
      maxAttempts: 3,
      reason: 'ETIMEDOUT',
      elapsedMs: 5200,
    });
    const lines = captured();
    expect(lines[0].type).toBe('retry');
    expect(lines[0].payload).toMatchObject({
      attempt: 2,
      maxAttempts: 3,
      reason: 'ETIMEDOUT',
      elapsedMs: 5200,
    });
  });

  test('stage_change envelope carries stage + previousStage + elapsedMs', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'stage_change', {
      stage: 'query',
      previousStage: 'discover',
      elapsedMs: 450,
    });
    const lines = captured();
    expect(lines[0].type).toBe('stage_change');
    expect(lines[0].payload.stage).toBe('query');
    expect(lines[0].payload.previousStage).toBe('discover');
    expect(lines[0].payload.elapsedMs).toBe(450);
  });

  test('rag_citation envelope carries source/chunkId/excerpt/score', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'rag_citation', {
      source: 'handbook.md',
      chunkId: 'chunk-7',
      excerpt: 'Teams should rotate …',
      score: 0.87,
    });
    const lines = captured();
    expect(lines[0].type).toBe('rag_citation');
    expect(lines[0].payload).toMatchObject({
      source: 'handbook.md',
      chunkId: 'chunk-7',
      score: 0.87,
    });
  });

  test('correction envelope carries wrongText + correctedText + reason', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'correction', {
      wrongText: 'OOM events: 47 in 7d',
      correctedText: 'OOM events: 12 in 7d',
      reason: 'initial count double-counted restart-on-reason',
    });
    const lines = captured();
    expect(lines[0].type).toBe('correction');
    expect(lines[0].payload.wrongText).toContain('47');
    expect(lines[0].payload.correctedText).toContain('12');
  });

  test('warning envelope carries level/source/code/message', () => {
    const { reply, captured } = makeReplyStub();
    writeNDJSON(reply, 'warning', {
      level: 'info',
      source: 'auth.stage',
      code: 'TOKEN_REFRESH',
      message: 'Access token refreshed',
    });
    const lines = captured();
    expect(lines[0].type).toBe('warning');
    expect(lines[0].payload).toMatchObject({
      level: 'info',
      source: 'auth.stage',
      code: 'TOKEN_REFRESH',
    });
  });

  test('all Phase G event types are declared in streaming-contract.types.ts', async () => {
    // The types file lives outside rootDir (it's a docs artifact), so
    // we parse its literal strings the same way `ndjson-contract.test.ts`
    // does — regex over the file contents — rather than importing it
    // as a TS module.
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const typesFile = resolve(
      here,
      '..', '..', '..', '..',
      'docs', 'core', 'streaming-contract.types.ts'
    );
    const src = readFileSync(typesFile, 'utf8');
    const declared = new Set<string>();
    const literalRe = /'([a-z][a-z0-9_]*)'/g;
    let m: RegExpExecArray | null;
    while ((m = literalRe.exec(src)) !== null) declared.add(m[1]);
    for (const t of [
      'handoff',
      'retry',
      'stage_change',
      'rag_citation',
      'correction',
      'warning',
    ]) {
      expect(declared.has(t)).toBe(true);
    }
  });
});
