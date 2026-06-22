/**
 * Tests for bootstrapProviderEnv — the pure parser that normalizes
 * helm's BOOTSTRAP_PROVIDER_* env vars into the seed payload shape.
 */
import { describe, it, expect } from 'vitest';
import { parseBootstrapProviderEnv } from '../bootstrapProviderEnv.js';

describe('parseBootstrapProviderEnv', () => {
  it('returns null when NAME is unset (bootstrap disabled)', () => {
    const r = parseBootstrapProviderEnv({});
    expect(r).toBeNull();
  });

  it('returns null when NAME is present-but-empty', () => {
    const r = parseBootstrapProviderEnv({ BOOTSTRAP_PROVIDER_NAME: '' });
    expect(r).toBeNull();
  });

  it('returns null when NAME is whitespace-only', () => {
    const r = parseBootstrapProviderEnv({ BOOTSTRAP_PROVIDER_NAME: '   ' });
    expect(r).toBeNull();
  });

  it('throws when NAME is set but TYPE is empty (operator error)', () => {
    expect(() =>
      parseBootstrapProviderEnv({
        BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
        BOOTSTRAP_PROVIDER_TYPE: '',
      }),
    ).toThrow(/TYPE is empty/);
  });

  it('parses the Ollama k3s dev env block', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
      BOOTSTRAP_PROVIDER_DISPLAY_NAME: 'Ollama (hal)',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
      BOOTSTRAP_PROVIDER_CONFIG: JSON.stringify({
        type: 'ollama',
        endpoint: 'http://192.0.2.10:11434',
      }),
      BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
        chat: 'gpt-oss:20b',
        codemode: 'gpt-oss:20b',
        embedding: 'nomic-embed-text',
        embeddingDimension: 768,
      }),
    });
    expect(r).not.toBeNull();
    expect(r!.name).toBe('ollama-hal');
    expect(r!.displayName).toBe('Ollama (hal)');
    expect(r!.providerType).toBe('ollama');
    expect(r!.authConfig).toEqual({
      type: 'ollama',
      endpoint: 'http://192.0.2.10:11434',
    });
    expect(r!.defaults).toEqual({
      chat: 'gpt-oss:20b',
      codemode: 'gpt-oss:20b',
      vision: null,
      imageGen: null,
      embedding: 'nomic-embed-text',
      embeddingDimension: 768,
    });
  });

  it('parses the imageGen default (operator-supplied image model id, no literal in source)', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'bedrock-ops',
      BOOTSTRAP_PROVIDER_TYPE: 'aws-bedrock',
      BOOTSTRAP_PROVIDER_CONFIG: JSON.stringify({ region: 'us-east-1' }),
      BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
        chat: 'gpt-oss:20b',
        imageGen: 'amazon.nova-canvas-v1:0',
      }),
    });
    expect(r).not.toBeNull();
    expect((r!.defaults as any).imageGen).toBe('amazon.nova-canvas-v1:0');
  });

  it('imageGen is null when the operator omits it', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
      BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({ chat: 'gpt-oss:20b' }),
    });
    expect((r!.defaults as any).imageGen).toBeNull();
  });

  it('parses an AIF bootstrap block', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'aif',
      BOOTSTRAP_PROVIDER_DISPLAY_NAME: 'Azure AI Foundry',
      BOOTSTRAP_PROVIDER_TYPE: 'azure-ai-foundry',
      BOOTSTRAP_PROVIDER_CONFIG: JSON.stringify({
        type: 'azure-ai-foundry',
        endpoint: 'https://awf-aif-20900.openai.azure.com',
        deploymentName: 'gpt-5.2',
        apiVersion: '2024-10-21',
      }),
      BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
        chat: 'gpt-5.2',
        codemode: 'gpt-5.2',
        embedding: 'text-embedding-3-large',
        embeddingDimension: 3072,
      }),
    });
    expect(r).not.toBeNull();
    expect(r!.providerType).toBe('azure-ai-foundry');
    expect((r!.authConfig as any).deploymentName).toBe('gpt-5.2');
    expect(r!.defaults.embeddingDimension).toBe(3072);
  });

  it('parses an AWS Bedrock bootstrap block with operator IAM keys', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'bedrock-ops',
      BOOTSTRAP_PROVIDER_TYPE: 'aws-bedrock',
      BOOTSTRAP_PROVIDER_CONFIG: JSON.stringify({
        type: 'aws-bedrock',
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret_test',
        region: 'us-east-1',
      }),
      BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
        chat: 'us.anthropic.claude-sonnet-4-6',
        codemode: 'us.anthropic.claude-sonnet-4-6',
        embedding: 'amazon.titan-embed-text-v2:0',
        embeddingDimension: 1024,
      }),
    });
    expect(r).not.toBeNull();
    expect((r!.authConfig as any).accessKeyId).toBe('AKIA_TEST');
    expect((r!.authConfig as any).region).toBe('us-east-1');
    expect(r!.defaults.chat).toBe('us.anthropic.claude-sonnet-4-6');
  });

  it('defaults displayName to name when DISPLAY_NAME is blank', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
    });
    expect(r!.displayName).toBe('ollama-hal');
  });

  it('returns empty authConfig when CONFIG is unset', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
    });
    expect(r!.authConfig).toEqual({});
  });

  it('returns all-null defaults when DEFAULTS is unset', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
    });
    expect(r!.defaults).toEqual({
      chat: null,
      codemode: null,
      vision: null,
      imageGen: null,
      embedding: null,
      embeddingDimension: null,
    });
  });

  it('coerces string embeddingDimension to number', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
      BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
        chat: 'gpt-oss:20b',
        codemode: 'gpt-oss:20b',
        embedding: 'nomic-embed-text',
        embeddingDimension: '768',
      }),
    });
    expect(r!.defaults.embeddingDimension).toBe(768);
  });

  it('throws on malformed CONFIG JSON', () => {
    expect(() =>
      parseBootstrapProviderEnv({
        BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
        BOOTSTRAP_PROVIDER_TYPE: 'ollama',
        BOOTSTRAP_PROVIDER_CONFIG: '{bogus',
      }),
    ).toThrow(/BOOTSTRAP_PROVIDER parse error: BOOTSTRAP_PROVIDER_CONFIG/);
  });

  it('returns null authConfig for non-object JSON (e.g. a bare string)', () => {
    const r = parseBootstrapProviderEnv({
      BOOTSTRAP_PROVIDER_NAME: 'ollama-hal',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
      BOOTSTRAP_PROVIDER_CONFIG: '"not-an-object"',
    });
    // Non-object JSON becomes empty authConfig — seeder will then attempt
    // the provider with no creds and the provider itself will fail test-probe.
    expect(r!.authConfig).toEqual({});
  });
});
