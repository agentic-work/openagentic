import { Memory, Conversation } from './Memory.js';

/**
 * GPU processing types with optional GPU support
 * Some deployments may not have GPU access initially
 */

export interface GPUCapabilities {
  available: boolean;
  provider: 'cuda' | 'cpu-only' | 'azure-gpu';
  models: string[];
  memoryGB?: number;
  computeUnits?: number;
  maxConcurrentJobs: number;
}

export interface ProcessingJob {
  id: string;
  type: 'embedding' | 'summarization' | 'entity_extraction' | 'sentiment_analysis';
  priority: 'low' | 'normal' | 'high';
  userId: string;
  input: {
    text?: string;
    conversation?: Conversation;
    memories?: Memory[];
    metadata?: Record<string, any>;
  };
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
  };
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: any;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  estimatedDuration?: number;
}

export interface GPUProviderConfig {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  models: {
    embedding: string;
    summarization: string;
    extraction: string;
  };
  timeout: number;
  retries: number;
  fallbackToCPU: boolean;
}

export interface BackgroundProcessor {
  id: string;
  type: 'gpu' | 'cpu';
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentJobs: string[];
  capabilities: GPUCapabilities;
  metrics: {
    jobsProcessed: number;
    averageLatency: number;
    errorRate: number;
    uptime: number;
  };
  lastHealthCheck: number;
}

export interface ProcessingQueue {
  pending: ProcessingJob[];
  active: ProcessingJob[];
  completed: ProcessingJob[];
  failed: ProcessingJob[];
  maxSize: number;
  processors: BackgroundProcessor[];
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
  userId?: string;
  priority?: ProcessingJob['priority'];
  batchSize?: number;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  processingTime: number;
  tokenCount: number;
}

export interface SummarizationRequest {
  conversation: Conversation;
  maxTokens?: number;
  style?: 'brief' | 'detailed' | 'technical';
  userId: string;
  priority?: ProcessingJob['priority'];
}

export interface SummarizationResult {
  summary: string;
  keyPoints: string[];
  entities: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  importance: number;
  tokenCount: number;
  processingTime: number;
}

export interface EntityExtractionRequest {
  text: string;
  context?: string[];
  userId: string;
  priority?: ProcessingJob['priority'];
}

export interface EntityExtractionResult {
  entities: Array<{
    name: string;
    type: string;
    confidence: number;
    mentions: number;
    context: string[];
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    confidence: number;
  }>;
  processingTime: number;
}

export interface ProcessingMetrics {
  queue: {
    pending: number;
    active: number;
    completed: number;
    failed: number;
  };
  performance: {
    averageLatency: number;
    throughputPerMinute: number;
    errorRate: number;
    cpuUsage: number;
    memoryUsage: number;
  };
  gpu?: {
    utilization: number;
    memoryUsed: number;
    temperature: number;
    powerUsage: number;
  };
  processors: BackgroundProcessor[];
}

export interface ProcessingConfig {
  gpu: {
    enabled: boolean;
    fallbackToCPU: boolean;
    maxConcurrentJobs: number;
    timeout: number;
  };
  provider: GPUProviderConfig;
  queue: {
    maxSize: number;
    retryAttempts: number;
    retryDelay: number;
    priorityLevels: Record<ProcessingJob['priority'], number>;
  };
  monitoring: {
    healthCheckInterval: number;
    metricsCollectionInterval: number;
    alertThresholds: {
      errorRate: number;
      latency: number;
      queueSize: number;
    };
  };
}

export interface ProcessingJobResult {
  jobId: string;
  success: boolean;
  result?: any;
  error?: string;
  metrics: {
    startTime: number;
    endTime: number;
    duration: number;
    processorId: string;
    processorType: 'gpu' | 'cpu';
  };
}

export interface HealthCheckResult {
  processorId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  capabilities: GPUCapabilities;
  metrics: {
    latency: number;
    throughput: number;
    errorRate: number;
    resourceUsage: {
      cpu: number;
      memory: number;
      gpu?: number;
    };
  };
  timestamp: number;
}