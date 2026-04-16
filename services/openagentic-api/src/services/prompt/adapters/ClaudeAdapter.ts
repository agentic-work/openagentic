import type { PromptModule, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';

export class ClaudeAdapter implements ModelAdapter {
  readonly family = 'claude' as const;

  transform(modules: PromptModule[], capabilities: ModelCapabilities): string {
    const parts: string[] = [];

    // Role identity prefix
    parts.push('You are Claude, operating as an AI assistant within the OpenAgentic platform.');

    if (capabilities.thinking) {
      parts.push('Reason step by step in your thinking before responding to complex requests.');
    }

    for (const mod of modules) {
      // Use claude variant if available, otherwise wrap content in XML
      const content = mod.variants?.claude ?? `<module name="${mod.name}">${mod.content}</module>`;
      parts.push(content);
    }

    return parts.join('\n\n');
  }
}
