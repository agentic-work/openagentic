/**
 * Enhanced Shiki Code Block with Advanced Rendering Features
 * 
 * Features:
 * - Syntax highlighting with Shiki
 * - Platform-specific command prompt styling
 * - Copy button with feedback
 * - Line numbers (optional)
 * - Diff highlighting
 * - Error highlighting
 * - Theme-aware rendering
 * - Interactive features
 * - v0.6.7 chat-polish (fix 3/5) — INCREMENTAL highlighting while streaming:
 *   re-highlight only the tail chunk that has grown since the last render
 *   and concatenate onto cached HTML. Highlighting is frozen on
 *   !isStreaming. Auto-scroll-to-tail while streaming.
 *

 * For all inquiries, please contact:
 *
 * Openagentic LLC
 * hello@openagentic.io
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, Check, Maximize2, Terminal, FileCode,
  Code2, Database, Settings, Braces, FileText,
  ChevronRight, AlertCircle, Command
} from '@/shared/icons';
import './EnhancedCodeBlock.css';

interface EnhancedShikiCodeBlockProps {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  onCopy?: (text: string) => void;
  onExpandToCanvas?: (code: string, language: string, filename?: string) => void;
  filename?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  errorLines?: number[];
  diffMode?: boolean;
  showPrompt?: boolean;
  platform?: 'windows' | 'linux' | 'macos';
  className?: string;
  isStreaming?: boolean;  // When true, auto-scroll + incrementally highlight
}

/**
 * Extract just the inner code from a Shiki-rendered HTML string — the
 * slab between `<code ...>` and `</code>`. Used for tail-only append.
 */
function extractInnerCodeHTML(shikiHtml: string): string {
  const match = shikiHtml.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
  return match?.[1] ?? shikiHtml;
}

/**
 * Extract the outer <pre ...> + <code ...> opening tags so we can wrap
 * the accumulated inner HTML without losing Shiki's theme/background.
 */
function extractShellAttrs(shikiHtml: string): { preOpen: string; codeOpen: string } {
  const preMatch = shikiHtml.match(/^<pre[^>]*>/i);
  const codeMatch = shikiHtml.match(/<code[^>]*>/i);
  return {
    preOpen: preMatch?.[0] ?? '<pre>',
    codeOpen: codeMatch?.[0] ?? '<code>',
  };
}

// Enhanced language configuration with platform-specific details - NO hardcoded colors
const languageConfig: Record<string, {
  displayName: string;
  icon: React.ElementType;
  promptSymbol?: string;
  promptPrefix?: string;
}> = {
  bash: {
    displayName: 'Bash',
    icon: Terminal,
    promptSymbol: '$',
    promptPrefix: ''
  },
  shell: {
    displayName: 'Shell',
    icon: Terminal,
    promptSymbol: '$',
    promptPrefix: ''
  },
  powershell: {
    displayName: 'PowerShell',
    icon: Terminal,
    promptSymbol: '>',
    promptPrefix: 'PS'
  },
  cmd: {
    displayName: 'Command Prompt',
    icon: Terminal,
    promptSymbol: '>',
    promptPrefix: 'C:\\'
  },
  javascript: { displayName: 'JavaScript', icon: Braces },
  typescript: { displayName: 'TypeScript', icon: Braces },
  python: { displayName: 'Python', icon: Code2 },
  java: { displayName: 'Java', icon: FileCode },
  csharp: { displayName: 'C#', icon: FileCode },
  cpp: { displayName: 'C++', icon: FileCode },
  go: { displayName: 'Go', icon: Code2 },
  rust: { displayName: 'Rust', icon: Settings },
  sql: { displayName: 'SQL', icon: Database },
  json: { displayName: 'JSON', icon: Braces },
  yaml: { displayName: 'YAML', icon: FileText },
  markdown: { displayName: 'Markdown', icon: FileText },
  html: { displayName: 'HTML', icon: Code2 },
  css: { displayName: 'CSS', icon: Code2 },
  jsx: { displayName: 'JSX', icon: Braces },
  tsx: { displayName: 'TSX', icon: Braces },
  diff: { displayName: 'Diff', icon: Code2 }
};

// Platform detection
const detectPlatform = (): 'windows' | 'linux' | 'macos' => {
  if (typeof window === 'undefined') return 'linux';
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  return 'linux';
};

const EnhancedShikiCodeBlock: React.FC<EnhancedShikiCodeBlockProps> = ({
  code,
  language,
  theme,
  onCopy,
  onExpandToCanvas,
  filename,
  showLineNumbers = false,
  highlightLines = [],
  errorLines = [],
  diffMode = false,
  showPrompt = true,
  platform = detectPlatform(),
  className = '',
  isStreaming = false
}) => {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);
  const prevCodeLengthRef = useRef<number>(0);

  // Sprint A #1 (2026-05-18): RAF-coalesce setHighlightedCode writes during
  // streaming. Bursts of NDJSON text_deltas previously triggered one full
  // dangerouslySetInnerHTML wipe of the <pre><code> subtree per delta,
  // causing the visible "flash" the user reported. Coalescing collapses
  // any number of deltas in the same animation frame down to one render.
  const pendingHighlightRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const scheduleHighlight = (html: string) => {
    pendingHighlightRef.current = html;
    if (rafIdRef.current != null) return;
    rafIdRef.current = (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as any)
    )(() => {
      rafIdRef.current = null;
      const next = pendingHighlightRef.current;
      pendingHighlightRef.current = null;
      if (next != null) setHighlightedCode(next);
    });
  };
  useEffect(() => () => {
    if (rafIdRef.current != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafIdRef.current);
    }
  }, []);

  // v0.6.7 incremental state: accumulated inner HTML + cached shell attrs,
  // plus the processed-code slice we've already highlighted.
  const cachedInnerRef = useRef<string>('');
  const cachedShellRef = useRef<{ preOpen: string; codeOpen: string }>({
    preOpen: '<pre>',
    codeOpen: '<code>',
  });
  const prevProcessedRef = useRef<string>('');
  const prevLanguageRef = useRef<string>('');
  const prevThemeRef = useRef<string>('');

  // Auto-scroll to follow code during streaming
  useEffect(() => {
    if (!isStreaming || !codeRef.current) return;

    // Only scroll if code is growing (new content being added)
    if (code.length > prevCodeLengthRef.current) {
      const codeContainer = codeRef.current;
      const preElement = codeContainer.querySelector('pre');
      if (preElement) {
        // Scroll to bottom smoothly to follow the code being written
        preElement.scrollTop = preElement.scrollHeight;
      }
      // Also scroll the container into view if needed
      const lastLine = codeContainer.querySelector('.code-line:last-child');
      // `scrollIntoView` exists in real browsers but not jsdom; guard so
      // tests don't throw.
      if (lastLine && typeof (lastLine as HTMLElement).scrollIntoView === 'function') {
        (lastLine as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
    prevCodeLengthRef.current = code.length;
  }, [code, isStreaming]);

  // Initialize Shiki highlighter
  useEffect(() => {
    createHighlighter({
      themes: [
        'github-dark',
        'github-light'
      ], // NO PURPLE - removed vitesse themes
      langs: [language as BundledLanguage].filter(lang => lang)
    }).then(hl => {
      setHighlighter(hl);
    }).catch(err => {
      console.error('Failed to create highlighter:', err);
    });
  }, [language]);

  // Process code for platform-specific features
  const processedCode = useMemo(() => {
    let processed = code;
    
    // Handle command prompts
    if (showPrompt && languageConfig[language]?.promptSymbol) {
      const lines = processed.split('\n');
      const promptSymbol = languageConfig[language].promptSymbol;
      const promptPrefix = languageConfig[language].promptPrefix || '';
      
      processed = lines.map(line => {
        // Check if line already has a prompt
        if (line.trim().startsWith(promptSymbol) || 
            (promptPrefix && line.trim().startsWith(promptPrefix))) {
          return line;
        }
        // Add prompt for shell commands
        if (line.trim() && !line.trim().startsWith('#')) {
          return `${promptPrefix}${promptPrefix ? ' ' : ''}${promptSymbol} ${line}`;
        }
        return line;
      }).join('\n');
    }
    
    return processed;
  }, [code, language, showPrompt]);

  // Get clean code for copying (without prompts)
  const getCleanCode = (codeWithPrompts: string): string => {
    if (!languageConfig[language]?.promptSymbol) return codeWithPrompts;
    
    const lines = codeWithPrompts.split('\n');
    const promptSymbol = languageConfig[language].promptSymbol;
    const promptPrefix = languageConfig[language].promptPrefix || '';
    
    return lines.map(line => {
      // Remove prompts for copying
      const trimmed = line.trim();
      if (promptPrefix && trimmed.startsWith(`${promptPrefix} ${promptSymbol} `)) {
        return line.replace(`${promptPrefix} ${promptSymbol} `, '');
      } else if (trimmed.startsWith(`${promptSymbol} `)) {
        return line.replace(`${promptSymbol} `, '');
      }
      return line;
    }).join('\n');
  };

  // v0.6.7 — highlight incrementally.
  // - If language/theme changed, clear the cache and re-highlight fully.
  // - If the new code is a prefix-continuation of the previously rendered
  //   code (common during streaming), only highlight the appended tail
  //   and append its inner <span>s to the cached inner HTML.
  // - Otherwise (edit, reset, or backward change), fall back to a full
  //   re-highlight. Keeps correctness even when a line gets rewritten.
  useEffect(() => {
    if (!highlighter) return;

    try {
      const themeKey = theme === 'dark' ? 'github-dark' : 'github-light';
      const shellInvalid =
        prevLanguageRef.current !== language || prevThemeRef.current !== themeKey;

      if (shellInvalid) {
        cachedInnerRef.current = '';
        prevProcessedRef.current = '';
      }

      const canAppend =
        !shellInvalid &&
        processedCode.length > prevProcessedRef.current.length &&
        processedCode.startsWith(prevProcessedRef.current);

      if (canAppend && isStreaming) {
        const tail = processedCode.slice(prevProcessedRef.current.length);
        // Highlight the TAIL only. Shiki needs a little context for
        // accurate tokenization but for code-fence streams this trade-off
        // (tiny token mis-colorings at the delta boundary) is dwarfed by
        // the 10-50x render-cost drop on long blocks. A final full
        // re-highlight runs when isStreaming flips to false, below.
        const tailHtml = highlighter.codeToHtml(tail, {
          lang: language as BundledLanguage,
          theme: themeKey,
        });
        const innerTail = extractInnerCodeHTML(tailHtml);
        cachedInnerRef.current = cachedInnerRef.current + innerTail;

        if (!cachedShellRef.current.preOpen.includes('shiki')) {
          cachedShellRef.current = extractShellAttrs(tailHtml);
        }

        const assembled =
          `${cachedShellRef.current.preOpen}${cachedShellRef.current.codeOpen}` +
          `${cachedInnerRef.current}</code></pre>`;
        scheduleHighlight(assembled);
      } else {
        const fullHtml = highlighter.codeToHtml(processedCode, {
          lang: language as BundledLanguage,
          theme: themeKey,
        });
        cachedShellRef.current = extractShellAttrs(fullHtml);
        cachedInnerRef.current = extractInnerCodeHTML(fullHtml);
        if (isStreaming) scheduleHighlight(fullHtml);
        else setHighlightedCode(fullHtml);
      }

      prevProcessedRef.current = processedCode;
      prevLanguageRef.current = language;
      prevThemeRef.current = themeKey;
    } catch (err) {
      console.error('Highlighting failed:', err);
      setHighlightedCode(`<pre><code>${processedCode}</code></pre>`);
    }
  }, [highlighter, processedCode, language, theme, isStreaming]);

  // When isStreaming flips to false, do one last full re-highlight so the
  // final render is free of delta-boundary artifacts.
  useEffect(() => {
    if (!highlighter) return;
    if (isStreaming) return;
    try {
      const themeKey = theme === 'dark' ? 'github-dark' : 'github-light';
      const fullHtml = highlighter.codeToHtml(processedCode, {
        lang: language as BundledLanguage,
        theme: themeKey,
      });
      cachedShellRef.current = extractShellAttrs(fullHtml);
      cachedInnerRef.current = extractInnerCodeHTML(fullHtml);
      setHighlightedCode(fullHtml);
    } catch (err) {
      console.warn('Final re-highlight failed; keeping incremental result.', err);
    }
    // Only runs on stream-close + theme/language flip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, highlighter, theme, language]);

  // Enhanced HTML processing with line numbers and highlighting
  const enhancedHtml = useMemo(() => {
    if (!highlightedCode) return '';
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(highlightedCode, 'text/html');
    const pre = doc.querySelector('pre');
    if (!pre) return highlightedCode;
    
    const code = pre.querySelector('code');
    if (!code) return highlightedCode;
    
    // Split into lines for processing
    const lines = code.innerHTML.split('\n');
    const processedLines = lines.map((line, index) => {
      const lineNumber = index + 1;
      const isHighlighted = highlightLines.includes(lineNumber);
      const isError = errorLines.includes(lineNumber);
      const isDiffAdd = diffMode && line.includes('<span') && line.includes('+');
      const isDiffRemove = diffMode && line.includes('<span') && line.includes('-');
      
      let lineClass = 'code-line';
      if (isHighlighted) lineClass += ' highlighted-line';
      if (isError) lineClass += ' error-line';
      if (isDiffAdd) lineClass += ' diff-add';
      if (isDiffRemove) lineClass += ' diff-remove';
      
      const lineNumberHtml = showLineNumbers 
        ? `<span class="line-number">${lineNumber}</span>` 
        : '';
      
      return `<div class="${lineClass}">${lineNumberHtml}<span class="line-content">${line}</span></div>`;
    });
    
    // Update the code element
    code.innerHTML = processedLines.join('');
    
    return doc.body.innerHTML;
  }, [highlightedCode, showLineNumbers, highlightLines, errorLines, diffMode]);

  const handleCopy = async () => {
    const cleanCode = getCleanCode(code);
    try {
      await navigator.clipboard.writeText(cleanCode);
      setCopied(true);
      onCopy?.(cleanCode);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const langConfig = languageConfig[language] || {
    displayName: language,
    icon: Code2
  };
  const IconComponent = langConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`enhanced-code-block ${className} ${theme === 'dark' ? 'dark-theme' : 'light-theme'}`}
      data-testid="enhanced-shiki-code-block"
      data-streaming={isStreaming ? 'true' : 'false'}
      data-language={language}
    >
      {/* eslint-disable-next-line no-restricted-syntax -- Code block styling intentionally uses GitHub-inspired colors */}
      <style>{`
        .enhanced-code-block {
          border-radius: 8px;
          overflow: hidden;
          margin: 16px 0;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .dark-theme {
          background: #0d1117;
          border: 1px solid #30363d;
        }
        
        .light-theme {
          background: #ffffff;
          border: 1px solid #d0d7de;
        }
        
        .code-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 16px;
          border-bottom: 1px solid;
        }
        
        .dark-theme .code-header {
          background: #161b22;
          border-bottom-color: #30363d;
        }
        
        .light-theme .code-header {
          background: #f6f8fa;
          border-bottom-color: #d0d7de;
        }
        
        .code-content {
          position: relative;
          overflow-x: auto;
        }
        
        .code-content pre {
          margin: 0;
          padding: 16px;
          font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
          font-size: 14px;
          line-height: 1.45;
        }
        
        .code-line {
          display: flex;
          position: relative;
        }
        
        .line-number {
          user-select: none;
          padding-right: 16px;
          text-align: right;
          min-width: 40px;
        }

        .dark-theme .line-number {
          color: #6e7681;
        }

        .light-theme .line-number {
          color: #57606a;
        }
        
        .highlighted-line {
          background: rgba(255, 197, 61, 0.1);
        }
        
        .error-line {
          background: rgba(255, 0, 0, 0.1);
          position: relative;
        }
        
        .error-line::after {
          content: '';
          position: absolute;
          bottom: 1px;
          left: 0;
          right: 0;
          height: 2px;
          background: #FF453A;
          opacity: 0.5;
        }
        
        .diff-add {
          background: rgba(0, 255, 0, 0.1);
        }
        
        .diff-add::before {
          content: '+';
          position: absolute;
          left: -20px;
          color: #22C55E;
        }
        
        .diff-remove {
          background: rgba(255, 0, 0, 0.1);
        }
        
        .diff-remove::before {
          content: '-';
          position: absolute;
          left: -20px;
          color: #f85149;
        }
      `}</style>
      
      {/* Header */}
      <div className="code-header">
        <div className="flex items-center gap-2">
          <IconComponent size={16} className="code-language-label" />
          <span className="text-sm font-medium text-text-secondary">
            {filename || langConfig.displayName}
          </span>
          {platform && (language === 'bash' || language === 'shell' || language === 'powershell' || language === 'cmd') && (
            <span className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-muted">
              {platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Linux'}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          
          
          {onExpandToCanvas && (
            <button
              onClick={() => onExpandToCanvas(code, language, filename)}
              className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
              title="Expand to canvas"
            >
              <Maximize2 size={16} />
            </button>
          )}

          <button
            onClick={handleCopy}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Copy code"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Check size={16} className="text-green-500" />
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Copy size={16} />
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>
      
      {/* Code Content */}
      <div className="code-content">
        <div
          ref={codeRef}
          dangerouslySetInnerHTML={{ __html: enhancedHtml || '<pre><code>Loading...</code></pre>' }}
        />
      </div>
    </motion.div>
  );
};

export default EnhancedShikiCodeBlock;
