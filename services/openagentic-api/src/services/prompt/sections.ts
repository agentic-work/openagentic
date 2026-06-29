/**
 * Section registry — declare prompt sections as named compute fns, resolve
 * them all in parallel. Ref-arch port from
 * ~/anthropic/src/constants/systemPromptSections.ts:8-58.
 *
 * cacheBreak=true is documentation today; it becomes a cache-break boundary
 * once we wire Anthropic prompt-cache cache_control.
 */
import type { Logger } from 'pino';

export type ComputeFn = () => string | null | undefined | Promise<string | null | undefined>;

export interface SystemPromptSection {
  name: string;
  compute: ComputeFn;
  cacheBreak: boolean;
  reason?: string;
}

export function systemPromptSection(name: string, compute: ComputeFn): SystemPromptSection {
  return { name, compute, cacheBreak: false };
}

/**
 * Marks a section whose body changes mid-session (e.g. MCP server inventory).
 * `reason` is required documentation; it shows up in logs when the section
 * causes a cache miss once cache_control is wired.
 */
export function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: ComputeFn,
  reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true, reason };
}

export interface ResolveOptions {
  logger?: Pick<Logger, 'warn'>;
}

export async function resolveSystemPromptSections(
  sections: ReadonlyArray<SystemPromptSection>,
  opts: ResolveOptions = {},
): Promise<string[]> {
  const settled = await Promise.allSettled(
    sections.map((s) => Promise.resolve().then(() => s.compute())),
  );
  const out: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const s = sections[i];
    if (r.status === 'rejected') {
      opts.logger?.warn?.(
        { section: s.name, err: r.reason },
        '[promptSections] compute failed; section dropped',
      );
      continue;
    }
    const v = r.value;
    if (v && typeof v === 'string' && v.length > 0) {
      out.push(v);
    }
  }
  return out;
}
