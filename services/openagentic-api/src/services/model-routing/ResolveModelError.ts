export type ResolveModelErrorCode =
  | 'UNKNOWN_REGISTRY_ROW'
  | 'UNKNOWN_FLOW_NODE'
  | 'UNKNOWN_AGENT'
  | 'REGISTRY_ROW_DISABLED'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_DELETED'
  | 'ROLE_MISMATCH'
  | 'NO_MODEL_FOR_ROLE';

export class ResolveModelError extends Error {
  readonly code: ResolveModelErrorCode;
  readonly details?: unknown;

  constructor(code: ResolveModelErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ResolveModelError';
    this.code = code;
    this.details = details;
  }
}
