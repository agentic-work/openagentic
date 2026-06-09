/**
 * First-run setup endpoints.
 *
 * These three routes back the in-UI Setup wizard at /setup. They're
 * intentionally UNAUTHENTICATED — a fresh stack has no admin yet, no JWT,
 * and the whole point is to bootstrap the first one. Idempotency is the
 * safety net: status returns a snapshot, complete refuses to clobber an
 * existing admin unless the magic-boot token is supplied.
 *
 *   GET  /api/setup/status         — needsSetup, hasAdmin, hasProvider
 *   POST /api/setup/probe-ollama   — { host } → models[] split chat/embed
 *   POST /api/setup/complete       — { adminEmail, adminPassword,
 *                                       ollamaHost, chatModel, embedModel }
 *                                    → mints admin + LLMProvider + role
 *                                      assignments, returns { token }
 */
import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { getJWTSecret } from '../utils/secrets.js';
import { loggers } from '../utils/logger.js';

interface CompleteBody {
  adminEmail: string;
  adminPassword: string;
  ollamaHost: string;
  chatModel: string;
  embedModel: string;
  /** When ADMIN already exists, require this to overwrite. Matches install.sh's MAGIC_BOOT_TOKEN. */
  magicToken?: string;
}

interface ProbeBody {
  host: string;
}

// Embedding-model heuristic mirrors OllamaModelSyncService — kept inline so
// this route has no circular import on a service that's lazy-loaded elsewhere.
const EMBED_RE = /(?:embed|embedding|bge-|gte-|e5-|nomic-embed|mxbai-embed)/i;

const isEmbed = (name: string): boolean => EMBED_RE.test(name);

// B4 (NIST SC-7/AC-4): SSRF guard for the unauthenticated probe-ollama route.
// A legitimate Ollama host is on the LAN / loopback / docker-internal, so we do
// NOT block all private space (that would break the install). We DO block the
// cloud-metadata endpoints and any non-http(s) scheme — there is no legitimate
// Ollama at the IMDS address or behind file://, gopher://, etc. The durable
// fix is the needsSetup gate (the route dies once an admin exists).
const METADATA_HOSTS = new Set([
  '169.254.169.254',       // AWS/GCP/Azure IMDS (IPv4)
  '[fd00:ec2::254]',       // AWS IMDS (IPv6)
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.goog',
]);

/** Returns an error string if `host` is an SSRF-unsafe target, else null. */
function ssrfReject(host: string): string | null {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    return 'host must be a valid http(s) URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `scheme "${url.protocol}" is not allowed (use http or https)`;
  }
  const hostname = url.hostname.toLowerCase();
  if (METADATA_HOSTS.has(hostname) || METADATA_HOSTS.has(`[${hostname}]`)) {
    return 'host is a blocked cloud-metadata endpoint';
  }
  return null;
}

export const setupRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── GET /api/setup/status ───────────────────────────────────────────────
  fastify.get('/status', async () => {
    const [userCount, providerCount, adminCount] = await Promise.all([
      prisma.user.count(),
      prisma.lLMProvider.count({ where: { enabled: true, deleted_at: null } }),
      prisma.user.count({ where: { is_admin: true, is_active: true } }),
    ]);
    return {
      needsSetup: userCount === 0 || providerCount === 0,
      hasAdmin: adminCount > 0,
      hasProvider: providerCount > 0,
      userCount,
      providerCount,
    };
  });

  // ─── POST /api/setup/probe-ollama ────────────────────────────────────────
  fastify.post<{ Body: ProbeBody }>('/probe-ollama', async (request, reply) => {
    // B4 (NIST AC-3): setup-gate. Once an admin exists, setup is done and this
    // unauthenticated route must be dead — otherwise it lingers as an SSRF
    // primitive for the life of the deployment.
    const adminCount = await prisma.user.count({ where: { is_admin: true, is_active: true } });
    if (adminCount > 0) {
      return reply.code(409).send({ error: 'setup already complete' });
    }

    const host = (request.body?.host || '').trim().replace(/\/+$/, '');
    if (!host) return reply.code(400).send({ error: 'host is required' });

    // B4 (NIST SC-7/AC-4): block IMDS + non-http(s) schemes before fetching.
    const ssrfError = ssrfReject(host);
    if (ssrfError) return reply.code(400).send({ error: `host blocked: ${ssrfError}` });

    try {
      const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(8_000) });
      if (!r.ok) {
        return reply.code(502).send({ error: `Ollama returned HTTP ${r.status}` });
      }
      const data: any = await r.json();
      const models: Array<{ name: string; size?: number }> = data?.models || [];
      const chat = models.filter((m) => !isEmbed(m.name)).map((m) => m.name);
      const embed = models.filter((m) => isEmbed(m.name)).map((m) => m.name);
      return { ok: true, host, chat, embed, total: models.length };
    } catch (err: any) {
      return reply.code(502).send({
        error: `Could not reach Ollama at ${host}: ${err?.message || String(err)}`,
      });
    }
  });

  // ─── POST /api/setup/complete ────────────────────────────────────────────
  fastify.post<{ Body: CompleteBody }>('/complete', async (request, reply) => {
    const { adminEmail, adminPassword, ollamaHost, chatModel, embedModel, magicToken } =
      request.body || ({} as CompleteBody);

    // Field validation — keep messages user-facing, the wizard surfaces these directly.
    if (!adminEmail || !/.+@.+\..+/.test(adminEmail))
      return reply.code(400).send({ error: 'adminEmail must be a valid email' });
    if (!adminPassword || adminPassword.length < 8)
      return reply.code(400).send({ error: 'adminPassword must be at least 8 characters' });
    if (!ollamaHost || !/^https?:\/\//.test(ollamaHost))
      return reply.code(400).send({ error: 'ollamaHost must include http:// or https://' });
    if (!chatModel) return reply.code(400).send({ error: 'chatModel is required' });
    // Embed model is OPTIONAL — chat-only installs are valid.

    // Idempotency / overwrite guard: if an admin or provider already exists,
    // require MAGIC_BOOT_TOKEN. Same secret the install.sh prints; the wizard
    // forwards it from sessionStorage when the page is opened via the magic link.
    const [existingAdminCount, existingProviderCount] = await Promise.all([
      prisma.user.count({ where: { is_admin: true } }),
      prisma.lLMProvider.count({ where: { name: 'ollama' } }),
    ]);
    if ((existingAdminCount > 0 || existingProviderCount > 0)) {
      const boot = process.env.MAGIC_BOOT_TOKEN;
      if (!boot || boot.length < 16 || boot !== magicToken) {
        return reply.code(409).send({
          error: 'setup already complete',
          hint: 'Admin / provider already exists. Pass magicToken (from MAGIC_BOOT_TOKEN) to overwrite, or sign in at /login.',
        });
      }
    }

    const cleanHost = ollamaHost.trim().replace(/\/+$/, '');

    // Build user + provider + model rows in one transaction so a partial
    // setup never leaves the stack half-wired.
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    let userId: string;
    try {
      userId = await prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { email: adminEmail.toLowerCase() },
          update: {
            password_hash: passwordHash,
            is_admin: true,
            is_active: true,
            force_password_change: false,
            updated_at: new Date(),
          },
          create: {
            email: adminEmail.toLowerCase(),
            name: 'Admin',
            password_hash: passwordHash,
            is_admin: true,
            is_active: true,
            oauth_provider: 'local',
            groups: ['admin'],
          },
        });

        const provider = await tx.lLMProvider.upsert({
          where: { name: 'ollama' },
          update: {
            display_name: 'Ollama (bootstrap)',
            provider_type: 'ollama',
            enabled: true,
            provider_config: { baseUrl: cleanHost },
            auth_config: { type: 'none' },
            capabilities: { chat: true, embeddings: !!embedModel, tools: true, streaming: true },
            is_chat_provider: true,
            is_embedding_provider: !!embedModel,
            updated_by: user.id,
            version: { increment: 1 },
            deleted_at: null,
          },
          create: {
            name: 'ollama',
            display_name: 'Ollama (bootstrap)',
            provider_type: 'ollama',
            enabled: true,
            priority: 10,
            provider_config: { baseUrl: cleanHost },
            auth_config: { type: 'none' },
            capabilities: { chat: true, embeddings: !!embedModel, tools: true, streaming: true },
            is_chat_provider: true,
            is_embedding_provider: !!embedModel,
            created_by: user.id,
          },
        });

        // Chat role — pin the user's choice as the default reasoning model.
        // capabilities is REQUIRED for SmartModelRouter to attach tools to
        // completions (see SmartModelRouter.createProfileFromDiscovery —
        // missing capabilities → all flags resolve to false, the model gets
        // zero tools, and every tool-using chat turn fails silently).
        const chatCaps = {
          chat: true,
          streaming: true,
          jsonMode: true,
          functionCalling: true,
          functionCallingAccuracy: 0.78,
          maxContextTokens: 8192,
          maxOutputTokens: 4096,
        };
        await tx.modelRoleAssignment.upsert({
          where: { role_model_provider: { role: 'chat', model: chatModel, provider: 'ollama' } } as any,
          update: { enabled: true, priority: 10, capabilities: chatCaps, updated_at: new Date() },
          create: {
            role: 'chat',
            model: chatModel,
            provider: 'ollama',
            enabled: true,
            priority: 10,
            capabilities: chatCaps,
            created_by: user.id,
          },
        });

        if (embedModel) {
          const embedCaps = {
            embeddings: true,
            streaming: false,
            maxContextTokens: 8192,
          };
          await tx.modelRoleAssignment.upsert({
            where: { role_model_provider: { role: 'embedding', model: embedModel, provider: 'ollama' } } as any,
            update: { enabled: true, priority: 10, capabilities: embedCaps, updated_at: new Date() },
            create: {
              role: 'embedding',
              model: embedModel,
              provider: 'ollama',
              enabled: true,
              priority: 10,
              capabilities: embedCaps,
              created_by: user.id,
            },
          });
        }

        return user.id;
      });
    } catch (err: any) {
      loggers.routes.error({ err: err?.message, stack: err?.stack }, '[setup] transaction failed');
      return reply.code(500).send({ error: 'setup transaction failed', detail: err?.message });
    }

    // Mint JWT — same shape as /api/auth/local/login so middleware accepts it.
    const signingSecret = (await getJWTSecret().catch(() => null)) || process.env.JWT_SECRET || process.env.SIGNING_SECRET;
    if (!signingSecret) {
      return reply.code(500).send({ error: 'JWT_SECRET / SIGNING_SECRET not configured' });
    }
    const token = jwt.sign(
      { userId, email: adminEmail.toLowerCase(), name: 'Admin', isAdmin: true },
      signingSecret,
      { expiresIn: '24h' },
    );
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.userSession.create({
      data: {
        user_id: userId,
        token,
        expires_at: expiresAt,
        last_accessed_at: new Date(),
        is_active: true,
        ip_address: request.ip,
        user_agent: request.headers['user-agent'] || 'setup-wizard',
      },
    });

    loggers.routes.info({ email: adminEmail, ollamaHost: cleanHost, chatModel, embedModel }, '[setup] complete');
    return { token, user: { id: userId, email: adminEmail.toLowerCase(), isAdmin: true } };
  });
};
