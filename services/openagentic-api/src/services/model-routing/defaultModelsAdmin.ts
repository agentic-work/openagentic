/**
 * Admin handler logic for GET/PUT tenant `default_models`. Extracted into
 * a pure(-ish) module so the validation + upsert flow is unit-testable
 * without spinning up fastify.
 */
import type { Logger } from 'pino';
import type { DefaultModels, Mode } from './defaultModelsEnv.js';
import {
  defaultModelsUpdatedCounter,
  defaultModelsCurrentGauge,
} from '../../metrics/index.js';

export const MODES: readonly Mode[] = ['chat', 'code', 'embedding', 'vision', 'imageGen'];

const KEY = 'default_models';

export interface AdminPrismaLike {
  systemConfiguration: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: unknown; description?: string; is_active?: boolean };
      update: { value: unknown; is_active?: boolean };
    }): Promise<{ value: unknown }>;
  };
  lLMProvider: {
    findMany(args?: any): Promise<any[]>;
  };
  modelRoleAssignment: {
    findMany(args?: any): Promise<any[]>;
  };
}

export interface PutDefaultsInput {
  chat?: string | null;
  code?: string | null;
  embedding?: string | null;
  vision?: string | null;
  imageGen?: string | null;
}

export interface PutDefaultsResult {
  ok: true;
  defaults: DefaultModels;
  changed: Mode[];
}

export interface PutDefaultsError {
  ok: false;
  code: number;
  error: string;
  message: string;
  details?: unknown;
}

export function isValidModelIdShape(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const t = value.trim();
  if (t === '') return false;
  if (t.length > 200) return false; // upstream max model id length
  return true;
}

export function validatePutBody(body: PutDefaultsInput): PutDefaultsError | null {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 400, error: 'BAD_REQUEST', message: 'Body must be an object with any of: chat, code, embedding, vision, imageGen' };
  }
  for (const mode of MODES) {
    if (!(mode in body)) continue;
    const v = (body as any)[mode];
    if (!isValidModelIdShape(v)) {
      return {
        ok: false, code: 400, error: 'INVALID_MODEL_ID',
        message: `default_models.${mode} must be a non-empty string or null (received: ${typeof v === 'string' ? '""' : String(v)})`,
      };
    }
  }
  return null;
}

/**
 * Return the set of canonical model ids currently in the Registry SoT
 * (admin.model_role_assignments). Used to reject PUTs that point at a
 * model not in the registry. Replaces the old provider_config.models[]
 * scan; the Registry is now the single source of truth.
 */
export async function loadRegisteredIds(prisma: AdminPrismaLike): Promise<Set<string>> {
  const rows = await prisma.modelRoleAssignment.findMany({
    where: { enabled: true },
    select: { model: true },
  });
  const ids = new Set<string>();
  for (const r of rows as Array<{ model: string }>) {
    if (typeof r.model === 'string' && r.model.trim()) ids.add(r.model.trim());
  }
  return ids;
}

export async function getDefaults(prisma: AdminPrismaLike): Promise<DefaultModels> {
  const row = await prisma.systemConfiguration.findUnique({ where: { key: KEY } });
  const v = row?.value as Partial<DefaultModels> | null | undefined;
  return {
    chat:      typeof v?.chat      === 'string' ? v.chat      : null,
    code:      typeof v?.code      === 'string' ? v.code      : null,
    embedding: typeof v?.embedding === 'string' ? v.embedding : null,
    vision:    typeof v?.vision    === 'string' ? v.vision    : null,
    imageGen:  typeof v?.imageGen  === 'string' ? v.imageGen  : null,
  };
}

export async function putDefaults(
  prisma: AdminPrismaLike,
  logger: Logger,
  body: PutDefaultsInput,
  opts: { allowUnregistered?: boolean; userId?: string } = {},
): Promise<PutDefaultsResult | PutDefaultsError> {
  const validationError = validatePutBody(body);
  if (validationError) return validationError;

  const current = await getDefaults(prisma);
  const allowUnregistered = opts.allowUnregistered ?? false;

  // Only enforce registry membership for non-null values
  if (!allowUnregistered) {
    const referenced = MODES
      .map((mode) => ({ mode, id: (body as any)[mode] }))
      .filter((x) => typeof x.id === 'string' && x.id !== '');
    if (referenced.length > 0) {
      const registered = await loadRegisteredIds(prisma);
      const missing = referenced.filter((x) => !registered.has(x.id as string));
      if (missing.length) {
        return {
          ok: false, code: 422, error: 'UNREGISTERED_MODEL',
          message: `Cannot set default to model(s) not registered in any provider's models[]. ` +
                   `Missing: ${missing.map((m) => `${m.mode}=${m.id}`).join(', ')}. ` +
                   `Register the model in Admin > LLM Providers first, or pass ?force=true.`,
          details: { missing },
        };
      }
    }
  }

  const next: DefaultModels = {
    chat:      'chat'      in body ? ((body.chat      as string) || null) : current.chat,
    code:      'code'      in body ? ((body.code      as string) || null) : current.code,
    embedding: 'embedding' in body ? ((body.embedding as string) || null) : current.embedding,
    vision:    'vision'    in body ? ((body.vision    as string) || null) : current.vision,
    imageGen:  'imageGen'  in body ? ((body.imageGen  as string) || null) : current.imageGen,
  };

  const changed = MODES.filter((mode) => (current as any)[mode] !== (next as any)[mode]);

  if (changed.length === 0) {
    return { ok: true, defaults: next, changed: [] };
  }

  await prisma.systemConfiguration.upsert({
    where: { key: KEY },
    create: {
      key: KEY, value: next,
      description: 'Tenant-default model per mode. Seeded by LLMProviderSeeder on boot; editable via admin UI.',
      is_active: true,
    },
    update: { value: next, is_active: true },
  });

  logger.info({
    changed, before: current, after: next,
  }, '[admin] default_models updated');

  // Metrics: counter + gauge per changed category
  try {
    const effectiveUserId = opts.userId || 'unknown';
    for (const category of changed) {
      defaultModelsUpdatedCounter.inc({ category, updated_by: effectiveUserId });
      defaultModelsCurrentGauge.set({ category, model: (next as any)[category] ?? 'null' }, 1);
    }
  } catch { /* metrics error — non-fatal */ }

  return { ok: true, defaults: next, changed };
}
