/**
 * PromptClassifier — task-type classification + capability-profile lookup.
 *
 * Q1-fix-3 (2026-05-12). RED before SmartModelRouter wire-in, GREEN after.
 *
 * No model literals in this file. Tests assert on TASK TYPE + CAPABILITY
 * PROFILE shape. Model picking is the router's job and is exercised in
 * `SmartModelRouter.agenticRouting.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyTaskType,
  getCapabilityProfile,
  classifyAndProfile,
  type TaskType,
} from '../PromptClassifier.js';

describe('PromptClassifier — classifyTaskType', () => {
  describe('multi-cloud-agentic', () => {
    it('Q1 tri-cloud cost prompt classifies as cost-audit (more specific than multi-cloud-agentic)', () => {
      // 2026-05-17 — cost-audit refines multi-cloud-agentic when the prompt
      // is a multi-cloud finops audit (cost noun + cloudCount>=2 + analysis
      // shape). The cost-audit gate fires BEFORE the generic multi-cloud
      // gate so this lands at the T3 FCA-0.93 floor.
      const prompt =
        'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('cost-audit');
    });

    it('Azure + AWS pair triggers multi-cloud-agentic', () => {
      const prompt = 'Compare our Azure VM count with our AWS EC2 instances.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('multi-cloud-agentic');
    });

    it('AWS + GCP pair triggers multi-cloud-agentic', () => {
      const prompt = 'I want to migrate my AWS workload to GCP — what does it look like?';
      expect(classifyTaskType(prompt)).toBe<TaskType>('multi-cloud-agentic');
    });

    it('Azure + Google Cloud (long form) spend-reconcile triggers cost-audit (NOT generic multi-cloud)', () => {
      // 2026-05-17 — "reconcile spend" + 2 clouds matches cost-audit shape
      // (finops noun + analysis-shape verb + cloudCount>=2). Promotes to T3.
      const prompt = 'Reconcile spend between Azure and Google Cloud for last month.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('cost-audit');
    });

    it('three clouds all present is still multi-cloud-agentic (not pure-chat)', () => {
      const prompt = 'Audit Azure, AWS, and GCP for public S3-equivalent buckets.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('multi-cloud-agentic');
    });
  });

  describe('multi-system-agentic (cross-system fan-out)', () => {
    it('"across each cluster" triggers multi-system-agentic', () => {
      const prompt = 'Show me pod restart counts across each cluster.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('multi-system-agentic');
    });

    it('"all my subscriptions" triggers multi-system-agentic', () => {
      const prompt = 'Roll up resource counts for all my subscriptions.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('multi-system-agentic');
    });

    it('"for every account" triggers multi-system-agentic', () => {
      const prompt = 'Get the IAM policy summary for every account.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('multi-system-agentic');
    });
  });

  describe('cost-analysis-agentic', () => {
    it('"cost spike breakdown by service" triggers cost-analysis-agentic', () => {
      const prompt = 'Break down the cost spike by service for last month.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('cost-analysis-agentic');
    });

    it('"top 5 spend increase by resource" triggers cost-analysis-agentic', () => {
      const prompt = 'Top 5 spend increases by resource this week.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('cost-analysis-agentic');
    });

    it('bare "what is the cost of X" does NOT trigger (no analysis shape)', () => {
      const prompt = 'What is the cost of an m5.large?';
      expect(classifyTaskType(prompt)).not.toBe<TaskType>('cost-analysis-agentic');
    });
  });

  describe('security-audit-agentic', () => {
    it('"audit ... public buckets" triggers security-audit-agentic', () => {
      const prompt = 'Audit my buckets for any public exposed objects.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('security-audit-agentic');
    });

    it('"scan for compliance findings" triggers security-audit-agentic', () => {
      const prompt = 'Scan our infra for compliance findings.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('security-audit-agentic');
    });

    it('"review for over-privileged identities" triggers security-audit-agentic', () => {
      const prompt = 'Review my IAM for over-privileged identities.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('security-audit-agentic');
    });
  });

  describe('file-read', () => {
    it('"show me services/foo/bar.ts" triggers file-read', () => {
      const prompt = 'Show me services/openagentic-api/CLAUDE.md';
      expect(classifyTaskType(prompt)).toBe<TaskType>('file-read');
    });

    it('plain prose with no path is NOT file-read', () => {
      const prompt = 'Tell me about TypeScript generics.';
      expect(classifyTaskType(prompt)).not.toBe<TaskType>('file-read');
    });
  });

  describe('single-system-read', () => {
    it('"list my azure subscriptions" routes as single-system-read', () => {
      expect(classifyTaskType('list my azure subscriptions')).toBe<TaskType>('single-system-read');
    });

    it('"show me my aws ec2 instances" routes as single-system-read', () => {
      expect(classifyTaskType('show me my aws ec2 instances')).toBe<TaskType>(
        'single-system-read',
      );
    });

    it('two-cloud read is NOT single-system-read (it is multi-cloud)', () => {
      // Multi-cloud check fires first; the read shape doesn't override it.
      const prompt = 'list my azure and aws resources';
      expect(classifyTaskType(prompt)).toBe<TaskType>('multi-cloud-agentic');
    });
  });

  describe('pure-chat', () => {
    it('"what is 2+2" is pure-chat', () => {
      expect(classifyTaskType('what is 2+2')).toBe<TaskType>('pure-chat');
    });

    it('"write me a poem about dogs" is pure-chat', () => {
      expect(classifyTaskType('write me a poem about dogs')).toBe<TaskType>('pure-chat');
    });

    it('"hi" is pure-chat', () => {
      expect(classifyTaskType('hi')).toBe<TaskType>('pure-chat');
    });

    it('empty / undefined prompt is pure-chat (no crash)', () => {
      expect(classifyTaskType('')).toBe<TaskType>('pure-chat');
      expect(classifyTaskType(undefined as unknown as string)).toBe<TaskType>('pure-chat');
      expect(classifyTaskType(null as unknown as string)).toBe<TaskType>('pure-chat');
    });
  });
});

describe('PromptClassifier — getCapabilityProfile', () => {
  it('multi-cloud-agentic requires FCA >= 0.90 (gates gpt-oss out)', () => {
    const profile = getCapabilityProfile('multi-cloud-agentic');
    expect(profile.requiresToolUseReliability).toBeGreaterThanOrEqual(0.90);
    expect(profile.requiresReasoning).toBe('high');
    expect(profile.requiresContextTokens).toBeGreaterThanOrEqual(30_000);
  });

  it('cost-analysis-agentic requires FCA >= 0.90', () => {
    const profile = getCapabilityProfile('cost-analysis-agentic');
    expect(profile.requiresToolUseReliability).toBeGreaterThanOrEqual(0.90);
    expect(profile.requiresContextTokens).toBeGreaterThanOrEqual(30_000);
  });

  it('security-audit-agentic requires FCA >= 0.90', () => {
    const profile = getCapabilityProfile('security-audit-agentic');
    expect(profile.requiresToolUseReliability).toBeGreaterThanOrEqual(0.90);
  });

  it('multi-system-agentic requires FCA >= 0.90', () => {
    const profile = getCapabilityProfile('multi-system-agentic');
    expect(profile.requiresToolUseReliability).toBeGreaterThanOrEqual(0.90);
  });

  it('single-system-read allows cheap models (FCA <= 0.85)', () => {
    const profile = getCapabilityProfile('single-system-read');
    expect(profile.requiresToolUseReliability).toBeLessThanOrEqual(0.85);
  });

  it('file-read allows cheap models', () => {
    const profile = getCapabilityProfile('file-read');
    expect(profile.requiresToolUseReliability).toBeLessThanOrEqual(0.85);
  });

  it('pure-chat allows the cheapest pool (FCA <= 0.82)', () => {
    const profile = getCapabilityProfile('pure-chat');
    expect(profile.requiresToolUseReliability).toBeLessThanOrEqual(0.82);
    expect(profile.requiresReasoning).toBe('none');
  });
});

describe('PromptClassifier — classifyAndProfile (convenience)', () => {
  it('returns both taskType and profile in one call', () => {
    // 2026-05-17 — tri-cloud cost-spike prompt is now cost-audit (T3),
    // not generic multi-cloud-agentic (T2). Profile FCA floor 0.93+.
    const { taskType, profile } = classifyAndProfile(
      'Find top 10 cost spikes across Azure/AWS/GCP',
    );
    expect(taskType).toBe<TaskType>('cost-audit');
    expect(profile.taskType).toBe<TaskType>('cost-audit');
    expect(profile.requiresToolUseReliability).toBeGreaterThanOrEqual(0.93);
  });

  it('returns pure-chat profile for arithmetic', () => {
    const { taskType, profile } = classifyAndProfile('what is 2+2');
    expect(taskType).toBe<TaskType>('pure-chat');
    expect(profile.requiresReasoning).toBe('none');
  });
});

/**
 * Q1-fix-10 (2026-05-12) — cloud-service synonym expansion.
 *
 * Pre-fix: classifyTaskType only detected literal /\b(azure|aws|gcp|google
 * cloud)\b/. Q1 turn 2 "Show me the specific Bedrock model invocations
 * driving the Claude Sonnet 4.6 spike — break it down by day for the last
 * 30 days" did NOT mention 'aws' or 'azure' literally, so it fell through
 * to pure-chat → routed to gpt-oss:20b → never dispatched a tool.
 *
 * After fix: service-level synonyms map back to their cloud bucket.
 * "bedrock" alone → AWS-agentic. "aks + bedrock" → multi-cloud-agentic.
 */
describe('cloud-service synonym detection', () => {
  it('bedrock is AWS-agentic (not pure-chat)', () => {
    expect(classifyTaskType('show me bedrock model invocation logs')).toMatch(/agentic|system-read/);
  });

  it('Q1 turn 2 bedrock breakdown is agentic (not pure-chat)', () => {
    const prompt =
      'Show me the specific Bedrock model invocations driving the Claude Sonnet 4.6 spike — break it down by day for the last 30 days';
    expect(classifyTaskType(prompt)).toMatch(/agentic|system-read/);
  });

  it('ec2 alone is AWS-agentic', () => {
    expect(classifyTaskType('list my ec2 instances in us-east-1')).toMatch(/agentic|system-read/);
  });

  it('s3 alone is AWS-agentic', () => {
    expect(classifyTaskType('which s3 buckets have public access?')).toMatch(/agentic|system-read/);
  });

  it('lambda alone is AWS-agentic', () => {
    expect(classifyTaskType('show me lambda invocations from last hour')).toMatch(/agentic|system-read/);
  });

  it('aks alone is Azure-agentic', () => {
    expect(classifyTaskType('list pods in my aks cluster')).toMatch(/agentic|system-read/);
  });

  it('foundry alone is Azure-agentic', () => {
    expect(classifyTaskType('what foundry deployments do i have')).toMatch(/agentic|system-read/);
  });

  it('cosmosdb alone is Azure-agentic', () => {
    expect(classifyTaskType('show cosmosdb read units for last 24h')).toMatch(/agentic|system-read/);
  });

  it('gke alone is GCP-agentic', () => {
    expect(classifyTaskType('list gke nodes in production cluster')).toMatch(/agentic|system-read/);
  });

  it('vertex alone is GCP-agentic', () => {
    expect(classifyTaskType('list my vertex endpoints')).toMatch(/agentic|system-read/);
  });

  it('bigquery alone is GCP-agentic', () => {
    expect(classifyTaskType('show bigquery slot usage')).toMatch(/agentic|system-read/);
  });

  it('aks + bedrock = multi-cloud-agentic', () => {
    expect(classifyTaskType('compare aks pod cost vs bedrock api cost')).toBe<TaskType>('multi-cloud-agentic');
  });

  it('ec2 + gke = multi-cloud-agentic', () => {
    expect(classifyTaskType('compare ec2 spend to gke spend last month')).toBe<TaskType>('multi-cloud-agentic');
  });

  it('lambda + vertex = multi-cloud-agentic', () => {
    expect(classifyTaskType('what is cheaper for inference — lambda or vertex?')).toBe<TaskType>(
      'multi-cloud-agentic',
    );
  });

  it('bedrock with cost-analysis shape is cost-analysis-agentic', () => {
    expect(classifyTaskType('break down the bedrock cost spike by service for last month')).toBe<TaskType>(
      'cost-analysis-agentic',
    );
  });

  it('plain "iam" alone does NOT trigger (too generic — overlaps Azure AD)', () => {
    // IAM is generic; don't promote on bare mention.
    expect(classifyTaskType('what is iam?')).toBe<TaskType>('pure-chat');
  });
});

/**
 * Q1-fix-10 (2026-05-12) — conversation-context inheritance.
 *
 * Pre-fix: Q1 turn 2 classified independently of turn 1's classification.
 * After turn 1 was multi-cloud-agentic, turn 2 ("break it down by day")
 * was pure-chat → gpt-oss:20b. After fix the classifier accepts a
 * `priorClassification` and inherits the capability floor for short
 * continuation prompts, but resets cleanly on clear domain switches.
 */
describe('conversation-context inheritance', () => {
  it('agentic prior + short continuation stays at least system-read', () => {
    const result = classifyTaskType('show me daily breakdown for the past 30 days', {
      priorClassification: 'multi-cloud-agentic',
    });
    expect(result).toMatch(/agentic|system-read/);
  });

  it('agentic prior + "drill into" continuation stays agentic-floor', () => {
    const result = classifyTaskType('drill into the top 3', {
      priorClassification: 'cost-analysis-agentic',
    });
    expect(result).toMatch(/agentic|system-read/);
  });

  it('agentic prior + "why" continuation stays agentic-floor', () => {
    const result = classifyTaskType('why?', { priorClassification: 'multi-cloud-agentic' });
    expect(result).toMatch(/agentic|system-read/);
  });

  it('new pure-chat session with no prior is pure-chat', () => {
    expect(classifyTaskType('what is 2+2', { priorClassification: undefined })).toBe<TaskType>(
      'pure-chat',
    );
  });

  it('agentic prior + clearly off-topic short prompt resets to pure-chat', () => {
    // "hi" / "thanks" / very-short greeting-shape doesn't FORCE agentic
    // inheritance. The inheritance rule must allow a fresh-conversation
    // signal to override.
    expect(
      classifyTaskType('hi', { priorClassification: 'multi-cloud-agentic' }),
    ).toBe<TaskType>('pure-chat');
  });

  it('agentic prior + clearly new domain ("help me with my pets") resets', () => {
    expect(
      classifyTaskType('ok now help me with my pets', {
        priorClassification: 'multi-cloud-agentic',
      }),
    ).toBe<TaskType>('pure-chat');
  });

  it('pure-chat prior + agentic-shape prompt classifies on its own merits', () => {
    // Inheritance only applies in the agentic → maybe-continuation direction.
    // A pure-chat prior never blocks a fresh agentic detection.
    expect(
      classifyTaskType('show me all my aws ec2 instances', {
        priorClassification: 'pure-chat',
      }),
    ).toMatch(/agentic|system-read/);
  });

  it('explicit "ok now switch to" continuation phrase still resets', () => {
    expect(
      classifyTaskType('ok now switch to a different topic', {
        priorClassification: 'cost-analysis-agentic',
      }),
    ).toBe<TaskType>('pure-chat');
  });
});
