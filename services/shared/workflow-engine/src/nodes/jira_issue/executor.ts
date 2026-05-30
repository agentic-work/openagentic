/**
 * jira_issue node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeJiraNode.
 * Creates a Jira issue via REST API v3. Auth: HTTP Basic with
 * JIRA_EMAIL:JIRA_API_TOKEN env vars (Atlassian's recommended approach
 * for Jira Cloud).
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
    action = 'create',
    projectKey,
    issueType = 'Task',
    summary,
    description,
    priority = 'Medium',
    assignee,
  } = node.data as Record<string, any>;

  const baseUrl = ctx.interpolateTemplate(process.env.JIRA_BASE_URL || '', input);
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl) throw new Error('Jira node requires JIRA_BASE_URL env var');
  if (!email || !apiToken) {
    throw new Error('Jira node requires JIRA_EMAIL and JIRA_API_TOKEN env vars');
  }

  const resolvedProject = ctx.interpolateTemplate(projectKey || '', input);
  if (!resolvedProject) {
    throw new Error('Jira node requires a project key');
  }

  if (action !== 'create') {
    throw new Error(`Jira action "${action}" not yet implemented`);
  }

  const resolvedSummary = ctx.interpolateTemplate(summary || '', input);
  const resolvedDesc = ctx.interpolateTemplate(description || '', input);

  ctx.logger.info(
    { nodeId: node.id, action, projectKey: resolvedProject },
    '[jira_issue] Executing',
  );

  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
  };

  const payload: any = {
    fields: {
      project: { key: resolvedProject },
      summary: resolvedSummary,
      issuetype: { name: issueType },
      priority: { name: priority },
    },
  };

  if (resolvedDesc) {
    // Atlassian Document Format (ADF) wrapper required by Jira Cloud v3
    payload.fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: resolvedDesc }],
        },
      ],
    };
  }

  if (assignee) {
    payload.fields.assignee = { accountId: ctx.interpolateTemplate(assignee, input) };
  }

  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    `${baseUrl}/rest/api/3/issue`,
    payload,
    { headers, timeout: 30000, validateStatus: () => true },
  );

  return {
    status: response.status,
    created: response.status === 201,
    key: (response.data as any)?.key,
    id: (response.data as any)?.id,
  };
}
