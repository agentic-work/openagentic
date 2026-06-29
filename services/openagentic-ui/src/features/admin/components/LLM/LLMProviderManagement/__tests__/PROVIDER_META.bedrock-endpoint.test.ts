/**
 * PROVIDER_META — Bedrock endpoint URL field contract.
 *
 * Customer requirement (2026-05-16): some deployments host Bedrock behind a
 * VPC endpoint / AWS PrivateLink / FIPS endpoint / proxy. The admin
 * Add-Provider wizard must let the operator override AWS's default endpoint
 * URL when adding a Bedrock provider.
 *
 * API-side support already exists at AWSBedrockProvider.ts:363-365 +
 * :580-581 — both BedrockRuntimeClient + BedrockClient constructions
 * apply `config.endpoint` when present. This test pins the UI contract.
 */
import { describe, it, expect } from 'vitest';
import { PROVIDER_META } from '../types';

describe('PROVIDER_META["aws-bedrock"].providerConfigFields', () => {
  const bedrock = PROVIDER_META['aws-bedrock'];

  it('exposes an optional `endpoint` field for custom hostname / VPC / PrivateLink', () => {
    const endpointField = bedrock.providerConfigFields.find((f) => f.key === 'endpoint');
    expect(endpointField, 'aws-bedrock.providerConfigFields must include an `endpoint` entry').toBeDefined();
    expect(endpointField!.type).toBe('text');
    // Must be optional — public AWS endpoint is the default
    expect(endpointField!.required).not.toBe(true);
  });

  it('endpoint field placeholder hints at the override use cases', () => {
    const endpointField = bedrock.providerConfigFields.find((f) => f.key === 'endpoint');
    expect(endpointField).toBeDefined();
    expect(endpointField!.placeholder).toMatch(/vpc|private|fips|http/i);
  });

  it('endpoint field help text mentions the privacy/compliance use cases', () => {
    const endpointField = bedrock.providerConfigFields.find((f) => f.key === 'endpoint');
    expect(endpointField).toBeDefined();
    expect(endpointField!.help).toMatch(/vpc|private|fips|proxy|default/i);
  });
});
