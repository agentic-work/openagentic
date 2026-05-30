/**
 * Architecture gate — mcp_tools Milvus schema MUST carry the 11 deepened
 * fields and the search-embedding text MUST surface aliases / when_to_use /
 * usage_examples (2026-05-11).
 *
 * Source-regression style: greps MCPToolIndexingService.ts source string
 * so it CAN'T be ripped without explicitly editing this test. Live
 * capture (2026-05-11) proved: with the original 7-field schema, the
 * model called azure_list_subscriptions 5× expecting different results.
 *
 * Pinned changes (all in services/MCPToolIndexingService.ts):
 *   1. createCollection.fields declares: usage_examples, when_to_use,
 *      when_NOT_to_use, aliases, output_shape, cost_class,
 *      requires_capabilities, cloud_provider, service, verb, related_tools
 *   2. indexToolsInPostgres calls loadToolMetadataOverlay() +
 *      mergeOverlayWithInference() and persists the merged record.
 *   3. The search-embedding text call passes when_to_use, aliases, and
 *      usage_examples to toSearchEmbeddingText() so alias-form queries
 *      hit the right tool top-K.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEXER_SRC = path.resolve(
  __dirname,
  '..',
  '..',
  'services',
  'MCPToolIndexingService.ts',
);

const DEEPENED_SCHEMA_FIELDS = [
  'usage_examples',
  'when_to_use',
  'when_NOT_to_use',
  'aliases',
  'output_shape',
  'cost_class',
  'requires_capabilities',
  'cloud_provider',
  'service',
  'verb',
  'related_tools',
];

describe('Architecture: mcp_tools deepened schema (2026-05-11)', () => {
  it('MCPToolIndexingService source exists', () => {
    expect(fs.existsSync(INDEXER_SRC)).toBe(true);
  });

  it('createCollection schema declares all 11 deepened fields', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    for (const field of DEEPENED_SCHEMA_FIELDS) {
      // Field name must appear as a string literal AFTER the createCollection call.
      // We grep for the canonical schema-field declaration shape:
      //   `name: 'fieldname',`
      // Pure string match — no regex.
      const needle = `name: '${field}'`;
      expect(
        src.includes(needle),
        `mcp_tools deepened schema MUST declare field '${field}' (looking for \`${needle}\` in createCollection)`,
      ).toBe(true);
    }
  });

  it('indexToolsInPostgres pulls overlay + inference and persists merged metadata', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    // The merged-overlay path must be wired.
    expect(
      src.includes('loadToolMetadataOverlay'),
      `MCPToolIndexingService MUST call loadToolMetadataOverlay() to pull hand-curated overlay`,
    ).toBe(true);
    expect(
      src.includes('mergeOverlayWithInference'),
      `MCPToolIndexingService MUST call mergeOverlayWithInference() to combine overlay + name inference`,
    ).toBe(true);
    // The persistedMetadata block must carry the deepened fields.
    for (const field of DEEPENED_SCHEMA_FIELDS) {
      expect(
        src.includes(`${field}:`),
        `Persisted metadata block MUST persist '${field}' (e.g. \`${field}: merged.${field}\`)`,
      ).toBe(true);
    }
  });

  it('search-embedding text call passes when_to_use, aliases, and usage_examples', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    // The deep-field args MUST appear in the toSearchEmbeddingText call.
    expect(
      src.includes('when_to_use: merged.when_to_use'),
      `toSearchEmbeddingText() call MUST include when_to_use field`,
    ).toBe(true);
    expect(
      src.includes('aliases: merged.aliases'),
      `toSearchEmbeddingText() call MUST include aliases field`,
    ).toBe(true);
    expect(
      src.includes('usage_examples: merged.usage_examples'),
      `toSearchEmbeddingText() call MUST include usage_examples field`,
    ).toBe(true);
  });

  it('ToolMetadataOverlay JSON exists with ≥20 hand-curated tools', () => {
    const overlayPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'data',
      'tool-metadata-overlay.json',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);
    const json = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    expect(json.tools).toBeDefined();
    expect(Object.keys(json.tools).length).toBeGreaterThanOrEqual(20);
  });
});
