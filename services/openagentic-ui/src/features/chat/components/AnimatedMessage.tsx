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
 * Animated Message Component
 * Provides smooth animations for chat messages
 */

import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, Clock } from '@/shared/icons';

interface AnimatedMessageProps {
  children: React.ReactNode;
  isUser?: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'error';
  animationDelay?: number;
}

export const AnimatedMessage: React.FC<AnimatedMessageProps> = ({
  children,
  isUser = false,
  status,
  animationDelay = 0
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Trigger animation after component mounts
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, animationDelay);

    return () => clearTimeout(timer);
  }, [animationDelay]);

  // Status icon component
  const StatusIcon = () => {
    if (!status || !isUser) return null;

    const iconClass = "w-3 h-3 ml-1 inline-block";
    
    switch (status) {
      case 'sending':
        return <Clock className={`${iconClass} text-gray-400 animate-pulse`} />;
      case 'sent':
        return <Check className={`${iconClass} text-gray-400`} />;
      case 'delivered':
        return <CheckCheck className={`${iconClass} text-blue-500`} />;
      case 'error':
        return <span className={`${iconClass} text-red-500`}>!</span>;
      default:
        return null;
    }
  };

  return (
    <div
      ref={messageRef}
      className={`
        transform transition-all duration-150 ease-out
        ${isVisible 
          ? 'translate-y-0 opacity-100 scale-100' 
          : 'translate-y-4 opacity-0 scale-95'
        }
        ${isUser ? 'origin-bottom-right' : 'origin-bottom-left'}
      `}
      style={{ transitionDelay: `${animationDelay}ms` }}
    >
      <div className="relative">
        {children}
        {isUser && (
          <div 
          className="absolute -bottom-5 right-0 flex items-center text-xs"
          style={{ color: 'var(--color-textSecondary)' }}>
            <StatusIcon />
          </div>
        )}
      </div>
    </div>
  );
};

// Typing indicator animation
export const TypingIndicator: React.FC<{ userName?: string }> = ({ userName }) => {
  return (
    <div className="flex items-center gap-2 p-3 animate-fade-in">
      <div className="flex gap-1">
        <span
        className="w-2 h-2 rounded-full animate-bounce"
        style={{ backgroundColor: 'var(--color-surfaceHover)', animationDelay: '0ms' }} />
        <span
        className="w-2 h-2 rounded-full animate-bounce"
        style={{ backgroundColor: 'var(--color-surfaceHover)', animationDelay: '150ms' }} />
        <span
        className="w-2 h-2 rounded-full animate-bounce"
        style={{ backgroundColor: 'var(--color-surfaceHover)', animationDelay: '300ms' }} />
      </div>
      {userName && (
        <span 
        className="text-sm"
        style={{ color: 'var(--color-textSecondary)' }}>
          {userName} is typing...
        </span>
      )}
    </div>
  );
};

// Message entrance animation wrapper
export const MessageAnimationWrapper: React.FC<{
  children: React.ReactNode;
  index: number;
}> = ({ children, index }) => {
  // Stagger animation based on message index
  const delay = Math.min(index * 50, 300); // Max 300ms delay
  
  return (
    <AnimatedMessage animationDelay={delay}>
      {children}
    </AnimatedMessage>
  );
};

export default AnimatedMessage;