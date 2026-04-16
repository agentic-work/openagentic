/**
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

// Import the single source of truth ChatMessage
import type { ChatMessage } from '@/types/index';
export type { ChatMessage };

export interface ExportOptions {
  format: 'pdf' | 'html' | 'markdown' | 'json';
  includeMetadata?: boolean;
  includeTimestamps?: boolean;
  includeTokenUsage?: boolean;
  theme?: 'light' | 'dark' | 'auto';
  pageSize?: 'A4' | 'Letter' | 'Legal';
  orientation?: 'portrait' | 'landscape';
  quality?: 'low' | 'medium' | 'high';
  customStyles?: string;
  summary?: {
    includeStats?: boolean;
    includeOverview?: boolean;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  metadata?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    totalTokens?: number;
    totalCost?: number;
  };
}

export interface ExportData {
  session: ChatSession;
  exportOptions: ExportOptions;
  exportedAt: string;
  userInfo?: {
    name?: string;
    email?: string;
  };
}

export interface ExportResult {
  success: boolean;
  data?: Blob | string;
  filename?: string;
  error?: string;
}

export interface IExportService {
  exportToPDF(data: ExportData): Promise<ExportResult>;
  exportToHTML(data: ExportData): Promise<ExportResult>;
  exportToMarkdown(data: ExportData): Promise<ExportResult>;
  exportToJSON(data: ExportData): Promise<ExportResult>;
}

export interface ReportTemplate {
  name: string;
  description: string;
  template: string;
  styles: string;
  variables: Record<string, any>;
}

export interface PDFGenerationOptions extends ExportOptions {
  template?: ReportTemplate;
  header?: {
    title?: string;
    subtitle?: string;
    logo?: string;
  };
  footer?: {
    includePageNumbers?: boolean;
    includeDate?: boolean;
    customText?: string;
  };
  tableOfContents?: boolean;
  summary?: {
    includeStats?: boolean;
    includeKeyInsights?: boolean;
    customSummary?: string;
  };
}