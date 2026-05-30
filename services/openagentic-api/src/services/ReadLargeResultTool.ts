/**
 * read_large_result — meta-tool that lets the model paged-query a
 * previously-stored large tool result via its `artifactHandle`.
 *
 * Companion to the two-channel envelope (`ToolEnvelopeSplitter`): when a
 * tool's raw output exceeds the inline threshold (default 30KB), the
 * full payload offloads to LargeResultStorage and `_meta.artifactHandle`
 * holds the handle. The model can then call this meta-tool to retrieve
 * a windowed slice of the stored payload, scoped by offset / limit /
 * filter expression — keeps the next-turn context compact while letting
 * the model "drill into" the full result without re-running the source
 * tool.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §10
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 4, Task 4.7-4.10.
 */

/**
 * OpenAI function-shape tool definition. Mirrors the shape every other
 * V3 meta-tool exposes so chatLoop can carry it in the base catalog
 * (Spec §5 — 14 meta-tools at turn 1).
 */
export const READ_LARGE_RESULT_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'read_large_result',
    description:
      'Retrieve a paged slice of a previously-stored large tool result by its artifactHandle. ' +
      'Use this when a prior tool_result _meta carried an artifactHandle and you need to drill ' +
      'into the full data without re-running the source tool.',
    parameters: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'artifactHandle from a prior tool_result _meta envelope.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Row / item offset to start the slice at.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          default: 50,
          description: 'Maximum number of rows / items to return in this slice.',
        },
        filter: {
          type: 'string',
          description:
            'Optional filter expression — semantics defined per stored result (e.g. ' +
            '"state=running" for k8s pods, "severity>=high" for findings).',
          nullable: true,
        },
      },
      required: ['handle'],
    },
  },
} as const;

export interface ReadLargeResultInput {
  handle: string;
  offset?: number;
  limit?: number;
  filter?: string;
}

export interface ReadLargeResultDeps {
  largeResultStorage: {
    get: (
      handle: string,
      opts: { offset: number; limit: number; filter?: string },
    ) => Promise<unknown>;
  };
}

export interface ReadLargeResultOutput {
  ok: boolean;
  output?: unknown;
  error?: string;
}

/**
 * Execute the read_large_result meta-tool dispatch. The dispatcher in
 * V3's chatLoop calls this when the model emits a `read_large_result`
 * tool_use block.
 *
 * Returns `{ ok, output }` on success, `{ ok:false, error }` when the
 * underlying storage `get()` rejects (e.g. expired TTL, handle not found).
 */
export async function executeReadLargeResult(
  input: ReadLargeResultInput,
  deps: ReadLargeResultDeps,
): Promise<ReadLargeResultOutput> {
  try {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;
    const raw = await deps.largeResultStorage.get(input.handle, {
      offset,
      limit,
      filter: input.filter,
    });
    return { ok: true, output: raw };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ?? String(err),
    };
  }
}
