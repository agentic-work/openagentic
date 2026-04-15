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
import classNames from 'classnames';

const GlassCard = ({ 
  children, 
  className = '', 
  hover = false,
  padding = 'p-6',
  onClick,
  as = 'div',
  ...props 
}) => {
  const Component = as;
  
  const cardClasses = classNames(
    // Solid surface - NO glassmorphism
    'bg-[var(--color-surface)]',
    'border border-[var(--color-border)]',
    'rounded-xl',
    'shadow-[var(--color-shadow)]',

    // Transition - snappy, not sluggish
    'transition-all duration-150',

    // Hover effects (if enabled)
    hover && [
      'hover:bg-[var(--color-surfaceHover)]',
      'hover:border-[var(--color-borderHover)]',
      'hover:shadow-lg',
      onClick && 'cursor-pointer',
    ],
    
    // Padding
    padding,
    
    // Custom classes
    className
  );
  
  return (
    <Component 
      className={cardClasses} 
      onClick={onClick}
      {...props}
    >
      <div className="relative z-10">
        {children}
      </div>
    </Component>
  );
};

export default GlassCard;
