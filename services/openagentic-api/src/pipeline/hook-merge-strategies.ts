/**
 * Hook Merge Strategies
 *
 * Defines how multiple modifying hooks combine their results.
 * Each strategy takes (original, hookResult, hookId) and returns
 * the merged value to pass to the next hook.
 */

// ---------------------------------------------------------------------------
// Strategy type
// ---------------------------------------------------------------------------

/**
 * @param original  The input data before this hook ran
 * @param result    The output from the hook
 * @param hookId    ID of the hook that produced the result (for logging)
 */
export type HookMergeStrategy<T = unknown> = (original: T, result: T, hookId: string) => T;

// ---------------------------------------------------------------------------
// Built-in strategies
// ---------------------------------------------------------------------------

export const MERGE_STRATEGIES = {
  /**
   * Passthrough: each hook's output becomes the next hook's input.
   * This is the default — a simple chain.
   */
  passthrough: <T>(original: T, result: T, _hookId: string): T => result,

  /**
   * Shallow merge: result is shallow-merged onto original.
   * Useful for enriching objects (e.g., adding fields to context).
   */
  shallowMerge: <T extends Record<string, unknown>>(
    original: T,
    result: T,
    _hookId: string,
  ): T => ({ ...original, ...result }),

  /**
   * Array concat: if both are arrays, concatenate. Otherwise passthrough.
   */
  arrayConcat: <T>(original: T, result: T, _hookId: string): T => {
    if (Array.isArray(original) && Array.isArray(result)) {
      return [...original, ...result] as unknown as T;
    }
    return result;
  },

  /**
   * First non-null: use the first hook that returns a non-null/non-undefined result.
   * Subsequent hooks are still called but their results are ignored once we have one.
   */
  firstNonNull: <T>(original: T, result: T, _hookId: string): T => {
    if (original != null) return original;
    return result;
  },

  /**
   * Veto: if any hook returns a "blocking" value (determined by predicate),
   * the chain short-circuits.  Useful for the HITL gate — if one hook says
   * "block", the tool call is blocked regardless of other hooks.
   *
   * Usage: create a concrete veto strategy with a predicate.
   */
  createVeto: <T>(isBlocked: (value: T) => boolean): HookMergeStrategy<T> => {
    return (original: T, result: T, _hookId: string): T => {
      // If original is already blocked, stay blocked
      if (isBlocked(original)) return original;
      return result;
    };
  },

  /**
   * String concat: concatenate string results with a separator.
   */
  createStringConcat: (separator: string): HookMergeStrategy<string> => {
    return (original: string, result: string, _hookId: string): string => {
      if (!original) return result;
      if (!result) return original;
      return `${original}${separator}${result}`;
    };
  },
};
