/**
 * data_source probeNow opt-in — wire-up guard.
 *
 * Pins the explicit-opt-in surface for auto schema probing on create/update.
 * Default behavior unchanged: probe MUST be triggered by the caller.
 *
 * Why opt-in only:
 *   - Auto-firing probe on every CRUD has perf implications (network call,
 *     credential resolution).
 *   - DataSource configs can point at internal hosts; silent fire-on-create
 *     would let any caller scan internal infra.
 *
 * Surface pinned:
 *   1. DataSourceService.create / update accept an optional `probeNow` flag.
 *   2. When `probeNow === true`, the service awaits probeSchema after
 *      persisting the row.
 *   3. The POST /data-sources and PUT /data-sources/:id route handlers
 *      forward body.probeNow through to the service.
 *   4. The flag is NEVER true by default.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SERVICE = join(
  REPO_ROOT,
  'services/openagentic-api/src/services/DataSourceService.ts',
);
const ROUTES = join(
  REPO_ROOT,
  'services/openagentic-api/src/routes/data-sources.ts',
);

describe('data_source probeNow opt-in — wire-up', () => {
  const service = readFileSync(SERVICE, 'utf8');
  const routes = readFileSync(ROUTES, 'utf8');

  it('DataSourceService.create accepts probeNow option', () => {
    expect(service).toMatch(/probeNow\??:\s*boolean/);
  });

  it('DataSourceService gates probeSchema on probeNow === true', () => {
    expect(service).toMatch(/probeNow\s*===?\s*true|opts\?\.probeNow|input\.probeNow/);
    // Self-call to probeSchema after create/update — auto-probe path
    expect(service.match(/this\.probeSchema\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('POST /data-sources forwards body.probeNow to service.create', () => {
    expect(routes).toMatch(/probeNow:\s*body\.probeNow|body\.probeNow/);
  });

  it('PUT /data-sources/:id forwards body.probeNow to service.update', () => {
    // Both create and update should reference the field — count occurrences
    // in the route file to confirm both call sites pass it through.
    expect(routes.match(/probeNow/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('probeNow defaults to false / undefined in the route layer (no hardcoded true)', () => {
    // Catches accidental "always probe" regression: there must be no
    // `probeNow: true` literal in routes — it must come from the body.
    expect(routes).not.toMatch(/probeNow:\s*true/);
  });
});
