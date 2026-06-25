/**
 * Test A — classifyTool pure read/write classifier (no mocks).
 *
 * MUTATING when the tool name/verb implies a write/destructive op; otherwise
 * READ. FAIL-CLOSED for infra: an unrecognized verb on a cloud/infra server
 * (aws/azure/gcp/kubernetes/github) → MUTATING; non-infra unknown → READ (no
 * over-gating). Table-driven, mirrors the style of PermissionService.test.ts.
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

describe('classifyTool — fail-closed gate (regression: verified bypasses)', () => {
  // These ALL silently auto-approved before the fail-closed fix — the verb-name
  // guesser classified them READ because the verb wasn't in the list. A security
  // gate MUST require a human for these.
  const MUST_GATE: string[] = [
    'aws_bedrock_invoke_model',
    'aws_bedrock_invoke_agent',
    'aws_ssm_send_command',       // = run shell on every targeted host
    'aws_sts_assume_role',        // = privilege escalation
    'aws_s3_sync',
    'aws_kms_rotate_key',
    'aws_kms_sign',
    'azure_vm_run_command',
    'gcp_compute_reset_instance',
    'aws_ec2_monitor_instances',
  ];
  for (const name of MUST_GATE) {
    it(`gates "${name}" (MUTATING)`, () => {
      expect(classifyTool(name)).toBe('MUTATING');
    });
  }

  // Fail-closed must NOT over-gate genuine infra reads (they carry a read verb,
  // so they stay auto-approved — no approval hang).
  const STILL_READ: string[] = [
    'aws_s3_list_buckets',
    'aws_ec2_describe_instances',
    'azure_list_resource_groups',
    'gcp_logging_entries_list',
    'admin_system_postgres_health_check',
    'prometheus_query',
    'loki_query_range',
  ];
  for (const name of STILL_READ) {
    it(`does not over-gate "${name}" (READ)`, () => {
      expect(classifyTool(name)).toBe('READ');
    });
  }

  it('unknown verb on an infra server fails CLOSED → MUTATING', () => {
    expect(classifyTool('aws_widget_frobnicate')).toBe('MUTATING');
  });
  it('unknown verb on a NON-infra tool stays READ (no over-gate)', () => {
    expect(classifyTool('frobnicate_widget')).toBe('READ');
  });
});

describe('classifyTool — gcp Cloud Run product-noun collision (regression)', () => {
  // The product noun "cloud_run" carries the token `run` (a mutating verb), so
  // the gcp Cloud Run READ tools were over-gated. A server prefix + leading read
  // verb (`gcp_get_*`, `gcp_list_*`) must auto-approve; the WRITE tools must
  // still gate (their 2nd token is NOT a read verb).
  const READ: string[] = [
    'gcp_get_cloud_run_service',
    'gcp_get_cloud_run_service_iam_policy',
    'gcp_get_cloud_run_job',
    'gcp_get_cloud_run_revision',
    'gcp_get_cloud_run_execution',
    'gcp_get_cloud_run_operation',
    'gcp_list_cloud_run_services',
    'gcp_list_cloud_run_jobs',
    'gcp_list_cloud_run_revisions',
    'gcp_list_cloud_run_executions',
    'gcp_list_cloud_run_locations',
    'gcp_list_cloud_run_operations',
  ];
  for (const name of READ) {
    it(`auto-approves "${name}" (READ)`, () => {
      expect(classifyTool(name)).toBe('READ');
    });
  }

  const MUTATING: string[] = [
    'gcp_run_cloud_run_job',          // verb `run`
    'gcp_delete_cloud_run_service',   // verb `delete`
    'gcp_delete_cloud_run_revision',
    'gcp_delete_cloud_run_job',
    'gcp_cancel_cloud_run_execution', // verb `cancel`
    'gcp_start_instance',
    'gcp_stop_instance',
    'gcp_api_execute',                // raw passthrough — fail-closed
  ];
  for (const name of MUTATING) {
    it(`still gates "${name}" (MUTATING)`, () => {
      expect(classifyTool(name)).toBe('MUTATING');
    });
  }
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
