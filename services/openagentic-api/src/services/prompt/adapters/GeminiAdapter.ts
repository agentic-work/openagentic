/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
