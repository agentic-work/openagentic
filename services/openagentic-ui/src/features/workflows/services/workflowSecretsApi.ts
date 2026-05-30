/**
 * workflowSecretsApi
 *
 * Small surface that the MissingSecretsWizard needs:
 *   listKnownSecretNames(workflowId) — return names visible to a workflow
 *     (workflow-scoped + global). Errors degrade to [] so a failing list
 *     call doesn't block the user from creating new secrets.
 *   createSecrets({NAME: value}, workflowId) — POST one per entry, scope=workflow
 *     when workflowId is given, scope=global otherwise. Resolves with the
 *     names that succeeded; rejects on the first non-2xx response so the
 *     wizard can surface a real error rather than silently dropping data.
 */

import { apiRequest } from '../../../utils/api';

export async function listKnownSecretNames(
  workflowId?: string,
): Promise<string[]> {
  try {
    const params = new URLSearchParams();
    if (workflowId) params.set('workflowId', workflowId);
    const response = await apiRequest(
      `/admin/workflow-secrets${params.toString() ? `?${params}` : ''}`,
    );
    if (!response.ok) return [];
    const data = await response.json();
    const arr: any[] = Array.isArray(data?.secrets) ? data.secrets : [];
    return arr.map((s) => s?.name).filter((n): n is string => typeof n === 'string');
  } catch {
    return [];
  }
}

export async function createSecrets(
  values: Record<string, string>,
  workflowId?: string,
): Promise<string[]> {
  const names = Object.keys(values);
  const created: string[] = [];

  for (const name of names) {
    const body: Record<string, any> = {
      name,
      value: values[name],
      scope: workflowId ? 'workflow' : 'global',
    };
    if (workflowId) {
      body.workflowId = workflowId;
      body.workflow_id = workflowId; // legacy field, both forms accepted by API
    }

    const response = await apiRequest('/admin/workflow-secrets', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let detail = '';
      try {
        const err = await response.json();
        detail = err?.message || err?.error || '';
      } catch { /* ignore */ }
      throw new Error(
        `Failed to create secret "${name}" (HTTP ${response.status}${detail ? `: ${detail}` : ''})`,
      );
    }
    created.push(name);
  }

  return created;
}
