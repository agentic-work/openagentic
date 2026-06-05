#!/usr/bin/env node
/**
 * Mint an OpenAgentic Enterprise license key. Agenticwork LLC internal tool.
 *
 * Requires the PRIVATE Ed25519 signing key, which is NEVER committed to this repo
 * (it lives only on Agenticwork's machines). Without it, no valid key can be made —
 * the shipped app holds only the public key (verify-only). This is what makes a
 * license "a key only Agenticwork can generate."
 *
 * Usage:
 *   node ee/tools/mint-license.mjs \
 *     --customer "Acme Corp" \
 *     --features runtime-idp \
 *     --tier enterprise \
 *     --expires 2027-01-01 \
 *     --key ~/.config/openagentic-license/signing-key.pem
 *
 * Prints the license key to stdout. Give it to the customer; they set it as the
 * OPENAGENTIC_LICENSE_KEY environment variable on the API.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const customer = arg('customer');
if (!customer) {
  console.error('error: --customer is required');
  process.exit(1);
}
const tier = arg('tier', 'enterprise');
const features = arg('features', 'runtime-idp')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const expiresArg = arg('expires'); // YYYY-MM-DD, optional (omit = perpetual)
const keyPath = arg('key', '~/.config/openagentic-license/signing-key.pem').replace(
  /^~/,
  os.homedir(),
);

let privateKeyPem;
try {
  privateKeyPem = fs.readFileSync(keyPath, 'utf8');
} catch {
  console.error(`error: cannot read private signing key at ${keyPath}`);
  process.exit(1);
}

const nowSec = Math.floor(Date.now() / 1000);
const payload = {
  sub: customer,
  tier,
  features,
  iat: nowSec,
  jti: crypto.randomUUID(),
};
if (expiresArg) {
  const exp = Math.floor(new Date(`${expiresArg}T23:59:59Z`).getTime() / 1000);
  if (!Number.isFinite(exp)) {
    console.error('error: --expires must be YYYY-MM-DD');
    process.exit(1);
  }
  payload.exp = exp;
}

const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
const signature = crypto.sign(null, payloadBytes, privateKeyPem); // Ed25519
const token = `${payloadBytes.toString('base64url')}.${signature.toString('base64url')}`;

console.error(
  `minted: sub="${customer}" tier=${tier} features=[${features.join(',')}]` +
    `${payload.exp ? ` exp=${expiresArg}` : ' (perpetual)'}`,
);
console.log(token);
