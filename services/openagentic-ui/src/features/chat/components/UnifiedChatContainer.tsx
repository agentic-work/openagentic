/**
 * Unified Chat Container Component
 * Provides a consistent glassmorphic container for the entire chat area
 * with integrated lava globe effects
 */

import React from 'react';
import { motion } from 'framer-motion';

interface UnifiedChatContainerProps {
  children: React.ReactNode;
  className?: string;
}

const UnifiedChatContainer: React.FC<UnifiedChatContainerProps> = ({
  children,
  className = '',
}) => {
  return (
    <div className={`relative flex flex-col h-full w-full ${className}`}>
      {/* Transparent to let liquid glass background show through */}

      {/* Animated accent lines */}
      <motion.div
        className="absolute top-0 left-0 right-0 h-[1px]"
        style={{
          background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-primary) 50%, transparent), transparent)'
        }}
        animate={{
          opacity: [0.3, 0.7, 0.3],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      <motion.div
        className="absolute bottom-0 left-0 right-0 h-[1px]"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.5), transparent)'
        }}
        animate={{
          opacity: [0.3, 0.7, 0.3],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1.5
        }}
      />

      {/* Subtle animated orbs within the container */}
      <motion.div
        className="absolute w-32 h-32 rounded-full blur-2xl pointer-events-none"
        style={{
          background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 15%, transparent), transparent)',
          top: '10%',
          left: '5%'
        }}
        animate={{
          x: [0, 30, 0],
          y: [0, -20, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      <motion.div
        className="absolute w-40 h-40 rounded-full blur-2xl pointer-events-none"
        style={{
          background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 15%, transparent), transparent)',
          bottom: '10%',
          right: '5%'
        }}
        animate={{
          x: [0, -30, 0],
          y: [0, 20, 0],
          scale: [1, 1.15, 1],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />

      {/* Content container with proper z-index */}
      <div className="relative z-10 flex flex-col h-full w-full">
        {children}
      </div>

      {/* Noise texture overlay for glass effect */}
      <div
        className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
};

export default UnifiedChatContainer;