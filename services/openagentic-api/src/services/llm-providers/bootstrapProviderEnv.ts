/**
 * bootstrapProviderEnv — pure parser for the helm `bootstrapProvider:` block.
 *
 * The helm chart (openagentic-helm task #294) emits four env vars from the
 * `bootstrapProvider:` YAML block when `bootstrapProvider.enabled=true`:
 *
 *   BOOTSTRAP_PROVIDER_NAME          — string, unique key in admin.llm_providers
 *   BOOTSTRAP_PROVIDER_DISPLAY_NAME  — string, friendly label for admin UI
 *   BOOTSTRAP_PROVIDER_TYPE          — one of the supported provider_type
 *                                      values ('ollama', 'aws-bedrock',
 *                                      'vertex-ai', 'azure-ai-foundry',
 *                                      'azure-openai', 'anthropic', 'openai')
 *   BOOTSTRAP_PROVIDER_CONFIG        — JSON-serialized authConfig object
 *                                      (shape varies per type — see values.yaml)
 *   BOOTSTRAP_PROVIDER_DEFAULTS      — JSON-serialized { chat, codemode,
 *                                      embedding, embeddingDimension }
 *
 * This module parses those into a normalized shape the seeder + tests use.
 * If NAME is missing/empty the caller should short-circuit — helm-shipped
 * bootstrap is disabled on that deployment.
 *
 * Pure function → no I/O, no Prisma, trivial to unit-test.
 */

export interface BootstrapProviderDefaults {
  chat: string | null;
  codemode: string | null;
  /**
   * Vision-role model id. Operator may point this at the same tag as `chat`
   * when the model supports image input (gpt-oss:20b on Ollama does), or at a
   * separate multimodal tag. RegistryBootstrapSeeder writes a role='vision'
   * row when this is non-null so the admin Model Registry surfaces the
   * vision-capable entry without a manual Add-Model step post-deploy.
   */
  vision: string | null;
  /**
   * Image-generation model id. Operator sets this in helm values when the
   * bootstrap provider ships an image-capable model (e.g. an AWS Bedrock
   * Nova/Titan image model, or a Vertex Imagen model). RegistryBootstrapSeeder
   * writes a role='imageGen' row (capabilities.imageGeneration=true) AND the
   * default_models.imageGen entry when this is non-null — without it the chat
   * `generate_image` tool has no model to resolve and ProviderManager throws
   * "No providers with image generation capability are configured" before any
   * provider call. NO literal model id lives in business logic — the id is
   * operator-supplied here.
   */
  imageGen: string | null;
  embedding: string | null;
  embeddingDimension: number | null;
}

export interface BootstrapProviderSeed {
  name: string;
  displayName: string;
  providerType: string;
  authConfig: Record<string, unknown>;
  defaults: BootstrapProviderDefaults;
}

const EMPTY_DEFAULTS: BootstrapProviderDefaults = {
  chat: null,
  codemode: null,
  vision: null,
  imageGen: null,
  embedding: null,
  embeddingDimension: null,
};

function safeJsonObject(input: string | undefined, fieldName: string): Record<string, unknown> {
  if (!input || input.trim() === '' || input.trim() === '{}') return {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // Malformed JSON = treat as empty rather than crash boot. The operator
    // will see the warning in the seeder and fix values.yaml on the next
    // deploy, but the service still starts.
    throw new Error(`BOOTSTRAP_PROVIDER parse error: ${fieldName} is not valid JSON object`);
  }
}

function parseDefaults(input: string | undefined): BootstrapProviderDefaults {
  const raw = safeJsonObject(input, 'BOOTSTRAP_PROVIDER_DEFAULTS');
  const pickStr = (k: string): string | null => {
    const v = (raw as any)[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    return null;
  };
  const dimRaw = (raw as any).embeddingDimension;
  const embeddingDimension: number | null =
    typeof dimRaw === 'number' && Number.isFinite(dimRaw) ? dimRaw :
    typeof dimRaw === 'string' && dimRaw.trim() !== '' && Number.isFinite(Number(dimRaw)) ? Number(dimRaw) :
    null;
  return {
    chat: pickStr('chat'),
    codemode: pickStr('codemode'),
    vision: pickStr('vision'),
    imageGen: pickStr('imageGen'),
    embedding: pickStr('embedding'),
    embeddingDimension,
  };
}

/**
 * Parse BOOTSTRAP_PROVIDER_* env vars into a typed seed payload.
 * Returns null when bootstrap is not configured (NAME empty or absent).
 *
 * Throws when NAME is present but TYPE is empty — that's an operator error
 * (values.yaml under-specified), not a "no bootstrap" signal.
 */
export function parseBootstrapProviderEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): BootstrapProviderSeed | null {
  const name = (env.BOOTSTRAP_PROVIDER_NAME ?? '').trim();
  if (!name) return null;

  const type = (env.BOOTSTRAP_PROVIDER_TYPE ?? '').trim();
  if (!type) {
    throw new Error('BOOTSTRAP_PROVIDER_NAME is set but BOOTSTRAP_PROVIDER_TYPE is empty');
  }

  const displayName = (env.BOOTSTRAP_PROVIDER_DISPLAY_NAME ?? '').trim() || name;

  const authConfig = safeJsonObject(env.BOOTSTRAP_PROVIDER_CONFIG, 'BOOTSTRAP_PROVIDER_CONFIG');
  const defaults = env.BOOTSTRAP_PROVIDER_DEFAULTS ? parseDefaults(env.BOOTSTRAP_PROVIDER_DEFAULTS) : EMPTY_DEFAULTS;

  return {
    name,
    displayName,
    providerType: type,
    authConfig,
    defaults,
  };
}
