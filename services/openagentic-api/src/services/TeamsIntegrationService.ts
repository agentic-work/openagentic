import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import jwksRsaImport, { JwksClient } from 'jwks-rsa';
import { loggers } from '../utils/logger.js';

// jwks-rsa ships as CJS; the actual factory may live at .default or at the
// module root depending on the bundler/runtime. Match the pattern used in
// azureADAuth.ts for consistent behaviour.
const jwksClientFactory: (opts: any) => JwksClient =
  (jwksRsaImport as any).default ?? (jwksRsaImport as any);

const logger = loggers.routes;

interface TeamsActivity {
  type: string; // 'message', 'conversationUpdate', etc.
  id: string;
  timestamp: string;
  serviceUrl: string;
  channelId: string;
  from: { id: string; name: string; aadObjectId?: string };
  conversation: { id: string; tenantId: string; conversationType?: string };
  recipient: { id: string; name: string };
  text?: string;
  value?: any;
}

interface AdaptiveCard {
  type: 'AdaptiveCard';
  $schema: string;
  version: string;
  body: any[];
  actions?: any[];
}

/**
 * Resolve JWKS cache max-age from env var (default: 10 minutes per jwks-rsa recommendation).
 * Microsoft rotates Bot Framework keys periodically; a shorter cache limits the window
 * in which a revoked key could still be used.
 */
function resolveJwksCacheMs(): number {
  const env = process.env.TEAMS_JWKS_CACHE_MS;
  if (env && env.trim().length > 0) {
    const parsed = Number.parseInt(env, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 10 * 60 * 1000; // 10 minutes
}

/**
 * Resolve JWKS rate-limit requests-per-minute from env var (default: 10).
 */
function resolveJwksRateLimit(): number {
  const env = process.env.TEAMS_JWKS_RATE_LIMIT_PER_MIN;
  if (env && env.trim().length > 0) {
    const parsed = Number.parseInt(env, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 10;
}

/**
 * Resolve JWT clock tolerance in seconds from env var (default: 300s per Microsoft Bot Framework
 * recommendation). Allows for clock skew between the token issuer and this service.
 */
function resolveClockToleranceSec(): number {
  const env = process.env.TEAMS_JWT_CLOCK_TOLERANCE_SEC;
  if (env && env.trim().length > 0) {
    const parsed = Number.parseInt(env, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  return 300; // 5 minutes
}

/**
 * Singleton JWKS client for the Microsoft Bot Framework public keys.
 * Cached for 10 min (configurable via TEAMS_JWKS_CACHE_MS); rate-limited
 * to avoid hammering the endpoint. 10-minute cache is the jwks-rsa recommended
 * default and limits revoked-key exposure window vs the previous 24 h.
 * Rate limit configurable via TEAMS_JWKS_RATE_LIMIT_PER_MIN (default 10).
 */
const defaultJwksClient: JwksClient = jwksClientFactory({
  jwksUri: 'https://login.botframework.com/v1/.well-known/keys',
  cache: true,
  cacheMaxAge: resolveJwksCacheMs(),
  rateLimit: true,
  jwksRequestsPerMinute: resolveJwksRateLimit(),
});

/**
 * Parse the TEAMS_VALID_ISSUERS env-var (comma-separated).
 * Defaults to the Bot Framework public issuer only.
 */
function resolveValidIssuers(): string[] {
  const env = process.env.TEAMS_VALID_ISSUERS;
  if (env && env.trim().length > 0) {
    return env.split(',').map(s => s.trim()).filter(Boolean);
  }
  return ['https://api.botframework.com'];
}

export class TeamsIntegrationService {
  private prisma: PrismaClient;
  private jwks: JwksClient;
  private readonly validIssuers: string[];
  private readonly expectedAudience: string | undefined;
  private readonly clockToleranceSec: number;

  /**
   * @param prisma           Prisma client instance.
   * @param jwksClientInstance  Optional JWKS client override (used in tests).
   * @param expectedAudience    Optional bot Microsoft App ID. When provided, the JWT `aud`
   *                            claim must match exactly. When omitted, audience is not checked
   *                            (graceful migration path). Defaults to TEAMS_BOT_APP_ID env var.
   */
  constructor(prisma: PrismaClient, jwksClientInstance?: JwksClient, expectedAudience?: string) {
    this.prisma = prisma;
    this.jwks = jwksClientInstance ?? defaultJwksClient;
    this.validIssuers = resolveValidIssuers();
    this.expectedAudience = expectedAudience ?? process.env.TEAMS_BOT_APP_ID ?? undefined;
    this.clockToleranceSec = resolveClockToleranceSec();
  }

  /**
   * Verify an inbound Teams Bot Framework JWT.
   *
   * Security requirements enforced:
   *  1. Token must be RS256 (algorithm whitelist — no HS256 / none)
   *  2. Signature must match a key from the Bot Framework JWKS endpoint
   *  3. Issuer must exactly match a configured valid issuer (no prefix tricks)
   *  4. Token must not be expired (jwt.verify enforces exp)
   *  5. Audience claim checked when `expectedAudience` is configured (constructor arg or
   *     `TEAMS_BOT_APP_ID` env var); skipped otherwise (graceful migration default).
   *  6. Clock tolerance of 300 s applied (configurable via `TEAMS_JWT_CLOCK_TOLERANCE_SEC`)
   *     to accommodate clock skew per Microsoft Bot Framework recommendation.
   *
   * Fail-closed: any error (network, signature, expired, wrong audience) → false + warn log.
   */
  async verifyToken(authHeader: string): Promise<boolean> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

    const token = authHeader.substring(7);
    if (!token) return false;

    try {
      // Decode header only (no signature check yet) to get the kid.
      // We explicitly do NOT use jwt.decode for any trust decision —
      // it is only used to extract the kid so we can fetch the right public key.
      const unverified = jwt.decode(token, { complete: true });
      if (!unverified || typeof unverified !== 'object') return false;

      // JwtHeader.kid is typed — no cast needed.
      const kid = unverified.header.kid;
      if (!kid) {
        logger.warn('[TeamsIntegration] Token missing kid header');
        return false;
      }

      // Fetch the public key from JWKS (promise-style — works with both real
      // jwks-rsa client and test mocks that return Promise).
      const signingKey = await this.jwks.getSigningKey(kid);
      const publicKey = signingKey.getPublicKey();

      // Perform full cryptographic verification:
      //   - RS256 algorithm whitelist (rejects HS256, none, etc.)
      //   - signature against the fetched public key
      //   - issuer exact-match (not prefix-match)
      //   - audience exact-match (when expectedAudience is configured)
      //   - expiry / nbf / iat enforced with clockTolerance for clock skew
      jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        // Cast to the non-empty tuple type that @types/jsonwebtoken expects.
        // resolveValidIssuers() always returns at least one entry so this is safe.
        issuer: this.validIssuers as [string, ...string[]],
        // Audience check: only enforced when expectedAudience is set.
        // If omitted, jwt.verify skips the aud check (graceful migration).
        ...(this.expectedAudience ? { audience: this.expectedAudience } : {}),
        // 300 s tolerance per Microsoft Bot Framework recommendation.
        clockTolerance: this.clockToleranceSec,
        complete: false,
      });

      return true;
    } catch (err: any) {
      logger.warn('[TeamsIntegration] Token verification failed: %s', err?.message ?? err);
      return false;
    }
  }

  // Handle incoming Teams activity
  async handleActivity(integrationId: string, activity: TeamsActivity): Promise<{ statusCode: number; body: any }> {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId }
    });

    if (!integration || integration.status !== 'active') {
      return { statusCode: 403, body: { error: 'Integration not active' } };
    }

    // Check channel allowlist
    const channelId = activity.conversation?.id;
    if (channelId && integration.allowed_channels.length > 0 && !integration.allowed_channels.includes(channelId)) {
      await this.logEvent(integrationId, 'inbound', 'teams', channelId, activity.from?.id, activity.text, null, null, 'error', 'Channel not in allowlist');
      return { statusCode: 403, body: { error: 'Channel not allowed' } };
    }

    // Log inbound event
    await this.logEvent(integrationId, 'inbound', 'teams', channelId, activity.from?.id, activity.text);

    if (activity.type === 'message' && activity.text) {
      const workflowId = this.extractWorkflowId(activity.text, integration.allowed_workflows);

      if (workflowId) {
        this.executeAndRespond(integration, activity, workflowId).catch(err => {
          console.error('[TeamsIntegration] Workflow execution error:', err);
        });
        return { statusCode: 200, body: {} };
      }
    }

    // Conversation update (bot added/removed)
    if (activity.type === 'conversationUpdate') {
      return { statusCode: 200, body: {} };
    }

    return { statusCode: 200, body: {} };
  }

  // Execute workflow and send Adaptive Card response
  private async executeAndRespond(integration: any, activity: TeamsActivity, workflowId: string): Promise<void> {
    const config = integration.config as any;
    const appId = config?.appId;
    const appPassword = config?.appPassword;

    if (!appId || !appPassword) {
      console.error('[TeamsIntegration] Missing app credentials');
      return;
    }

    try {
      const executionResult = await this.executeWorkflow(workflowId, {
        trigger: 'teams',
        message: activity.text || '',
        userId: activity.from?.id || '',
        channelId: activity.conversation?.id || '',
        tenantId: activity.conversation?.tenantId
      });

      const card = this.formatAdaptiveCard(executionResult);
      await this.sendActivity(activity.serviceUrl, activity.conversation.id, activity.id, appId, appPassword, {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: card
        }]
      });

      await this.logEvent(
        integration.id, 'outbound', 'teams', activity.conversation?.id,
        activity.from?.id, executionResult.summary, workflowId, executionResult.executionId, 'success'
      );
    } catch (err: any) {
      await this.sendActivity(activity.serviceUrl, activity.conversation.id, activity.id, appId, appPassword, {
        type: 'message',
        text: `Workflow execution failed: ${err.message}`
      });

      await this.logEvent(
        integration.id, 'outbound', 'teams', activity.conversation?.id,
        activity.from?.id, null, workflowId, null, 'error', err.message
      );
    }
  }

  // Send activity to Teams via Bot Framework
  private async sendActivity(serviceUrl: string, conversationId: string, replyToId: string, appId: string, appPassword: string, activity: any): Promise<void> {
    // Get Bot Framework token
    const tokenResponse = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appPassword,
        scope: 'https://api.botframework.com/.default'
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) throw new Error('Failed to get Bot Framework token');

    const url = `${serviceUrl}v3/conversations/${conversationId}/activities/${replyToId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(activity)
    });

    if (!response.ok) {
      throw new Error(`Teams API error: ${response.status}`);
    }
  }

  // Format workflow result as Adaptive Card
  formatAdaptiveCard(result: any): AdaptiveCard {
    const body: any[] = [];

    // Header
    body.push({
      type: 'TextBlock',
      text: result.status === 'success' ? 'Workflow Completed' : 'Workflow Result',
      weight: 'bolder',
      size: 'large',
      color: result.status === 'success' ? 'good' : 'warning'
    });

    // Summary
    if (result.summary) {
      body.push({
        type: 'TextBlock',
        text: result.summary,
        wrap: true
      });
    }

    // Outputs
    if (result.outputs && Object.keys(result.outputs).length > 0) {
      body.push({
        type: 'ColumnSet',
        separator: true,
        columns: Object.entries(result.outputs).slice(0, 6).map(([key, value]) => ({
          type: 'Column',
          width: 'stretch',
          items: [
            { type: 'TextBlock', text: key, weight: 'bolder', size: 'small' },
            { type: 'TextBlock', text: String(value).substring(0, 200), wrap: true, size: 'small' }
          ]
        }))
      });
    }

    // Footer
    body.push({
      type: 'TextBlock',
      text: `Execution ID: ${result.executionId || 'N/A'} | via OpenAgentic Flows`,
      size: 'small',
      isSubtle: true,
      separator: true
    });

    return {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body
    };
  }

  private async executeWorkflow(workflowId: string, context: any): Promise<any> {
    const baseUrl =
      process.env.WORKFLOW_SERVICE_URL ||
      process.env.OPENAGENTIC_API_URL ||
      'http://localhost:8000';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (process.env.INTERNAL_SERVICE_SECRET) {
      headers['X-Internal-Secret'] = process.env.INTERNAL_SERVICE_SECRET;
    }

    const response = await fetch(`${baseUrl}/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: context, trigger_type: 'teams' }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Workflow API error: ${response.status} - ${errText.substring(0, 300)}`);
    }

    // The execute endpoint returns SSE (text/event-stream).
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
          lastOutput = event.output || event.data || null;
          finalStatus = event.status || 'completed';
        }
        if (event.type === 'node_complete' && event.output) {
          const outputStr =
            typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
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
  }

  private extractWorkflowId(text: string, allowedWorkflows: string[]): string | null {
    const match = text.match(/\/(?:run|flow|execute)\s+(\S+)/i);
    if (match) {
      const name = match[1];
      if (allowedWorkflows.length === 0 || allowedWorkflows.includes(name)) return name;
    }
    if (allowedWorkflows.length === 1) return allowedWorkflows[0];
    return null;
  }

  private async logEvent(
    integrationId: string, direction: string, platform: string,
    channelId?: string | null, userId?: string | null, messageText?: string | null,
    workflowId?: string | null, executionId?: string | null,
    status: string = 'success', error?: string | null
  ): Promise<void> {
    try {
      await this.prisma.integrationLog.create({
        data: {
          integration_id: integrationId, direction, platform,
          channel_id: channelId || undefined, user_id: userId || undefined,
          message_text: messageText || undefined, workflow_id: workflowId || undefined,
          execution_id: executionId || undefined, status, error: error || undefined
        }
      });
    } catch (err) {
      console.error('[TeamsIntegration] Failed to log event:', err);
    }
  }
}
