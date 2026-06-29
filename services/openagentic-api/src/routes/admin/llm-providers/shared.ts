/**
 * Shared helpers for the admin LLM-provider route sub-modules.
 *
 * Single owner for the JSON cast helpers used at Prisma persistence + read
 * boundaries. Behaviour-preserving: these are type-only (erased at runtime) —
 * the exact same property access / write the handlers performed when they used
 * `as any`.
 */
import type { Prisma } from '@prisma/client';

/** Cast an opaque JSON value to a record for property reads (post-guard). */
export function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

/**
 * Cast a value to a Prisma JSON-write input at a persistence boundary. Same
 * runtime value; only the static type changes so the Prisma client accepts it.
 */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
