/**
 * useNodeSchemaSettings — exposes schema-driven settings metadata for a
 * specific node type. Consumed by NodePropertiesPanel to:
 *   - render required-field markers
 *   - apply validation patterns
 *   - list enum values
 *   - surface default values
 *
 * Falls back gracefully (empty settings / all-false) when the node type is
 * not yet migrated to the schema registry.
 */

import { useMemo } from 'react';
import { useNodeSchemas } from './useNodeSchemas';
import type { NodeSetting } from '../services/nodeSchemasApi';

export interface NodeSchemaSettingsResult {
  /** Raw settings array from the schema — empty for legacy node types */
  settings: NodeSetting[];
  /** True if the named field is marked required in the schema */
  isRequired: (fieldName: string) => boolean;
  /** Enum values for a given field name, or [] if not an enum */
  getEnumValues: (fieldName: string) => string[];
  /** Default value for a given field name, or undefined */
  getDefault: (fieldName: string) => unknown;
  /** Validation pattern string for a field, or undefined */
  getValidationPattern: (fieldName: string) => string | undefined;
  /** True if the schema registry has a definition for this node type */
  hasSchema: boolean;
}

export function useNodeSchemaSettings(nodeType: string): NodeSchemaSettingsResult {
  const { byType } = useNodeSchemas();

  return useMemo<NodeSchemaSettingsResult>(() => {
    const schema = byType[nodeType];
    const settings: NodeSetting[] = schema?.settings ? [...schema.settings] : [];

    const settingMap = new Map<string, NodeSetting>();
    for (const s of settings) {
      settingMap.set(s.name, s);
    }

    return {
      settings,
      isRequired: (fieldName: string) => settingMap.get(fieldName)?.required === true,
      getEnumValues: (fieldName: string) => {
        const s = settingMap.get(fieldName);
        return s?.type === 'enum' && Array.isArray(s.values) ? [...s.values] : [];
      },
      getDefault: (fieldName: string) => settingMap.get(fieldName)?.default,
      getValidationPattern: (fieldName: string) =>
        settingMap.get(fieldName)?.validation?.pattern,
      hasSchema: !!schema,
    };
  }, [byType, nodeType]);
}
