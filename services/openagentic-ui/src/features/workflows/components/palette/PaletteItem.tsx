/**
 * PaletteItem - Draggable node card in the palette
 */

import React from 'react';
import { getVendorIcon } from '../nodes/CustomNode';
import { getNodeIcon } from '../nodes/nodeIcons';

interface NodeConfig {
  type: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  defaultData?: Record<string, any>;
}

interface PaletteItemProps {
  config: NodeConfig;
}

export const PaletteItem: React.FC<PaletteItemProps> = ({ config }) => {
  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(config));
    event.dataTransfer.effectAllowed = 'move';
  };

  const vendor = getVendorIcon(config.type, { label: config.label, ...(config.defaultData || {}) });
  const iconBg = vendor?.bgColor || config.color;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={`${config.label}: ${config.description}\n\nDrag onto the canvas to add this node.`}
      className="wf-palette-item flex items-center gap-2.5 px-2.5 py-2 rounded-lg border"
      style={{
        background: 'var(--wf-node-bg)',
        borderColor: 'var(--wf-node-border)',
      }}
    >
      {/* Icon circle — vendor SVG or custom SVG icon */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
        style={{ backgroundColor: iconBg }}
      >
        {vendor ? vendor.icon : getNodeIcon(config.type)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-xs truncate" style={{ color: 'var(--color-text, #333)' }}>
          {config.label}
        </div>
        <p className="text-[11px] leading-snug truncate" style={{ color: 'var(--color-text-tertiary, #999)' }}>
          {config.description}
        </p>
      </div>
    </div>
  );
};
