/**
 * Mermaid Diagram Renderer
 *
 * Renders Mermaid.js diagrams with theme support.
 * Supports all Mermaid diagram types: flowchart, sequence, class, etc.
 */

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { sanitizeSVG } from '@/utils/sanitize';

// Initialize Mermaid with default config
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict', // Enable Mermaid's built-in XSS protection
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
  },
  sequence: {
    useMaxWidth: true,
    diagramMarginX: 50,
    diagramMarginY: 10,
    actorMargin: 50,
    width: 150,
    height: 65,
    boxMargin: 10,
    boxTextMargin: 5,
    noteMargin: 10,
    messageMargin: 35,
  },
});

interface MermaidDiagramProps {
  /** Mermaid diagram definition */
  diagram: string;
  /** Additional CSS class */
  className?: string;
  /** Diagram height */
  height?: number | string;
  /** Theme override */
  theme?: 'light' | 'dark' | 'auto';
  /** Title for the diagram */
  title?: string;
}

// Hook to detect theme
const useThemeDetection = (): 'light' | 'dark' => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const detectTheme = () => {
      const dataTheme = document.documentElement.getAttribute('data-theme');
      const hasLightClass = document.body.classList.contains('light-theme');
      setTheme(dataTheme === 'light' || hasLightClass ? 'light' : 'dark');
    };

    detectTheme();

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  return theme;
};

// Get accent color from CSS variables
const getAccentColor = (): string => {
  // eslint-disable-next-line no-restricted-syntax -- Fallback color for SSR
  if (typeof window === 'undefined') return '#0A84FF';
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--user-accent-primary')
    // eslint-disable-next-line no-restricted-syntax -- Fallback color
    .trim() || '#0A84FF';
};

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({
  diagram,
  className = '',
  height = 400,
  theme: themeProp,
  title,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const detectedTheme = useThemeDetection();
  const effectiveTheme = themeProp === 'auto' ? detectedTheme : (themeProp || detectedTheme);

  useEffect(() => {
    const renderDiagram = async () => {
      if (!containerRef.current || !diagram.trim()) return;

      setLoading(true);
      setError(null);

      const accentColor = getAccentColor();

      // Configure Mermaid theme
      const themeConfig = effectiveTheme === 'dark' ? {
        theme: 'dark' as const,
        themeVariables: {
          primaryColor: accentColor,
          primaryTextColor: '#f8fafc',
          primaryBorderColor: `${accentColor}80`,
          lineColor: '#6b7280',
          secondaryColor: '#1e1e2e',
          tertiaryColor: '#27272a',
          background: '#0f0f17',
          mainBkg: '#1e1e2e',
          secondBkg: '#27272a',
          textColor: '#f8fafc',
          border1: '#3f3f46',
          border2: '#52525b',
          arrowheadColor: '#9ca3af',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          noteBkgColor: '#27272a',
          noteTextColor: '#f8fafc',
          actorBkg: '#1e1e2e',
          actorBorder: accentColor,
          actorTextColor: '#f8fafc',
          signalColor: '#9ca3af',
          signalTextColor: '#f8fafc',
        },
      } : {
        theme: 'default' as const,
        themeVariables: {
          primaryColor: accentColor,
          primaryTextColor: '#1f2937',
          primaryBorderColor: `${accentColor}60`,
          lineColor: '#6b7280',
          secondaryColor: '#f8fafc',
          tertiaryColor: '#f1f5f9',
          background: '#ffffff',
          mainBkg: '#ffffff',
          secondBkg: '#f8fafc',
          textColor: '#1f2937',
          border1: '#e5e7eb',
          border2: '#d1d5db',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
        },
      };

      try {
        // Update Mermaid config
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict', // Enable Mermaid's built-in XSS protection
          ...themeConfig,
        });

        // Generate unique ID
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Clear container
        containerRef.current.innerHTML = '';

        // Render diagram and sanitize output for defense-in-depth
        const { svg } = await mermaid.render(id, diagram);
        containerRef.current.innerHTML = sanitizeSVG(svg);

        // Style the SVG
        const svgElement = containerRef.current.querySelector('svg');
        if (svgElement) {
          svgElement.style.maxWidth = '100%';
          svgElement.style.height = 'auto';
          svgElement.style.display = 'block';
          svgElement.style.margin = '0 auto';
        }

        setLoading(false);
      } catch (err) {
        console.error('Mermaid render error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
        setLoading(false);
      }
    };

    renderDiagram();
  }, [diagram, effectiveTheme]);

  const isDark = effectiveTheme === 'dark';

  return (
    <div
      className={`mermaid-diagram glass-card overflow-hidden ${className}`}
      style={{
        minHeight: height,
        borderRadius: '12px',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {title && (
        <div
          className="px-4 py-3 border-b flex items-center gap-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: getAccentColor() }}
          />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </span>
        </div>
      )}

      <div className="p-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-current border-t-transparent rounded-full" style={{ color: getAccentColor() }} />
            <span className="ml-2 text-sm" style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
              Rendering diagram...
            </span>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg" style={{ backgroundColor: isDark ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2' }}>
            <p className="text-sm" style={{ color: '#ef4444' }}>
              Failed to render diagram: {error}
            </p>
            <pre className="mt-2 text-xs overflow-x-auto" style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
              {diagram.substring(0, 200)}...
            </pre>
          </div>
        )}

        <div
          ref={containerRef}
          className={loading ? 'hidden' : 'block'}
          style={{
            width: '100%',
            overflow: 'auto',
          }}
        />
      </div>
    </div>
  );
};

/**
 * Parse Mermaid code block from markdown
 */
export function extractMermaidCode(markdown: string): string | null {
  // Match ```mermaid ... ``` blocks
  const mermaidMatch = markdown.match(/```mermaid\s*([\s\S]*?)```/i);
  if (mermaidMatch) {
    return mermaidMatch[1].trim();
  }

  // Match standalone mermaid without code fence (if it looks like mermaid syntax)
  const lines = markdown.trim().split('\n');
  const firstLine = lines[0]?.trim().toLowerCase();
  if (
    firstLine.startsWith('graph') ||
    firstLine.startsWith('flowchart') ||
    firstLine.startsWith('sequencediagram') ||
    firstLine.startsWith('classDiagram') ||
    firstLine.startsWith('statediagram') ||
    firstLine.startsWith('erdiagram') ||
    firstLine.startsWith('journey') ||
    firstLine.startsWith('gantt') ||
    firstLine.startsWith('pie') ||
    firstLine.startsWith('gitgraph')
  ) {
    return markdown.trim();
  }

  return null;
}

/**
 * Check if content contains Mermaid diagram
 */
export function containsMermaid(content: string): boolean {
  return extractMermaidCode(content) !== null;
}

export default MermaidDiagram;
