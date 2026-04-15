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

import React, { useState } from 'react';
import { Copy, Check, Terminal, FileCode, ChevronDown, ChevronUp, Maximize2 } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';

interface EnhancedCodeBlockProps {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  filename?: string;
  onCopy: (code: string) => void;
  copied: boolean;
  collapsible?: boolean;
  maxHeight?: number;
  onExpandToCanvas?: (code: string, language: string, filename?: string) => void;
  executable?: boolean;
  onExecute?: (code: string, language: string) => void;
}

const EnhancedCodeBlock: React.FC<EnhancedCodeBlockProps> = ({
  code,
  language,
  theme,
  filename,
  onCopy,
  copied,
  collapsible = true,
  maxHeight = 400,
  onExpandToCanvas,
  executable = false,
  onExecute
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const lines = code.split('\n');
  const needsCollapse = lines.length > 15 && collapsible;
  const showLineNumbers = lines.length > 3;
  
  // Language normalization for Prism (using built-in languages only)
  const normalizeLanguage = (lang: string): string => {
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'sh': 'bash',
      'shell': 'bash',
      'yml': 'yaml',
      'rb': 'ruby'
    };
    const normalized = langMap[lang.toLowerCase()] || lang.toLowerCase();
    
    // Only use languages that are built into prism-react-renderer by default
    const supportedLanguages = [
      'javascript', 'typescript', 'python', 'bash', 'json', 'css', 'html', 'xml', 
      'markdown', 'yaml', 'sql', 'ruby', 'java', 'c', 'cpp', 'csharp', 'php', 'go'
    ];
    return supportedLanguages.includes(normalized) ? normalized : 'text';
  };
  
  const normalizedLanguage = normalizeLanguage(language);

  // NO hardcoded colors - let CSS handle styling
  const getLanguageClass = (lang: string) => {
    return 'code-language-label'; // Single semantic class, styled by CSS
  };
  
  const getLanguageIcon = (lang: string) => {
    if (['bash', 'shell', 'sh'].includes(lang.toLowerCase())) {
      return <Terminal size={14} />;
    }
    return <FileCode size={14} />;
  };
  
  const isExecutableLanguage = (lang: string) => {
    const executableLangs = ['python', 'javascript', 'typescript', 'bash', 'sql'];
    return executableLangs.includes(lang.toLowerCase());
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden shadow-lg border bg-bg-primary border-border-primary"
    >
      {/* Enhanced Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-bg-secondary border-border-primary">
        <div className="flex items-center gap-3">
          <span className={getLanguageClass(language)}>
            {getLanguageIcon(language)}
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">
              {filename || language.toUpperCase()}
            </span>
            <span className="text-xs text-text-secondary">
              {lines.length} lines • {code.length} characters
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Run button removed per user request - code blocks are display-only */}

          {/* Expand to canvas button - DISABLED per user request */}
          {/* {onExpandToCanvas && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onExpandToCanvas(code, language, filename)}
              className="p-1.5 rounded-lg transition-all hover:bg-bg-secondary text-text-secondary"
            >
              <Maximize2 size={14} />
            </motion.button>
          )} */}
          
          {/* Collapse button */}
          {needsCollapse && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-lg transition-all hover:bg-bg-secondary text-text-secondary"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </motion.button>
          )}
          
          {/* Copy button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onCopy(code)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
              copied
                ? 'bg-theme-success text-theme-success-fg'
                : 'hover:bg-bg-secondary text-text-secondary'
            }`}
          >
            {copied ? (
              <>
                <Check size={12} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy
              </>
            )}
          </motion.button>
        </div>
      </div>
      
      {/* Code content with professional highlighting */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div
              className="overflow-x-auto"
              style={{ maxHeight: needsCollapse ? maxHeight : undefined }}
            >
              <pre
                className="p-4 text-sm leading-relaxed bg-bg-tertiary text-text-primary m-0"
              >
                <div className="flex">
                  {showLineNumbers && (
                    <div className="select-none text-right pr-4 opacity-50">
                      {lines.map((_, i) => (
                        <div key={i} className="leading-relaxed text-xs">
                          {i + 1}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex-1">
                    <code>{code}</code>
                  </div>
                </div>
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Collapsed indicator */}
      {!isExpanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-4 py-3 text-xs text-center border-t text-text-secondary border-border-primary"
        >
          {lines.length} lines collapsed • Click expand to view
        </motion.div>
      )}
    </motion.div>
  );
};

export default EnhancedCodeBlock;