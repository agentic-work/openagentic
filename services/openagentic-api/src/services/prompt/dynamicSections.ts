/**
 * Dynamic sections — recomputed per turn from request-scope inputs.
 * Mirrors ~/anthropic/src/constants/prompts.ts §dynamic sections pattern,
 * minus the cache_control wiring (deferred).
 */

const MAX_TOOLS_IN_CATALOG = 100;

function firstSentence(desc: string | undefined | null): string {
  if (!desc) return '';
  const trimmed = desc.trim();
  if (!trimmed) return '';
  const idx = trimmed.search(/[.!?\n]/);
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

interface ToolLike {
  function?: { name?: string; description?: string };
  name?: string;
  description?: string;
}

export function getToolCatalogSection(tools: ReadonlyArray<ToolLike | null | undefined>): string {
  if (!tools || tools.length === 0) return '';

  // Pass 1: harvest valid (name, desc) pairs.
  const valid: Array<{ name: string; desc: string }> = [];
  for (const t of tools) {
    if (!t) continue;
    const name = t.function?.name ?? t.name;
    if (!name) continue;
    const desc = t.function?.description ?? t.description ?? '';
    valid.push({ name, desc });
  }
  if (valid.length === 0) return '';

  // Pass 2: take first N for the catalog body; remainder becomes the overflow count.
  const shown = valid.slice(0, MAX_TOOLS_IN_CATALOG);
  const overflowCount = valid.length - shown.length;

  const rows = shown.map(({ name, desc }) => {
    const hint = firstSentence(desc);
    return hint ? `- \`${name}\` — ${hint}` : `- \`${name}\``;
  });

  const overflow = overflowCount > 0
    ? `\n\n_${overflowCount} more tools available via \`tool_search\`._`
    : '';

  return `<tool-catalog>
${rows.join('\n')}${overflow}
</tool-catalog>`;
}

/**
 * Render runtime auth/cloud context surfaced from env vars at compose
 * time. Mirrors Claude Code's `computeEnvInfo()` pattern (cwd / git /
 * platform / shell injected at call time) but tuned for our cloud-OBO
 * surface — each line tells the model that credentials for that cloud
 * are auto-resolved and the user should NEVER be asked for ARNs / role
 * names / keys.
 *
 * Empty string when no relevant env vars are set. Each cloud line is
 * independent so partial-configured deployments degrade gracefully.
 *
 * The values come from env at call time — NEVER hardcoded into this
 * source (per `feedback_no_hardcoded_account_arns.md` 2026-05-12).
 * The values that DO flow through (ARN, tenant id, project) are
 * already public per-deployment and exposed via helm values, so the
 * model is allowed to see them — but only via this runtime path.
 */
export function getEnvContextSection(): string {
  const lines: string[] = [];

  // AWS — Identity Center trusted-identity-propagation → AssumeRoleWithWebIdentity.
  const awsRole = process.env.AWS_OBO_ROLE_ARN;
  if (awsRole) {
    const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
    lines.push(
      `  <aws role-arn="${awsRole}" region="${region}">` +
        `AWS tools (openagentic_aws.*) auto-assume this OBO role via your AD identity. ` +
        `Never ask the user for AWS credentials, role ARNs, or access keys.` +
        `</aws>`,
    );
  }

  // Azure — On-Behalf-Of via the configured AAD tenant + app registration.
  const azureTenant = process.env.AZURE_AD_TENANT_ID;
  if (azureTenant) {
    const azureClient = process.env.AZURE_AD_CLIENT_ID || '';
    const clientAttr = azureClient ? ` client-id="${azureClient}"` : '';
    lines.push(
      `  <azure tenant-id="${azureTenant}"${clientAttr}>` +
        `Azure tools (openagentic_azure.*) auto-OBO via your AD identity. ` +
        `Never ask the user for Azure credentials or tenant/client ids.` +
        `</azure>`,
    );
  }

  // GCP — service-account OBO via either GOOGLE_CLOUD_PROJECT or the
  // Vertex-specific override. Both are public per-deployment.
  const gcpProject =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT_ID;
  if (gcpProject) {
    lines.push(
      `  <gcp project-id="${gcpProject}">` +
        `GCP tools (openagentic_gcp.*) and Vertex calls auto-resolve credentials. ` +
        `Never ask the user for GCP project ids or service-account keys.` +
        `</gcp>`,
    );
  }

  if (lines.length === 0) return '';

  return `<env-context>
${lines.join('\n')}
</env-context>`;
}

/**
 * #790 (2026-05-13) — global READ-ONLY mode notice.
 *
 * When the admin flips the platform-wide READ-ONLY kill-switch ON, the
 * chat pipeline must INFORM the model so it stops attempting mutations
 * (otherwise the model happily emits write tool_calls that the
 * PermissionService deny-overrides at evaluate() time, burning turns and
 * frustrating the user).
 *
 * Contract:
 *   - readOnlyMode=false → empty string (caller drops it).
 *   - readOnlyMode=true  → an `<read-only-mode>` block stating the policy
 *     and the verb categories to avoid. The block lives in the dynamic
 *     section pack (below the cache boundary) because the toggle can
 *     flip at any time and we don't want stale cached prompts.
 */
export function getReadOnlyModeSection(readOnlyMode: boolean): string {
  if (!readOnlyMode) return '';
  return `<read-only-mode>
READ-ONLY MODE ACTIVE — all write / mutation operations are blocked at the platform level.

Only call tools that READ or LIST data. Do NOT attempt the following operations — the platform will reject them before execution and the call will not run:
  - create, update, delete, modify, patch, replace
  - scale, deploy, rollout, restart, terminate, stop, start
  - apply, attach, detach, drain, evict, taint, label, annotate
  - put-*, set-*, remove-*, destroy-*

If the user asks for a mutation, explain that READ-ONLY mode is currently enabled and offer to surface the read/inspect equivalent (list / get / describe / query / show) instead.
</read-only-mode>`;
}
