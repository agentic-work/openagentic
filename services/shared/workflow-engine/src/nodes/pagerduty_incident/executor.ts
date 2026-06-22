/**
 * pagerduty_incident node executor.
 *
 * Migrated + extended from WorkflowExecutionEngine.executePagerDutyNode.
 *
 * PagerDuty Events API v2 (https://events.pagerduty.com/v2/enqueue):
 *   - trigger:     creates or updates an incident; requires payload object
 *   - acknowledge: acks an existing incident; requires dedup_key
 *   - resolve:     closes an existing incident; requires dedup_key
 *
 * Task #26 extension: support custom_details, client, client_url.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

const PD_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const {
    action = 'trigger',
    routingKey,
    severity = 'error',
    summary,
    source = 'openagentic',
    dedupKey,
    customDetails,
    client,
    clientUrl,
  } = node.data as Record<string, any>;

  const resolvedKey = ctx.interpolateTemplate(
    routingKey || process.env.PAGERDUTY_ROUTING_KEY || '',
    input,
  );
  const resolvedSummary = ctx.interpolateTemplate(summary || '', input);

  if (!resolvedKey) {
    throw new Error(
      'PagerDuty node requires a routing key (or PAGERDUTY_ROUTING_KEY env)',
    );
  }

  ctx.logger.info(
    { nodeId: node.id, action, severity },
    '[pagerduty_incident] Executing',
  );

  const payload: Record<string, unknown> = {
    routing_key: resolvedKey,
    event_action: action,
  };

  if (action === 'trigger') {
    const triggerPayload: Record<string, unknown> = {
      summary: resolvedSummary,
      severity,
      source: ctx.interpolateTemplate(source, input),
      timestamp: new Date().toISOString(),
    };
    if (customDetails && typeof customDetails === 'object') {
      triggerPayload.custom_details = customDetails;
    }
    payload.payload = triggerPayload;
  }

  if (dedupKey) payload.dedup_key = ctx.interpolateTemplate(dedupKey, input);
  if (client) payload.client = ctx.interpolateTemplate(client, input);
  if (clientUrl) payload.client_url = ctx.interpolateTemplate(clientUrl, input);

  const response = await abortableAxiosPost({ signal: ctx.signal }, PD_EVENTS_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
    validateStatus: () => true,
  });

  return {
    status: response.status,
    sent: response.status === 202,
    dedupKey: (response.data as any)?.dedup_key,
    action,
  };
}
