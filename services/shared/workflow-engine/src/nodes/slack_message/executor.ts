/**
 * slack_message node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeSlackNode.
 * POSTs a payload to a Slack incoming webhook. Falls back to
 * SLACK_WEBHOOK_URL env when the node has no webhookUrl set.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { webhookUrl, channel, message, blocks } = node.data as Record<string, any>;

  const resolvedUrl = ctx.interpolateTemplate(
    webhookUrl || process.env.SLACK_WEBHOOK_URL || '',
    input,
  );
  const resolvedMsg = ctx.interpolateTemplate(message || '', input);

  if (!resolvedUrl) {
    throw new Error('Slack node requires a webhook URL (or SLACK_WEBHOOK_URL env)');
  }

  ctx.logger.info(
    { nodeId: node.id, channel },
    '[slack_message] Executing',
  );

  const payload: Record<string, unknown> = { text: resolvedMsg };
  if (channel) payload.channel = ctx.interpolateTemplate(channel, input);
  if (Array.isArray(blocks) && blocks.length > 0) payload.blocks = blocks;

  const response = await abortableAxiosPost({ signal: ctx.signal }, resolvedUrl, payload, {
    timeout: 15000,
    validateStatus: () => true,
  });

  return {
    status: response.status,
    sent: response.status === 200,
    channel: channel || 'default',
  };
}

