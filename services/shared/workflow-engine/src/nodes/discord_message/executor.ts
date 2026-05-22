/**
 * discord_message node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeDiscordNode.
 * POSTs a payload to a Discord channel webhook. Supports plain content,
 * custom username, and embed objects.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { webhookUrl, content, username = 'OpenAgentic', embeds } = node.data as Record<
    string,
    any
  >;

  const resolvedUrl = ctx.interpolateTemplate(webhookUrl || '', input);
  const resolvedContent = ctx.interpolateTemplate(content || '', input);

  if (!resolvedUrl) {
    throw new Error('Discord node requires a webhook URL');
  }

  ctx.logger.info({ nodeId: node.id }, '[discord_message] Executing');

  const payload: Record<string, unknown> = { content: resolvedContent, username };
  if (Array.isArray(embeds) && embeds.length > 0) payload.embeds = embeds;

  const response = await abortableAxiosPost({ signal: ctx.signal }, resolvedUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
    validateStatus: () => true,
  });

  return {
    status: response.status,
    sent: response.status === 204 || response.status === 200,
  };
}
