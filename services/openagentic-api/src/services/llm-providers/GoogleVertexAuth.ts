/**
 * Canonical auth-options builder for every `new GoogleAuth(...)` call
 * inside GoogleVertexProvider.
 *
 * Problem this exists to solve: `google-auth-library` does NOT read
 * GOOGLE_APPLICATION_CREDENTIALS_JSON on its own — that variable is an
 * OpenAgentic convention set by GoogleVertexProvider.initialize() from
 * the DB-stored service account (llm_providers.auth_config.credentials).
 * If you construct `new GoogleAuth({ scopes })` with no credentials,
 * google-auth-library falls through to Application Default Credentials,
 * which aren't available on k3s-local / most non-GCP deploys →
 *   "Could not load the default credentials. Browse to
 *    https://cloud.google.com/docs/authentication/getting-started"
 *
 * Every GoogleAuth construction in this provider must route through
 * buildVertexAuthOptions() so the DB-seeded service account reliably
 * reaches the library.
 */

export const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export interface VertexAuthOptions {
  scopes: string[];
  /**
   * Parsed service account credentials. Shaped to match what
   * google-auth-library's GoogleAuthOptions.credentials expects
   * (client_email + private_key at minimum).
   */
  credentials?: {
    client_email?: string;
    private_key?: string;
    [k: string]: unknown;
  };
}

/**
 * Build GoogleAuth options from the ambient env. Does NOT throw — if
 * credentials are missing or malformed, falls back to scope-only, so
 * google-auth-library can still try GCE metadata / workload identity
 * on a real GCP node.
 */
export function buildVertexAuthOptions(): VertexAuthOptions {
  const opts: VertexAuthOptions = { scopes: [VERTEX_SCOPE] };
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) return opts;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      opts.credentials = parsed;
    }
  } catch {
    // Invalid JSON → silently fall through to ADC. Logging is the caller's
    // responsibility since it may want to surface the error conditionally.
  }

  return opts;
}
