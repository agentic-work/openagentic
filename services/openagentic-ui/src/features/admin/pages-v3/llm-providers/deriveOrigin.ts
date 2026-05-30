/**
 * Auto-derive `provider_config.origin` from the form's auth values + provider
 * type, so the v3 modal doesn't need a separate Origin section. Pure
 * function — tested in __tests__/deriveOrigin.test.ts.
 *
 * Mirrors per-type required fields from
 * services/openagentic-api/src/services/llm-providers/ProviderDiscriminatorSchema.ts.
 * If a required field can't be derived, the form save still POSTs and the
 * api 400 (DISCRIMINATOR_MISSING) surfaces the gap.
 */

import type { ProviderType } from '../../components/LLM/LLMProviderManagement/types'

export interface DeriveOriginInput {
  providerType: ProviderType
  /** Form's authValues map (region, awsAccessKeyId, tenantId, projectId,
   * credentialsJson, endpoint, etc.). */
  auth: Record<string, unknown>
  /** Pre-existing origin from providerConfig.origin (preserved when fields
   * are explicitly already set — never overridden). */
  existingOrigin?: Record<string, string | undefined>
  /** Fallback host string from providerConfig.host/baseUrl/endpoint. */
  hostStr?: string
  /** Provider name (used as `label` fallback for openai/anthropic). */
  providerName?: string
}

export function deriveOrigin(
  input: DeriveOriginInput,
): Record<string, string> {
  const out: Record<string, string> = {
    ...(input.existingOrigin as Record<string, string>),
  }
  const auth = input.auth
  const hostStr = input.hostStr ?? ''

  if (!out.env) out.env = 'prod'

  switch (input.providerType) {
    case 'ollama':
      if (!out.hostname) {
        out.hostname =
          parseHostname(String(auth.endpoint ?? hostStr)) || 'localhost'
      }
      break

    case 'aws-bedrock':
      // `region` is an auth field. `account` is not collected — use the
      // access-key prefix as a stable per-key synthetic discriminator.
      // A real STS::GetCallerIdentity would resolve the actual AWS account
      // id; that's a network call we don't want in the form-save path.
      // The synthetic is enough to make ${type}·${disc}·${model} unique.
      if (!out.region && auth.region) out.region = String(auth.region)
      if (!out.account) {
        const akid = String(auth.awsAccessKeyId ?? '')
        const m = akid.match(/^AKIA([A-Z0-9]{12,})/)
        out.account = m
          ? `akid-${m[1].slice(0, 12)}`
          : akid.slice(0, 16) || 'unknown'
      }
      break

    case 'vertex-ai':
      if (!out.region && auth.region) out.region = String(auth.region)
      if (!out.project && auth.projectId) out.project = String(auth.projectId)
      if (!out.project && auth.credentialsJson) {
        try {
          const j = JSON.parse(String(auth.credentialsJson))
          if (j?.project_id) out.project = String(j.project_id)
        } catch {
          /* leave unset */
        }
      }
      break

    case 'azure-ai-foundry':
    case 'azure-openai':
      if (!out.tenant && auth.tenantId) out.tenant = String(auth.tenantId)
      if (!out.resource) {
        const hn = parseHostname(String(auth.endpoint ?? hostStr))
        out.resource = hn.split('.')[0] || 'unknown'
      }
      break

    case 'anthropic':
    case 'openai':
      if (!out.label) {
        out.label = (input.providerName?.trim() || 'default')
      }
      break
  }

  return out
}

function parseHostname(s: string): string {
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `http://${s}`)
    return u.hostname || ''
  } catch {
    return (s.split(/[:/]/)[0] || '').trim()
  }
}
