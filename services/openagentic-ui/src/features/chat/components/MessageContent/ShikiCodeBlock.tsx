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

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { type BundledLanguage } from 'shiki';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, Check, Maximize2, Terminal, FileCode,
  Code2, Database, Settings, Braces, FileText, Play
} from '@/shared/icons';
import { useShiki } from '@/features/chat/hooks/useShiki';

interface ShikiCodeBlockProps {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  onCopy: (text: string) => void;
  copied?: boolean;
  onExpandToCanvas?: (code: string, language: string, filename?: string) => void;
  filename?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  singleLine?: boolean;
  className?: string;
  isInCanvas?: boolean; // Only show line numbers in Canvas mode
  isStreaming?: boolean; // When true, auto-scroll to follow code being written
  onExecute?: (code: string, language: string) => void;
  executable?: boolean;
}

// Language display names and icons - NO hardcoded colors, let CSS handle styling
const languageConfig: Record<string, { displayName: string; icon: React.ElementType }> = {
  javascript: { displayName: 'JavaScript', icon: Braces },
  typescript: { displayName: 'TypeScript', icon: Braces },
  python: { displayName: 'Python', icon: Code2 },
  java: { displayName: 'Java', icon: FileCode },
  csharp: { displayName: 'C#', icon: FileCode },
  cpp: { displayName: 'C++', icon: FileCode },
  go: { displayName: 'Go', icon: Code2 },
  rust: { displayName: 'Rust', icon: Settings },
  sql: { displayName: 'SQL', icon: Database },
  bash: { displayName: 'Bash', icon: Terminal },
  shell: { displayName: 'Shell', icon: Terminal },
  json: { displayName: 'JSON', icon: Braces },
  yaml: { displayName: 'YAML', icon: FileText },
  markdown: { displayName: 'Markdown', icon: FileText },
  html: { displayName: 'HTML', icon: Code2 },
  css: { displayName: 'CSS', icon: Code2 },
  jsx: { displayName: 'JSX', icon: Braces },
  tsx: { displayName: 'TSX', icon: Braces },
  dockerfile: { displayName: 'Docker', icon: FileCode },
  xml: { displayName: 'XML', icon: Code2 },
  php: { displayName: 'PHP', icon: Code2 },
  ruby: { displayName: 'Ruby', icon: Settings },
  swift: { displayName: 'Swift', icon: Code2 },
  kotlin: { displayName: 'Kotlin', icon: Code2 },
};

const ShikiCodeBlock: React.FC<ShikiCodeBlockProps> = ({
  code,
  language,
  theme,
  onCopy,
  copied,
  onExpandToCanvas,
  filename,
  showLineNumbers = false, // Default to false for chat messages
  highlightLines = [],
  singleLine = false,
  className = '',
  isInCanvas = false,
  isStreaming = false,
  onExecute,
  executable = false,
}) => {
  const { highlighter, isLoading } = useShiki();
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const [localCopied, setLocalCopied] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const prevCodeLengthRef = useRef<number>(0);

  // Auto-scroll to follow code during streaming
  useEffect(() => {
    if (!isStreaming || !codeContainerRef.current) return;

    // Only scroll if code is growing (new content being added)
    if (code.length > prevCodeLengthRef.current) {
      const container = codeContainerRef.current;
      // Scroll to bottom smoothly to follow the code being written
      container.scrollTop = container.scrollHeight;
    }
    prevCodeLengthRef.current = code.length;
  }, [code, isStreaming]);

  // Generate highlighted HTML
  // During streaming: show plain escaped code immediately (no Shiki flicker)
  // After streaming completes: apply full Shiki syntax highlighting
  const shikiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clean up debounce on unmount
    return () => {
      if (shikiDebounceRef.current) clearTimeout(shikiDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    // Determine the effective language - fallback to 'text' for missing/empty language
    const effectiveLanguage = language && language.trim() ? language : 'text';

    if (!highlighter || isLoading) {
      const lineCount = code.split('\n').length;
      const estimatedHeight = lineCount * 24;
      setHighlightedHtml(`<pre class="loading-code" style="min-height: ${estimatedHeight}px;"><code>${escapeHtml(code)}</code></pre>`);
      return;
    }

    const doHighlight = () => {
      try {
        const loadedLanguages = highlighter.getLoadedLanguages();
        let validLanguage: BundledLanguage;
        if (effectiveLanguage && loadedLanguages.includes(effectiveLanguage as BundledLanguage)) {
          validLanguage = effectiveLanguage as BundledLanguage;
        } else {
          const languageMap: Record<string, BundledLanguage> = {
            'js': 'javascript', 'ts': 'typescript', 'py': 'python',
            'sh': 'bash', 'yml': 'yaml', 'md': 'markdown',
            'text': 'javascript', 'plaintext': 'javascript', '': 'javascript'
          };
          const mappedLang = languageMap[effectiveLanguage];
          if (mappedLang && loadedLanguages.includes(mappedLang)) {
            validLanguage = mappedLang;
          } else {
            // Graceful fallback: render as plain text without Shiki to avoid crashes
            setHighlightedHtml(`<pre class="shiki-fallback"><code class="language-${effectiveLanguage}">${escapeHtml(code)}</code></pre>`);
            return;
          }
        }

        const html = highlighter.codeToHtml(code, {
          lang: validLanguage,
          theme: theme === 'dark' ? 'github-dark' : 'github-light'
        });

        if (!html.includes('style=')) {
          setHighlightedHtml(`<pre class="shiki-fallback"><code class="language-${effectiveLanguage}">${escapeHtml(code)}</code></pre>`);
        } else {
          setHighlightedHtml(html);
        }
      } catch (error) {
        // Graceful fallback on any Shiki error - show plain text instead of crashing
        console.warn('ShikiCodeBlock - Highlight failed, using plaintext fallback:', error);
        setHighlightedHtml(`<pre class="shiki-fallback"><code class="language-${effectiveLanguage}">${escapeHtml(code)}</code></pre>`);
      }
    };

    if (isStreaming) {
      // During streaming: plain text only, no shiki - eliminates flicker/glitch
      // Shiki runs once when streaming completes (isStreaming transitions to false)
      setHighlightedHtml(`<pre class="shiki-fallback streaming-code"><code class="language-${effectiveLanguage}">${escapeHtml(code)}</code></pre>`);
    } else {
      // Not streaming (or streaming just finished): highlight immediately
      if (shikiDebounceRef.current) clearTimeout(shikiDebounceRef.current);
      doHighlight();
    }
  }, [highlighter, code, language, theme, isStreaming, isLoading]);

  // Get language configuration - graceful fallback for missing/unknown languages
  const langConfig = useMemo(() => {
    const effectiveLang = language && language.trim() ? language : '';
    const config = languageConfig[effectiveLang] || {
      displayName: effectiveLang ? effectiveLang.charAt(0).toUpperCase() + effectiveLang.slice(1) : 'Code',
      icon: Code2,
    };
    return config;
  }, [language]);

  const Icon = langConfig.icon;

  // Handle copy with local state
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

  // Handle execute
  const handleExecute = async () => {
    if (!onExecute || !executable) return;
    setIsExecuting(true);
    try {
      await onExecute(code, language);
    } finally {
      setIsExecuting(false);
    }
  };

  // Single line styling with glass morphism
  if (singleLine || code.split('\n').length === 1) {
    return (
      <div 
        data-testid="code-block-container"
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-sm glass-dark border border-blue-500/20 shadow-lg hover:shadow-blue-500/20 transition-all duration-150 ${className}`}
      >
        <code>{code}</code>
        <button
          onClick={handleCopy}
          
          className="p-1.5 rounded-lg transition-all duration-150 hover:bg-white/10 hover:text-white hover:shadow-lg"
          style={{ color: 'var(--color-textMuted)' }}
          aria-label="Copy code"
        >
          {(localCopied || copied) ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
      </div>
    );
  }

  // Full code block - single clean container, no double-boxing
  return (
    <div
      data-testid="code-block-container"
      className={`group relative syntax-highlighted-code rounded-xl overflow-hidden transition-shadow ${className}`}
      style={{ background: '#1e1e2e', border: 'none' }}
    >
      {/* Floating toolbar - language label + actions overlaid on code */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="opacity-40" style={{ color: 'var(--color-textMuted)' }} />
          <span className="text-[11px] font-medium opacity-40" style={{ color: 'var(--color-textMuted)' }}>
            {filename || langConfig.displayName}
          </span>
        </div>

        {/* Action buttons - visible on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {executable && onExecute && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleExecute}
              disabled={isExecuting}
              className="p-1.5 rounded-md transition-colors hover:bg-white/10 text-white/40 hover:text-green-400 disabled:opacity-50"
              aria-label="Execute code"
            >
              {isExecuting ? (
                <div className="w-3.5 h-3.5 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
              ) : (
                <Play size={14} />
              )}
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCopy}
            className="p-1.5 rounded-md transition-colors hover:bg-white/10 text-white/40 hover:text-white/80"
            aria-label="Copy code"
          >
            <AnimatePresence mode="wait">
              {(localCopied || copied) ? (
                <motion.div key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <Check size={14} className="text-green-400" />
                </motion.div>
              ) : (
                <motion.div key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <Copy size={14} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>

      {/* Code content - single unified background, padding for floating toolbar */}
      <div
        ref={codeContainerRef}
        className={`relative overflow-x-auto pt-9 ${isStreaming ? 'max-h-96 overflow-y-auto' : ''}`}
      >
        {showLineNumbers && (
          <div className="absolute left-0 top-0 bottom-0 w-12 border-r bg-bg-tertiary/50 border-border/30"
          >
            {code.split('\n').map((_, index) => (
              <div
                key={index}
                className={`px-2 text-right text-xs leading-6 select-none ${
                  highlightLines.includes(index + 1)
                    ? 'text-accent-primary-primary'
                    : 'text-text-tertiary'
                }`}
              >
                {index + 1}
              </div>
            ))}
          </div>
        )}

        <div
          className={`syntax-highlighted-code ${
            showLineNumbers ? 'pl-14' : 'pl-4'
          } pr-4 py-4`}
          style={{
            fontSize: '0.875rem',
            lineHeight: '1.6',
          }}
          ref={(el) => {
            // Strip shiki's own background from <pre> so it doesn't create a double-frame
            if (el) {
              const pre = el.querySelector('pre');
              if (pre) {
                pre.style.background = 'transparent';
                pre.style.border = 'none';
                pre.style.margin = '0';
                pre.style.padding = '0';
              }
            }
          }}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />

        {/* Streaming cursor indicator */}
        {isStreaming && (
          <span
            className="absolute bottom-4 animate-pulse"
            style={{
              left: showLineNumbers ? '3.5rem' : '1rem',
              width: '2px',
              height: '1em',
              backgroundColor: 'var(--color-primary, #6366f1)',
            }}
          />
        )}

        {/* Highlight overlay for specific lines */}
        {highlightLines.length > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            {code.split('\n').map((_, index) => (
              highlightLines.includes(index + 1) && (
                <div
                  key={index}
                  data-testid={`code-line-${index + 1}`}
                  className="absolute left-0 right-0 h-6 highlighted bg-accent-primary-primary/10 border-l-2 border-accent-primary-primary"
                  style={{ top: `${index * 24}px` }}
                />
              )
            ))}
          </div>
        )}
      </div>

      {/* Copy confirmation toast */}
      <AnimatePresence>
        {(localCopied || copied) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-xs font-medium bg-theme-success text-theme-success-fg"
          >
            Copied!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export default ShikiCodeBlock;