/**

 * 
 * Multi-Modal Memory Processor
 * 
 * Features:
 * - Process text, image, and file memories
 * - Extract metadata and context from different modalities
 * - Unified context generation from multi-modal sources
 * - Content analysis and summarization
 */

import { FileAttachmentService } from './FileAttachmentService.js';
import type { Logger } from 'pino';

export interface MultiModalMemory {
  id: string;
  type: 'text' | 'image' | 'file' | 'multi-modal';
  components: {
    text?: string;
    image?: ImageComponent;
    file?: FileComponent;
  };
  unified_context: string;
  metadata: {
    processing_time: number;
    confidence_score: number;
    extracted_entities: string[];
    modality_weights: Record<string, number>;
  };
  created_at: number;
}

export interface ImageComponent {
  id: string;
  type: string;
  analysis: string;
  extracted_text?: string;
  detected_objects?: string[];
  dominant_colors?: string[];
  dimensions?: { width: number; height: number };
}

export interface FileComponent {
  id: string;
  type: string;
  summary: string;
  extracted_text?: string;
  key_sections?: string[];
  document_type?: 'pdf' | 'doc' | 'spreadsheet' | 'presentation' | 'code' | 'other';
}

export interface ProcessingResult {
  success: boolean;
  multiModalMemory?: MultiModalMemory;
  error?: string;
  processing_time: number;
}

export class MultiModalMemoryProcessor {
  private logger: any;
  private fileAttachmentService?: FileAttachmentService;
  private config: {
    maxImageSize: number;
    maxFileSize: number;
    enableImageAnalysis: boolean;
    enableTextExtraction: boolean;
    confidenceThreshold: number;
  };

  constructor(
    logger: any, 
    fileAttachmentService?: FileAttachmentService,
    config?: Partial<typeof MultiModalMemoryProcessor.prototype.config>
  ) {
    this.logger = logger.child({ service: 'MultiModalMemoryProcessor' }) as Logger;
    this.fileAttachmentService = fileAttachmentService;
    this.config = {
      maxImageSize: 10 * 1024 * 1024, // 10MB
      maxFileSize: 50 * 1024 * 1024,  // 50MB
      enableImageAnalysis: true,
      enableTextExtraction: true,
      confidenceThreshold: 0.7,
      ...config
    };
  }

  /**
   * Process multi-modal memory from various inputs
   */
  async processMultiModalMemory(input: {
    text?: string;
    imageId?: string;
    fileId?: string;
    userId: string;
    sessionId?: string;
  }): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      this.logger.debug({ input }, 'Starting multi-modal memory processing');

      const components: MultiModalMemory['components'] = {};
      const extractedEntities: string[] = [];
      let totalConfidence = 0;
      let componentCount = 0;

      // Process text component
      if (input.text) {
        components.text = input.text;
        extractedEntities.push(...this.extractTextEntities(input.text));
        totalConfidence += 0.9; // Text processing is highly reliable
        componentCount++;
      }

      // Process image component
      if (input.imageId && this.config.enableImageAnalysis) {
        const imageComponent = await this.processImageComponent(input.imageId, input.userId);
        if (imageComponent) {
          components.image = imageComponent;
          extractedEntities.push(...(imageComponent.detected_objects || []));
          totalConfidence += 0.7; // Image analysis is less reliable
          componentCount++;
        }
      }

      // Process file component
      if (input.fileId && this.config.enableTextExtraction && this.fileAttachmentService) {
        const fileComponent = await this.processFileComponent(input.fileId, input.userId);
        if (fileComponent) {
          components.file = fileComponent;
          extractedEntities.push(...this.extractTextEntities(fileComponent.summary));
          totalConfidence += 0.8; // File processing reliability varies
          componentCount++;
        }
      }

      if (componentCount === 0) {
        return {
          success: false,
          error: 'No valid components to process',
          processing_time: Date.now() - startTime
        };
      }

      // Generate unified context
      const unifiedContext = this.generateUnifiedContext(components);
      const averageConfidence = componentCount > 0 ? totalConfidence / componentCount : 0;

      if (averageConfidence < this.config.confidenceThreshold) {
        this.logger.warn({ averageConfidence }, 'Low confidence in multi-modal processing');
      }

      // Calculate modality weights
      const modalityWeights = this.calculateModalityWeights(components);

      const multiModalMemory: MultiModalMemory = {
        id: `mm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: componentCount > 1 ? 'multi-modal' : this.getSingleModalityType(components),
        components,
        unified_context: unifiedContext,
        metadata: {
          processing_time: Date.now() - startTime,
          confidence_score: averageConfidence,
          extracted_entities: Array.from(new Set(extractedEntities)), // Remove duplicates
          modality_weights: modalityWeights
        },
        created_at: Date.now()
      };

      this.logger.info({ 
        memoryId: multiModalMemory.id,
        componentCount,
        confidenceScore: averageConfidence,
        processingTime: multiModalMemory.metadata.processing_time
      }, 'Multi-modal memory processing completed');

      return {
        success: true,
        multiModalMemory,
        processing_time: multiModalMemory.metadata.processing_time
      };

    } catch (error) {
      this.logger.error({ error: error.message, input }, 'Multi-modal memory processing failed');
      return {
        success: false,
        error: error.message,
        processing_time: Date.now() - startTime
      };
    }
  }

  /**
   * Enhance existing memory with multi-modal components
   */
  async enhanceMemoryWithMultiModal(
    existingMemory: { content: string; entities: string[] },
    additionalComponents: { imageId?: string; fileId?: string },
    userId: string
  ): Promise<MultiModalMemory | null> {
    try {
      const processingResult = await this.processMultiModalMemory({
        text: existingMemory.content,
        imageId: additionalComponents.imageId,
        fileId: additionalComponents.fileId,
        userId
      });

      if (processingResult.success && processingResult.multiModalMemory) {
        // Merge existing entities with newly extracted ones
        const allEntities = [
          ...existingMemory.entities,
          ...processingResult.multiModalMemory.metadata.extracted_entities
        ];

        processingResult.multiModalMemory.metadata.extracted_entities = Array.from(new Set(allEntities));
        
        return processingResult.multiModalMemory;
      }

      return null;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Memory enhancement failed');
      return null;
    }
  }

  /**
   * Extract searchable text from multi-modal memory
   */
  extractSearchableText(multiModalMemory: MultiModalMemory): string {
    const textParts: string[] = [];

    // Add text component
    if (multiModalMemory.components.text) {
      textParts.push(multiModalMemory.components.text);
    }

    // Add image analysis text
    if (multiModalMemory.components.image) {
      textParts.push(multiModalMemory.components.image.analysis);
      if (multiModalMemory.components.image.extracted_text) {
        textParts.push(multiModalMemory.components.image.extracted_text);
      }
    }

    // Add file content text
    if (multiModalMemory.components.file) {
      textParts.push(multiModalMemory.components.file.summary);
      if (multiModalMemory.components.file.extracted_text) {
        textParts.push(multiModalMemory.components.file.extracted_text.substring(0, 1000)); // Limit length
      }
    }

    return textParts.join(' ').trim();
  }

  // Private helper methods

  private async processImageComponent(imageId: string, userId: string): Promise<ImageComponent | null> {
    try {
      // This is a mock implementation - in production would integrate with:
      // - OpenAI Vision API
      // - Google Cloud Vision API  
      // - AWS Rekognition
      // - Local computer vision models

      this.logger.debug({ imageId, userId }, 'Processing image component');

      // Simulate image analysis
      const mockImageAnalysis: ImageComponent = {
        id: imageId,
        type: 'image/jpeg',
        analysis: 'Image analysis not yet implemented - would extract objects, text, and scene understanding',
        detected_objects: ['placeholder_object'],
        dominant_colors: ['#FF5733', '#33FF57'],
        dimensions: { width: 800, height: 600 }
      };

      return mockImageAnalysis;

    } catch (error) {
      this.logger.error({ imageId, error: error.message }, 'Image processing failed');
      return null;
    }
  }

  private async processFileComponent(fileId: string, userId: string): Promise<FileComponent | null> {
    try {
      this.logger.debug({ fileId, userId }, 'Processing file component');

      if (!this.fileAttachmentService) {
        this.logger.warn('File attachment service not available');
        return null;
      }

      // Get file metadata
      const file = await this.fileAttachmentService.getFile(fileId, userId);
      if (!file) {
        this.logger.warn({ fileId }, 'File not found');
        return null;
      }

      // Extract text if supported file type
      let extractedText: string | undefined;
      let documentType: FileComponent['document_type'] = 'other';

      try {
        extractedText = await this.fileAttachmentService.extractTextFromFile(fileId);
        documentType = this.determineDocumentType(file.mimeType);
      } catch (error) {
        this.logger.debug({ fileId, error: error.message }, 'Text extraction failed or not supported');
      }

      const summary = extractedText 
        ? this.generateFileTextSummary(extractedText)
        : `${file.mimeType} file: ${file.originalName}`;

      const fileComponent: FileComponent = {
        id: fileId,
        type: file.mimeType,
        summary,
        extracted_text: extractedText?.substring(0, 2000), // Limit size
        key_sections: extractedText ? this.extractKeySections(extractedText) : undefined,
        document_type: documentType
      };

      return fileComponent;

    } catch (error) {
      this.logger.error({ fileId, error: error.message }, 'File processing failed');
      return null;
    }
  }

  private extractTextEntities(text: string): string[] {
    // Simple entity extraction - in production would use NLP libraries like spaCy or cloud APIs
    const entities: string[] = [];

    // Extract capitalized words (potential proper nouns)
    const capitalizedWords = text.match(/\b[A-Z][a-z]+\b/g) || [];
    entities.push(...capitalizedWords);

    // Extract technical terms
    const techTerms = ['API', 'database', 'server', 'React', 'JavaScript', 'Python', 'Docker'];
    for (const term of techTerms) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        entities.push(term);
      }
    }

    // Extract dates
    const datePattern = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
    const dates = text.match(datePattern) || [];
    entities.push(...dates);

    return Array.from(new Set(entities)).slice(0, 10); // Limit and deduplicate
  }

  private generateUnifiedContext(components: MultiModalMemory['components']): string {
    const contextParts: string[] = [];

    if (components.text) {
      contextParts.push(`Text: ${components.text.substring(0, 200)}${components.text.length > 200 ? '...' : ''}`);
    }

    if (components.image) {
      contextParts.push(`Image: ${components.image.analysis}`);
    }

    if (components.file) {
      contextParts.push(`File (${components.file.document_type}): ${components.file.summary}`);
    }

    const unified = contextParts.join(' | ');
    return unified || 'Multi-modal content processed';
  }

  private calculateModalityWeights(components: MultiModalMemory['components']): Record<string, number> {
    const weights: Record<string, number> = {};
    let totalWeight = 0;

    // Text gets highest weight as it's most reliable for search
    if (components.text) {
      weights.text = 0.5;
      totalWeight += 0.5;
    }

    // File content gets good weight if text extraction succeeded
    if (components.file) {
      const fileWeight = components.file.extracted_text ? 0.4 : 0.2;
      weights.file = fileWeight;
      totalWeight += fileWeight;
    }

    // Images get lower weight due to analysis complexity
    if (components.image) {
      weights.image = 0.2;
      totalWeight += 0.2;
    }

    // Normalize weights to sum to 1.0
    if (totalWeight > 0) {
      for (const [key, weight] of Object.entries(weights)) {
        weights[key] = weight / totalWeight;
      }
    }

    return weights;
  }

  private getSingleModalityType(components: MultiModalMemory['components']): 'text' | 'image' | 'file' {
    if (components.text && !components.image && !components.file) return 'text';
    if (components.image && !components.text && !components.file) return 'image';
    if (components.file && !components.text && !components.image) return 'file';
    return 'text'; // Default fallback
  }

  private determineDocumentType(mimeType: string): FileComponent['document_type'] {
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'doc';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation';
    if (mimeType.includes('javascript') || mimeType.includes('python') || 
        mimeType.includes('code') || mimeType.startsWith('text/')) return 'code';
    return 'other';
  }

  private generateFileTextSummary(text: string): string {
    // Simple extractive summary - take first few sentences
    const sentences = text.match(/[^\.!?]+[\.!?]+/g) || [];
    const summary = sentences.slice(0, 3).join(' ').substring(0, 300);
    return summary.trim() || 'File content processed';
  }

  private extractKeySections(text: string): string[] {
    const sections: string[] = [];

    // Look for headings (lines with special formatting)
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Detect potential headings
      if (trimmed.length > 0 && (
        trimmed.endsWith(':') ||
        trimmed.match(/^\d+\./) ||
        trimmed.match(/^[A-Z\s]+$/) ||
        trimmed.startsWith('#')
      )) {
        sections.push(trimmed);
      }
    }

    return sections.slice(0, 10); // Limit number of sections
  }

  /**
   * Health check for multi-modal processor
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic text processing
      const testResult = await this.processMultiModalMemory({
        text: 'Test multi-modal processing functionality',
        userId: 'health-check-user'
      });

      return testResult.success;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Multi-modal processor health check failed');
      return false;
    }
  }
}