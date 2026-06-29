/**
 * Public seam for the Node Properties Panel.
 *
 * The panel was decomposed into ./NodePropertiesPanel/ — a data-editing hook
 * (useNodeDataEditor), the per-node-type config groups under ./groups/, and a
 * thin composition shell. This file stays as the stable import path so every
 * existing `from './NodePropertiesPanel'` importer keeps working unchanged.
 */

export { NodePropertiesPanel } from './NodePropertiesPanel/NodePropertiesPanel';
