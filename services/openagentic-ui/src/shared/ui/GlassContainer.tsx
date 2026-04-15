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

export interface GlassContainerProps {
  children: React.ReactNode;
  variant?: 'subtle' | 'medium' | 'strong';
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
  as?: keyof JSX.IntrinsicElements;
}

export const GlassContainer: React.FC<GlassContainerProps> = ({
  children,
  variant = 'medium',
  padding = 'md',
  className = '',
  onClick,
  as: Component = 'div',
}) => {
  const variantClasses = {
    subtle: 'bg-bg-primary border border-border-primary/50',
    medium: 'bg-bg-secondary border border-border-primary',
    strong: 'bg-bg-tertiary border border-border-secondary'
  };

  const paddingClasses = {
    xs: 'p-xs',
    sm: 'p-sm',
    md: 'p-md',
    lg: 'p-lg',
    xl: 'p-xl'
  };

  const containerClasses = `${variantClasses[variant]} ${paddingClasses[padding]} ${className}`;

  return React.createElement(
    Component,
    {
      className: containerClasses,
      onClick,
    },
    children
  );
};

export default GlassContainer;