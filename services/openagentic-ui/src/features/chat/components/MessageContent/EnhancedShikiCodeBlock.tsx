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
  isStreaming?: boolean;  // When true, auto-scroll to follow code being written
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
      if (lastLine) {
        lastLine.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  // Highlight code with Shiki
  useEffect(() => {
    if (!highlighter) return;

    try {
      const highlighted = highlighter.codeToHtml(processedCode, {
        lang: language as BundledLanguage,
        theme: theme === 'dark' ? 'github-dark' : 'github-light'
      });
      setHighlightedCode(highlighted);
    } catch (err) {
      console.error('Highlighting failed:', err);
      setHighlightedCode(`<pre><code>${processedCode}</code></pre>`);
    }
  }, [highlighter, processedCode, language, theme]);

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
