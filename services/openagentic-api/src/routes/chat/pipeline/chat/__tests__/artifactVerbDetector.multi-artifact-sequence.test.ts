/**
 * #965 Mocks 07/10/12 dispatch-fidelity extension — multi-artifact sequence.
 *
 * The current detectArtifactVerb returns a SINGLE forced tool per call. For
 * multi-artifact mocks (07, 10, 12), we need an ordered queue:
 *
 *   Mock-07 (tri-cloud-cost-spikes):
 *     "cost spike ... savings" → [compose_visual:sankey, compose_app:savings_grid]
 *
 *   Mock-10 (mssql-migration-plan):
 *     "migration plan ... dependency" → [compose_app:migration_plan, compose_visual:dependency_graph]
 *
 *   Mock-12 (iam-onboarding):
 *     "permission matrix ... risk score" → [compose_app:permission_matrix, compose_app:risk_score_card]
 *
 * RED-test contract:
 *   - exported helper `detectArtifactSequence(input)` returns
 *     { sequence: Array<{ toolName, template? }> } when a multi-artifact
 *     pattern matches. Empty sequence = no multi-step plan applied.
 *   - The existing `detectArtifactVerb` continues to work as today (single
 *     toolName) — it can read `sequence[0]` when a sequence is present.
 *
 * These tests fail until the sequence detector is implemented.
 */
import { describe, it, expect } from 'vitest';
import { detectArtifactSequence } from '../artifactVerbDetector.js';

describe('#965 detectArtifactSequence — multi-artifact patterns', () => {
  // -------------------------------------------------------------------------
  // Mock-07 — cost spike + savings → sankey → savings_grid
  // -------------------------------------------------------------------------
  it('Mock-07: "cost spike ... savings" → [sankey, savings_grid] sequence', () => {
    const out = detectArtifactSequence({
      userMessage:
        "Our cloud bill is up 40% MoM. Find the top cost spikes across Azure/AWS/GCP and show me the savings opportunities.",
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(2);
    expect(out.sequence[0]).toMatchObject({
      toolName: 'compose_visual',
      template: 'sankey',
    });
    expect(out.sequence[1]).toMatchObject({
      toolName: 'compose_app',
      template: 'savings_grid',
    });
  });

  it('Mock-07: "cost spikes ... what to cut" alias → [sankey, savings_grid]', () => {
    const out = detectArtifactSequence({
      userMessage:
        "Find the top 10 cost spikes across our clouds and tell me what to cut for savings.",
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(2);
    expect(out.sequence[0].template).toBe('sankey');
    expect(out.sequence[1].template).toBe('savings_grid');
  });

  // -------------------------------------------------------------------------
  // Mock-10 — migration plan + dependency → migration_plan → dependency_graph
  // -------------------------------------------------------------------------
  it('Mock-10: "migration plan ... dependency" → [migration_plan, dependency_graph]', () => {
    const out = detectArtifactSequence({
      userMessage:
        'Build me a migration plan for the MSSQL DB and show the dependency graph for the services that hit it.',
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(2);
    expect(out.sequence[0]).toMatchObject({
      toolName: 'compose_app',
      template: 'migration_plan',
    });
    expect(out.sequence[1]).toMatchObject({
      toolName: 'compose_visual',
      template: 'dependency_graph',
    });
  });

  it('Mock-10: "phased migration plan with dependencies" → sequence applies', () => {
    const out = detectArtifactSequence({
      userMessage:
        'Phased migration plan for moving Postgres to Aurora — include the dependency map for the consumers.',
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(2);
    expect(out.sequence[0].template).toBe('migration_plan');
    expect(out.sequence[1].template).toBe('dependency_graph');
  });

  // -------------------------------------------------------------------------
  // Mock-12 — permission matrix + risk score → permission_matrix → risk_score_card
  // -------------------------------------------------------------------------
  it('Mock-12: "permission matrix ... risk score" → [permission_matrix, risk_score_card]', () => {
    const out = detectArtifactSequence({
      userMessage:
        'Generate a permission matrix for the new dev and show me the risk score for the proposed access.',
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(2);
    expect(out.sequence[0]).toMatchObject({
      toolName: 'compose_app',
      template: 'permission_matrix',
    });
    expect(out.sequence[1]).toMatchObject({
      toolName: 'compose_app',
      template: 'risk_score_card',
    });
  });

  it('Mock-12: "IAM matrix ... blast radius" alias still hits the sequence', () => {
    const out = detectArtifactSequence({
      userMessage:
        'Build the IAM matrix for jenny.kim and rate the blast radius risk score for this grant.',
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(2);
    expect(out.sequence[0].template).toBe('permission_matrix');
    expect(out.sequence[1].template).toBe('risk_score_card');
  });

  // -------------------------------------------------------------------------
  // Negative cases — single-pattern prompts should NOT return a sequence
  // -------------------------------------------------------------------------
  it('negative: "cost spike" alone (no savings/cuts) → empty sequence', () => {
    const out = detectArtifactSequence({
      userMessage: 'investigate the cost spike from last week',
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(0);
  });

  it('negative: "migration plan" alone (no dependency) → empty sequence', () => {
    const out = detectArtifactSequence({
      userMessage: 'build a migration plan for the legacy app',
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(0);
  });

  it('negative: "permission matrix" alone (no risk score) → empty sequence', () => {
    const out = detectArtifactSequence({
      userMessage: 'show me a permission matrix for staging',
      mcpToolResultsThisTurn: 1,
    });
    expect(out.sequence.length).toBe(0);
  });

  it('negative: "what is the weather" → empty sequence', () => {
    const out = detectArtifactSequence({
      userMessage: "what's the weather today",
      mcpToolResultsThisTurn: 0,
    });
    expect(out.sequence.length).toBe(0);
  });
});
