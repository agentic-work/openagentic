/**
 * Test A — classifyTool pure read/write classifier (no mocks).
 *
 * MUTATING when the tool name/verb implies a write/destructive op; otherwise
 * READ. Unknown → READ (do NOT over-gate). Table-driven, mirrors the style of
 * PermissionService.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { classifyTool, MUTATING_VERBS } from '../classifyTool.js';

describe('classifyTool — MUTATING', () => {
  const MUTATING: string[] = [
    'apply_manifest',
    'kubectl_delete_pod',
    'aws_ec2_terminate_instances',
    'azure_delete_resource_group',
    'gcp_compute_instances_stop',
    'write_file',
    'edit_file',
    'rm_path',
    'drop_table',
    'set_config',
    'update_record',
    'restart_deployment',
    'rollout_restart',
    'scale_deployment',
    'cordon_node',
    'drain_node',
    'create_bucket',
    'put_object',
    'patch_resource',
    'exec_into_pod',
  ];

  for (const name of MUTATING) {
    it(`classifies "${name}" as MUTATING`, () => {
      expect(classifyTool(name)).toBe('MUTATING');
    });
  }
});

describe('classifyTool — READ', () => {
  const READ: string[] = [
    'list_pods',
    'get_resource',
    'describe_instances',
    'read_file',
    'search_logs',
    'tool_search',
    'request_clarification',
    'query_db',
    'count_rows',
    'status_check',
    'kubectl_get_pods',
  ];

  for (const name of READ) {
    it(`classifies "${name}" as READ`, () => {
      expect(classifyTool(name)).toBe('READ');
    });
  }
});

describe('classifyTool — unknown → READ (no over-gating)', () => {
  it('unknown verb → READ', () => {
    expect(classifyTool('frobnicate_widget')).toBe('READ');
  });
  it('empty string → READ', () => {
    expect(classifyTool('')).toBe('READ');
  });
  it('undefined → READ', () => {
    expect(classifyTool(undefined as any)).toBe('READ');
  });
});

describe('MUTATING_VERBS const', () => {
  it('is exported and non-empty', () => {
    expect(Array.isArray(MUTATING_VERBS)).toBe(true);
    expect(MUTATING_VERBS.length).toBeGreaterThan(0);
  });
  it('contains "delete"', () => {
    expect(MUTATING_VERBS).toContain('delete');
  });
});
