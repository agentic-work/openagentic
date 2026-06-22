/**
 * Mirrors Claude Code's tool-name resolution at `~/anthropic/src/Tool.ts:358`
 * (`findToolByName(tools, name)` — checks primary name + aliases) plus
 * `~/anthropic/src/services/mcp/normalization.ts:normalizeNameForMCP`
 * (replaces invalid characters with `_`).
 *
 * Anchors a model-emitted tool name (e.g. `aws.run`, hallucinated by
 * gpt-oss:20b on Ollama in live test 2026-04-30) to a registered MCP
 * tool name OR returns a structured "did you mean" error so the model
 * can retry with a real name.
 *
 * NO regex pattern matching for fuzzy intent. Only character-class
 * normalization (mirrors Claude Code's `[^a-zA-Z0-9_-]` → `_` rule)
 * + direct/case-insensitive lookup + prefix-matched suggestion list.
 */

import { describe, it, expect } from 'vitest';
import { resolveMcpToolName } from '../mcpToolNameResolver.js';

const REGISTERED = [
  'aws_iam_list_users',
  'aws_iam_list_groups',
  'aws_list_subscriptions',
  'azure_list_resource_groups',
  'azure_list_subscriptions',
  'gcp_list_projects',
  'k8s_list_pods',
  'k8s_list_namespaces',
];

describe('resolveMcpToolName (Claude Code pattern mirror)', () => {
  describe('direct match (findToolByName equivalent)', () => {
    it('returns the canonical name when the model emits an exact match', () => {
      const r = resolveMcpToolName('aws_iam_list_users', REGISTERED);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('aws_iam_list_users');
    });
  });

  describe('character-class normalization (normalizeNameForMCP equivalent)', () => {
    it('replaces dots with underscores', () => {
      const r = resolveMcpToolName('aws_iam_list_users'.replace(/_/g, '.'), REGISTERED);
      // 'aws.iam.list.users' → 'aws_iam_list_users' → match
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('aws_iam_list_users');
    });

    it('replaces colons with underscores', () => {
      const r = resolveMcpToolName('k8s:list:pods', REGISTERED);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('k8s_list_pods');
    });

    it('replaces spaces with underscores', () => {
      const r = resolveMcpToolName('gcp list projects', REGISTERED);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('gcp_list_projects');
    });

    it('keeps hyphens (Claude Code allows them in [a-zA-Z0-9_-])', () => {
      const r = resolveMcpToolName('aws-iam-list-users', ['aws-iam-list-users']);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('aws-iam-list-users');
    });
  });

  describe('case-insensitive fallback', () => {
    it('snaps wrong-case input to the canonical case', () => {
      const r = resolveMcpToolName('AWS_IAM_LIST_USERS', REGISTERED);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('aws_iam_list_users');
    });

    it('combines normalization + case-insensitive', () => {
      const r = resolveMcpToolName('AWS.IAM.List.Users', REGISTERED);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('aws_iam_list_users');
    });
  });

  describe('hallucinated names — structured "did you mean" error', () => {
    it('returns ok:false with prefix-matched suggestions for the gpt-oss aws.run hallucination', () => {
      const r = resolveMcpToolName('aws.run', REGISTERED);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain('aws.run');
        expect(r.error).toContain('not found');
        // Suggestions should include all aws_* tools
        expect(r.error).toContain('aws_iam_list_users');
        expect(r.error).toContain('aws_iam_list_groups');
        expect(r.error).toContain('aws_list_subscriptions');
      }
    });

    it('returns suggestions matching the prefix when no exact match exists', () => {
      const r = resolveMcpToolName('azure_describe_thing', REGISTERED);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain('azure_list_resource_groups');
        expect(r.error).toContain('azure_list_subscriptions');
        // Should NOT leak unrelated tools
        expect(r.error).not.toContain('aws_');
        expect(r.error).not.toContain('k8s_');
      }
    });

    it('returns the no-match error without suggestions when prefix is unfamiliar', () => {
      const r = resolveMcpToolName('xyzzy_do_thing', REGISTERED);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain('xyzzy_do_thing');
        expect(r.error).toContain('not found');
      }
    });

    it('does NOT silently map a hallucination to a similar real tool', () => {
      // Bug guard from existing `normalizeToolName` doc:
      // "We never silently map a hallucination to a different tool — that's
      //  worse than failing loud."
      const r = resolveMcpToolName('aws_run_thing', REGISTERED);
      expect(r.ok).toBe(false);
      // Must not silently return one of the aws_* tools as the canonical name
      if (r.ok) throw new Error('hallucination silently mapped — should fail loud');
    });
  });

  describe('edge cases', () => {
    it('handles empty registered list (no proxy tools available)', () => {
      const r = resolveMcpToolName('aws_iam_list_users', []);
      // Without a registered list to validate against, fall through with the
      // input as-is so the proxy can still attempt resolution.
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('aws_iam_list_users');
    });

    it('rejects empty/null input', () => {
      const r1 = resolveMcpToolName('', REGISTERED);
      expect(r1.ok).toBe(false);
      const r2 = resolveMcpToolName('   ', REGISTERED);
      expect(r2.ok).toBe(false);
    });

    it('handles aliases when declared (Claude Code Tool.ts:348 toolMatchesName)', () => {
      // Some tools may declare aliases via the proxy's metadata
      // (mirroring Tool.ts: `aliases?: string[]`). The resolver must
      // accept either the primary name or any alias.
      const tools = [
        { name: 'aws_iam_list_users', aliases: ['aws_users', 'AwsListIamUsers'] },
        { name: 'k8s_list_pods', aliases: ['kubectl_get_pods'] },
      ];
      const r = resolveMcpToolName('kubectl_get_pods', tools);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonicalName).toBe('k8s_list_pods');
    });
  });
});
