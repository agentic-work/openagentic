/**
 * Comprehensive Formatting Capability Registry
 * Defines all supported formatting features for LLM responses
 */

import { FormattingCapability, CapabilityCategory } from './types.js';

export const FORMATTING_CAPABILITIES: FormattingCapability[] = [
  // ========== MARKDOWN BASICS ==========
  {
    id: 'md-headers',
    name: 'Headers (H1-H6)',
    category: 'structure',
    syntax: ['# H1', '## H2', '### H3', '#### H4', '##### H5', '###### H6'],
    example: '## Performance Analysis\n### Memory Usage',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use for document structure and hierarchy',
      'Combine with emojis for visual appeal',
      'Prefer over bullet lists for major sections',
      'H1-H3 most commonly used, H4-H6 for deep nesting'
    ]
  },
  {
    id: 'md-emphasis',
    name: 'Text Emphasis',
    category: 'markdown',
    syntax: ['**bold**', '*italic*', '***bold italic***', '~~strikethrough~~'],
    example: '**Important:** The system is *currently* ~~deprecated~~ ***critical***',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Bold for strong emphasis and important points',
      'Italics for subtle emphasis or technical terms',
      'Strikethrough for deprecated or removed items',
      'Combine for extra emphasis sparingly'
    ],
    antiPatterns: ['Using `backticks` for emphasis instead of code']
  },
  {
    id: 'md-code-inline',
    name: 'Inline Code',
    category: 'code',
    syntax: '`code`',
    example: 'Run `npm install` or use the `--force` flag',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'ONLY for actual code, commands, file paths, or technical identifiers',
      'NOT for emphasis of regular words',
      'Use for package names, function names, CLI commands'
    ],
    antiPatterns: ['`Important` word', 'The `key` concept']
  },
  {
    id: 'md-code-block',
    name: 'Code Blocks',
    category: 'code',
    syntax: '```language\ncode\n```',
    example: '```typescript\ninterface User {\n  id: string;\n  name: string;\n}\n```',
    engine: 'prism',
    supportLevel: 'full',
    requiresBlock: true,
    usageRules: [
      'ALWAYS specify language for syntax highlighting',
      'Provide complete, runnable code examples',
      'Include all imports and type definitions',
      'Support for 100+ languages via Prism.js'
    ]
  },
  {
    id: 'md-lists-unordered',
    name: 'Unordered Lists',
    category: 'structure',
    syntax: ['- item', '* item'],
    example: '- First item\n  - Nested item\n- Second item',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use sparingly - prefer prose or tables',
      'Good for true lists of 3-7 similar items',
      'Consider emoji bullets instead: 🔹 item'
    ],
    antiPatterns: ['Overusing for all content structure']
  },
  {
    id: 'md-lists-ordered',
    name: 'Ordered Lists',
    category: 'structure',
    syntax: '1. item',
    example: '1. Initialize project\n2. Install dependencies\n3. Run tests',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use for sequential steps or rankings',
      'Auto-renumbers if you use 1. for all items',
      'Can nest with indentation'
    ]
  },
  {
    id: 'md-tables',
    name: 'Tables',
    category: 'structure',
    syntax: '| Header | Header |\n|--------|--------|\n| Cell   | Cell   |',
    example: '| Service | Status | Cost |\n|---------|:------:|-----:|\n| API | ✅ Active | $99 |\n| CDN | ⚠️ Warning | $45 |',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use for data comparison and structured information',
      'Supports alignment with colons (:)',
      'Combine with emojis for visual status indicators',
      'Better than lists for multi-attribute items'
    ]
  },
  {
    id: 'md-blockquotes',
    name: 'Block Quotes',
    category: 'structure',
    syntax: '> quote',
    example: '> 💡 **Pro Tip:** Always validate user input\n> \n> This prevents security vulnerabilities',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use for callouts, warnings, tips',
      'Can nest other markdown inside',
      'Combine with emojis and bold for emphasis',
      'Good alternative to bullet points for important notes'
    ]
  },
  {
    id: 'md-horizontal-rule',
    name: 'Horizontal Rules',
    category: 'structure',
    syntax: ['---', '***', '___'],
    example: 'Section 1\n\n---\n\nSection 2',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use to separate major sections',
      'Requires blank lines before and after',
      'All three syntaxes render identically'
    ]
  },
  {
    id: 'md-links',
    name: 'Links',
    category: 'markdown',
    syntax: ['[text](url)', '[text][ref]', '<url>'],
    example: '[Documentation](https://docs.example.com)',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use descriptive link text',
      'Support for reference-style links',
      'Auto-linking with <url> syntax'
    ]
  },
  {
    id: 'md-images',
    name: 'Images',
    category: 'markdown',
    syntax: '![alt text](url)',
    example: '![Architecture Diagram](https://example.com/arch.png)',
    engine: 'markdown',
    supportLevel: 'partial',
    usageRules: [
      'Always provide alt text',
      'Links must be publicly accessible',
      'No local file support in chat context'
    ]
  },

  // ========== CHARTS & VISUALIZATIONS ==========
  // Mermaid is removed from this platform. The canonical primitives are:
  //   - compose_visual meta-tool — single-frame charts + arch diagrams (d3 +
  //     ECharts via /api/cdn/lib/*; templates: sankey, bar_chart, line_chart,
  //     kpi_grid, arch_diagram, treemap, heatmap, etc.)
  //   - compose_app meta-tool — interactive mini-apps (registry templates or
  //     freestyle HTML with /api/cdn/lib/ scripts only)
  //   - ```svg / ```reactflow code-fences — static escape hatches for prose
  //     responses; NEVER for first-class diagram surfaces.

  // ========== LATEX/MATH ==========
  {
    id: 'math-inline',
    name: 'Inline LaTeX Math',
    category: 'math',
    syntax: '$expression$',
    example: 'The complexity is $O(n \\log n)$ where $n$ is the input size',
    output: 'The complexity is O(n log n) where n is the input size',
    engine: 'katex',
    supportLevel: 'full',
    usageRules: [
      'Use for math expressions within sentences',
      'Escape backslashes: \\\\ for single \\',
      'Full LaTeX math syntax supported',
      'REQUIRED when users ask for mathematical formulas'
    ],
    antiPatterns: ['Using [x^2] or plain text for math', 'E=mc^2 without $ delimiters']
  },
  {
    id: 'math-display',
    name: 'Display LaTeX Math',
    category: 'math',
    syntax: '$$expression$$',
    example: '$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$',
    output: 'Centered equation: ∫_{-∞}^{∞} e^{-x²} dx = √π',
    engine: 'katex',
    supportLevel: 'full',
    requiresBlock: true,
    usageRules: [
      'Use for centered, standalone equations',
      'Better for complex multi-line formulas',
      'Supports equation arrays and matrices',
      'MUST use actual LaTeX, never text descriptions'
    ]
  },

  // ========== DIAGRAMS ==========
  {
    id: 'diagram-reactflow',
    name: 'Interactive Diagrams',
    category: 'diagram',
    syntax: '```diagram\n{"nodes": [...], "edges": [...]}\n```',
    example: '```diagram\n{\n  "type": "flowchart",\n  "title": "Login Flow",\n  "layout": "vertical",\n  "nodes": [\n    {"id": "start", "label": "User Visits", "shape": "circle", "color": "primary"},\n    {"id": "login", "label": "Enter Credentials", "shape": "rounded", "color": "primary"},\n    {"id": "check", "label": "Valid?", "shape": "diamond", "color": "warning"},\n    {"id": "success", "label": "Success", "shape": "circle", "color": "success"},\n    {"id": "fail", "label": "Failed", "shape": "circle", "color": "error"}\n  ],\n  "edges": [\n    {"source": "start", "target": "login"},\n    {"source": "login", "target": "check"},\n    {"source": "check", "target": "success", "label": "Yes"},\n    {"source": "check", "target": "fail", "label": "No", "style": "dashed"}\n  ]\n}\n```',
    engine: 'reactflow',
    supportLevel: 'full',
    requiresBlock: true,
    usageRules: [
      'PREFER the compose_visual meta-tool with template:"arch_diagram" for architecture / sequence / flowchart / class / ER / state / network diagrams — it renders d3 stencils with dagre auto-layout and inherits chat theme tokens (--cm-* / --accent)',
      'Use ```reactflow JSON code-fence ONLY when answering INSIDE PROSE and a full slide-out is overkill — for first-class diagram surfaces, use compose_visual',
      'For simple static illustrations inside prose, inline ```svg is acceptable',
      'For animated diagrams or custom interactive visualizations, call the compose_app meta-tool',
      'ReactFlow code-fence supports: flowchart, sequence, architecture, mindmap, orgchart, statechart, erd, network, timeline, process',
      'Node shapes: rounded (default), rectangle, diamond, circle, hexagon, cylinder, cloud, parallelogram, document',
      'Edge styles: solid (default), dashed, dotted, animated',
      'Layouts: vertical (default), horizontal, radial',
      'Colors: Use semantic names (primary, secondary, success, warning, error, info, muted) - system maps to theme CSS variables'
    ],
    antiPatterns: [
      'Emitting ```mermaid code-fences — Mermaid is removed from this platform. The renderer drops them silently. Use compose_visual template:"arch_diagram" instead',
      'Hardcoding hex colors instead of semantic color names — chatmode resolves --cm-* / --accent at paint time',
      'Not specifying node colors/shapes when the diagram needs visual hierarchy'
    ]
  },

  // ========== VISUAL ENHANCEMENTS ==========
  {
    id: 'visual-emojis',
    name: 'Emojis',
    category: 'visual',
    syntax: 'Direct Unicode insertion',
    example: '✅ Success | ⚠️ Warning | ❌ Error | 🚀 Performance | 💡 Tip',
    engine: 'native',
    supportLevel: 'full',
    usageRules: [
      'Use strategically as status indicators: ✅ success, ⚠️ warning, ❌ error',
      'Appropriate in table cells for visual status scanning',
      'Appropriate in callout/blockquote prefixes for tips and warnings',
      'Do NOT use as decoration or in every heading - keep responses professional'
    ]
  },
  {
    id: 'visual-colors',
    name: 'Colored Text (via code blocks)',
    category: 'visual',
    syntax: '```diff\n+ green\n- red\n```',
    example: '```diff\n+ Added feature\n- Removed deprecated API\n! Important change\n```',
    engine: 'prism',
    supportLevel: 'partial',
    requiresBlock: true,
    usageRules: [
      'Use diff blocks for red/green coloring',
      'Some languages provide syntax coloring',
      'No direct text color control'
    ]
  },

  // ========== HTML SUBSET ==========
  {
    id: 'html-details',
    name: 'Collapsible Sections',
    category: 'structure',
    syntax: '<details>\n<summary>Title</summary>\nContent\n</details>',
    example: '<details>\n<summary>📖 View Full Logs</summary>\n\nDetailed log output here...\n</details>',
    engine: 'native',
    supportLevel: 'partial',
    usageRules: [
      'Use for optional/verbose content',
      'Good for logs, debug info, examples',
      'May not work in all contexts'
    ]
  },

  // ========== ADVANCED MARKDOWN ==========
  {
    id: 'md-task-lists',
    name: 'Task Lists',
    category: 'structure',
    syntax: '- [ ] unchecked\n- [x] checked',
    example: '**TODO:**\n- [x] Design API\n- [x] Implement backend\n- [ ] Write tests\n- [ ] Deploy to production',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use for action items, checklists, progress tracking',
      'Great for showing completed vs pending tasks',
      'Renders with interactive checkboxes in some contexts'
    ]
  },
  {
    id: 'md-footnotes',
    name: 'Footnotes',
    category: 'markdown',
    syntax: 'Text[^1]\n\n[^1]: Footnote content',
    example: 'React uses virtual DOM[^1] for performance.\n\n[^1]: The virtual DOM is an in-memory representation of the real DOM',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Use for citations, additional context, references',
      'Automatically numbered and linked',
      'Good for academic or technical writing'
    ]
  },
  {
    id: 'md-definition-lists',
    name: 'Definition Lists',
    category: 'structure',
    syntax: 'Term\n: Definition',
    example: 'API\n: Application Programming Interface\n\nREST\n: Representational State Transfer',
    engine: 'markdown',
    supportLevel: 'partial',
    usageRules: [
      'Use for glossaries, term definitions',
      'Alternative to tables for key-value pairs',
      'Semantic HTML output'
    ]
  },
  {
    id: 'md-abbreviations',
    name: 'Abbreviations',
    category: 'markdown',
    syntax: '*[HTML]: Hyper Text Markup Language',
    example: 'HTML is great!\n\n*[HTML]: Hyper Text Markup Language',
    engine: 'markdown',
    supportLevel: 'partial',
    usageRules: [
      'Define abbreviations at end of document',
      'Shows tooltip on hover in supporting renderers',
      'Good for technical documents with many acronyms'
    ]
  },
  {
    id: 'md-kbd',
    name: 'Keyboard Keys',
    category: 'markdown',
    syntax: '<kbd>Ctrl</kbd>+<kbd>C</kbd>',
    example: 'Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy, <kbd>Cmd</kbd>+<kbd>V</kbd> to paste',
    engine: 'native',
    supportLevel: 'full',
    usageRules: [
      'Use for keyboard shortcuts and hotkeys',
      'Renders with special key styling',
      'Better than inline code for keyboard input'
    ]
  },
  {
    id: 'md-superscript-subscript',
    name: 'Superscript & Subscript',
    category: 'markdown',
    syntax: 'x^2^ or H~2~O',
    example: 'E=mc^2^ and H~2~O (or use LaTeX: $x^2$ and $H_2O$)',
    engine: 'markdown',
    supportLevel: 'partial',
    usageRules: [
      'Use for simple math notation, chemical formulas',
      'Prefer LaTeX $ $ for complex math',
      'Syntax: ^super^ and ~sub~'
    ]
  },
  {
    id: 'md-highlights',
    name: 'Highlighted Text',
    category: 'markdown',
    syntax: '==highlighted==',
    example: 'This is ==very important== information',
    engine: 'markdown',
    supportLevel: 'partial',
    usageRules: [
      'Use for emphasis stronger than bold',
      'Yellow highlight effect in supporting renderers',
      'Good for key takeaways and warnings'
    ]
  },
  {
    id: 'md-admonitions',
    name: 'Admonitions/Callouts',
    category: 'structure',
    syntax: '> [!NOTE]\n> Important information',
    example: '> [!WARNING]\n> This action cannot be undone\n\n> [!TIP]\n> Use keyboard shortcuts for faster workflow',
    engine: 'markdown',
    supportLevel: 'full',
    usageRules: [
      'Types: NOTE, TIP, IMPORTANT, WARNING, CAUTION',
      'Styled colored boxes with icons',
      'Better than plain blockquotes for alerts'
    ]
  },
  {
    id: 'chart-ascii',
    name: 'ASCII Art Charts',
    category: 'chart',
    syntax: 'Plain text art in code blocks',
    example: '```\n┌─────────┐     ┌─────────┐\n│ Client  │────▶│ Server  │\n└─────────┘     └─────────┘\n     │               │\n     └──── Request ──┘\n```',
    engine: 'native',
    supportLevel: 'full',
    usageRules: [
      'Use ONLY inside terminal-style code blocks for pre/post-flight steps; for any first-class diagram surface, use compose_visual template:"arch_diagram" instead',
      'Good for terminal-style output',
      'Box drawing characters: ┌ ┐ └ ┘ │ ─ ├ ┤ ┬ ┴ ┼'
    ]
  },
  // #781 Phase A4 — legacy "artifact-html" / "artifact-react" / "artifact-svg"
  // code-fence capability entries removed. Rich-artifact emission now flows
  // through `compose_visual` (charts) and `compose_app` (interactive React
  // apps) — those route to `synth-cdn` + `AppRenderer` for sandboxed rendering.
];

export const CAPABILITY_CATEGORIES: Record<string, CapabilityCategory> = {
  markdown: {
    id: 'markdown',
    name: 'Basic Markdown',
    description: 'Standard markdown formatting (bold, italic, links, images)'
  },
  math: {
    id: 'math',
    name: 'Mathematical Notation',
    description: 'LaTeX/KaTeX mathematical expressions'
  },
  code: {
    id: 'code',
    name: 'Code Display',
    description: 'Code blocks and syntax highlighting'
  },
  diagram: {
    id: 'diagram',
    name: 'Diagrams',
    description: 'Interactive diagram generation using React Flow (flowcharts, architecture, mind maps, etc.)'
  },
  chart: {
    id: 'chart',
    name: 'Charts & Data Visualization',
    description: 'Data presented in markdown tables with emojis, or React Flow diagrams for visual flows'
  },
  visual: {
    id: 'visual',
    name: 'Visual Enhancements',
    description: 'Emojis, colors, and styling'
  },
  structure: {
    id: 'structure',
    name: 'Document Structure',
    description: 'Headers, tables, lists, quotes, rules, task lists, admonitions'
  },
  interactive: {
    id: 'interactive',
    name: 'Interactive Artifacts',
    description: 'HTML/React/SVG artifacts that render inline as sandboxed mini-applications'
  }
};

export const LANGUAGE_SUPPORT = [
  // Core Web Technologies
  'javascript', 'typescript', 'jsx', 'tsx', 'html', 'css', 'scss', 'less', 'sass',

  // Backend Languages
  'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'swift', 'kotlin',
  'ruby', 'php', 'scala', 'elixir', 'erlang', 'haskell', 'clojure', 'fsharp',

  // Shell & Scripting
  'bash', 'shell', 'zsh', 'powershell', 'batch', 'fish', 'lua', 'perl',

  // Data & Configuration
  'sql', 'postgresql', 'mysql', 'plsql', 'yaml', 'yml', 'json', 'json5',
  'toml', 'ini', 'properties', 'xml', 'csv',

  // Infrastructure as Code
  'dockerfile', 'docker', 'terraform', 'tf', 'hcl', 'helm', 'kubernetes', 'k8s',
  'bicep', 'arm', 'cloudformation', 'ansible', 'vagrant',

  // Query & API Languages
  'graphql', 'grpc', 'protobuf', 'proto', 'thrift', 'avro',

  // Markup & Documentation
  'markdown', 'md', 'mdx', 'latex', 'tex', 'rst', 'asciidoc', 'plaintext', 'text',

  // Statistical & Scientific
  'r', 'matlab', 'octave', 'julia', 'mathematica',

  // Specialized
  'solidity', 'vhdl', 'verilog', 'assembly', 'asm', 'makefile', 'cmake',
  'nginx', 'apache', 'caddyfile', 'gitignore', 'diff', 'patch',

  // Diagrams (ReactFlow JSON format for complex interactive diagrams; SVG for static)
  'diagram', 'reactflow', 'svg'
];
