/**
 * Arch regression — mermaid must NOT be a model-facing option in
 * compose_visual. User direction 2026-05-15: only the diagram templates
 * we know work (arch_diagram / reactflow_arch / sankey / chart family)
 * remain. Mermaid was promoted in #809 then reversed because models
 * routinely emit malformed Mermaid v11 DSL that v11.14.0's parser
 * rejects ("Syntax error in text" — see #823, repeated #835 follow-up
 * symptoms). The decision: kill the primitive, stop advertising it to
 * the model.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPOSE_VISUAL_TEMPLATES,
  COMPOSE_VISUAL_TOOL,
} from '../../services/ComposeVisualTool.js';

describe('no mermaid in compose_visual surface', () => {
  it('COMPOSE_VISUAL_TEMPLATES does not contain "mermaid"', () => {
    expect(COMPOSE_VISUAL_TEMPLATES).not.toContain('mermaid');
  });

  it('COMPOSE_VISUAL_TEMPLATES does not contain "diagram" alias', () => {
    expect(COMPOSE_VISUAL_TEMPLATES).not.toContain('diagram');
  });

  it('tool description shown to model has no mermaid mentions', () => {
    const desc = COMPOSE_VISUAL_TOOL.function.description ?? '';
    expect(desc).not.toMatch(/mermaid/i);
  });

  it('tool description has no diagram_src field reference', () => {
    const desc = COMPOSE_VISUAL_TOOL.function.description ?? '';
    expect(desc).not.toMatch(/diagram_src/);
  });
});
