/**
 * featureFlags — Phase 5 of server.ts decomposition.
 *
 * Centralises the deploy-toggle env-var reads that are scattered across
 * plugins and startup modules. All values are resolved once at module load
 * time. Wired into consumers in Phase 5 (previously defined but unused).
 *
 * Consumers:
 *  - src/plugins/admin.plugin.ts     — ollamaEnabled
 *  - src/plugins/auth.plugin.ts      — authProvider
 *  - src/plugins/chat.plugin.ts      — enableCoT
 *
 * Rules:
 *  - bool() returns true when the env var is exactly the string "true"
 *    (case-insensitive) OR any entry in extraTruthySentinels. Unset → defaultValue.
 *  - String flags fall back to the documented default when unset.
 */

function bool(
  envVar: string,
  defaultValue: boolean,
  extraTruthySentinels: string[] = [],
): boolean {
  const v = process.env[envVar];
  if (v === undefined) return defaultValue;
  const lower = v.toLowerCase();
  return lower === 'true' || extraTruthySentinels.includes(lower);
}

/**
 * Hard-required env var with NO fallback. Crashes at module load when
 * unset — preferable to silent default-targeting on the wrong cluster /
 * namespace / tenant. Used for values where a wrong default is worse
 * than a startup failure.
 */
function requireEnv(envVar: string): string {
  const v = process.env[envVar];
  if (!v) {
    throw new Error(
      `[featureFlags] required env var ${envVar} is not set. ` +
        `Helm/values must inject this — see helm/openagentic/templates/. ` +
        `No fallback exists by design (would silently target wrong cluster/namespace).`,
    );
  }
  return v;
}

export const featureFlags = {
  /** Chain-of-Thought display (ENABLE_COT=true). */
  enableCoT: bool('ENABLE_COT', false),

  /**
   * RBAC-keyed system prompt (USE_RBAC_PROMPT=true). Rev-2 chatmode
   * spec (`docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md`):
   * when true, runChat loads `prompts/chat-system-{admin,member}.md`
   * via getSystemPromptForRole and bypasses the legacy 35-module
   * legacy static + sidecar composer machinery. Default false during
   * Phase B rollout — flip to true via helm values once Phase B.7
   * Playwright probes confirm parity on chat-dev.
   */
  useRbacPrompt: bool('USE_RBAC_PROMPT', false),

  /** Ollama local-model provider enabled (OLLAMA_ENABLED=true). */
  ollamaEnabled: bool('OLLAMA_ENABLED', false),

  /** Auth provider type ('azure-ad' | 'local'). */
  authProvider: process.env.AUTH_PROVIDER || 'azure-ad',

  /** MCP proxy sidecar enabled (MCP_PROXY_ENABLED=true, default on). */
  mcpProxyEnabled: bool('MCP_PROXY_ENABLED', true),

  /**
   * Human-approval gate on MUTATING tool calls (APPROVAL_GATE_MUTATING=true).
   * Default ON. The DB row system_configuration.key='approval_gate_policy'
   * overrides this at runtime. Audit of EVERY tool call is ALWAYS on and is
   * never behind a flag.
   */
  approvalGateMutating: bool('APPROVAL_GATE_MUTATING', true),

  /**
   * Kubernetes namespace for exec-pod address construction + cluster
   * queries. Helm sets this from `{{ .Release.Namespace }}` (api) or
   * downward API `fieldRef: metadata.namespace` (code-manager) in every
   * fully-configured env. We log-loud-and-fall-back to 'agentic-dev'
   * here as a last-resort safety net — initial fail-fast (2026-04-27)
   * crashed the live api because the active helm chart hadn't been
   * audited; the right fix is to ensure helm sets K8S_NAMESPACE on
   * EVERY chart variant + add a values-render arch test. Until that
   * lands, fail-loud-not-fail-fast wins on uptime.
   */
  k8sNamespace: (() => {
    const v = process.env.K8S_NAMESPACE;
    if (!v) {
      // Loud one-line console.error so it lands in pod logs + Sentry.
      console.error(
        '[featureFlags] K8S_NAMESPACE not set — defaulting to agentic-dev. ' +
          'Fix helm: every Deployment must set K8S_NAMESPACE from `{{ .Release.Namespace }}`. ' +
          'See memory/feedback_no_hardcoded_namespaces.md.',
      );
      return 'agentic-dev';
    }
    return v;
  })(),

  // (seedOmhsTemplates + seedPlatformTemplates both removed — all the
  // OMHS pack and the two platform showcase templates now seed via the
  // canonical SEED_WORKFLOW_TEMPLATES inline path in routes/workflows.ts,
  // which writes to the `workflow` table that chat-dev's Templates panel
  // actually reads.)
} as const;
