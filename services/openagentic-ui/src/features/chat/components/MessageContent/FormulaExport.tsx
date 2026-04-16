/**
 * Formula Export Component
 * Provides export capabilities for KaTeX-rendered mathematical formulas
 */

import React, { useRef, useCallback, useState } from 'react';
import { Download, Copy, Check } from '@/shared/icons';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface FormulaExportProps {
  latex: string;
  displayMode?: boolean;
  theme?: 'light' | 'dark';
}

const FormulaExport: React.FC<FormulaExportProps> = ({
  latex,
  displayMode = false,
  theme = 'light'
}) => {
  const formulaRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Render the formula using KaTeX
  const renderedFormula = React.useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        output: 'html'
      });
    } catch (err) {
      console.error('KaTeX rendering error:', err);
      return `<span class="katex-error">${latex}</span>`;
    }
  }, [latex, displayMode]);

  // Copy LaTeX to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [latex]);

  // Export formula as PNG
  const handleExportPNG = useCallback(async () => {
    if (!formulaRef.current) return;

    setExporting(true);
    try {
      // Get the rendered formula element
      const formulaElement = formulaRef.current.querySelector('.katex');
      if (!formulaElement) {
        throw new Error('Formula element not found');
      }

      // Create a canvas with the formula
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      // Get the dimensions of the formula
      const bbox = formulaElement.getBoundingClientRect();
      const scale = 2; // 2x for better quality
      canvas.width = bbox.width * scale;
      canvas.height = bbox.height * scale;

      // Set background color based on theme
      ctx.fillStyle = theme === 'dark' ? '#1a1a1a' : '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Create an SVG with the formula HTML
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${bbox.width}" height="${bbox.height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: 16px; color: ${theme === 'dark' ? '#ffffff' : '#000000'};">
              ${renderedFormula}
            </div>
          </foreignObject>
        </svg>
      `;

      // Convert SVG to image
      const img = new Image();
      img.onload = () => {
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        // Convert canvas to blob and download
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'formula.png';
            link.click();
            URL.revokeObjectURL(url);
          }
          setExporting(false);
        }, 'image/png');
      };

      img.onerror = () => {
        console.error('Failed to load formula image');
        setExporting(false);
      };

      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    } catch (err) {
      console.error('Export failed:', err);
      setExporting(false);
    }
  }, [renderedFormula, theme]);

  // Export formula as SVG
  const handleExportSVG = useCallback(async () => {
    if (!formulaRef.current) return;

    try {
      const formulaElement = formulaRef.current.querySelector('.katex');
      if (!formulaElement) {
        throw new Error('Formula element not found');
      }

      const bbox = formulaElement.getBoundingClientRect();
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bbox.width}" height="${bbox.height}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: 16px; color: ${theme === 'dark' ? '#ffffff' : '#000000'};">
      ${renderedFormula}
    </div>
  </foreignObject>
</svg>`;

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'formula.svg';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [renderedFormula, theme]);

  return (
    <div className="inline-flex items-center gap-2 group">
      {/* Rendered Formula */}
      <div
        ref={formulaRef}
        className="formula-container"
        dangerouslySetInnerHTML={{ __html: renderedFormula }}
      />

      {/* Export Controls - shown on hover */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <button
          onClick={handleCopy}
          className="p-1 rounded transition-all hover:bg-bg-hover text-text-muted"
          title="Copy LaTeX"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>

        <div className="relative group/export">
          <button
            className="p-1 rounded transition-all hover:bg-bg-hover text-text-muted"
            title="Export formula"
            disabled={exporting}
          >
            <Download size={12} />
          </button>

          <div className="absolute left-0 mt-1 w-32 rounded-lg shadow-lg opacity-0 invisible group-hover/export:opacity-100 group-hover/export:visible transition-all z-10 bg-bg-secondary border border-border">
            <button
              onClick={handleExportSVG}
              className="w-full px-3 py-2 text-left text-xs hover:bg-bg-hover transition-colors text-text-secondary"
            >
              Export as SVG
            </button>
            <button
              onClick={handleExportPNG}
              disabled={exporting}
              className="w-full px-3 py-2 text-left text-xs hover:bg-bg-hover transition-colors text-text-secondary"
            >
              {exporting ? 'Exporting...' : 'Export as PNG'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FormulaExport;
