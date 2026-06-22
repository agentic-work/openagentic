/**
 * V1.1 flow_tool agent-catalog wiring — source-regression guard.
 *
 * Pins the two routes openagentic-proxy depends on for dynamic-tool injection:
 *   GET /api/workflows/:id/as-tool-schema
 *   GET /api/workflows/agent-tools
 *
 * If either route is renamed or dropped, openagentic-proxy silently stops
 * injecting saved-flow tools — agents lose access to user-saved flows
 * with zero visible error. Catch the rename here, not in production.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

describe('V1.1 flow_tool routes are wired in workflows.ts', () => {
  const workflowsRoutes = readFileSync(
    join(REPO_ROOT, 'services/openagentic-api/src/routes/workflows.ts'),
    'utf8',
  );

  it('registers GET /:id/as-tool-schema', () => {
    expect(workflowsRoutes).toMatch(/['"`]\/:id\/as-tool-schema['"`]/);
  });

  it('registers GET /agent-tools', () => {
    expect(workflowsRoutes).toMatch(/['"`]\/agent-tools['"`]/);
  });

  it('imports deriveFlowToolSchema from the shared workflow-engine', () => {
    expect(workflowsRoutes).toMatch(
      /import\s*\{\s*deriveFlowToolSchema\s*\}\s*from\s*['"]@openagentic\/workflow-engine['"]/,
    );
  });

  it('filters agent-tools listing by the `agent-tool` tag (opt-in only)', () => {
    expect(workflowsRoutes).toMatch(/tags:\s*\{\s*has:\s*['"]agent-tool['"]\s*\}/);
  });
});
