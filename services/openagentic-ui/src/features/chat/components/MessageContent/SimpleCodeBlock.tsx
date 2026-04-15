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

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, Play } from '@/shared/icons';
import { Highlight, themes } from 'prism-react-renderer';

interface SimpleCodeBlockProps {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  onCopy: (text: string) => void;
  copied?: boolean;
  className?: string;
  isStreaming?: boolean;  // When true, auto-scroll to follow code being written
  onExecute?: (code: string, language: string) => void;
  executable?: boolean;
}

// Throttle interval for syntax highlighting during streaming (ms)
const HIGHLIGHT_THROTTLE_MS = 500;
// Code length threshold - only throttle for larger code blocks
const THROTTLE_CODE_LENGTH = 200;

/**
 * Simple, non-glitchy code block component
 * Uses synchronous Prism syntax highlighting (no async operations)
 * Inspired by Gemini's approach - instant rendering with proper syntax colors
 *
 * PERFORMANCE OPTIMIZATION:
 * During streaming, syntax highlighting is throttled for large code blocks
 * to prevent UI freezing. Full highlighting is applied after streaming completes.
 */
const SimpleCodeBlock: React.FC<SimpleCodeBlockProps> = ({
  code,
  language,
  theme,
  onCopy,
  copied,
  className = '',
  isStreaming = false,
  onExecute,
  executable = false
}) => {
  const [localCopied, setLocalCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const prevCodeLengthRef = useRef<number>(0);
  const lastHighlightTimeRef = useRef<number>(0);
  const [throttledCode, setThrottledCode] = useState(code);

  // Throttle code updates during streaming for large code blocks
  useEffect(() => {
    if (!isStreaming || code.length < THROTTLE_CODE_LENGTH) {
      // Not streaming or code is small - update immediately
      setThrottledCode(code);
      return;
    }

    // During streaming with large code blocks, throttle updates
    const now = Date.now();
    if (now - lastHighlightTimeRef.current >= HIGHLIGHT_THROTTLE_MS) {
      setThrottledCode(code);
      lastHighlightTimeRef.current = now;
    }
  }, [code, isStreaming]);

  // When streaming ends, ensure we have the final code
  useEffect(() => {
    if (!isStreaming) {
      setThrottledCode(code);
    }
  }, [isStreaming, code]);

  // Auto-scroll to follow code during streaming
  useEffect(() => {
    if (!isStreaming || !preRef.current) return;

    // Only scroll if code is growing (new content being added)
    if (code.length > prevCodeLengthRef.current) {
      const preElement = preRef.current;
      // Scroll to bottom smoothly to follow the code being written
      preElement.scrollTop = preElement.scrollHeight;
    }
    prevCodeLengthRef.current = code.length;
  }, [code, isStreaming]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      onCopy(code);
      setLocalCopied(true);
      setTimeout(() => setLocalCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  

  // Get language display name
  const getLanguageDisplay = (lang: string): string => {
    const languageMap: Record<string, string> = {
      javascript: 'JavaScript',
      typescript: 'TypeScript',
      python: 'Python',
      java: 'Java',
      csharp: 'C#',
      cpp: 'C++',
      go: 'Go',
      rust: 'Rust',
      sql: 'SQL',
      bash: 'Bash',
      shell: 'Shell',
      json: 'JSON',
      yaml: 'YAML',
      markdown: 'Markdown',
      html: 'HTML',
      css: 'CSS',
      jsx: 'JSX',
      tsx: 'TSX'
    };
    return languageMap[lang.toLowerCase()] || lang.toUpperCase();
  };

  return (
    <div
      data-testid="code-block-container"
      className={`group relative rounded-lg overflow-hidden border bg-bg-secondary border-border ${className}`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b bg-bg-tertiary border-border/50"
      >
        <span className="text-xs font-medium text-text-muted">
          {getLanguageDisplay(language)}
        </span>

        <div className="flex items-center gap-1">
          {/* Execute button */}
          {executable && onExecute && (
            <button
              onClick={() => onExecute(code, language)}
              className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-green-500"
              aria-label="Execute code"
            >
              <Play size={16} />
            </button>
          )}
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            aria-label="Copy code"
          >
          <AnimatePresence mode="wait">
            {(localCopied || copied) ? (
              <motion.div
                key="check"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Check size={16} className="text-green-500" />
              </motion.div>
            ) : (
              <motion.div
                key="copy"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Copy size={16} />
              </motion.div>
            )}
          </AnimatePresence>
        </button>
        </div>
      </div>

      {/* Code content with synchronous Prism highlighting
          Uses throttledCode during streaming for performance */}
      <Highlight
        theme={theme === 'dark' ? themes.vsDark : themes.vsLight}
        code={throttledCode}
        language={language as any}
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            ref={preRef}
            className={`${className} overflow-x-auto p-4 m-0 ${isStreaming ? 'max-h-96 overflow-y-auto' : ''}`}
            style={{
              ...style,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '0.875rem',
              lineHeight: '1.6',
              tabSize: 2,
              margin: 0,
              // Smooth height transitions during streaming
              transition: isStreaming ? 'height 0.1s ease-out' : undefined,
              willChange: isStreaming ? 'height, scroll-position' : undefined,
            }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
            {/* Streaming cursor indicator */}
            {isStreaming && (
              <span
                className="inline-block animate-pulse"
                style={{
                  width: '2px',
                  height: '1em',
                  backgroundColor: 'var(--color-primary, #6366f1)',
                  marginLeft: '2px',
                  verticalAlign: 'middle',
                }}
              />
            )}
          </pre>
        )}
      </Highlight>

      {/* Copy confirmation toast */}
      <AnimatePresence>
        {(localCopied || copied) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-xs font-medium bg-green-500 text-white"
          >
            Copied!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SimpleCodeBlock;
