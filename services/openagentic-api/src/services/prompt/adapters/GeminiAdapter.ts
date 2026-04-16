import type { PromptModule, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';

/** Strip XML tags from content (e.g. <module name="...">...</module>) */
function stripXml(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

export class GeminiAdapter implements ModelAdapter {
  readonly family = 'gemini' as const;

  transform(modules: PromptModule[], capabilities: ModelCapabilities): string {
    const parts: string[] = [];

    if (capabilities.grounding) {
      parts.push(
        '## Search Grounding\nUse your built-in Google Search grounding for real-time information. Cite sources inline.',
      );
    }

    if (capabilities.thinking) {
      parts.push('## Thinking\nThink carefully and reason through problems before responding.');
    }

    for (const mod of modules) {
      // Prefer gemini variant, then strip XML from claude variant, then raw content
      let content =
        mod.variants?.gemini ??
        (mod.variants?.claude ? stripXml(mod.variants.claude) : mod.content);

      // Ensure no XML tags remain
      content = stripXml(content);

      // Format as markdown section
      const heading = mod.name
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      parts.push(`## ${heading}\n${content}`);
    }

    return parts.join('\n\n');
  }
}
