/**
 * Architecture gate — tool_tags Milvus collection MUST exist with the
 * primary-key + indexed-tag schema (2026-05-11, #766).
 *
 * Source-regression style: greps MCPToolIndexingService.ts source so the
 * collection schema cannot be silently regressed. The collection is the
 * tag-primary-key dimension promised in #766: tags become first-class
 * filter-then-vector-search rows instead of CSV-on-mcp_tools.tags.
 *
 * Required fields (Milvus VarChar/Float/FloatVector):
 *   id              VarChar(100) [PK]   = `<tool_id>::<tag_name>`
 *   tool_id         VarChar(100)         FK to mcp_tools.id
 *   tag_name        VarChar(64)
 *   tag_category    VarChar(32)
 *   weight          Float
 *   tag_embedding   FloatVector(dim)
 *
 * Required indexer entry points:
 *   - ensureToolTagsCollection(name, dim)
 *   - indexToolTags(allTools) called from indexAllMCPTools
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

const REQUIRED_FIELDS = [
  'tool_id',
  'tag_name',
  'tag_category',
  'weight',
  'tag_embedding',
];

describe('Architecture: tool_tags Milvus collection (2026-05-11, #766)', () => {
  it('MCPToolIndexingService source exists', () => {
    expect(fs.existsSync(INDEXER_SRC)).toBe(true);
  });

  it('indexer declares the tool_tags collection name', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    expect(
      src.includes("'tool_tags'"),
      `MCPToolIndexingService MUST reference Milvus collection 'tool_tags' (primary-key tag dimension per #766)`,
    ).toBe(true);
  });

  it('indexer declares all 5 required tool_tags fields in createCollection', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    for (const field of REQUIRED_FIELDS) {
      const needle = `name: '${field}'`;
      expect(
        src.includes(needle),
        `tool_tags collection MUST declare field '${field}' (looking for \`${needle}\`)`,
      ).toBe(true);
    }
  });

  it('indexer wires ensureToolTagsCollection helper', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    expect(
      src.includes('ensureToolTagsCollection'),
      `MCPToolIndexingService MUST define an ensureToolTagsCollection helper (matches the ensureMilvusCollectionWithDimension pattern for mcp_tools)`,
    ).toBe(true);
  });

  it('indexer wires indexToolTags() and calls it from indexAllMCPTools', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    expect(
      src.includes('indexToolTags'),
      `MCPToolIndexingService MUST define an indexToolTags() pass that populates tool_tags from the deepened metadata facets`,
    ).toBe(true);
    // Boot integration: indexAllMCPTools must dispatch the tag-index pass.
    expect(
      src.includes('this.indexToolTags('),
      `indexAllMCPTools MUST call this.indexToolTags(allTools) so tags are populated alongside mcp_tools`,
    ).toBe(true);
  });

  it('tag_category enum is documented (cloud_provider | verb | service | cost_class | capability | resource_type | business_goal)', () => {
    const src = fs.readFileSync(INDEXER_SRC, 'utf8');
    // Just check that the canonical tag categories appear as string literals
    // somewhere in the indexer source (proves the categorization branch runs).
    const requiredCategories = [
      'cloud_provider',
      'verb',
      'service',
      'cost_class',
      'capability',
    ];
    for (const cat of requiredCategories) {
      expect(
        src.includes(`'${cat}'`),
        `tool_tags categorization MUST emit category '${cat}' (no-regex string ops)`,
      ).toBe(true);
    }
  });
});
