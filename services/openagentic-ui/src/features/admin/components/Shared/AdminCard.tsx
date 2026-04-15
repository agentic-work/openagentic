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

export interface AdminCardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

const PADDING_MAP = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
} as const;

/**
 * Shared card wrapper for admin console sections.
 * Consistent rounded-lg, surface bg, border. Use everywhere instead of inline Card components.
 */
export const AdminCard: React.FC<AdminCardProps> = ({ children, className = '', padding = 'md' }) => (
  <div
    className={`rounded-lg ${PADDING_MAP[padding]} ${className}`}
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
  >
    {children}
  </div>
);
