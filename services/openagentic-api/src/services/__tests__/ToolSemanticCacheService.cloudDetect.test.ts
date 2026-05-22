/**
 * Q1-fix-2 — cloud-detection unit tests.
 *
 * The bug: tool_search returned azure-biased results on multi-cloud user
 * prompts because the model emitted a single-cloud query like
 * "Azure cost query tool", and detectCloudProviders only sees that one
 * cloud. Live capture 2026-05-12 (probe #1, gpt-oss:20b):
 *   user prompt: "Find the top 10 cost spikes across Azure/AWS/GCP …"
 *   model's tool_search query: "Azure cost query tool"
 *   detectedClouds: ['azure']  ← only azure
 *   top 6 after boost: 4× azure_*, 0× aws_*, 0× gcp_*
 *
 * The fix exposes `detectCloudProvidersInText(text)` as a pure helper so
 * callers can union cloud-detection across the model's query AND the most
 * recent user-turn text. When user prompt mentions ≥2 clouds, the multi
 * -cloud diversity path fires even if the model's query is single-cloud.
 *
 * Spec: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 */
import { describe, it, expect } from 'vitest';
import { detectCloudProvidersInText } from '../ToolSemanticCacheService.js';

describe('detectCloudProvidersInText — pure cloud-term detector', () => {
  it('detects single cloud (azure-only)', () => {
    const clouds = detectCloudProvidersInText('Azure cost query tool');
    expect(Array.from(clouds.keys()).sort()).toEqual(['azure']);
  });

  it('detects single cloud (aws-only via keyword)', () => {
    const clouds = detectCloudProvidersInText('list my s3 buckets and lambda functions');
    expect(Array.from(clouds.keys()).sort()).toEqual(['aws']);
  });

  it('detects all three clouds in a tri-cloud prompt', () => {
    const text =
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.';
    const clouds = detectCloudProvidersInText(text);
    const names = Array.from(clouds.keys()).sort();
    expect(names).toContain('azure');
    expect(names).toContain('aws');
    expect(names).toContain('gcp');
  });

  it('detects gcp via "google cloud" phrasing', () => {
    const clouds = detectCloudProvidersInText('show me my google cloud cost');
    expect(Array.from(clouds.keys())).toContain('gcp');
  });

  it('detects no clouds for unrelated k8s-only prompt', () => {
    const clouds = detectCloudProvidersInText('list pods in agentic-dev namespace');
    // kubectl term counts under the "kubernetes" bucket but not aws/azure/gcp
    const names = Array.from(clouds.keys());
    expect(names).not.toContain('aws');
    expect(names).not.toContain('azure');
    expect(names).not.toContain('gcp');
  });

  it('accepts undefined / empty text safely', () => {
    expect(detectCloudProvidersInText('').size).toBe(0);
    expect(detectCloudProvidersInText(undefined as any).size).toBe(0);
    expect(detectCloudProvidersInText(null as any).size).toBe(0);
  });
});

describe('detectCloudProvidersInText — union semantics for tri-cloud capstone', () => {
  it('user prompt + model query union — model picked azure-only but user said tri-cloud', () => {
    // The exact failure case from Q1 capstone driver report.
    const modelQuery = 'Azure cost query tool';
    const userText =
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP …';

    const fromQueryOnly = detectCloudProvidersInText(modelQuery);
    const fromUserOnly = detectCloudProvidersInText(userText);
    const fromUnion = detectCloudProvidersInText(`${modelQuery}\n${userText}`);

    // The bug: query-only detection sees one cloud.
    expect(fromQueryOnly.size).toBe(1);

    // The cure: user-text alone sees three; concatenation also sees three.
    expect(fromUserOnly.size).toBeGreaterThanOrEqual(3);
    expect(fromUnion.size).toBeGreaterThanOrEqual(3);
  });
});
