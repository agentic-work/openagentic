/**
 * Phase 3.6 source-regression test — workflows-domain routes extraction.
 *
 * Asserts that after Phase 3.6:
 *  1. server.ts does NOT dynamic-import workflowRoutes from routes/workflows.js
 *  2. server.ts does NOT dynamic-import workflowApprovalRoutes from routes/workflow-approvals.js
 *  3. server.ts does NOT dynamic-import workflowMarketplaceRoutes from routes/workflow-marketplace.js
 *  4. server.ts does NOT dynamic-import orchestrateRoutes from routes/orchestrate.js
 *  5. server.ts does NOT dynamic-import userContextRoutes from routes/user-context.js
 *  6. server.ts DOES contain `register(workflowsRoutesPlugin` (call site, not bare symbol —
 *     per Phase 3.1 lesson #1: assert the call site).
 *  7. server.ts DOES import workflowsRoutesPlugin from plugins/workflows.plugin.js
 *
 * Run from any CWD; all paths resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'services/openagentic-api/src');

const serverTs = readFileSync(join(API_SRC, 'server.ts'), 'utf-8');

describe('Phase 3.6 — workflows domain dynamic imports removed from server.ts', () => {
  it('server.ts does NOT dynamic-import workflowRoutes (moved to workflows.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/workflows.js'");
    expect(serverTs).not.toContain('routes/workflows.js"');
    expect(serverTs).not.toContain("'./routes/workflows'");
    expect(serverTs).not.toContain('"./routes/workflows"');
    expect(serverTs).not.toMatch(/const\s*\{\s*workflowRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import workflowApprovalRoutes (moved to workflows.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/workflow-approvals.js'");
    expect(serverTs).not.toContain('routes/workflow-approvals.js"');
    expect(serverTs).not.toContain("'./routes/workflow-approvals'");
    expect(serverTs).not.toContain('"./routes/workflow-approvals"');
    expect(serverTs).not.toMatch(/const\s*\{\s*workflowApprovalRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import workflowMarketplaceRoutes (moved to workflows.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/workflow-marketplace.js'");
    expect(serverTs).not.toContain('routes/workflow-marketplace.js"');
    expect(serverTs).not.toContain("'./routes/workflow-marketplace'");
    expect(serverTs).not.toContain('"./routes/workflow-marketplace"');
    expect(serverTs).not.toMatch(/const\s*\{\s*workflowMarketplaceRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import orchestrateRoutes from routes/orchestrate.js (moved to workflows.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/orchestrate.js'");
    expect(serverTs).not.toContain('routes/orchestrate.js"');
    expect(serverTs).not.toContain("'./routes/orchestrate'");
    expect(serverTs).not.toContain('"./routes/orchestrate"');
    // orchestrate.ts exports default; match the destructure pattern
    expect(serverTs).not.toMatch(/\(await import\(['"]\.\/routes\/orchestrate/);
  });

  it('server.ts does NOT dynamic-import userContextRoutes from routes/user-context.js (moved to workflows.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/user-context.js'");
    expect(serverTs).not.toContain('routes/user-context.js"');
    expect(serverTs).not.toContain("'./routes/user-context'");
    expect(serverTs).not.toContain('"./routes/user-context"');
    expect(serverTs).not.toMatch(/const\s+userContextRoutes\s*=/);
  });
});

describe('Phase 3.6 — workflowsRoutesPlugin is registered in server.ts', () => {
  it('server.ts DOES contain register(workflowsRoutesPlugin (the call site, not just symbol)', () => {
    // Lock the actual register call site per Phase 3.1 lesson #1:
    // a bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(workflowsRoutesPlugin');
  });

  it('server.ts DOES import workflowsRoutesPlugin from plugins/workflows.plugin.js', () => {
    expect(serverTs).toContain('workflows.plugin');
  });
});
