/**
 * synthPrompt — builds the system-prompt block that teaches the LLM how to
 * use the `synth_synthesize` tool safely.
 *
 * The block is capability-aware: if the user's current toolset doesn't
 * grant a cloud capability, we don't document that cloud's env vars — so
 * the model doesn't believe it can reach that cloud.
 *
 * This is the contract surface that guards against:
 *   - the model writing static credentials into generated code
 *   - the model assuming the sandbox is boundless
 *   - abuse categories (adult content, piracy, crypto-mining, exfil, mass
 *     scraping, denial-of-service)
 *
 * All invocations are audited (user_id + intent + code_hash + capabilities
 * + outcome) — the prompt states this so the model knows refusals are
 * reviewable and misuse is attributable.
 */

export interface BuildSynthToolPromptOptions {
  /** Capabilities the current toolset/policy permits for synth. */
  availableCapabilities: string[];
}

const CLOUD_ENV_SNIPPETS: Record<string, string> = {
  aws: [
    '- `os.environ["AWS_ACCESS_KEY_ID"]` — short-lived STS session key (ASIA…)',
    '- `os.environ["AWS_SECRET_ACCESS_KEY"]` — paired secret',
    '- `os.environ["AWS_SESSION_TOKEN"]` — session token (required; this is not a long-lived key)',
    '- `os.environ["AWS_DEFAULT_REGION"]` — default region for boto3 clients',
  ].join('\n'),
  azure: [
    '- `os.environ["AZURE_ACCESS_TOKEN"]` — user-delegated ARM bearer token',
    '  Use as `Authorization: Bearer <token>`; valid ~1 hour; scoped to the signed-in user\'s RBAC.',
  ].join('\n'),
  gcp: [
    '- `os.environ["GOOGLE_SA_JSON"]` — raw service-account JSON (TEMPORARY until WIF pool for AAD is provisioned)',
    '  Parse with `json.loads` and pass to `google.oauth2.service_account.Credentials.from_service_account_info`.',
  ].join('\n'),
};

const CLOUD_HEADINGS: Record<string, string> = {
  aws: 'AWS (via Azure AD OIDC → STS AssumeRoleWithWebIdentity, 1h TTL)',
  azure: 'Azure (user-delegated ARM token passthrough)',
  gcp: 'GCP',
};

/**
 * Build the synth tool guidance block.
 *
 * Keep this string stable — downstream evaluators diff on it. Changes must
 * come with test updates in `synthPrompt.test.ts`.
 */
export function buildSynthToolPrompt(opts: BuildSynthToolPromptOptions): string {
  const clouds = ['aws', 'azure', 'gcp'] as const;
  const requested = new Set((opts.availableCapabilities ?? []).map((c) => c.toLowerCase()));
  const cloudsInScope = clouds.filter((c) => requested.has(c));

  const credsBlock = cloudsInScope.length
    ? cloudsInScope
        .map((c) => `**${CLOUD_HEADINGS[c]}**\n${CLOUD_ENV_SNIPPETS[c]}`)
        .join('\n\n')
    : '_(No cloud capabilities requested. The sandbox has no cloud credentials for this call.)_';

  return `## synth_synthesize — Sandbox Code Execution

\`synth_synthesize\` generates and runs Python in an isolated per-request sandbox.
**Use as a last resort** — always prefer a dedicated MCP tool when one exists
for the task. If you don't see a typed tool that fits, call \`tool_search\`
with a plain-language description before falling through to synth.

### Capability declaration

When you call \`synth_synthesize\`, you must declare a \`capabilities\` list
that matches exactly what your code touches. The API uses this to decide
which short-lived credentials to inject, and the approval tier.

Valid values: \`http\`, \`json\`, \`datetime\`, \`aws\`, \`azure\`, \`gcp\`,
\`file_processing\`.

### Injected credentials — DO NOT write static keys into generated code

The API brokers short-lived, user-scoped credentials on every call and
injects them as env vars. Your code should read them from \`os.environ\`.
Never include literal keys, tokens, or connection strings in generated code.

${credsBlock}

All injected tokens are short-lived (≤1 hour) and scoped to the signed-in
user's identity. The cloud provider's own audit log (CloudTrail / Activity
Log / Cloud Audit Logs) attributes every call to the human user, not a
service principal.

### Risk tiers and approval

Every synthesized payload is classified before execution:

- **low** — read-only, format conversions, computation — auto-approved
- **medium** — HTTP calls, file writes, aggregate queries — may require approval
- **high** — cloud modifications, credential access, bulk-delete — always requires human approval
- **critical** — destructive or abuse-aligned (see prohibited list) — refused, not executed

When approval is needed, tell the user explicitly: *"This operation requires
your approval before execution. Risk level: [level]."*

Write-style verbs (create / modify / delete / upload / grant / deploy) push
the risk tier up; the user must approve before the code ever runs.

### Prohibited / refused categories

The following categories are refused outright regardless of intent phrasing:

- **adult** / sexual content or lookup of adult sites (porn, nsfw)
- **piracy** / warez / license-key generation / DRM bypass
- **crypto-mining** / unauthorized resource use for coin mining
- **exfil** of user data to personal endpoints or outside the tenant
- **mass-scrape** of third-party sites (>N requests/min without consent)
- **DoS** / flood / packet generation / reflection attacks

If the user asks for any of these, respond plainly that the policy forbids
it — don't synthesize and then refuse; refuse up front.

### Audit trail

Every \`synth_synthesize\` call is recorded with:

- user_id + email
- declared intent (truncated)
- SHA-256 code-hash
- capabilities requested
- risk classification
- cloud targets
- outcome (success / approval-pending / refused / error)
- redacted credential key-names (values hashed, never stored raw)

Refusals and approvals are reviewable in the admin audit log. Misuse is
attributable.

### Sandbox environment

- Python 3.11, non-root, read-only rootfs, dropped capabilities
- libraries available: \`requests\`, \`boto3\`, \`azure-identity\`, \`google-auth\`,
  \`pandas\`, \`python-docx\`, \`reportlab\`, \`Pillow\`, \`openpyxl\`,
  \`beautifulsoup4\`, \`lxml\`
- 60-second default timeout, configurable memory limit
- No inbound network, no access to cluster-internal Services (egress is
  restricted to the cloud API FQDNs you requested via \`capabilities\`)
`;
}
