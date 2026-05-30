/**
 * Unified Error Handling System
 * 
 * ELIMINATES AI-GENERATED ERROR INCONSISTENCIES:
 * - Standardized error types and messages
 * - Consistent error codes and HTTP status mapping
 * - Type-safe error handling with proper inheritance
 * - Context preservation for debugging
 * - User-friendly error messages
 */

/**
 * Base application error - all custom errors extend this
 */
export class AppError extends Error {
  public readonly isOperational: boolean = true;
  public readonly timestamp: Date = new Date();
  public readonly context?: Record<string, any>;

  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;

    // Maintain proper stack trace for V8
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, this.constructor);
    }

    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString(),
      context: this.context
    };
  }

  /**
   * Get user-friendly message (hide technical details)
   */
  getUserMessage(): string {
    // Override in subclasses for user-specific messages
    return this.message;
  }
}

/**
 * Validation errors (400)
 */
export class ValidationError extends AppError {
  constructor(
    message: string, 
    field?: string,
    value?: any,
    context?: Record<string, any>
  ) {
    super(
      'VALIDATION_ERROR', 
      message, 
      400,
      { ...context, field, value }
    );
  }

  getUserMessage(): string {
    return `Please check your input: ${this.message}`;
  }
}

/**
 * Authentication errors (401)
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: Record<string, any>) {
    super('AUTHENTICATION_ERROR', message, 401, context);
  }

  getUserMessage(): string {
    return 'Please log in to continue';
  }
}

/**
 * Authorization errors (403)
 */
export class AuthorizationError extends AppError {
  constructor(
    message: string = 'Insufficient permissions',
    requiredPermission?: string,
    context?: Record<string, any>
  ) {
    super(
      'AUTHORIZATION_ERROR', 
      message, 
      403, 
      { ...context, requiredPermission }
    );
  }

  getUserMessage(): string {
    return 'You do not have permission to perform this action';
  }
}

/**
 * Resource not found errors (404)
 */
export class NotFoundError extends AppError {
  constructor(
    resource: string,
    identifier?: string,
    context?: Record<string, any>
  ) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;

    super(
      'NOT_FOUND_ERROR',
      message,
      404,
      { ...context, resource, identifier }
    );
  }

  getUserMessage(): string {
    return 'The requested item could not be found';
  }
}

/**
 * Conflict errors (409) - for duplicate resources
 */
export class ConflictError extends AppError {
  constructor(
    message: string,
    conflictingResource?: string,
    context?: Record<string, any>
  ) {
    super(
      'CONFLICT_ERROR',
      message,
      409,
      { ...context, conflictingResource }
    );
  }

  getUserMessage(): string {
    return 'This action conflicts with existing data';
  }
}

/**
 * Network/HTTP errors
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly url?: string,
    context?: Record<string, any>
  ) {
    super('NETWORK_ERROR', message, statusCode, { ...context, url });
  }

  getUserMessage(): string {
    if (this.statusCode >= 500) {
      return 'Server error - please try again later';
    }
    if (this.statusCode === 429) {
      return 'Too many requests - please wait a moment and try again';
    }
    return 'Network error - please check your connection';
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends AppError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    context?: Record<string, any>
  ) {
    super('TIMEOUT_ERROR', message, 408, { ...context, timeoutMs });
  }

  getUserMessage(): string {
    return 'Request timed out - please try again';
  }
}

/**
 * Rate limiting errors (429)
 */
export class RateLimitError extends AppError {
  constructor(
    message: string = 'Rate limit exceeded',
    public readonly retryAfter?: number,
    context?: Record<string, any>
  ) {
    super('RATE_LIMIT_ERROR', message, 429, { ...context, retryAfter });
  }

  getUserMessage(): string {
    const waitTime = this.retryAfter ? ` Please wait ${this.retryAfter} seconds.` : '';
    return `Too many requests.${waitTime}`;
  }
}

/**
 * External service errors
 */
export class ExternalServiceError extends AppError {
  constructor(
    serviceName: string,
    message: string,
    statusCode: number = 502,
    context?: Record<string, any>
  ) {
    super(
      'EXTERNAL_SERVICE_ERROR',
      `${serviceName}: ${message}`,
      statusCode,
      { ...context, serviceName }
    );
  }

  getUserMessage(): string {
    return 'External service is temporarily unavailable';
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends AppError {
  constructor(
    message: string,
    configKey?: string,
    context?: Record<string, any>
  ) {
    super(
      'CONFIGURATION_ERROR',
      message,
      500,
      { ...context, configKey }
    );
  }

  getUserMessage(): string {
    return 'Service configuration error';
  }
}

/**
 * Error type guards for type-safe error handling
 */
export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
};

export const isValidationError = (error: unknown): error is ValidationError => {
  return error instanceof ValidationError;
};

export const isAuthenticationError = (error: unknown): error is AuthenticationError => {
  return error instanceof AuthenticationError;
};

export const isAuthorizationError = (error: unknown): error is AuthorizationError => {
  return error instanceof AuthorizationError;
};

export const isNotFoundError = (error: unknown): error is NotFoundError => {
  return error instanceof NotFoundError;
};

export const isNetworkError = (error: unknown): error is NetworkError => {
  return error instanceof NetworkError;
};

export const isTimeoutError = (error: unknown): error is TimeoutError => {
  return error instanceof TimeoutError;
};

/**
 * Error factory for common scenarios
 */
export const ErrorFactory = {
  /**
   * Create validation error for required fields
   */
  requiredField: (fieldName: string): ValidationError => {
    return new ValidationError(`${fieldName} is required`, fieldName);
  },

  /**
   * Create validation error for invalid format
   */
  invalidFormat: (fieldName: string, expectedFormat: string): ValidationError => {
    return new ValidationError(
      `${fieldName} must be in ${expectedFormat} format`,
      fieldName
    );
  },

  /**
   * Create network error from fetch response
   */
  fromResponse: (response: Response, url: string): NetworkError => {
    return new NetworkError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      url
    );
  },

  /**
   * Create error from unknown error (for catch blocks)
   */
  fromUnknown: (error: unknown, defaultMessage = 'An unknown error occurred'): AppError => {
    if (isAppError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return new AppError('UNKNOWN_ERROR', error.message, 500);
    }

    return new AppError('UNKNOWN_ERROR', defaultMessage, 500);
  }
};

/**
 * Error handler for React components
 */
export class ErrorHandler {
  /**
   * Handle error in React component with user notification
   */
  static handleComponentError(
    error: unknown,
    context: string,
    notifyUser?: (message: string, type: 'error' | 'warning') => void
  ): void {
    const appError = ErrorFactory.fromUnknown(error);
    
    console.error(`[${context}] ${appError.message}`, appError.context);

    if (notifyUser) {
      const userMessage = appError.getUserMessage();
      const type = appError.statusCode >= 500 ? 'error' : 'warning';
      notifyUser(userMessage, type);
    }
  }

  /**
   * Handle async operation errors
   */
  static async handleAsync<T>(
    operation: () => Promise<T>,
    context: string,
    fallbackValue?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.handleComponentError(error, context);
      return fallbackValue;
    }
  }
}