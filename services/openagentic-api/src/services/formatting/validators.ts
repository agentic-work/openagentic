/**
 * Markdown Validators
 * Validates markdown content and detects anti-patterns
 */

import { ValidationResult, ValidationError, Enhancement, AntiPattern, FormattingCapability } from './types.js';

export function validateMarkdown(
  content: string,
  capabilities: Map<string, FormattingCapability>
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    suggestions: [],
    usedCapabilities: [],
    antiPatternsDetected: []
  };

  const lines = content.split('\n');

  // Detect used capabilities
  result.usedCapabilities = detectUsedCapabilities(content, capabilities);

  // Check for anti-patterns
  result.antiPatternsDetected = detectAntiPatterns(content, lines);

  // Validate code blocks
  validateCodeBlocks(lines, result);

  // Validate LaTeX math
  validateMath(lines, result);

  // Check for misused inline code
  validateInlineCode(lines, result);

  // Suggest enhancements
  suggestEnhancements(content, lines, result);

  result.isValid = result.errors.filter(e => e.severity === 'error').length === 0;

  return result;
}

function detectUsedCapabilities(
  content: string,
  capabilities: Map<string, FormattingCapability>
): string[] {
  const used: string[] = [];

  if (/#{1,6}\s/.test(content)) used.push('md-headers');
  if (/\*\*[^*]+\*\*/.test(content)) used.push('md-emphasis');
  if (/\*[^*]+\*/.test(content)) used.push('md-emphasis');
  if (/`[^`]+`/.test(content)) used.push('md-code-inline');
  if (/```/.test(content)) used.push('md-code-block');
  if (/^\s*[-*]\s/m.test(content)) used.push('md-lists-unordered');
  if (/^\s*\d+\.\s/m.test(content)) used.push('md-lists-ordered');
  if (/\|[^|]+\|/.test(content)) used.push('md-tables');
  if (/^>\s/m.test(content)) used.push('md-blockquotes');
  if (/^(---|\*\*\*|___)$/m.test(content)) used.push('md-horizontal-rule');
  if (/\$[^$]+\$/.test(content)) used.push('math-inline');
  if (/\$\$/.test(content)) used.push('math-display');
  if (/```mermaid/i.test(content)) used.push('diagram-mermaid');
  if (/```d2/i.test(content)) used.push('diagram-d2');
  if (/<details>/i.test(content)) used.push('html-details');

  return used;
}

export function detectAntiPatterns(content: string, lines: string[]): AntiPattern[] {
  const antiPatterns: AntiPattern[] = [];

  // Anti-pattern: Using backticks for emphasis
  const emphasisBackticks = content.match(/`(Important|Note|Warning|Key|Critical|Essential|Tip)`/gi);
  if (emphasisBackticks) {
    antiPatterns.push({
      pattern: '`Word` for emphasis',
      found: emphasisBackticks[0],
      suggestion: 'Use **bold** or *italic* for emphasis, backticks only for code',
      severity: 'high'
    });
  }

  // Anti-pattern: Math without LaTeX
  const mathWithoutLatex = content.match(/\b([a-z])\^(\d+)\b|E=mc\^2|x\^2\+y\^2/gi);
  if (mathWithoutLatex && !content.includes('$')) {
    antiPatterns.push({
      pattern: 'Math notation without LaTeX',
      found: mathWithoutLatex[0],
      suggestion: 'Use LaTeX with $ delimiters: $x^2$ instead of x^2',
      severity: 'high'
    });
  }

  // Anti-pattern: Code block without language
  const unlabeledCodeBlocks = content.match(/```\n[^`]/g);
  if (unlabeledCodeBlocks) {
    antiPatterns.push({
      pattern: 'Code block without language',
      found: '```\\n',
      suggestion: 'Always specify language: ```typescript or ```python',
      severity: 'medium'
    });
  }

  // Anti-pattern: Overuse of bullet lists
  const bulletCount = (content.match(/^\s*[-*]\s/gm) || []).length;
  if (bulletCount > 15) {
    antiPatterns.push({
      pattern: 'Overuse of bullet lists',
      found: `${bulletCount} bullet points`,
      suggestion: 'Consider using prose, tables, or headers instead',
      severity: 'low'
    });
  }

  // Anti-pattern: Multiple H1 headers
  const h1Count = (content.match(/^#\s/gm) || []).length;
  if (h1Count > 1) {
    antiPatterns.push({
      pattern: 'Multiple H1 headers',
      found: `${h1Count} H1 headers`,
      suggestion: 'Use only one H1, use H2-H6 for sub-sections',
      severity: 'medium'
    });
  }

  return antiPatterns;
}

function validateCodeBlocks(lines: string[], result: ValidationResult): void {
  let inCodeBlock = false;
  let codeBlockStart = -1;
  let codeBlockLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockStart = i;
        codeBlockLang = line.substring(3).trim();

        if (!codeBlockLang) {
          result.errors.push({
            line: i + 1,
            column: 0,
            message: 'Code block should specify a language for syntax highlighting',
            severity: 'warning',
            capability: 'md-code-block'
          });
        }
      } else {
        inCodeBlock = false;
      }
    }
  }

  if (inCodeBlock) {
    result.errors.push({
      line: codeBlockStart + 1,
      column: 0,
      message: 'Unclosed code block',
      severity: 'error',
      capability: 'md-code-block'
    });
  }
}

function validateMath(lines: string[], result: ValidationResult): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for unbalanced $ delimiters
    const singleDollars = (line.match(/\$/g) || []).length;
    if (singleDollars % 2 !== 0) {
      result.errors.push({
        line: i + 1,
        column: 0,
        message: 'Unbalanced $ math delimiters',
        severity: 'error',
        capability: 'math-inline'
      });
    }

    // Check for double dollar on single line (should be block)
    if (line.includes('$$') && line.trim() !== '$$') {
      result.errors.push({
        line: i + 1,
        column: 0,
        message: '$$ should be on its own line for display math',
        severity: 'warning',
        capability: 'math-display'
      });
    }
  }
}

function validateInlineCode(lines: string[], result: ValidationResult): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect potential misuse of inline code for emphasis
    const inlineCodeMatches = line.match(/`([^`]+)`/g);
    if (inlineCodeMatches) {
      for (const match of inlineCodeMatches) {
        const content = match.slice(1, -1);

        // Check if it looks like emphasis rather than code
        if (/^(important|note|warning|key|critical|tip)$/i.test(content)) {
          result.suggestions.push({
            original: match,
            suggested: `**${content}**`,
            reason: 'Use bold for emphasis, not inline code',
            capability: 'md-code-inline'
          });
        }
      }
    }
  }
}

function suggestEnhancements(content: string, lines: string[], result: ValidationResult): void {
  // Suggest using tables instead of lists for comparisons
  if (content.includes('vs') || content.includes('versus')) {
    const bulletCount = (content.match(/^\s*[-*]\s/gm) || []).length;
    if (bulletCount > 4) {
      result.suggestions.push({
        original: 'bullet list',
        suggested: 'table',
        reason: 'Comparisons are clearer in table format',
        capability: 'md-tables'
      });
    }
  }

  // Suggest adding emojis to headers
  const headersWithoutEmoji = lines.filter(l =>
    /^#{1,3}\s[^🔧🚀📚💡⚠️✅❌🔍📊🏗️⚖️🔢]/.test(l)
  );
  if (headersWithoutEmoji.length > 0) {
    result.suggestions.push({
      original: headersWithoutEmoji[0],
      suggested: headersWithoutEmoji[0].replace(/^(#{1,3}\s)/, '$1🚀 '),
      reason: 'Emojis in headers improve visual hierarchy',
      capability: 'visual-emojis'
    });
  }

  // Suggest LaTeX for mathematical expressions
  if (/\b\d+\^\d+\b|sqrt\(|log\(|sin\(|cos\(/i.test(content) && !content.includes('$')) {
    result.suggestions.push({
      original: 'plain text math',
      suggested: '$expression$',
      reason: 'Use LaTeX for mathematical notation',
      capability: 'math-inline'
    });
  }
}
