/**
 * Source-regression: the ChatMessage prisma model (which maps to the
 * `chat_messages` table — the SoT for stored assistant turns) MUST declare
 * `content_blocks Json?`. Sev-0 P0 #940 (2026-05-18) — the column was
 * added to the legacy `Messages` model (mapped to `messages`) only,
 * causing every assistant write via `prisma.chatMessage.create()` to
 * throw "Unknown argument `content_blocks`", swallowed by the
 * stream.handler.ts catch-and-warn → assistant rows never persisted.
 *
 * Pin against drift: this test must fail if anyone removes the column
 * from the ChatMessage model again, or if a duplicate-model accidentally
 * leaves it on a different model.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../prisma/schema.prisma',
);

function extractModel(src: string, name: string): string | null {
  const start = src.indexOf(`\nmodel ${name} {`);
  if (start < 0) return null;
  const after = src.indexOf('\n}', start);
  if (after < 0) return null;
  return src.slice(start, after + 2);
}

describe('schema.prisma — ChatMessage.content_blocks column pin', () => {
  const src = fs.readFileSync(SCHEMA_PATH, 'utf-8');

  it('ChatMessage model is declared and maps to chat_messages table', () => {
    const block = extractModel(src, 'ChatMessage');
    expect(block, 'ChatMessage model must exist in schema.prisma').toBeTruthy();
    expect(block).toMatch(/@@map\(\s*"chat_messages"\s*\)/);
  });

  it('ChatMessage model declares content_blocks Json?', () => {
    const block = extractModel(src, 'ChatMessage')!;
    expect(block, 'content_blocks Json? must be declared on the ChatMessage model').toMatch(
      /\bcontent_blocks\s+Json\?/,
    );
  });
});
