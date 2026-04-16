/**
 * @copyright 2024 Openagentic LLC
 * @license PROPRIETARY
 */

import React from 'react';
import { AlertCircle, Info, CheckCircle, XCircle, Lightbulb } from '@/shared/icons';
import { motion } from 'framer-motion';

type CalloutType = 'warning' | 'info' | 'success' | 'error' | 'tip';

interface CalloutBoxProps {
  type: CalloutType;
  theme: 'light' | 'dark';
  children: React.ReactNode;
  collapsible?: boolean;
}

const CalloutBox: React.FC<CalloutBoxProps> = ({ type, theme, children, collapsible = false }) => {
  const [isExpanded, setIsExpanded] = React.useState(true);
  
  const getConfig = () => {
    // NO hardcoded border colors - use semantic classes only
    switch (type) {
      case 'warning':
        return {
          icon: AlertCircle,
          bgColor: 'bg-theme-warning',
          borderColor: 'border-l-4 border-border-warning',
          iconColor: 'text-theme-warning-fg',
          textColor: 'text-theme-warning-fg',
          title: 'Warning'
        };
      case 'info':
        return {
          icon: Info,
          bgColor: 'bg-theme-info',
          borderColor: 'border-l-4 border-border-info',
          iconColor: 'text-theme-info-fg',
          textColor: 'text-theme-info-fg',
          title: 'Info'
        };
      case 'success':
        return {
          icon: CheckCircle,
          bgColor: 'bg-theme-success',
          borderColor: 'border-l-4 border-border-success',
          iconColor: 'text-theme-success-fg',
          textColor: 'text-theme-success-fg',
          title: 'Success'
        };
      case 'error':
        return {
          icon: XCircle,
          bgColor: 'bg-theme-error',
          borderColor: 'border-l-4 border-border-error',
          iconColor: 'text-theme-error-fg',
          textColor: 'text-theme-error-fg',
          title: 'Error'
        };
      case 'tip':
        return {
          icon: Lightbulb,
          bgColor: 'bg-accent-primary-secondary',
          borderColor: 'border-l-4 border-border-primary',
          iconColor: 'text-accent-primary-secondary-fg',
          textColor: 'text-accent-primary-secondary-fg',
          title: 'Tip'
        };
    }
  };
  
  const config = getConfig();
  const Icon = config.icon;
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`rounded-lg p-4 ${config.bgColor} ${config.borderColor} ${config.textColor}`}
    >
      <div className="flex items-start gap-3">
        <Icon size={20} className={`flex-shrink-0 mt-0.5 ${config.iconColor}`} />
        
        <div className="flex-1">
          {collapsible ? (
            <>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 font-semibold text-sm mb-1 hover:opacity-80"
              >
                {config.title}
                <motion.span
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  className="text-xs"
                >
                  ▶
                </motion.span>
              </button>
              
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="text-sm"
                >
                  {children}
                </motion.div>
              )}
            </>
          ) : (
            <div className="text-sm">{children}</div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default CalloutBox;
