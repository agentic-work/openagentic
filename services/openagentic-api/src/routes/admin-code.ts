/**
 * Admin Code Routes
 * Administration endpoints for OpenAgenticCode management
 *
 * Features:
 * - Enable/disable code feature for users
 * - View and manage code sessions
 * - Monitor resource usage
 * - Configure storage backends
 * - View execution history
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';
import axios, { AxiosRequestConfig } from 'axios';
import { codeModeMilvusService } from '../services/CodeModeMilvusService.js';

// SECURITY: Internal API key for code-manager authentication
const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';

/**
 * Create axios config with internal authentication
 * All requests to code-manager must include the internal API key
 */
function createInternalAuthConfig(timeout = 10000): AxiosRequestConfig {
  const config: AxiosRequestConfig = { timeout };
  if (CODE_MANAGER_INTERNAL_KEY) {
    config.headers = {
      'X-Internal-API-Key': CODE_MANAGER_INTERNAL_KEY,
    };
  }
  return config;
}

// Types
interface EnableCodeBody {
  userId: string;
  enabled: boolean;
}

interface UpdateSessionBody {
  status?: 'active' | 'suspended' | 'deleted';
  securityLevel?: 'strict' | 'permissive' | 'minimal';
  networkEnabled?: boolean;
  cpuLimit?: number;
  memoryLimitMb?: number;
}

interface StorageBackendBody {
  name: string;
  displayName: string;
  backendType: 'minio' | 's3' | 'azure-blob' | 'gcs';
  connectionConfig: Record<string, any>;
  defaultBucket?: string;
  defaultRegion?: string;
  maxSnapshotSizeMb?: number;
  maxStoragePerUserMb?: number;
  retentionDays?: number;
  isDefault?: boolean;
}

interface SessionsQuery {
  userId?: string;
  status?: string;
  limit?: string;
  offset?: string;
}

interface ExecutionsQuery {
  sessionId?: string;
  userId?: string;
  status?: string;
  execType?: string;
  limit?: string;
  offset?: string;
}

// FIXED: Use correct service name - openagentic-manager (not the old openagenticcode-runtime)
const CODE_RUNTIME_URL = process.env.CODE_RUNTIME_URL || process.env.EXEC_URL || 'http://openagentic-exec:3060';

/**
 * Register admin code routes
 */
export default async function adminCodeRoutes(fastify: FastifyInstance) {
  // Middleware to check admin access
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user?.isAdmin) {
      reply.code(403).send({ error: 'Admin access required' });
      return;
    }
  });

  // ============================================================================
  // User Feature Management
  // ============================================================================

  /**
   * Get users with code feature status
   * GET /api/admin/code/users
   */
  fastify.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          code_enabled: true,
          created_at: true,
          last_login_at: true,
        },
        orderBy: { email: 'asc' },
      });

      // Get session counts per user
      const sessionCounts = await prisma.codeSession.groupBy({
        by: ['user_id'],
        _count: { id: true },
        where: { status: 'active' },
      });

      const sessionCountMap = new Map(
        sessionCounts.map((s) => [s.user_id, s._count.id])
      );

      const result = users.map((user) => ({
        ...user,
        activeSessions: sessionCountMap.get(user.id) || 0,
      }));

      return reply.send({ users: result });
    } catch (error) {
      request.log.error({ error }, 'Failed to get users');
      return reply.code(500).send({ error: 'Failed to get users' });
    }
  });

  /**
   * Enable/disable code feature for a user
   * POST /api/admin/code/users/:userId/enable
   */
  fastify.post<{ Params: { userId: string }; Body: EnableCodeBody }>(
    '/users/:userId/enable',
    async (request, reply) => {
      try {
        const { userId } = request.params;
        const { enabled } = request.body;

        const user = await prisma.user.update({
          where: { id: userId },
          data: { code_enabled: enabled },
          select: {
            id: true,
            email: true,
            code_enabled: true,
          },
        });

        request.log.info({ userId, enabled, adminId: request.user?.id }, 'Code feature toggled');

        return reply.send({
          message: `Code feature ${enabled ? 'enabled' : 'disabled'} for user`,
          user,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to update user code access');
        return reply.code(500).send({ error: 'Failed to update user' });
      }
    }
  );

  /**
   * Bulk enable/disable code feature
   * POST /api/admin/code/users/bulk-enable
   */
  fastify.post<{ Body: { userIds: string[]; enabled: boolean } }>(
    '/users/bulk-enable',
    async (request, reply) => {
      try {
        const { userIds, enabled } = request.body;

        const result = await prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: { code_enabled: enabled },
        });

        request.log.info(
          { count: result.count, enabled, adminId: request.user?.id },
          'Bulk code feature toggle'
        );

        return reply.send({
          message: `Code feature ${enabled ? 'enabled' : 'disabled'} for ${result.count} users`,
          count: result.count,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to bulk update users');
        return reply.code(500).send({ error: 'Failed to bulk update users' });
      }
    }
  );

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Get all code sessions
   * GET /api/admin/code/sessions
   */
  fastify.get<{ Querystring: SessionsQuery }>(
    '/sessions',
    async (request, reply) => {
      try {
        const { userId, status, limit = '50', offset = '0' } = request.query;

        const where: any = {};
        if (userId) where.user_id = userId;
        if (status) where.status = status;

        const [sessions, total] = await Promise.all([
          prisma.codeSession.findMany({
            where,
            include: {
              executions: {
                select: { id: true },
                take: 1,
              },
            },
            orderBy: { last_activity: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset),
          }),
          prisma.codeSession.count({ where }),
        ]);

        // Get user info for each session
        const userIds = [...new Set(sessions.map((s) => s.user_id))];
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        // Transform snake_case to camelCase for frontend
        const transformedSessions = sessions.map((session) => {
          const user = userMap.get(session.user_id);
          return {
            id: session.id,
            userId: session.user_id,
            userEmail: user?.email || 'Unknown',
            userName: user?.name || user?.email || 'Unknown',
            containerId: session.container_id,
            sliceId: session.slice_id,
            model: session.model,
            workspacePath: session.workspace_path,
            status: session.status,
            cpuLimit: session.cpu_limit,
            memoryLimitMb: session.memory_limit_mb,
            storageLimitMb: session.storage_limit_mb,
            securityLevel: session.security_level,
            networkEnabled: session.network_enabled,
            shell: session.shell,
            envVars: session.env_vars,
            installedPackages: session.installed_packages,
            totalExecutions: session.total_executions,
            totalTokens: session.total_tokens,
            totalCost: session.total_cost,
            createdAt: session.created_at,
            lastActivity: session.last_activity,
            updatedAt: session.updated_at,
            executionCount: session.executions?.length || 0,
          };
        });

        return reply.send({
          sessions: transformedSessions,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to get sessions');
        return reply.code(500).send({ error: 'Failed to get sessions' });
      }
    }
  );

  /**
   * Get session details
   * GET /api/admin/code/sessions/:sessionId
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        const session = await prisma.codeSession.findUnique({
          where: { id: sessionId },
          include: {
            executions: {
              orderBy: { created_at: 'desc' },
              take: 20,
            },
            snapshots: {
              orderBy: { created_at: 'desc' },
              take: 10,
            },
          },
        });

        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        // Get runtime status if session is active
        let runtimeStatus = null;
        if (session.status === 'active' && session.slice_id) {
          try {
            const response = await axios.get(
              `${CODE_RUNTIME_URL}/slices/${session.slice_id}`,
              createInternalAuthConfig(5000)
            );
            runtimeStatus = response.data;
          } catch {
            runtimeStatus = { error: 'Runtime unreachable' };
          }
        }

        return reply.send({ session, runtimeStatus });
      } catch (error) {
        request.log.error({ error }, 'Failed to get session');
        return reply.code(500).send({ error: 'Failed to get session' });
      }
    }
  );

  /**
   * Update session
   * PATCH /api/admin/code/sessions/:sessionId
   */
  fastify.patch<{ Params: { sessionId: string }; Body: UpdateSessionBody }>(
    '/sessions/:sessionId',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;
        const updates = request.body;

        const session = await prisma.codeSession.update({
          where: { id: sessionId },
          data: {
            ...(updates.status && { status: updates.status }),
            ...(updates.securityLevel && { security_level: updates.securityLevel }),
            ...(updates.networkEnabled !== undefined && { network_enabled: updates.networkEnabled }),
            ...(updates.cpuLimit && { cpu_limit: updates.cpuLimit }),
            ...(updates.memoryLimitMb && { memory_limit_mb: updates.memoryLimitMb }),
          },
        });

        return reply.send({ session });
      } catch (error) {
        request.log.error({ error }, 'Failed to update session');
        return reply.code(500).send({ error: 'Failed to update session' });
      }
    }
  );

  /**
   * Force delete session
   * DELETE /api/admin/code/sessions/:sessionId
   */
  fastify.delete<{ Params: { sessionId: string }; Querystring: { force?: string } }>(
    '/sessions/:sessionId',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;
        const { force = 'false' } = request.query;

        const session = await prisma.codeSession.findUnique({
          where: { id: sessionId },
        });

        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        // Kill slice in runtime if active
        if (session.slice_id && session.status === 'active') {
          try {
            await axios.delete(`${CODE_RUNTIME_URL}/slices/${session.slice_id}?snapshot=${force !== 'true'}`, createInternalAuthConfig());
          } catch (err) {
            request.log.warn({ err, sliceId: session.slice_id }, 'Failed to delete slice from runtime');
          }
        }

        // Mark as deleted in database
        await prisma.codeSession.update({
          where: { id: sessionId },
          data: { status: 'deleted' },
        });

        request.log.info({ sessionId, adminId: request.user?.id }, 'Session force deleted');

        return reply.send({ message: 'Session deleted' });
      } catch (error) {
        request.log.error({ error }, 'Failed to delete session');
        return reply.code(500).send({ error: 'Failed to delete session' });
      }
    }
  );

  /**
   * Restart a session
   * POST /api/admin/code/sessions/:sessionId/restart
   */
  fastify.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/restart',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        const session = await prisma.codeSession.findUnique({
          where: { id: sessionId },
        });

        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        // Restart session in runtime
        if (session.slice_id) {
          try {
            const response = await axios.post(
              `${CODE_RUNTIME_URL}/sessions/${session.slice_id}/restart`,
              {},
              createInternalAuthConfig(30000)
            );

            // Update session record with new slice ID if different
            if (response.data.newSession?.id && response.data.newSession.id !== session.slice_id) {
              await prisma.codeSession.update({
                where: { id: sessionId },
                data: {
                  slice_id: response.data.newSession.id,
                  status: 'active',
                  last_activity: new Date(),
                },
              });
            }

            request.log.info({ sessionId, adminId: request.user?.id }, 'Session restarted');
            return reply.send({
              message: 'Session restarted',
              newSliceId: response.data.newSession?.id,
            });
          } catch (err: any) {
            request.log.error({ err, sessionId }, 'Failed to restart session in runtime');
            return reply.code(500).send({ error: err.message || 'Failed to restart session' });
          }
        }

        return reply.code(400).send({ error: 'Session has no active runtime slice' });
      } catch (error) {
        request.log.error({ error }, 'Failed to restart session');
        return reply.code(500).send({ error: 'Failed to restart session' });
      }
    }
  );

  /**
   * Get live sessions from runtime (with enhanced metrics including storage)
   * GET /api/admin/code/sessions/live
   */
  fastify.get<{ Querystring: { metrics?: string } }>(
    '/sessions/live',
    async (request, reply) => {
      try {
        // Always use enhanced metrics endpoint for storage info
        const url = `${CODE_RUNTIME_URL}/sessions/all/metrics/enhanced`;

        const response = await axios.get(url, createInternalAuthConfig(15000));

        // Enrich with user info from database
        const sessions = response.data.sessions || response.data || [];
        const userIds = [...new Set(sessions.map((s: any) => s.userId))] as string[];

        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        const enrichedSessions = sessions.map((session: any) => {
          const user = userMap.get(session.userId);
          // Extract storage info from enhanced metrics
          const storageBytes = session.enhancedMetrics?.storageUsage?.totalBytes || 0;
          const storageLimitBytes = 5 * 1024 * 1024 * 1024; // 5GB limit
          return {
            ...session,
            userEmail: user?.email || 'Unknown',
            userName: user?.name || user?.email || 'Unknown',
            // Add storage info for display
            storageMB: Math.round(storageBytes / (1024 * 1024)),
            storagePercent: Math.round((storageBytes / storageLimitBytes) * 100),
            storageLimitMB: Math.round(storageLimitBytes / (1024 * 1024)),
          };
        });

        return reply.send(enrichedSessions);
      } catch (error: any) {
        request.log.error({ error: error.message }, 'Enhanced metrics endpoint failed, trying K8s pods fallback');

        // Fallback 1: Try getting actual K8s exec pods from manager
        try {
          const podsResponse = await axios.get(
            `${CODE_RUNTIME_URL}/admin/exec/pods`,
            createInternalAuthConfig(10000)
          );
          const pods = podsResponse.data.pods || [];

          // Filter to only user-assigned pods (not warm pool)
          const userPods = pods.filter((p: any) => p.userId && p.type !== 'warm');

          if (userPods.length > 0) {
            const userIds = [...new Set(userPods.map((p: any) => p.userId))] as string[];
            const users = await prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, email: true, name: true },
            });
            const userMap = new Map(users.map((u) => [u.id, u]));

            const podSessions = userPods.map((pod: any) => {
              const user = userMap.get(pod.userId);
              return {
                id: pod.sessionId || pod.podName || pod.name,
                userId: pod.userId,
                status: pod.phase === 'Running' ? 'running' : pod.phase === 'Pending' ? 'idle' : 'stopped',
                model: pod.model || 'claude-code',
                workspacePath: pod.workspacePath || '/workspace',
                createdAt: pod.createdAt || pod.startTime || new Date().toISOString(),
                lastActivity: pod.lastActivity || new Date().toISOString(),
                userEmail: user?.email || 'Unknown',
                userName: user?.name || user?.email || 'Unknown',
                pid: pod.pid,
                messageCount: pod.messageCount || 0,
                tokenCount: pod.tokenCount || 0,
                toolCallCount: pod.toolCallCount || 0,
                metrics: pod.metrics || null,
                storageMB: pod.storageMB || 0,
                storagePercent: pod.storagePercent || 0,
                storageLimitMB: 5120,
                _source: 'k8s_pods',
              };
            });

            return reply.send(podSessions);
          }
        } catch (podsError: any) {
          request.log.warn({ error: podsError.message }, 'K8s pods endpoint also failed, trying database');
        }

        // Fallback 2: Try both database tables for session records
        try {
          // Try AWCodeSession table (agentic-cli sessions)
          const dbSessions = await prisma.aWCodeSession.findMany({
            where: { status: { in: ['running', 'starting'] } },
            orderBy: { created_at: 'desc' },
            take: 50,
          });

          // Also try CodeSession table (legacy sessions)
          const legacySessions = await prisma.codeSession.findMany({
            where: { status: 'active' },
            orderBy: { last_activity: 'desc' },
            take: 50,
          });

          // Merge and deduplicate by user_id
          const allSessions = [
            ...dbSessions.map(s => ({ userId: s.user_id, ...s, _table: 'awcode' as const })),
            ...legacySessions.map(s => ({ userId: s.user_id, ...s, _table: 'legacy' as const })),
          ];

          const userIds = [...new Set(allSessions.map(s => s.userId))] as string[];
          const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, name: true },
          });
          const userMap = new Map(users.map(u => [u.id, u]));

          const fallbackSessions = allSessions.map(s => {
            const user = userMap.get(s.userId);
            if (s._table === 'awcode') {
              const aw = s as any;
              return {
                id: aw.id,
                userId: aw.user_id,
                status: aw.status || 'running',
                model: aw.model || 'unknown',
                workspacePath: aw.workspace_path || '/workspace',
                createdAt: aw.started_at?.toISOString() || aw.created_at?.toISOString(),
                lastActivity: aw.last_activity?.toISOString() || aw.updated_at?.toISOString(),
                userEmail: user?.email || 'Unknown',
                userName: user?.name || user?.email || 'Unknown',
                pid: aw.pid,
                messageCount: aw.message_count || 0,
                tokenCount: aw.total_tokens || 0,
                toolCallCount: aw.tool_calls_count || 0,
                storageMB: 0,
                storagePercent: 0,
                storageLimitMB: 5120,
                _source: 'database_awcode',
              };
            } else {
              const cs = s as any;
              return {
                id: cs.id,
                userId: cs.user_id,
                status: cs.status === 'active' ? 'running' : cs.status,
                model: cs.model || 'unknown',
                workspacePath: cs.workspace_path || '/workspace',
                createdAt: cs.created_at?.toISOString(),
                lastActivity: cs.last_activity?.toISOString(),
                userEmail: user?.email || 'Unknown',
                userName: user?.name || user?.email || 'Unknown',
                messageCount: 0,
                tokenCount: cs.total_tokens || 0,
                toolCallCount: cs.total_executions || 0,
                storageMB: 0,
                storagePercent: 0,
                storageLimitMB: cs.storage_limit_mb || 5120,
                _source: 'database_legacy',
              };
            }
          });

          return reply.send(fallbackSessions);
        } catch (dbError: any) {
          request.log.error({ dbError: dbError.message }, 'All session sources failed');
          return reply.send([]);
        }
      }
    }
  );

  // ============================================================================
  // Execution History
  // ============================================================================

  /**
   * Get execution history
   * GET /api/admin/code/executions
   */
  fastify.get<{ Querystring: ExecutionsQuery }>(
    '/executions',
    async (request, reply) => {
      try {
        const { sessionId, userId, status, execType, limit = '50', offset = '0' } = request.query;

        const where: any = {};
        if (sessionId) where.session_id = sessionId;
        if (status) where.status = status;
        if (execType) where.exec_type = execType;

        // If userId specified, get session IDs first
        if (userId) {
          const sessions = await prisma.codeSession.findMany({
            where: { user_id: userId },
            select: { id: true },
          });
          where.session_id = { in: sessions.map((s) => s.id) };
        }

        const [executions, total] = await Promise.all([
          prisma.codeExecution.findMany({
            where,
            orderBy: { created_at: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset),
          }),
          prisma.codeExecution.count({ where }),
        ]);

        return reply.send({
          executions,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to get executions');
        return reply.code(500).send({ error: 'Failed to get executions' });
      }
    }
  );

  // ============================================================================
  // Storage Backend Management
  // ============================================================================

  /**
   * Get storage backends
   * GET /api/admin/code/storage-backends
   */
  fastify.get('/storage-backends', async (request, reply) => {
    try {
      const backends = await prisma.codeStorageBackend.findMany({
        orderBy: { name: 'asc' },
      });

      // Mask sensitive credentials
      const maskedBackends = backends.map((b) => ({
        ...b,
        connection_config: '***REDACTED***',
      }));

      return reply.send({ backends: maskedBackends });
    } catch (error) {
      request.log.error({ error }, 'Failed to get storage backends');
      return reply.code(500).send({ error: 'Failed to get storage backends' });
    }
  });

  /**
   * Create storage backend
   * POST /api/admin/code/storage-backends
   */
  fastify.post<{ Body: StorageBackendBody }>(
    '/storage-backends',
    async (request, reply) => {
      try {
        const data = request.body;

        // If setting as default, unset other defaults
        if (data.isDefault) {
          await prisma.codeStorageBackend.updateMany({
            where: { is_default: true },
            data: { is_default: false },
          });
        }

        const backend = await prisma.codeStorageBackend.create({
          data: {
            name: data.name,
            display_name: data.displayName,
            backend_type: data.backendType,
            connection_config: data.connectionConfig,
            default_bucket: data.defaultBucket,
            default_region: data.defaultRegion,
            max_snapshot_size_mb: data.maxSnapshotSizeMb,
            max_storage_per_user_mb: data.maxStoragePerUserMb,
            retention_days: data.retentionDays,
            is_default: data.isDefault ?? false,
            is_enabled: true,
            created_by: request.user?.id,
          },
        });

        return reply.code(201).send({ backend: { ...backend, connection_config: '***REDACTED***' } });
      } catch (error) {
        request.log.error({ error }, 'Failed to create storage backend');
        return reply.code(500).send({ error: 'Failed to create storage backend' });
      }
    }
  );

  /**
   * Delete storage backend
   * DELETE /api/admin/code/storage-backends/:backendId
   */
  fastify.delete<{ Params: { backendId: string } }>(
    '/storage-backends/:backendId',
    async (request, reply) => {
      try {
        const { backendId } = request.params;

        // Check if any snapshots use this backend
        const snapshotCount = await prisma.workspaceSnapshot.count({
          where: { storage_backend: backendId },
        });

        if (snapshotCount > 0) {
          return reply.code(400).send({
            error: `Cannot delete backend - ${snapshotCount} snapshots reference it`,
          });
        }

        await prisma.codeStorageBackend.delete({
          where: { id: backendId },
        });

        return reply.send({ message: 'Storage backend deleted' });
      } catch (error) {
        request.log.error({ error }, 'Failed to delete storage backend');
        return reply.code(500).send({ error: 'Failed to delete storage backend' });
      }
    }
  );

  // ============================================================================
  // Runtime Health & Metrics
  // ============================================================================

  /**
   * Get runtime health
   * GET /api/admin/code/runtime/health
   */
  fastify.get('/runtime/health', async (request, reply) => {
    try {
      const response = await axios.get(`${CODE_RUNTIME_URL}/health`, createInternalAuthConfig(5000));
      return reply.send(response.data);
    } catch (error: any) {
      return reply.send({
        status: 'unhealthy',
        error: error.message || 'Runtime unreachable',
      });
    }
  });

  /**
   * Get runtime metrics
   * GET /api/admin/code/runtime/metrics
   */
  fastify.get('/runtime/metrics', async (request, reply) => {
    try {
      const response = await axios.get(`${CODE_RUNTIME_URL}/metrics`, createInternalAuthConfig(5000));
      return reply.send(response.data);
    } catch (error: any) {
      return reply.send({
        error: error.message || 'Failed to get metrics',
      });
    }
  });

  // ============================================================================
  // Enhanced Metrics (Network I/O, Disk I/O, Tokens, Storage)
  // ============================================================================

  /**
   * Get enhanced metrics for a specific session
   * GET /api/admin/code/sessions/:sessionId/metrics/enhanced
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/metrics/enhanced',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        // Get session to find slice ID
        const session = await prisma.codeSession.findUnique({
          where: { id: sessionId },
          select: { slice_id: true },
        });

        if (!session?.slice_id) {
          return reply.code(404).send({ error: 'Session not found or no active runtime' });
        }

        const response = await axios.get(
          `${CODE_RUNTIME_URL}/sessions/${session.slice_id}/metrics/enhanced`,
          createInternalAuthConfig(10000)
        );

        return reply.send(response.data);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get enhanced session metrics');
        return reply.code(500).send({ error: error.message || 'Failed to get enhanced metrics' });
      }
    }
  );

  /**
   * Get all sessions with enhanced metrics
   * GET /api/admin/code/sessions/metrics/enhanced
   */
  fastify.get('/sessions/metrics/enhanced', async (request, reply) => {
    try {
      const response = await axios.get(
        `${CODE_RUNTIME_URL}/sessions/all/metrics/enhanced`,
        createInternalAuthConfig(15000)
      );

      // Enrich with user info from database
      const sessions = response.data.sessions || [];
      const userIds = [...new Set(sessions.map((s: any) => s.userId))] as string[];

      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      const enrichedSessions = sessions.map((session: any) => {
        const user = userMap.get(session.userId);
        return {
          ...session,
          userEmail: user?.email || 'Unknown',
          userName: user?.name || user?.email || 'Unknown',
        };
      });

      return reply.send({ sessions: enrichedSessions });
    } catch (error: any) {
      request.log.error({ error }, 'Failed to get all sessions with enhanced metrics');
      return reply.send({ sessions: [], error: error.message });
    }
  });

  /**
   * Get system-wide aggregated metrics
   * GET /api/admin/code/metrics/system
   */
  fastify.get('/metrics/system', async (request, reply) => {
    try {
      const response = await axios.get(
        `${CODE_RUNTIME_URL}/metrics/system`,
        createInternalAuthConfig(10000)
      );

      // Add database-level metrics
      const [totalTokensDb, totalStorageDb] = await Promise.all([
        prisma.codeSession.aggregate({
          _sum: { total_tokens: true },
        }),
        prisma.workspaceSnapshot.aggregate({
          _sum: { size_bytes: true },
        }),
      ]);

      return reply.send({
        ...response.data,
        database: {
          totalTokensRecorded: Number(totalTokensDb._sum.total_tokens || 0),
          totalStorageRecorded: Number(totalStorageDb._sum.size_bytes || 0),
        },
      });
    } catch (error: any) {
      request.log.error({ error }, 'Failed to get system metrics');
      return reply.code(500).send({ error: error.message || 'Failed to get system metrics' });
    }
  });

  /**
   * Get real-time metrics WebSocket URL
   * GET /api/admin/code/metrics/websocket
   * Returns the WebSocket URL for live metrics streaming
   */
  fastify.get('/metrics/websocket', async (request, reply) => {
    const wsUrl = CODE_RUNTIME_URL.replace('http://', 'ws://').replace('https://', 'wss://');
    return reply.send({
      url: `${wsUrl}/ws/metrics`,
      internalKey: CODE_MANAGER_INTERNAL_KEY ? '***REQUIRED***' : null,
      note: 'Connect with internalKey query param for authentication',
    });
  });

  // ============================================================================
  // Dashboard Statistics
  // ============================================================================

  /**
   * Get code feature statistics
   * GET /api/admin/code/stats
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      const [
        totalUsers,
        enabledUsers,
        activeSessions,
        totalSessions,
        totalExecutions,
        recentExecutions,
        storageUsage,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { code_enabled: true } }),
        prisma.codeSession.count({ where: { status: 'active' } }),
        prisma.codeSession.count(),
        prisma.codeExecution.count(),
        prisma.codeExecution.count({
          where: {
            created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.workspaceSnapshot.aggregate({
          _sum: { size_bytes: true },
        }),
      ]);

      // Get runtime stats if available (includes WebSocket and Code Mode activity)
      let runtimeStats = null;
      let websocketStats = null;
      let codeModeStats = null;
      try {
        const response = await axios.get(`${CODE_RUNTIME_URL}/stats`, createInternalAuthConfig(3000));
        const data = response.data;
        runtimeStats = data.runtime;
        websocketStats = data.websockets;
        codeModeStats = data.codeMode;
      } catch {
        // Runtime not available - try legacy metrics endpoint
        try {
          const response = await axios.get(`${CODE_RUNTIME_URL}/metrics`, createInternalAuthConfig(3000));
          runtimeStats = response.data;
        } catch {
          // Runtime completely unavailable
        }
      }

      return reply.send({
        users: {
          total: totalUsers,
          enabled: enabledUsers,
          enabledPercentage: totalUsers > 0 ? ((enabledUsers / totalUsers) * 100).toFixed(1) : 0,
        },
        sessions: {
          active: activeSessions,
          total: totalSessions,
        },
        executions: {
          total: totalExecutions,
          last24h: recentExecutions,
        },
        storage: {
          totalBytes: Number(storageUsage._sum.size_bytes || 0),
          totalMb: (Number(storageUsage._sum.size_bytes || 0) / (1024 * 1024)).toFixed(2),
        },
        runtime: runtimeStats,
        websockets: websocketStats,
        codeMode: codeModeStats,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get stats');
      return reply.code(500).send({ error: 'Failed to get stats' });
    }
  });

  // ============================================================================
  // AWCode Configuration/Settings
  // ============================================================================

  // Default system prompt (fallback if not configured in database)
  const DEFAULT_CODEMODE_SYSTEM_PROMPT = `You are OpenAgentic, an autonomous coding agent running in a sandboxed Linux workspace.
You have a persistent filesystem, bash shell, and full tool access.

EXECUTION MODEL:
- Execute actions directly using your tools. Do NOT suggest commands — run them yourself.
- Do NOT ask permission to read files. Just read them.
- Do NOT describe what you would do. DO it.
- When given a multi-step task, create a task list with TodoWrite and work through it step by step.
- Show your thinking briefly, then act. Minimize narration between tool calls.

AVAILABLE TOOLS:
- Read: read file contents (use instead of cat/head/tail)
- Write: create or replace files (use instead of echo/cat heredoc)
- Edit: surgical edits to existing files (use instead of sed/awk)
- Bash: execute shell commands — npm, pip, python, go, cargo, kubectl, git, etc.
- Glob: find files by pattern (use instead of find/ls)
- Grep: search file contents (use instead of grep/rg)
- TodoWrite: create/update visible task progress list — use proactively for multi-step tasks

TOOL PREFERENCES:
- Prefer Read/Write/Edit/Grep/Glob over their bash equivalents
- Reserve Bash for: running scripts, installing packages, builds, git, tests, deploys
- When modifying files, use Edit for small changes, Write for full rewrites

WORKSPACE:
- Persistent Linux workspace assigned to you
- Languages: Python, Node.js, Go, Rust, Bash, PowerShell
- Package managers: pip, npm, cargo, brew
- Cloud CLIs: aws, gcloud, az, kubectl, helm, terraform
- Tools: git, ripgrep, jq, yq, gh (GitHub CLI)
- Install packages freely: brew install, pip install, npm install, cargo install

TASK TRACKING:
- For tasks with 3+ steps, create a TodoWrite task list BEFORE starting
- Update each task to in_progress when you start it, completed when done
- Only have ONE task in_progress at a time
- The task list is visible to the user above the input — keep it updated

SECURITY:
- Workspace is isolated from other users
- All actions are logged and auditable
- Do not store secrets in plain text files`;

  /**
   * Get code mode system prompt
   * GET /api/admin/code/system-prompt
   */
  fastify.get('/system-prompt', async (request, reply) => {
    try {
      // Fetch from SystemConfiguration
      const config = await prisma.systemConfiguration.findUnique({
        where: { key: 'codemode.system_prompt' },
      });

      const prompt = config?.value as string || DEFAULT_CODEMODE_SYSTEM_PROMPT;
      const isDefault = !config?.value;

      return reply.send({
        prompt,
        isDefault,
        key: 'codemode.system_prompt',
        lastUpdated: config?.updated_at || null,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get code mode system prompt');
      return reply.code(500).send({ error: 'Failed to get system prompt' });
    }
  });

  /**
   * Update code mode system prompt
   * PUT /api/admin/code/system-prompt
   */
  fastify.put<{ Body: { prompt: string } }>('/system-prompt', async (request, reply) => {
    try {
      const { prompt } = request.body;

      if (!prompt || typeof prompt !== 'string') {
        return reply.code(400).send({ error: 'Prompt is required and must be a string' });
      }

      // Upsert to SystemConfiguration
      const config = await prisma.systemConfiguration.upsert({
        where: { key: 'codemode.system_prompt' },
        create: {
          key: 'codemode.system_prompt',
          value: prompt,
          description: 'System prompt for code mode LLM interactions',
        },
        update: {
          value: prompt,
          updated_at: new Date(),
        },
      });

      request.log.info({ adminId: request.user?.id, promptLength: prompt.length }, 'Code mode system prompt updated');

      return reply.send({
        message: 'System prompt updated successfully',
        prompt,
        key: 'codemode.system_prompt',
        lastUpdated: config.updated_at,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to update code mode system prompt');
      return reply.code(500).send({ error: 'Failed to update system prompt' });
    }
  });

  /**
   * Reset code mode system prompt to default
   * DELETE /api/admin/code/system-prompt
   */
  fastify.delete('/system-prompt', async (request, reply) => {
    try {
      await prisma.systemConfiguration.delete({
        where: { key: 'codemode.system_prompt' },
      }).catch(() => {
        // Ignore if not found
      });

      request.log.info({ adminId: request.user?.id }, 'Code mode system prompt reset to default');

      return reply.send({
        message: 'System prompt reset to default',
        prompt: DEFAULT_CODEMODE_SYSTEM_PROMPT,
        isDefault: true,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to reset code mode system prompt');
      return reply.code(500).send({ error: 'Failed to reset system prompt' });
    }
  });

  /**
   * Get AWCode settings
   * GET /api/admin/code/settings
   */
  fastify.get('/settings', async (request, reply) => {
    try {
      // Get settings from SystemConfiguration
      const settings = await prisma.systemConfiguration.findMany({
        where: {
          key: {
            startsWith: 'awcode.',
          },
        },
      });

      // Build settings object from DB records
      const settingsMap: Record<string, any> = {};
      for (const setting of settings) {
        const key = setting.key.replace('awcode.', '');
        // setting.value is JsonValue - could be string, number, object, etc.
        // If it's already parsed JSON object, use as-is; if string, try to parse
        const val = setting.value;
        if (typeof val === 'string') {
          try {
            settingsMap[key] = JSON.parse(val);
          } catch {
            settingsMap[key] = val;
          }
        } else {
          settingsMap[key] = val;
        }
      }

      // Get runtime config
      let runtimeConfig = null;
      try {
        const response = await axios.get(`${CODE_RUNTIME_URL}/health`, createInternalAuthConfig(5000));
        runtimeConfig = response.data?.config;
      } catch {
        // Runtime not available
      }

      // Get Milvus stats for collection info
      let milvusStats = null;
      try {
        milvusStats = await codeModeMilvusService.getGlobalStats();
      } catch {
        // Milvus not available
      }

      // Merge with defaults
      const fullSettings = {
        // Core settings
        defaultModel: settingsMap.defaultModel || runtimeConfig?.defaultModel || process.env.DEFAULT_MODEL,
        sessionIdleTimeout: settingsMap.sessionIdleTimeout || runtimeConfig?.sessionIdleTimeout || 1800,
        sessionMaxLifetime: settingsMap.sessionMaxLifetime || runtimeConfig?.sessionMaxLifetime || 14400,
        maxSessionsPerUser: settingsMap.maxSessionsPerUser || runtimeConfig?.maxSessionsPerUser || 3,
        defaultSecurityLevel: settingsMap.defaultSecurityLevel || 'permissive',
        defaultNetworkEnabled: settingsMap.defaultNetworkEnabled ?? true,
        defaultCpuLimit: settingsMap.defaultCpuLimit || 2,
        defaultMemoryLimitMb: settingsMap.defaultMemoryLimitMb || 2048,
        enabledForNewUsers: settingsMap.enabledForNewUsers ?? false,

        // Storage quota settings
        defaultStorageLimitMb: settingsMap.defaultStorageLimitMb || 5120, // 5GB default
        storageQuotaEnabled: settingsMap.storageQuotaEnabled ?? true,

        // Code Mode UI settings
        enableNewCodeModeUI: settingsMap.enableNewCodeModeUI ?? true,
        codeModeDefaultView: settingsMap.codeModeDefaultView || 'conversation',
        artifactSandboxLevel: settingsMap.artifactSandboxLevel || 'strict',
        artifactMaxPreviewSize: settingsMap.artifactMaxPreviewSize || 10,
        enableArtifactAutoPreview: settingsMap.enableArtifactAutoPreview ?? true,
        enableActivityVisualization: settingsMap.enableActivityVisualization ?? true,
        enableTodoList: settingsMap.enableTodoList ?? true,
        todoListDefaultExpanded: settingsMap.todoListDefaultExpanded ?? false,

        // Milvus/Vector settings
        enableMilvusCollections: settingsMap.enableMilvusCollections ?? true,
        autoCreateMilvusCollection: settingsMap.autoCreateMilvusCollection ?? true,
        milvusEmbeddingDimension: settingsMap.milvusEmbeddingDimension || 1536,
        milvusMaxVectorsPerUser: settingsMap.milvusMaxVectorsPerUser || 100000,
        milvusAutoCompact: settingsMap.milvusAutoCompact ?? true,
        milvusCompactThreshold: settingsMap.milvusCompactThreshold || 50000,

        // Context Management settings
        enableContextManagement: settingsMap.enableContextManagement ?? true,
        contextWarningThreshold: settingsMap.contextWarningThreshold || 0.7,
        contextCompactThreshold: settingsMap.contextCompactThreshold || 0.85,
        contextAggressiveThreshold: settingsMap.contextAggressiveThreshold || 0.95,
        enableAutoCompaction: settingsMap.enableAutoCompaction ?? true,
        compactionNotifyUser: settingsMap.compactionNotifyUser ?? false,

        // Workspace Sync settings
        enableWorkspaceSync: settingsMap.enableWorkspaceSync ?? true,
        syncDebounceMs: settingsMap.syncDebounceMs || 500,
        syncMaxFileSizeMb: settingsMap.syncMaxFileSizeMb || 10,
        syncAutoStart: settingsMap.syncAutoStart ?? true,
        syncIgnorePatterns: settingsMap.syncIgnorePatterns || [
          '**/node_modules/**',
          '**/.git/**',
          '**/__pycache__/**',
          '**/dist/**',
          '**/build/**',
        ],

        // Metrics settings
        enableMetricsCollection: settingsMap.enableMetricsCollection ?? true,
        metricsRetentionDays: settingsMap.metricsRetentionDays || 30,
        enableLiveMetrics: settingsMap.enableLiveMetrics ?? true,
        metricsUpdateIntervalMs: settingsMap.metricsUpdateIntervalMs || 2000,

        // Runtime info
        runtimeConfig,
        milvusStats,
      };

      return reply.send({ settings: fullSettings });
    } catch (error) {
      request.log.error({ error }, 'Failed to get AWCode settings');
      return reply.code(500).send({ error: 'Failed to get settings' });
    }
  });

  /**
   * Update AWCode settings
   * PUT /api/admin/code/settings
   */
  fastify.put<{
    Body: {
      // Core settings
      defaultModel?: string;
      sessionIdleTimeout?: number;
      sessionMaxLifetime?: number;
      maxSessionsPerUser?: number;
      defaultSecurityLevel?: 'strict' | 'permissive' | 'minimal';
      defaultNetworkEnabled?: boolean;
      defaultCpuLimit?: number;
      defaultMemoryLimitMb?: number;
      enabledForNewUsers?: boolean;

      // Code Mode UI settings
      enableNewCodeModeUI?: boolean;
      codeModeDefaultView?: 'conversation' | 'terminal';
      artifactSandboxLevel?: 'strict' | 'permissive' | 'none';
      artifactMaxPreviewSize?: number;
      enableArtifactAutoPreview?: boolean;
      enableActivityVisualization?: boolean;
      enableTodoList?: boolean;
      todoListDefaultExpanded?: boolean;

      // Milvus/Vector settings
      enableMilvusCollections?: boolean;
      autoCreateMilvusCollection?: boolean;
      milvusEmbeddingDimension?: number;
      milvusMaxVectorsPerUser?: number;
      milvusAutoCompact?: boolean;
      milvusCompactThreshold?: number;

      // Context Management settings
      enableContextManagement?: boolean;
      contextWarningThreshold?: number;
      contextCompactThreshold?: number;
      contextAggressiveThreshold?: number;
      enableAutoCompaction?: boolean;
      compactionNotifyUser?: boolean;

      // Workspace Sync settings
      enableWorkspaceSync?: boolean;
      syncDebounceMs?: number;
      syncMaxFileSizeMb?: number;
      syncAutoStart?: boolean;
      syncIgnorePatterns?: string[];

      // Metrics settings
      enableMetricsCollection?: boolean;
      metricsRetentionDays?: number;
      enableLiveMetrics?: boolean;
      metricsUpdateIntervalMs?: number;

      // Storage Quota settings
      storageQuotaEnabled?: boolean;
      defaultStorageLimitMb?: number;

      // CLI Backend settings
      cliBackend?: 'openagentic-cli' | 'claude-code';
      claudeCodeApiEndpoint?: string;
    };
  }>('/settings', async (request, reply) => {
    try {
      const updates = request.body;

      // Save each setting to SystemConfiguration
      const savePromises = Object.entries(updates).map(async ([key, value]) => {
        const dbKey = `awcode.${key}`;
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

        await prisma.systemConfiguration.upsert({
          where: { key: dbKey },
          create: {
            key: dbKey,
            value: stringValue,
            description: 'AWCode setting',
          },
          update: {
            value: stringValue,
          },
        });
      });

      await Promise.all(savePromises);

      request.log.info({ updates, adminId: request.user?.id }, 'AWCode settings updated');

      return reply.send({ message: 'Settings updated', settings: updates });
    } catch (error) {
      request.log.error({ error }, 'Failed to update AWCode settings');
      return reply.code(500).send({ error: 'Failed to update settings' });
    }
  });

  // ============================================================================
  // Milvus Vector Collections Management (Per-User CodeMode Collections)
  // ============================================================================

  /**
   * List all CodeMode Milvus collections (admin overview)
   * GET /api/admin/code/milvus/collections
   */
  fastify.get('/milvus/collections', async (request, reply) => {
    try {
      const collections = await codeModeMilvusService.listAllCollections();

      // Enrich with user info from database
      const userIds = collections.map(c => c.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      });
      const userMap = new Map(users.map(u => [u.id, u]));

      const enrichedCollections = collections.map(col => {
        const user = userMap.get(col.userId);
        return {
          ...col,
          userEmail: user?.email || 'Unknown',
          userName: user?.name || user?.email || 'Unknown',
        };
      });

      return reply.send({
        collections: enrichedCollections,
        count: collections.length,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to list Milvus collections');
      return reply.code(500).send({ error: 'Failed to list collections' });
    }
  });

  /**
   * Get global Milvus statistics for CodeMode
   * GET /api/admin/code/milvus/stats
   */
  fastify.get('/milvus/stats', async (request, reply) => {
    try {
      const stats = await codeModeMilvusService.getGlobalStats();

      return reply.send({
        ...stats,
        storageUsageMb: (stats.storageUsageBytes / (1024 * 1024)).toFixed(2),
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get Milvus stats');
      return reply.code(500).send({ error: 'Failed to get Milvus stats' });
    }
  });

  /**
   * Get specific user's collection info
   * GET /api/admin/code/milvus/collections/:userId
   */
  fastify.get<{ Params: { userId: string } }>(
    '/milvus/collections/:userId',
    async (request, reply) => {
      try {
        const { userId } = request.params;
        const info = await codeModeMilvusService.getCollectionInfo(userId);

        if (!info) {
          return reply.code(404).send({ error: 'No collection found for user' });
        }

        // Get user info
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true },
        });

        return reply.send({
          collection: {
            ...info,
            userEmail: user?.email || 'Unknown',
            userName: user?.name || user?.email || 'Unknown',
          },
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to get user collection info');
        return reply.code(500).send({ error: 'Failed to get collection info' });
      }
    }
  );

  /**
   * Compact a user's collection to optimize storage
   * POST /api/admin/code/milvus/collections/:userId/compact
   */
  fastify.post<{ Params: { userId: string } }>(
    '/milvus/collections/:userId/compact',
    async (request, reply) => {
      try {
        const { userId } = request.params;

        await codeModeMilvusService.compactUserCollection(userId);

        request.log.info({ userId, adminId: request.user?.id }, 'Milvus collection compacted');

        return reply.send({
          message: 'Collection compaction completed',
          userId,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to compact collection');
        return reply.code(500).send({ error: 'Failed to compact collection' });
      }
    }
  );

  /**
   * Delete a user's Milvus collection (admin action)
   * DELETE /api/admin/code/milvus/collections/:userId
   */
  fastify.delete<{ Params: { userId: string } }>(
    '/milvus/collections/:userId',
    async (request, reply) => {
      try {
        const { userId } = request.params;

        await codeModeMilvusService.deleteUserCollection(userId);

        request.log.info({ userId, adminId: request.user?.id }, 'Milvus collection deleted by admin');

        return reply.send({
          message: 'Collection deleted',
          userId,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to delete collection');
        return reply.code(500).send({ error: 'Failed to delete collection' });
      }
    }
  );

  /**
   * Create/ensure collection exists for a user
   * POST /api/admin/code/milvus/collections/:userId
   */
  fastify.post<{ Params: { userId: string } }>(
    '/milvus/collections/:userId',
    async (request, reply) => {
      try {
        const { userId } = request.params;

        // Verify user exists
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, code_enabled: true },
        });

        if (!user) {
          return reply.code(404).send({ error: 'User not found' });
        }

        const collectionName = await codeModeMilvusService.ensureUserCollection(userId);
        const info = await codeModeMilvusService.getCollectionInfo(userId);

        request.log.info({ userId, collectionName, adminId: request.user?.id }, 'Milvus collection ensured');

        return reply.send({
          collection: {
            name: collectionName,
            userId,
            userEmail: user.email,
            vectorCount: info?.vectorCount || 0,
            status: info?.status || 'active',
          },
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to create collection');
        return reply.code(500).send({ error: 'Failed to create collection' });
      }
    }
  );

  /**
   * Batch create collections for all code-enabled users
   * POST /api/admin/code/milvus/batch-create
   */
  fastify.post('/milvus/batch-create', async (request, reply) => {
    try {
      // Get all code-enabled users without collections
      const codeEnabledUsers = await prisma.user.findMany({
        where: { code_enabled: true },
        select: { id: true, email: true },
      });

      let created = 0;
      let skipped = 0;
      let errors = 0;

      for (const user of codeEnabledUsers) {
        try {
          const existingInfo = await codeModeMilvusService.getCollectionInfo(user.id);
          if (existingInfo) {
            skipped++;
            continue;
          }

          await codeModeMilvusService.ensureUserCollection(user.id);
          created++;
        } catch (err) {
          errors++;
          request.log.warn({ err, userId: user.id }, 'Failed to create collection for user');
        }
      }

      request.log.info({ created, skipped, errors, adminId: request.user?.id }, 'Batch Milvus collection creation');

      return reply.send({
        message: 'Batch collection creation completed',
        created,
        skipped,
        errors,
        total: codeEnabledUsers.length,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to batch create collections');
      return reply.code(500).send({ error: 'Failed to batch create collections' });
    }
  });

  /**
   * Batch optimize all collections
   * POST /api/admin/code/milvus/batch-optimize
   */
  fastify.post('/milvus/batch-optimize', async (request, reply) => {
    try {
      const collections = await codeModeMilvusService.listAllCollections();

      let optimized = 0;
      let skipped = 0;
      let errors = 0;

      for (const col of collections) {
        try {
          // Only optimize collections with vectors
          if (col.vectorCount === 0) {
            skipped++;
            continue;
          }

          await codeModeMilvusService.compactUserCollection(col.userId);
          optimized++;
        } catch (err) {
          errors++;
          request.log.warn({ err, userId: col.userId }, 'Failed to optimize collection');
        }
      }

      request.log.info({ optimized, skipped, errors, adminId: request.user?.id }, 'Batch Milvus optimization');

      return reply.send({
        message: 'Batch optimization completed',
        optimized,
        skipped,
        errors,
        total: collections.length,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to batch optimize collections');
      return reply.code(500).send({ error: 'Failed to batch optimize collections' });
    }
  });

  /**
   * Get Milvus connection health
   * GET /api/admin/code/milvus/health
   */
  fastify.get('/milvus/health', async (request, reply) => {
    try {
      const isConnected = codeModeMilvusService.isConnected();

      // Try to connect if not connected
      if (!isConnected) {
        try {
          await codeModeMilvusService.connect();
        } catch (err) {
          return reply.send({
            status: 'unhealthy',
            connected: false,
            error: err instanceof Error ? err.message : 'Connection failed',
          });
        }
      }

      return reply.send({
        status: 'healthy',
        connected: true,
        host: process.env.MILVUS_HOST || 'milvus',
        port: process.env.MILVUS_PORT || '19530',
      });
    } catch (error) {
      return reply.send({
        status: 'error',
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ============================================================================
  // Exec Container Management (Kubernetes Mode)
  // For admin dashboard: view pods, logs, stop, restart, audit
  // ============================================================================

  /**
   * Get execution mode info
   * GET /api/admin/code/exec/info
   */
  fastify.get('/exec/info', async (request, reply) => {
    try {
      const response = await axios.get(`${CODE_RUNTIME_URL}/admin/exec/info`, createInternalAuthConfig(5000));
      return reply.send(response.data);
    } catch (error: any) {
      return reply.send({
        executionMode: 'unknown',
        error: error.message || 'Failed to get exec info',
      });
    }
  });

  /**
   * Get all exec container pods
   * GET /api/admin/code/exec/pods
   */
  fastify.get('/exec/pods', async (request, reply) => {
    try {
      const response = await axios.get(`${CODE_RUNTIME_URL}/admin/exec/pods`, createInternalAuthConfig(10000));
      const pods = response.data.pods || [];

      // Enrich with user info from database
      const userIds = [...new Set(pods.filter((p: any) => p.userId).map((p: any) => p.userId))] as string[];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      const enrichedPods = pods.map((pod: any) => {
        const user = pod.userId ? userMap.get(pod.userId) : null;
        return {
          ...pod,
          userEmail: user?.email || (pod.type === 'warm' ? 'N/A (warm)' : 'Unknown'),
          userName: user?.name || user?.email || (pod.type === 'warm' ? 'Warm Pool' : 'Unknown'),
        };
      });

      return reply.send({ pods: enrichedPods });
    } catch (error: any) {
      request.log.error({ error }, 'Failed to get exec pods');
      return reply.code(500).send({ error: error.message || 'Failed to get exec pods' });
    }
  });

  /**
   * Get logs for a session's exec container
   * GET /api/admin/code/exec/sessions/:sessionId/logs
   */
  fastify.get<{ Params: { sessionId: string }; Querystring: { tailLines?: string; sinceSeconds?: string } }>(
    '/exec/sessions/:sessionId/logs',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;
        const { tailLines = '500', sinceSeconds } = request.query;

        const params = new URLSearchParams();
        params.set('tailLines', tailLines);
        if (sinceSeconds) params.set('sinceSeconds', sinceSeconds);

        const response = await axios.get(
          `${CODE_RUNTIME_URL}/admin/exec/sessions/${sessionId}/logs?${params.toString()}`,
          createInternalAuthConfig(15000)
        );

        return reply.send(response.data);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get exec container logs');
        return reply.code(500).send({ error: error.message || 'Failed to get logs' });
      }
    }
  );

  /**
   * Get detailed pod info for auditing
   * GET /api/admin/code/exec/sessions/:sessionId/pod-info
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/exec/sessions/:sessionId/pod-info',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        const response = await axios.get(
          `${CODE_RUNTIME_URL}/admin/exec/sessions/${sessionId}/pod-info`,
          createInternalAuthConfig(10000)
        );

        // Enrich with user info
        const info = response.data;
        if (info.session?.userId) {
          const user = await prisma.user.findUnique({
            where: { id: info.session.userId },
            select: { id: true, email: true, name: true },
          });
          info.userInfo = user || { email: 'Unknown', name: 'Unknown' };
        }

        return reply.send(info);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get pod info');
        return reply.code(500).send({ error: error.message || 'Failed to get pod info' });
      }
    }
  );

  /**
   * Get pod events for auditing
   * GET /api/admin/code/exec/sessions/:sessionId/events
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/exec/sessions/:sessionId/events',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        const response = await axios.get(
          `${CODE_RUNTIME_URL}/admin/exec/sessions/${sessionId}/events`,
          createInternalAuthConfig(10000)
        );

        return reply.send(response.data);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get pod events');
        return reply.code(500).send({ error: error.message || 'Failed to get pod events' });
      }
    }
  );

  /**
   * Force restart a session's exec container
   * POST /api/admin/code/exec/sessions/:sessionId/restart
   */
  fastify.post<{ Params: { sessionId: string } }>(
    '/exec/sessions/:sessionId/restart',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        request.log.info({ sessionId, adminId: request.user?.id }, 'Admin restarting exec container');

        const response = await axios.post(
          `${CODE_RUNTIME_URL}/admin/exec/sessions/${sessionId}/restart`,
          {},
          createInternalAuthConfig(30000)
        );

        // Update session in database
        await prisma.codeSession.update({
          where: { id: sessionId },
          data: { status: 'suspended', last_activity: new Date() },
        }).catch(() => {
          // Session might not exist in DB
        });

        return reply.send(response.data);
      } catch (error: any) {
        request.log.error({ error, sessionId: request.params.sessionId }, 'Failed to restart exec container');
        return reply.code(500).send({ error: error.message || 'Failed to restart' });
      }
    }
  );

  /**
   * Force stop a session's exec container
   * DELETE /api/admin/code/exec/sessions/:sessionId
   */
  fastify.delete<{ Params: { sessionId: string } }>(
    '/exec/sessions/:sessionId',
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        request.log.info({ sessionId, adminId: request.user?.id }, 'Admin stopping exec container');

        const response = await axios.delete(
          `${CODE_RUNTIME_URL}/admin/exec/sessions/${sessionId}`,
          createInternalAuthConfig(30000)
        );

        // Update session in database
        await prisma.codeSession.update({
          where: { id: sessionId },
          data: { status: 'deleted' },
        }).catch(() => {
          // Session might not exist in DB
        });

        return reply.send(response.data);
      } catch (error: any) {
        request.log.error({ error, sessionId: request.params.sessionId }, 'Failed to stop exec container');
        return reply.code(500).send({ error: error.message || 'Failed to stop' });
      }
    }
  );

  /**
   * Delete a warm pool container
   * DELETE /api/admin/code/exec/warm/:podName
   */
  fastify.delete<{ Params: { podName: string } }>(
    '/exec/warm/:podName',
    async (request, reply) => {
      try {
        const { podName } = request.params;

        request.log.info({ podName, adminId: request.user?.id }, 'Admin deleting warm container');

        const response = await axios.delete(
          `${CODE_RUNTIME_URL}/admin/exec/warm/${podName}`,
          createInternalAuthConfig(30000)
        );

        return reply.send(response.data);
      } catch (error: any) {
        request.log.error({ error, podName: request.params.podName }, 'Failed to delete warm container');
        return reply.code(500).send({ error: error.message || 'Failed to delete warm container' });
      }
    }
  );
}
