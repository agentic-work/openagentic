/**
 * Skeleton Loading Component
 * Provides smooth loading animations for messages and UI elements
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'message';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'shimmer';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'text',
  width,
  height,
  animation = 'shimmer'
}) => {
  const baseClasses = 'relative overflow-hidden bg-tertiary';
  
  const animationClasses = {
    pulse: 'animate-pulse',
    wave: 'animate-wave',
    shimmer: 'before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent'
  };
  
  const variantClasses = {
    text: 'h-4 rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
    message: 'rounded-2xl'
  };
  
  const style = {
    width: width || (variant === 'circular' ? 40 : '100%'),
    height: height || (variant === 'circular' ? 40 : variant === 'text' ? 16 : 100)
  };
  
  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
      style={style}
    />
  );
};

// Message skeleton component
export const MessageSkeleton: React.FC<{ isUser?: boolean }> = ({ isUser = false }) => {
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4`}>
      <Skeleton variant="circular" width={40} height={40} />
      <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} flex-1 max-w-[70%]`}>
        <Skeleton variant="text" width="25%" height={14} className="mb-1" />
        <div className={`${isUser ? 'bg-info/10' : 'bg-secondary'} p-4 rounded-2xl w-full`}>
          <Skeleton variant="text" width="100%" className="mb-2" />
          <Skeleton variant="text" width="85%" className="mb-2" />
          <Skeleton variant="text" width="65%" />
        </div>
      </div>
    </div>
  );
};

// Chat loading state with multiple message skeletons
export const ChatLoadingSkeleton: React.FC = () => {
  return (
    <div className="p-4 space-y-4">
      <MessageSkeleton />
      <MessageSkeleton isUser />
      <MessageSkeleton />
      <div className="flex items-center gap-2 text-muted">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-tertiary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-tertiary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-tertiary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="text-sm">AI is thinking...</span>
      </div>
    </div>
  );
};

// Session list skeleton
export const SessionListSkeleton: React.FC = () => {
  return (
    <div className="space-y-2 p-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="p-3 rounded-lg">
          <Skeleton variant="text" width="70%" height={16} className="mb-2" />
          <Skeleton variant="text" width="40%" height={12} />
        </div>
      ))}
    </div>
  );
};

export default Skeleton;