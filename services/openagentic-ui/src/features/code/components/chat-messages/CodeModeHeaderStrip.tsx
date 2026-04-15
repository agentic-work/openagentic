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

import React from 'react';
import { ThemeSelectorPill } from './ThemeSelectorPill';

interface CodeModeHeaderStripProps {
  sessionId: string | null;
}

export const CodeModeHeaderStrip: React.FC<CodeModeHeaderStripProps> = () => {
  return (
    <div
      className="shrink-0 flex items-center px-4 py-1 border-b"
      style={{
        fontFamily:
          'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
        fontSize: 11,
        color: 'var(--cm-text, #e6edf3)',
        backgroundColor: 'var(--cm-bg-secondary, #161b22)',
        borderColor: 'var(--cm-border, #30363d)',
        lineHeight: 1.4,
      }}
    >
      <ThemeSelectorPill />
    </div>
  );
};

export default CodeModeHeaderStrip;
