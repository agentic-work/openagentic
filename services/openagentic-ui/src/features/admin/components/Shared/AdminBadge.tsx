/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';

export interface AdminBadgeProps {
  /** CSS color value or CSS variable, e.g. 'var(--cap-chat)' or '#3b82f6' */
  color: string;
  label: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  /** If true, show only the icon (for compact capability badges) */
  iconOnly?: boolean;
  title?: string;
}

/**
 * Generic colored badge using color-mix for background transparency.
 * Replaces 20+ inline badge definitions across admin views.
 */
export const AdminBadge: React.FC<AdminBadgeProps> = ({
  color,
  label,
  icon,
  size = 'md',
  className = '',
  iconOnly = false,
  title,
}) => {
  const isSm = size === 'sm';

  if (iconOnly && icon) {
    return (
      <span
        title={title || label}
        className={`inline-flex items-center justify-center rounded ${className}`}
        style={{
          width: isSm ? 18 : 22,
          height: isSm ? 18 : 22,
          backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
          color,
        }}
      >
        {icon}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 font-medium rounded-full ${className}`}
      style={{
        padding: isSm ? '1px 8px' : '2px 10px',
        fontSize: isSm ? 'var(--text-xs, 13px)' : 'var(--text-sm, 13px)',
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
      }}
    >
      {icon && <span className="flex-shrink-0 flex items-center">{icon}</span>}
      {label}
    </span>
  );
};
