/**
 * Pure helpers that decide which env vars feed the codemode
 * metadata strip's "live" cells (cwd, budget cap). Extracted from
 * k8sSessionManager.buildPodEnv so the logic is testable without
 * spinning up the Kubernetes client.
 *
 * Contract: every value the helper returns becomes part of the exec
 * pod spec, which the openagentic daemon reads at startup and echoes
 * back through `system/init` (a.k.a. session_info). The metadata
 * strip in the UI then reflects them on every turn.
 */

export interface MetadataStripEnvInputs {
  /** Per-user workspace path on the PVC (e.g. /workspaces/u-9abc). */
  workspacePath: string
  /**
   * Platform default cap in USD pulled from helm values
   * (CODEMODE_DEFAULT_BUDGET_CAP_USD on the manager pod). Empty /
   * unset / 0 / negative → omit. Treats the literal "unlimited" or
   * "null" the same as positive numbers — both are intentional
   * admin opt-ins that the daemon will translate to wire `null`.
   */
  codemodeDefaultBudgetCapUsd?: string
  /**
   * Boot-time default model id for the openagentic daemon's
   * in-memory currentModel. RESOLVED AT SESSION-CREATE TIME from the
   * api's `/api/internal/codemode-default-model` SoT (fetched live by
   * `k8sSessionManager.createSession` via fetchDefaultCodeModel; Phase
   * I, 2026-04-29), NOT from a helm-baked env.
   *
   * The previous helm-driven path (`codemode.bootModel` →
   * `OPENAGENTIC_BOOT_MODEL`) hardcoded the model at the cm-pod level,
   * which meant: admin removed Sonnet from registry → DB SoT updated
   * → but every NEW codemode session still spawned with the stale
   * helm value baked into the user's pod env → daemon hung trying to
   * route to a model no provider had. The bake-in is gone; this field
   * now reflects whatever the admin set in the UI at the moment the
   * pod was provisioned.
   *
   * Empty/unset → omit. The daemon falls back to API-side smart
   * routing (`/api/openagentic/v1/messages` resolves the model from
   * the same SoT on each request).
   *
   * After boot the daemon owns the in-memory currentModel; `/model X`
   * mutates it.
   */
  bootModel?: string
}

export interface EnvVar {
  name: string
  value: string
}

/**
 * Build the metadata-strip-driving env vars. Returns at minimum
 * OPENAGENTIC_CWD (so the daemon spawns the child with the
 * per-user workspace as cwd, which is what `getCwd()` echoes in
 * the next system/init). Adds OPENAGENTIC_BUDGET_CAP_USD when the
 * platform configured a default cap.
 */
export function buildMetadataStripEnv(inputs: MetadataStripEnvInputs): EnvVar[] {
  const env: EnvVar[] = []
  if (inputs.workspacePath && inputs.workspacePath.length > 0) {
    env.push({ name: 'OPENAGENTIC_CWD', value: inputs.workspacePath })
  }

  const cap = (inputs.codemodeDefaultBudgetCapUsd ?? '').trim()
  if (cap.length > 0) {
    env.push({ name: 'OPENAGENTIC_BUDGET_CAP_USD', value: cap })
  }

  const bootModel = (inputs.bootModel ?? '').trim()
  if (bootModel.length > 0) {
    env.push({ name: 'OPENAGENTIC_BOOT_MODEL', value: bootModel })
  }

  return env
}
