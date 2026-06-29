/**
 * Per-provider-type discriminator schema. The Add-Provider wizard captures
 * required origin fields (env + per-type identifiers like account/project/
 * tenant + region/hostname) so the Registry can show ${type}·${disc}·${model}
 * everywhere a model surfaces.
 *
 * the design notes
 *
 * Pure module — no I/O, no Prisma. Imported by both UI (live preview) and
 * API (POST/PUT validation). Identical behavior on both sides.
 */

export interface ProviderDiscriminator {
  /** Required field keys in the origin object. */
  required: string[];
  /** Display-name template, with ${field} placeholders. */
  template: string;
}

export const DISCRIMINATORS: Record<string, ProviderDiscriminator> = {
  'ollama':           { required: ['env', 'hostname'],            template: 'ollama-${env}-${hostname}' },
  'aws-bedrock':      { required: ['env', 'account', 'region'],   template: 'bedrock-${env}-${account}-${region}' },
  'vertex-ai':        { required: ['env', 'project', 'region'],   template: 'vertex-${env}-${project}-${region}' },
  'azure-ai-foundry': { required: ['env', 'tenant', 'resource'],  template: 'aif-${env}-${tenant}-${resource}' },
  'azure-openai':     { required: ['env', 'tenant', 'resource'],  template: 'aoai-${env}-${tenant}-${resource}' },
  'anthropic':        { required: ['env', 'label'],               template: 'anthropic-${env}-${label}' },
  'openai':           { required: ['env', 'label'],               template: 'openai-${env}-${label}' },
};

/**
 * Generic provider names that must be rejected at POST/PUT time.
 * Operators may NOT name a provider just "Bedrock" or "Ollama" — they
 * must include a discriminator (env + per-type identifiers).
 */
export const RESERVED_GENERIC_NAMES: ReadonlySet<string> = new Set<string>([
  'bedrock',
  'ollama',
  'aws',
  'gcp',
  'azure',
  'anthropic',
  'openai',
  'vertex',
  'aif',
  'aoai',
]);

export function isGenericName(name: string): boolean {
  if (!name) return false;
  return RESERVED_GENERIC_NAMES.has(name.toLowerCase().trim());
}

export function buildAutoDisplayName(
  type: string,
  origin: Record<string, string | undefined>,
): string {
  const schema = DISCRIMINATORS[type];
  if (!schema) return type;
  return schema.template.replace(/\$\{(\w+)\}/g, (_m, k: string) => {
    const v = origin[k];
    return v && String(v).trim() !== '' ? String(v) : `<${k}>`;
  });
}

export type DiscriminatorValidationResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function validateDiscriminator(
  type: string,
  origin: Record<string, string | undefined>,
): DiscriminatorValidationResult {
  const schema = DISCRIMINATORS[type];
  if (!schema) return { ok: true };
  const missing = schema.required.filter((k) => {
    const v = origin[k];
    return v == null || String(v).trim() === '';
  });
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
