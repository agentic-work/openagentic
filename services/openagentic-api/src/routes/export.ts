/**
 * Export API Routes for Pure Frontend Architecture
 * Server-side document generation (PDF, DOCX, etc.)
 *
 * Enhanced with:
 * - Automatic artifact storage for generated reports
 * - Semantic search indexing via Milvus
 * - Future reference capability ("show me the security report")
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jsPDF } from 'jspdf';
import { Buffer } from 'buffer';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  PageBreak,
  TableOfContents,
  Header,
  Footer,
  PageNumber,
  NumberFormat
} from 'docx';
import { ArtifactService } from '../services/ArtifactService.js';
import { logger } from '../utils/logger.js';

// Initialize artifact service for report storage
let artifactService: ArtifactService | null = null;

function getArtifactService(): ArtifactService {
  if (!artifactService) {
    artifactService = new ArtifactService(logger);
  }
  return artifactService;
}

interface ExportRequest {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    metadata?: any;
  }>;
  options: {
    format: 'pdf' | 'docx' | 'markdown' | 'text';
    includeTimestamps?: boolean;
    includeMetadata?: boolean;
    title?: string;
    author?: string;
    // New: Save to artifacts for future reference
    saveToArtifacts?: boolean;
    artifactTags?: string[];
    artifactDescription?: string;
    sessionId?: string;
  };
}

interface AzureReportRequest {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    metadata?: any;
  }>;
  options: {
    format: 'pdf' | 'docx';
    reportTitle: string;
    includeExecutiveSummary?: boolean;
    includeTOC?: boolean;
    author?: string;
    company?: string;
    // New: Save to artifacts for future reference
    saveToArtifacts?: boolean;
    artifactTags?: string[];
    artifactDescription?: string;
    sessionId?: string;
  };
}

// Result interface when saving to artifacts
interface ExportResult {
  success: boolean;
  downloadUrl?: string;
  artifactId?: string;
  artifactSearchable?: boolean;
  filename: string;
  format: string;
  size: number;
}

export default async function exportRoutes(fastify: FastifyInstance) {
  /**
   * Export messages to various formats
   * POST /api/export/messages
   *
   * If saveToArtifacts=true, saves the report to artifact storage
   * for future semantic search ("show me the security report from last week")
   */
  fastify.post<{ Body: ExportRequest }>('/messages', async (request, reply): Promise<void> => {
    try {
      const { messages, options } = request.body;
      const user = (request as any).user;
      const userId = user?.id || user?.sub || 'anonymous';

      if (!Array.isArray(messages) || !messages.length) {
        return reply.code(400).send({ error: 'Messages array is required' });
      }

      if (!options?.format) {
        return reply.code(400).send({ error: 'Export format is required' });
      }

      const { format, includeTimestamps, includeMetadata, title, author, saveToArtifacts, artifactTags, artifactDescription } = options;
      const filename = `${(title || 'chat-export').replace(/[^a-z0-9]/gi, '-')}`;

      let buffer: Buffer;
      let mimeType: string;
      let extension: string;

      switch (format) {
        case 'pdf':
          buffer = await generatePDF(messages, { includeTimestamps, title, author });
          mimeType = 'application/pdf';
          extension = 'pdf';
          break;

        case 'text':
          const textContent = generateText(messages, { includeTimestamps, title, author });
          buffer = Buffer.from(textContent, 'utf-8');
          mimeType = 'text/plain';
          extension = 'txt';
          break;

        case 'markdown':
          const markdownContent = generateMarkdown(messages, { includeTimestamps, includeMetadata, title, author });
          buffer = Buffer.from(markdownContent, 'utf-8');
          mimeType = 'text/markdown';
          extension = 'md';
          break;

        case 'docx':
          buffer = await generateDOCX(messages, { includeTimestamps, includeMetadata, title, author });
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          extension = 'docx';
          break;

        default:
          return reply.code(400).send({ error: `Unsupported format: ${format}` });
      }

      // Save to artifacts if requested
      let artifactId: string | undefined;
      let artifactSearchable = false;

      if (saveToArtifacts && userId !== 'anonymous') {
        try {
          const artifactSvc = getArtifactService();
          const artifact = await artifactSvc.uploadArtifact(userId, {
            file: buffer,
            filename: `${filename}.${extension}`,
            mimeType,
            title: title || 'Chat Export',
            description: artifactDescription || `Exported chat conversation with ${messages.length} messages`,
            tags: [...(artifactTags || []), 'export', 'report', format],
            isPublic: false
          });

          artifactId = artifact.id;
          artifactSearchable = true;

          fastify.log.info({
            artifactId,
            userId,
            format,
            size: buffer.length
          }, 'Report saved to artifacts');
        } catch (artifactError) {
          fastify.log.warn({
            error: artifactError instanceof Error ? artifactError.message : String(artifactError)
          }, 'Failed to save report to artifacts, continuing with download');
        }
      }

      // If saving to artifacts, return JSON with artifact info
      if (saveToArtifacts) {
        const result: ExportResult = {
          success: true,
          artifactId,
          artifactSearchable,
          downloadUrl: artifactId ? `/api/artifacts/${artifactId}/download` : undefined,
          filename: `${filename}.${extension}`,
          format,
          size: buffer.length
        };

        // Also send the file as base64 for immediate download
        return reply.send({
          ...result,
          data: buffer.toString('base64')
        });
      }

      // Otherwise, send as download
      reply
        .header('Content-Type', mimeType)
        .header('Content-Disposition', `attachment; filename="${filename}.${extension}"`)
        .send(buffer);

    } catch (error) {
      fastify.log.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({
        error: 'Failed to export messages',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Export Azure report
   * POST /api/export/azure-report
   *
   * Enhanced with automatic artifact storage
   */
  fastify.post<{ Body: AzureReportRequest }>('/azure-report', async (request, reply): Promise<void> => {
    try {
      const { messages, options } = request.body;
      const user = (request as any).user;
      const userId = user?.id || user?.sub || 'anonymous';

      if (!Array.isArray(messages) || !messages.length) {
        return reply.code(400).send({ error: 'Messages array is required' });
      }

      if (!options?.reportTitle) {
        return reply.code(400).send({ error: 'Report title is required' });
      }

      const { format, reportTitle, saveToArtifacts, artifactTags, artifactDescription } = options;
      const filename = `${reportTitle.replace(/[^a-z0-9]/gi, '-')}-azure-report`;

      // Structure Azure report content
      const structuredContent = structureAzureReport(messages, options);

      let buffer: Buffer;
      let mimeType: string;
      let extension: string;

      if (format === 'pdf') {
        buffer = await generateAzureReportPDF(structuredContent, options);
        mimeType = 'application/pdf';
        extension = 'pdf';
      } else {
        // Generate proper DOCX
        buffer = await generateAzureReportDOCX(structuredContent, options);
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        extension = 'docx';
      }

      // Save to artifacts if requested
      let artifactId: string | undefined;
      let artifactSearchable = false;

      if (saveToArtifacts && userId !== 'anonymous') {
        try {
          const artifactSvc = getArtifactService();
          const artifact = await artifactSvc.uploadArtifact(userId, {
            file: buffer,
            filename: `${filename}.${extension}`,
            mimeType,
            title: reportTitle,
            description: artifactDescription || `Azure report: ${reportTitle}`,
            tags: [...(artifactTags || []), 'azure', 'report', 'cloud', format],
            isPublic: false
          });

          artifactId = artifact.id;
          artifactSearchable = true;

          fastify.log.info({
            artifactId,
            userId,
            format,
            reportTitle,
            size: buffer.length
          }, 'Azure report saved to artifacts');
        } catch (artifactError) {
          fastify.log.warn({
            error: artifactError instanceof Error ? artifactError.message : String(artifactError)
          }, 'Failed to save Azure report to artifacts, continuing with download');
        }
      }

      // If saving to artifacts, return JSON with artifact info
      if (saveToArtifacts) {
        const result: ExportResult = {
          success: true,
          artifactId,
          artifactSearchable,
          downloadUrl: artifactId ? `/api/artifacts/${artifactId}/download` : undefined,
          filename: `${filename}.${extension}`,
          format,
          size: buffer.length
        };

        return reply.send({
          ...result,
          data: buffer.toString('base64')
        });
      }

      // Otherwise, send as download
      reply
        .header('Content-Type', mimeType)
        .header('Content-Disposition', `attachment; filename="${filename}.${extension}"`)
        .send(buffer);

    } catch (error) {
      fastify.log.error(`Azure report export failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({
        error: 'Failed to export Azure report',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Search artifacts by query
   * GET /api/export/artifacts/search
   *
   * Allows finding previously exported reports
   * Example: "show me the security report from last week"
   */
  fastify.get<{
    Querystring: { query: string; type?: string; tags?: string; limit?: number }
  }>('/artifacts/search', async (request, reply) => {
    try {
      const user = (request as any).user;
      const userId = user?.id || user?.sub;

      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { query, type, tags, limit } = request.query;

      if (!query) {
        return reply.code(400).send({ error: 'Search query is required' });
      }

      const artifactSvc = getArtifactService();
      const results = await artifactSvc.searchArtifacts(userId, {
        query,
        type: type as any,
        tags: tags ? tags.split(',') : undefined,
        limit: limit || 10,
        threshold: 0.3  // Lower threshold for better recall (vector scores typically ~0.4)
      });

      return reply.send(results);
    } catch (error) {
      fastify.log.error(`Artifact search failed: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(500).send({
        error: 'Failed to search artifacts',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

/**
 * Generate PDF from messages using jsPDF
 */
async function generatePDF(messages: any[], options: any): Promise<Buffer> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Set document properties
  pdf.setProperties({
    title: options.title || 'Chat Export',
    author: options.author || 'OpenAgentic Chat',
    subject: 'Exported chat conversation',
    creator: 'OpenAgentic'
  });

  // Add title
  pdf.setFontSize(20);
  pdf.text(options.title || 'Chat Export', 20, 20);
  
  // Add export date
  pdf.setFontSize(10);
  pdf.setTextColor(128);
  pdf.text(`Exported on ${new Date().toLocaleDateString()}`, 20, 30);
  
  let yPosition = 45;
  const pageHeight = pdf.internal.pageSize.height;
  const margin = 20;
  const lineHeight = 7;
  const maxWidth = 170;

  // Process each message
  messages.forEach((message, index) => {
    // Check if we need a new page
    if (yPosition > pageHeight - 40) {
      pdf.addPage();
      yPosition = 20;
    }

    // Add role header
    pdf.setFontSize(12);
    pdf.setTextColor(0);
    pdf.setFont(undefined, 'bold');
    
    const role = message.role === 'user' ? 'You' : 'Assistant';
    pdf.text(role, margin, yPosition);
    
    // Add timestamp if requested
    if (options.includeTimestamps && message.timestamp) {
      pdf.setFontSize(8);
      pdf.setTextColor(128);
      pdf.setFont(undefined, 'normal');
      const timestamp = new Date(message.timestamp).toLocaleString();
      pdf.text(timestamp, margin + 50, yPosition);
    }
    
    yPosition += lineHeight;

    // Add message content
    pdf.setFontSize(10);
    pdf.setTextColor(0);
    pdf.setFont(undefined, 'normal');
    
    // Split text to fit page width
    const lines = pdf.splitTextToSize(message.content, maxWidth);
    
    lines.forEach((line: string) => {
      if (yPosition > pageHeight - 20) {
        pdf.addPage();
        yPosition = 20;
      }
      pdf.text(line, margin, yPosition);
      yPosition += lineHeight;
    });
    
    // Add spacing between messages
    yPosition += 5;
    
    // Add separator line
    if (index < messages.length - 1) {
      pdf.setDrawColor(200);
      pdf.line(margin, yPosition, margin + maxWidth, yPosition);
      yPosition += 10;
    }
  });

  return Buffer.from(pdf.output('arraybuffer'));
}

/**
 * Generate plain text export
 */
function generateText(messages: any[], options: any): string {
  let text = '';

  // Add title
  text += `${options.title || 'Chat Export'}\n`;
  text += `${'='.repeat((options.title || 'Chat Export').length)}\n\n`;
  text += `Exported on ${new Date().toLocaleDateString()}\n\n`;
  text += `${'-'.repeat(50)}\n\n`;

  // Add messages
  messages.forEach((message) => {
    const role = message.role === 'user' ? 'YOU' : 'ASSISTANT';
    
    text += `[${role}]`;
    
    if (options.includeTimestamps && message.timestamp) {
      text += ` - ${new Date(message.timestamp).toLocaleString()}`;
    }
    
    text += '\n\n';
    text += `${message.content}\n\n`;
    text += `${'-'.repeat(50)}\n\n`;
  });

  return text;
}

/**
 * Generate markdown export
 */
function generateMarkdown(messages: any[], options: any): string {
  let markdown = '';

  // Add title
  markdown += `# ${options.title || 'Chat Export'}\n\n`;
  markdown += `*Exported on ${new Date().toLocaleDateString()}*\n\n`;
  markdown += '---\n\n';

  // Add messages
  messages.forEach((message) => {
    const role = message.role === 'user' ? 'You' : 'Assistant';
    
    markdown += `## ${role}\n`;
    
    if (options.includeTimestamps && message.timestamp) {
      markdown += `*${new Date(message.timestamp).toLocaleString()}*\n\n`;
    }
    
    markdown += `${message.content}\n\n`;
    
    // Add metadata if requested
    if (options.includeMetadata && message.metadata) {
      markdown += '<details>\n';
      markdown += '<summary>Metadata</summary>\n\n';
      markdown += '```json\n';
      markdown += JSON.stringify(message.metadata, null, 2);
      markdown += '\n```\n';
      markdown += '</details>\n\n';
    }
    
    markdown += '---\n\n';
  });

  return markdown;
}

/**
 * Structure Azure report content
 */
function structureAzureReport(messages: any[], options: any): any {
  const sections: any[] = [];
  
  // Find executive summary or create one
  if (options.includeExecutiveSummary) {
    const summaryMessage = messages.find(m => 
      m.content.includes('## Summary') || 
      m.content.includes('## Executive Summary')
    );
    
    sections.push({
      title: 'Executive Summary',
      content: summaryMessage?.content || 'No executive summary available.'
    });
  }

  // Extract Azure resource information
  const azureData = messages.filter(m => 
    m.metadata?.mcpCalls?.some((call: any) => 
      call.tool?.includes('azure') || call.server?.includes('azure')
    )
  );

  if (azureData.length > 0) {
    sections.push({
      title: 'Azure Resources Analysis',
      content: azureData.map(m => m.content).join('\n\n')
    });
  }

  // Add recommendations section
  const recommendations = messages.find(m => 
    m.content.includes('## Recommendations') ||
    m.content.includes('## Next Steps')
  );
  
  if (recommendations) {
    sections.push({
      title: 'Recommendations',
      content: recommendations.content
    });
  }

  return sections;
}

/**
 * Generate Azure report PDF
 */
async function generateAzureReportPDF(sections: any[], options: any): Promise<Buffer> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Add cover page
  pdf.setFontSize(28);
  pdf.text(options.reportTitle, 105, 100, { align: 'center' });
  
  if (options.company) {
    pdf.setFontSize(16);
    pdf.text(options.company, 105, 120, { align: 'center' });
  }
  
  pdf.setFontSize(12);
  pdf.text(new Date().toLocaleDateString(), 105, 140, { align: 'center' });
  
  // Add sections
  sections.forEach((section) => {
    pdf.addPage();
    pdf.setFontSize(18);
    pdf.text(section.title, 20, 30);
    
    pdf.setFontSize(11);
    let yPosition = 45;
    const lines = pdf.splitTextToSize(section.content, 170);
    
    lines.forEach((line: string) => {
      if (yPosition > 270) {
        pdf.addPage();
        yPosition = 30;
      }
      pdf.text(line, 20, yPosition);
      yPosition += 7;
    });
  });

  return Buffer.from(pdf.output('arraybuffer'));
}

/**
 * Generate Azure report text
 */
function generateAzureReportText(sections: any[], options: any): string {
  let text = `${options.reportTitle}\n`;
  text += `${'='.repeat(options.reportTitle.length)}\n\n`;

  if (options.company) {
    text += `${options.company}\n\n`;
  }

  text += `Generated on ${new Date().toLocaleDateString()}\n\n`;
  text += `${'-'.repeat(80)}\n\n`;

  sections.forEach((section) => {
    text += `${section.title}\n`;
    text += `${'-'.repeat(section.title.length)}\n\n`;
    text += `${section.content}\n\n`;
    text += `${'-'.repeat(80)}\n\n`;
  });

  return text;
}

/**
 * Generate DOCX from messages using docx library
 */
async function generateDOCX(messages: any[], options: any): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      text: options.title || 'Chat Export',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    })
  );

  // Subtitle with export date
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Exported on ${new Date().toLocaleDateString()}`,
          italics: true,
          color: '666666'
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 }
    })
  );

  // Add separator line
  children.push(
    new Paragraph({
      border: {
        bottom: { color: 'CCCCCC', style: BorderStyle.SINGLE, size: 6 }
      },
      spacing: { after: 400 }
    })
  );

  // Process each message
  messages.forEach((message, index) => {
    const role = message.role === 'user' ? 'You' : 'Assistant';
    const isUser = message.role === 'user';

    // Role header
    const headerChildren: TextRun[] = [
      new TextRun({
        text: role,
        bold: true,
        color: isUser ? '0066CC' : '228B22'
      })
    ];

    // Add timestamp if requested
    if (options.includeTimestamps && message.timestamp) {
      headerChildren.push(
        new TextRun({
          text: ` - ${new Date(message.timestamp).toLocaleString()}`,
          italics: true,
          color: '888888',
          size: 20
        })
      );
    }

    children.push(
      new Paragraph({
        children: headerChildren,
        spacing: { before: 300, after: 100 }
      })
    );

    // Message content - split by newlines for proper paragraph handling
    const contentLines = message.content.split('\n');
    contentLines.forEach((line: string) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line,
              size: 22
            })
          ],
          spacing: { before: 60, after: 60 }
        })
      );
    });

    // Add metadata if requested
    if (options.includeMetadata && message.metadata) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Metadata: ',
              bold: true,
              size: 18,
              color: '666666'
            }),
            new TextRun({
              text: JSON.stringify(message.metadata, null, 2),
              size: 16,
              font: 'Courier New',
              color: '666666'
            })
          ],
          spacing: { before: 100, after: 200 }
        })
      );
    }

    // Add separator between messages
    if (index < messages.length - 1) {
      children.push(
        new Paragraph({
          border: {
            bottom: { color: 'EEEEEE', style: BorderStyle.SINGLE, size: 4 }
          },
          spacing: { before: 200, after: 200 }
        })
      );
    }
  });

  // Create document
  const doc = new Document({
    creator: 'OpenAgentic',
    title: options.title || 'Chat Export',
    description: 'Exported chat conversation',
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: options.title || 'Chat Export',
                    size: 18,
                    color: '888888'
                  })
                ],
                alignment: AlignmentType.RIGHT
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Page ',
                    size: 18
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT]
                  }),
                  new TextRun({
                    text: ' of ',
                    size: 18
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES]
                  })
                ],
                alignment: AlignmentType.CENTER
              })
            ]
          })
        },
        children
      }
    ]
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/**
 * Generate Azure report DOCX
 */
async function generateAzureReportDOCX(sections: any[], options: any): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Cover page - Title
  children.push(
    new Paragraph({
      text: options.reportTitle,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 400 }
    })
  );

  // Company name
  if (options.company) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: options.company,
            size: 32,
            color: '333333'
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 }
      })
    );
  }

  // Report date
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          size: 24,
          color: '666666'
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 }
    })
  );

  // Author
  if (options.author) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Prepared by: ${options.author}`,
            size: 22,
            italics: true,
            color: '666666'
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    );
  }

  // Page break after cover
  children.push(
    new Paragraph({
      children: [new PageBreak()]
    })
  );

  // Table of Contents if requested
  if (options.includeTOC) {
    children.push(
      new Paragraph({
        text: 'Table of Contents',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 }
      })
    );

    // List of sections
    sections.forEach((section, index) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${index + 1}. ${section.title}`,
              size: 22
            })
          ],
          spacing: { before: 100, after: 100 }
        })
      );
    });

    // Page break after TOC
    children.push(
      new Paragraph({
        children: [new PageBreak()]
      })
    );
  }

  // Add each section
  sections.forEach((section, index) => {
    // Section heading
    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    );

    // Section content - split by newlines for proper paragraph handling
    const contentLines = section.content.split('\n');
    contentLines.forEach((line: string) => {
      // Check for markdown headers
      if (line.startsWith('## ')) {
        children.push(
          new Paragraph({
            text: line.replace('## ', ''),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 }
          })
        );
      } else if (line.startsWith('### ')) {
        children.push(
          new Paragraph({
            text: line.replace('### ', ''),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 80 }
          })
        );
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '• ' + line.substring(2),
                size: 22
              })
            ],
            spacing: { before: 60, after: 60 },
            indent: { left: 720 }
          })
        );
      } else if (line.trim()) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                size: 22
              })
            ],
            spacing: { before: 60, after: 60 }
          })
        );
      }
    });

    // Add page break between sections (except last)
    if (index < sections.length - 1) {
      children.push(
        new Paragraph({
          children: [new PageBreak()]
        })
      );
    }
  });

  // Create document
  const doc = new Document({
    creator: 'OpenAgentic',
    title: options.reportTitle,
    description: 'Azure Infrastructure Report',
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: options.reportTitle,
                    size: 18,
                    color: '888888'
                  })
                ],
                alignment: AlignmentType.RIGHT
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Page ',
                    size: 18
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT]
                  }),
                  new TextRun({
                    text: ' of ',
                    size: 18
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES]
                  }),
                  new TextRun({
                    text: `  |  ${options.company || 'OpenAgentic'}`,
                    size: 18,
                    color: '888888'
                  })
                ],
                alignment: AlignmentType.CENTER
              })
            ]
          })
        },
        children
      }
    ]
  });

  return Buffer.from(await Packer.toBuffer(doc));
}