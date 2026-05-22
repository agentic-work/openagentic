/**
 * workflowSecretsApi — list known secret names + bulk create.
 *
 * Wraps the admin/workflow-secrets endpoints with the small surface
 * the MissingSecretsWizard needs:
 *   - listKnownSecretNames(workflowId): names visible to this workflow
 *     (workflow-scoped + global). Used to filter the scan output.
 *   - createSecrets({NAME: value}, workflowId): POST one secret per
 *     entry, scope=workflow when workflowId is provided. Resolves with
 *     the names that succeeded; rejects with the first error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listKnownSecretNames,
  createSecrets,
} from '../workflowSecretsApi';

const originalFetch = globalThis.fetch;

function mockFetchResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('workflowSecretsApi', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('listKnownSecretNames', () => {
    it('returns the names of secrets visible to the workflow', async () => {
      (globalThis.fetch as any).mockResolvedValue(
        mockFetchResponse({
          secrets: [
            { name: 'GLOBAL_KEY', scope: 'global' },
            { name: 'WF_TOKEN', scope: 'workflow', workflow_id: 'flow-123' },
          ],
        }),
      );
      const names = await listKnownSecretNames('flow-123');
      expect(names.sort()).toEqual(['GLOBAL_KEY', 'WF_TOKEN']);
      const url = (globalThis.fetch as any).mock.calls[0][0];
      expect(url).toContain('/admin/workflow-secrets');
    });

    it('returns [] when the API returns no secrets', async () => {
      (globalThis.fetch as any).mockResolvedValue(mockFetchResponse({ secrets: [] }));
      expect(await listKnownSecretNames('flow-x')).toEqual([]);
    });

    it('returns [] when the API errors (gracefully degrade — wizard still works)', async () => {
      (globalThis.fetch as any).mockResolvedValue(mockFetchResponse({}, 500));
      expect(await listKnownSecretNames('flow-x')).toEqual([]);
    });
  });

  describe('createSecrets', () => {
    it('POSTs one secret per name, scope=workflow with workflow_id', async () => {
      (globalThis.fetch as any).mockResolvedValue(
        mockFetchResponse({ success: true, secret: { id: 'new-id' } }, 201),
      );
      const created = await createSecrets(
        { STRIPE_KEY: 'sk_live', PD_KEY: 'pd_xyz' },
        'flow-42',
      );
      expect(created.sort()).toEqual(['PD_KEY', 'STRIPE_KEY']);
      expect((globalThis.fetch as any).mock.calls).toHaveLength(2);
      const firstCall = (globalThis.fetch as any).mock.calls[0];
      const opts = firstCall[1];
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.scope).toBe('workflow');
      expect(body.workflowId || body.workflow_id).toBe('flow-42');
      expect(['STRIPE_KEY', 'PD_KEY']).toContain(body.name);
    });

    it('uses scope=global and omits workflowId when no workflowId given', async () => {
      (globalThis.fetch as any).mockResolvedValue(
        mockFetchResponse({ success: true }, 201),
      );
      await createSecrets({ FOO: 'bar' }, undefined);
      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.scope).toBe('global');
      expect(body.workflowId).toBeUndefined();
      expect(body.workflow_id).toBeUndefined();
    });

    it('rejects when one of the POSTs fails', async () => {
      (globalThis.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse({ success: true }, 201))
        .mockResolvedValueOnce(mockFetchResponse({ error: 'duplicate' }, 409));
      await expect(createSecrets({ A: '1', B: '2' }, 'f1')).rejects.toThrow();
    });
  });
});
