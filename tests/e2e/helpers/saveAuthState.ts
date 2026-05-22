/**
 * Save a Playwright storageState file from a JWT.
 *
 * Background: this tenant doesn't require Azure-AD MFA; the api issues
 * a JWT after the SSO callback (`POST /auth/callback`) which the UI
 * stores in `localStorage.auth_token` AND `cookie openagentic_token`.
 * Both carry the same value. As long as we can hand a fresh JWT to
 * Playwright as a storageState, every authenticated test runs without
 * walking through Microsoft's login pages.
 *
 * Usage:
 *   AUTH_JWT="eyJhbGciOi..." \
 *     npx tsx tests/e2e/helpers/saveAuthState.ts
 *
 * Or, if you want to capture from an existing browser session, paste
 * the value of `localStorage.auth_token` from the dev devtools.
 *
 * Output: writes `.auth/user.json` at the repo root.
 */

import * as fs from 'fs';
import * as path from 'path';

const ORIGIN = process.env.BASE_URL || 'http://localhost:8080';
const COOKIE_DOMAIN = new URL(ORIGIN).hostname;
const OUT_PATH = path.join(__dirname, '..', '..', '..', '.auth', 'user.json');

function decodeJwtExp(jwt: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

function main() {
  const jwt = process.env.AUTH_JWT;
  if (!jwt) {
    console.error('AUTH_JWT env var is required.');
    console.error('Get it from the dev environment devtools: localStorage.getItem("auth_token")');
    process.exit(1);
  }
  const exp = decodeJwtExp(jwt) ?? Math.floor(Date.now() / 1000) + 86400;

  const state = {
    cookies: [
      {
        name: 'openagentic_token',
        value: jwt,
        domain: COOKIE_DOMAIN,
        path: '/',
        expires: exp,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    origins: [
      {
        origin: ORIGIN,
        localStorage: [
          { name: 'auth_token', value: jwt },
        ],
      },
    ],
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(state, null, 2));
  const ageHours = Math.round((exp - Date.now() / 1000) / 36) / 100;
  console.log(`wrote ${OUT_PATH} (jwt expires in ~${ageHours}h)`);
}

main();
