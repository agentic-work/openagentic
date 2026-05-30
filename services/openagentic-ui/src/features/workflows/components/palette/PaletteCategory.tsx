/**
 * PaletteCategory - Collapsible category group in the node palette
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PaletteCategoryProps {
  category: string;
  label: string;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const PaletteCategory: React.FC<PaletteCategoryProps> = ({
  label,
  count,
  isCollapsed,
  onToggle,
  children,
}) => {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:opacity-80"
      >
        <span
          className="text-[10px] font-bold uppercase tracking-wider flex-1"
          style={{ color: 'var(--color-text-tertiary, #999)' }}
        >
          {label}
        </span>
        <span
          className="text-[9px] px-1 py-0.5 rounded"
          style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-tertiary, #999)' }}
        >
          {count}
        </span>
        <motion.span
          animate={{ rotate: isCollapsed ? -90 : 0 }}
          className="text-[10px]"
          style={{ color: 'var(--color-text-tertiary, #999)' }}
        >
          &#9660;
        </motion.span>
      </button>

      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 pb-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
