/**
 * useMergedNodeConfigs — merges schema-driven nodes with legacy nodeConfigs.
 *
 * Priority: schema-driven node wins for any type present in both.
 * Legacy nodeConfigs remain as fallback for unmigrated node types.
 *
 * The returned `merged` record is keyed by node type and contains a
 * NodeTypeConfig-compatible shape (the union of schema fields + legacy fields).
 */

import { useMemo } from 'react';
import { useNodeSchemas } from './useNodeSchemas';
import type { NodeTypeConfig } from '../types/workflow.types';
import type { RegistryNodeSchema } from '../services/nodeSchemasApi';

// Icon map: converts schema icon hint strings to emoji/component-name equivalents
// that the legacy palette understands. Schema icons use descriptive strings like
// "globe", "clock", etc. which are mapped in the node icon component separately.
// For the merged palette we keep the schema icon hint as-is and let the renderer
// decide how to display it.

function schemaToNodeConfig(schema: RegistryNodeSchema): NodeTypeConfig {
  return {
    type: schema.type as NodeTypeConfig['type'],
    label: schema.label,
    description: schema.description,
    icon: schema.icon ?? '',
    color: 'var(--color-fg-subtle)', // neutral fallback — schema doesn't carry color (yet)
    category: schema.category as NodeTypeConfig['category'],
    defaultData: {},
    inputs: schema.ports?.inputs?.map(p => ({
      name: p.name,
      type: p.type as any,
      label: p.name,
      required: p.required,
    })),
    outputs: schema.ports?.outputs?.map(p => ({
      name: p.name,
      type: p.type as any,
      label: p.name,
      required: p.required,
    })),
  };
}

export interface MergedNodeConfigsResult {
  /** All node configs — schema-first for migrated types, legacy for the rest */
  merged: Record<string, NodeTypeConfig>;
  /** Which types came from the schema registry */
  schemaTypes: Set<string>;
  /** Which types came from legacy only */
  legacyTypes: Set<string>;
  loading: boolean;
}

/**
 * Returns the merged palette config.
 *
 * @param legacyConfigs - the existing hand-maintained nodeTypeConfigs map
 */
export function useMergedNodeConfigs(
  legacyConfigs: Record<string, NodeTypeConfig>,
): MergedNodeConfigsResult {
  const { schemas, loading } = useNodeSchemas();

  const result = useMemo<Omit<MergedNodeConfigsResult, 'loading'>>(() => {
    const merged: Record<string, NodeTypeConfig> = {};
    const schemaTypes = new Set<string>();
    const legacyTypes = new Set<string>();

    // 1. Start with legacy as base
    for (const [type, config] of Object.entries(legacyConfigs)) {
      merged[type] = config;
      legacyTypes.add(type);
    }

    // 2. Overlay schema-driven nodes (schema wins on conflict)
    for (const schema of schemas) {
      const schemaConfig = schemaToNodeConfig(schema);

      // Preserve legacy color/gradient/icon if schema doesn't override them
      if (merged[schema.type]) {
        const legacy = merged[schema.type];
        schemaConfig.color = legacy.color;
        schemaConfig.gradient = legacy.gradient;
        // Only use schema icon if it's a non-empty string that looks like a
        // word (e.g. "globe"), not an emoji. Legacy emojis are richer for now.
        if (!schema.icon || /^\p{Emoji}/u.test(legacy.icon)) {
          schemaConfig.icon = legacy.icon;
        }
        // Merge defaultData — schema-derived takes precedence for known settings
        schemaConfig.defaultData = legacy.defaultData;
        legacyTypes.delete(schema.type);
      }

      merged[schema.type] = schemaConfig;
      schemaTypes.add(schema.type);
    }

    return { merged, schemaTypes, legacyTypes };
  }, [schemas, legacyConfigs]);

  return { ...result, loading };
}
