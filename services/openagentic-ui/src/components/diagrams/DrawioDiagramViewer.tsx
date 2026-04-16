/**
 * DrawioDiagramViewer - Renders draw.io/mxGraph XML diagrams inline in chat
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  ExternalLink,
  Copy,
  Check,
  Edit3,
  Maximize2,
  Minimize2,
  X,
  FileDown,
} from '@/shared/icons';

// ============================================================================
// Types
// ============================================================================

export interface DrawioDiagramViewerProps {
  xml: string;
  title?: string;
  height?: number;
  showControls?: boolean;
  onEdit?: (newXml: string) => void;
  onExport?: (format: 'drawio' | 'svg' | 'png') => void;
}

export interface DrawioMetadata {
  shapes?: Array<{
    id: string;
    type: string;
    label: string;
  }>;
  connections?: Array<{
    id: string;
    from: string;
    to: string;
  }>;
  provider?: string;
  diagram_type?: string;
}

// ============================================================================
// Hook for theme detection (same as ReactFlowDiagram)
// ============================================================================

const useThemeDetection = () => {
  const [isDark, setIsDark] = useState(true);
  // eslint-disable-next-line no-restricted-syntax -- Fallback color for initial state
  const [accentColor, setAccentColor] = useState('#0A84FF');

  useEffect(() => {
    const detectTheme = () => {
      const dataTheme = document.documentElement.getAttribute('data-theme');
      const hasLightClass = document.body.classList.contains('light-theme');
      const isLight = dataTheme === 'light' || hasLightClass;
      setIsDark(!isLight);

      const computedStyle = getComputedStyle(document.documentElement);
      const accent = computedStyle.getPropertyValue('--user-accent-primary').trim() ||
                     computedStyle.getPropertyValue('--color-primary').trim() ||
                     // eslint-disable-next-line no-restricted-syntax -- Fallback color
                     '#0A84FF';
      setAccentColor(accent);
    };

    detectTheme();

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  return { isDark, accentColor };
};

// ============================================================================
// Utility: Encode XML for draw.io URL
// ============================================================================

function encodeDrawioXml(xml: string): string {
  try {
    // Simple base64 encoding for draw.io (works without compression)
    // Draw.io accepts base64-encoded XML in the URL fragment
    const encoded = btoa(unescape(encodeURIComponent(xml)));
    // URL-safe base64 encoding
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    console.error('Failed to encode draw.io XML:', e);
    // Fallback
    return btoa(encodeURIComponent(xml));
  }
}

// ============================================================================
// Utility: Extract title from XML
// ============================================================================

function extractTitleFromXml(xml: string): string {
  const match = xml.match(/<diagram[^>]*name="([^"]+)"/);
  if (match) return match[1];
  return 'Diagram';
}

// ============================================================================
// Component Styles
// ============================================================================

const diagramStyles = `
  .drawio-diagram-container {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    background: var(--color-surface, #1e1e2e);
  }

  .drawio-diagram-container.light-mode {
    background: #ffffff;
    border-color: rgba(0, 0, 0, 0.1);
  }

  .drawio-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--color-surface-secondary, rgba(30, 30, 46, 0.95));
    border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  }

  .light-mode .drawio-toolbar {
    background: rgba(248, 250, 252, 0.95);
    border-bottom-color: rgba(0, 0, 0, 0.1);
  }

  .drawio-toolbar-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary, #f3f4f6);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .light-mode .drawio-toolbar-title {
    color: #1f2937;
  }

  .drawio-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .drawio-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-secondary, #9ca3af);
    transition: all 0.2s ease;
  }

  .drawio-action-btn:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.1));
    color: var(--text-primary, #f3f4f6);
  }

  .light-mode .drawio-action-btn:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #1f2937;
  }

  .drawio-iframe-container {
    position: relative;
    width: 100%;
    overflow: hidden;
  }

  .drawio-iframe {
    width: 100%;
    border: none;
    display: block;
  }

  .drawio-loading {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--color-surface, #1e1e2e);
    gap: 12px;
  }

  .light-mode .drawio-loading {
    background: #ffffff;
  }

  .drawio-loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-top-color: var(--user-accent-primary, #0A84FF);
    border-radius: 50%;
    animation: drawio-spin 0.8s linear infinite;
  }

  @keyframes drawio-spin {
    to { transform: rotate(360deg); }
  }

  .drawio-loading-text {
    font-size: 13px;
    color: var(--text-secondary, #9ca3af);
  }

  .drawio-fullscreen-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    flex-direction: column;
  }

  .drawio-fullscreen-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgba(30, 30, 46, 0.95);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .drawio-fullscreen-content {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .drawio-fullscreen-iframe {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 8px;
  }

  .drawio-export-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--color-surface, #1e1e2e);
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    padding: 4px;
    min-width: 140px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .light-mode .drawio-export-menu {
    background: #ffffff;
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .drawio-export-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--text-primary, #f3f4f6);
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: background 0.2s ease;
  }

  .drawio-export-option:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.1));
  }

  .light-mode .drawio-export-option {
    color: #1f2937;
  }

  .light-mode .drawio-export-option:hover {
    background: rgba(0, 0, 0, 0.05);
  }
`;

// ============================================================================
// DrawioDiagramViewer Component
// ============================================================================

export const DrawioDiagramViewer: React.FC<DrawioDiagramViewerProps> = ({
  xml,
  title,
  height = 450,
  showControls = true,
  onEdit,
  onExport,
}) => {
  const { isDark, accentColor } = useThemeDetection();
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Derive title from XML if not provided
  const diagramTitle = title || extractTitleFromXml(xml);

  // Build the draw.io viewer URL
  const viewerUrl = useMemo(() => {
    // Use draw.io's viewer embed with compressed XML
    const compressed = encodeDrawioXml(xml);
    // Using the draw.io viewer embed
    return `https://viewer.diagrams.net/?highlight=0000ff&nav=1&title=${encodeURIComponent(diagramTitle)}&lightbox=0&chrome=0&toolbar=0#R${compressed}`;
  }, [xml, diagramTitle]);

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  // Copy XML to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(xml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [xml]);

  // Open in draw.io editor
  const handleOpenInEditor = useCallback(() => {
    const compressed = encodeDrawioXml(xml);
    const editorUrl = `https://app.diagrams.net/?splash=0&ui=dark&title=${encodeURIComponent(diagramTitle)}#R${compressed}`;
    window.open(editorUrl, '_blank');
  }, [xml, diagramTitle]);

  // Export functions
  const handleExport = useCallback((format: 'drawio' | 'svg' | 'png') => {
    setShowExportMenu(false);

    if (format === 'drawio') {
      // Download as .drawio file (just the XML)
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${diagramTitle.replace(/[^a-z0-9]/gi, '_')}.drawio`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (format === 'svg' || format === 'png') {
      // For SVG/PNG, open draw.io export dialog
      const exportUrl = `https://app.diagrams.net/?format=${format}&title=${encodeURIComponent(diagramTitle)}#R${encodeDrawioXml(xml)}`;
      window.open(exportUrl, '_blank');
    }

    if (onExport) {
      onExport(format);
    }
  }, [xml, diagramTitle, onExport]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showExportMenu]);

  // Inject styles
  useEffect(() => {
    const styleId = 'drawio-diagram-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = diagramStyles;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`drawio-diagram-container ${!isDark ? 'light-mode' : ''}`}
      >
        {/* Toolbar */}
        {showControls && (
          <div className="drawio-toolbar">
            <div className="drawio-toolbar-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3h18v18H3z" />
                <path d="M3 9h18" />
                <path d="M9 3v18" />
              </svg>
              {diagramTitle}
            </div>
            <div className="drawio-toolbar-actions">
              <button
                className="drawio-action-btn"
                onClick={handleCopy}
                title="Copy XML"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button
                className="drawio-action-btn"
                onClick={handleOpenInEditor}
                title="Open in draw.io Editor"
              >
                <Edit3 size={16} />
              </button>
              <div style={{ position: 'relative' }} ref={exportMenuRef}>
                <button
                  className="drawio-action-btn"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  title="Export"
                >
                  <FileDown size={16} />
                </button>
                <AnimatePresence>
                  {showExportMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                      className={`drawio-export-menu ${!isDark ? 'light-mode' : ''}`}
                    >
                      <button
                        className="drawio-export-option"
                        onClick={() => handleExport('drawio')}
                      >
                        <Download size={14} /> .drawio
                      </button>
                      <button
                        className="drawio-export-option"
                        onClick={() => handleExport('svg')}
                      >
                        <Download size={14} /> SVG
                      </button>
                      <button
                        className="drawio-export-option"
                        onClick={() => handleExport('png')}
                      >
                        <Download size={14} /> PNG
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button
                className="drawio-action-btn"
                onClick={toggleFullscreen}
                title="Fullscreen"
              >
                <Maximize2 size={16} />
              </button>
              <button
                className="drawio-action-btn"
                onClick={handleOpenInEditor}
                title="Open in new tab"
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Diagram iframe container */}
        <div className="drawio-iframe-container" style={{ height }}>
          {isLoading && (
            <div className={`drawio-loading ${!isDark ? 'light-mode' : ''}`}>
              <div className="drawio-loading-spinner" style={{ borderTopColor: accentColor }} />
              <span className="drawio-loading-text">Loading diagram...</span>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={viewerUrl}
            className="drawio-iframe"
            style={{ height }}
            onLoad={handleIframeLoad}
            title={diagramTitle}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </motion.div>

      {/* Fullscreen overlay */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="drawio-fullscreen-overlay"
          >
            <div className="drawio-fullscreen-toolbar">
              <div className="drawio-toolbar-title" style={{ color: '#f3f4f6' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3h18v18H3z" />
                  <path d="M3 9h18" />
                  <path d="M9 3v18" />
                </svg>
                {diagramTitle}
              </div>
              <div className="drawio-toolbar-actions">
                <button
                  className="drawio-action-btn"
                  onClick={handleCopy}
                  title="Copy XML"
                  style={{ color: '#9ca3af' }}
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
                <button
                  className="drawio-action-btn"
                  onClick={handleOpenInEditor}
                  title="Open in draw.io Editor"
                  style={{ color: '#9ca3af' }}
                >
                  <Edit3 size={18} />
                </button>
                <button
                  className="drawio-action-btn"
                  onClick={toggleFullscreen}
                  title="Exit Fullscreen"
                  style={{ color: '#9ca3af' }}
                >
                  <Minimize2 size={18} />
                </button>
                <button
                  className="drawio-action-btn"
                  onClick={toggleFullscreen}
                  title="Close"
                  style={{ color: '#9ca3af' }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="drawio-fullscreen-content">
              <iframe
                src={viewerUrl}
                className="drawio-fullscreen-iframe"
                title={diagramTitle}
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// ============================================================================
// Utility: Parse draw.io result from MCP tool
// ============================================================================

export interface DrawioResult {
  success: boolean;
  type: 'drawio_diagram';
  xml: string;
  metadata?: DrawioMetadata;
  error?: string;
}

export function parseDrawioResult(result: unknown): DrawioResult | null {
  if (!result || typeof result !== 'object') return null;

  const r = result as Record<string, unknown>;

  if (r.type === 'drawio_diagram' && typeof r.xml === 'string') {
    return {
      success: r.success === true,
      type: 'drawio_diagram',
      xml: r.xml,
      metadata: r.metadata as DrawioMetadata | undefined,
      error: typeof r.error === 'string' ? r.error : undefined,
    };
  }

  return null;
}

// Default export
export default DrawioDiagramViewer;
