/**
 * Phase A.1 — RED test for `input_examples` on the 3 artifact tools.
 *
 * Plan ref: /home/trent/.claude/plans/sprightly-percolating-brook.md Track A Phase A.1
 *
 * Anthropic tool-use docs identify `input_examples` as a first-class schema
 * field: "Examples are included in the prompt alongside your tool schema,
 * showing Claude concrete patterns for well-formed tool calls."
 * Live evidence (this session): Haiku 4.5 writes "1. Sankey Diagram"
 * markdown headings instead of dispatching `compose_visual` as `tool_use`.
 * Adding `input_examples` covering the slugs the 17 mocks need is the
 * lowest-LOC lever Anthropic explicitly recommends.
 *
 * RED contract:
 *   - `input_examples` MUST be a non-empty array on each of the 3 tools.
 *   - Each example MUST have the schema's required top-level fields populated.
 *   - For compose_visual: the union of `example.template` across examples
 *     MUST cover {sankey, bar_chart, line_chart, kpi_grid, arch_diagram,
 *     heatmap} — the highest-leverage templates from
 *     `COMPOSE_VISUAL_TEMPLATES` for the 17 mock scenarios. Mock-specific
 *     slugs like `latency_heatmap` / `dependency_graph` /
 *     `log_anomaly_chart` / `gpu_utilization_chart` are routed via
 *     `compose_app` (see registry at `composeAppTemplates.ts`) — those
 *     are covered by the compose_app assertion below.
 *   - For compose_app: the union of `example.template` MUST cover at least
 *     6 of the canonical mock slugs {savings_grid, incident_card,
 *     migration_plan, permission_matrix, compliance_dashboard, runbook,
 *     flamegraph, root_cause_card, cluster_inventory, version_matrix,
 *     breaking_changes_list, rotation_calendar, risk_priority_queue,
 *     training_runs_dashboard, multi-tenant-audit-dashboard,
 *     traffic-flow-diagram, cloud-run-grid, build-progress,
 *     multi-region-eks-dashboard}.
 *   - For render_artifact: the union of `example.kind` MUST cover {html,
 *     svg, react, python_plot} — the 4 declared kinds.
 *
 * GREEN expectation: lands in Phase A.1's GREEN commit which adds the
 * `input_examples` field to each tool definition.
 */
import { describe, it, expect } from 'vitest';
import { COMPOSE_VISUAL_TOOL } from '../ComposeVisualTool.js';
import { COMPOSE_APP_TOOL } from '../ComposeAppTool.js';
import { RENDER_ARTIFACT_TOOL } from '../RenderArtifactTool.js';

type ToolDefn = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      required?: string[];
      properties: Record<string, unknown>;
    };
    input_examples?: Array<Record<string, unknown>>;
  };
};

function getRequired(tool: ToolDefn): string[] {
  return tool.function.parameters.required ?? [];
}

function getExamples(tool: ToolDefn): Array<Record<string, unknown>> {
  // input_examples is the new field we're adding in this phase. Tests assert
  // its presence; the field will land in the GREEN commit.
  return (tool.function as { input_examples?: Array<Record<string, unknown>> })
    .input_examples ?? [];
}

describe('Phase A.1 — input_examples on artifact tool schemas', () => {
  describe('compose_visual', () => {
    const tool = COMPOSE_VISUAL_TOOL as unknown as ToolDefn;

    it('declares input_examples as a non-empty array', () => {
      const examples = getExamples(tool);
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeGreaterThan(0);
    });

    it('every example has the schema-required top-level fields', () => {
      const examples = getExamples(tool);
      const required = getRequired(tool);
      expect(required).toContain('template');
      expect(required).toContain('data');
      for (const ex of examples) {
        for (const field of required) {
          expect(
            ex,
            `compose_visual example missing required field "${field}": ${JSON.stringify(ex)}`,
          ).toHaveProperty(field);
        }
        // Type checks — template must be a string, data must be a non-null object.
        expect(typeof ex.template).toBe('string');
        expect(typeof ex.data).toBe('object');
        expect(ex.data).not.toBeNull();
      }
    });

    it('covers the highest-leverage compose_visual templates for the 17 mocks', () => {
      const examples = getExamples(tool);
      const templates = new Set(examples.map((e) => String(e.template)));
      const required = [
        'sankey',
        'bar_chart',
        'line_chart',
        'kpi_grid',
        'arch_diagram',
        'heatmap',
      ];
      for (const slug of required) {
        expect(
          templates.has(slug),
          `compose_visual.input_examples missing slug "${slug}" — required for 17-mock AC compose_visual emissions`,
        ).toBe(true);
      }
    });
  });

  describe('compose_app', () => {
    const tool = COMPOSE_APP_TOOL as unknown as ToolDefn;

    it('declares input_examples as a non-empty array', () => {
      const examples = getExamples(tool);
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeGreaterThan(0);
    });

    it('every example has the schema-required top-level fields', () => {
      const examples = getExamples(tool);
      const required = getRequired(tool);
      expect(required).toContain('title');
      for (const ex of examples) {
        for (const field of required) {
          expect(
            ex,
            `compose_app example missing required field "${field}": ${JSON.stringify(ex)}`,
          ).toHaveProperty(field);
        }
        // Either `template` OR `html` must be set (per executeComposeApp contract).
        const hasTemplate = typeof ex.template === 'string' && (ex.template as string).length > 0;
        const hasHtml = typeof ex.html === 'string' && (ex.html as string).length > 0;
        expect(
          hasTemplate || hasHtml,
          `compose_app example must set template or html: ${JSON.stringify(ex)}`,
        ).toBe(true);
        // When template is set, params must be present.
        if (hasTemplate) {
          expect(ex).toHaveProperty('params');
          expect(typeof ex.params).toBe('object');
          expect(ex.params).not.toBeNull();
        }
      }
    });

    it('covers at least 6 mock-contract compose_app slugs', () => {
      const examples = getExamples(tool);
      const templates = new Set(
        examples
          .map((e) => (typeof e.template === 'string' ? e.template : null))
          .filter((s): s is string => s !== null),
      );
      const mockSlugs = [
        'savings_grid',
        'incident_card',
        'migration_plan',
        'permission_matrix',
        'compliance_dashboard',
        'runbook',
        'flamegraph',
        'root_cause_card',
        'cluster_inventory',
        'version_matrix',
        'breaking_changes_list',
        'rotation_calendar',
        'risk_priority_queue',
        'training_runs_dashboard',
        'multi-tenant-audit-dashboard',
        'traffic-flow-diagram',
        'cloud-run-grid',
        'build-progress',
        'multi-region-eks-dashboard',
        'incident_timeline',
        'remediation_plan',
        'risk_score_card',
      ];
      const covered = mockSlugs.filter((s) => templates.has(s));
      expect(
        covered.length,
        `compose_app.input_examples covers only ${covered.length} of the mock-contract slugs (need >= 6). Templates present: ${[...templates].join(', ')}`,
      ).toBeGreaterThanOrEqual(6);
    });
  });

  describe('render_artifact', () => {
    const tool = RENDER_ARTIFACT_TOOL as unknown as ToolDefn;

    it('declares input_examples as a non-empty array', () => {
      const examples = getExamples(tool);
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeGreaterThan(0);
    });

    it('every example has the schema-required top-level fields', () => {
      const examples = getExamples(tool);
      const required = getRequired(tool);
      expect(required).toContain('kind');
      expect(required).toContain('content');
      for (const ex of examples) {
        for (const field of required) {
          expect(
            ex,
            `render_artifact example missing required field "${field}": ${JSON.stringify(ex)}`,
          ).toHaveProperty(field);
        }
        expect(typeof ex.kind).toBe('string');
        expect(typeof ex.content).toBe('string');
        expect((ex.content as string).length).toBeGreaterThan(0);
      }
    });

    it('covers the 4 declared render_artifact kinds', () => {
      const examples = getExamples(tool);
      const kinds = new Set(examples.map((e) => String(e.kind)));
      for (const k of ['html', 'svg', 'react', 'python_plot']) {
        expect(
          kinds.has(k),
          `render_artifact.input_examples missing kind "${k}"`,
        ).toBe(true);
      }
    });
  });
});
