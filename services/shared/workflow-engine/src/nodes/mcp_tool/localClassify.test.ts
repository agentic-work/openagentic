/**
 * Local fail-safe classifier for the mcp_tool executor (2026-06-20). Used ONLY
 * when the wired approval-gate hook errors — biased toward MUTATING (fail
 * closed). The AUTHORITATIVE classifier lives in the api (runAuditAndGate).
 */

import { describe, it, expect } from 'vitest';
import { looksMutating } from './localClassify.js';

describe('looksMutating (fail-safe heuristic)', () => {
  it('treats clear destructive verbs as mutating', () => {
    expect(looksMutating('kubernetes_delete_pod', 'openagentic_kubernetes')).toBe(true);
    expect(looksMutating('aws_ec2_terminate_instances', 'openagentic_aws')).toBe(true);
    expect(looksMutating('azure_vm_restart', 'openagentic_azure')).toBe(true);
    expect(looksMutating('github_create_issue', 'openagentic_github')).toBe(true);
  });

  it('treats clear reads as non-mutating (never over-blocks)', () => {
    expect(looksMutating('kubernetes_list_pods', 'openagentic_kubernetes')).toBe(false);
    expect(looksMutating('list_kvs', 'openagentic_azure')).toBe(false);
    expect(looksMutating('get_resource', 'openagentic_aws')).toBe(false);
    expect(looksMutating('web_search', 'openagentic_web')).toBe(false);
    expect(looksMutating('describe_instances', 'openagentic_aws')).toBe(false);
  });

  it('fails CLOSED on an unknown verb on an infra server', () => {
    // Unrecognized verb, but the server is cloud/infra-capable → block.
    expect(looksMutating('aws_frobnicate', 'openagentic_aws')).toBe(true);
    expect(looksMutating('kubernetes_wibble', 'openagentic_kubernetes')).toBe(true);
  });

  it('does not over-block unknown verbs on non-infra servers', () => {
    expect(looksMutating('weather_lookup', 'openagentic_web')).toBe(false);
  });

  it('returns false for empty/invalid input', () => {
    expect(looksMutating('', 'openagentic_aws')).toBe(false);
    // @ts-expect-error — exercising the runtime guard
    expect(looksMutating(undefined, 'openagentic_aws')).toBe(false);
  });
});
