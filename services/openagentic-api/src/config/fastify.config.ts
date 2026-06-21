/**
 * createServer() — Phase 1 of server.ts decomposition.
 *
 * Constructs and configures the bare Fastify instance:
 *   - Fastify constructor options (logger, body limits, proxy trust)
 *   - Custom JSON content-type parser (empty-body tolerance)
 *   - onRequest hook for metrics/health-aware logging
 *   - CORS allowed-origins computation + fastify-cors registration
 *   - fastify-cookie registration
 *   - Rate-limiting (admin-configurable via Redis)
 *   - Swagger / SwaggerUI registration + shared schema population
 *   - Multipart + WebSocket support
 *
 * This is a 1:1 mechanical extract from server.ts — NO behaviour changes.
 * The caller (server.ts) replaces the inline block with:
 *
 *   const server = await createServer();
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { swaggerOptions, swaggerUiOptions } from './swagger.config.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

/**
 * Fastify body-size ceiling for ALL POST/PUT/PATCH requests.
 *
 * Sev-1 #792 — kept comfortably above the chat UI's per-attachment cap
 * (`routes/chat/handlers/attachmentValidator.ts` → MAX_ATTACHMENT_SIZE_BYTES
 * = 25 MiB). The chat-stream POST inlines base64-encoded attachments, so
 * the wire body is ~4/3 × raw bytes plus JSON envelope. 100 MiB gives us
 * headroom for multi-file uploads and large screenshots while keeping
 * the platform safe from accidental gigabyte uploads.
 *
 * Floor is 30 MiB (25 MiB UI cap + 5 MiB envelope/headroom); the pinned
 * regression test at `src/config/__tests__/fastify-body-limit.test.ts`
 * fails if this ever drops below that floor. Companion UI fix lives in
 * the openagentic-ui Dockerfile (chainguard nginx stub rip — commits
 * 8883e8de + 9ce4546e).
 */
export const FASTIFY_BODY_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MiB = 104_857_600 bytes

export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    pluginTimeout: 60000, // 60 second plugin timeout
    bodyLimit: FASTIFY_BODY_LIMIT_BYTES, // Sev-1 #792 — see FASTIFY_BODY_LIMIT_BYTES doc above
    // Trust proxy headers (X-Forwarded-Proto, X-Forwarded-For, etc.)
    // Required when running behind reverse proxy (nginx, k8s ingress) for:
    // - Correct HTTPS detection for secure cookies
    // - Proper client IP detection
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      serializers: {
        req: (req: any) => {
          // Skip serialization for health and metrics endpoints
          if (req.url === '/health' || req.url === '/api/health' ||
              req.url?.startsWith('/health/') ||
              req.url === '/metrics' || req.url === '/api/metrics') {
            return undefined;
          }
          return {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip,
            remotePort: req.socket?.remotePort
          };
        },
        res: (res: any) => ({
          statusCode: res.statusCode
        })
      },
      // Ignore noisy endpoints in request logging to reduce log spam
      hooks: {
        logMethod(inputArgs: any[], method: any) {
          const url = inputArgs[0]?.req?.url;

          // Skip ALL logging for health checks and metrics endpoints
          if (url === '/health' || url === '/api/health' ||
              url?.startsWith('/health/') ||
              url === '/metrics' || url === '/api/metrics') {
            // Completely skip logging for these endpoints
            return;
          }
          return method.apply(this, inputArgs);
        }
      }
    },
    disableRequestLogging: false,
    requestIdLogLabel: 'reqId',
  });

  // Custom JSON content type parser that handles empty bodies gracefully
  // This fixes FST_ERR_CTP_EMPTY_JSON_BODY errors when clients send Content-Type: application/json with empty body
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
    try {
      // Handle empty body - return empty object instead of error
      if (!body || body.trim() === '') {
        done(null, {});
        return;
      }
      const json = JSON.parse(body);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Custom request hook to handle metrics logging
  server.addHook('onRequest', async (request, reply) => {
    const start = Date.now();

    // Add finish handler for custom logging
    reply.raw.on('finish', () => {
      const duration = Date.now() - start;

      // Special handling for metrics endpoint - minimal logging
      if (request.url === '/metrics' || request.url === '/api/metrics') {
        // Only log if there's an error or it's slow
        if (reply.statusCode >= 400 || duration > 100) {
          loggers.server.warn({
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            duration
          }, `Metrics scrape: ${reply.statusCode} in ${duration}ms`);
        }
        // Skip normal logging for successful, fast metrics requests
        return;
      }

      // Skip health check and metrics logging for successful requests to reduce noise
      if (!request.url.startsWith('/health') && !request.url.startsWith('/api/health') && !request.url.startsWith('/metrics')) {
        const logMethod = reply.statusCode >= 500 ? 'error' :
                          reply.statusCode >= 400 ? 'warn' :
                          'debug'; // Use debug for normal requests to reduce noise

        loggers.server[logMethod]({
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          duration,
          userAgent: request.headers['user-agent'],
          ip: request.ip
        }, `${request.method} ${request.url} ${reply.statusCode} ${duration}ms`);
      }
    });
  });

  // Configure CORS to only allow frontend
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
        process.env.FRONTEND_URL || 'http://openagentic-ui:3000',
        `http://openagentic-ui:${process.env.UI_PORT || '3000'}`,
        `http://${process.env.API_HOST || 'openagentic-api'}:${process.env.API_PORT || '8000'}`,
        'http://localhost',       // Local through Caddy (port 80)
        'http://localhost:3000',  // Local development
        'http://localhost:3001',  // Alternative local port
        'http://127.0.0.1',       // IP-based through Caddy (port 80)
        'http://127.0.0.1:3000',  // IP-based local access
        'http://127.0.0.1:3001'   // Alternative IP-based local port
      ].filter((origin): origin is string => Boolean(origin));

  // Register cookie parser for cookie-based auth
  await server.register(fastifyCookie, {
    secret: process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => {
      const s = require('crypto').randomBytes(64).toString('hex');
      console.error('[CRITICAL] Neither JWT_SECRET nor SIGNING_SECRET is set — using ephemeral cookie secret');
      return s;
    })(),
    parseOptions: {}
  });

  await server.register(cors as any, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return cb(null, true);

      // Check if origin is allowed (exact match to prevent subdomain spoofing)
      if (allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-User-ID',
      'X-OpenAgentic-Frontend',
      'X-Timestamp',
      'X-Signature',
    ],
  });

  // Register Prisma client
  server.decorate('prisma', prisma);

  // Rate limiting -- per-user, configurable via admin console (admin_settings table)
  // Defaults are sensible fallbacks; admin can override via Admin > Platform Settings
  //
  // Operator escape hatches:
  //   RATE_LIMIT_DISABLED=1         → skip registration entirely (dev clusters)
  //   NODE_ENV=development          → 100k/min ceiling so dev never self-DOSes
  //                                    while still exercising the middleware path
  //
  // The historical 300/min admin ceiling was hostile to the v3 Dashboard, which
  // legit fans out ~25 hooks (incl. ~96 Prom proxy calls) on mount. Bumped to
  // 2000/min for admins; the Redis SoT (`platform:rate_limits`) still overrides
  // both. Dashboard Prom-fanout coalescing is the deeper fix tracked separately.
  if (process.env.RATE_LIMIT_DISABLED === '1' || process.env.RATE_LIMIT_DISABLED === 'true') {
    loggers.server.info('Rate limiting DISABLED via RATE_LIMIT_DISABLED env var — skipping registration');
  } else try {
    const isDev = process.env.NODE_ENV === 'development';
    const rateLimit = (await import('@fastify/rate-limit')).default;
    await server.register(rateLimit, {
      // Dynamic max: read from Redis (set by admin console at platform:rate_limits)
      // Admin can update live without restart via Admin > Platform Settings
      max: async (request: any) => {
        if (isDev) return 100000;
        try {
          const { getRedisClient } = await import('../utils/redis-client.js');
          const redis = getRedisClient();
          const configStr = await redis.get('platform:rate_limits');
          const config = configStr ? JSON.parse(configStr) : null;
          const isAdmin = request.user?.isAdmin || request.user?.role === 'admin';
          if (isAdmin) return config?.adminMax || 2000;
          const tier = request.user?.rateLimitTier || 'default';
          return config?.tiers?.[tier] || config?.defaultMax || 300;
        } catch {
          // Fallback when Redis unavailable: admins get generous limit
          const isAdmin = request.user?.isAdmin || request.user?.role === 'admin';
          return isAdmin ? 2000 : 300;
        }
      },
      timeWindow: '1 minute',
      keyGenerator: (request: any) => {
        return request.user?.userId || request.user?.id || request.ip;
      },
      allowList: (request: any) => {
        // Internal services (openagentic-proxy, mcp-proxy, workflows, internal)
        // call api dozens of times per multi_agent run — agent config
        // resolution, MCP tool list, execution persistence. Treating those
        // calls as a single user against the per-IP 120/min budget caused
        // 429 storms that broke multi_agent flows after the network policy
        // unblocked workflows → openagentic-proxy on 2026-04-26. They auth via
        // X-Internal-Secret in middleware/unifiedAuth, so they're already
        // a trusted service principal — the IP-based throttle here is
        // double-counting and harmful.
        const from = String(request.headers['x-request-from'] || '').toLowerCase();
        const INTERNAL = new Set(['internal', 'openagentic-proxy', 'mcp-proxy', 'workflows']);
        const isInternal = INTERNAL.has(from);
        const isHealth = request.url === '/health' || request.url === '/api/health';
        // WebSocket upgrades MUST be exempt — rate limiting WS handshakes
        // causes rapid connect/disconnect storms that break live WS streams.
        const isWebSocket = request.url?.includes('/ws/') || request.headers?.upgrade === 'websocket';
        // Admin telemetry/observability proxies — the v3 Dashboard fans
        // out ~96 prom/query+query_range hits + mcp-logs polls on mount.
        // These are admin-only read-only metric reads (gated by RBAC in
        // the route handler); they pass through the api purely because
        // the browser can't reach Prom/Loki directly through the cluster
        // NetworkPolicy. They aren't user-driven traffic and shouldn't
        // count against an admin's per-user budget — they need a private
        // route. User direction 2026-05-14.
        const url = request.url || '';
        const isAdminTelemetryProxy =
          url.startsWith('/api/admin/prom/') ||
          url.startsWith('/api/admin/mcp-logs') ||
          url.startsWith('/api/admin/cluster/health') ||
          url.startsWith('/api/admin/dashboard/metrics');
        return isInternal || isHealth || isWebSocket || isAdminTelemetryProxy;
      },
      errorResponseBuilder: (_request: any, context: any) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Max ${context.max} requests per ${context.after}. Try again later.`,
      }),
    });
    loggers.server.info('Rate limiting enabled (admin-configurable via admin_settings.rate_limits)');
  } catch (err: any) {
    loggers.server.warn({ error: err.message }, 'Rate limiting not available -- continuing without');
  }

  // Register Swagger/OpenAPI documentation
  await server.register(swagger, swaggerOptions);
  await server.register(swaggerUi, swaggerUiOptions);
  loggers.server.info('Swagger/OpenAPI documentation registered at /api/swagger');

  // Register shared schemas with Fastify so $ref works in route schemas
  // These schemas are also defined in swagger.config.ts for OpenAPI spec
  const sharedSchemas = swaggerOptions.openapi?.components?.schemas;
  if (sharedSchemas) {
    for (const [schemaName, schemaDefinition] of Object.entries(sharedSchemas)) {
      server.addSchema({
        $id: `#/components/schemas/${schemaName}`,
        ...(schemaDefinition as object)
      });
    }
    loggers.server.info(`Registered ${Object.keys(sharedSchemas).length} shared schemas with Fastify`);
  }

  return server;
}
