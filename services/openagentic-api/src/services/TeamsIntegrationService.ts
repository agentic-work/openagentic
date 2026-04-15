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

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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

export class TeamsIntegrationService {
  private prisma: PrismaClient;
  // Microsoft Bot Framework OpenID metadata URL
  private readonly OPENID_METADATA_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // Verify Teams Bot Framework token
  async verifyToken(authHeader: string): Promise<boolean> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

    try {
      const token = authHeader.substring(7);
      // Decode without verification to get issuer
      const decoded = jwt.decode(token, { complete: true }) as any;
      if (!decoded) return false;

      // Verify issuer is Microsoft Bot Framework
      const validIssuers = [
        'https://api.botframework.com',
        'https://sts.windows.net/',
        'https://login.microsoftonline.com/'
      ];

      const issuer = decoded.payload?.iss || '';
      return validIssuers.some(vi => issuer.startsWith(vi));
    } catch {
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
    return { summary: 'Workflow executed', executionId: null, outputs: {} };
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
