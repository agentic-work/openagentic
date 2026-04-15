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

import { useState, useEffect } from 'react';
import { createHighlighter, type Highlighter } from 'shiki';

let globalHighlighter: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Shared Shiki highlighter hook
 * Uses a singleton pattern to avoid recreating the highlighter multiple times
 */
export function useShiki() {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(globalHighlighter);
  const [isLoading, setIsLoading] = useState(!globalHighlighter);

  useEffect(() => {
    // If we already have a highlighter, use it
    if (globalHighlighter) {
      setHighlighter(globalHighlighter);
      setIsLoading(false);
      return;
    }

    // If highlighter is already being created, wait for it
    if (highlighterPromise) {
      highlighterPromise.then(hl => {
        setHighlighter(hl);
        setIsLoading(false);
      });
      return;
    }

    // Create new highlighter (singleton)
    setIsLoading(true);
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'], // NO PURPLE - changed from vitesse-dark/light
      langs: [
        'javascript',
        'typescript',
        'python',
        'java',
        'csharp',
        'cpp',
        'go',
        'rust',
        'sql',
        'bash',
        'shell',
        'json',
        'yaml',
        'markdown',
        'html',
        'css',
        'jsx',
        'tsx',
        'dockerfile',
        'xml',
        'php',
        'ruby',
        'swift',
        'kotlin',
        'plaintext',
        'text'
      ]
    });

    highlighterPromise
      .then(hl => {
        globalHighlighter = hl;
        setHighlighter(hl);
        setIsLoading(false);
      })
      .catch(error => {
        console.error('Failed to create Shiki highlighter:', error);
        setIsLoading(false);
        highlighterPromise = null;
      });
  }, []);

  return { highlighter, isLoading };
}
