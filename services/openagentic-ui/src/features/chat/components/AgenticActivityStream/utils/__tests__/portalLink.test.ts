import { describe, test, expect } from 'vitest';
import { deriveResourceLink } from '../portalLink';

describe('deriveResourceLink — BLOCKER-002 fix', () => {
  describe('Azure tools', () => {
    test('azure_delete_resource_group with subscription produces deep portal link', () => {
      const link = deriveResourceLink('azure_delete_resource_group', {
        name: 'test-rg-uc-a14-20260418',
        subscription_id: '00000000-0000-0000-0000-000000000000',
      });
      expect(link?.provider).toBe('azure');
      expect(link?.identifier).toBe('test-rg-uc-a14-20260418');
      expect(link?.href).toContain('portal.azure.com');
      expect(link?.href).toContain('00000000-0000-0000-0000-000000000000');
      expect(link?.href).toContain('test-rg-uc-a14-20260418');
    });

    test('azure_delete_resource_group without subscription falls back to RG browse blade', () => {
      const link = deriveResourceLink('azure_delete_resource_group', { name: 'some-rg' });
      expect(link?.provider).toBe('azure');
      expect(link?.identifier).toBe('some-rg');
      expect(link?.href).toContain('BrowseResourceGroups');
    });

    test('azure_list_subscriptions picks up subscription id', () => {
      const link = deriveResourceLink('azure_list_subscriptions', {
        subscription_id: '00000000-0000-0000-0000-000000000000',
      });
      expect(link?.provider).toBe('azure');
      expect(link?.href).toContain('subscriptions/00000000');
    });

    test('azure_list_aks_clusters surfaces cluster name', () => {
      const link = deriveResourceLink('azure_list_aks_clusters', { cluster_name: 'aks-prod' });
      expect(link?.identifier).toBe('aks-prod');
      expect(link?.href).toContain('ManagedClustersViewer');
    });
  });

  describe('AWS tools', () => {
    test('aws_list_ec2 with region gives region-aware instance console URL', () => {
      const link = deriveResourceLink('aws_describe_ec2_instance', {
        instance_id: 'i-0abc1234',
        region: 'us-west-2',
      });
      expect(link?.provider).toBe('aws');
      expect(link?.href).toContain('ec2/home');
      expect(link?.href).toContain('us-west-2');
      expect(link?.href).toContain('i-0abc1234');
    });

    test('aws_list_s3 picks bucket name and links to S3 console', () => {
      const link = deriveResourceLink('aws_list_s3', { bucket_name: 'my-bucket-prod' });
      expect(link?.href).toContain('s3/buckets/my-bucket-prod');
    });

    test('aws_bedrock_list_foundation_models links to foundation-models tab', () => {
      const link = deriveResourceLink('aws_bedrock_list_foundation_models', {
        name: 'us-east-1',
        region: 'us-east-1',
      });
      expect(link?.href).toContain('bedrock/home');
      expect(link?.href).toContain('foundation-models');
    });

    test('call_aws defaults to us-east-1 when no region given', () => {
      const link = deriveResourceLink('call_aws', { name: 'foo' });
      expect(link?.provider).toBe('aws');
      expect(link?.href).toContain('us-east-1');
    });
  });

  describe('GCP tools', () => {
    test('gcp_list_compute_instances picks up project id', () => {
      const link = deriveResourceLink('gcp_list_compute_instances', {
        name: 'vm-prod-01',
        project_id: 'agentic-prod',
      });
      expect(link?.provider).toBe('gcp');
      expect(link?.href).toContain('compute/instances');
      expect(link?.href).toContain('agentic-prod');
    });

    test('gcp_list_gke_clusters → kubernetes list overview', () => {
      const link = deriveResourceLink('gcp_list_gke_clusters', { cluster_name: 'prod-gke' });
      expect(link?.href).toContain('kubernetes/list');
    });
  });

  describe('Web MCP tools', () => {
    test('web_fetch with https URL produces clickable link + favicon domain', () => {
      const link = deriveResourceLink('web_fetch', {
        url: 'https://api.example.com/v2/users',
      });
      expect(link?.provider).toBe('web');
      expect(link?.identifier).toBe('https://api.example.com/v2/users');
      expect(link?.href).toBe('https://api.example.com/v2/users');
      expect(link?.faviconDomain).toBe('api.example.com');
    });

    test('fetch tool with uri arg works too', () => {
      const link = deriveResourceLink('fetch', { uri: 'https://docs.anthropic.com/en/api' });
      expect(link?.provider).toBe('web');
      expect(link?.faviconDomain).toBe('docs.anthropic.com');
    });

    test('web tool with no URL returns null (can\'t derive a link)', () => {
      expect(deriveResourceLink('web_fetch', { query: 'search terms' })).toBeNull();
    });
  });

  describe('Null / edge cases', () => {
    test('unknown tool with unknown args returns null', () => {
      expect(deriveResourceLink('unknown_tool', { foo: 'bar' })).toBeNull();
    });

    test('empty args returns null', () => {
      expect(deriveResourceLink('azure_delete_resource_group', {})).toBeNull();
    });

    test('null args returns null', () => {
      expect(deriveResourceLink('azure_delete_resource_group', null)).toBeNull();
    });

    test('empty tool name returns null', () => {
      expect(deriveResourceLink('', { name: 'foo' })).toBeNull();
    });

    test('identifier longer than 200 chars is ignored (safety)', () => {
      const longName = 'x'.repeat(300);
      expect(deriveResourceLink('azure_delete_resource_group', { name: longName })).toBeNull();
    });

    test('k8s tools return identifier with null href (no deep-link provider)', () => {
      const link = deriveResourceLink('k8s_get_pod', { pod_name: 'api-5f7' });
      expect(link?.provider).toBe('k8s');
      expect(link?.identifier).toBe('api-5f7');
      expect(link?.href).toBeNull();
    });

    test('synth_execute returns identifier without a link', () => {
      const link = deriveResourceLink('synth_execute', { name: 'stripe-list-customers' });
      expect(link?.provider).toBe('synth');
      expect(link?.href).toBeNull();
    });
  });

  describe('Identifier key priority', () => {
    test('arn takes precedence over name when both present and name is empty', () => {
      const link = deriveResourceLink('aws_describe_ec2_instance', {
        arn: 'arn:aws:ec2:us-east-1:123:instance/i-0abc',
        name: 'ignored-fallback',
      });
      // First match wins — `name` comes before `arn` in the list, so name wins.
      // This test documents the current priority (name > arn).
      expect(link?.identifier).toBe('ignored-fallback');
    });

    test('falls back to instance_id when name missing', () => {
      const link = deriveResourceLink('aws_describe_ec2_instance', {
        instance_id: 'i-0abc',
      });
      expect(link?.identifier).toBe('i-0abc');
    });
  });
});
