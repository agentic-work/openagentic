import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #853 — Authentication hooks MUST be wired on `onRequest`, never `preHandler`.
 *
 * Fastify hook order: onRequest → preParsing → preValidation → preHandler → handler.
 * Schema validation runs in `preValidation`, which is BEFORE `preHandler`.
 *
 * Live smoking gun (2026-05-15):
 *   POST /api/chat/stream with no auth + malformed body returned `FST_ERR_VALIDATION` (500)
 *   instead of 401 — the schema validator was firing before auth, leaking required body
 *   shape to anonymous probes.
 *
 * Allowed forms:
 *   onRequest: authMiddleware
 *   onRequest: [authMiddleware, adminMiddleware]
 *
 * Forbidden forms:
 *   preHandler: authMiddleware
 *   preHandler: adminMiddleware
 *   preHandler: adminAuth   (aliased to requireAdminFastify)
 *   preHandler: [authMiddleware ...]
 *   preHandler: [adminMiddleware ...]
 *   preHandler: [adminAuth ...]
 */
const SRC_ROOT = join(__dirname, '..', '..');
const FORBIDDEN_PATTERNS = [
  /preHandler:\s*authMiddleware\b/,
  /preHandler:\s*adminMiddleware\b/,
  /preHandler:\s*adminAuth\b/,
  /preHandler:\s*\[\s*(authMiddleware|adminMiddleware|adminAuth)\b/,
];

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) listTsFiles(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

describe('#853 auth hook must fire before schema validation', () => {
  it('no source file wires authMiddleware / adminMiddleware / adminAuth on preHandler', () => {
    const violations: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(line)) {
            violations.push(`${file.replace(SRC_ROOT + '/', '')}:${i + 1}  ${trimmed}`);
            break;
          }
        }
      }
    }
    expect(violations, `auth hooks on preHandler (move to onRequest):\n${violations.join('\n')}`).toEqual([]);
  });
});
