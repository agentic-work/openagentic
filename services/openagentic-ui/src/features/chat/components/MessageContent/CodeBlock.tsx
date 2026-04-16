import React, { useState } from 'react';
import { Copy, Check, Terminal, FileCode, ChevronDown, ChevronUp } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';

interface CodeBlockProps {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  filename?: string;
  onCopy: (code: string) => void;
  copied: boolean;
  collapsible?: boolean;
  maxHeight?: number;
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  theme,
  filename,
  onCopy,
  copied,
  collapsible = true,
  maxHeight = 400
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(code.split('\n').length > 5);
  
  const lines = code.split('\n');
  const needsCollapse = lines.length > 20 && collapsible;
  
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
  
  const syntaxHighlight = (code: string, language: string) => {
    // Simple syntax highlighting for common patterns
    // In production, you'd use a library like Prism.js or highlight.js
    
    if (language === 'json') {
      return code
        .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
        .replace(/:\s*"([^"]+)"/g, ': <span class="json-string">"$1"</span>')
        .replace(/:\s*(\d+)/g, ': <span class="json-number">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span class="json-boolean">$1</span>');
    }
    
    // Basic highlighting for other languages
    return code
      .replace(/\/\/(.*)/g, '<span class="comment">//$1</span>') // Comments
      .replace(/(const|let|var|function|return|if|else|for|while)\b/g, '<span class="keyword">$1</span>') // Keywords
      .replace(/'([^']+)'/g, '<span class="string">\'$1\'</span>') // Single quotes
      .replace(/"([^"]+)"/g, '<span class="string">"$1"</span>'); // Double quotes
  };
  
  return (
    <div className="rounded-lg overflow-hidden bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-bg-tertiary border-border-primary">
        <div className="flex items-center gap-2">
          <span className={getLanguageClass(language)}>
            {getLanguageIcon(language)}
          </span>
          <span className="text-xs font-mono text-text-secondary">
            {filename || language}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {needsCollapse && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded hover:bg-bg-secondary"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
          
          <button
            onClick={() => onCopy(code)}
            className={`relative flex items-center gap-1 px-2 py-1 rounded text-xs transition-all duration-150 ${
              copied
                ? 'bg-theme-success/20 text-theme-success'
                : 'hover:bg-bg-secondary text-text-secondary hover:text-text-primary'
            }`}
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0, rotate: 180 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex items-center gap-1"
                >
                  <Check size={14} />
                  <span>Copied!</span>
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0, rotate: 180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0, rotate: -180 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex items-center gap-1"
                >
                  <Copy size={14} />
                  <span>Copy</span>
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>
      
      {/* Code content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div 
              className="overflow-x-auto"
              style={{ maxHeight: needsCollapse ? maxHeight : undefined }}
            >
              <table className="w-full">
                <tbody>
                  {lines.map((line, index) => (
                    <tr
                      key={index}
                      className="group transition-colors duration-150 hover:bg-bg-tertiary/50"
                    >
                      {showLineNumbers && (
                        <td className="select-none text-right pr-4 pl-4 py-0 text-text-tertiary group-hover:text-text-secondary transition-colors duration-150">
                          <span className="text-xs">{index + 1}</span>
                        </td>
                      )}
                      <td className="pr-4 py-0">
                        <pre className="text-sm font-mono text-text-primary">
                          <code
                            dangerouslySetInnerHTML={{
                              __html: syntaxHighlight(line || ' ', language)
                            }}
                          />
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Collapsed indicator */}
      {!isExpanded && (
        <div className="px-4 py-2 text-xs text-center text-text-secondary">
          {lines.length} lines collapsed • Click to expand
        </div>
      )}
      
      <style dangerouslySetInnerHTML={{ __html: `
        .keyword { 
          color: var(--accent-primary-primary); 
          font-weight: 600;
        }
        .string { 
          color: var(--theme-success); 
        }
        .comment { 
          color: var(--text-tertiary); 
          font-style: italic;
        }
        .json-key { 
          color: var(--theme-info); 
        }
        .json-string { 
          color: var(--theme-success); 
        }
        .json-number { 
          color: var(--theme-warning); 
        }
        .json-boolean { 
          color: var(--accent-primary-primary); 
        }
      `}} />
    </div>
  );
};

export default CodeBlock;
