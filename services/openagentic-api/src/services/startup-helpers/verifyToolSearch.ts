export interface ToolSearchCacheLike {
  searchToolsAsOpenAIFunctions(
    query: string,
    limit: number,
  ): Promise<Array<{ function?: { name?: string }; name?: string }> | null | undefined>;
}

export interface VerifyToolSearchResult {
  ok: boolean;
  reason?: string;
  sampleToolNames?: string[];
}

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export async function verifyToolSearch(
  cache: ToolSearchCacheLike,
  timeoutMs: number,
  _logger: LoggerLike,
  query: string = 'kubernetes pods logs',
  limit: number = 5,
): Promise<VerifyToolSearchResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      cache.searchToolsAsOpenAIFunctions(query, limit),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    if (!Array.isArray(results) || results.length === 0) {
      return { ok: false, reason: 'search returned 0 results' };
    }
    const sampleToolNames = results
      .slice(0, 3)
      .map((t) => t?.function?.name ?? t?.name ?? '<unknown>');
    return { ok: true, sampleToolNames };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
