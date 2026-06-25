/**
 * Slack Integration Service
 *
 * Handles Slack Events API integration:
 *   - Request signature verification (HMAC-SHA256)
 *   - URL verification challenge handling
 *   - Channel allowlist enforcement
 *   - Workflow execution triggered by Slack messages
 *   - Block Kit response formatting
 *   - Integration event logging
 */

import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { DEFAULT_SERVICE_PROMPTS } from './prompt/ServicePromptService.js';

const logger = loggers.services;

// Minimal interface for the injected ServicePromptService.
interface ServicePromptLike {
  getPrompt(key: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackEvent {
  type: string;
  event?: {
    type: string;
    text: string;
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
  };
  challenge?: string; // URL verification
  token?: string;
  team_id?: string;
  event_id?: string;
}

interface SlackBlockKitMessage {
  channel: string;
  text: string;
  blocks: any[];
  thread_ts?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SlackIntegrationService {
  private readonly servicePromptSvc?: ServicePromptLike;

  /**
   * @param servicePromptSvc Optional injected ServicePromptService. When
   * provided, system prompts are read from DB. Falls back to inline defaults
   * from DEFAULT_SERVICE_PROMPTS when unavailable (Sprint W — 2026-05-19).
   */
  constructor(servicePromptSvc?: ServicePromptLike) {
    this.servicePromptSvc = servicePromptSvc;
  }

  /**
   * Get the Slack integration system prompt from DB (Sprint W).
   * Falls back to the DEFAULT_SERVICE_PROMPTS default when the DB service
   * is unavailable.
   */
  async getSlackSystemPrompt(): Promise<string> {
    let fallbackReason = 'NO-SVC-INJECTED';
    if (this.servicePromptSvc) {
      try {
        return await this.servicePromptSvc.getPrompt('slack.integration_prompt');
      } catch (err) {
        fallbackReason = 'DB-READ-THREW';
        logger.warn(
          { err, key: 'slack.integration_prompt', reason: fallbackReason },
          '[SlackIntegration] getSlackSystemPrompt DB read failed, using inline default',
        );
      }
    }
    // Loud fallback signal — DEFAULT_SERVICE_PROMPTS constant in memory can
    // drift from the DB-edited row. Log every fallback at WARN so drift is
    // visible in production logs. Gap #3 — 2026-05-20.
    logger.warn(
      { key: 'slack.integration_prompt', reason: fallbackReason },
      '[ServicePrompt fallback] using DEFAULT_SERVICE_PROMPTS constant — DB row missing or read failed (slack.integration_prompt)',
    );
    return DEFAULT_SERVICE_PROMPTS['slack.integration_prompt'].body;
  }

  /**
   * Verify Slack request signature using HMAC-SHA256
   */
  verifySignature(signingSecret: string, timestamp: string, body: string, signature: string): boolean {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (Number.parseInt(timestamp) < fiveMinutesAgo) return false;

    const sigBasestring = `v0:${timestamp}:${body}`;
    const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

    const myBuf = Buffer.from(mySignature);
    const sigBuf = Buffer.from(signature);
    if (sigBuf.length !== myBuf.length) return false; // length guard — prevents ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH
    return crypto.timingSafeEqual(myBuf, sigBuf);
  }

  /**
   * Handle incoming Slack event
   */
  async handleEvent(integrationId: string, event: SlackEvent): Promise<{ statusCode: number; body: any }> {
    // URL verification challenge
    if (event.type === 'url_verification') {
      return { statusCode: 200, body: { challenge: event.challenge } };
    }

    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
    });

    if (!integration || integration.status !== 'active') {
      return { statusCode: 403, body: { error: 'Integration not active' } };
    }

    // Check channel allowlist
    const channelId = event.event?.channel;
    if (channelId && (integration as any).allowed_channels?.length > 0 && !(integration as any).allowed_channels.includes(channelId)) {
      await this.logEvent(integrationId, 'inbound', 'slack', channelId, event.event?.user, event.event?.text, null, null, 'error', 'Channel not in allowlist');
      return { statusCode: 403, body: { error: 'Channel not allowed' } };
    }

    // Log the inbound event
    await this.logEvent(integrationId, 'inbound', 'slack', channelId, event.event?.user, event.event?.text);

    // Parse message and determine workflow
    if (event.event?.type === 'message' || event.event?.type === 'app_mention') {
      const text = event.event.text || '';
      const allowedWorkflows = (integration as any).allowed_workflows || [];
      const workflowId = this.extractWorkflowId(text, allowedWorkflows);

      if (workflowId) {
        // Execute workflow (async, respond later via webhook)
        this.executeAndRespond(integration, event, workflowId).catch(err => {
          logger.error({ err, integrationId, workflowId }, '[SlackIntegration] Workflow execution error');
        });
        return { statusCode: 200, body: { ok: true } };
      }

      // No workflow match — use direct LLM completion as fallback
      this.directLLMResponse(integration, event).catch(err => {
        logger.error({ err, integrationId }, '[SlackIntegration] Direct LLM response error');
      });
      return { statusCode: 200, body: { ok: true } };
    }

    return { statusCode: 200, body: { ok: true } };
  }

  /**
   * Smart workflow dispatcher — auto-matches Slack messages to available workflows
   * and executes the best match. Shows workflow list if no match found.
   */
  private async directLLMResponse(integration: any, event: SlackEvent): Promise<void> {
    const config = integration.config as any;
    const botToken = config?.botToken;
    if (!botToken) return;

    const userMessage = event.event?.text || '';
    const cleanMessage = userMessage.replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!cleanMessage) return;

    try {
      // Fetch all active public workflows
      const workflows = await prisma.workflow.findMany({
        where: { is_active: true, is_public: true },
        select: { id: true, name: true, description: true, tags: true },
        orderBy: { name: 'asc' },
      });

      // Auto-match workflow based on semantic similarity to name + description
      const matchedWorkflow = this.matchWorkflowByMessage(workflows, cleanMessage);

      if (matchedWorkflow) {
        // Execute the matched workflow
        logger.info({ workflowId: matchedWorkflow.id, workflowName: matchedWorkflow.name, message: cleanMessage },
          '[SlackIntegration] Auto-matched workflow from message');

        // Post "working on it" message
        await this.postMessage(botToken, {
          channel: event.event?.channel || '',
          text: `Running workflow: *${matchedWorkflow.name}*...`,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `:rocket: Running *${matchedWorkflow.name}*...\n_${matchedWorkflow.description || 'Processing your request'}_` },
          }],
          thread_ts: event.event?.thread_ts || event.event?.ts,
        });

        // Execute workflow and respond
        await this.executeAndRespond(integration, event, matchedWorkflow.id);
        return;
      }

      // No workflow match — fall back to direct AI chat
      // Use /run <name> for workflows, otherwise chat naturally
      logger.info({ message: cleanMessage }, '[SlackIntegration] No workflow match — using direct chat');

      try {
        const chatResponse = await fetch('http://localhost:8000/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SLACK_API_KEY || ''}`,
          },
          body: JSON.stringify({
            model: 'auto',
            messages: [
              {
                role: 'system',
                content: (await this.getSlackSystemPrompt()) +
                  (workflows.length > 0
                    ? ' Available workflows include: ' + workflows.slice(0, 10).map((w: any) => w.name).join(', ') + '.'
                    : ''),
              },
              { role: 'user', content: cleanMessage },
            ],
            max_tokens: 1024,
          }),
        });

        if (!chatResponse.ok) {
          const errText = await chatResponse.text();
          throw new Error(`Chat API: ${chatResponse.status} - ${errText.substring(0, 200)}`);
        }

        const chatData = await chatResponse.json() as any;
        const aiResponse = chatData.choices?.[0]?.message?.content || 'I received your message but could not generate a response.';

        await this.postMessage(botToken, {
          channel: event.event?.channel || '',
          text: aiResponse,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: aiResponse },
          }],
          thread_ts: event.event?.thread_ts || event.event?.ts,
        });

        await this.logEvent(
          integration.id, 'outbound', 'slack', event.event?.channel,
          event.event?.user, aiResponse.substring(0, 200), null, null, 'success',
        );
      } catch (chatErr: any) {
        logger.error({ err: chatErr.message }, '[SlackIntegration] Chat fallback failed');
        await this.postMessage(botToken, {
          channel: event.event?.channel || '',
          text: `Error: ${chatErr.message}`,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `:warning: ${chatErr.message}\n\n_Use \`/run <workflow-name>\` to run a specific workflow._` },
          }],
          thread_ts: event.event?.thread_ts || event.event?.ts,
        });
      }
    } catch (err: any) {
      logger.error({ err: err.message }, '[SlackIntegration] Workflow dispatch failed');
      await this.postMessage(botToken, {
        channel: event.event?.channel || '',
        text: `Error: ${err.message}`,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `:warning: *Error*: ${err.message}` },
        }],
        thread_ts: event.event?.thread_ts || event.event?.ts,
      });
    }
  }

  /**
   * Match a user's Slack message to the best-fitting workflow using token-overlap
   * scoring against workflow names and descriptions. No specific workflow names are
   * referenced in this method — it operates purely on runtime data from the DB.
   *
   * Scoring (per workflow):
   *   - Each token from the message that appears in the workflow name:        +3 pts
   *   - Each token from the message that appears in the workflow description: +1 pt
   *   (Tokens shorter than 3 characters are skipped to avoid noise.)
   *
   * A workflow is only returned when its score clears the MATCH_THRESHOLD.
   * The highest-scoring candidate above the threshold wins.
   */
  private matchWorkflowByMessage(
    workflows: Array<{ id: string; name: string; description: string | null }>,
    msg: string,
  ): { id: string; name: string; description: string | null } | null {
    const MATCH_THRESHOLD = 1; // minimum score to be considered a match
    const MIN_TOKEN_LEN = 3;   // ignore very short words (articles, prepositions, etc.)

    const msgTokens = msg
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= MIN_TOKEN_LEN);

    if (msgTokens.length === 0) return null;

    let bestScore = 0;
    let bestWorkflow: (typeof workflows)[0] | null = null;

    for (const wf of workflows) {
      const nameLower = wf.name.toLowerCase();
      const descLower = (wf.description ?? '').toLowerCase();

      let score = 0;
      for (const token of msgTokens) {
        if (nameLower.includes(token)) score += 3;
        else if (descLower.includes(token)) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestWorkflow = wf;
      }
    }

    return bestScore >= MATCH_THRESHOLD ? bestWorkflow : null;
  }

  /**
   * Execute workflow and send result back to Slack
   */
  private async executeAndRespond(integration: any, event: SlackEvent, workflowId: string): Promise<void> {
    const config = integration.config as any;
    const botToken = config?.botToken;

    if (!botToken) {
      logger.error({ integrationId: integration.id }, '[SlackIntegration] No bot token configured');
      return;
    }

    try {
      // Execute the workflow via the API
      const executionResult = await this.executeWorkflow(workflowId, {
        trigger: 'slack',
        message: event.event?.text || '',
        userId: event.event?.user || '',
        channelId: event.event?.channel || '',
        threadTs: event.event?.thread_ts,
      });

      // Format result as Block Kit message
      const blocks = this.formatBlockKitResponse(executionResult);

      // Post response to Slack
      await this.postMessage(botToken, {
        channel: event.event?.channel || '',
        text: executionResult.summary || 'Workflow completed',
        blocks,
        thread_ts: event.event?.thread_ts || event.event?.ts,
      });

      await this.logEvent(
        integration.id, 'outbound', 'slack', event.event?.channel,
        event.event?.user, executionResult.summary, workflowId, executionResult.executionId, 'success',
      );
    } catch (err: any) {
      // Post error to Slack
      await this.postMessage(botToken, {
        channel: event.event?.channel || '',
        text: `Workflow execution failed: ${err.message}`,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `:x: *Workflow Error*\n${err.message}` },
        }],
        thread_ts: event.event?.thread_ts || event.event?.ts,
      });

      await this.logEvent(
        integration.id, 'outbound', 'slack', event.event?.channel,
        event.event?.user, null, workflowId, null, 'error', err.message,
      );
    }
  }

  /**
   * Post message to Slack via API
   */
  private async postMessage(botToken: string, message: SlackBlockKitMessage): Promise<void> {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }

    const data = await response.json() as any;
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
  }

  /**
   * Execute a workflow via the internal API
   */
  private async executeWorkflow(workflowId: string, context: any): Promise<any> {
    try {
      const response = await fetch(`http://localhost:8000/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SLACK_API_KEY || ''}`,
        },
        body: JSON.stringify({
          input: context,
          trigger_type: 'slack',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Workflow API error: ${response.status} - ${errText.substring(0, 300)}`);
      }

      // The execute endpoint returns SSE (text/event-stream), not JSON.
      // Collect all events and extract the final result.
      const sseText = await response.text();
      const lines = sseText.split('\n');
      let lastOutput: any = null;
      let executionId: string | null = null;
      let finalStatus = 'completed';
      const nodeOutputs: string[] = [];

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.substring(6));
          if (event.executionId) executionId = event.executionId;
          if (event.type === 'execution_complete') {
            lastOutput = event.output || event.data;
            finalStatus = event.status || 'completed';
          }
          if (event.type === 'node_complete' && event.output) {
            // Collect meaningful node outputs (LLM responses, tool results)
            const outputStr = typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
            if (outputStr.length > 20 && outputStr.length < 3000) {
              nodeOutputs.push(`*${event.nodeLabel || event.nodeId}:*\n${outputStr.substring(0, 500)}`);
            }
          }
          if (event.type === 'execution_error') {
            finalStatus = 'failed';
            lastOutput = { error: event.error || event.message };
          }
        } catch { /* skip unparseable lines */ }
      }

      const summary = lastOutput
        ? (typeof lastOutput === 'string' ? lastOutput : JSON.stringify(lastOutput).substring(0, 2000))
        : nodeOutputs.length > 0
          ? nodeOutputs.join('\n\n')
          : 'Workflow completed (no output captured)';

      return {
        summary,
        executionId,
        status: finalStatus,
        outputs: lastOutput || {},
      };
    } catch (err: any) {
      logger.error({ err: err.message, workflowId }, '[SlackIntegration] Workflow execution failed');
      throw err;
    }
  }

  /**
   * Format workflow result as Slack Block Kit
   */
  formatBlockKitResponse(result: any): any[] {
    const blocks: any[] = [];

    // Header
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: result.status === 'success' ? 'Workflow Completed' : 'Workflow Result' },
    });

    // Summary
    if (result.summary) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: result.summary },
      });
    }

    // Output fields
    if (result.outputs && Object.keys(result.outputs).length > 0) {
      blocks.push({ type: 'divider' });

      const fields = Object.entries(result.outputs).slice(0, 10).map(([key, value]) => ({
        type: 'mrkdwn',
        text: `*${key}:*\n${String(value).substring(0, 200)}`,
      }));

      // Slack allows max 10 fields per section
      for (let i = 0; i < fields.length; i += 2) {
        blocks.push({
          type: 'section',
          fields: fields.slice(i, i + 2),
        });
      }
    }

    // Metadata footer
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `Execution ID: ${result.executionId || 'N/A'} | via OpenAgentic Flows`,
      }],
    });

    return blocks;
  }

  /**
   * Extract workflow ID from message text
   *
   * Supports: /run <name>, /flow <name>, /execute <name>
   */
  private extractWorkflowId(text: string, allowedWorkflows: string[]): string | null {
    // Pattern: /run <workflow-name> or /flow <workflow-name>
    const match = text.match(/\/(?:run|flow|execute)\s+(\S+)/i);
    if (match) {
      const name = match[1];
      // Check if it's in the allowlist
      if (allowedWorkflows.length === 0 || allowedWorkflows.includes(name)) {
        return name;
      }
    }

    // Default workflow (first allowed)
    if (allowedWorkflows.length === 1) return allowedWorkflows[0];

    return null;
  }

  /**
   * Log integration event to the database
   */
  private async logEvent(
    integrationId: string,
    direction: string,
    platform: string,
    channelId?: string | null,
    userId?: string | null,
    messageText?: string | null,
    workflowId?: string | null,
    executionId?: string | null,
    status: string = 'success',
    error?: string | null,
  ): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO admin.integration_logs (
          id, integration_id, direction, platform,
          channel_id, user_id, message_text,
          workflow_id, execution_id, status, error,
          created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3,
          $4, $5, $6,
          $7, $8, $9, $10,
          NOW()
        )
      `,
        integrationId, direction, platform,
        channelId || null, userId || null, messageText || null,
        workflowId || null, executionId || null, status, error || null,
      );
    } catch (err) {
      logger.warn({ err }, '[SlackIntegration] Failed to log event');
    }
  }
}

// Singleton
export const slackIntegrationService = new SlackIntegrationService();
