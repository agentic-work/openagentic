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

export type StatusType = 'success' | 'error' | 'warning' | 'info' | 'default';

export interface StatusBadgeProps {
  status: StatusType;
  children: React.ReactNode;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  children,
  className = '',
}) => {
  const baseClasses = 'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium';

  const variantClasses = {
    success: 'bg-success/10 text-success border border-success/20',
    error: 'bg-error/10 text-error border border-error/20',
    warning: 'bg-warning/10 text-warning border border-warning/20',
    info: 'bg-info/10 text-info border border-info/20',
    default: 'bg-bg-secondary text-text-secondary border border-border-primary'
  };

  const badgeClasses = `${baseClasses} ${variantClasses[status]} ${className}`;

  return <span className={badgeClasses}>{children}</span>;
};

export default StatusBadge;