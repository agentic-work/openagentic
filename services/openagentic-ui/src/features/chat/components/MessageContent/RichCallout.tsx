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
 * Rich Callout Component with emoji support and colored backgrounds
 */

import React from 'react';
import { motion } from 'framer-motion';

interface RichCalloutProps {
  icon?: string;
  noteType?: string;
  text: string;
  theme: 'light' | 'dark';
}

const RichCallout: React.FC<RichCalloutProps> = ({ icon, noteType, text, theme }) => {
  const getCalloutStyle = () => {
    // NO hardcoded border colors - use semantic borders only
    // If we have an emoji icon, determine style from it
    if (icon) {
      switch (icon) {
        case '⚠️':
          return {
            bg: 'bg-theme-warning',
            border: 'border-l-4 border-border-warning',
            text: 'text-theme-warning-fg'
          };
        case '💡':
          return {
            bg: 'bg-theme-warning',
            border: 'border-l-4 border-border-warning',
            text: 'text-theme-warning-fg'
          };
        case '✅':
          return {
            bg: 'bg-theme-success',
            border: 'border-l-4 border-border-success',
            text: 'text-theme-success-fg'
          };
        case '❌':
          return {
            bg: 'bg-theme-error',
            border: 'border-l-4 border-border-error',
            text: 'text-theme-error-fg'
          };
        case '📌':
          return {
            bg: 'bg-theme-info',
            border: 'border-l-4 border-border-info',
            text: 'text-theme-info-fg'
          };
        case '📊':
          return {
            bg: 'bg-accent-primary-primary',
            border: 'border-l-4 border-border-primary',
            text: 'text-accent-primary-primary-fg'
          };
        case '🔍':
          return {
            bg: 'bg-accent-primary-secondary',
            border: 'border-l-4 border-border-primary',
            text: 'text-accent-primary-secondary-fg'
          };
        case '🚀':
          return {
            bg: 'bg-accent-primary-primary',
            border: 'border-l-4 border-border-primary',
            text: 'text-accent-primary-primary-fg'
          };
        default:
          return {
            bg: 'bg-bg-secondary',
            border: 'border-l-4 border-border-primary',
            text: 'text-text-primary'
          };
      }
    }

    // If we have a note type, determine style from it
    if (noteType) {
      switch (noteType) {
        case 'WARNING':
        case 'IMPORTANT':
          return {
            bg: 'bg-theme-warning',
            border: 'border-l-4 border-border-warning',
            text: 'text-theme-warning-fg'
          };
        case 'TIP':
          return {
            bg: 'bg-theme-success',
            border: 'border-l-4 border-border-success',
            text: 'text-theme-success-fg'
          };
        case 'ERROR':
          return {
            bg: 'bg-theme-error',
            border: 'border-l-4 border-border-error',
            text: 'text-theme-error-fg'
          };
        case 'SUCCESS':
          return {
            bg: 'bg-theme-success',
            border: 'border-l-4 border-border-success',
            text: 'text-theme-success-fg'
          };
        case 'INFO':
        case 'NOTE':
        default:
          return {
            bg: 'bg-theme-info',
            border: 'border-l-4 border-border-info',
            text: 'text-theme-info-fg'
          };
      }
    }

    // Default style
    return {
      bg: 'bg-bg-secondary',
      border: 'border-l-4 border-border-primary',
      text: 'text-text-primary'
    };
  };
  
  const style = getCalloutStyle();
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={`my-3 rounded-lg px-4 py-3 ${style.bg} ${style.border} ${style.text}`}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span className="text-xl flex-shrink-0" role="img" aria-label="callout icon">
            {icon}
          </span>
        )}
        {noteType && !icon && (
          <span className="font-semibold text-sm uppercase tracking-wide">
            {noteType}:
          </span>
        )}
        <div className="flex-1 text-sm leading-relaxed">
          {text}
        </div>
      </div>
    </motion.div>
  );
};

export default RichCallout;