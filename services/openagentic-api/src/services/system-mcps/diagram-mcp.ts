/**
 * DIAGRAM SYSTEM MCP - DEPRECATED
 *
 * This MCP has been deprecated in favor of the artifact system.
 * LLMs should now generate diagrams using Mermaid syntax:
 *
 * Option 1: Standard Mermaid block (auto-detected)
 * ```mermaid
 * graph TD
 *   A[Start] --> B[Process]
 *   B --> C[End]
 * ```
 *
 * Option 2: Explicit artifact type
 * ```artifact:mermaid
 * graph TD
 *   A[Start] --> B[Process]
 *   B --> C[End]
 * ```
 *
 * The artifact system provides:
 * - Better rendering quality
 * - Export to SVG/PNG
 * - Print support
 * - Share functionality
 * - Consistent UX across all artifact types
 *
 * @deprecated Use Mermaid artifacts instead
 */

// Legacy exports maintained for backwards compatibility
export const DIAGRAM_MCP_NAME = 'diagram-generator-deprecated';

export const DIAGRAM_SYSTEM_PROMPT = `
IMPORTANT: The diagram tool has been deprecated. Instead, use Mermaid code blocks to generate diagrams.

Example:
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
\`\`\`

Supported Mermaid diagram types:
- flowchart/graph (TD, LR, TB, RL)
- sequence
- classDiagram
- stateDiagram
- erDiagram
- pie
- gantt
- journey
- mindmap
`;

export const DIAGRAM_JSON_SCHEMA = {};
export const DIAGRAM_TOOL_DEFINITION = null;

export function isDiagramRequest(_message: string): boolean {
  // Deprecated - always return false
  // The artifact system handles mermaid blocks automatically
  return false;
}

export function validateDiagram(_diagram: unknown): { valid: boolean; errors: string[] } {
  return {
    valid: false,
    errors: ['Diagram MCP is deprecated. Use ```mermaid code blocks instead.'],
  };
}

export function getDiagramMcpConfig() {
  return {
    name: DIAGRAM_MCP_NAME,
    version: '2.0.0',
    description: 'DEPRECATED - Use Mermaid artifacts instead',
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
