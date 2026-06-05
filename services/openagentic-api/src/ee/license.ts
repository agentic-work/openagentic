/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  OpenAgentic Enterprise — License verifier
 *  Copyright © Agenticwork™ LLC. All rights reserved.
 *
 *  This file is part of the OpenAgentic ENTERPRISE Software and is licensed ONLY
 *  under the OpenAgentic Enterprise License (/ee/LICENSE), NOT the repository's
 *  Apache-2.0 license. A paid subscription from Agenticwork LLC is required to use
 *  the Enterprise features in production. Reading this source grants no license.
 *  Removing or circumventing this gate is a breach of /ee/LICENSE §4 and unlawful.
 *  Licensing: licensing@agenticwork.io
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Offline, signature-only verification — NO phone-home, no network call.
 *
 *  A license key is `<base64url(payloadJSON)>.<base64url(ed25519-signature)>` where
 *  the signature is over the raw payload JSON bytes. Only the holder of the private
 *  signing key (Agenticwork LLC — never in this repo) can mint a valid key. This
 *  module ships ONLY the public key, so it can verify but cannot mint.
 *
 *  payload = { sub: string, tier: string, features: string[], iat: number,
 *              exp?: number, jti?: string }
 */
import crypto from 'node:crypto';

// Agenticwork LLC license-signing PUBLIC key (Ed25519, SPKI/PEM). Verify-only.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAlmhLMlikWrokfJgw/k+k0dPKcGvMoLGeUGjMTKkkfDg=
-----END PUBLIC KEY-----`;

export interface LicenseInfo {
  valid: boolean;
  /** licensee / customer */
  sub?: string;
  tier?: string;
  /** entitled feature keys, e.g. ["runtime-idp"] or ["*"] */
  features: string[];
  exp?: number;
  /** why it's invalid (when valid === false) */
  reason?: string;
}

const INVALID = (reason: string, extra: Partial<LicenseInfo> = {}): LicenseInfo => ({
  valid: false,
  features: [],
  reason,
  ...extra,
});

let cache: { token: string; info: LicenseInfo } | null = null;

function verifyToken(token: string): LicenseInfo {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return INVALID('malformed');
  let payloadBytes: Buffer;
  let sig: Buffer;
  try {
    payloadBytes = Buffer.from(parts[0], 'base64url');
    sig = Buffer.from(parts[1], 'base64url');
  } catch {
    return INVALID('malformed');
  }
  let ok = false;
  try {
    // Ed25519 → algorithm MUST be null (the key encodes the curve).
    ok = crypto.verify(null, payloadBytes, LICENSE_PUBLIC_KEY, sig);
  } catch {
    return INVALID('verify_error');
  }
  if (!ok) return INVALID('bad_signature');
  let payload: any;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return INVALID('bad_payload');
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now > payload.exp) {
    return INVALID('expired', { exp: payload.exp, sub: payload.sub });
  }
  return {
    valid: true,
    sub: payload.sub,
    tier: payload.tier,
    features: Array.isArray(payload.features) ? payload.features : [],
    exp: payload.exp,
  };
}

/**
 * Resolve + verify the current license from OPENAGENTIC_LICENSE_KEY (cached per token).
 * Returns an invalid LicenseInfo (never throws) when absent/bad/expired.
 */
export function getLicenseInfo(): LicenseInfo {
  const token = process.env.OPENAGENTIC_LICENSE_KEY?.trim();
  if (!token) return INVALID('no_license');
  if (cache && cache.token === token) return cache.info;
  const info = verifyToken(token);
  cache = { token, info };
  return info;
}

/** True iff a valid, unexpired license entitles `feature` (or carries the `*` wildcard). */
export function isEnterpriseFeatureLicensed(feature: string): boolean {
  const info = getLicenseInfo();
  return info.valid && (info.features.includes('*') || info.features.includes(feature));
}

/** The feature key for the runtime Identity Directory (SSO) registry. */
export const FEATURE_RUNTIME_IDP = 'runtime-idp';

/** Test seam — clears the memoized license (e.g. after changing the env in a test). */
export function __resetLicenseCacheForTest(): void {
  cache = null;
}
