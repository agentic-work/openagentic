/**
 * Add-Provider wizard — Azure AI Foundry / Azure OpenAI must support BOTH
 * `api-key` and `entra-id` auth modes. Live regression captured 2026-05-01:
 * the form forced `apiKey` as required and never exposed Entra fields
 * (tenantId / clientId / clientSecret), so admins couldn't add an
 * Entra-only AIF provider — the original deploy pattern from the seeder.
 *
 * Contract:
 *   - PROVIDER_META[type].authModes is defined for `azure-ai-foundry` and
 *     `azure-openai` and exposes both `'api-key'` and `'entra-id'` field
 *     groups.
 *   - The Entra group includes tenantId, clientId, clientSecret fields
 *     and DOES NOT include apiKey.
 *   - The api-key group includes apiKey (required) and DOES NOT include
 *     tenantId / clientId / clientSecret.
 *   - `buildPayload` emits `auth_config.type === 'entra-id'` when the
 *     form is submitted in entra-id mode, regardless of whether a
 *     stale apiKey value lingers in formData.
 *   - `buildPayload` emits `auth_config.type === 'api-key'` when the
 *     form is submitted in api-key mode.
 */

import { describe, it, expect } from 'vitest';
import { PROVIDER_META } from '../types';
import { buildPayload } from '../ProviderFormPanel';

describe('PROVIDER_META — azure-ai-foundry exposes both auth modes', () => {
  it('azure-ai-foundry has authModes with api-key and entra-id keys', () => {
    const meta = PROVIDER_META['azure-ai-foundry'];
    expect((meta as any).authModes).toBeDefined();
    expect((meta as any).authModes['api-key']).toBeDefined();
    expect((meta as any).authModes['entra-id']).toBeDefined();
  });

  it('azure-ai-foundry api-key mode includes apiKey + endpoint', () => {
    const fields = (PROVIDER_META['azure-ai-foundry'] as any).authModes['api-key'];
    const keys = fields.map((f: any) => f.key);
    expect(keys).toContain('endpoint');
    expect(keys).toContain('apiKey');
    expect(keys).not.toContain('tenantId');
    expect(keys).not.toContain('clientId');
    expect(keys).not.toContain('clientSecret');
    const apiKeyField = fields.find((f: any) => f.key === 'apiKey');
    expect(apiKeyField.required).toBe(true);
  });

  it('azure-ai-foundry entra-id mode includes tenantId + clientId + clientSecret + endpoint, no apiKey', () => {
    const fields = (PROVIDER_META['azure-ai-foundry'] as any).authModes['entra-id'];
    const keys = fields.map((f: any) => f.key);
    expect(keys).toContain('endpoint');
    expect(keys).toContain('tenantId');
    expect(keys).toContain('clientId');
    expect(keys).toContain('clientSecret');
    expect(keys).not.toContain('apiKey');
    const tenantField = fields.find((f: any) => f.key === 'tenantId');
    expect(tenantField.required).toBe(true);
    const clientIdField = fields.find((f: any) => f.key === 'clientId');
    expect(clientIdField.required).toBe(true);
  });

  it('azure-openai has the same authModes contract', () => {
    const meta = PROVIDER_META['azure-openai'];
    expect((meta as any).authModes).toBeDefined();
    expect((meta as any).authModes['api-key']).toBeDefined();
    expect((meta as any).authModes['entra-id']).toBeDefined();
    const entraKeys = (meta as any).authModes['entra-id'].map((f: any) => f.key);
    expect(entraKeys).toContain('tenantId');
    expect(entraKeys).toContain('clientId');
    expect(entraKeys).toContain('clientSecret');
  });
});

describe('buildPayload — auth_config.type follows authMode, not field-presence guess', () => {
  const baseFd = {
    name: 'aif-test',
    displayName: 'Test AIF',
    enabled: true,
    priority: 1,
    description: '',
    providerSettings: {},
  };

  it('emits auth_config.type=entra-id when authMode=entra-id', () => {
    const fd = {
      ...baseFd,
      providerType: 'azure-ai-foundry' as const,
      authMode: 'entra-id' as const,
      authConfig: {
        endpoint: 'https://awf-aif-eastus2-dev.openai.azure.com/',
        tenantId: 'ee3d15bb-e175-4ee7-995d-d992aa3199f6',
        clientId: '71f4ffd5-0db3-4045-83bd-7656ba43bc87',
        clientSecret: 'super-secret-blah',
      },
    };
    const payload = buildPayload(fd as any, false);
    expect(payload.authConfig.type).toBe('entra-id');
    expect(payload.authConfig.tenantId).toBe('ee3d15bb-e175-4ee7-995d-d992aa3199f6');
    expect(payload.authConfig.clientId).toBe('71f4ffd5-0db3-4045-83bd-7656ba43bc87');
    expect(payload.authConfig.clientSecret).toBe('super-secret-blah');
    expect(payload.authConfig.apiKey).toBeUndefined();
    expect(payload.providerConfig.endpoint).toBe('https://awf-aif-eastus2-dev.openai.azure.com/');
  });

  it('emits auth_config.type=api-key when authMode=api-key', () => {
    const fd = {
      ...baseFd,
      providerType: 'azure-ai-foundry' as const,
      authMode: 'api-key' as const,
      authConfig: {
        endpoint: 'https://awf-aif-eastus2-dev.openai.azure.com/',
        apiKey: 'sk-foo-bar',
      },
    };
    const payload = buildPayload(fd as any, false);
    expect(payload.authConfig.type).toBe('api-key');
    expect(payload.authConfig.apiKey).toBe('sk-foo-bar');
    expect(payload.authConfig.tenantId).toBeUndefined();
    expect(payload.authConfig.clientId).toBeUndefined();
    expect(payload.authConfig.clientSecret).toBeUndefined();
  });

  it('drops stale apiKey when authMode flipped to entra-id mid-form', () => {
    // User typed an apiKey, then toggled to entra-id and filled creds.
    // Stale apiKey must NOT travel to the server.
    const fd = {
      ...baseFd,
      providerType: 'azure-ai-foundry' as const,
      authMode: 'entra-id' as const,
      authConfig: {
        endpoint: 'https://awf-aif-eastus2-dev.openai.azure.com/',
        apiKey: 'sk-stale-leftover',
        tenantId: 'tid',
        clientId: 'cid',
        clientSecret: 'csec',
      },
    };
    const payload = buildPayload(fd as any, false);
    expect(payload.authConfig.type).toBe('entra-id');
    expect(payload.authConfig.apiKey).toBeUndefined();
  });
});
