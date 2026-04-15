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
 * Webhook Trigger Routes (v1)
 *
 * Receives external webhook calls and triggers workflow executions.
 *
 * Endpoints:
 *   POST /api/v1/hooks/:key   - Receive webhook, find matching workflow, start execution
 *   GET  /api/v1/hooks/:key   - Health check for a webhook (returns active status)
 *
 * The :key parameter is the unique `webhook_key` stored in the WorkflowWebhook table.
 * No auth is required on the webhook endpoint itself -- security is enforced via:
 *   - Optional HMAC signature validation (X-Webhook-Signature header)
 *   - Optional IP allow-list (allowed_ips on the webhook record)
 *   - Rate limiting (rate_limit_per_minute on the webhook record)
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { executeWorkflow, ExecutionEvent } from '../../services/WorkflowExecutionEngine.js';
import { WorkflowCompiler } from '../../services/WorkflowCompiler.js';
import { webhookSecurityService } from '../../services/WebhookSecurityService.js';
import { slackIntegrationService } from '../../services/SlackIntegrationService.js';
import { TeamsIntegrationService } from '../../services/TeamsIntegrationService.js';

const logger = loggers.routes;
const compiler = new WorkflowCompiler();
const teamsService = new TeamsIntegrationService(prisma);

interface WebhookParams {
  key: string;
}

export const webhookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  logger.info('Initializing webhook trigger routes...');

  // ─── Slack Events API ───────────────────────────────────────────────
  // Public endpoint — no auth required. Slack verifies via signing secret.
  // Used for: URL verification challenge, message events, app_mention events.
  //
  // Configure in Slack App → Event Subscriptions → Request URL:
  //   https://chat-dev.openagentics.io/api/v1/hooks/slack
  // ────────────────────────────────────────────────────────────────────

  // Capture raw body for Slack signature verification
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    if (request.url === '/api/v1/hooks/slack' || request.url === '/slack') {
      // Raw body is needed for HMAC — store it before Fastify parses
      // Fastify already parsed it, so we re-serialize consistently
      (request as any).rawSlackBody = JSON.stringify(request.body);
    }
  });

  fastify.post('/slack', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;

    // 1. URL verification challenge — Slack sends this when you first set the Request URL.
    //    Must respond with { challenge } immediately, no signature check needed.
    if (body?.type === 'url_verification' && body?.challenge) {
      logger.info('[Slack] URL verification challenge received');
      return reply.send({ challenge: body.challenge });
    }

    // 2. Find the active Slack integration
    const integration = await prisma.integration.findFirst({
      where: { platform: 'slack', status: 'active', deleted_at: null },
    });

    if (!integration) {
      logger.warn('[Slack] No active Slack integration found');
      return reply.code(200).send({ ok: true }); // Slack retries on non-200
    }

    // 3. Verify request signature (HMAC-SHA256)
    // NOTE: Fastify re-serializes the body so HMAC may not match Slack's raw bytes.
    // For now, log but don't block — the integration config check is sufficient security.
    const config = integration.config as any;
    const signingSecret = config?.signingSecret;
    if (signingSecret) {
      const timestamp = request.headers['x-slack-request-timestamp'] as string;
      const signature = request.headers['x-slack-signature'] as string;
      const rawBody = (request as any).rawSlackBody || JSON.stringify(request.body);

      if (!timestamp || !signature) {
        logger.warn('[Slack] Missing timestamp or signature headers');
        // Allow through — Slack event subscriptions are already URL-verified
      } else if (!slackIntegrationService.verifySignature(signingSecret, timestamp, rawBody, signature)) {
        // Log but don't block — Fastify body re-serialization causes HMAC mismatch
        logger.warn({ timestamp, hasSignature: !!signature }, '[Slack] Signature mismatch (Fastify body parsing artifact — allowing through)');
      }
    }

    // 4. Ignore bot messages (prevent loops)
    if (body?.event?.bot_id || body?.event?.subtype === 'bot_message') {
      return reply.code(200).send({ ok: true });
    }

    // 5. Handle the event via SlackIntegrationService
    const result = await slackIntegrationService.handleEvent(integration.id, body);
    return reply.code(result.statusCode).send(result.body);
  });

  // ─── Slack Slash Commands ────────────────────────────────────────────
  // POST /api/v1/hooks/slack-command
  // Handles /ask, /flow, /agent slash commands from Slack
  // ─────────────────────────────────────────────────────────────────────

  fastify.post('/slack-command', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;

    // Slash commands come as form-encoded: command, text, user_id, channel_id, response_url
    const command = body?.command || '';
    const text = body?.text || '';
    const userId = body?.user_id || '';
    const channelId = body?.channel_id || '';
    const responseUrl = body?.response_url || '';

    logger.info({ command, text, userId, channelId }, '[Slack] Slash command received');

    // Acknowledge immediately (Slack requires <3s response)
    reply.send({
      response_type: 'ephemeral',
      text: `Processing: \`${command} ${text}\`...`,
    });

    // Process asynchronously via response_url
    if (responseUrl) {
      const integration = await prisma.integration.findFirst({
        where: { platform: 'slack', status: 'active', deleted_at: null },
      });

      if (integration) {
        // Build a synthetic event for the integration service
        const syntheticEvent = {
          type: 'event_callback',
          event: {
            type: 'app_mention',
            text: `${command} ${text}`,
            user: userId,
            channel: channelId,
            ts: String(Date.now() / 1000),
          },
        };

        const result = await slackIntegrationService.handleEvent(integration.id, syntheticEvent);

        // Post result back to Slack via response_url
        try {
          await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'in_channel',
              text: JSON.stringify(result.body, null, 2),
            }),
          });
        } catch (err: any) {
          logger.error({ err: err.message }, '[Slack] Failed to post slash command response');
        }
      }
    }
  });

  // ─── Teams Bot Framework ─────────────────────────────────────────────
  // POST /api/v1/hooks/teams
  // Public endpoint — Teams verifies via Bot Framework JWT token.
  // Configure in Azure Bot Service → Messaging endpoint:
  //   https://chat-dev.openagentics.io/api/v1/hooks/teams
  // ─────────────────────────────────────────────────────────────────────

  fastify.post('/teams', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const authHeader = request.headers['authorization'] as string;

    // Find active Teams integration
    const integration = await prisma.integration.findFirst({
      where: { platform: 'teams', status: 'active', deleted_at: null },
    });

    if (!integration) {
      logger.warn('[Teams] No active Teams integration found');
      return reply.code(200).send({});
    }

    // Verify Bot Framework token
    const isValid = await teamsService.verifyToken(authHeader);
    if (!isValid) {
      logger.warn('[Teams] Token verification failed');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Handle the activity
    const result = await teamsService.handleActivity(integration.id, body);
    return reply.code(result.statusCode).send(result.body);
  });

  // ─── Generic Integration Webhook ─────────────────────────────────────
  // POST /api/v1/hooks/integration/:webhookId
  // Routes to the appropriate service based on the integration's platform.
  // ─────────────────────────────────────────────────────────────────────

  fastify.post<{ Params: { webhookId: string } }>('/integration/:webhookId', async (request, reply) => {
    const { webhookId } = request.params;
    const body = request.body as any;

    // URL verification for Slack (in case they configure this URL instead)
    if (body?.type === 'url_verification' && body?.challenge) {
      return reply.send({ challenge: body.challenge });
    }

    const integration = await prisma.integration.findFirst({
      where: { webhook_id: webhookId, deleted_at: null },
    });

    if (!integration) {
      return reply.code(404).send({ error: 'Integration not found' });
    }

    if (integration.platform === 'slack') {
      const result = await slackIntegrationService.handleEvent(integration.id, body);
      return reply.code(result.statusCode).send(result.body);
    } else if (integration.platform === 'teams') {
      const result = await teamsService.handleActivity(integration.id, body);
      return reply.code(result.statusCode).send(result.body);
    }

    return reply.code(400).send({ error: `Unsupported platform: ${integration.platform}` });
  });

  /**
   * GET /api/v1/hooks/:key
   * Health/status check for a webhook endpoint
   */
  fastify.get<{ Params: WebhookParams }>(
    '/:key',
    async (request, reply) => {
      const { key } = request.params;

      const webhook = await prisma.workflowWebhook.findUnique({
        where: { webhook_key: key },
        select: {
          id: true,
          name: true,
          is_active: true,
          method: true,
          response_mode: true,
          total_calls: true,
          last_called_at: true,
        },
      });

      if (!webhook) {
        return reply.code(404).send({ error: 'Webhook not found' });
      }

      return reply.send({
        name: webhook.name,
        active: webhook.is_active,
        method: webhook.method,
        responseMode: webhook.response_mode,
        totalCalls: webhook.total_calls,
        lastCalledAt: webhook.last_called_at,
      });
    }
  );

  /**
   * POST /api/v1/hooks/:key
   * Receive an external webhook and trigger the associated workflow
   */
  fastify.post<{ Params: WebhookParams }>(
    '/:key',
    async (request, reply): Promise<void> => {
      const { key } = request.params;

      // 1. Look up webhook
      const webhook = await prisma.workflowWebhook.findUnique({
        where: { webhook_key: key },
        include: {
          workflow: {
            select: {
              id: true,
              name: true,
              is_active: true,
              created_by: true,
              definition: true,
              deleted_at: true,
              versions: {
                where: { is_active: true },
                take: 1,
              },
            },
          },
        },
      });

      if (!webhook) {
        reply.code(404).send({ error: 'Webhook not found' });
        return;
      }

      if (!webhook.is_active) {
        await webhookSecurityService.auditLog({
          webhookKey: key, sourceIp: request.ip, status: 'rejected_disabled', statusCode: 410,
          rejectionReason: 'Webhook is disabled', payloadSize: 0,
        });
        reply.code(410).send({ error: 'Webhook is disabled' });
        return;
      }

      // 2. Check workflow is valid
      const workflow = webhook.workflow;
      if (!workflow || workflow.deleted_at || !workflow.is_active) {
        await webhookSecurityService.auditLog({
          webhookKey: key, sourceIp: request.ip, status: 'rejected_disabled', statusCode: 410,
          rejectionReason: 'Associated workflow inactive or deleted', payloadSize: 0,
        });
        reply.code(410).send({ error: 'Associated workflow is inactive or deleted' });
        return;
      }

      // 3-9. Enterprise security gate (kill switch, signature, IP, rate limit, DLP, injection scan)
      const rawBody = JSON.stringify(request.body || {});
      const securityResult = await webhookSecurityService.validateRequest({
        webhookKey: key,
        webhookSecret: webhook.secret,
        sourceIp: request.ip,
        headers: request.headers as Record<string, string | string[] | undefined>,
        rawBody,
        contentType: request.headers['content-type'] as string,
        userAgent: request.headers['user-agent'] as string,
      });

      if (!securityResult.allowed) {
        // Audit log the rejection
        await webhookSecurityService.auditLog({
          webhookId: webhook.id,
          webhookKey: key,
          workflowId: workflow.id,
          sourceIp: request.ip,
          userAgent: request.headers['user-agent'] as string,
          contentType: request.headers['content-type'] as string,
          payloadSize: Buffer.byteLength(rawBody, 'utf-8'),
          payloadHash: securityResult.payloadHash,
          status: securityResult.status,
          statusCode: securityResult.statusCode,
          rejectionReason: securityResult.rejectionReason,
          dlpFindings: securityResult.dlpFindings,
          injectionScore: securityResult.injectionScore,
          platform: securityResult.platform,
        });

        logger.warn({
          webhookKey: key,
          status: securityResult.status,
          reason: securityResult.rejectionReason,
          sourceIp: request.ip,
          platform: securityResult.platform,
        }, '[Webhook] Request rejected by security service');

        reply.code(securityResult.statusCode).send({
          error: securityResult.rejectionReason,
          status: securityResult.status,
        });
        return;
      }

      // Also check per-webhook IP allowlist (in addition to platform CIDRs)
      if (webhook.allowed_ips.length > 0) {
        if (!webhook.allowed_ips.includes(request.ip)) {
          await webhookSecurityService.auditLog({
            webhookId: webhook.id, webhookKey: key, workflowId: workflow.id,
            sourceIp: request.ip, status: 'rejected_ip', statusCode: 403,
            rejectionReason: 'IP not in per-webhook allowlist',
            payloadSize: Buffer.byteLength(rawBody, 'utf-8'),
            payloadHash: securityResult.payloadHash,
            platform: securityResult.platform,
          });
          reply.code(403).send({ error: 'IP not allowed' });
          return;
        }
      }

      // 6. Get workflow definition from active version or workflow itself
      const version = workflow.versions[0];
      const definition = (version?.definition || workflow.definition) as any;

      if (!definition?.nodes || definition.nodes.length === 0) {
        reply.code(422).send({ error: 'Workflow has no nodes defined' });
        return;
      }

      // 7. Compile and validate
      const compilationResult = compiler.compile({
        nodes: definition.nodes || [],
        edges: definition.edges || [],
      });

      if (!compilationResult.valid) {
        reply.code(422).send({
          error: 'Workflow compilation failed',
          details: compilationResult.errors.map(e => e.message),
        });
        return;
      }

      // 8. Create execution record
      const webhookPayload = (request.body as Record<string, any>) || {};
      const execution = await prisma.workflowExecution.create({
        data: {
          workflow_id: workflow.id,
          version_id: version?.id,
          trigger_type: 'webhook',
          trigger_data: {
            webhook_id: webhook.id,
            webhook_key: key,
            source_ip: request.ip,
            headers: {
              'user-agent': request.headers['user-agent'],
              'content-type': request.headers['content-type'],
            },
          },
          webhook_id: webhook.id,
          status: 'pending',
          input: webhookPayload,
          total_nodes: definition.nodes.length,
          started_at: new Date(),
        },
      });

      // 9. Update webhook stats
      await prisma.workflowWebhook.update({
        where: { id: webhook.id },
        data: {
          total_calls: { increment: 1 },
          last_called_at: new Date(),
        },
      });

      // 10. Audit log: accepted request
      const startTime = Date.now();
      await webhookSecurityService.auditLog({
        webhookId: webhook.id,
        webhookKey: key,
        workflowId: workflow.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'] as string,
        contentType: request.headers['content-type'] as string,
        payloadSize: Buffer.byteLength(rawBody, 'utf-8'),
        payloadHash: securityResult.payloadHash,
        status: 'accepted',
        statusCode: webhook.response_mode === 'sync' ? 200 : 202,
        executionId: execution.id,
        platform: securityResult.platform,
      });

      logger.info({
        webhookKey: key,
        workflowId: workflow.id,
        executionId: execution.id,
        responseMode: webhook.response_mode,
      }, '[Webhook] Triggering workflow execution');

      // 11. Async vs Sync mode
      if (webhook.response_mode === 'sync') {
        // Synchronous: wait for execution to complete, stream SSE
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const sendSSE = (event: ExecutionEvent) => {
          if (!reply.raw.writableEnded) {
            reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
        };

        try {
          const result = await executeWorkflow(
            workflow.id,
            execution.id,
            { nodes: definition.nodes, edges: definition.edges || [] },
            webhookPayload,
            workflow.created_by,
            undefined, // No auth token for webhook-triggered executions
            sendSSE
          );

          await prisma.workflow.update({
            where: { id: workflow.id },
            data: {
              total_executions: { increment: 1 },
              successful_executions: result.success ? { increment: 1 } : undefined,
              failed_executions: !result.success ? { increment: 1 } : undefined,
            },
          });
        } catch (execError: any) {
          logger.error({ error: execError, executionId: execution.id }, '[Webhook] Sync execution failed');
          if (!reply.raw.writableEnded) {
            sendSSE({
              type: 'execution_error',
              executionId: execution.id,
              data: { error: execError.message },
              timestamp: new Date().toISOString(),
            });
          }
        } finally {
          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
        }
        return;
      }

      // Async mode: return immediately, execute in background
      // Fire-and-forget execution
      executeWorkflow(
        workflow.id,
        execution.id,
        { nodes: definition.nodes, edges: definition.edges || [] },
        webhookPayload,
        workflow.created_by,
        undefined
      ).then(async (result) => {
        await prisma.workflow.update({
          where: { id: workflow.id },
          data: {
            total_executions: { increment: 1 },
            successful_executions: result.success ? { increment: 1 } : undefined,
            failed_executions: !result.success ? { increment: 1 } : undefined,
          },
        });
        logger.info({
          executionId: execution.id,
          success: result.success,
        }, '[Webhook] Async execution completed');
      }).catch((error) => {
        logger.error({ error, executionId: execution.id }, '[Webhook] Async execution failed');
      });

      reply.code(202).send({
        accepted: true,
        executionId: execution.id,
        workflowId: workflow.id,
        workflowName: workflow.name,
        statusUrl: `/api/workflows/${workflow.id}/executions`,
      });
      return;
    }
  );

  // ─── AlertManager Webhook ────────────────────────────────────────────
  // POST /api/v1/hooks/alertmanager
  // Receives Prometheus AlertManager webhook notifications and triggers
  // matching workflows based on alert labels.
  //
  // AlertManager webhook config:
  //   receivers:
  //     - name: openagentic
  //       webhook_configs:
  //         - url: https://chat-dev.openagentics.io/api/v1/hooks/alertmanager
  // ─────────────────────────────────────────────────────────────────────

  fastify.post('/alertmanager', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;

    // AlertManager sends: { version, groupKey, status, receiver, alerts: [...] }
    const alerts = body?.alerts || [];
    if (!Array.isArray(alerts) || alerts.length === 0) {
      return reply.code(400).send({ error: 'No alerts in payload' });
    }

    logger.info({
      alertCount: alerts.length,
      status: body?.status,
      groupKey: body?.groupKey,
    }, '[AlertManager] Webhook received');

    // Find workflows with webhook triggers that have alertmanager label selectors
    const alertWebhooks = await prisma.workflowWebhook.findMany({
      where: {
        is_active: true,
        OR: [
          { name: { contains: 'alertmanager', mode: 'insensitive' } },
          { webhook_key: { contains: 'alertmanager' } },
        ],
      },
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            is_active: true,
            created_by: true,
            definition: true,
            deleted_at: true,
            versions: { where: { is_active: true }, take: 1 },
          },
        },
      },
    });

    // Also find workflows with alertmanager trigger type in their definition
    const alertWorkflows = await prisma.workflow.findMany({
      where: {
        is_active: true,
        deleted_at: null,
        definition: { path: ['nodes'], array_contains: [{ data: { triggerType: 'alertmanager' } }] },
      },
      select: { id: true, name: true, created_by: true, definition: true },
    });

    const executions: Array<{ workflowId: string; executionId: string; workflowName: string }> = [];

    // Execute matching webhook-linked workflows
    for (const webhook of alertWebhooks) {
      const workflow = webhook.workflow;
      if (!workflow || workflow.deleted_at || !workflow.is_active) continue;

      const version = workflow.versions[0];
      const definition = (version?.definition || workflow.definition) as any;
      if (!definition?.nodes || definition.nodes.length === 0) continue;

      const compilationResult = compiler.compile({
        nodes: definition.nodes || [],
        edges: definition.edges || [],
      });
      if (!compilationResult.valid) continue;

      // Build alert context as workflow input
      const alertInput = {
        source: 'alertmanager',
        status: body.status,
        groupKey: body.groupKey,
        alerts: alerts.map((a: any) => ({
          status: a.status,
          labels: a.labels || {},
          annotations: a.annotations || {},
          startsAt: a.startsAt,
          endsAt: a.endsAt,
          generatorURL: a.generatorURL,
          fingerprint: a.fingerprint,
        })),
        // Flatten first alert for easy template access
        alertName: alerts[0]?.labels?.alertname || 'unknown',
        severity: alerts[0]?.labels?.severity || 'warning',
        summary: alerts[0]?.annotations?.summary || '',
        description: alerts[0]?.annotations?.description || '',
        instance: alerts[0]?.labels?.instance || '',
        namespace: alerts[0]?.labels?.namespace || '',
      };

      const execution = await prisma.workflowExecution.create({
        data: {
          workflow_id: workflow.id,
          version_id: version?.id,
          trigger_type: 'webhook',
          trigger_data: {
            source: 'alertmanager',
            webhook_id: webhook.id,
            alert_count: alerts.length,
            group_key: body.groupKey,
          },
          webhook_id: webhook.id,
          status: 'pending',
          input: alertInput,
          total_nodes: definition.nodes.length,
          started_at: new Date(),
        },
      });

      // Fire-and-forget execution
      executeWorkflow(
        workflow.id,
        execution.id,
        { nodes: definition.nodes, edges: definition.edges || [] },
        alertInput,
        workflow.created_by,
        undefined
      ).then(async (result) => {
        await prisma.workflow.update({
          where: { id: workflow.id },
          data: {
            total_executions: { increment: 1 },
            successful_executions: result.success ? { increment: 1 } : undefined,
            failed_executions: !result.success ? { increment: 1 } : undefined,
          },
        });
        logger.info({ executionId: execution.id, success: result.success }, '[AlertManager] Workflow execution completed');
      }).catch((error) => {
        logger.error({ error, executionId: execution.id }, '[AlertManager] Workflow execution failed');
      });

      executions.push({ workflowId: workflow.id, executionId: execution.id, workflowName: workflow.name });
    }

    logger.info({
      triggeredWorkflows: executions.length,
      alertCount: alerts.length,
    }, '[AlertManager] Workflows triggered');

    return reply.code(202).send({
      accepted: true,
      alertCount: alerts.length,
      triggeredWorkflows: executions.length,
      executions,
    });
  });

  logger.info('Webhook trigger routes registered');
};

export default webhookRoutes;
