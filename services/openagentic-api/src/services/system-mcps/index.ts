/**
 * SYSTEM MCPs
 *
 * System MCPs are internal MCPs that provide specialized capabilities to the LLM
 * without being exposed as user-visible tools. They inject system prompts and
 * tool definitions to enable specific functionality.
 *
 * The artifact system is the primary way to generate visualizations, diagrams,
 * and interactive content. This module provides context-aware guidance to encourage
 * LLMs to use artifacts appropriately.
 *
 * NOTE (openagentic-omhs#327): the canonical user-intent gate now lives in
 * `services/prompt/ArtifactIntentGate.ts` and is consumed by PromptComposer.
 * `isDiagramRequest` here is retained only as a defence-in-depth check for
 * the legacy non-composable prompt path (see prompt.stage.ts fallback when
 * USE_COMPOSABLE_PROMPTS=false). It delegates to the same gate so the two
 * code paths cannot disagree.
 */

import { evaluateUserIntent } from '../prompt/ArtifactIntentGate.js';

// All registered system MCPs
export const SYSTEM_MCPS = {} as const;

/**
 * Returns true when the user's message expresses an explicit visualization
 * intent. Delegates to the canonical ArtifactIntentGate so the legacy and
 * composable prompt paths share one definition of "this user wants a chart".
 *
 * Earlier behaviour fired on ≥1 broad keyword (`'show me'`, `'breakdown'`,
 * `'costs'`) OR ≥2 cloud-related keywords, which routed almost every cloud
 * / cost question into the artifact-creation guidance pile. That's the
 * regression #327 was filed against.
 */
export function isDiagramRequest(message: string): boolean {
  return evaluateUserIntent(message).intent === 'visualization';
}

/**
 * Artifact guidance system prompt for visualization requests
 */
const ARTIFACT_GUIDANCE_PROMPT = `
## 🎨 ARTIFACT & VISUALIZATION GUIDANCE

When the user asks for diagrams, charts, visualizations, or data breakdowns, you should **CREATE ARTIFACTS** rather than just describing them.

### Artifact Types Available:

1. **ReactFlow Diagrams** - Use for flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, mindmaps, org charts, timelines, etc. Mermaid is deprecated on this platform — emit \`\`\`reactflow JSON instead.
   \`\`\`reactflow
   {
     "type": "flowchart",
     "layout": "vertical",
     "nodes": [
       {"id": "a", "label": "Start", "shape": "circle"},
       {"id": "b", "label": "Decision", "shape": "diamond"},
       {"id": "c", "label": "Action 1", "shape": "rounded"},
       {"id": "d", "label": "Action 2", "shape": "rounded"}
     ],
     "edges": [
       {"source": "a", "target": "b"},
       {"source": "b", "target": "c", "label": "Yes"},
       {"source": "b", "target": "d", "label": "No"}
     ]
   }
   \`\`\`

2. **HTML/JavaScript Artifacts** - Use for **Sankey diagrams**, pie charts, bar charts, and interactive visualizations
   - For **Sankey diagrams** (cost breakdowns, flow analysis), use **Plotly.js** or **D3.js**
   - Wrap in an HTML artifact block

3. **D2 Diagrams** - Use for architecture diagrams with a clean aesthetic
   \`\`\`d2
   Cloud: {
     Azure: "Azure Services"
     AWS: "AWS Services"
   }
   Cloud.Azure -> Cloud.AWS: "Hybrid"
   \`\`\`

### CRITICAL: When Users Ask About Cloud Costs

When users ask "show me my costs" or request cost breakdowns:

1. **First**: Use the appropriate MCP tools to GET THE REAL DATA (azure, aws, gcp tools)
2. **Then**: Create a **Sankey diagram artifact** showing the cost flow:
   - Service categories → Individual services → Costs
   - Use HTML with Plotly.js for interactive Sankey

Example Sankey for costs (HTML artifact):
\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
</head>
<body>
  <div id="sankey" style="width:100%;height:600px;"></div>
  <script>
    var data = [{
      type: "sankey",
      orientation: "h",
      node: {
        pad: 15,
        thickness: 20,
        line: { color: "black", width: 0.5 },
        label: ["Compute", "Storage", "Network", "VMs", "Disks", "Blob", "VNet", "Total: $X"],
        color: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f"]
      },
      link: {
        source: [0, 0, 1, 1, 2],
        target: [3, 4, 5, 4, 6],
        value: [100, 50, 75, 25, 30]
      }
    }];
    var layout = { title: "Cloud Cost Breakdown", font: { size: 12 } };
    Plotly.newPlot('sankey', data, layout);
  </script>
</body>
</html>
\`\`\`

### Best Practices:

- **DO** create visual artifacts when users ask for diagrams or visualizations
- **DO** use real data from MCP tools when available
- **DO** prefer Mermaid for simple diagrams, HTML/Plotly for interactive charts
- **DON'T** just describe what a diagram would look like - actually create it
- **DON'T** use fake/placeholder data - call the tools to get real data first
`;

// Get system prompts for active MCPs based on user message context
export function getSystemMcpPrompts(userMessage: string): string[] {
  const prompts: string[] = [];

  // If user is asking for visualizations/diagrams/costs, add artifact guidance
  if (isDiagramRequest(userMessage)) {
    prompts.push(ARTIFACT_GUIDANCE_PROMPT);
  }

  return prompts;
}

// Get tool definitions for active MCPs
export function getSystemMcpTools(_userMessage: string): any[] {
  // No additional tools - artifacts are created via markdown blocks
  return [];
}

// Check if a tool call is for a system MCP
export function isSystemMcpTool(_toolName: string): boolean {
  return false;
}

// Process a system MCP tool call
export async function processSystemMcpToolCall(
  toolName: string,
  _toolInput: unknown
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  return {
    success: false,
    error: `System MCP tool '${toolName}' is not available. Use artifacts instead.`,
  };
}

// Legacy exports for backwards compatibility
export const DIAGRAM_MCP_NAME = 'artifact-system';
export const DIAGRAM_SYSTEM_PROMPT = ARTIFACT_GUIDANCE_PROMPT;
export const DIAGRAM_TOOL_DEFINITION = null;
export function validateDiagram(_diagram: unknown): { valid: boolean; errors: string[] } {
  return { valid: true, errors: [] };
}

export default SYSTEM_MCPS;
