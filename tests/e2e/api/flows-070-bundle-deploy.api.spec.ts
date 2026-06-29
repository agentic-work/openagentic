/**
 * Playwright API spec — verifies the 0.7.0 deploy WITHOUT auth.
 *
 * No MFA required. Hits the dev environment's nginx, parses the index HTML to
 * find the entry-bundle hash, fetches the bundle, asserts the
 * marquee strings that prove our toast + NavRail + per-slot picker
 * are in the served code.
 *
 * What this DOES prove:
 *   - the right image is rolled (matches the hashed bundle name)
 *   - the user-visible strings ('Multi-agent swarm popover', 'agent
 *     default', '0.7.0-r2', etc.) are in the bytes nginx serves
 *
 * What this does NOT prove:
 *   - that the toast actually renders for a logged-in user clicking
 *     the Flows tab inside ChatContainer. That requires .auth/user.json
 *     populated via:  npx playwright test --project=auth-setup
 */

import { test, expect, request } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://chat.example.com';

test.describe('0.7.0 deploy — bundle string proof (no auth)', () => {
  test.setTimeout(30_000);

  test('main bundle ships the marquee 0.7.0 strings', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });

    // 1. Pull the SPA shell, find the entry script src.
    const indexResp = await ctx.get(`${BASE}/`);
    expect(indexResp.ok()).toBeTruthy();
    const html = await indexResp.text();
    const entryMatch = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    expect(entryMatch, 'no entry index-*.js script found in HTML').not.toBeNull();
    const entryName = entryMatch![1];

    // 2. Fetch the entry chunk.
    const entryResp = await ctx.get(`${BASE}/assets/${entryName}`);
    expect(entryResp.ok()).toBeTruthy();
    const entry = await entryResp.text();

    // 3. The entry chunk is just a deps map + bootstrap; the toast
    //    code lives in a feature chunk. Search every JS chunk for
    //    our distinctive strings.
    const chunkNames = Array.from(html.matchAll(/\/assets\/([A-Za-z0-9_-]+\.js)/g)).map((m) => m[1]);
    chunkNames.push(entryName); // include entry itself
    const allChunks = Array.from(new Set(chunkNames));

    const chunkBodies = await Promise.all(
      allChunks.map(async (name) => {
        const r = await ctx.get(`${BASE}/assets/${name}`);
        return r.ok() ? await r.text() : '';
      }),
    );
    const corpus = chunkBodies.join('\n');

    // Marquee strings — at least 5 of these MUST appear somewhere in
    // the served JS for the deploy to be considered live.
    const required = [
      '0.7.0-r2',                       // toast version key
      'Multi-agent swarm popover',      // toast feature label
      'whatsNew.dismissed',             // toast storage key
      'agent default',                  // per-slot model picker default option
      'swarm-pulse',                    // multi-agent swarm popover keyframe
      'Workspace sections',             // nav-rail aria-label
      'M3 10.5L12 3l9 7.5V20',          // inlined home-icon path (no sprite)
      'leftOffsetPx',                   // ChatSidebar prop that lets the rail sit LEFT of the sidebar
      'openagentic-admin:navigate',     // nav-rail dispatch target (replaces broken /admin?p=… URL nav)
    ];
    const missing = required.filter((s) => !corpus.includes(s));
    expect(missing, `marquee 0.7.0 strings missing from served bundle: ${missing.join(', ')}`).toEqual([]);

    // Negative assertion — the old SVG-sprite indirection was 404'ing icons,
    // so the bundle must NOT reference the dead WorkspaceIconSprite or
    // <use href="#i-..."> pattern anywhere. Same goes for the broken
    // /admin?p=... URL navigation that returned the SPA's NotFound page;
    // nav-rail clicks now go through the in-process `openagentic-admin:
    // navigate` CustomEvent.
    const forbidden = [
      'WorkspaceIconSprite',
      '"#i-home"',
      '"#i-flows"',
      '"#i-settings"',
      '/admin?p=agent-registry', // dead nav-rail target → 404
      '/admin?p=overview',       // dead nav-rail target → 404
    ];
    const present = forbidden.filter((s) => corpus.includes(s));
    expect(present, `dead nav-rail sprite references still present in served bundle: ${present.join(', ')}`).toEqual([]);
    void entry; // silence unused-var lint
  });

  test('/workflows direct URL renders the SPA shell only — Flows is sidebar-only entry', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.get(`${BASE}/workflows`);
    // SPA always returns 200 because nginx serves the same index.html
    // for every route. The 404 happens client-side via React Router.
    expect(r.ok()).toBeTruthy();
    const html = await r.text();
    // Sanity: the title is the platform shell.
    expect(html).toMatch(/<title>[^<]*Openagentic/i);
  });
});
