/**
 * teams_message node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeTeamsNode.
 * POSTs to a Microsoft Teams incoming webhook. When cardTitle is set,
 * an Adaptive Card payload is sent; otherwise plain text.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { webhookUrl, message, cardTitle, cardBody } = node.data as Record<string, any>;

  const resolvedUrl = ctx.interpolateTemplate(
    webhookUrl || process.env.TEAMS_WEBHOOK_URL || '',
    input,
  );
  const resolvedMsg = ctx.interpolateTemplate(message || '', input);

  if (!resolvedUrl) {
    throw new Error('Teams node requires a webhook URL (or TEAMS_WEBHOOK_URL env)');
  }

  ctx.logger.info({ nodeId: node.id }, '[teams_message] Executing');

  let payload: Record<string, unknown>;
  if (cardTitle) {
    payload = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: ctx.interpolateTemplate(cardTitle, input),
                weight: 'Bolder',
                size: 'Medium',
              },
              {
                type: 'TextBlock',
                text: ctx.interpolateTemplate(cardBody || message || '', input),
                wrap: true,
              },
            ],
          },
        },
      ],
    };
  } else {
    payload = { text: resolvedMsg };
  }

  const response = await abortableAxiosPost({ signal: ctx.signal }, resolvedUrl, payload, {
    timeout: 15000,
    validateStatus: () => true,
  });

  return {
    status: response.status,
    sent: response.status === 200 || response.status === 202,
  };
}
