/**
 * Read tenant-default model env vars (set by the helm chart or the host)
 * and emit the `SystemConfiguration.default_models` JSON shape used by
 * ModelRegistry / ModelRouter.
 *
 * This is the boot-time bridge between helm values and the DB-backed
 * tenant default. Used by LLMProviderSeeder to seed the legacy
 * system_configuration.default_models row during cold-start bootstrap.
 */

export type Mode = 'chat' | 'code' | 'embedding' | 'vision' | 'imageGen';

export interface DefaultModels {
  chat: string | null;
  code: string | null;
  embedding: string | null;
  vision: string | null;
  imageGen: string | null;
}

export const ENV_KEY_BY_MODE: Record<Mode, readonly string[]> = {
  chat:      ['DEFAULT_MODEL', 'DEFAULT_CHAT_MODEL'],
  code:      ['DEFAULT_CODE_MODEL', 'OPENAGENTIC_MODEL'],
  embedding: ['DEFAULT_EMBEDDING_MODEL', 'EMBEDDING_MODEL'],
  vision:    ['DEFAULT_VISION_MODEL'],
  imageGen:  ['DEFAULT_IMAGE_MODEL', 'DEFAULT_IMAGEGEN_MODEL'],
};

function pickFirstNonEmpty(env: NodeJS.ProcessEnv | Record<string, string | undefined>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = env[k];
    if (typeof v === 'string' && v.trim() !== '' && v.trim().toLowerCase() !== 'auto') {
      return v.trim();
    }
  }
  return null;
}

export function buildDefaultModelsFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): DefaultModels {
  return {
    chat:      pickFirstNonEmpty(env, ENV_KEY_BY_MODE.chat),
    code:      pickFirstNonEmpty(env, ENV_KEY_BY_MODE.code),
    embedding: pickFirstNonEmpty(env, ENV_KEY_BY_MODE.embedding),
    vision:    pickFirstNonEmpty(env, ENV_KEY_BY_MODE.vision),
    imageGen:  pickFirstNonEmpty(env, ENV_KEY_BY_MODE.imageGen),
  };
}

/**
 * Merge current DB defaults with env-derived defaults. DB wins per-mode when
 * a value is already set; env fills any null slots. This is what the seeder
 * persists so admin overrides aren't clobbered on pod restart, but a freshly
 * deployed cluster still gets sensible defaults from helm.
 */
export function mergeDefaultsPreferringExisting(
  existing: Partial<DefaultModels> | null | undefined,
  envDerived: DefaultModels,
): DefaultModels {
  const ex = existing ?? {};
  const pick = (mode: Mode): string | null => {
    const cur = (ex as any)[mode];
    if (typeof cur === 'string' && cur.trim() !== '') return cur.trim();
    return envDerived[mode];
  };
  return {
    chat:      pick('chat'),
    code:      pick('code'),
    embedding: pick('embedding'),
    vision:    pick('vision'),
    imageGen:  pick('imageGen'),
  };
}
