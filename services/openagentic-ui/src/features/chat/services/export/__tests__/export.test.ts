import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExportService } from '../index';
import { ClientExportService } from '../client';
import { formatMarkdown, generateHTML, formatJSON } from '../utils';
import type { ChatSession, ExportOptions, ChatMessage } from '../types';

// Mock external libraries
vi.mock('jspdf', () => ({
  default: vi.fn()
}));

vi.mock('html2canvas', () => ({
  default: vi.fn()
}));

vi.mock('html2pdf.js', () => ({
  default: vi.fn(() => ({
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    outputPdf: vi.fn().mockResolvedValue(new Blob(['pdf content'], { type: 'application/pdf' }))
  }))
}));

// Mock DOM methods
const mockCreateElement = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();

Object.defineProperty(global, 'document', {
  value: {
    createElement: mockCreateElement,
    body: {
      appendChild: mockAppendChild,
      removeChild: mockRemoveChild
    }
  }
});

Object.defineProperty(global, 'URL', {
  value: {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL
  }
});

describe('Export Service', () => {
  let exportService: ExportService;
  let mockSession: ChatSession;
  let mockMessages: ChatMessage[];

  beforeEach(() => {
    exportService = new ExportService();
    
    mockMessages = [
      {
        id: '1',
        role: 'user',
        content: 'Hello, can you help me with a coding question?',
        timestamp: '2025-01-15T10:00:00Z',
        tokenUsage: {
          promptTokens: 12,
          completionTokens: 0,
          totalTokens: 12
        }
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Of course! I\'d be happy to help you with your coding question. What specific programming language or problem are you working with?',
        timestamp: '2025-01-15T10:00:05Z',
        tokenUsage: {
          promptTokens: 12,
          completionTokens: 28,
          totalTokens: 40
        }
      },
      {
        id: '3',
        role: 'user',
        content: 'I need to implement a **binary search** algorithm in JavaScript. Here\'s what I have so far:\n\n```javascript\nfunction binarySearch(arr, target) {\n  // TODO: implement\n}\n```',
        timestamp: '2025-01-15T10:01:00Z',
        tokenUsage: {
          promptTokens: 45,
          completionTokens: 0,
          totalTokens: 45
        }
      }
    ];

    mockSession = {
      id: 'session-123',
      title: 'Binary Search Implementation Help',
      messages: mockMessages,
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:01:00Z',
      metadata: {
        model: 'claude-3-opus',
        temperature: 0.7,
        maxTokens: 4096,
        totalTokens: 97,
        totalCost: 0.00194
      }
    };

    // Reset mocks
    vi.clearAllMocks();
    mockCreateElement.mockReturnValue({
      style: {},
      innerHTML: '',
      href: '',
      download: '',
      click: vi.fn()
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ExportService', () => {
    it('should create export data with default options', () => {
      const exportData = exportService.createExportData(mockSession);
      
      expect(exportData.session).toEqual(mockSession);
      expect(exportData.exportOptions.format).toBe('pdf');
      expect(exportData.exportOptions.includeMetadata).toBe(true);
      expect(exportData.exportOptions.includeTimestamps).toBe(true);
      expect(exportData.exportOptions.includeTokenUsage).toBe(true);
      expect(exportData.exportedAt).toBeDefined();
    });

    it('should merge custom options with defaults', () => {
      const customOptions: Partial<ExportOptions> = {
        format: 'html',
        theme: 'dark',
        includeMetadata: false
      };
      
      const exportData = exportService.createExportData(mockSession, customOptions);
      
      expect(exportData.exportOptions.format).toBe('html');
      expect(exportData.exportOptions.theme).toBe('dark');
      expect(exportData.exportOptions.includeMetadata).toBe(false);
      expect(exportData.exportOptions.includeTimestamps).toBe(true); // Should keep default
    });

    it('should validate export options correctly', () => {
      const validOptions: Partial<ExportOptions> = {
        format: 'pdf',
        theme: 'light',
        pageSize: 'A4',
        orientation: 'portrait',
        quality: 'high'
      };
      
      const validation = exportService.validateOptions(validOptions);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid export options', () => {
      const invalidOptions: Partial<ExportOptions> = {
        format: 'invalid' as any,
        theme: 'purple' as any,
        pageSize: 'B5' as any
      };
      
      const validation = exportService.validateOptions(invalidOptions);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Invalid format specified');
      expect(validation.errors).toContain('Invalid theme specified');
      expect(validation.errors).toContain('Invalid page size specified');
    });

    it('should return available export formats', () => {
      const formats = exportService.getAvailableFormats();
      
      expect(formats).toHaveLength(4);
      expect(formats.map(f => f.format)).toEqual(['pdf', 'html', 'markdown', 'json']);
      expect(formats[0].name).toBe('PDF Report');
      expect(formats[0].description).toContain('Professional PDF document');
    });
  });

  describe('PDF Export', () => {
    it('should export to PDF successfully', async () => {
      const exportData = exportService.createExportData(mockSession, {
        format: 'pdf',
        quality: 'medium'
      });

      const result = await exportService.exportToPDF(exportData);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Blob);
      expect(result.filename).toContain('Binary Search Implementation Help');
      expect(result.filename).toContain('.pdf');
    });

    it('should create beautiful PDF report with enhanced options', async () => {
      const result = await exportService.createPDFReport(mockSession, {
        quality: 'high',
        theme: 'light',
        summary: {
          includeStats: true,
          includeKeyInsights: false
        }
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Blob);
      expect(result.filename).toBeDefined();
    });
  });

  describe('HTML Export', () => {
    it('should export to HTML successfully', async () => {
      const exportData = exportService.createExportData(mockSession, {
        format: 'html',
        theme: 'dark'
      });

      const result = await exportService.exportToHTML(exportData);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Blob);
      expect(result.filename).toContain('.html');
    });
  });

  describe('Markdown Export', () => {
    it('should export to Markdown successfully', async () => {
      const exportData = exportService.createExportData(mockSession, {
        format: 'markdown'
      });

      const result = await exportService.exportToMarkdown(exportData);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Blob);
      expect(result.filename).toContain('.md');
    });
  });

  describe('JSON Export', () => {
    it('should export to JSON successfully', async () => {
      const exportData = exportService.createExportData(mockSession, {
        format: 'json'
      });

      const result = await exportService.exportToJSON(exportData);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Blob);
      expect(result.filename).toContain('.json');
    });
  });

  describe('Quick Export', () => {
    it('should perform quick PDF export', async () => {
      const result = await exportService.quickExport(mockSession, 'pdf', {
        quality: 'medium'
      });
      
      expect(result.success).toBe(true);
      expect(result.filename).toContain('.pdf');
    });

    it('should perform quick HTML export', async () => {
      const result = await exportService.quickExport(mockSession, 'html');
      
      expect(result.success).toBe(true);
      expect(result.filename).toContain('.html');
    });

    it('should throw error for unsupported format', async () => {
      await expect(
        exportService.quickExport(mockSession, 'xml' as any)
      ).rejects.toThrow('Unsupported export format: xml');
    });
  });

  describe('Download Functionality', () => {
    it('should download export result', async () => {
      const mockBlob = new Blob(['test content'], { type: 'application/pdf' });
      const result = {
        success: true,
        data: mockBlob,
        filename: 'test-export.pdf'
      };

      mockCreateObjectURL.mockReturnValue('blob:test-url');
      
      await exportService.downloadExport(result);
      
      expect(mockCreateElement).toHaveBeenCalledWith('a');
      expect(mockAppendChild).toHaveBeenCalled();
      expect(mockRemoveChild).toHaveBeenCalled();
      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });

    it('should throw error for failed export result', async () => {
      const result = {
        success: false,
        error: 'Export failed'
      };

      await expect(exportService.downloadExport(result)).rejects.toThrow('Export failed');
    });

    it('should export and download in one operation', async () => {
      mockCreateObjectURL.mockReturnValue('blob:test-url');
      
      await exportService.exportAndDownload(mockSession, 'pdf', { quality: 'medium' });
      
      expect(mockCreateElement).toHaveBeenCalledWith('a');
      expect(mockAppendChild).toHaveBeenCalled();
      expect(mockRemoveChild).toHaveBeenCalled();
    });
  });
});

describe('Utility Functions', () => {
  let mockSession: ChatSession;
  let mockExportData: any;

  beforeEach(() => {
    mockSession = {
      id: 'session-123',
      title: 'Test Conversation',
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Hello **world**! Here is some `code` and more text.',
          timestamp: '2025-01-15T10:00:00Z',
          tokenUsage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 }
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Hello! Here\'s a code example:\n\n```javascript\nconsole.log("Hello");\n```\n\nThat\'s it!',
          timestamp: '2025-01-15T10:00:05Z',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
        }
      ],
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:05Z',
      metadata: {
        model: 'claude-3-opus',
        totalTokens: 40,
        totalCost: 0.0008
      }
    };

    mockExportData = {
      session: mockSession,
      exportOptions: {
        format: 'markdown' as const,
        includeMetadata: true,
        includeTimestamps: true,
        includeTokenUsage: true,
        theme: 'light' as const
      },
      exportedAt: '2025-01-15T10:01:00Z',
      userInfo: { name: 'John Doe' }
    };
  });

  describe('formatMarkdown', () => {
    it('should format export data as markdown correctly', () => {
      const result = formatMarkdown(mockExportData);
      
      expect(result).toContain('# Test Conversation');
      expect(result).toContain('## Session Information');
      expect(result).toContain('## Conversation');
      expect(result).toContain('### 👤 User');
      expect(result).toContain('### 🤖 Assistant');
      expect(result).toContain('- **Message Count:** 2');
      expect(result).toContain('- **Model:** claude-3-opus');
      expect(result).toContain('- **User:** John Doe');
      expect(result).toContain('Generated by OpenAgentic Chat');
    });

    it('should exclude metadata when option is false', () => {
      mockExportData.exportOptions.includeMetadata = false;
      const result = formatMarkdown(mockExportData);
      
      expect(result).not.toContain('## Session Information');
      expect(result).not.toContain('- **Model:**');
    });

    it('should exclude timestamps when option is false', () => {
      mockExportData.exportOptions.includeTimestamps = false;
      const result = formatMarkdown(mockExportData);
      
      expect(result).not.toContain('*(');
      expect(result).not.toContain(')*');
    });

    it('should exclude token usage when option is false', () => {
      mockExportData.exportOptions.includeTokenUsage = false;
      const result = formatMarkdown(mockExportData);
      
      expect(result).not.toContain('tokens');
    });
  });

  describe('generateHTML', () => {
    it('should generate HTML with proper structure', () => {
      const result = generateHTML(mockExportData);
      
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<title>Test Conversation - Chat Export</title>');
      expect(result).toContain('<h1>Test Conversation</h1>');
      expect(result).toContain('class="message"');
      expect(result).toContain('class="message-avatar user"');
      expect(result).toContain('class="message-avatar assistant"');
      expect(result).toContain('OpenAgentic Chat Export');
    });

    it('should apply dark theme colors', () => {
      mockExportData.exportOptions.theme = 'dark';
      const result = generateHTML(mockExportData);
      
      expect(result).toContain('#111827'); // Dark background
      expect(result).toContain('#f3f4f6'); // Light text
    });

    it('should apply light theme colors', () => {
      mockExportData.exportOptions.theme = 'light';
      const result = generateHTML(mockExportData);
      
      expect(result).toContain('#ffffff'); // Light background
      expect(result).toContain('#111827'); // Dark text
    });

    it('should include custom styles when provided', () => {
      mockExportData.exportOptions.customStyles = '.custom { color: red; }';
      const result = generateHTML(mockExportData);
      
      expect(result).toContain('.custom { color: red; }');
    });
  });

  describe('formatJSON', () => {
    it('should format export data as valid JSON', () => {
      const result = formatJSON(mockExportData);
      const parsed = JSON.parse(result);
      
      expect(parsed.format).toBe('openagentic-chat-export');
      expect(parsed.version).toBe('1.0');
      expect(parsed.session.title).toBe('Test Conversation');
      expect(parsed.session.messages).toHaveLength(2);
      expect(parsed.statistics.totalMessages).toBe(2);
      expect(parsed.statistics.userMessages).toBe(1);
      expect(parsed.statistics.assistantMessages).toBe(1);
      expect(parsed.statistics.totalTokens).toBe(40);
    });

    it('should include all message properties', () => {
      const result = formatJSON(mockExportData);
      const parsed = JSON.parse(result);
      
      const firstMessage = parsed.session.messages[0];
      expect(firstMessage.id).toBe('1');
      expect(firstMessage.role).toBe('user');
      expect(firstMessage.content).toBe('Hello **world**! Here is some `code` and more text.');
      expect(firstMessage.timestamp).toBe('2025-01-15T10:00:00Z');
      expect(firstMessage.tokenUsage.totalTokens).toBe(10);
    });

    it('should calculate statistics correctly', () => {
      const result = formatJSON(mockExportData);
      const parsed = JSON.parse(result);
      
      expect(parsed.statistics.totalMessages).toBe(2);
      expect(parsed.statistics.userMessages).toBe(1);
      expect(parsed.statistics.assistantMessages).toBe(1);
      expect(parsed.statistics.systemMessages).toBe(0);
      expect(parsed.statistics.totalTokens).toBe(40);
      expect(parsed.statistics.averageTokensPerMessage).toBe(20);
      expect(parsed.statistics.conversationDuration).toBe(0); // Less than 1 minute
    });
  });
});