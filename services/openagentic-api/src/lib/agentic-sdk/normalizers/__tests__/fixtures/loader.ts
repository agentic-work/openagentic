/**
 * Real-capture fixture loader. Each fixture file is a verbatim transcript
 * of a live HTTPS response from the named provider, captured 2026-05-10
 * with the same prompt + tools[] body. The loader parses transport framing
 * (SSE `data: {...}\n\n` or NDJSON one-JSON-per-line) into a chunk array
 * the SDK normalizers can consume.
 *
 * Capture command + body recorded in:
 *   reports/sdk-capture/2026-05-10/body-aif-vertex.json
 *
 * Re-capture: see scripts in openagentic repo if drift is suspected.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Parse SSE `data: {json}\n\n` framed transcripts. Skips `[DONE]` markers. */
export function loadSseFixture(filename: string): unknown[] {
  const path = resolve(__dirname, filename);
  const text = readFileSync(path, 'utf8');
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      out.push(JSON.parse(payload));
    } catch (e) {
      throw new Error(
        `loadSseFixture(${filename}): JSON parse failed on line: ${payload.slice(0, 200)}…`,
      );
    }
  }
  return out;
}

/** Parse NDJSON (one JSON object per line) transcripts. */
export function loadNdjsonFixture(filename: string): unknown[] {
  const path = resolve(__dirname, filename);
  const text = readFileSync(path, 'utf8');
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch (e) {
      throw new Error(
        `loadNdjsonFixture(${filename}): JSON parse failed on line: ${trimmed.slice(0, 200)}…`,
      );
    }
  }
  return out;
}
