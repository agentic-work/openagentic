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
// Phase B (#15): webhook-triggered workflow execution goes through the
// dedicated workflows-svc pod via this proxy instead of the in-process
// api engine. Same signature; drop-in swap. ExecutionEvent type comes
// from the shared package since the engine class is being retired.
import { executeViaWorkflowsService as executeWorkflow } from '../../services/executeViaWorkflowsService.js';
import type { ExecutionEvent, WorkflowDefinition } from '@openagentic/workflow-engine';
import { WorkflowCompiler } from '../../services/WorkflowCompiler.js';
import { webhookSecurityService } from '../../services/WebhookSecurityService.js';
import { slackIntegrationService } from '../../services/SlackIntegrationService.js';
import { TeamsIntegrationService } from '../../services/TeamsIntegrationService.js';
import { decryptIntegrationConfig } from '../../services/IntegrationConfigService.js';
import type { Prisma } from '@prisma/client';

const logger = loggers.routes;
const compiler = new WorkflowCompiler();
const teamsService = new TeamsIntegrationService(prisma);

interface WebhookParams {
  key: string;
}

// Argument types of the integration dispatchers, referenced without importing
// their internal event/activity types.
type SlackEventArg = Parameters<typeof slackIntegrationService.handleEvent>[1];
type TeamsActivityArg = Parameters<typeof teamsService.handleActivity>[1];

/** Secret-bearing integration config (decrypted at the point of use). */
interface IntegrationConfig {
  signingSecret?: string;
  [key: string]: unknown;
}

/** Subset of an inbound Slack Events API payload this router reads. */
interface SlackEventBody {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    bot_id?: string;
    subtype?: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
  [key: string]: unknown;
}

/** Subset of a Slack slash-command payload (form-encoded). */
interface SlackSlashCommandBody {
  command?: string;
  text?: string;
  user_id?: string;
  channel_id?: string;
  response_url?: string;
}

/** A single AlertManager alert. */
interface AlertmanagerAlert {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  generatorURL?: string;
  fingerprint?: string;
}

/** AlertManager webhook payload. */
interface AlertmanagerBody {
  version?: string;
  groupKey?: string;
  status?: string;
  receiver?: string;
  alerts?: AlertmanagerAlert[];
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const webhookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  logger.info('Initializing webhook trigger routes...');

  // ─── Slack scope (encapsulated) ────────────────────────────────────────────
  // Wrapped in a plain (non-fp) child register so that the custom content-type
  // parser is scoped ONLY to the Slack routes and does NOT propagate to the root
  // Fastify instance via the fp()-wrapped parent chain.  Routes outside this
  // scope (/teams, /alertmanager, /:key) continue to use the default JSON parser.
  await fastify.register(async function slackScope(scope) {

  // Capture raw body for Slack signature verification (#371).
  // Scoped to `scope` only — does not leak to non-Slack routes.
  // Fastify v5 child scopes inherit the parent's content-type-parser
  // table. The api root scope already overrides `application/json` in
  // src/config/fastify.config.ts, so we MUST remove the inherited entry
  // before adding our own — otherwise addContentTypeParser throws
  // FST_ERR_CTP_ALREADY_PRESENT and the entire v1 router fails to
  // register at boot. Removing here only affects this scope's table.
  scope.removeContentTypeParser('application/json');
  scope.addContentTypeParser('application/json', { parseAs: 'string' }, function(_req: FastifyRequest, body: string | Buffer, done: (err: Error | null, body?: unknown) => void) {
    const rawStr = typeof body === 'string' ? body : body.toString('utf8');
    (_req as { rawSlackBody?: string }).rawSlackBody = rawStr;
    try {
      done(null, rawStr ? JSON.parse(rawStr) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // ─── Slack Events API ───────────────────────────────────────────────
  // Public endpoint — no auth required. Slack verifies via signing secret.
  // Used for: URL verification challenge, message events, app_mention events.
  //
  // Configure in Slack App → Event Subscriptions → Request URL:
  //   https://chat.example.com/api/v1/hooks/slack
  // ────────────────────────────────────────────────────────────────────

  scope.post('/slack', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as SlackEventBody;

    // 1. URL verification challenge — Slack sends this when you first set the Request URL.
    //    Must respond with { challenge } immediately, no signature check needed.
    //    Slack sends this BEFORE any signing secret is configured.
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

    // 3. Enforce HMAC-SHA256 signature verification (S0-12).
    //    Fail closed: any missing or invalid condition → 403.
    //    SC-28: the signing secret is encrypted at rest — decrypt before use.
    const config = decryptIntegrationConfig(integration.config as unknown as IntegrationConfig);
    const signingSecret = config?.signingSecret;

    if (!signingSecret) {
      logger.warn('[Slack] No signing secret configured on integration');
      return reply.code(403).send({ error: 'integration_misconfigured' });
    }

    const rawBody = (request as { rawSlackBody?: string }).rawSlackBody;
    if (!rawBody) {
      // Content-type parser did not capture the raw body — fail closed.
      logger.warn('[Slack] Raw body unavailable; cannot verify signature');
      return reply.code(403).send({ error: 'raw_body_unavailable' });
    }

    const timestamp = request.headers['x-slack-request-timestamp'] as string;
    const signature = request.headers['x-slack-signature'] as string;

    if (!timestamp || !signature) {
      logger.warn('[Slack] Missing timestamp or signature headers');
      return reply.code(403).send({ error: 'missing_signature_headers' });
    }

    if (!slackIntegrationService.verifySignature(signingSecret, timestamp, rawBody, signature)) {
      logger.warn({ timestamp, hasSignature: !!signature }, '[Slack] Signature verification failed');
      return reply.code(403).send({ error: 'invalid_signature' });
    }

    // 4. Ignore bot messages (prevent loops)
    if (body?.event?.bot_id || body?.event?.subtype === 'bot_message') {
      return reply.code(200).send({ ok: true });
    }

    // 5. Handle the event via SlackIntegrationService
    const result = await slackIntegrationService.handleEvent(integration.id, body as unknown as SlackEventArg);
    return reply.code(result.statusCode).send(result.body);
  });

  // ─── Slack Slash Commands ────────────────────────────────────────────
  // POST /api/v1/hooks/slack-command
  // Handles /ask, /flow, /agent slash commands from Slack
  // ─────────────────────────────────────────────────────────────────────

  scope.post('/slack-command', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as SlackSlashCommandBody;

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

        const result = await slackIntegrationService.handleEvent(integration.id, syntheticEvent as unknown as SlackEventArg);

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
        } catch (err: unknown) {
          logger.error({ err: errMessage(err) }, '[Slack] Failed to post slash command response');
        }
      }
    }
  });

  // ─── Generic Integration Webhook (Slack path needs raw body) ────────
  // POST /api/v1/hooks/integration/:webhookId
  // Routes to the appropriate service based on the integration's platform.
  // Kept inside slackScope so Slack-routed calls have rawSlackBody available.
  // ─────────────────────────────────────────────────────────────────────

  scope.post<{ Params: { webhookId: string } }>('/integration/:webhookId', async (request, reply) => {
    const { webhookId } = request.params;
    const body = (request.body ?? {}) as SlackEventBody;

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
      const result = await slackIntegrationService.handleEvent(integration.id, body as unknown as SlackEventArg);
      return reply.code(result.statusCode).send(result.body);
    } else if (integration.platform === 'teams') {
      const result = await teamsService.handleActivity(integration.id, body as unknown as TeamsActivityArg);
      return reply.code(result.statusCode).send(result.body);
    }

    return reply.code(400).send({ error: `Unsupported platform: ${integration.platform}` });
  });

  }); // end slackScope — parser isolation boundary

  // ─── Teams Bot Framework ─────────────────────────────────────────────
  // POST /api/v1/hooks/teams
  // Public endpoint — Teams verifies via Bot Framework JWT token.
  // Configure in Azure Bot Service → Messaging endpoint:
  //   https://chat.example.com/api/v1/hooks/teams
  // ─────────────────────────────────────────────────────────────────────

  fastify.post('/teams', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
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
    const result = await teamsService.handleActivity(integration.id, body as TeamsActivityArg);
    return reply.code(result.statusCode).send(result.body);
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
      const definition = (version?.definition || workflow.definition) as unknown as WorkflowDefinition;

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
      const webhookPayload = (request.body ?? {}) as Prisma.InputJsonObject;
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
          // Task 1.3 (V3 Enterprise Chatmode S5): tenant from workflow row.
          const tenantId = (workflow as { tenant_id?: string | null }).tenant_id || null;
          const result = await executeWorkflow(
            workflow.id,
            execution.id,
            { nodes: definition.nodes, edges: definition.edges || [] },
            webhookPayload,
            workflow.created_by,
            undefined, // No auth token for webhook-triggered executions
            sendSSE,
            { tenantId }
          );

          await prisma.workflow.update({
            where: { id: workflow.id },
            data: {
              total_executions: { increment: 1 },
              successful_executions: result.success ? { increment: 1 } : undefined,
              failed_executions: !result.success ? { increment: 1 } : undefined,
            },
          });
        } catch (execError: unknown) {
          logger.error({ error: execError, executionId: execution.id }, '[Webhook] Sync execution failed');
          if (!reply.raw.writableEnded) {
            sendSSE({
              type: 'execution_error',
              executionId: execution.id,
              data: { error: errMessage(execError) },
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
      // Fire-and-forget execution.
      // Task 1.3 (V3 Enterprise Chatmode S5): tenant from workflow row.
      const asyncTenantId = (workflow as { tenant_id?: string | null }).tenant_id || null;
      executeWorkflow(
        workflow.id,
        execution.id,
        { nodes: definition.nodes, edges: definition.edges || [] },
        webhookPayload,
        workflow.created_by,
        undefined,
        undefined,
        { tenantId: asyncTenantId }
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
  //         - url: https://chat.example.com/api/v1/hooks/alertmanager
  // ─────────────────────────────────────────────────────────────────────

  fastify.post('/alertmanager', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as AlertmanagerBody;

    // AlertManager sends: { version, groupKey, status, receiver, alerts: [...] }
    const alerts: AlertmanagerAlert[] = body?.alerts || [];
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
      const definition = (version?.definition || workflow.definition) as unknown as WorkflowDefinition;
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
        alerts: alerts.map((a) => ({
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

      // Fire-and-forget execution.
      // Task 1.3 (V3 Enterprise Chatmode S5): tenant from workflow row.
      const tenantId = (workflow as { tenant_id?: string | null }).tenant_id || null;
      executeWorkflow(
        workflow.id,
        execution.id,
        { nodes: definition.nodes, edges: definition.edges || [] },
        alertInput,
        workflow.created_by,
        undefined,
        undefined,
        { tenantId }
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
