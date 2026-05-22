/**
 * Phase 0 source-regression test — dead-code sweep.
 *
 * Asserts that the 4 confirmed-orphan route files have been deleted AND
 * that the module-scope dead declarations + disabled securityPlugin block
 * have been removed from server.ts.
 *
 * ANTI-CLEANUP LOCK: utils/bm25.ts MUST remain — it is intentional Phase-3
 * scaffolding for the future no-embedding-model fallback for MCP tool search.
 * Do NOT delete it even though it currently has zero importers.
 *
 * Run from repo root or from services/openagentic-api — paths are resolved
 * relative to this file's __dirname so both CWDs work.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// Resolve the repo root from this file's location:
// __dirname = services/openagentic-api/src/__tests__
// ../../../.. = repo root
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const API_SRC = path.join(REPO_ROOT, 'services/openagentic-api/src');

function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

const serverTs = readFileSync(path.join(API_SRC, 'server.ts'), 'utf-8');

describe('Phase 0 — orphan route files deleted', () => {
  it('mcp-tools-proxy.ts is gone (retired MCP Orchestrator)', () => {
    expect(existsSync(repoPath('services/openagentic-api/src/routes/mcp-tools-proxy.ts'))).toBe(false);
  });

  it('admin-mcp-management.ts is gone (dup of routes/admin/mcp-management.ts)', () => {
    expect(existsSync(repoPath('services/openagentic-api/src/routes/admin-mcp-management.ts'))).toBe(false);
  });

  it('knowledge.ts is gone (legacy KB superseded by SharedKBService)', () => {
    expect(existsSync(repoPath('services/openagentic-api/src/routes/knowledge.ts'))).toBe(false);
  });

  it('metrics.ts is gone (orphan, root cause of stale comment at line ~1748)', () => {
    expect(existsSync(repoPath('services/openagentic-api/src/routes/metrics.ts'))).toBe(false);
  });
});

describe('Phase 0 — dead code removed from server.ts', () => {
  it('does not import securityPlugin (import + disabled register block deleted)', () => {
    expect(serverTs.includes('securityPlugin')).toBe(false);
  });

  // NOTE: The Phase-0 plan originally intended to delete 4 module-scope `let`
  // declarations (milvusClient, ragService, toolSemanticCacheInitialized,
  // repositoryContainer) on the theory they were "unused".  A tsc audit revealed
  // all four ARE assigned and read inside start()-body function closures, so
  // deleting them causes TS2304/TS2552 errors throughout server.ts.
  // They have been LEFT IN PLACE.  A follow-up plan item (Phase 1 / AppContext
  // refactor) should migrate them into a typed context object.
  // No assertions here for those four declarations — they legitimately exist.
});

describe('Phase 0 — anti-cleanup lock (must NEVER be deleted)', () => {
  it('utils/bm25.ts still exists — intentional Phase-3 scaffold for no-embedding-model fallback', () => {
    // bm25.ts has zero importers today but is reserved for the future MCP tool search
    // fallback path when no embedding model is available. Do NOT remove it as part of
    // dead-code sweeps. This assertion is here to catch accidental deletion.
    expect(existsSync(repoPath('services/openagentic-api/src/utils/bm25.ts'))).toBe(true);
  });
});
