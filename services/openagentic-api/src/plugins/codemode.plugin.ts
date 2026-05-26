import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import type { AppContext } from '../context/AppContext.js';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';
import { featureFlags } from '../config/featureFlags.js';
import codeRoutes from '../routes/code.js';
import codePluginsRoutes from '../routes/code-plugins.js';
import codeModeProvisioningRoutes from '../routes/code-mode-provisioning.js';
import { registerInternalUserStorageRoute } from '../routes/code-mode/internal-user-storage.route.js';
import { registerInternalCodemodeModelRoute } from '../routes/code-mode/internal-codemode-model.route.js';
import { registerInternalBucketSeedRoute } from '../routes/code-mode/internal-bucket-seed.route.js';
import { registerPreviewProxyRoute } from '../routes/code-mode/preview-proxy.handler.js';
import {
  registerCodeModeCollectionsRoute,
  type CollectionsCodeModeService,
} from '../routes/code-mode/collections.route.js';
import { codeModeMilvusService } from '../services/CodeModeMilvusService.js';
import {
  UserStorageService,
  createAxiosMinioAdminOps,
  type K8sSecretSpec,
  type K8sSecretWriter,
} from '../services/UserStorageService.js';
import { registerResolveRoute } from '../routes/code-ws/resolve.js';
import { registerTerminalWsRoute } from '../routes/code-ws/terminal.js';
import { registerProgressWsRoute } from '../routes/code-ws/progress.js';
import {
  registerChatV1LegacyGate,
  registerChatV2DualMount,
} from '../routes/code-ws/chat.js';
import { registerEventsWsRoute } from '../routes/code-ws/events.js';
import type { ProviderManager } from '../services/llm-providers/ProviderManager.js';

// OSS stubs — pending sync of admin-code/codemode-admin routes
const adminCodeRoutes: any = undefined;
const codemodeAdminRoutes: any = undefined;
const getCodemodeConfigBundle: any = async () => ({ pending: true });


// ---------------------------------------------------------------------------
// Plugin options (lesson 3: strongly typed, lesson 6: exported)
// ---------------------------------------------------------------------------

export interface CodemodeRoutesPluginOptions {
  /**
   * Optional: override providerManager from AppContext.
   * Used for code routes that need LLM provider access.
   * When undefined, the plugin reads ctx.providerManager from the decorated
   * Fastify instance (fastify.app.providerManager).
   */
  providerManager?: ProviderManager;
}

// ---------------------------------------------------------------------------
// CSI-S3 T5 helpers — production UserStorageService factory.
//
// Kept local to this plugin so the codemode routes stay self-contained.
// The factory runs once per ensure-user-bucket request — no shared state.
// ---------------------------------------------------------------------------

/**
 * Ambient modules resolved ONCE at plugin registration via dynamic import.
 * Passed into `buildProductionUserStorageService` so the factory stays
 * synchronous and safe to call per-request. Previously this function used
 * `require(...)` for all three modules which threw `require is not defined`
 * under the ESM build — breaking every ensure-user-bucket call.
 */
interface ProductionUserStorageDeps {
  minio: typeof import('minio');
  axios: typeof import('axios').default;
  k8s: typeof import('@kubernetes/client-node');
}

function buildProductionUserStorageService(
  fastify: FastifyInstance,
  deps: ProductionUserStorageDeps,
): UserStorageService {
  const { Client: MinioClient } = deps.minio;

  // Precedence mirrors BlobStorageService.ts (#347): STORAGE_ENDPOINT is
  // the canonical env the helm chart stamps on every workload. MINIO_ENDPOINT
  // is a legacy alias that, in the current k3s chart, happens to carry a
  // stale `openagentic-minio` short-name — no such Service exists, so DNS
  // leaks to an external resolver and we get ECONNREFUSED to a public IP.
  const endpointStr = process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT || 'minio:9000';
  const useSSL =
    process.env.MINIO_USE_SSL === 'true' || endpointStr.startsWith('https://');
  const cleaned = endpointStr.replace(/^https?:\/\//, '');
  const [host, portStr] = cleaned.split(':');
  const port = portStr ? parseInt(portStr, 10) : useSSL ? 443 : 9000;

  // Same precedence flip: STORAGE_* is canonical (set by chart), MINIO_* is legacy.
  const rootAccessKey =
    process.env.STORAGE_ACCESS_KEY ||
    process.env.MINIO_ROOT_USER ||
    process.env.MINIO_ACCESS_KEY ||
    'minioadmin';
  const rootSecretKey =
    process.env.STORAGE_SECRET_KEY ||
    process.env.MINIO_ROOT_PASSWORD ||
    process.env.MINIO_SECRET_KEY ||
    'minioadmin';

  const minioClient = new MinioClient({
    endPoint: host,
    port,
    useSSL,
    accessKey: rootAccessKey,
    secretKey: rootSecretKey,
  });

  // Admin ops intentionally DISABLED — modern MinIO's /minio/admin/v3/*
  // endpoints require madmin argon2id + sio-go-encrypted payloads, not the
  // plaintext SigV4 requests our `createAxiosMinioAdminOps` built. Calling
  // add-user with plaintext returns HTTP 426 "Upgrade Required" and every
  // codemode login 500s on ensure-user-bucket.
  //
  // Without adminOps, UserStorageService falls back to writing the MinIO
  // ROOT creds into the per-user k8s Secret. That Secret is consumed by the
  // CSI-S3 provisioner in kube-system; it is NOT mounted into the user's
  // exec pod, so user code cannot read the creds at runtime. Bucket-level
  // isolation is preserved via the PVC only mounting the user's own bucket.
  //
  // The follow-up to restore per-user IAM is tracked separately — reinstate
  // this block once the admin client supports the madmin encryption scheme.
  void createAxiosMinioAdminOps;

  const k8sSecretWriter: K8sSecretWriter = {
    async write(spec: K8sSecretSpec): Promise<void> {
      const k8s = deps.k8s;
      const kc = new k8s.KubeConfig();
      kc.loadFromDefault();
      const api = kc.makeApiClient(k8s.CoreV1Api);
      const stringData = spec.data;
      const body: import('@kubernetes/client-node').V1Secret = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: spec.name, namespace: spec.namespace },
        type: 'Opaque',
        stringData,
      };
      try {
        await api.createNamespacedSecret({ namespace: spec.namespace, body });
      } catch (err: unknown) {
        const statusCode =
          (err as { statusCode?: number; code?: number }).statusCode ??
          (err as { statusCode?: number; code?: number }).code;
        if (statusCode === 409) {
          await api.replaceNamespacedSecret({
            name: spec.name,
            namespace: spec.namespace,
            body,
          });
          return;
        }
        throw err;
      }
    },
    async exists(name: string, namespace: string): Promise<boolean> {
      const k8s = deps.k8s;
      const kc = new k8s.KubeConfig();
      kc.loadFromDefault();
      const api = kc.makeApiClient(k8s.CoreV1Api);
      try {
        await api.readNamespacedSecret({ name, namespace });
        return true;
      } catch (err: unknown) {
        const statusCode =
          (err as { statusCode?: number; code?: number }).statusCode ??
          (err as { statusCode?: number; code?: number }).code;
        if (statusCode === 404) return false;
        throw err;
      }
    },
  };

  const namespace = featureFlags.k8sNamespace;

  // csi-s3 needs a full URL (`scheme://host:port`), not the cleaned host-only
  // form we feed to the minio SDK. Reassemble it so the per-user Secret's
  // `endpoint` field is non-empty (csi-s3 rejects blank endpoints with
  // "Endpoint: does not follow ip address or domain name standards").
  const storageEndpoint = `${useSSL ? 'https' : 'http'}://${host}:${port}`;

  return new UserStorageService({
    minioClient,
    rootAccessKey,
    rootSecretKey,
    storageEndpoint,
    k8sSecretWriter,
    logger: {
      info: (...a) => fastify.log.info(a),
      warn: (...a) => fastify.log.warn(a),
      error: (...a) => fastify.log.error(a),
      debug: (...a) => fastify.log.debug(a),
    },
    namespace,
  });
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

const codemodeRoutesPluginImpl: FastifyPluginAsync<CodemodeRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  options: CodemodeRoutesPluginOptions,
) => {
  loggers.routes.info('Registering codemode routes plugin...');

  const providerManager = options.providerManager ?? (fastify.app as AppContext | undefined)?.providerManager;

  // ── 1: Code health endpoint (NO auth) ─────────────────────────────────────
  // Kept as inline fast handler — no external module needed for a one-liner proxy.
  try {
    const CODE_MANAGER_URL = featureFlags.codeManagerUrl;

    fastify.get('/api/code/health', async (request, reply) => {
      try {
        const response = await fetch(`${CODE_MANAGER_URL}/health`);
        if (response.ok) {
          const health = await response.json();
          return reply.send(health);
        }
        return reply.code(503).send({ status: 'unhealthy', error: 'Manager not responding' });
      } catch (error: any) {
        return reply.code(503).send({ status: 'unhealthy', error: error.message });
      }
    });

    loggers.routes.info('Code health endpoint registered at /api/code/health (no auth)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code health endpoint');
  }

  // ── 2: Code access-check endpoint (internal service auth) ─────────────────
  // Supports lookup by either `id` or `azure_oid`.
  try {
    fastify.get('/api/code/access-check', async (request: any, reply: any) => {
      // SECURITY: Require internal service secret to prevent unauthenticated user enumeration
      const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
      const providedKey = request.headers['x-internal-api-key'] || request.headers['x-internal-secret'];
      if (internalSecret && providedKey !== internalSecret) {
        return reply.code(403).send({ error: 'Forbidden', hasAccess: false });
      }
      const userId = request.query?.userId;
      if (!userId) {
        return reply.code(400).send({ error: 'userId required', hasAccess: false });
      }
      try {
        // Try to find user by id first (handles both "azure_" prefixed IDs and local user IDs)
        let user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, is_admin: true, code_enabled: true, groups: true }
        });

        // If not found by id, try azure_oid (raw Azure OID from MCP proxy JWT tokens)
        if (!user) {
          user = await prisma.user.findFirst({
            where: { azure_oid: userId },
            select: { id: true, is_admin: true, code_enabled: true, groups: true }
          });
          if (user) {
            loggers.routes.debug({ rawOid: userId, resolvedId: user.id }, 'MCP access check resolved azure_oid to user id');
          }
        }

        if (!user) {
          loggers.routes.warn({ userId }, 'MCP access check - user not found by id or azure_oid');
          return reply.send({ hasAccess: false, reason: 'user_not_found' });
        }
        // Grant access if code_enabled OR isAdmin
        const hasAccess = user.code_enabled || user.is_admin;
        loggers.routes.info({ userId, resolvedId: user.id, hasAccess, isAdmin: user.is_admin, codeEnabled: user.code_enabled }, 'MCP access check');
        return reply.send({ hasAccess, userId: user.id, isAdmin: user.is_admin });
      } catch (error: any) {
        return reply.code(500).send({ hasAccess: false, error: error.message });
      }
    });

    loggers.routes.info('Code access-check endpoint registered at /api/code/access-check (no auth - internal MCP use)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code access-check endpoint');
  }

  // ── 2b: /api/internal/code-mode/ensure-user-bucket (CSI-S3 T5) ────────────
  // cm (code-manager) calls this in-cluster before creating a user's exec
  // pod. The route is gated by X-Internal-API-Key, matching every other
  // cm↔api internal surface (see admin-code.ts, agenticode.ts, relay-ws).
  try {
    const { getInternalKey } = await import('../utils/internalKeyReader.js');
    const internalKey = getInternalKey();
    // Resolve the three lazy modules once at plugin registration time. We
    // dynamic-import instead of `require(...)` so the ESM-compiled output
    // doesn't throw `require is not defined` on the first request (the
    // original 500 on ensure-user-bucket that stalled cm's pod boot).
    const [minioMod, axiosMod, k8sMod] = await Promise.all([
      import('minio'),
      import('axios'),
      import('@kubernetes/client-node'),
    ]);
    const userStorageDeps: ProductionUserStorageDeps = {
      minio: minioMod,
      axios: axiosMod.default,
      k8s: k8sMod,
    };
    registerInternalUserStorageRoute(fastify, {
      internalKey,
      userStorageServiceFactory: () => buildProductionUserStorageService(fastify, userStorageDeps),
    });
    loggers.routes.info('Internal user-storage route registered at /api/internal/code-mode/ensure-user-bucket (X-Internal-API-Key gated)');

    // ── Phase I (2026-04-29) ────────────────────────────────────────────────
    // /api/internal/codemode-default-model — cm reads this BEFORE spawning a
    // user pod, so the registry-canonical default code model lands on the
    // pod env (AGENTICODE_BOOT_MODEL) instead of a helm-baked literal. Same
    // X-Internal-API-Key gate as ensure-user-bucket. Resolver wraps the
    // ModelConfigurationService SoT — admin edits in the Default Models page
    // propagate within cm's 60s cache window.
    const ModelConfigurationServiceMod = await import('../services/ModelConfigurationService.js');
    registerInternalCodemodeModelRoute(fastify, {
      internalKey,
      resolveDefaultCodeModel: () =>
        ModelConfigurationServiceMod.ModelConfigurationService.getDefaultCodeModel(),
    });
    loggers.routes.info('Internal codemode default-model route registered at /api/internal/codemode-default-model (X-Internal-API-Key gated)');

    // ── A.11 ───────────────────────────────────────────────────────────────
    // /api/internal/code-mode/seed-bucket-subdir — cm calls this AFTER the
    // CSI-S3 PVC binds, passing the real pvc-<volumeHandle> bucket name so
    // geesefs sees the per-user subdir on first mount. Same X-Internal-API-Key
    // gate and UserStorageService factory as ensure-user-bucket.
    registerInternalBucketSeedRoute(fastify, {
      internalKey,
      userStorageServiceFactory: () => buildProductionUserStorageService(fastify, userStorageDeps),
    });
    loggers.routes.info('Internal bucket-seed route registered at /api/internal/code-mode/seed-bucket-subdir (X-Internal-API-Key gated)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register internal user-storage route');
  }

  // ── 3: Main code routes block (auth-gated) ─────────────────────────────────
  // codeRoutes + codePluginsRoutes + codeModeProvisioningRoutes behind authMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(codeRoutes, {
        providerManager: providerManager as any
      });
      // Plugin marketplace routes (browse, install, manage)
      await instance.register(codePluginsRoutes);
      loggers.routes.info('Code plugin marketplace routes registered');

      // Code Mode provisioning routes (user environment setup)
      await instance.register(codeModeProvisioningRoutes, { prefix: '/provisioning' });
      loggers.routes.info('Code Mode provisioning routes registered at /api/code/provisioning/*');
    }, { prefix: '/api/code' });

    loggers.routes.info('AgenticWorkCode routes registered at /api/code/* with auth middleware (health endpoint unauthenticated)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code routes');
  }

  // ── 3.5: /api/code-mode/collections (auth-gated) ──────────────────────────
  // Per-user Milvus collections + indexed file metadata for the Collections
  // sidebar in services/openagentic-ui. Strictly user-scoped: every handler
  // computes the canonical collection name from request.user.id and 403s any
  // attempt to read another user's collection by URL parameter.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      const collectionsService: CollectionsCodeModeService = {
        getUserCollection: (userId) => codeModeMilvusService.getUserCollectionSummary(userId),
        listUserFiles: (userId) => codeModeMilvusService.listUserFiles(userId),
        getCollectionName: (userId) => codeModeMilvusService.getCollectionName(userId),
      };
      registerCodeModeCollectionsRoute(instance, { service: collectionsService });
    });
    loggers.routes.info('CodeMode collections routes registered at /api/code-mode/collections (authMiddleware)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register codemode collections route');
  }

  // ── 4: /api/code/ws/resolve (auth preHandler) ─────────────────────────────
  try {
    registerResolveRoute(fastify);
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code WS resolve route');
  }

  // ── 5: /api/code/ws/terminal (WebSocket proxy) ────────────────────────────
  try {
    await registerTerminalWsRoute(fastify);
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code terminal WebSocket proxy');
  }

  // ── 6: /api/code/ws/progress (WebSocket proxy + CCR short-circuit) ────────
  try {
    await registerProgressWsRoute(fastify);
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code progress WebSocket proxy');
  }

  // ── 7: /api/code/ws/chat (legacy v1 4410 gate) ────────────────────────────
  try {
    registerChatV1LegacyGate(fastify);
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register v1 WS 4410 gate');
  }

  // ── 8: /api/code/v2/ws/chat + boot-events (CCR dual-mount) ────────────────
  // Runtime branch: CODEMODE_USE_CCR_RELAY=1 → CCR relay; else → chat-pipeline-direct.
  // Branch decision is inside registerChatV2DualMount() — not inside route definitions.
  try {
    await registerChatV2DualMount(fastify, {
      chatStorage: (fastify.app as AppContext | undefined)?.chatStorage,
      providerManager,
    });
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register codemode v2 chat / boot-events routes');
  }

  // ── 9: /api/code/ws/events (WebSocket proxy to code manager) ──────────────
  try {
    await registerEventsWsRoute(fastify);
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code events WebSocket proxy');
  }

  // ── 9b: /api/code/preview/:sid/:port/* (HTTP + WS path-proxy) ─────────────
  // Lets the codemode UI iframe a dev server running INSIDE the user's
  // pod via a same-origin URL — no port-forward, no wildcard ingress.
  // Auth-gated per request; user A can't reach user B's pod (the
  // sessionEntry.userId vs token.userId match is in
  // decideProxyAuth — pinned by preview-proxy.test.ts). Companion
  // route /api/internal/code-mode/preview-port lets the daemon
  // populate the per-session port whitelist.
  try {
    const { getRedisClient } = await import('../utils/redis-client.js');
    const redis = getRedisClient();
    if (!redis) {
      loggers.routes.warn('[preview-proxy] Redis not available — skipping registration');
    } else {
      await registerPreviewProxyRoute(fastify, { logger: loggers.routes, redis });
    }
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register codemode preview proxy');
  }

  // ── 10: /api/admin/code/* (admin-gated code management) ───────────────────
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminCodeRoutes);
    }, { prefix: '/api/admin/code' });
    loggers.routes.info('Admin AgenticWorkCode routes registered at /api/admin/code/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin code routes');
  }

  // ── 11: /api/admin/codemode/* + config-bundle-internal ────────────────────
  // Admin UI routes require auth; config-bundle-internal is open (exec daemon
  // calls it from inside the cluster).
  try {
    // Admin UI routes — require authentication
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(codemodeAdminRoutes);
    }, { prefix: '/api' });

    // Internal config-bundle endpoint — no auth (called by exec daemon in-cluster)
    fastify.get('/api/admin/codemode/config-bundle-internal', async (req, reply) => {
      try {
        const bundle = await getCodemodeConfigBundle();
        reply.send(bundle);
      } catch (err: any) {
        reply.status(500).send({ error: err.message });
      }
    });

    loggers.routes.info('CodeMode admin routes registered at /api/admin/codemode/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register codemode admin routes');
  }

  loggers.routes.info('Codemode routes plugin registered successfully');
};

export const codemodeRoutesPlugin = fp(codemodeRoutesPluginImpl, {
  name: 'codemode-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
