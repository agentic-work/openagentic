/**
 * #1108 — artifactVerbDetector regression test for the IAM-audit + JSON-findings
 * prompt class that failed to force compose_app on the rule-0 first-video drive
 * (2026-05-25, image 0.7.1-115f2f6b → fb007bea, Sonnet 4.6 on chat-dev).
 *
 * Live evidence: prompt was the fanout audit shown in
 * reports/verify-cadence/rule-0-first-video/22c196b2/frames/15-*.png.
 * Detector SHOULD have matched scenario pattern at artifactVerbDetector.ts:313-317:
 *   /\b(compliance|audit|hipaa|soc2|pci|gdpr)\b.*?\b(report|dashboard|findings|gap|remediation)\b/i
 *
 * The prompt literally contains "...multi-step **audit**: ... Return a single
 * JSON **findings** array...". Both anchors present, same line (no newlines in
 * the typed text). So detector should return `{shouldForce:true, toolName:'compose_app'}`.
 *
 * If THIS test passes → detector works; downstream is the failure (model defied
 * tool_choice, or chatLoop suppressed the force, or compose_app wasn't in the
 * tool catalog at that turn). If RED → regex / wiring bug in detector itself.
 *
 * Pinned scenario patterns:
 *   - compliance/audit/hipaa/soc2/pci/gdpr  +  report/dashboard/findings/gap/remediation
 *   - permission/role/iam                   +  matrix/grid/map/review/audit
 */
import { describe, it, expect } from 'vitest';
import { detectArtifactVerb } from '../artifactVerbDetector.js';

const FANOUT_PROMPT_VERBATIM =
  'FANOUT PROBE — dispatch THREE sub-agents in PARALLEL via the Task tool with subagent_type=cloud_operations. Each must run a genuine multi-step audit: (Azure) list every subscription, then for each list role assignments, identify any principal with Owner or User Access Administrator across >1 subscription. (AWS) list every account in the org, then for each list IAM users/roles with AdministratorAccess, identify any principal across >1 account. (GCP) list every project, then for each fetch IAM policy bindings, identify any principal with roles/owner across >1 project. Return a single JSON findings array combining all 3 clouds. This needs >=5 API calls per cloud — explicit instruction is to delegate via Task because each cloud requires isolated context.';

describe('#1108 — IAM-audit + JSON-findings scenario → compose_app', () => {
  it('verbatim fanout-probe prompt matches compliance/audit→findings on turn 1 (mcp=0)', () => {
    // Pre-call detector runs with mcpResultsAccumulated=0 on round 1.
    // Phase 2 scenario patterns fire regardless of MCP count, so this MUST
    // return shouldForce:true.
    const result = detectArtifactVerb({
      userMessage: FANOUT_PROMPT_VERBATIM,
      mcpToolResultsThisTurn: 0,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('verbatim fanout-probe prompt still forces on round 2 (mcp=3 from sub-agent results)', () => {
    // Post-call detector runs after tool_results push. Same prompt, same
    // pattern match — should still force compose_app.
    const result = detectArtifactVerb({
      userMessage: FANOUT_PROMPT_VERBATIM,
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('minimal compliance/findings pair → compose_app', () => {
    // Sanity: confirm the pattern still matches the minimal anchor-pair form.
    const result = detectArtifactVerb({
      userMessage: 'Run a compliance audit and return findings.',
      mcpToolResultsThisTurn: 0,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('IAM audit + JSON findings array (no "compliance" word) → compose_app', () => {
    // Variant: prompt uses "IAM audit" + "JSON findings array" — same
    // compliance/audit→findings shape, different surface wording.
    const result = detectArtifactVerb({
      userMessage:
        'Run an IAM audit across all subscriptions and return a JSON findings array of any over-permissioned principals.',
      mcpToolResultsThisTurn: 0,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('NEGATIVE: "audit" without findings/report/dashboard anchor does NOT force', () => {
    // Negation: bare "audit" without the second anchor should not trip the
    // pattern (the partner-anchor requirement is the whole point — prevents
    // false positives on conversational uses of "audit").
    const result = detectArtifactVerb({
      userMessage: 'Tell me about audit best practices for AWS IAM.',
      mcpToolResultsThisTurn: 0,
    });
    expect(result.shouldForce).toBe(false);
  });
});
