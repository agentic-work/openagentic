/**
 * Source-regression test — unawaited reply.send() in preHandler middleware.
 *
 * Fastify v5: a bare `reply.code(N).send(...)` in an async preHandler without
 * `await` does NOT stop the lifecycle. The main handler still runs and
 * double-sends, triggering ERR_HTTP_HEADERS_SENT.
 *
 * Fix: every `reply.code(N).send(...)` and `reply.status(N).send(...)` call
 * inside a preHandler / auth hook MUST be preceded by `await`.
 *
 * This test reads EVERY middleware file in src/middleware as text and
 * asserts zero unawaited occurrences (the file list is scanned dynamically
 * so a renamed/added middleware can never silently escape the guard).
 *
 * Run from any CWD; paths are resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
const REPO_ROOT = resolve(__dirname, '../../../../..');
const MIDDLEWARE_DIR = join(REPO_ROOT, 'services/openagentic-api/src/middleware');

// Scan EVERY middleware file dynamically rather than a hardcoded list — a stale
// list silently rots (a renamed/removed file either ENOENT-fails the test or, worse,
// stops being scanned) and a newly-added middleware would escape the guard entirely.
const FILES = readdirSync(MIDDLEWARE_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
  .sort();

/**
 * Detect violations: `reply.code(N).send(...)` or `reply.status(N).send(...)`
 * that is NOT immediately preceded by `await `.
 *
 * The lookbehind `(?<!await )` checks for the 6 characters immediately before
 * `reply.`. Because we process line-by-line, multi-line call sites that
 * are split across lines are naturally free of the `await ` prefix on the
 * continuation line — but the opening line (which has `reply.code(`) will
 * be flagged unless it has `await `.
 *
 * We also exclude `return reply.code/status(N).send(...)` — those are
 * Form-B pre-states that are also violations because `return reply.send()`
 * in Fastify v5 re-queues the return value as a second send body.
 * Returning the `reply` object is treated as a second payload.
 */
const VIOLATION_PATTERN = /(?<!await )reply\.(code|status)\(\d+\)\.send\(/g;

function findViolations(source: string, filename: string): string[] {
  const violations: string[] = [];
  const lines = source.split('\n');

  lines.forEach((line, idx) => {
    // Reset lastIndex since we're reusing the regex object across calls
    const re = new RegExp(VIOLATION_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      violations.push(
        `${filename}:${idx + 1}: ${line.trim()}`
      );
    }
  });

  return violations;
}

describe('middleware — no unawaited reply.send() in preHandler sites', () => {
  for (const filename of FILES) {
    it(`${filename} has zero unawaited reply.code/status(N).send() calls`, () => {
      const source = readFileSync(join(MIDDLEWARE_DIR, filename), 'utf-8');
      const violations = findViolations(source, filename);

      const report = violations.length > 0
        ? `\nFound ${violations.length} unawaited reply.send() call(s) in ${filename}:\n` +
          violations.join('\n') + '\n' +
          'Fix: prepend `await` before each call, or split `return reply.send()` ' +
          'into `await reply.send(); return;`.'
        : '';

      expect(violations, report).toHaveLength(0);
    });
  }
});
