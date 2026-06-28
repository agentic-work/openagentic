import { prisma } from '../../utils/prisma.js';
import type { OutputProfile } from './types.js';

const SYSTEM_CONFIG_KEY = 'workspace.defaultOutputProfile';
const CACHE_TTL_MS = 60_000;

let cachedDefault: { profile: OutputProfile; ts: number } | null = null;

/**
 * Scan a user message for explicit cues. Returns the matching profile or
 * null if no clear signal. Precedence: technical > analyst > executive
 * (technical phrases are usually the most unambiguous; if a message asks
 * for both an executive summary AND technical depth, we honor the deeper
 * ask since the shallower render is a strict subset).
 */
function scanMessage(message: string): OutputProfile | null {
  if (!message) return null;
  const m = message.toLowerCase();

  // Technical cues — engineers, IDs, stack traces, deep dives, methodology
  if (
    /\b(deep[ -]?dive|technical[ -]?(details?|depth|breakdown)|engineer(?:ing|s)?|implementation|stack[ -]?trace|exact[ -]?(id|sha|code|hash)|low[ -]?level|under[ -]?the[ -]?hood|methodology|architecture|internals?)\b/.test(m)
  ) {
    return 'technical';
  }

  // Analyst cues — data, BI, comparisons, metrics, trends, forecasts
  if (
    /\b(analyst|bi(?:\s*dashboard)?|business[ -]?intelligence|metrics?[ -]?(view|breakdown)?|trend(?:ing|s)?|forecast(?:ing)?|comparison|kpi|roi|benchmark(?:ing|s)?|sla|year[ -]?over[ -]?year|yoy|quarter[ -]?over[ -]?quarter|qoq)\b/.test(m)
  ) {
    return 'analyst';
  }

  // Executive cues — TL;DR, brief me, soft/plain, c-level, implications
  if (
    /\b(tl;?dr|executive[ -]?(summary|brief|overview)?|brief[ -]?me|key[ -]?points? only|soft(?:er)?[ -]?(version|view)|cio|ceo|c[ -]?level|board(?:room)?|bottom[ -]?line|in plain english|high[ -]?level|one[ -]?liner|short[ -]?version|elevator[ -]?pitch)\b/.test(m)
  ) {
    return 'executive';
  }

  return null;
}

async function readAdminDefault(): Promise<OutputProfile | null> {
  const now = Date.now();
  if (cachedDefault && now - cachedDefault.ts < CACHE_TTL_MS) {
    return cachedDefault.profile;
  }
  try {
    const row = await prisma.systemConfiguration.findUnique({
      where: { key: SYSTEM_CONFIG_KEY },
    });
    if (row?.value != null) {
      const v = typeof row.value === 'string' ? row.value.replace(/^"|"$/g, '') : String(row.value);
      if (v === 'executive' || v === 'technical' || v === 'analyst') {
        cachedDefault = { profile: v as OutputProfile, ts: now };
        return v as OutputProfile;
      }
    }
  } catch {
    /* table missing on fresh install — fall through to default */
  }
  return null;
}

/**
 * Decide which output profile to inject for this request.
 *
 * Precedence:
 *   1. Caller-supplied `context.outputProfile` (e.g. a UI persona pill)
 *   2. Explicit semantic cue in the user message
 *   3. User-stored preference (future — not yet wired)
 *   4. Admin workspace default from SystemConfiguration
 *   5. Hard fallback: 'executive' — the least-surprising baseline for mixed
 *      audiences and the shape most closely matching the existing
 *      response-style module's prose bias.
 */
export async function selectOutputProfile(
  message: string,
  callerSupplied?: OutputProfile,
): Promise<OutputProfile> {
  if (callerSupplied) return callerSupplied;
  const fromMessage = scanMessage(message);
  if (fromMessage) return fromMessage;
  const fromAdmin = await readAdminDefault();
  if (fromAdmin) return fromAdmin;
  return 'executive';
}

/** Bust the admin-default cache (called from the admin-config writer). */
export function invalidateAdminDefaultCache(): void {
  cachedDefault = null;
}
