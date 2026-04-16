/**
 * Formatting Capabilities Service
 * Main service exposing all formatting capabilities to LLMs
 */

import type { Logger } from 'pino';
import {
  FormattingCapability,
  FormattingPreset,
  FormattingGuidance,
  ValidationResult
} from './types.js';
import { FORMATTING_CAPABILITIES, CAPABILITY_CATEGORIES, LANGUAGE_SUPPORT } from './capabilities.js';
import { FORMATTING_PRESETS } from './presets.js';
import { validateMarkdown, detectAntiPatterns } from './validators.js';

export class FormattingCapabilitiesService {
  private capabilities: Map<string, FormattingCapability>;
  private presets: Map<string, FormattingPreset>;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'formatting-capabilities' });

    // Initialize capability registry
    this.capabilities = new Map();
    for (const cap of FORMATTING_CAPABILITIES) {
      this.capabilities.set(cap.id, cap);
    }

    // Initialize preset registry
    this.presets = new Map();
    for (const preset of FORMATTING_PRESETS) {
      this.presets.set(preset.id, preset);
    }

    this.logger.info({
      capabilityCount: this.capabilities.size,
      presetCount: this.presets.size
    }, 'FormattingCapabilitiesService initialized');
  }

  /**
   * Get all available formatting capabilities
   */
  getAllCapabilities(): FormattingCapability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Get capabilities filtered by category
   */
  getCapabilitiesByCategory(category: string): FormattingCapability[] {
    return this.getAllCapabilities().filter(cap => cap.category === category);
  }

  /**
   * Get a specific capability by ID
   */
  getCapability(id: string): FormattingCapability | undefined {
    return this.capabilities.get(id);
  }

  /**
   * Get all available presets
   */
  getAllPresets(): FormattingPreset[] {
    return Array.from(this.presets.values());
  }

  /**
   * Get a specific preset by ID
   */
  getPreset(id: string): FormattingPreset | undefined {
    return this.presets.get(id);
  }

  /**
   * Find the best preset for a given user query
   */
  findBestPreset(query: string): FormattingPreset | undefined {
    const queryLower = query.toLowerCase();
    let bestMatch: FormattingPreset | undefined;
    let highestScore = 0;

    for (const preset of this.presets.values()) {
      let score = 0;

      // Check trigger words
      for (const trigger of preset.triggers) {
        if (queryLower.includes(trigger.toLowerCase())) {
          score += 2;
        }
      }

      // Partial matches
      const words = queryLower.split(/\s+/);
      for (const word of words) {
        for (const trigger of preset.triggers) {
          if (trigger.toLowerCase().includes(word) || word.includes(trigger.toLowerCase())) {
            score += 1;
          }
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = preset;
      }
    }

    return highestScore > 0 ? bestMatch : undefined;
  }

  /**
   * Get contextual formatting guidance for a user query
   */
  getGuidanceForQuery(query: string): FormattingGuidance {
    const queryLower = query.toLowerCase();
    const guidance: FormattingGuidance = {
      recommendedCapabilities: [],
      discouragedCapabilities: [],
      tips: []
    };

    // Find best matching preset
    const preset = this.findBestPreset(query);
    if (preset) {
      guidance.preset = preset;
      guidance.recommendedCapabilities = preset.capabilityIds;
    }

    // Context-aware recommendations
    if (/\b(code|function|implement|example|syntax)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['md-code-block', 'md-code-inline']);
      guidance.tips.push('Use code blocks with language specification for syntax highlighting');
      guidance.tips.push('Use inline code for function names and technical identifiers');
    }

    if (/\b(formula|equation|calculate|math|solve)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['math-inline', 'math-display']);
      guidance.tips.push('Use LaTeX math notation: $x^2$ for inline, $$ for display equations');
      guidance.tips.push('Always escape backslashes: \\\\ in LaTeX expressions');
    }

    if (/\b(diagram|architecture|flow|design|system)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['diagram-plantuml', 'diagram-d2']);
      guidance.tips.push('PlantUML is preferred for professional diagrams with rich icon libraries (AWS, Azure, Kubernetes, C4)');
      guidance.tips.push('D2 diagrams are excellent for architecture with auto-layout');
    }

    if (/\b(compare|versus|vs|difference|which)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['md-tables', 'visual-emojis']);
      guidance.tips.push('Use tables for clear comparison instead of bullet lists');
      guidance.tips.push('Add emoji status indicators: ✅ ⚠️ ❌ for visual clarity');
    }

    if (/\b(step|tutorial|guide|how to|instructions)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['md-lists-ordered', 'md-blockquotes']);
      guidance.tips.push('Use ordered lists for sequential steps');
      guidance.tips.push('Use blockquotes with emojis for tips: > 💡 **Tip:**');
    }

    if (/\b(data|metrics|performance|stats|numbers)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['md-tables', 'visual-emojis']);
      guidance.tips.push('Tables are ideal for structured data presentation');
      guidance.tips.push('Use emoji indicators for status columns');
    }

    // Chart-specific triggers - recommend Mermaid charts for visualization requests
    if (/\b(pie\s*chart|pie\s*graph|breakdown|distribution|percentage|proportion|share)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['chart-mermaid-pie']);
      guidance.tips.push('Use Mermaid pie charts for showing proportions and distributions');
      guidance.tips.push('Pie chart syntax: ```mermaid\npie title Chart Title\n  "Label A" : 40\n  "Label B" : 60\n```');
    }

    if (/\b(bar\s*chart|bar\s*graph|compare.*values|histogram|column\s*chart)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['chart-mermaid-bar']);
      guidance.tips.push('Use Mermaid xychart-beta for bar charts comparing values');
      guidance.tips.push('Bar chart syntax: ```mermaid\nxychart-beta\n  title "Chart Title"\n  x-axis [A, B, C]\n  bar [10, 20, 30]\n```');
    }

    if (/\b(gantt|timeline|project\s*schedule|schedule|milestones|roadmap|project\s*plan)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['chart-mermaid-gantt']);
      guidance.tips.push('Use Mermaid Gantt charts for project timelines and schedules');
      guidance.tips.push('Gantt syntax: ```mermaid\ngantt\n  title Project Timeline\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Task A :a1, 2024-01-01, 30d\n```');
    }

    if (/\b(chart|graph|visualize|visualization|plot)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['chart-mermaid-pie', 'chart-mermaid-bar', 'chart-mermaid-gantt']);
      guidance.tips.push('Consider using Mermaid charts: pie for proportions, xychart-beta for bar comparisons, gantt for timelines');
    }

    // Interactive artifacts - for games, emulators, demos, simulations
    if (/\b(game|emulator|simulator|interactive|demo|play|canvas|animation|widget|app|application)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['artifact-html', 'artifact-react']);
      guidance.tips.push('Use ```artifact:html for interactive HTML/CSS/JS that renders inline in a sandboxed iframe');
      guidance.tips.push('Use ```artifact:react for React components with state and hooks');
      guidance.tips.push('IMPORTANT: Plain ```html will NOT render - you MUST use ```artifact:html for it to work');
    }

    if (/\b(commodore|c64|nes|gameboy|retro|8.?bit|pixel|snake|tetris|pong)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['artifact-html']);
      guidance.tips.push('Use ```artifact:html for retro game emulators and interactive demos');
      guidance.tips.push('Include complete HTML with DOCTYPE, styles, and JavaScript');
    }

    if (/\b(react|component|useState|hooks|jsx)\b/i.test(query)) {
      this.addIfNotPresent(guidance.recommendedCapabilities, ['artifact-react']);
      guidance.tips.push('Use ```artifact:react to render React components inline with live preview');
    }

    // Anti-pattern warnings
    if (/\b(list|bullet)\b/i.test(query)) {
      guidance.warnings = guidance.warnings || [];
      guidance.warnings.push('Avoid overusing bullet lists - consider prose, tables, or headers');
      guidance.discouragedCapabilities.push('md-lists-unordered');
    }

    // Always recommend headers and emojis for structure
    this.addIfNotPresent(guidance.recommendedCapabilities, ['md-headers', 'visual-emojis']);

    return guidance;
  }

  /**
   * Validate markdown content and detect issues
   */
  validateContent(content: string): ValidationResult {
    return validateMarkdown(content, this.capabilities);
  }

  /**
   * Generate system prompt section with formatting capabilities
   */
  generateSystemPromptSection(): string {
    const sections: string[] = [];

    sections.push('# FORMATTING CAPABILITIES');
    sections.push('');
    sections.push('You have access to comprehensive formatting capabilities. Use them to create clear, professional, visually appealing responses.');
    sections.push('');

    // Group by category
    const categories = new Set(this.getAllCapabilities().map(c => c.category));

    for (const categoryId of categories) {
      const category = CAPABILITY_CATEGORIES[categoryId];
      if (!category) continue;

      const caps = this.getCapabilitiesByCategory(categoryId);
      if (caps.length === 0) continue;

      sections.push(`## ${category.name}`);
      sections.push(category.description);
      sections.push('');

      for (const cap of caps) {
        sections.push(`### ${cap.name} (${cap.id})`);

        // Syntax
        if (Array.isArray(cap.syntax)) {
          sections.push('**Syntax:**');
          for (const syntax of cap.syntax) {
            sections.push(`- \`${syntax}\``);
          }
        } else {
          sections.push(`**Syntax:** \`${cap.syntax}\``);
        }
        sections.push('');

        // Example
        sections.push('**Example:**');
        sections.push('```');
        sections.push(cap.example);
        sections.push('```');
        sections.push('');

        // Output (if provided)
        if (cap.output) {
          sections.push('**Renders as:**');
          sections.push(cap.output);
          sections.push('');
        }

        // Usage Rules
        if (cap.usageRules.length > 0) {
          sections.push('**Usage Rules:**');
          for (const rule of cap.usageRules) {
            sections.push(`- ${rule}`);
          }
          sections.push('');
        }

        // Anti-patterns
        if (cap.antiPatterns && cap.antiPatterns.length > 0) {
          sections.push('**❌ AVOID:**');
          for (const antiPattern of cap.antiPatterns) {
            sections.push(`- ${antiPattern}`);
          }
          sections.push('');
        }

        sections.push('---');
        sections.push('');
      }
    }

    // Add language support
    sections.push('## Supported Programming Languages');
    sections.push('');
    sections.push('For code blocks, you can use any of these languages:');
    sections.push('');
    sections.push(LANGUAGE_SUPPORT.join(', '));
    sections.push('');
    sections.push('---');
    sections.push('');

    // Add presets
    sections.push('## Response Presets');
    sections.push('');
    sections.push('For common query types, follow these proven patterns:');
    sections.push('');

    for (const preset of this.presets.values()) {
      sections.push(`### ${preset.name}`);
      sections.push(preset.description);
      sections.push('');
      sections.push('**Best for:** ' + preset.triggers.join(', '));
      sections.push('');
      sections.push('**Template:**');
      sections.push('```markdown');
      sections.push(preset.template);
      sections.push('```');
      sections.push('');
    }

    // Add artifacts and diagrams section - CRITICAL for interactive content
    sections.push('---');
    sections.push('');
    sections.push('## 🎮 INTERACTIVE ARTIFACTS - CRITICAL INSTRUCTIONS');
    sections.push('');
    sections.push('When users ask for interactive content, games, demos, visualizations, or anything that should "work", you MUST use artifacts:');
    sections.push('');
    sections.push('### When to use `artifact:html` (ALWAYS for interactive HTML):');
    sections.push('- Games (snake, tetris, pong, emulators)');
    sections.push('- Interactive demos and simulations');
    sections.push('- Data visualizations with animations');
    sections.push('- Mini-applications and widgets');
    sections.push('- Anything that needs to actually RUN in the browser');
    sections.push('');
    sections.push('**⚠️ CRITICAL: Plain \\`\\`\\`html WILL NOT RENDER. You MUST use \\`\\`\\`artifact:html for it to work!**');
    sections.push('');
    sections.push('### When to use `artifact:react`:');
    sections.push('- React component demos');
    sections.push('- Stateful UI widgets');
    sections.push('- Interactive forms and dashboards');
    sections.push('');
    sections.push('### When to use `artifact:svg`:');
    sections.push('- Animated graphics');
    sections.push('- Interactive infographics');
    sections.push('- Custom visualizations');
    sections.push('');
    sections.push('## 📊 DIAGRAMS AND FLOWCHARTS');
    sections.push('');
    sections.push('You have TWO diagram options - choose based on complexity:');
    sections.push('');
    sections.push('### Option 1: Mermaid (Simple diagrams)');
    sections.push('Use \\`\\`\\`mermaid for:');
    sections.push('- Simple flowcharts');
    sections.push('- Sequence diagrams');
    sections.push('- Class diagrams');
    sections.push('- Basic graphs');
    sections.push('');
    sections.push('Example:');
    sections.push('```mermaid');
    sections.push('flowchart TD');
    sections.push('    A[Start] --> B{Decision}');
    sections.push('    B -->|Yes| C[Action 1]');
    sections.push('    B -->|No| D[Action 2]');
    sections.push('```');
    sections.push('');
    sections.push('### Option 2: ReactFlow Diagram JSON (Complex/Interactive diagrams)');
    sections.push('Use \\`\\`\\`diagram for:');
    sections.push('- Complex architecture diagrams');
    sections.push('- Interactive flowcharts');
    sections.push('- Network topology');
    sections.push('- Mind maps');
    sections.push('- State machines');
    sections.push('');
    sections.push('Example:');
    sections.push('```diagram');
    sections.push('{');
    sections.push('  "type": "flowchart",');
    sections.push('  "title": "System Architecture",');
    sections.push('  "layout": "vertical",');
    sections.push('  "nodes": [');
    sections.push('    {"id": "web", "label": "Web App", "shape": "rounded", "color": "primary"},');
    sections.push('    {"id": "api", "label": "API Server", "shape": "rectangle", "color": "secondary"},');
    sections.push('    {"id": "db", "label": "Database", "shape": "cylinder", "color": "info"}');
    sections.push('  ],');
    sections.push('  "edges": [');
    sections.push('    {"source": "web", "target": "api", "label": "REST"},');
    sections.push('    {"source": "api", "target": "db", "label": "SQL"}');
    sections.push('  ]');
    sections.push('}');
    sections.push('```');
    sections.push('');
    sections.push('**Node shapes:** rounded, rectangle, diamond, circle, hexagon, cylinder, cloud, parallelogram, document');
    sections.push('**Colors:** primary, secondary, success, warning, error, info, muted');
    sections.push('**Layouts:** vertical, horizontal, radial');
    sections.push('');
    sections.push('---');
    sections.push('');
    sections.push('## General Guidelines');
    sections.push('');
    sections.push('1. **Use emojis strategically** as status indicators (✅ ⚠️ ❌) in tables and callouts - not as decoration');
    sections.push('2. **Prefer tables over lists** for comparisons and structured data');
    sections.push('3. **Always specify language** in code blocks for syntax highlighting');
    sections.push('4. **Use LaTeX math notation** for any mathematical expressions');
    sections.push('5. **Use headers** to create clear document structure');
    sections.push('6. **Avoid overusing bullet lists** - use prose, tables, or headers instead');
    sections.push('7. **Use inline code ONLY** for actual code, commands, or technical identifiers');
    sections.push('8. **Use bold for emphasis**, not backticks');
    sections.push('9. **Use Mermaid or ReactFlow diagrams** for architecture and flows');
    sections.push('10. **Validate your output** - check for unclosed code blocks, unbalanced math delimiters');
    sections.push('11. **PROACTIVELY use artifacts** - when the user wants something interactive, use artifact:html without being asked');
    sections.push('12. **Professional tone** - your audience is enterprise IT executives (CIOs, CTOs, AIOps). Keep responses precise and data-driven');
    sections.push('');

    return sections.join('\n');
  }

  /**
   * Get alternatives to bullet lists
   */
  getAlternativesToBullets(context?: string): string[] {
    const alternatives: string[] = [];

    alternatives.push('**Use prose paragraphs** - More natural and easier to read for explanatory content');
    alternatives.push('**Use tables** - Better for comparisons, data, or structured information');
    alternatives.push('**Use headers with sections** - Creates clear hierarchy without list fatigue');
    alternatives.push('**Use blockquotes** - Great for callouts, tips, warnings, important notes');
    alternatives.push('**Use emoji bullets in prose** - 🔹 Inline flow without list structure');
    alternatives.push('**Use numbered lists** - When order or sequence matters');
    alternatives.push('**Use definition lists** - For term/definition pairs');

    if (context) {
      const contextLower = context.toLowerCase();
      if (/compar/i.test(contextLower)) {
        alternatives.unshift('**Use comparison tables** - Perfect for comparing features/options');
      }
      if (/step|tutorial/i.test(contextLower)) {
        alternatives.unshift('**Use numbered steps** - Clear sequential instructions');
      }
      if (/data|metric/i.test(contextLower)) {
        alternatives.unshift('**Use data tables** - Structured presentation with headers');
      }
    }

    return alternatives;
  }

  /**
   * Export service data as JSON for API responses
   */
  toJSON() {
    return {
      capabilities: this.getAllCapabilities(),
      presets: this.getAllPresets(),
      categories: CAPABILITY_CATEGORIES,
      languageSupport: LANGUAGE_SUPPORT,
      version: '1.0.0'
    };
  }

  /**
   * Helper to add items to array if not already present
   */
  private addIfNotPresent(array: string[], items: string[]): void {
    for (const item of items) {
      if (!array.includes(item)) {
        array.push(item);
      }
    }
  }
}

// Singleton instance
let serviceInstance: FormattingCapabilitiesService | null = null;

export function getFormattingCapabilitiesService(logger: Logger): FormattingCapabilitiesService {
  if (!serviceInstance) {
    serviceInstance = new FormattingCapabilitiesService(logger);
  }
  return serviceInstance;
}
