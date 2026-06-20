import { describe, expect, it } from 'vitest';
import { evaluateRagIntent } from '../services/RagIntentGate.js';

/**
 * Asymmetric assertion set: false-positive (fire RAG when not needed) is
 * the cost we're paying TODAY on every chat. False-negative (skip RAG
 * when docs would have helped) is recoverable — user can re-ask with the
 * word "documentation" or a feature name. So the assertions skew toward
 * "MUST skip on tool/cloud/web actions" and "MUST fire on explicit
 * platform meta-questions".
 */
describe('RagIntentGate.evaluateRagIntent', () => {
  describe('SKIP — tool / cloud / web action signals', () => {
    it.each([
      'what are my Azure costs this month',
      'list all resource groups in my Azure subscription',
      'create a VM in eastus',
      'delete the test resource group uc2-test-rg',
      'show me the pods in the openagentic namespace',
      'how many AKS clusters do I have',
      'count the storage accounts across my subscriptions',
      'audit IAM role assignments',
      'spin up a small landing zone in AWS',
      'get the cost of the storage account',
      'fetch this URL: https://example.com/page',
      'search the web for AWS landing zone best practices',
      'google the latest CVE for log4j',
      'create a sankey chart of my Azure costs',
      'make me a dashboard for cluster health',
      'draw an architecture diagram of my workloads',
      'run the bash command: ls -la',
      'kubectl get pods -n openagentic',
      'helm upgrade the chart',
      'read the file /etc/hosts',
    ])('skips: %s', (msg) => {
      const d = evaluateRagIntent(msg);
      expect(d.shouldFetchRag).toBe(false);
    });
  });

  describe('FIRE — explicit doc-seek + platform meta-questions', () => {
    it.each([
      'where is the documentation for the smart router',
      'show me the docs on openagentic capabilities',
      'how do I configure an MCP server in openagentic',
      'tutorial for setting up code mode',
      'what is the smart router',
      'explain the prompt composer',
      'how does the capability gate work',
      'walk me through chat mode',
      'what does openagentic support for image generation',
      'reference guide for the artifact-creation agent',
      'what is the platform able to do',
      'how does this system route models',
      'tell me about the rag stage',
      'explain openagentic',
      'how to configure capability gate',
      'docs for code mode',
    ])('fires: %s', (msg) => {
      const d = evaluateRagIntent(msg);
      expect(d.shouldFetchRag).toBe(true);
    });
  });

  describe('edges', () => {
    it('empty/null/undefined → skip', () => {
      expect(evaluateRagIntent('').shouldFetchRag).toBe(false);
      expect(evaluateRagIntent(null).shouldFetchRag).toBe(false);
      expect(evaluateRagIntent(undefined).shouldFetchRag).toBe(false);
    });

    it('reason field is structured for log/debug', () => {
      const d = evaluateRagIntent('what is the smart router');
      expect(d.reason).toBe('internal-feature-name');
      expect(d.matched).toBeTruthy();
    });

    it('plain conversation → skip', () => {
      expect(evaluateRagIntent('hi').shouldFetchRag).toBe(false);
      expect(evaluateRagIntent('thanks!').shouldFetchRag).toBe(false);
    });
  });
});
