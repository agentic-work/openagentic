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

/**
 * GlassmorphismContainer - Glassmorphism-styled container component
 * Provides a frosted glass effect for UI panels
 */

import React from 'react';

interface GlassmorphismContainerProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const GlassmorphismContainer: React.FC<GlassmorphismContainerProps> = ({
  children,
  className = '',
  style
}) => {
  return (
    <div
      className={`backdrop-blur-md bg-white/10 border border-white/20 rounded-xl ${className}`}
      style={style}
    >
      {children}
    </div>
  );
};

export default GlassmorphismContainer;
