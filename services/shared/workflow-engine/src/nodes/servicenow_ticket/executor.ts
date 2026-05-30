/**
 * servicenow_ticket node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeServiceNowNode.
 * POSTs a record to ServiceNow's REST Table API. Defaults to the
 * `incident` table; configurable via the `table` setting.
 *
 * Auth: SERVICENOW_AUTH_TOKEN (Bearer/Basic) takes precedence over
 * SERVICENOW_USERNAME + SERVICENOW_PASSWORD basic-auth.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const {
    action = 'create_incident',
    instanceUrl,
    table = 'incident',
    fields = {},
  } = node.data as Record<string, any>;

  const resolvedUrl = ctx.interpolateTemplate(
    instanceUrl || process.env.SERVICENOW_INSTANCE_URL || '',
    input,
  );

  if (!resolvedUrl) {
    throw new Error(
      'ServiceNow node requires an instance URL (or SERVICENOW_INSTANCE_URL env)',
    );
  }

  ctx.logger.info(
    { nodeId: node.id, action, table },
    '[servicenow_ticket] Executing',
  );

  const resolvedFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    resolvedFields[key] =
      typeof value === 'string' ? ctx.interpolateTemplate(value, input) : value;
  }

  const baseUrl = resolvedUrl.replace(/\/$/, '');
  const apiUrl = `${baseUrl}/api/now/table/${table}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const auth = process.env.SERVICENOW_AUTH_TOKEN;
  if (auth?.startsWith('Basic ') || auth?.startsWith('Bearer ')) {
    headers['Authorization'] = auth;
  } else if (process.env.SERVICENOW_USERNAME && process.env.SERVICENOW_PASSWORD) {
    headers['Authorization'] =
      'Basic ' +
      Buffer.from(
        `${process.env.SERVICENOW_USERNAME}:${process.env.SERVICENOW_PASSWORD}`,
      ).toString('base64');
  }

  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    apiUrl,
    resolvedFields,
    {
      headers,
      timeout: 30000,
      validateStatus: () => true,
    },
  );

  return {
    status: response.status,
    created: response.status === 201,
    sysId: (response.data as any)?.result?.sys_id,
    number: (response.data as any)?.result?.number,
  };
}
