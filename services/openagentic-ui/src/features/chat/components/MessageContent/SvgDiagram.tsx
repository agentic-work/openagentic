import React, { useState, useCallback, useEffect } from 'react';
import { Code, Copy, Check, Download, AlertCircle } from '@/shared/icons';
import { motion } from 'framer-motion';
import { sanitizeSVG } from '@/utils/sanitize';

interface SvgDiagramProps {
  code: string;
  title?: string;
  className?: string;
  theme?: 'light' | 'dark';
}

const SvgDiagram: React.FC<SvgDiagramProps> = ({ code, title, className = '', theme = 'light' }) => {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [svgContent, setSvgContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processSvg = async () => {
      // If the code is already SVG, use it directly
      if (code.trim().startsWith('<svg')) {
        setSvgContent(code);
        return;
      }

      // Otherwise, try to generate SVG from description via API
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/render/svg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: code,
            theme: theme
          })
        });

        if (!response.ok) {
          // If API fails, just show the code
          throw new Error('SVG generation not available');
        }

        const data = await response.text();
        setSvgContent(data);
      } catch (err) {
        console.error('SVG generation failed:', err);
        // Fallback to showing code
        setError('SVG generation not available. Showing code instead.');
        setShowCode(true);
      } finally {
        setLoading(false);
      }
    };

    if (code) {
      processSvg();
    }
  }, [code, theme]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [code]);

  const handleExport = useCallback(async (format: 'svg' | 'png') => {
    try {
      if (format === 'svg' && svgContent) {
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${title || 'diagram'}.svg`;
        link.click();
        URL.revokeObjectURL(url);
      } else if (format === 'png' && svgContent) {
        // Convert SVG to PNG
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width || 800;
          canvas.height = img.height || 600;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${title || 'diagram'}.png`;
              link.click();
              URL.revokeObjectURL(url);
            }
          }, 'image/png');
        };
        img.src = 'data:image/svg+xml;base64,' + btoa(svgContent);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [svgContent, title]);

  // Render SVG content
  const renderSvg = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      );
    }

    if (svgContent) {
      // Sanitize SVG to prevent XSS attacks
      return <div dangerouslySetInnerHTML={{ __html: sanitizeSVG(svgContent) }} />;
    }

    return (
      <div className="flex items-center justify-center h-48">
        <div style={{ color: 'var(--color-textSecondary)' }}>
          No SVG content available
        </div>
      </div>
    );
  };

  if (error && !svgContent) {
    return (
      <div className="p-4 rounded-lg border bg-yellow-500/10 border-yellow-500/30 text-yellow-500">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold mb-1">SVG Rendering Notice</div>
            <div className="text-sm opacity-90">{error}</div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs opacity-75">View code</summary>
              <pre
              className="mt-2 p-2 rounded text-xs overflow-x-auto"
              style={{ backgroundColor: 'var(--color-background)' }}>
                {code}
              </pre>
            </details>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`my-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2">
        <h3
        className="font-semibold text-sm"
        style={{ color: 'var(--color-textSecondary)' }}>
          {title || 'SVG Diagram'}
        </h3>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCode(!showCode)}
            className={`p-1.5 rounded transition-all ${
              showCode
                ? 'bg-accent text-white'
                : 'hover:bg-bg-hover text-text-muted'
            }`}
            title={showCode ? "Show diagram" : "Show code"}
          >
            <Code size={14} />
          </button>

          <button
            onClick={handleCopy}
            className="p-1.5 rounded transition-all hover:bg-bg-hover text-text-muted"
            title="Copy SVG code"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>

          {svgContent && (
            <div className="relative group">
              <button
                className="p-1.5 rounded transition-all hover:bg-bg-hover text-text-muted"
                title="Export diagram"
              >
                <Download size={14} />
              </button>

              <div className="absolute right-0 mt-1 w-32 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all bg-bg-secondary border border-border">
                <button
                  onClick={() => handleExport('svg')}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-bg-hover transition-colors text-text-secondary"
                >
                  Export as SVG
                </button>
                <button
                  onClick={() => handleExport('png')}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-bg-hover transition-colors text-text-secondary"
                >
                  Export as PNG
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SVG or code display */}
      {showCode ? (
        <div className="p-4">
          <pre className="p-4 rounded-lg overflow-x-auto text-sm font-mono bg-bg-tertiary text-text-primary">
            <code>{code}</code>
          </pre>
        </div>
      ) : (
        <div
        className="rounded-lg p-4 flex items-center justify-center overflow-auto max-h-[600px]"
        style={{ backgroundColor: 'var(--color-surface)', minHeight: '200px' }}>
          {renderSvg()}
        </div>
      )}
    </motion.div>
  );
};

export default SvgDiagram;