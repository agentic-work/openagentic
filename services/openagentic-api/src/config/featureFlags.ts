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
 *  - src/plugins/codemode.plugin.ts  — codeManagerUrl
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

  /**
   * When true (CODEMODE_USE_CCR_RELAY=1 or =true), the code-manager
   * WebSocket handler uses the CCR relay path instead of the direct exec-pod
   * connection.
   * Accepts '1' as a legacy truthy sentinel in addition to 'true'.
   */
  codemodeUseCcrRelay: bool('CODEMODE_USE_CCR_RELAY', false, ['1']),

  /** Ollama local-model provider enabled (OLLAMA_ENABLED=true). */
  ollamaEnabled: bool('OLLAMA_ENABLED', false),

  /** Auth provider type ('azure-ad' | 'local'). */
  authProvider: process.env.AUTH_PROVIDER || 'azure-ad',

  /** MCP proxy sidecar enabled (MCP_PROXY_ENABLED=true, default on). */
  mcpProxyEnabled: bool('MCP_PROXY_ENABLED', true),

  /** URL of the code-manager service (default: http://openagentic-manager:3050). */
  codeManagerUrl: process.env.CODE_MANAGER_URL || 'http://openagentic-manager:3050',

  /**
   * Internal API key for code-manager requests.
   * Canonical env var: CODE_MANAGER_INTERNAL_KEY (matches all consumer sites).
   * Earlier draft used CODE_MANAGER_KEY — corrected in Phase 1 follow-up.
   */
  codeManagerInternalKey: process.env.CODE_MANAGER_INTERNAL_KEY,

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
  // your-deployment pack and the two platform showcase templates now seed via the
  // canonical SEED_WORKFLOW_TEMPLATES inline path in routes/workflows.ts,
  // which writes to the `workflow` table that chat-dev's Templates panel
  // actually reads.)
} as const;
