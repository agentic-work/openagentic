/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Admin Test Harness Routes
 *
 * Provides a comprehensive system testing endpoint that exercises all platform
 * components: health checks, LLM providers, chat pipeline, workflows, and MCP tools.
 *
 * Streams results as SSE events so the admin UI can show live progress.
 *
 * Endpoints:
 *   POST /api/admin/test-harness/run    — Run test suite (SSE stream)
 *   GET  /api/admin/test-harness/results — Get last test run results
 *   POST /api/admin/test-harness/cleanup — Delete test resources
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import type { Logger } from 'pino';

interface TestResult {
  category: string;
  test: string;
  status: 'pass' | 'fail' | 'skip' | 'running';
  durationMs?: number;
  details?: any;
  error?: string;
  timestamp: string;
}

const logger = loggers.routes;

// Cache last test run in memory
let lastTestResults: TestResult[] = [];
let lastTestRunTime: string | null = null;

const adminTestHarnessRoutes: FastifyPluginAsync = async (fastify) => {

  // Admin-only access
  fastify.addHook('preHandler', async (request: any, reply) => {
    if (!request.user || !request.user.isAdmin) {
      reply.code(403).send({ error: 'Admin access required' });
    }
  });

  /**
   * POST /api/admin/test-harness/run
   * Run the test suite and stream results as SSE
   */
  fastify.post('/run', async (request: any, reply) => {
    const { categories = ['health', 'models', 'chat', 'workflows', 'mcp'] } = (request.body || {}) as any;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const results: TestResult[] = [];
    const startTime = Date.now();

    const emit = (result: TestResult) => {
      results.push(result);
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: test_result\ndata: ${JSON.stringify(result)}\n\n`);
      }
    };

    const emitProgress = (msg: string) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: progress\ndata: ${JSON.stringify({ message: msg, timestamp: new Date().toISOString() })}\n\n`);
      }
    };

    try {
      emitProgress('Starting system test harness...');

      // ─── HEALTH CHECKS ──────────────────────────────────────────────────
      if (categories.includes('health')) {
        emitProgress('Testing system health...');

        // Database
        const dbStart = Date.now();
        try {
          await prisma.$queryRaw`SELECT 1`;
          emit({ category: 'health', test: 'PostgreSQL', status: 'pass', durationMs: Date.now() - dbStart, timestamp: new Date().toISOString() });
        } catch (e: any) {
          emit({ category: 'health', test: 'PostgreSQL', status: 'fail', durationMs: Date.now() - dbStart, error: e.message, timestamp: new Date().toISOString() });
        }

        // Redis
        const redisStart = Date.now();
        try {
          const { getRedisClient } = await import('../utils/redis-client.js');
          const redis = getRedisClient();
          await redis.ping();
          emit({ category: 'health', test: 'Redis', status: 'pass', durationMs: Date.now() - redisStart, timestamp: new Date().toISOString() });
        } catch (e: any) {
          emit({ category: 'health', test: 'Redis', status: 'fail', durationMs: Date.now() - redisStart, error: e.message, timestamp: new Date().toISOString() });
        }

        // Milvus
        const milvusStart = Date.now();
        try {
          // Try to check Milvus health via the vector service singleton
          const milvusModule = await import('../services/MilvusVectorService.js');
          const milvus = (milvusModule as any).default?.instance || (milvusModule as any).milvusVectorService;
          if (milvus && typeof milvus.healthCheck === 'function') {
            const healthy = await milvus.healthCheck();
            emit({ category: 'health', test: 'Milvus', status: healthy ? 'pass' : 'fail', durationMs: Date.now() - milvusStart, timestamp: new Date().toISOString() });
          } else {
            emit({ category: 'health', test: 'Milvus', status: 'skip', details: 'Not initialized', timestamp: new Date().toISOString() });
          }
        } catch (e: any) {
          emit({ category: 'health', test: 'Milvus', status: 'fail', durationMs: Date.now() - milvusStart, error: e.message, timestamp: new Date().toISOString() });
        }

        // Database counts
        try {
          const [users, sessions, messages, workflows] = await Promise.all([
            prisma.user.count(),
            prisma.chatSession.count(),
            prisma.chatMessage.count(),
            prisma.workflow.count({ where: { deleted_at: null } }),
          ]);
          emit({
            category: 'health', test: 'Database Stats', status: 'pass',
            details: { users, sessions, messages, workflows },
            timestamp: new Date().toISOString()
          });
        } catch (e: any) {
          emit({ category: 'health', test: 'Database Stats', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── LLM MODEL TESTS ────────────────────────────────────────────────
      if (categories.includes('models')) {
        emitProgress('Testing LLM providers and models...');

        // Test each enabled LLM provider by getting models from DB
        try {
          const enabledProviders = await prisma.lLMProvider.findMany({
            where: { enabled: true, deleted_at: null, status: 'active' },
            select: { name: true, provider_type: true, model_config: true },
          });

          const { getProviderManager } = await import('../services/llm-providers/ProviderManager.js');
          const pm = getProviderManager();

          for (const provider of enabledProviders) {
            const chatModel = (provider.model_config as any)?.chatModel || 'auto';
            const modelStart = Date.now();
            try {
              if (!pm) throw new Error('ProviderManager not initialized');
              // Simple completion test — measure TTFT
              const testStream = await pm.createCompletion({
                model: chatModel,
                messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
                max_tokens: 5,
                stream: true,
              });

              let firstTokenTime: number | null = null;
              let content = '';
              if (testStream && typeof (testStream as any)[Symbol.asyncIterator] === 'function') {
                for await (const chunk of testStream as any) {
                  if (!firstTokenTime) firstTokenTime = Date.now() - modelStart;
                  const delta = chunk?.choices?.[0]?.delta?.content || chunk?.message?.content || '';
                  if (delta) content += delta;
                  if (content.length > 20) break;
                }
              }

              emit({
                category: 'models', test: `${provider.name} (${chatModel})`, status: 'pass',
                durationMs: Date.now() - modelStart,
                details: { ttft: firstTokenTime, contentPreview: content.substring(0, 50), provider: provider.name, model: chatModel },
                timestamp: new Date().toISOString()
              });
            } catch (e: any) {
              emit({
                category: 'models', test: `${provider.name} (${chatModel})`, status: 'fail',
                durationMs: Date.now() - modelStart, error: e.message,
                timestamp: new Date().toISOString()
              });
            }
          }
        } catch (e: any) {
          emit({ category: 'models', test: 'Provider Discovery', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── MCP SERVER TESTS ──────────────────────────────────────────────
      if (categories.includes('mcp')) {
        emitProgress('Testing MCP servers...');
        try {
          const axios = (await import('axios')).default;
          const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080';

          // MCP proxy health returns server statuses
          const proxyStart = Date.now();
          const healthRes = await axios.get(`${mcpProxyUrl}/health`, { timeout: 10000 }).catch(() => null);
          const healthData = healthRes?.data;

          emit({
            category: 'mcp', test: 'MCP Proxy',
            status: healthData?.status === 'healthy' ? 'pass' : 'fail',
            durationMs: Date.now() - proxyStart,
            details: { total: healthData?.servers?.total, running: healthData?.servers?.running },
            timestamp: new Date().toISOString()
          });

          // Test each server from health response
          const statuses = healthData?.servers?.statuses || {};
          for (const [name, info] of Object.entries(statuses)) {
            const serverInfo = info as any;
            emit({
              category: 'mcp', test: name,
              status: serverInfo.status === 'running' ? 'pass' : 'fail',
              details: { transport: serverInfo.transport, enabled: serverInfo.enabled, pid: serverInfo.pid },
              error: serverInfo.last_error || undefined,
              timestamp: new Date().toISOString()
            });
          }
        } catch (e: any) {
          emit({ category: 'mcp', test: 'MCP Proxy', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── CHAT MODE TESTS ────────────────────────────────────────────────
      if (categories.includes('chat')) {
        emitProgress('Testing chat pipeline...');
        try {
          const axios = (await import('axios')).default;
          const apiUrl = process.env.API_INTERNAL_URL || `http://openagentic-api:8000`;
          const userId = request.user?.userId || request.user?.id;

          // Generate internal auth token
          // Use the ACTUAL JWT secret from environment (not a default)
          const jwt = (await import('jsonwebtoken')).default;
          const secret = process.env.JWT_SECRET || process.env.JWT_AUTH_TOKEN_SECRET || '';
          const testToken = jwt.sign({
            userId,
            email: request.user?.email || 'test-harness@openagentics.io',
            name: 'Test Harness',
            isAdmin: true,
            tenantId: 'test-harness',
          }, secret, { expiresIn: '5m' });
          const headers = {
            'Authorization': `Bearer ${testToken}`,
            'Content-Type': 'application/json',
            'X-Request-From': 'test-harness',
          };

          // Test 1: Simple message
          const t1Start = Date.now();
          try {
            const sessionId = `test-harness-${Date.now()}`;
            const res = await axios.post(`${apiUrl}/api/chat/stream`, {
              message: 'Reply with exactly: OK',
              sessionId,
              model: 'gpt-oss',
            }, { headers, timeout: 30000, responseType: 'text' });
            emit({
              category: 'chat', test: 'Simple message (gpt-oss)',
              status: res.status === 200 ? 'pass' : 'fail',
              durationMs: Date.now() - t1Start,
              details: { model: 'gpt-oss', responseLength: (res.data || '').length },
              timestamp: new Date().toISOString()
            });
          } catch (e: any) {
            emit({ category: 'chat', test: 'Simple message (gpt-oss)', status: 'fail', durationMs: Date.now() - t1Start, error: e.message, timestamp: new Date().toISOString() });
          }

          // Test 2: Smart Router (should pick model based on content)
          const t2Start = Date.now();
          try {
            const sessionId = `test-harness-router-${Date.now()}`;
            const res = await axios.post(`${apiUrl}/api/chat/stream`, {
              message: 'List my Azure subscriptions',
              sessionId,
              model: '',  // Smart Router
            }, { headers, timeout: 30000, responseType: 'text' });
            emit({
              category: 'chat', test: 'Smart Router (infra query)',
              status: res.status === 200 ? 'pass' : 'fail',
              durationMs: Date.now() - t2Start,
              details: { responseLength: (res.data || '').length },
              timestamp: new Date().toISOString()
            });
          } catch (e: any) {
            emit({ category: 'chat', test: 'Smart Router (infra query)', status: 'fail', durationMs: Date.now() - t2Start, error: e.message, timestamp: new Date().toISOString() });
          }
        } catch (e: any) {
          emit({ category: 'chat', test: 'Chat Pipeline', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── AGENT TESTS (use an agent to test agents) ──────────────────────
      if (categories.includes('agents')) {
        emitProgress('Testing agent system...');
        try {
          const axios = (await import('axios')).default;
          const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || process.env.OPENAGENTIC_PROXY_ENDPOINT || 'http://openagentic-openagentic-proxy:3300';

          // Test openagentic-proxy health
          const healthStart = Date.now();
          const healthRes = await axios.get(`${openagenticProxyUrl}/health`, { timeout: 5000 }).catch(() => null);
          emit({
            category: 'agents', test: 'Agent Proxy Health',
            status: healthRes?.status === 200 ? 'pass' : 'fail',
            durationMs: Date.now() - healthStart,
            timestamp: new Date().toISOString()
          });

          // Test agent execution — simple validation task using gpt-oss (cheapest)
          const execStart = Date.now();
          try {
            const internalSecret = process.env.INTERNAL_SERVICE_SECRET || process.env.OPENAGENTIC_PROXY_API_KEY;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (internalSecret) {
              headers['Authorization'] = `Bearer ${internalSecret}`;
              headers['X-Request-From'] = 'test-harness';
            }

            const res = await axios.post(`${openagenticProxyUrl}/api/orchestrate`, {
              task: 'Reply with exactly one word: OK',
              agents: [{ role: 'validation', task: 'Reply with exactly one word: OK', model: 'gpt-oss' }],
              orchestration: 'sequential',
              userId: request.user?.userId || 'test-harness',
            }, { headers, timeout: 30000 });

            const output = res.data?.results?.[0]?.output || res.data?.output || '';
            emit({
              category: 'agents', test: 'Agent Execution (gpt-oss)',
              status: res.status === 200 ? 'pass' : 'fail',
              durationMs: Date.now() - execStart,
              details: { model: 'gpt-oss', outputPreview: String(output).substring(0, 100) },
              timestamp: new Date().toISOString()
            });
          } catch (e: any) {
            emit({ category: 'agents', test: 'Agent Execution', status: 'fail', durationMs: Date.now() - execStart, error: e.message?.substring(0, 200), timestamp: new Date().toISOString() });
          }
        } catch (e: any) {
          emit({ category: 'agents', test: 'Agent System', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── K8S CLUSTER TESTS ──────────────────────────────────────────────
      if (categories.includes('k8s')) {
        emitProgress('Testing Kubernetes cluster...');
        try {
          const axios = (await import('axios')).default;
          const k8sHost = process.env.KUBERNETES_SERVICE_HOST;
          const k8sPort = process.env.KUBERNETES_SERVICE_PORT || '443';
          const fs = (await import('fs')).default;

          if (k8sHost) {
            const token = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
            const ca = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
            const namespace = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').trim();
            const https = (await import('https')).default;
            const agent = new https.Agent({ ca });
            const k8sUrl = `https://${k8sHost}:${k8sPort}`;
            const k8sHeaders = { 'Authorization': `Bearer ${token}` };

            // Test 1: Node health
            try {
              const nodesRes = await axios.get(`${k8sUrl}/api/v1/nodes`, { headers: k8sHeaders, httpsAgent: agent, timeout: 5000 });
              const nodes = nodesRes.data?.items || [];
              const ready = nodes.filter((n: any) => n.status?.conditions?.find((c: any) => c.type === 'Ready' && c.status === 'True'));
              emit({
                category: 'k8s', test: 'Cluster Nodes',
                status: ready.length === nodes.length ? 'pass' : 'fail',
                details: { total: nodes.length, ready: ready.length, names: nodes.map((n: any) => n.metadata?.name) },
                timestamp: new Date().toISOString()
              });
            } catch (e: any) {
              emit({ category: 'k8s', test: 'Cluster Nodes', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
            }

            // Test 2: Pod health in namespace
            try {
              const podsRes = await axios.get(`${k8sUrl}/api/v1/namespaces/${namespace}/pods`, { headers: k8sHeaders, httpsAgent: agent, timeout: 5000 });
              const pods = podsRes.data?.items || [];
              const running = pods.filter((p: any) => p.status?.phase === 'Running');
              const failing = pods.filter((p: any) => p.status?.phase !== 'Running' && p.status?.phase !== 'Succeeded');
              emit({
                category: 'k8s', test: `Pods (${namespace})`,
                status: failing.length === 0 ? 'pass' : 'fail',
                details: { total: pods.length, running: running.length, failing: failing.length, failingPods: failing.map((p: any) => p.metadata?.name) },
                timestamp: new Date().toISOString()
              });
            } catch (e: any) {
              emit({ category: 'k8s', test: 'Namespace Pods', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
            }

            // Test 3: HPA status
            try {
              const hpaRes = await axios.get(`${k8sUrl}/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers`, { headers: k8sHeaders, httpsAgent: agent, timeout: 5000 });
              const hpas = hpaRes.data?.items || [];
              for (const hpa of hpas) {
                const name = hpa.metadata?.name || 'unknown';
                const current = hpa.status?.currentReplicas || 0;
                const desired = hpa.status?.desiredReplicas || 0;
                const min = hpa.spec?.minReplicas || 1;
                const max = hpa.spec?.maxReplicas || 10;
                emit({
                  category: 'k8s', test: `HPA: ${name}`,
                  status: current >= min ? 'pass' : 'fail',
                  details: { current, desired, min, max },
                  timestamp: new Date().toISOString()
                });
              }
              if (hpas.length === 0) {
                emit({ category: 'k8s', test: 'HPA', status: 'skip', details: 'No HPAs configured', timestamp: new Date().toISOString() });
              }
            } catch (e: any) {
              emit({ category: 'k8s', test: 'HPA', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
            }

            // Test 4: PVC storage
            try {
              const pvcRes = await axios.get(`${k8sUrl}/api/v1/namespaces/${namespace}/persistentvolumeclaims`, { headers: k8sHeaders, httpsAgent: agent, timeout: 5000 });
              const pvcs = pvcRes.data?.items || [];
              const bound = pvcs.filter((p: any) => p.status?.phase === 'Bound');
              emit({
                category: 'k8s', test: 'Persistent Volumes',
                status: bound.length === pvcs.length ? 'pass' : 'fail',
                details: { total: pvcs.length, bound: bound.length },
                timestamp: new Date().toISOString()
              });
            } catch (e: any) {
              emit({ category: 'k8s', test: 'PVCs', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
            }
          } else {
            emit({ category: 'k8s', test: 'Kubernetes API', status: 'skip', details: 'Not running in K8s (no KUBERNETES_SERVICE_HOST)', timestamp: new Date().toISOString() });
          }
        } catch (e: any) {
          emit({ category: 'k8s', test: 'Kubernetes', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── WORKFLOW TESTS ─────────────────────────────────────────────────
      if (categories.includes('workflows')) {
        emitProgress('Testing workflow execution engine...');
        try {
          const topWorkflows = await prisma.workflow.findMany({
            where: { deleted_at: null, is_active: true, is_public: true },
            orderBy: { total_executions: 'desc' },
            take: 5,
            select: { id: true, name: true, total_executions: true },
          });

          // Test workflow engine can create executions
          for (const wf of topWorkflows) {
            const wfStart = Date.now();
            try {
              const execution = await prisma.workflowExecution.create({
                data: {
                  workflow_id: wf.id,
                  trigger_type: 'test-harness',
                  status: 'pending',
                  input: {},
                  total_nodes: 0,
                  started_at: new Date(),
                },
              });
              emit({
                category: 'workflows', test: wf.name || wf.id, status: 'pass',
                durationMs: Date.now() - wfStart,
                details: { executionId: execution.id, previousExecutions: wf.total_executions },
                timestamp: new Date().toISOString()
              });
            } catch (e: any) {
              emit({ category: 'workflows', test: wf.name || wf.id, status: 'fail', durationMs: Date.now() - wfStart, error: e.message, timestamp: new Date().toISOString() });
            }
          }

          // Test workflow service connectivity
          const wfServiceUrl = process.env.WORKFLOW_SERVICE_URL;
          if (wfServiceUrl) {
            try {
              const axios = (await import('axios')).default;
              const wfHealth = await axios.get(`${wfServiceUrl}/health`, { timeout: 5000 });
              emit({ category: 'workflows', test: 'Workflow Service', status: wfHealth.status === 200 ? 'pass' : 'fail', timestamp: new Date().toISOString() });
            } catch (e: any) {
              emit({ category: 'workflows', test: 'Workflow Service', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
            }
          }
        } catch (e: any) {
          emit({ category: 'workflows', test: 'Workflow Engine', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── CODE MODE TESTS ────────────────────────────────────────────────
      if (categories.includes('code')) {
        emitProgress('Testing Code Mode...');
        try {
          const axios = (await import('axios')).default;
          const codeManagerUrl = process.env.EXEC_URL || 'http://openagentic-code-manager:3060';

          // Test code-manager health
          const cmStart = Date.now();
          const cmHealth = await axios.get(`${codeManagerUrl}/health`, { timeout: 5000 }).catch(() => null);
          emit({
            category: 'code', test: 'Code Manager Health',
            status: cmHealth?.status === 200 ? 'pass' : 'fail',
            durationMs: Date.now() - cmStart,
            details: cmHealth?.data,
            timestamp: new Date().toISOString()
          });

          // Test session count
          try {
            const sessionsRes = await axios.get(`${codeManagerUrl}/sessions`, { timeout: 5000 });
            const sessions = sessionsRes.data?.sessions || sessionsRes.data || [];
            emit({
              category: 'code', test: 'Active Sessions',
              status: 'pass',
              details: { activeSessions: Array.isArray(sessions) ? sessions.length : 0 },
              timestamp: new Date().toISOString()
            });
          } catch {
            emit({ category: 'code', test: 'Active Sessions', status: 'skip', details: 'Sessions endpoint not available', timestamp: new Date().toISOString() });
          }
        } catch (e: any) {
          emit({ category: 'code', test: 'Code Mode', status: 'fail', error: e.message, timestamp: new Date().toISOString() });
        }
      }

      // ─── SUMMARY ────────────────────────────────────────────────────────
      const totalTime = Date.now() - startTime;
      const passed = results.filter(r => r.status === 'pass').length;
      const failed = results.filter(r => r.status === 'fail').length;
      const skipped = results.filter(r => r.status === 'skip').length;

      const summary = {
        totalTests: results.length,
        passed,
        failed,
        skipped,
        totalTimeMs: totalTime,
        timestamp: new Date().toISOString(),
      };

      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: complete\ndata: ${JSON.stringify(summary)}\n\n`);
      }

      // Cache results
      lastTestResults = results;
      lastTestRunTime = new Date().toISOString();

      logger.info({ ...summary }, 'Test harness run completed');

    } catch (err: any) {
      logger.error({ error: err }, 'Test harness error');
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    } finally {
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });

  /**
   * GET /api/admin/test-harness/results
   * Get cached results from last test run
   */
  fastify.get('/results', async () => {
    return {
      results: lastTestResults,
      lastRun: lastTestRunTime,
      summary: {
        total: lastTestResults.length,
        passed: lastTestResults.filter(r => r.status === 'pass').length,
        failed: lastTestResults.filter(r => r.status === 'fail').length,
        skipped: lastTestResults.filter(r => r.status === 'skip').length,
      },
    };
  });

  /**
   * POST /api/admin/test-harness/cleanup
   * Delete any test resources created during test runs
   */
  fastify.post('/cleanup', async () => {
    // Clean up test executions
    const deleted = await prisma.workflowExecution.deleteMany({
      where: { trigger_type: 'test-harness' },
    });
    return { cleaned: deleted.count, timestamp: new Date().toISOString() };
  });
};

export default adminTestHarnessRoutes;
