/**
 * Tests for SlackIntegrationService.
 *
 * Strategy: TDD with characterization tests for existing correct behavior +
 * RED→GREEN bug-fix rounds for any defects we surface.
 *
 * Mocking strategy follows the repo pattern (see ChatService.title-model.db-sot.test.ts):
 *   - prisma is a vi.mock'd singleton — methods stubbed per test
 *   - logger is a noop
 *   - no real network or DB
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock prisma — service imports it at module load
vi.mock('../utils/prisma.js', () => ({
  prisma: {
    integration: {
      findUnique: vi.fn(),
    },
    integrationLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    workflow: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock logger to keep test output clean
vi.mock('../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

import { SlackIntegrationService } from './SlackIntegrationService.js';

function makeValidSignature(signingSecret: string, body: string, timestamp: string): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');
}

describe('SlackIntegrationService.verifySignature', () => {
  const svc = new SlackIntegrationService();
  const signingSecret = 'test-signing-secret-do-not-use-in-prod';
  const body = '{"type":"event_callback","event":{"type":"message"}}';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for a valid HMAC signature with a recent timestamp', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const validSig = makeValidSignature(signingSecret, body, timestamp);

    const result = svc.verifySignature(signingSecret, timestamp, body, validSig);

    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S1-14 — Regression: no hardcoded workflow names in source
// ---------------------------------------------------------------------------

describe('S1-14 — Slack workflow routing: no hardcoded workflow names', () => {
  it('SlackIntegrationService.ts contains ZERO specific workflow-name string literals', () => {
    const src = readFileSync(
      path.join(__dirname, 'SlackIntegrationService.ts'),
      'utf-8',
    );

    const forbidden = [
      'Cost Optimization Advisor',
      'Multi-Cloud Cost Comparison',
      'AWS Cost & Security Audit',
      'Deployment Pipeline',
      'DevOps Deploy Pipeline',
      'P1 Incident Response',
      'Incident Response Automator',
      'Security Audit Agent',
      'Security Compliance Scanner',
      'K8s Cluster Ops & Incident Response',
      'K8s Cluster Ops',
      'Log Analysis & Alerting',
      'Data Pipeline Monitor',
      'Infrastructure Drift Detector',
      'Compliance Audit Agent',
      'Daily AI News Digest',
      'Deep Research Agent',
      'Code Review Agent',
      'Automated PR Review Pipeline',
      'Azure Infrastructure Health Check',
      'Threat Intelligence Aggregator',
      'Bug Triage & Reproduction',
      'Tier-1 Support Deflection',
      'User Onboarding Workflow',
    ];

    for (const name of forbidden) {
      expect(src, `Found forbidden workflow name literal: "${name}"`).not.toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// S1-14 — matchWorkflowByMessage unit tests
// ---------------------------------------------------------------------------

describe('S1-14 — matchWorkflowByMessage', () => {
  const svc = new SlackIntegrationService();

  // Access the private method via cast
  const match = (
    workflows: Array<{ id: string; name: string; description: string | null }>,
    msg: string,
  ) => (svc as any).matchWorkflowByMessage(workflows, msg);

  const workflows = [
    { id: 'wf-1', name: 'Cost Audit', description: 'Analyses AWS and cloud spending costs for optimization' },
    { id: 'wf-2', name: 'Cluster Ops', description: 'Kubernetes pod management and incident response' },
    { id: 'wf-3', name: 'News Digest', description: 'Daily AI news summary and digest' },
    { id: 'wf-4', name: 'Code Review', description: 'Automated pull request review and code quality checks' },
    { id: 'wf-5', name: 'Security Scanner', description: 'Infrastructure security and compliance audit' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC1: message matching a workflow by name/description token overlap
  it('AC1: message mentioning cost returns the cost workflow', () => {
    const result = match(workflows, 'show me my aws costs');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-1');
  });

  it('AC1: message mentioning kubernetes returns cluster ops workflow', () => {
    const result = match(workflows, 'check my kubernetes pods');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-2');
  });

  it('AC1: message mentioning news digest returns news workflow', () => {
    const result = match(workflows, 'give me the daily news digest');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-3');
  });

  it('AC1: message mentioning code review returns review workflow', () => {
    const result = match(workflows, 'please do a code review on my PR');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-4');
  });

  // AC2: no match → returns null (triggers chat fallback)
  it('AC2: completely unrelated message returns null', () => {
    const result = match(workflows, 'what is the weather today');
    expect(result).toBeNull();
  });

  it('AC2: empty message returns null', () => {
    const result = match(workflows, '');
    expect(result).toBeNull();
  });

  // AC3: mention syntax stripped before matching (verified at the directLLMResponse level,
  // but matchWorkflowByMessage also handles raw input gracefully)
  it('AC3: message with stripped mention still matches correctly', () => {
    // The caller strips <@U123> before calling matchWorkflowByMessage, test that
    const cleaned = 'run a security audit please'.replace(/<@[A-Z0-9]+>/g, '').trim();
    const result = match(workflows, cleaned);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-5');
  });

  // AC7: keywordMap constant must be gone from source
  it('AC7: keywordMap constant is absent from source', () => {
    const src = readFileSync(
      path.join(__dirname, 'SlackIntegrationService.ts'),
      'utf-8',
    );
    expect(src).not.toContain('keywordMap');
  });

  // Score threshold: very short single-word unrelated message scores below threshold
  it('single unrelated word returns null (below threshold)', () => {
    const result = match(workflows, 'hello');
    expect(result).toBeNull();
  });

  // Highest score wins: message that overlaps both cost and security should pick cost
  // (cost name is shorter but "costs" appears in both message and description)
  it('returns highest-scoring workflow when multiple overlap', () => {
    const result = match(workflows, 'show aws costs and check spending');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-1');
  });
});
