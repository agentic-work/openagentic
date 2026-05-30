/**
 * ToolMetadataOverlay — hand-curated tool metadata overlay.
 *
 * Source of truth: services/openagentic-api/data/tool-metadata-overlay.json
 * Loaded once at boot, cached in-process. Pod restart required for changes.
 *
 * Merge contract (`mergeOverlayWithInference`):
 *   1. Overlay row (if present) wins on every STRING field it supplies.
 *   2. Aliases concatenate: overlay aliases first, then non-duplicate
 *      inferred aliases. This keeps hand-tuned ranking signals AND
 *      machine-generated abbreviations.
 *   3. Missing fields fall through to inferToolMetadataFromName.
 *   4. Tools with no overlay get pure inference + empty curated strings.
 *
 * No regex anywhere. Pure JSON load + property merge.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inferToolMetadataFromName,
  type CloudProvider,
  type CostClass,
  type Verb,
} from './inferToolMetadataFromName.js';

export interface UsageExample {
  prompt: string;
  picked_because: string;
}

export interface ToolMetadataOverlayEntry {
  when_to_use?: string;
  when_NOT_to_use?: string;
  usage_examples?: UsageExample[];
  aliases?: string;
  output_shape?: string;
  cost_class?: CostClass;
  requires_capabilities?: string;
  cloud_provider?: CloudProvider | string;
  service?: string;
  verb?: Verb | string;
  related_tools?: string;
}

/**
 * The merged tool record after overlay + inference. This is the
 * shape the indexer persists into pgvector/Milvus (per-field).
 */
export interface MergedToolMetadata {
  when_to_use: string;
  when_NOT_to_use: string;
  usage_examples: UsageExample[];
  aliases: string; // comma-separated
  output_shape: string;
  cost_class: CostClass | '';
  requires_capabilities: string;
  cloud_provider: string;
  service: string;
  verb: string;
  related_tools: string;
}

interface OverlayFile {
  _schema_version?: number;
  tools: Record<string, ToolMetadataOverlayEntry>;
}

let _cache: Map<string, ToolMetadataOverlayEntry> | null = null;
let _overlayPathOverride: string | null = null;

/**
 * Resolve the overlay file path. Tests can override via
 * `setToolMetadataOverlayPath()`. Default points at the data/ dir
 * relative to the compiled output (dist/) or source (src/services/).
 */
function resolveOverlayPath(): string {
  if (_overlayPathOverride) return _overlayPathOverride;

  // src/services/ToolMetadataOverlay.ts → ../../data/tool-metadata-overlay.json
  // dist/services/ToolMetadataOverlay.js → ../../data/tool-metadata-overlay.json
  // Both resolve cleanly because data/ is at the package root.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', 'data', 'tool-metadata-overlay.json');
}

export function setToolMetadataOverlayPath(absolutePath: string): void {
  _overlayPathOverride = absolutePath;
  _cache = null;
}

export function clearToolMetadataOverlayCache(): void {
  _cache = null;
  _overlayPathOverride = null;
}

/**
 * Load the overlay once and cache it. Re-reads on each call when the
 * cache is cleared (used by tests).
 */
export function loadToolMetadataOverlay(): Map<string, ToolMetadataOverlayEntry> {
  if (_cache) return _cache;

  const overlayPath = resolveOverlayPath();
  if (!fs.existsSync(overlayPath)) {
    _cache = new Map();
    return _cache;
  }

  try {
    const raw = fs.readFileSync(overlayPath, 'utf8');
    const parsed = JSON.parse(raw) as OverlayFile;
    const tools = parsed?.tools ?? {};
    const map = new Map<string, ToolMetadataOverlayEntry>();
    for (const [name, entry] of Object.entries(tools)) {
      if (entry && typeof entry === 'object') {
        map.set(name, entry);
      }
    }
    _cache = map;
    return map;
  } catch {
    _cache = new Map();
    return _cache;
  }
}

/**
 * Parse a comma-separated alias string into a trimmed array.
 */
function parseAliases(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((a) => a.trim()).filter((a) => a.length > 0);
}

/**
 * Stringify an alias array back to comma-separated form (canonical).
 */
function aliasesToString(arr: string[]): string {
  return arr.join(', ');
}

/**
 * Merge a single tool's overlay row with name-inferred defaults.
 * Returns the full canonical shape (every field defined).
 */
export function mergeOverlayWithInference(
  toolName: string,
  overlay: ToolMetadataOverlayEntry | undefined,
): MergedToolMetadata {
  const inferred = inferToolMetadataFromName(toolName);

  // Aliases: overlay first, append inferred aliases that aren't already present.
  const overlayAliases = parseAliases(overlay?.aliases);
  const inferredAliasSet = new Set(inferred.aliases);
  const overlayAliasSet = new Set(overlayAliases);
  const mergedAliases = [...overlayAliases];
  for (const a of inferred.aliases) {
    if (!overlayAliasSet.has(a)) mergedAliases.push(a);
  }
  // dedup preserving order:
  const seen = new Set<string>();
  const finalAliases: string[] = [];
  for (const a of mergedAliases) {
    if (!seen.has(a)) {
      seen.add(a);
      finalAliases.push(a);
    }
  }

  return {
    when_to_use: overlay?.when_to_use ?? '',
    when_NOT_to_use: overlay?.when_NOT_to_use ?? '',
    usage_examples: Array.isArray(overlay?.usage_examples) ? overlay!.usage_examples! : [],
    aliases: aliasesToString(finalAliases),
    output_shape: overlay?.output_shape ?? '',
    cost_class: (overlay?.cost_class as CostClass) ?? inferred.cost_class,
    requires_capabilities: overlay?.requires_capabilities ?? '',
    cloud_provider: (overlay?.cloud_provider as string) ?? (inferred.cloud_provider ?? ''),
    service: overlay?.service ?? (inferred.service ?? ''),
    verb: (overlay?.verb as string) ?? (inferred.verb ?? ''),
    related_tools: overlay?.related_tools ?? '',
  };
}
