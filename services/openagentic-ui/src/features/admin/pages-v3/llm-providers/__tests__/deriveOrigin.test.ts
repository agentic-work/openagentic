/**
 * Tests for `deriveOrigin` — pins the auto-derive logic that makes the v3
 * add-provider modal pass the api's DISCRIMINATOR_MISSING gate for every
 * provider type, without exposing an Origin section.
 *
 * Spec: services/openagentic-api/src/services/llm-providers/ProviderDiscriminatorSchema.ts
 */

import { describe, it, expect } from 'vitest'
import { deriveOrigin } from '../deriveOrigin'

describe('deriveOrigin', () => {
  it('env defaults to prod when not specified', () => {
    const o = deriveOrigin({ providerType: 'openai', auth: {}, providerName: 'x' })
    expect(o.env).toBe('prod')
  })

  it('existingOrigin.env is preserved', () => {
    const o = deriveOrigin({
      providerType: 'openai',
      auth: {},
      existingOrigin: { env: 'staging' },
      providerName: 'x',
    })
    expect(o.env).toBe('staging')
  })

  describe('aws-bedrock', () => {
    it('derives region from auth.region', () => {
      const o = deriveOrigin({
        providerType: 'aws-bedrock',
        auth: { region: 'us-east-1', awsAccessKeyId: 'AKIAEXAMPLEPLACEHOLDER' },
      })
      expect(o.region).toBe('us-east-1')
    })

    it('derives synthetic account from AKID prefix', () => {
      const o = deriveOrigin({
        providerType: 'aws-bedrock',
        auth: { region: 'us-east-1', awsAccessKeyId: 'AKIAEXAMPLEPLACEHOLDER' },
      })
      // AKIA + UROK2MGLW2OKLFSR (16 chars) → first 12 after AKIA prefix
      expect(o.account).toBe('akid-UROK2MGLW2OK')
    })

    it('account is `unknown` when no access key', () => {
      const o = deriveOrigin({ providerType: 'aws-bedrock', auth: {} })
      expect(o.account).toBe('unknown')
    })

    it('account falls back to first 16 chars of non-AKIA access key', () => {
      const o = deriveOrigin({
        providerType: 'aws-bedrock',
        auth: { awsAccessKeyId: 'AROA0123456789ABCDEF' },
      })
      expect(o.account).toBe('AROA0123456789AB')
    })

    it('full Bedrock origin: env + region + account', () => {
      const o = deriveOrigin({
        providerType: 'aws-bedrock',
        auth: { region: 'us-east-1', awsAccessKeyId: 'AKIAEXAMPLEPLACEHOLDER' },
      })
      expect(o).toEqual({
        env: 'prod',
        region: 'us-east-1',
        account: 'akid-UROK2MGLW2OK',
      })
    })

    it('existing origin fields are preserved over derivation', () => {
      const o = deriveOrigin({
        providerType: 'aws-bedrock',
        auth: { region: 'us-east-1', awsAccessKeyId: 'AKIAEXAMPLEPLACEHOLDER' },
        existingOrigin: { account: 'manual-acct', region: 'eu-west-2' },
      })
      expect(o.account).toBe('manual-acct')
      expect(o.region).toBe('eu-west-2')
    })
  })

  describe('vertex-ai', () => {
    it('derives region + project from auth', () => {
      const o = deriveOrigin({
        providerType: 'vertex-ai',
        auth: { region: 'us-central1', projectId: 'my-gcp-prj' },
      })
      expect(o.region).toBe('us-central1')
      expect(o.project).toBe('my-gcp-prj')
    })

    it('extracts project_id from service-account JSON when projectId missing', () => {
      const o = deriveOrigin({
        providerType: 'vertex-ai',
        auth: {
          region: 'us-central1',
          credentialsJson: JSON.stringify({ project_id: 'svc-acct-prj', client_email: 'x@y.iam' }),
        },
      })
      expect(o.project).toBe('svc-acct-prj')
    })

    it('tolerates invalid JSON in credentials', () => {
      const o = deriveOrigin({
        providerType: 'vertex-ai',
        auth: { region: 'us', credentialsJson: 'NOT JSON' },
      })
      expect(o.project).toBeUndefined()
    })
  })

  describe('ollama', () => {
    it('derives hostname from auth.endpoint URL', () => {
      const o = deriveOrigin({
        providerType: 'ollama',
        auth: { endpoint: 'http://10.2.10.142:11434' },
      })
      expect(o.hostname).toBe('10.2.10.142')
    })

    it('derives hostname from bare host:port', () => {
      const o = deriveOrigin({
        providerType: 'ollama',
        auth: { endpoint: 'hal:11434' },
      })
      expect(o.hostname).toBe('hal')
    })

    it('defaults hostname to localhost when no endpoint', () => {
      const o = deriveOrigin({ providerType: 'ollama', auth: {} })
      expect(o.hostname).toBe('localhost')
    })
  })

  describe('azure-ai-foundry / azure-openai', () => {
    it('derives tenant + resource from auth', () => {
      const o = deriveOrigin({
        providerType: 'azure-ai-foundry',
        auth: {
          tenantId: 'tnt-abc',
          endpoint: 'https://my-aif-eastus.cognitiveservices.azure.com/',
        },
      })
      expect(o.tenant).toBe('tnt-abc')
      expect(o.resource).toBe('my-aif-eastus')
    })

    it('falls back to hostStr if endpoint missing', () => {
      const o = deriveOrigin({
        providerType: 'azure-openai',
        auth: { tenantId: 't-1' },
        hostStr: 'my-aoai.openai.azure.com',
      })
      expect(o.resource).toBe('my-aoai')
    })
  })

  describe('anthropic / openai', () => {
    it('uses providerName as label', () => {
      const o = deriveOrigin({
        providerType: 'anthropic',
        auth: {},
        providerName: 'claude-prod-1',
      })
      expect(o.label).toBe('claude-prod-1')
    })

    it('default label when providerName empty', () => {
      const o = deriveOrigin({ providerType: 'openai', auth: {} })
      expect(o.label).toBe('default')
    })
  })
})
