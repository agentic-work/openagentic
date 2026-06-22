import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import 'katex/dist/katex.min.css';
// sanitizeMarkdown removed - module no longer exists, sanitization handled by rehype-sanitize

// Custom schema that allows KaTeX elements and image:// protocol
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // KaTeX specific elements
    'math', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msqrt',
    'mroot', 'mfrac', 'mover', 'munder', 'munderover', 'msup', 'msub',
    'msubsup', 'mtable', 'mtr', 'mtd', 'semantics', 'annotation',
    // Span with classes for KaTeX
    'span'
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'class', 'style'],
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel']
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'image']
  }
};
import { onKeyActivate } from '@/utils/a11y';
import { AlertCircle, Info, CheckCircle, XCircle, Copy, Check, ChevronDown, ChevronRight, Activity } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';
import ShikiCodeBlock from './ShikiCodeBlock';
// import EnhancedShikiCodeBlock from './EnhancedShikiCodeBlock';
import MCPCallDisplay from '../MCPCallDisplay';
import DataVisualization from './DataVisualization';
import MetricCard from './MetricCard';
import CalloutBox from './CalloutBox';
import SvgDiagram from './SvgDiagram';
import ReactFlowDiagram from '@/components/diagrams/ReactFlowDiagram';
import { DrawioDiagramViewer } from '@/components/diagrams/DrawioDiagramViewer';
import ChartRenderer from './ChartRenderer';
import { ChatMessage } from '@/types/index';
import ImageViewer from '../ImageViewer';

interface MessageContentProps {
  message: ChatMessage;
  theme: 'light' | 'dark';
}

interface ParsedContent {
  type: 'text' | 'code' | 'visualization' | 'metric' | 'callout' | 'summary' | 'diagram' | 'chart' | 'svg' | 'drawio';
  content: any;
}

const MessageContent: React.FC<MessageContentProps> = ({ message, theme }) => {
  const [copiedItems, setCopiedItems] = React.useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set());
  const [viewerImage, setViewerImage] = React.useState<{ url: string; alt?: string } | null>(null);

  // Parse message content for special formatting
  const parseContent = (content: string): ParsedContent[] => {
    const parsed: ParsedContent[] = [];
    
    // Ensure content is a string
    if (!content || typeof content !== 'string') {
      return [{ type: 'text', content: content || '' }];
    }
    
    // Check if content has already been preprocessed by the backend
    const isPreprocessed = message.metadata?.processedFormatting === true;
    
    let processedContent = content;

    // Detect and reformat raw JSON/tool dumps that models sometimes include in text.
    // Patterns: standalone JSON, "tool_name: {json}", or "tool_name: text\n{json}"
    if (!processedContent.includes('```')) {
      // Pattern 1: "tool_name: {json}" on a line — replace with formatted block
      processedContent = processedContent.replace(
        /^(\w[\w_]*)\s*:\s*(\{.{80,}\})\s*$/gm,
        (_match, toolName, json) => {
          try {
            const parsed = JSON.parse(json);
            const pretty = JSON.stringify(parsed, null, 2);
            return `**${toolName}**:\n\`\`\`json\n${pretty.length > 500 ? json.substring(0, 500) + '...' : pretty}\n\`\`\``;
          } catch {
            return _match;
          }
        }
      );
      // Pattern 2: Standalone JSON block on its own line(s)
      processedContent = processedContent.replace(
        /^(\{[\s\S]{100,}?\})\s*$/gm,
        (match) => {
          try {
            JSON.parse(match);
            return '```json\n' + match + '\n```';
          } catch {
            return match;
          }
        }
      );
    }

    if (!isPreprocessed) {
      // Apply LaTeX delimiter transformations only if not already processed
      // Transform LaTeX delimiters to standard math delimiters for KaTeX
      // Convert \( ... \) to $...$
      processedContent = processedContent.replace(/\\\((.*?)\\\)/g, '$$$1$$');
      // Convert \[ ... \] to $$...$$
      processedContent = processedContent.replace(/\\\[(.*?)\\\]/g, '$$$$$$1$$$$');
      
      // Handle the plain ( ... ) format that appears in AI output
      // This matches parentheses with spaces: ( content )
      processedContent = processedContent.replace(/\(\s+([^)]+?)\s+\)/g, (match, p1) => {
        // Check if it looks like a math equation
        const mathIndicators = ['=', '^', '_', '\\', 'frac', 'sqrt', 'sum', 'int', 'gamma', 'alpha', 'beta', 'theta', 'phi', 'pi', 'sigma', 'Delta', 'nabla', 'partial'];
        const looksLikeMath = mathIndicators.some(indicator => p1.includes(indicator));
        
        // Also check for common math patterns
        const mathPatterns = [
          /[a-zA-Z]\s*=\s*[a-zA-Z0-9]/,  // x = 5, E = mc
          /\d+\s*[\+\-\*/]\s*\d+/,       // 2 + 2
          /[a-zA-Z]+\^\d+/,               // mc^2
          /\\[a-zA-Z]+/                   // \frac, \int, etc.
        ];
        const matchesPattern = mathPatterns.some(pattern => pattern.test(p1));
        
        if (looksLikeMath || matchesPattern) {
          // Inline math
          return `$${p1.trim()}$`;
        }
        return match;
      });
      
      // Handle block math with [ ... ] (with spaces)
      processedContent = processedContent.replace(/\[\s+([^[\]]+?)\s+\]/g, (match, p1) => {
        // Check if it looks like a math equation
        const mathIndicators = ['=', '\\', '^', '_', 'frac', 'int', 'sum', 'gamma', 'sqrt', 'lim', 'infty', 'Delta', 'nabla', 'partial'];
        const looksLikeMath = mathIndicators.some(indicator => p1.includes(indicator));
        
        if (looksLikeMath) {
          // Display math
          return `$$${p1.trim()}$$`;
        }
        return match;
      });
    }
    
    // Use the processed content for further parsing
    content = processedContent;
    
    // #971 (2026-05-20) — DO NOT mount artifacts from message.visualizations[]
    // here. MessageContent renders MARKDOWN PROSE ONLY.
    // visualizations[] is consumed by AgenticActivityStream (inline iframe at
    // tool_use position) + ArtifactSlideOutLauncher (SlideOut buttons).
    // Pushing them here too produced duplicate iframes at the bottom of
    // finished replies. See task #971.
    
    // Check if message contains Prometheus metrics
    if (message.prometheusData && Array.isArray(message.prometheusData)) {
      message.prometheusData.forEach(metric => {
        if (metric && typeof metric === 'object') {
          parsed.push({ type: 'metric', content: metric });
        }
      });
    }
    
    // Parse markdown content for special blocks
    const lines = content.split('\n');
    let currentBlock: string[] = [];
    let blockType: string | null = null;
    let inCodeBlock = false;
    let codeLanguage = '';
    
    lines.forEach((line, index) => {
      // Check for executive summary
      if (line.startsWith('📊 Executive Summary:') || line.startsWith('## Executive Summary')) {
        if (currentBlock.length > 0) {
          parsed.push({ type: 'text', content: currentBlock.join('\n') });
          currentBlock = [];
        }
        const summaryContent = lines.slice(index + 1, index + 4).join('\n');
        parsed.push({ type: 'summary', content: summaryContent });
        return;
      }
      
      // Check for callout boxes
      const calloutMatch = line.match(/^(⚠️|📌|💡|❌|✅)\s*(.+)/);
      if (calloutMatch) {
        if (currentBlock.length > 0) {
          parsed.push({ type: 'text', content: currentBlock.join('\n') });
          currentBlock = [];
        }
        parsed.push({ 
          type: 'callout', 
          content: {
            type: getCalloutType(calloutMatch[1]),
            text: calloutMatch[2]
          }
        });
        return;
      }
      
      // Check for code blocks
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          if (currentBlock.length > 0) {
            parsed.push({ type: 'text', content: currentBlock.join('\n') });
            currentBlock = [];
          }
          inCodeBlock = true;
          codeLanguage = line.slice(3).trim();
        } else {
          // Check if this is a React Flow diagram (JSON format)
          if (codeLanguage === 'diagram' || codeLanguage === 'reactflow' || codeLanguage === 'flowchart-json') {
            try {
              const diagramJson = JSON.parse(currentBlock.join('\n'));
              parsed.push({
                type: 'diagram',
                content: diagramJson
              });
              currentBlock = [];
              inCodeBlock = false;
              codeLanguage = '';
              return;
            } catch (e) {
              // Not valid JSON, treat as regular code
            }
          }

          // Check if this is an SVG or geometry diagram
          if (codeLanguage === 'svg' || codeLanguage === 'geometry') {
            const svgCode = currentBlock.join('\n');
            parsed.push({
              type: 'svg',
              content: {
                code: svgCode,
                title: extractTitle(svgCode)
              }
            });
            currentBlock = [];
            inCodeBlock = false;
            codeLanguage = '';
            return;
          }

          // Check if this is a Draw.io/mxGraph diagram
          if (codeLanguage === 'drawio' || codeLanguage === 'mxgraph' || codeLanguage === 'drawio-xml') {
            const xmlCode = currentBlock.join('\n');
            parsed.push({
              type: 'drawio',
              content: {
                xml: xmlCode,
                title: extractDrawioTitle(xmlCode)
              }
            });
            currentBlock = [];
            inCodeBlock = false;
            codeLanguage = '';
            return;
          }

          // Check if this is a chart specification
          if (codeLanguage === 'chart' || codeLanguage === 'chart-json') {
            try {
              const chartSpec = JSON.parse(currentBlock.join('\n'));
              parsed.push({
                type: 'chart',
                content: chartSpec
              });
              currentBlock = [];
              inCodeBlock = false;
              codeLanguage = '';
              return;
            } catch (e) {
              // Not valid JSON, treat as regular code
            }
          }

          // Check if JSON block contains chart/visualization data
          if (codeLanguage === 'json' || codeLanguage === 'JSON') {
            try {
              const jsonData = JSON.parse(currentBlock.join('\n'));
              // Check if it's a visualization wrapper or direct chart spec
              if (jsonData.visualizations && Array.isArray(jsonData.visualizations)) {
                // Extract charts from visualizations array
                jsonData.visualizations.forEach((viz: any) => {
                  if (viz && viz.type && viz.data) {
                    parsed.push({ type: 'chart', content: viz });
                  }
                });
                currentBlock = [];
                inCodeBlock = false;
                codeLanguage = '';
                return;
              } else if (jsonData.type && jsonData.data && ['bar', 'line', 'area', 'pie', 'radial', 'gauge'].includes(jsonData.type)) {
                // Direct chart specification
                parsed.push({ type: 'chart', content: jsonData });
                currentBlock = [];
                inCodeBlock = false;
                codeLanguage = '';
                return;
              }
            } catch (e) {
              // Not valid JSON or not chart data, treat as regular code
            }
          }

          // Parse additional metadata from code block
          const codeContent = currentBlock.join('\n');
          let filename: string | undefined;
          let highlightLines: number[] = [];
          let errorLines: number[] = [];
          
          // Check for filename comment at the start
          const filenameMatch = codeContent.match(/^\s*\/\/\s*filename:\s*(.+)|^\s*#\s*filename:\s*(.+)/m);
          if (filenameMatch) {
            filename = filenameMatch[1] || filenameMatch[2];
          }
          
          // Check for highlight directives
          const highlightMatch = codeContent.match(/^\s*\/\/\s*highlight:\s*([\d,\s-]+)|^\s*#\s*highlight:\s*([\d,\s-]+)/m);
          if (highlightMatch) {
            const ranges = (highlightMatch[1] || highlightMatch[2]).split(',');
            ranges.forEach(range => {
              if (range.includes('-')) {
                const [start, end] = range.split('-').map(n => Number.parseInt(n.trim()));
                for (let i = start; i <= end; i++) {
                  highlightLines.push(i);
                }
              } else {
                highlightLines.push(Number.parseInt(range.trim()));
              }
            });
          }
          
          // Check for error lines
          const errorMatch = codeContent.match(/^\s*\/\/\s*error:\s*([\d,\s-]+)|^\s*#\s*error:\s*([\d,\s-]+)/m);
          if (errorMatch) {
            const ranges = (errorMatch[1] || errorMatch[2]).split(',');
            ranges.forEach(range => {
              if (range.includes('-')) {
                const [start, end] = range.split('-').map(n => Number.parseInt(n.trim()));
                for (let i = start; i <= end; i++) {
                  errorLines.push(i);
                }
              } else {
                errorLines.push(Number.parseInt(range.trim()));
              }
            });
          }
          
          parsed.push({ 
            type: 'code', 
            content: {
              code: codeContent,
              language: codeLanguage || 'plaintext',
              filename,
              highlightLines,
              errorLines
            }
          });
          currentBlock = [];
          inCodeBlock = false;
          codeLanguage = '';
        }
        return;
      }
      
      currentBlock.push(line);
    });
    
    // Handle remaining content
    if (currentBlock.length > 0) {
      if (inCodeBlock) {
        parsed.push({ 
          type: 'code', 
          content: {
            code: currentBlock.join('\n'),
            language: codeLanguage || 'plaintext'
          }
        });
      } else {
        parsed.push({ type: 'text', content: currentBlock.join('\n') });
      }
    }
    
    return parsed;
  };
  
  const getCalloutType = (emoji: string): 'warning' | 'info' | 'success' | 'error' | 'tip' => {
    switch (emoji) {
      case '⚠️': return 'warning';
      case '📌': return 'info';
      case '💡': return 'tip';
      case '❌': return 'error';
      case '✅': return 'success';
      default: return 'info';
    }
  };
  
  const extractTitle = (code: string): string | undefined => {
    const titleMatch = code.match(/title\s+(.+)/);
    return titleMatch ? titleMatch[1] : undefined;
  };

  const extractDrawioTitle = (xml: string): string | undefined => {
    // Try to extract title from draw.io XML
    const match = xml.match(/<diagram[^>]*name="([^"]+)"/);
    return match ? match[1] : undefined;
  };
  
  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItems(prev => new Set(prev).add(id));
      setTimeout(() => {
        setCopiedItems(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };
  
  // Add error boundary
  try {
    const parsedContent = parseContent(message.content || '');
    
    return (
      <div className="space-y-4">
        {parsedContent.map((block, index) => {
          try {
            switch (block.type) {
              case 'summary':
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`pl-4 border-l-2 ${
                      theme === 'dark'
                        ? 'border-blue-500/50 text-blue-100'
                        : 'border-blue-500 text-blue-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Info size={20} className="flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-semibold mb-1">Executive Summary</div>
                        <div className="text-sm opacity-90 whitespace-pre-wrap">
                          {block.content}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
                
              case 'callout':
                return (
                  <CalloutBox
                    key={index}
                    type={block.content.type}
                    theme={theme}
                  >
                    {block.content.text}
                  </CalloutBox>
                );
                
              case 'code':
                // Detect if this is a shell/command language
                const isShellCommand = ['bash', 'shell', 'powershell', 'cmd', 'sh', 'zsh'].includes(block.content.language);
                const isDiff = block.content.language === 'diff';
                const hasErrors = block.content.errorLines && block.content.errorLines.length > 0;
                
                // Use simple code block for all cases (no glitchy async highlighting)
                if (isShellCommand || isDiff || hasErrors || block.content.highlightLines) {
                  return (
                    <ShikiCodeBlock
                      key={index}
                      code={block.content.code}
                      language={block.content.language}
                      theme={theme}
                      onCopy={(code) => handleCopy(code, `code-${index}`)}
                      className="my-4"
                    />
                  );
                }
                
                // Use simple code block for other languages
                return (
                  <ShikiCodeBlock
                    key={index}
                    code={block.content.code}
                    language={block.content.language}
                    theme={theme}
                    onCopy={(code) => handleCopy(code, `code-${index}`)}
                    copied={copiedItems.has(`code-${index}`)}
                    className="my-4"
                  />
                );
                
              case 'diagram':
                return (
                  <ReactFlowDiagram
                    key={index}
                    diagram={{
                      ...block.content,
                      theme: theme === 'dark' ? 'dark' : 'light'
                    }}
                    height={450}
                    interactive={true}
                  />
                );

              case 'svg':
                return (
                  <SvgDiagram
                    key={index}
                    code={block.content.code}
                    title={block.content.title}
                    className="my-4"
                  />
                );

              case 'drawio':
                return (
                  <DrawioDiagramViewer
                    key={index}
                    xml={block.content.xml}
                    title={block.content.title}
                    height={450}
                    showControls={true}
                  />
                );

              case 'chart':
                // Use DataVisualization for client-side rendering with Recharts
                return (
                  <DataVisualization
                    key={index}
                    data={block.content}
                    theme={theme}
                  />
                );
                
              case 'visualization':
                return (
                  <DataVisualization
                    key={index}
                    data={block.content}
                    theme={theme}
                  />
                );
                
              case 'metric':
                return (
                  <MetricCard
                    key={index}
                    metric={block.content}
                    theme={theme}
                    onViewInGrafana={() => {
                      window.open('/grafana', '_blank');
                    }}
                  />
                );
                
              case 'text':
              default:
                return (
                  <div key={index} className="prose-sm-tight max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
                      rehypePlugins={[
                        rehypeKatex as any,
                        [rehypeSanitize, sanitizeSchema]
                      ]}
                      components={{
                        // Only override code for special rendering (diagrams, syntax highlighting)
                        // All other elements use default browser/markdown rendering - LLM has full control
                        code: ({ node, className, children, ...props }) => {
                          const match = /language-(\w+)/.exec(className || '');
                          const isInline = !match;

                          // Inline code - no styling, LLM controls formatting
                          if (isInline) {
                            const { inline, ...restProps } = props as any;
                            return (
                              <code className={className} {...restProps}>
                                {children}
                              </code>
                            );
                          }

                          const language = match ? match[1] : '';
                          const codeContent = String(children).replace(/\n$/, '');

                          // React Flow diagrams - render as interactive diagram
                          if (language === 'diagram' || language === 'reactflow' || language === 'flowchart-json') {
                            try {
                              const diagramJson = JSON.parse(codeContent);
                              return (
                                <ReactFlowDiagram
                                  diagram={{
                                    ...diagramJson,
                                    theme: theme === 'dark' ? 'dark' : 'light'
                                  }}
                                  height={450}
                                  interactive={true}
                                />
                              );
                            } catch (e) {
                              // Not valid JSON, render as code
                            }
                          }

                          // SVG diagrams - render visually
                          if (language === 'svg' || language === 'geometry') {
                            return (
                              <SvgDiagram
                                code={codeContent}
                                title={extractTitle(codeContent)}
                                theme={theme}
                                className="my-4"
                              />
                            );
                          }

                          // Draw.io/mxGraph diagrams - render with viewer
                          if (language === 'drawio' || language === 'mxgraph' || language === 'drawio-xml') {
                            return (
                              <DrawioDiagramViewer
                                xml={codeContent}
                                title={extractDrawioTitle(codeContent)}
                                height={450}
                                showControls={true}
                              />
                            );
                          }

                          // Code blocks - syntax highlighting
                          // Legacy artifact:html|react|svg fence pipeline ripped 2026-05-13
                          // (#781 Phase D.4). Interactive artifacts now flow via
                          // Message.visualizations[] + ArtifactSlideOutLauncher.
                          return (
                            <ShikiCodeBlock
                              code={codeContent}
                              language={language || 'plaintext'}
                              theme={theme}
                              onCopy={() => {}}
                              className="my-4"
                            />
                          );
                        },
                        // Images - click to view
                        img: ({ src, alt }) => {
                          if (!src) return null;
                          return (
                            <img
                              src={src}
                              alt={alt}
                              role="button"
                              tabIndex={0}
                              onClick={() => setViewerImage({ url: src, alt })}
                              onKeyDown={onKeyActivate(() => setViewerImage({ url: src, alt }))}
                              className="max-w-full h-auto cursor-pointer"
                              loading="lazy"
                            />
                          );
                        },
                      }}
                    >
                      {block.content || ''}
                    </ReactMarkdown>
                  </div>
                );
            }
          } catch (blockError) {
            console.error('Error rendering block:', blockError, block);
            return (
              <div key={index} className="pl-4 border-l-2 border-theme-error text-theme-error-fg">
                <p>Error rendering content block</p>
              </div>
            );
          }
        })}
        
        {/* MCP Calls Display */}
        {message.metadata?.mcpCalls && message.metadata.mcpCalls.length > 0 && (
          <div className="mt-4">
            <MCPCallDisplay
              calls={message.metadata.mcpCalls}
              theme={theme}
            />
          </div>
        )}
        
        {/* Image Viewer */}
        {viewerImage && (
          <ImageViewer
            src={viewerImage.url}
            alt={viewerImage.alt || 'Image'}
            onClose={() => setViewerImage(null)}
          />
        )}
      </div>
    );
  } catch (error) {
    console.error('MessageContent error');
    return (
      <div className="pl-4 border-l-2 border-theme-error text-theme-error-fg">
        <p>Error rendering message content</p>
      </div>
    );
  }
};

export default MessageContent;

// Export other message content components
export { default as EnhancedMessageContent } from './EnhancedMessageContent';
export { default as ShikiCodeBlock } from './ShikiCodeBlock';
export { default as DataVisualization } from './DataVisualization';
export { default as MetricCard } from './MetricCard';
export { default as CalloutBox } from './CalloutBox';
export { default as RichCallout } from './RichCallout';
export { default as HighlightedText } from './HighlightedText';
export { default as ChartRenderer } from './ChartRenderer';
