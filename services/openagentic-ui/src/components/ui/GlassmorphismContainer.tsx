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
