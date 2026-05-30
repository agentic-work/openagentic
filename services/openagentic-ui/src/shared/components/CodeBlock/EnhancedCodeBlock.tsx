import React, { useState, useEffect, useRef } from 'react';
import { Check, Copy } from '@/shared/icons';

// Simple syntax highlighting without external dependencies
const syntaxHighlight = (code: string, language: string): string => {
  // Basic syntax highlighting patterns
  const patterns: Record<string, Array<{pattern: RegExp, className: string}>> = {
    javascript: [
      { pattern: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|async|await|import|export|from|class|extends|static|get|set|try|catch|finally|throw|typeof|instanceof|in|of|void|null|undefined|true|false)\b/g, className: 'token keyword' },
      { pattern: /\b(console|window|document|Math|JSON|Object|Array|String|Number|Boolean|Date|RegExp|Error|Promise)\b/g, className: 'token builtin' },
      { pattern: /\b\d+(\.\d+)?\b/g, className: 'token number' },
      { pattern: /(["'])(?:(?=(\\?))\2.)*?\1/g, className: 'token string' },
      { pattern: /\/\/.*$/gm, className: 'token comment' },
      { pattern: /\/\*[\s\S]*?\*\//g, className: 'token comment' },
      { pattern: /\b[A-Z][a-zA-Z0-9_]*\b/g, className: 'token class-name' },
      { pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/g, className: 'token function' },
    ],
    typescript: [
      { pattern: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|async|await|import|export|from|class|extends|static|get|set|try|catch|finally|throw|typeof|instanceof|in|of|void|null|undefined|true|false|type|interface|enum|namespace|module|declare|abstract|implements|private|protected|public|readonly)\b/g, className: 'token keyword' },
      { pattern: /\b(console|window|document|Math|JSON|Object|Array|String|Number|Boolean|Date|RegExp|Error|Promise)\b/g, className: 'token builtin' },
      { pattern: /\b\d+(\.\d+)?\b/g, className: 'token number' },
      { pattern: /(["'])(?:(?=(\\?))\2.)*?\1/g, className: 'token string' },
      { pattern: /\/\/.*$/gm, className: 'token comment' },
      { pattern: /\/\*[\s\S]*?\*\//g, className: 'token comment' },
      { pattern: /\b[A-Z][a-zA-Z0-9_]*\b/g, className: 'token class-name' },
      { pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/g, className: 'token function' },
    ],
    python: [
      { pattern: /\b(def|class|import|from|as|if|elif|else|for|while|break|continue|return|yield|try|except|finally|raise|pass|with|lambda|global|nonlocal|del|is|not|and|or|in|True|False|None)\b/g, className: 'token keyword' },
      { pattern: /\b(print|len|range|str|int|float|list|dict|set|tuple|bool|type|isinstance|hasattr|getattr|setattr|delattr|input|open|file|help)\b/g, className: 'token builtin' },
      { pattern: /\b\d+(\.\d+)?\b/g, className: 'token number' },
      { pattern: /(["'])(?:(?=(\\?))\2.)*?\1/g, className: 'token string' },
      { pattern: /#.*$/gm, className: 'token comment' },
      { pattern: /\b[A-Z][a-zA-Z0-9_]*\b/g, className: 'token class-name' },
      { pattern: /\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, className: 'token function' },
    ],
    go: [
      { pattern: /\b(package|import|func|var|const|type|struct|interface|map|chan|if|else|for|range|switch|case|default|break|continue|return|defer|go|select|fallthrough)\b/g, className: 'token keyword' },
      { pattern: /\b(string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|bool|byte|rune|error|nil|true|false|iota)\b/g, className: 'token builtin' },
      { pattern: /\b\d+(\.\d+)?\b/g, className: 'token number' },
      { pattern: /(["'`])(?:(?=(\\?))\2.)*?\1/g, className: 'token string' },
      { pattern: /\/\/.*$/gm, className: 'token comment' },
      { pattern: /\/\*[\s\S]*?\*\//g, className: 'token comment' },
      { pattern: /\b[A-Z][a-zA-Z0-9_]*\b/g, className: 'token class-name' },
    ],
    sql: [
      { pattern: /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNIQUE|NOT|NULL|DEFAULT|AUTO_INCREMENT|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|ON|AS|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|AND|OR|IN|EXISTS|BETWEEN|LIKE|IS)\b/gi, className: 'token keyword' },
      { pattern: /\b\d+(\.\d+)?\b/g, className: 'token number' },
      { pattern: /(["'])(?:(?=(\\?))\2.)*?\1/g, className: 'token string' },
      { pattern: /--.*$/gm, className: 'token comment' },
    ],
  };

  // Default patterns for unknown languages
  const defaultPatterns = [
    { pattern: /\b\d+(\.\d+)?\b/g, className: 'token number' },
    { pattern: /(["'])(?:(?=(\\?))\2.)*?\1/g, className: 'token string' },
    { pattern: /\/\/.*$/gm, className: 'token comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'token comment' },
    { pattern: /#.*$/gm, className: 'token comment' },
  ];

  const languagePatterns = patterns[language] || defaultPatterns;
  let highlighted = code;

  // Escape HTML
  highlighted = highlighted
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply syntax highlighting
  languagePatterns.forEach(({ pattern, className }) => {
    highlighted = highlighted.replace(pattern, (match) => `<span class="${className}">${match}</span>`);
  });

  return highlighted;
};

interface EnhancedCodeBlockProps {
  code: string;
  language?: string;
  theme?: 'light' | 'dark';
  showLineNumbers?: boolean;
  isStreaming?: boolean;
}

const EnhancedCodeBlock: React.FC<EnhancedCodeBlockProps> = ({
  code,
  language = 'plaintext',
  theme = 'dark',
  showLineNumbers = false,
  isStreaming = false
}) => {
  const [copied, setCopied] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState('');
  const codeRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Normalize language names
  const normalizeLanguage = (lang: string): string => {
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'yml': 'yaml',
      'sh': 'bash',
      'shell': 'bash',
      'json5': 'json',
      'jsonc': 'json',
      'c++': 'cpp',
      'c#': 'csharp',
      'objective-c': 'objectivec',
      'obj-c': 'objectivec',
      'html': 'markup',
      'xml': 'markup',
      'svg': 'markup'
    };
    
    const normalized = lang.toLowerCase();
    return languageMap[normalized] || normalized;
  };

  const normalizedLanguage = normalizeLanguage(language);

  // Apply syntax highlighting
  useEffect(() => {
    if (!code) return;

    // Debounce highlighting for streaming
    if (isStreaming) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        highlightCode();
      }, 100);
    } else {
      highlightCode();
    }

    function highlightCode() {
      try {
        const highlighted = syntaxHighlight(code, normalizedLanguage);
        setHighlightedCode(highlighted);
      } catch (error) {
        console.error('Syntax highlighting error:', error);
        // Fallback to escaped HTML
        const escaped = code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        setHighlightedCode(escaped);
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [code, normalizedLanguage, isStreaming]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const lines = code.split('\n');
  const shouldShowLineNumbers = showLineNumbers || lines.length > 10;

  return (
    <>
      <style>{`
        .token.keyword { font-weight: bold; }
        .token.builtin { }
        .token.function { }
        .token.class-name { }
        .token.string { }
        .token.number { }
        .token.comment { font-style: italic; }
        
        /* Theme-aware token colors */
        :root.dark .token.keyword { color: rgb(var(--color-info)); }
        :root.dark .token.builtin { color: rgb(var(--color-success)); }
        :root.dark .token.function { color: rgb(var(--color-info)); }
        :root.dark .token.class-name { color: rgb(var(--color-warning)); }
        :root.dark .token.string { color: rgb(var(--color-success)); }
        :root.dark .token.number { color: rgb(var(--color-warning)); }
        :root.dark .token.comment { color: var(--text-muted); }

        :root.light .token.keyword { color: rgb(var(--color-info)); }
        :root.light .token.builtin { color: rgb(var(--color-info)); }
        :root.light .token.function { color: rgb(var(--color-info)); }
        :root.light .token.class-name { color: rgb(var(--color-warning)); }
        :root.light .token.string { color: rgb(var(--color-success)); }
        :root.light .token.number { color: rgb(var(--color-warning)); }
        :root.light .token.comment { color: var(--text-muted); }
      `}</style>
      <div className={`code-block-wrapper relative rounded-lg overflow-hidden ${
        'bg-bg-secondary'
      }`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${
        'bg-bg-tertiary border-border-primary'
      }`}>
        <span className={`language-label text-xs font-mono ${
          'text-text-muted'
        }`}>
          {normalizedLanguage}
        </span>
        <button
          onClick={handleCopy}
          className={`copy-button flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${
            'hover:bg-bg-secondary text-text-muted hover:text-text-secondary'
          }`}
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <div className="relative overflow-x-auto">
        <pre className={`p-4 m-0 text-sm ${
          'bg-bg-secondary'
        }`}>
          {shouldShowLineNumbers && (
            <span className={`line-numbers select-none inline-block mr-4 text-right ${
              'text-text-muted'
            }`}>
              {lines.map((_, i) => (
                <span key={i} className="line-number block">
                  {i + 1}
                </span>
              ))}
            </span>
          )}
          <code
            ref={codeRef}
            className={`language-${normalizedLanguage} ${
              'text-text-primary'
            }`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
      </div>

      {/* Loading indicator for streaming */}
      {isStreaming && (
        <div className="absolute bottom-2 right-2">
          <div className="flex space-x-1">
            <div className="w-1 h-1 bg-info rounded-full animate-pulse"></div>
            <div className="w-1 h-1 bg-info rounded-full animate-pulse delay-75"></div>
            <div className="w-1 h-1 bg-info rounded-full animate-pulse delay-150"></div>
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default EnhancedCodeBlock;