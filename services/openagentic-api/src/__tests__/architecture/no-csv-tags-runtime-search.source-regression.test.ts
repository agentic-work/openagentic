/**
 * Architecture gate — production code MUST NOT do CSV string-split lookup
 * on the legacy `tags` field of mcp_tools for filtering decisions (#766).
 *
 * The legacy `tags` field is CSV; it remains in the Milvus schema for
 * backward-compat, but the new design says: when production wants to
 * filter mcp_tools by tag, it MUST query the tool_tags collection (with
 * tag_name + tag_category as separately-indexed dimensions), not
 * string-split the CSV tags column on mcp_tools.
 *
 * Test rule: forbid `.tags.split(` and `'tags'.split(` AND any
 * call shape that string-splits a tags field from production code outside
 * of the indexer's own population path (which legitimately splits its own
 * inputs).
 *
 * Whitelisted callers (legitimate uses of tags CSV — population, NOT search):
 *   - utils/toolTagExtractor.ts        (generates the CSV in the first place)
 *   - services/MCPToolIndexingService.ts (writes CSV into the legacy field)
 *   - test files                        (assertion / scaffolding only)
 *
 * Forbidden surfaces:
 *   - any cascade / ranker / search / chat-loop code that reads .tags and
 *     splits it to drive filter decisions
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICES_DIR = path.resolve(__dirname, '..', '..', 'services');
const ROUTES_DIR = path.resolve(__dirname, '..', '..', 'routes');

// Files allowed to do `.tags.split(...)` because they populate the CSV
// or are test scaffolding. (No regex — pure suffix / prefix matching.)
const WHITELIST_BASENAMES = [
  'toolTagExtractor.ts',
  'MCPToolIndexingService.ts',
  'ToolSemanticCacheService.ts', // legacy CSV path (being deprecated)
];

function isWhitelisted(filePath: string): boolean {
  const base = path.basename(filePath);
  if (WHITELIST_BASENAMES.includes(base)) return true;
  // Test files anywhere are allowed (assertion / scaffolding).
  if (filePath.includes('__tests__')) return true;
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) return true;
  if (filePath.endsWith('.spec.ts') || filePath.endsWith('.spec.tsx')) return true;
  return false;
}

function walkTs(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkTs(fp, out);
    } else if (e.isFile() && fp.endsWith('.ts')) {
      out.push(fp);
    }
  }
}

describe('Architecture: no CSV-tags runtime search (2026-05-11, #766)', () => {
  it('production code MUST NOT string-split the legacy tags CSV for filter decisions', () => {
    const files: string[] = [];
    walkTs(SERVICES_DIR, files);
    walkTs(ROUTES_DIR, files);

    const violations: string[] = [];
    // Pure string matching — no regex. We look for the exact shape that
    // performs CSV split on a tags field for filter / search logic.
    const FORBIDDEN_PATTERNS = [
      '.tags.split(',
      "'tags'.split(",
      '"tags".split(',
      '.tags?.split(',
    ];

    for (const fp of files) {
      if (isWhitelisted(fp)) continue;
      const src = fs.readFileSync(fp, 'utf8');
      for (const pat of FORBIDDEN_PATTERNS) {
        if (src.includes(pat)) {
          violations.push(`${fp} — uses forbidden pattern \`${pat}\``);
        }
      }
    }

    expect(
      violations.length === 0,
      `Production code MUST NOT string-split mcp_tools.tags CSV for filter decisions. Use tool_tags collection (tag_name + tag_category indexed) instead. Violations:\n${violations.join('\n')}`,
    ).toBe(true);
  });
});
