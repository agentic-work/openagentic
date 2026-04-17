import type { PromptModule, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';

/**
 * Renders a neutral module list into Gemini-family prompt shape
 * (markdown-heading sections). Adapter never contributes content —
 * capability-specific guidance (grounding, thinking) comes from seeded
 * modules gated by `requiresCapabilities`. See
 * docs/architecture/composable-prompt-neutralization.md.
 */
export class GeminiAdapter implements ModelAdapter {
  readonly family = 'gemini' as const;

  transform(modules: PromptModule[], _capabilities: ModelCapabilities): string {
    return modules
      .map((mod) => {
        const heading = mod.name
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        return `## ${heading}\n${mod.content}`;
      })
      .join('\n\n');
  }
}
