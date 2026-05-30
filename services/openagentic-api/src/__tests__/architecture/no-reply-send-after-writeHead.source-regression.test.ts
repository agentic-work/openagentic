/**
 * Sev-1 #833 — once stream.handler.ts has flushed NDJSON headers via
 * `reply.raw.writeHead(200, ndjsonHeaders())`, any later
 * `reply.code(...).send(...)` triggers Fastify's onSendEnd hook, which
 * re-attempts writeHead and crashes the request with
 * ERR_HTTP_HEADERS_SENT (unhandled rejection, "Chat Error" toast).
 *
 * Fix: after writeHead, emit errors as NDJSON `error` frames on the
 * open raw stream via `reply.raw.write(JSON.stringify({type:'error',
 * data:{...}}) + '\n')` + `reply.raw.end()`.
 *
 * This source-regression test scans stream.handler.ts and fails if any
 * `reply.code(...).send(` appears AFTER the first
 * `reply.raw.writeHead(` call site (and BEFORE the next handler/route
 * boundary). Tested handlers reset boundary at `export function`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STREAM_HANDLER = path.resolve(
  __dirname,
  '..', '..', 'routes', 'chat', 'handlers', 'stream.handler.ts',
);

describe('Sev-1 #833 — no reply.code().send() after reply.raw.writeHead() (stream.handler.ts)', () => {
  it('every reply.code(...).send() call in a handler precedes its raw.writeHead()', () => {
    const src = fs.readFileSync(STREAM_HANDLER, 'utf8');
    const lines = src.split('\n');

    // Walk line by line, tracking per-handler state. A handler boundary
    // is `export function ...` or `export const ... = function`. Inside
    // each handler, once we see `reply.raw.writeHead`, any subsequent
    // `reply.code(...).send(` is a crash candidate.
    let inHandler = false;
    let pastWriteHead = false;
    const violations: Array<{ line: number; text: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip pure comment lines (false positives — comments often
      // describe what NOT to do).
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      // Handler boundary
      if (/^export\s+(function|const)\s+\w+/.test(line)) {
        inHandler = true;
        pastWriteHead = false;
        continue;
      }
      if (!inHandler) continue;
      if (line.includes('reply.raw.writeHead(')) {
        pastWriteHead = true;
        continue;
      }
      // The crash pattern. Allow `reply.code(...).send(` only when:
      //   (a) it precedes writeHead, OR
      //   (b) the call site is preceded (within ~12 lines) by a
      //       `reply.raw.headersSent` branch — the correct guarded
      //       pattern that routes flushed-stream errors to an NDJSON
      //       `error` frame instead.
      if (pastWriteHead && /reply\.code\s*\([^)]*\)\s*\.send\s*\(/.test(line)) {
        const lookbackStart = Math.max(0, i - 25);
        const lookback = lines.slice(lookbackStart, i).join('\n');
        const guarded = /reply\.raw\.headersSent/.test(lookback);
        if (!guarded) {
          violations.push({ line: i + 1, text: trimmed.slice(0, 120) });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map(v => `  L${v.line}: ${v.text}`)
        .join('\n');
      throw new Error(
        `Sev-1 #833 — found ${violations.length} reply.code().send() call(s) ` +
        `AFTER reply.raw.writeHead() (would crash with ERR_HTTP_HEADERS_SENT):\n${msg}\n\n` +
        'Fix: emit the error as an NDJSON `error` frame on the open raw stream ' +
        'instead — see the mirror at the attachmentValidator path in the same file.',
      );
    }
    expect(violations.length).toBe(0);
  });
});
