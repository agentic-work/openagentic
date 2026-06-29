/**
 * DIAGRAM SYSTEM MCP - DEPRECATED
 *
 * This MCP is deprecated. LLMs should emit `reactflow` JSON (preferred) or
 * inline `svg` code blocks. Mermaid is also deprecated on this platform.
 *
 * Preferred: ```reactflow JSON
 * ```reactflow
 * {
 *   "type": "flowchart",
 *   "layout": "vertical",
 *   "nodes": [
 *     {"id": "a", "label": "Start", "shape": "circle"},
 *     {"id": "b", "label": "Decision", "shape": "diamond"}
 *   ],
 *   "edges": [{"source": "a", "target": "b"}]
 * }
 * ```
 *
 * Alternative: inline ```svg for static illustrations.
 *
 * @deprecated Emit ```reactflow JSON or inline ```svg; do not emit ```mermaid.
 */

// Legacy exports maintained for backwards compatibility
export const DIAGRAM_MCP_NAME = 'diagram-generator-deprecated';

export const DIAGRAM_SYSTEM_PROMPT = `
IMPORTANT: The diagram tool is deprecated. Emit diagrams as \`\`\`reactflow JSON (preferred) or inline \`\`\`svg code blocks.
Do NOT emit \`\`\`mermaid — it is deprecated on this platform and will not render.

Example — reactflow JSON:
\`\`\`reactflow
{
  "type": "flowchart",
  "layout": "vertical",
  "nodes": [
    {"id": "a", "label": "Start", "shape": "circle", "color": "primary"},
    {"id": "b", "label": "Decision", "shape": "diamond", "color": "warning"},
    {"id": "c", "label": "Action", "shape": "rounded", "color": "success"},
    {"id": "d", "label": "End", "shape": "circle"}
  ],
  "edges": [
    {"source": "a", "target": "b"},
    {"source": "b", "target": "c", "label": "Yes"},
    {"source": "b", "target": "d", "label": "No", "style": "dashed"}
  ]
}
\`\`\`

Supported ReactFlow diagram types: flowchart, sequence, architecture, mindmap,
orgchart, statechart, erd, network, timeline, process.
`;

export const DIAGRAM_JSON_SCHEMA = {};
export const DIAGRAM_TOOL_DEFINITION = null;

export function isDiagramRequest(_message: string): boolean {
  // Deprecated — the markdown renderer handles ```reactflow JSON and ```svg blocks natively.
  return false;
}

export function validateDiagram(_diagram: unknown): { valid: boolean; errors: string[] } {
  return {
    valid: false,
    errors: ['Diagram MCP is deprecated. Emit ```reactflow JSON or inline ```svg code blocks.'],
  };
}

export function getDiagramMcpConfig() {
  return {
    name: DIAGRAM_MCP_NAME,
    version: '2.0.0',
    description: 'DEPRECATED - Emit ```reactflow JSON or inline ```svg code blocks instead',
    systemPrompt: DIAGRAM_SYSTEM_PROMPT,
    tools: [], // No tools - deprecated
    capabilities: {
      diagrams: false,
      flowcharts: false,
      architecture: false,
      mindmaps: false,
      orgcharts: false,
    },
  };
}

export default {
  name: DIAGRAM_MCP_NAME,
  systemPrompt: DIAGRAM_SYSTEM_PROMPT,
  toolDefinition: null,
  jsonSchema: DIAGRAM_JSON_SCHEMA,
  isDiagramRequest,
  validateDiagram,
  getConfig: getDiagramMcpConfig,
};
