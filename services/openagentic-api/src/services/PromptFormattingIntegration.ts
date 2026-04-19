/**
 * Prompt Formatting Integration Service
 *
 * Injects formatting capabilities into prompt templates dynamically.
 * This replaces static formatting instructions with the comprehensive
 * capability registry from FormattingCapabilitiesService.
 */

import type { Logger } from 'pino';
import { getFormattingCapabilitiesService } from './formatting/index.js';

export class PromptFormattingIntegration {
  private logger: Logger;
  private formattingService: ReturnType<typeof getFormattingCapabilitiesService>;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'prompt-formatting-integration' });
    this.formattingService = getFormattingCapabilitiesService(logger);
  }

  /**
   * Inject formatting capabilities section into a prompt template
   */
  injectFormattingCapabilities(basePrompt: string): string {
    const formattingSection = this.formattingService.generateSystemPromptSection();

    // Append formatting capabilities at the end
    return `${basePrompt}

---

${formattingSection}`;
  }

  /**
   * Get condensed formatting guidelines for embedding in prompts
   */
  getCondensedFormattingGuidelines(): string {
    return `
## FORMATTING CAPABILITIES

You have access to comprehensive formatting capabilities to create visually appealing, professional responses:

### Core Markdown
- **Headers:** # H1, ## H2, ### H3 (use for structure)
- **Emphasis:** **bold**, *italic*, ~~strikethrough~~, ==highlight==
- **Lists:** Ordered (1. 2. 3.) and unordered (- or *)
- **Task Lists:** - [ ] unchecked, - [x] checked (great for TODOs!)
- **Tables:** Use for comparisons and structured data
- **Blockquotes:** > for callouts, tips, warnings
- **Admonitions:** > [!NOTE], > [!WARNING], > [!TIP], > [!IMPORTANT], > [!CAUTION]
- **Footnotes:** Text[^1] with [^1]: definition (auto-numbered references)
- **Keyboard:** <kbd>Ctrl</kbd>+<kbd>C</kbd> for keyboard shortcuts
- **Collapsible:** <details><summary>Title</summary>Content</details>

### Code
- **Inline code:** \`code\` for commands, functions, technical terms
- **Code blocks:** \`\`\`language\\ncode\\n\`\`\` with syntax highlighting
- Supported languages: typescript, javascript, python, java, bash, sql, yaml, json, and 30+ more

### Mathematics (LaTeX/KaTeX)
- **Inline math:** $x^2 + y^2 = z^2$ for expressions within text
- **Display math:** $$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$ for centered equations
- **CRITICAL:** Always use LaTeX notation with $ delimiters for ANY mathematical notation

### Diagrams & Charts
- **ReactFlow JSON:** \`\`\`reactflow\\n{"type":"flowchart","nodes":[...],"edges":[...]}\\n\`\`\` (PREFERRED — flowcharts, architecture, sequence, ERDs, mindmaps, timelines)
- **Inline SVG:** \`\`\`svg\\n<svg ...>...</svg>\\n\`\`\` (static illustrations, icons, math visualizations)
- **Chart.js JSON:** \`\`\`chart\\n{"type":"pie","data":{...}}\\n\`\`\` (data visualization — pie, bar, line, scatter)
- **ASCII Art:** Use box-drawing characters ┌┐└┘│─ in code blocks for simple diagrams
- **Do NOT emit \`\`\`mermaid** — deprecated on this platform; it will not render.

### Visual Enhancements
- **Emojis:** Use strategically as status indicators (✅ ⚠️ ❌) in tables and callouts, not as decoration
- **Colors:** Use diff code blocks for red/green highlighting

### Guidelines
1. **DO:** Use tables for comparisons instead of bullet lists
2. **DO:** Specify language in all code blocks for syntax highlighting
3. **DO:** Use LaTeX ($) for ANY mathematical expressions
4. **DO:** Use emojis as status indicators in tables (✅ ⚠️ ❌), not in every heading
5. **DO:** Use headers to create clear document structure
6. **DO:** Quantify claims with data - your audience is enterprise IT executives
7. **DON'T:** Use backticks for emphasis (use **bold** instead)
8. **DON'T:** Write math as plain text (use $x^2$ not x^2)
9. **DON'T:** Create code blocks without language specification
10. **DON'T:** Overuse bullet lists (prefer prose, tables, headers)
11. **DON'T:** Use excessive emojis or decorative emojis - keep it professional

### Response Patterns

**Code Explanation:** Use ## heading, code blocks with syntax highlighting, **bold** for key points

**Math Solution:** Use ## heading, inline math $...$ in prose, display math $$...$$ for main equation

**Architecture:** Use ## heading, D2 diagram in \`\`\`d2, table for components

**Comparison:** Use ## heading, table with status indicators (✅ ❌ ⚠️)

**Tutorial:** Use ## heading, ordered list with code blocks, blockquotes for tips

**Data Visualization:** Use Chart.js JSON for inline charts/graphs:
\`\`\`chart
{
  "type": "pie",
  "data": {
    "labels": ["Product A", "Product B", "Product C"],
    "datasets": [{"data": [45, 30, 25]}]
  }
}
\`\`\`

**Timeline/Gantt:** Use ReactFlow JSON with "type":"timeline":
\`\`\`reactflow
{
  "type": "timeline",
  "layout": "horizontal",
  "nodes": [
    {"id": "d", "label": "Design (30d)", "shape": "rounded"},
    {"id": "dev", "label": "Development (45d)", "shape": "rounded"}
  ],
  "edges": [{"source": "d", "target": "dev"}]
}
\`\`\`

### CRITICAL EXAMPLES - Learn These Patterns

**Example 1: Code with Math**
\`\`\`
## 📐 Calculating Area

The formula for a circle's area is $A = \\pi r^2$, which in code looks like:

\`\`\`python
import math

def circle_area(radius: float) -> float:
    return math.pi * radius ** 2
\`\`\`

For a radius of 5, the area is: $$A = \\pi \\times 5^2 = 78.54$$
\`\`\`

**Example 2: Data with Visualization**
\`\`\`
## 📊 Sales Performance

| Quarter | Revenue | Growth |
|---------|---------|--------|
| Q1      | $45k    | ✅ +12% |
| Q2      | $67k    | ✅ +48% |
| Q3      | $52k    | ⚠️ -22% |

\`\`\`chart
{"type":"pie","data":{"labels":["Q1","Q2","Q3"],"datasets":[{"data":[45,67,52]}]}}
\`\`\`
\`\`\`

**Example 3: Architecture Diagram**
\`\`\`
## 🏗️ System Architecture

\`\`\`d2
web: Web Client
api: API Server
db: Database

web -> api: HTTPS
api -> db: SQL Query
\`\`\`
\`\`\`

**Example 4: Advanced Formatting Showcase**
\`\`\`
## 📋 Project Roadmap

> [!IMPORTANT]
> All features must be completed before Q2 2024 release

### ✅ Implementation Progress

**Completed Tasks:**
- [x] Design system architecture
- [x] Implement user authentication
- [x] Create API endpoints
- [ ] Write comprehensive tests
- [ ] Deploy to production

### ⚡ Performance Metrics

| Component | Latency | Status | Notes |
|-----------|---------|--------|-------|
| API | 45ms | ✅ Good | Well optimized |
| Database | 120ms | ⚠️ Fair | Needs indexing[^1] |
| CDN | 12ms | ✅ Excellent | Using edge caching |

\`\`\`chart
{"type":"bar","data":{"labels":["API","Database","CDN"],"datasets":[{"label":"Latency (ms)","data":[45,120,12]}]}}
\`\`\`

### 💡 Tips & Tricks

> [!TIP]
> Use <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> to open command palette

<details>
<summary>📖 View Advanced Configuration</summary>

For power users, you can configure advanced settings:

\`\`\`json
{
  "cache": "redis",
  "ttl": 3600
}
\`\`\`
</details>

[^1]: Indexing strategy planned for next sprint
\`\`\`

**Example 5: Math & Science**
\`\`\`
## 🧪 Chemical Reactions

The combustion of methane can be expressed as:

$$CH_4 + 2O_2 \\rightarrow CO_2 + 2H_2O$$

Where the reaction rate $k$ follows the Arrhenius equation:

$$k = Ae^{-E_a/RT}$$

> [!NOTE]
> At standard temperature (25°C), the activation energy $E_a$ is approximately 78 kJ/mol
\`\`\`

For more details on any capability, you can query the formatting service API at /api/formatting/guidance
`;
  }

  /**
   * Get context-aware formatting suggestions based on query
   */
  getFormattingGuidanceForQuery(query: string): string {
    const guidance = this.formattingService.getGuidanceForQuery(query);

    if (!guidance.recommendedCapabilities || guidance.recommendedCapabilities.length === 0) {
      return '';
    }

    const capabilities = guidance.recommendedCapabilities
      .map(id => this.formattingService.getCapability(id))
      .filter(Boolean);

    const sections: string[] = [];

    sections.push('## FORMATTING SUGGESTIONS FOR THIS QUERY');
    sections.push('');

    if (guidance.preset) {
      sections.push(`**Recommended Pattern:** ${guidance.preset.name}`);
      sections.push(guidance.preset.description);
      sections.push('');
      sections.push('**Template:**');
      sections.push('```markdown');
      sections.push(guidance.preset.template);
      sections.push('```');
      sections.push('');
    }

    if (capabilities.length > 0) {
      sections.push('**Recommended Capabilities:**');
      for (const cap of capabilities) {
        if (!cap) continue;
        sections.push(`- **${cap.name}:** ${cap.example}`);
      }
      sections.push('');
    }

    if (guidance.tips && guidance.tips.length > 0) {
      sections.push('**Tips:**');
      for (const tip of guidance.tips) {
        sections.push(`- ${tip}`);
      }
      sections.push('');
    }

    if (guidance.warnings && guidance.warnings.length > 0) {
      sections.push('**⚠️ Warnings:**');
      for (const warning of guidance.warnings) {
        sections.push(`- ${warning}`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }
}

// Singleton instance
let integrationInstance: PromptFormattingIntegration | null = null;

export function getPromptFormattingIntegration(logger: Logger): PromptFormattingIntegration {
  if (!integrationInstance) {
    integrationInstance = new PromptFormattingIntegration(logger);
  }
  return integrationInstance;
}
