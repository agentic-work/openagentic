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
