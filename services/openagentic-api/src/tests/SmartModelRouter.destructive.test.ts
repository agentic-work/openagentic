import { describe, test, expect } from 'vitest';
import { detectDestructiveIntent } from '../services/SmartModelRouter.js';

describe('SmartModelRouter — destructive-verb detection (BLOCKER-001)', () => {
  describe('positive matches (should escalate)', () => {
    test.each([
      ['Delete the Azure resource group test-rg-1', 'delete', 'resource group'],
      ['delete resource group foo', 'delete', 'resource group'],
      ['Please remove the storage account prod-sa', 'remove', 'storage account'],
      ['Terminate the EC2 instance i-0abc', 'terminate', 'instance'],
      ['drop the database myapp_prod', 'drop', 'database'],
      // "aks" comes before "cluster" in the word order — regex returns first hit.
      ['destroy the AKS cluster for staging', 'destroy', 'aks'],
      ['Purge all secrets in vault prod-kv', 'purge', 'secret'],
      ['nuke the namespace prod', 'nuke', 'namespace'],
      ['shutdown the vm vm-api-01', 'shutdown', 'vm'],
      ['deallocate the virtual machine', 'deallocate', 'virtual machine'],
      ['kill the pod api-5f7', 'kill', 'pod'],
      ['wipe the blob storage', 'wipe', 'blob'],
      ['tear down the load balancer', 'tear down', 'load balancer'],
      ['truncate the table user_events', 'truncate', 'table'],
      ['remove the IAM role admin-legacy', 'remove', 'iam'],
      ['delete the key vault', 'delete', 'key vault'],
      ['delete subscription 00000000', 'delete', 'subscription'],
      // Note: regex matches the FIRST cloud noun it sees, so "lambda" wins
      // over "function" here — either is a valid escalation signal.
      ['destroys the lambda function', 'destroys', 'lambda'],
    ])('matches "%s"', (prompt, expectedVerb, expectedNoun) => {
      const hit = detectDestructiveIntent(prompt);
      expect(hit).not.toBeNull();
      expect(hit?.verb).toBe(expectedVerb);
      expect(hit?.noun.toLowerCase()).toContain(expectedNoun.toLowerCase());
    });

    test('case-insensitive verb + noun', () => {
      const hit = detectDestructiveIntent('DELETE THE RESOURCE GROUP foo');
      expect(hit).not.toBeNull();
      expect(hit?.verb).toBe('delete');
    });

    test('detects mid-sentence verb + noun', () => {
      const hit = detectDestructiveIntent("I'd like you to go ahead and delete the vm named foo-01 if it's OK");
      expect(hit).not.toBeNull();
    });
  });

  describe('negative matches (should NOT escalate)', () => {
    test.each([
      // Destructive verb but no cloud-resource noun
      'delete my report file',
      'terminate the meeting',
      'drop the conversation',
      // Cloud-resource noun but no destructive verb (read-only)
      'list all resource groups',
      'describe the virtual machine',
      'show me the database',
      'what pods are running',
      'count the subscriptions',
      // Neither
      'hello, how are you',
      'what is the weather',
      '',
      // Soft verbs we intentionally exclude
      'disable the vm',
      'pause the cluster',
      'stop the job', // "stop" alone excluded — too many false positives in English
    ])('does NOT match "%s"', (prompt) => {
      expect(detectDestructiveIntent(prompt)).toBeNull();
    });

    test('returns null for null / undefined / non-string', () => {
      expect(detectDestructiveIntent('')).toBeNull();
      // @ts-expect-error — runtime robustness for bad inputs
      expect(detectDestructiveIntent(null)).toBeNull();
      // @ts-expect-error — runtime robustness
      expect(detectDestructiveIntent(undefined)).toBeNull();
      // @ts-expect-error — runtime robustness
      expect(detectDestructiveIntent(123)).toBeNull();
    });
  });

  describe('multi-word nouns', () => {
    test('"resource group" matches as a phrase', () => {
      expect(detectDestructiveIntent('delete the resource group')?.noun).toBe('resource group');
    });

    test('"virtual machine" matches as a phrase', () => {
      expect(detectDestructiveIntent('remove the virtual machine')?.noun).toBe('virtual machine');
    });

    test('"service account" matches as a phrase', () => {
      expect(detectDestructiveIntent('destroy the service account prod-sa')?.noun).toBe('service account');
    });
  });
});
