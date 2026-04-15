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
import { RefreshCw } from '@/shared/icons';

export interface AdminButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--color-primary)',
    color: '#FFFFFF',
    border: 'none',
  },
  secondary: {
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--color-border)',
  },
  danger: {
    backgroundColor: 'var(--color-error)',
    color: '#FFFFFF',
    border: 'none',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    border: 'none',
  },
};

export const AdminButton: React.FC<AdminButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  onClick,
  children,
  className = '',
  type = 'button',
  title,
}) => {
  const isSm = size === 'sm';
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      className={`inline-flex items-center gap-1.5 font-medium rounded-lg transition-all
        ${isSm ? 'px-2.5 py-1 text-xs' : 'px-4 py-1.5 text-xs'}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${variant === 'secondary' ? 'hover:bg-[var(--color-surfaceHover)]' : ''}
        ${variant === 'ghost' ? 'hover:bg-[var(--color-surfaceHover)]' : ''}
        ${variant === 'primary' ? 'hover:brightness-110' : ''}
        ${variant === 'danger' ? 'hover:brightness-110' : ''}
        ${className}`}
      style={{
        ...variantStyles[variant],
        ...(isDisabled ? { pointerEvents: 'none' } : {}),
      }}
    >
      {loading ? (
        <RefreshCw size={isSm ? 11 : 13} className="animate-spin" />
      ) : icon ? (
        <span className="flex-shrink-0 flex items-center">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
