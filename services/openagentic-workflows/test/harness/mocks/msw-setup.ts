/**
 * MSW node server for the Flows test harness.
 *
 * Vitest setupFile pattern: every harness test file gets this for free via
 * `vitest.harness.config.ts`. The server intercepts all HTTP requests
 * (axios uses node:http under the hood, which msw/node patches), so node
 * primitive tests can assert against deterministic responses without
 * touching the real internet.
 *
 * Per-test overrides:
 *   import { harnessServer } from '../mocks/msw-setup';
 *   harnessServer.use(http.get('https://...', () => HttpResponse.json({ ok: true })));
 *
 * Overrides are auto-reset after each test by the afterEach hook below.
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

import { defaultHandlers } from './handlers/default.js';

export const harnessServer = setupServer(...defaultHandlers);

// `warn` (vs `error`) so a test that forgot to register a handler gets a
// clear console warning rather than a cryptic ECONNREFUSED.
beforeAll(() => harnessServer.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => harnessServer.resetHandlers());
afterAll(() => harnessServer.close());
