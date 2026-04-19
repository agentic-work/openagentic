/**
 * Synth capability → env-var credential map (task #95)
 *
 * Synth-executor already accepts an arbitrary `credentials: Record<string,string>`
 * which it injects as env vars into the subprocess sandbox. This file is the
 * agreed contract between:
 *   - Admin "Link Integration" flow (stores user's SaaS creds in Vault)
 *   - CredentialScopeService  (fetches the right subset per synth call)
 *   - SynthService             (calls SynthExecutorClient with the map)
 *
 * Adding a capability: add an entry to `SYNTH_CAP_ENV_SPEC`, document the
 * canonical env-var names each cap's SDK reads, and bump the version on the
 * Vault ExternalSecret template so existing tokens are re-wrapped.
 *
 * See ADR-013 for the end-to-end design.
 */

/** A single env var that a capability needs. */
export interface CapEnvVar {
  /** Env var name read by the capability's SDK inside the sandbox. */
  envName: string;
  /** Human label for the admin UI. */
  label: string;
  /** Whether this env var is required for the cap to work. */
  required: boolean;
  /** Short hint shown to the admin linking the integration. */
  hint?: string;
  /** If true, value is secret (never log, never return to UI after write). */
  secret: boolean;
}

/** A capability's full credential spec. */
export interface SynthCapSpec {
  /** Capability slug — matches the executor's `capabilities: string[]` entry. */
  cap: string;
  /** Human display name (admin UI, audit log). */
  displayName: string;
  /** Integration vendor/provider category. */
  vendor: 'stripe' | 'notion' | 'linear' | 'atlassian' | 'kubernetes'
         | 'browser' | 'email' | 'vector' | 'postgres' | 'sentry'
         | 'github' | 'aws' | 'azure' | 'gcp';
  /** Env vars that get injected when this cap is enabled for the call. */
  envVars: CapEnvVar[];
  /** Docs URL for operators. */
  docsUrl?: string;
}

// -----------------------------------------------------------------------------
// Spec table — single source of truth for cap → env wiring.
// -----------------------------------------------------------------------------

export const SYNTH_CAP_ENV_SPEC: SynthCapSpec[] = [
  {
    cap: 'stripe',
    displayName: 'Stripe',
    vendor: 'stripe',
    envVars: [
      { envName: 'STRIPE_API_KEY', label: 'API key (sk_live_… or sk_test_…)', required: true, secret: true, hint: 'From Stripe dashboard → Developers → API keys' },
    ],
    docsUrl: 'https://stripe.com/docs/keys',
  },
  {
    cap: 'notion',
    displayName: 'Notion',
    vendor: 'notion',
    envVars: [
      { envName: 'NOTION_API_KEY', label: 'Internal integration token (ntn_…)', required: true, secret: true, hint: 'Create an internal integration in Notion' },
    ],
    docsUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
  },
  {
    cap: 'linear',
    displayName: 'Linear',
    vendor: 'linear',
    envVars: [
      { envName: 'LINEAR_API_KEY', label: 'Personal API key (lin_api_…)', required: true, secret: true, hint: 'Linear → Settings → API' },
    ],
    docsUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api',
  },
  {
    cap: 'atlassian',
    displayName: 'Atlassian (Jira + Confluence)',
    vendor: 'atlassian',
    envVars: [
      { envName: 'ATLASSIAN_EMAIL',   label: 'Atlassian account email', required: true, secret: false },
      { envName: 'ATLASSIAN_API_TOKEN', label: 'API token',              required: true, secret: true, hint: 'id.atlassian.com → Security → API tokens' },
      { envName: 'ATLASSIAN_DOMAIN',  label: 'Site domain (e.g. yourco.atlassian.net)', required: true, secret: false },
    ],
    docsUrl: 'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/',
  },
  {
    cap: 'kubernetes',
    displayName: 'Kubernetes',
    vendor: 'kubernetes',
    envVars: [
      { envName: 'KUBECONFIG_B64',   label: 'Base64-encoded kubeconfig', required: true, secret: true, hint: 'base64 < ~/.kube/config' },
    ],
    docsUrl: 'https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/',
  },
  {
    cap: 'browser',
    displayName: 'Browser automation',
    vendor: 'browser',
    envVars: [
      { envName: 'BROWSER_WS_ENDPOINT', label: 'Remote-browser WebSocket URL', required: false, secret: true, hint: 'Optional — uses sandbox-local Chromium if omitted' },
    ],
  },
  {
    cap: 'email',
    displayName: 'Email (SMTP)',
    vendor: 'email',
    envVars: [
      { envName: 'SMTP_HOST',     label: 'SMTP host',     required: true, secret: false },
      { envName: 'SMTP_PORT',     label: 'SMTP port',     required: true, secret: false, hint: 'typically 587' },
      { envName: 'SMTP_USERNAME', label: 'SMTP username', required: true, secret: false },
      { envName: 'SMTP_PASSWORD', label: 'SMTP password', required: true, secret: true },
      { envName: 'SMTP_FROM',     label: 'Default "from" address', required: true, secret: false },
    ],
  },
  {
    cap: 'vector',
    displayName: 'External Vector DB (Pinecone / Weaviate / Qdrant)',
    vendor: 'vector',
    envVars: [
      { envName: 'VECTOR_PROVIDER', label: 'Provider (pinecone | weaviate | qdrant)', required: true, secret: false },
      { envName: 'VECTOR_API_KEY',  label: 'API key', required: true, secret: true },
      { envName: 'VECTOR_ENDPOINT', label: 'Endpoint URL', required: false, secret: false, hint: 'Required for Weaviate / Qdrant self-hosted' },
    ],
  },
  {
    cap: 'postgres',
    displayName: 'External PostgreSQL',
    vendor: 'postgres',
    envVars: [
      { envName: 'SYNTH_PG_URL', label: 'postgres:// connection URL', required: true, secret: true, hint: 'postgres://user:pass@host:5432/dbname' },
    ],
  },
  {
    cap: 'sentry',
    displayName: 'Sentry',
    vendor: 'sentry',
    envVars: [
      { envName: 'SENTRY_AUTH_TOKEN', label: 'Auth token', required: true, secret: true, hint: 'https://sentry.io/settings/account/api/auth-tokens/' },
      { envName: 'SENTRY_ORG',        label: 'Organization slug', required: true, secret: false },
    ],
    docsUrl: 'https://docs.sentry.io/api/auth/',
  },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Lookup a cap spec by slug. */
export function getCapSpec(cap: string): SynthCapSpec | undefined {
  return SYNTH_CAP_ENV_SPEC.find(s => s.cap === cap);
}

/** All known SaaS cap slugs (for validation + admin UI dropdown). */
export const KNOWN_SYNTH_CAPS: readonly string[] =
  SYNTH_CAP_ENV_SPEC.map(s => s.cap);

/**
 * Build the env-var map that SynthExecutorClient.execute() takes, given a
 * caller-provided credential store (typically from Vault via CredentialScopeService).
 *
 * - `enabledCaps`: which caps the user asked for (filter intersect with spec).
 * - `credStore(envName)`: async fetch for a single env var's secret value;
 *   return undefined for unset. Caller enforces per-user scoping upstream.
 *
 * Returned map is the `credentials` parameter of SynthExecutionRequest.
 */
export async function buildCredsForCaps(
  enabledCaps: string[],
  credStore: (envName: string) => Promise<string | undefined>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const cap of enabledCaps) {
    const spec = getCapSpec(cap);
    if (!spec) continue;
    for (const ev of spec.envVars) {
      const val = await credStore(ev.envName);
      if (val !== undefined && val !== '') {
        out[ev.envName] = val;
      }
      // Required-missing is not a hard error here — the cap's SDK will surface
      // a clear "missing API key" error inside the sandbox. Surfacing it here
      // would require a control-plane → sandbox handshake for each call.
    }
  }
  return out;
}

/**
 * Return the list of env var names a set of caps expects (useful for
 * ExternalSecret template generation and admin diagnostic views).
 */
export function envNamesForCaps(enabledCaps: string[]): string[] {
  const names = new Set<string>();
  for (const cap of enabledCaps) {
    const spec = getCapSpec(cap);
    if (!spec) continue;
    for (const ev of spec.envVars) names.add(ev.envName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
