/**
 * ServiceBase - Standardized async patterns for all services
 * 
 * FIXES AI-GENERATED INCONSISTENCIES:
 * - Standardized error handling with retry logic
 * - Consistent async/await patterns (no callbacks/mixed promises)
 * - Structured logging for all services
 * - Timeout and abort controller management
 * - Type-safe response handling
 */

import { AppError, ValidationError, NetworkError, TimeoutError } from './errors';

export interface RetryOptions {
  retries?: number;
  delay?: number;
  backoffMultiplier?: number;
  maxDelay?: number;
  onError?: (error: Error, attempt: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

export interface RequestOptions {
  timeout?: number;
  retries?: RetryOptions;
  abortSignal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface ServiceConfig {
  baseURL?: string;
  defaultTimeout?: number;
  defaultRetries?: RetryOptions;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Base class for all services - eliminates async pattern inconsistencies
 */
export abstract class ServiceBase {
  protected logger: ServiceLogger;
  protected config: Required<ServiceConfig>;

  constructor(protected name: string, config: ServiceConfig = {}) {
    this.config = {
      baseURL: config.baseURL || '',
      defaultTimeout: config.defaultTimeout || 30000,
      defaultRetries: {
        retries: 3,
        delay: 1000,
        backoffMultiplier: 2,
        maxDelay: 10000,
        shouldRetry: this.defaultShouldRetry,
        ...config.defaultRetries
      },
      logLevel: config.logLevel || 'info'
    };

    this.logger = new ServiceLogger(name, this.config.logLevel);
  }

  /**
   * Execute operation with consistent retry logic
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const config = { ...this.config.defaultRetries, ...options };
    const { retries = 3, delay = 1000, backoffMultiplier = 2, maxDelay = 10000 } = config;

    let lastError: Error;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const result = await operation();
        
        if (attempt > 1) {
          this.logger.info(`Operation succeeded after ${attempt} attempts`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        this.logger.warn(`Operation failed on attempt ${attempt}`, {
          error: lastError.message,
          attempt,
          maxAttempts: retries + 1
        });

        config.onError?.(lastError, attempt);

        // Don't retry on last attempt
        if (attempt === retries + 1) break;

        // Check if we should retry this error
        if (config.shouldRetry && !config.shouldRetry(lastError)) {
          this.logger.warn('Error not retryable, failing immediately', {
            error: lastError.message
          });
          break;
        }

        // Calculate delay with exponential backoff
        const currentDelay = Math.min(delay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
        
        this.logger.debug(`Retrying in ${currentDelay}ms...`);
        await this.sleep(currentDelay);
      }
    }

    throw lastError;
  }

  /**
   * Standardized HTTP request method - eliminates fetch inconsistencies
   */
  protected async request<T>(
    endpoint: string,
    options: RequestInit & RequestOptions = {}
  ): Promise<T> {
    const {
      timeout = this.config.defaultTimeout,
      retries,
      abortSignal,
      headers = {},
      ...fetchOptions
    } = options;

    const url = this.buildURL(endpoint);

    return this.executeWithRetry(async () => {
      // Create timeout controller
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

      // Combine abort signals
      const combinedSignal = abortSignal ? 
        this.combineAbortSignals([abortSignal, timeoutController.signal]) :
        timeoutController.signal;

      try {
        this.logger.debug(`Making request to ${url}`, {
          method: fetchOptions.method || 'GET',
          headers
        });

        const response = await fetch(url, {
          ...fetchOptions,
          signal: combinedSignal,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new NetworkError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            url
          );
        }

        // Handle different response types
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return await response.json();
        } else if (contentType?.includes('text/')) {
          return await response.text() as unknown as T;
        } else {
          return await response.blob() as unknown as T;
        }

      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof DOMException && error.name === 'AbortError') {
          if (abortSignal?.aborted) {
            throw new AppError('OPERATION_CANCELLED', 'Request was cancelled', 499);
          } else {
            throw new TimeoutError(`Request timed out after ${timeout}ms`, timeout);
          }
        }

        throw error;
      }
    }, retries);
  }

  /**
   * GET request with standardized error handling
   */
  protected async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST request with standardized error handling
   */
  protected async post<T>(
    endpoint: string, 
    data?: any, 
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /**
   * PUT request with standardized error handling
   */
  protected async put<T>(
    endpoint: string, 
    data?: any, 
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /**
   * DELETE request with standardized error handling
   */
  protected async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Validate input data - prevents runtime errors
   */
  protected validateInput<T>(
    data: unknown,
    validator: (data: unknown) => data is T,
    errorMessage = 'Invalid input data'
  ): T {
    if (!validator(data)) {
      throw new ValidationError(errorMessage);
    }
    return data;
  }

  /**
   * Handle errors consistently across all services
   */
  protected handleError(error: unknown, context?: string): never {
    if (error instanceof AppError) {
      this.logger.error(`${context ? `${context}: ` : ''}${error.message}`, {
        code: error.code,
        statusCode: error.statusCode,
        context
      });
      throw error;
    }

    if (error instanceof Error) {
      this.logger.error(`${context ? `${context}: ` : ''}${error.message}`, {
        error: error.stack,
        context
      });
      throw new AppError('INTERNAL_ERROR', error.message, 500);
    }

    const unknownError = new AppError('UNKNOWN_ERROR', 'An unknown error occurred', 500);
    this.logger.error('Unknown error occurred', { error, context });
    throw unknownError;
  }

  /**
   * Default retry logic for common scenarios
   */
  private defaultShouldRetry = (error: Error): boolean => {
    // Don't retry validation errors
    if (error instanceof ValidationError) return false;
    
    // Don't retry 4xx client errors (except 429)
    if (error instanceof NetworkError && error.statusCode >= 400 && error.statusCode < 500) {
      return error.statusCode === 429; // Retry rate limits
    }

    // Retry 5xx server errors, network errors, timeouts
    return error instanceof NetworkError || 
           error instanceof TimeoutError ||
           error.message.includes('fetch');
  };

  private buildURL(endpoint: string): string {
    if (endpoint.startsWith('http')) return endpoint;
    return `${this.config.baseURL}${endpoint}`;
  }

  private combineAbortSignals(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }
      
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    
    return controller.signal;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Standardized logging for services
 */
class ServiceLogger {
  constructor(
    private serviceName: string,
    private level: 'debug' | 'info' | 'warn' | 'error'
  ) {}

  private shouldLog(level: string): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level as keyof typeof levels] >= levels[this.level];
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog('debug')) {
      // console.debug(`[${this.serviceName}] ${message}`, meta);
    }
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog('info')) {
      // console.info(`[${this.serviceName}] ${message}`, meta);
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog('warn')) {
      // console.warn(`[${this.serviceName}] ${message}`, meta);
    }
  }

  error(message: string, meta?: any): void {
    if (this.shouldLog('error')) {
      console.error(`[${this.serviceName}] ${message}`, meta);
    }
  }
}