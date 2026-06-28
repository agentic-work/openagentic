/**
 * Error types for pipeline processing
 */

export class ProcessingError extends Error {
  public readonly stage: string;
  public readonly context?: string;
  public readonly retryable: boolean;
  public readonly timestamp: Date;

  constructor(
    message: string,
    stage: string,
    context?: string,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'ProcessingError';
    this.stage = stage;
    this.context = context;
    this.retryable = retryable;
    this.timestamp = new Date();
  }
}