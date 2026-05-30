/**
 * Phase A.4ext — scenario-pattern triggers + structural complexity trigger.
 *
 * A.4ext.1: SCENARIO_PATTERNS — regex patterns that match mock-07/10/12 prompt
 *           language even when no explicit artifact verb is present.
 * A.4ext.2: Structural complexity trigger — ≥3 MCP results + cost/volume
 *           keyword forces compose_visual (sankey default) even without
 *           any scenario or verb pattern match.
 *
 * RED tests written BEFORE the implementation changes. All are expected to
 * FAIL until detectArtifactVerb is extended with the new patterns.
 */
import { describe, it, expect } from 'vitest';
import { detectArtifactVerb } from '../artifactVerbDetector.js';

// ---------------------------------------------------------------------------
// A.4ext.1 — Mock-07: cost spike analysis (top-N cost spikes across clouds)
// ---------------------------------------------------------------------------
describe('A.4ext.1 — scenario patterns: Mock-07 cost spikes', () => {
  it('Mock-07 exact prompt → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage:
        'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('top-N cost spikes pattern → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Find the top 10 cost spikes across all our subscriptions',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('biggest N spend → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Show me the biggest 5 spend drivers this month',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('highest usage → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Which services have the highest 3 usage this quarter?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('cost breakdown → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Give me a cost breakdown by service across all clouds',
      mcpToolResultsThisTurn: 2,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('spend analysis → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: "I need a spend analysis for last quarter's cloud expenses",
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('spend savings → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Identify spend savings opportunities across our Azure accounts',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('bill spike → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Our AWS bill had a spike last week — what caused it?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('MoM keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Cloud costs are up 40% MoM — find the cause',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('month over month cost → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Compare our month over month cost growth across regions',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('quarter over quarter spend → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'What is the quarter over quarter spend trend for GCP?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  // False-positive guard: "history of cost accounting" — mentions cost but is NOT a spike/breakdown scenario
  it('false-positive guard: cost accounting history → no force (no scenario shape)', () => {
    const result = detectArtifactVerb({
      userMessage: 'What is the history of cost accounting as a discipline?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(false);
  });

  // False-positive guard: bare "cost" + MCP=1 should NOT trigger without scenario shape
  it('false-positive guard: bare "cost" mention + 1 MCP result → no force', () => {
    const result = detectArtifactVerb({
      userMessage: 'What does that Azure VM cost per month?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A.4ext.1 — Mock-10: migration plan (phased plan with estimates)
// ---------------------------------------------------------------------------
describe('A.4ext.1 — scenario patterns: Mock-10 migration plan', () => {
  it('Mock-10 exact prompt → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage:
        'I want to migrate the legacy MSSQL on-prem to Azure SQL Managed Instance. Give me a phased plan with downtime estimates.',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('migrate + plan → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'We need to migrate our Postgres DB to Aurora — build a migration plan',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('migration + timeline → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Give me a migration timeline for moving our infra to GCP',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('migration + downtime → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Estimate the downtime for our database migration from on-prem to Azure',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('migration + phased → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Create a phased migration roadmap for our legacy services',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('porting + plan → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Porting our app from AWS to Azure — give me a cutover plan',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('dependency graph → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Show me the dependency graph for the payment service',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('dependency map → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Build a deps map for the microservices we want to migrate',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('dependency tree → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'I need a dependency tree of the services that share the DB',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  // False-positive guard: "migration" in a general question without plan/estimate
  it('false-positive guard: "migration" without plan shape → no force', () => {
    const result = detectArtifactVerb({
      userMessage: 'What version of the migration tool should I install?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A.4ext.1 — Mock-12: user onboarding / permission matrix
// ---------------------------------------------------------------------------
describe('A.4ext.1 — scenario patterns: Mock-12 onboarding & permissions', () => {
  it('Mock-12 exact prompt → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage:
        'Onboard new dev jenny.kim@company.com — give her least-priv read access across our 3 clouds for the staging environments only.',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('onboard user + access → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Onboard the new developer with read-only access to staging',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('provision user + least-priv → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Provision sarah.jones with least-priv access to our dev environments',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('grant developer role → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Grant the new developer read role across all staging accounts',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('permission matrix → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Build a permission matrix for our cloud environments',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('IAM matrix → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Create an IAM matrix review for all staging accounts',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('role grid → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: "Show me a role grid of who can access what in our company's AWS",
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('IAM audit → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Run an IAM audit across our Azure subscriptions',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('risk score → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Generate a risk score assessment for the new access grant',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('blast radius matrix → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'What is the blast radius matrix if this role is compromised?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  // False-positive guard: "permission" in a simple question
  it('false-positive guard: simple permission question → no force', () => {
    const result = detectArtifactVerb({
      userMessage: 'Do I have permission to access that bucket?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A.4ext.1 — Mock-08: incident / outage triage
// ---------------------------------------------------------------------------
describe('A.4ext.1 — scenario patterns: Mock-08 incident triage', () => {
  it('incident triage → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'We have an active incident — give me a triage timeline',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('outage postmortem → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Build a postmortem for last night outage in us-east-1',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('sev-1 root cause → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'We had a sev-1 last night — do a root cause analysis',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('P0 RCA → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'P0 on production — give me an rca',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });
});

// ---------------------------------------------------------------------------
// A.4ext.1 — Mock-09: compliance / audit report
// ---------------------------------------------------------------------------
describe('A.4ext.1 — scenario patterns: Mock-09 compliance', () => {
  it('compliance report → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Generate a SOC2 compliance report for our AWS environment',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('audit dashboard → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'I need an audit dashboard for the HIPAA findings from last quarter',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('PCI gap remediation → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Show me the PCI gap remediation plan for our payment services',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('GDPR findings → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'Summarize the GDPR findings from the last audit',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });
});

// ---------------------------------------------------------------------------
// A.4ext.2 — Structural complexity trigger (≥3 MCP + cost/volume keyword)
// ---------------------------------------------------------------------------
describe('A.4ext.2 — structural complexity trigger', () => {
  it('3+ MCP results + cost keyword → compose_visual (even without scenario pattern)', () => {
    const result = detectArtifactVerb({
      userMessage: 'What did I spend last quarter?',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + spend keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'How much have we spent on compute this month?',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + usage keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Show me our resource usage',
      mcpToolResultsThisTurn: 4,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + bill keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Why is our bill so high this month?',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + traffic keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Summarize the traffic through our load balancers',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + volume keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'What is the volume of requests hitting our API?',
      mcpToolResultsThisTurn: 5,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + latency keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Investigate the latency issues across our microservices',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + breakdown keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'Give me a breakdown of the services that are running',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('3+ MCP results + flow keyword → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'What is the data flow through our pipeline?',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  // Negative: < 3 MCP results should NOT trigger structural forcing
  it('negative: only 1 MCP result + cost keyword → no structural force', () => {
    const result = detectArtifactVerb({
      userMessage: 'What did I spend last quarter?',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(false);
  });

  it('negative: 2 MCP results + spend keyword → no structural force', () => {
    const result = detectArtifactVerb({
      userMessage: 'How much have we spent on compute?',
      mcpToolResultsThisTurn: 2,
    });
    expect(result.shouldForce).toBe(false);
  });

  // Negative: 3+ MCP results but NO cost/volume keyword → no structural force
  it('negative: 3+ MCP results but no trigger keyword → no force', () => {
    const result = detectArtifactVerb({
      userMessage: 'List all my subscriptions across clouds',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(false);
  });

  it('negative: 0 MCP results + cost keyword → no force', () => {
    const result = detectArtifactVerb({
      userMessage: 'What did I spend last quarter?',
      mcpToolResultsThisTurn: 0,
    });
    expect(result.shouldForce).toBe(false);
  });

  // Structural trigger must respect the MCP >=1 baseline of existing verb matches
  it('existing verb match still wins at MCP=1 (structural trigger only adds for >=3)', () => {
    const result = detectArtifactVerb({
      userMessage: 'Render a sankey of my cost data',
      mcpToolResultsThisTurn: 1,
    });
    // Verb match fires at MCP=1 — existing behavior preserved
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });
});

// ---------------------------------------------------------------------------
// Regression: all original verb tests still pass
// ---------------------------------------------------------------------------
describe('regression: original explicit-verb cases still pass', () => {
  it('render → compose_visual', () => {
    expect(
      detectArtifactVerb({ userMessage: 'render a sankey of my cost data', mcpToolResultsThisTurn: 1 }),
    ).toMatchObject({ shouldForce: true, toolName: 'compose_visual' });
  });

  it('chart → compose_visual', () => {
    expect(
      detectArtifactVerb({ userMessage: 'chart my aws costs by service', mcpToolResultsThisTurn: 2 }),
    ).toMatchObject({ shouldForce: true, toolName: 'compose_visual' });
  });

  it('diagram → compose_visual', () => {
    expect(
      detectArtifactVerb({
        userMessage: 'draw a diagram of the architecture',
        mcpToolResultsThisTurn: 1,
      }),
    ).toMatchObject({ shouldForce: true, toolName: 'compose_visual' });
  });

  it('flowchart → compose_visual', () => {
    expect(
      detectArtifactVerb({
        userMessage: 'create a flowchart for the deployment process',
        mcpToolResultsThisTurn: 1,
      }),
    ).toMatchObject({ shouldForce: true, toolName: 'compose_visual' });
  });

  it('dashboard → compose_app', () => {
    expect(
      detectArtifactVerb({
        userMessage: 'show me a dashboard of my services',
        mcpToolResultsThisTurn: 1,
      }),
    ).toMatchObject({ shouldForce: true, toolName: 'compose_app' });
  });

  it('interactive → compose_app', () => {
    expect(
      detectArtifactVerb({
        userMessage: 'build an interactive cost explorer',
        mcpToolResultsThisTurn: 1,
      }),
    ).toMatchObject({ shouldForce: true, toolName: 'compose_app' });
  });

  it('no force: 0 MCP results regardless of verb', () => {
    expect(
      detectArtifactVerb({ userMessage: 'render a chart of the data', mcpToolResultsThisTurn: 0 }),
    ).toMatchObject({ shouldForce: false });
  });

  it('no force: no verb + no pattern + 1 MCP result', () => {
    expect(
      detectArtifactVerb({ userMessage: 'list all my subscriptions', mcpToolResultsThisTurn: 3 }),
    ).toMatchObject({ shouldForce: false });
  });
});
