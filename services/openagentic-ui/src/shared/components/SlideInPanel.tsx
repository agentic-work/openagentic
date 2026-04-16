/**
 * SlideInPanel - GCP Console-style Slide-in Panel Component
 *
 * Provides a full-height panel that slides in from the right edge:
 * - Slides in from right with smooth animation
 * - Full viewport height
 * - Dark backdrop with click-to-close
 * - Header with title, subtitle, close button
 * - Scrollable content area
 * - Fixed footer for actions (Save/Cancel)
 * - Keyboard: Escape to close
 * - Focus trap for accessibility
 * */

import React, { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft } from '@/shared/icons';

// Panel configuration constants
export const PANEL_CONFIG = {
  zIndex: {
    backdrop: 150,
    panel: 151,
  },
  widths: {
    sm: 400,
    md: 600,
    lg: 800,
    xl: 1000,
    '2xl': 1200,
  },
} as const;

export type PanelWidth = keyof typeof PANEL_CONFIG.widths;

export interface SlideInPanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when panel should close */
  onClose: () => void;
  /** Panel title */
  title: string;
  /** Panel subtitle (optional) */
  subtitle?: string;
  /** Width variant */
  width?: PanelWidth;
  /** Panel content */
  children: React.ReactNode;
  /** Footer content (optional - typically action buttons) */
  footer?: React.ReactNode;
  /** Whether clicking backdrop closes panel (default: true) */
  closeOnBackdropClick?: boolean;
  /** Whether pressing Escape closes panel (default: true) */
  closeOnEscape?: boolean;
  /** Show back arrow instead of X (useful for nested panels) */
  showBackArrow?: boolean;
  /** Custom icon to display next to title */
  icon?: React.ReactNode;
  /** Additional class names for panel container */
  className?: string;
  /** Loading state for panel content */
  isLoading?: boolean;
  /** Test ID for testing */
  testId?: string;
}

export const SlideInPanel: React.FC<SlideInPanelProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  width = 'md',
  children,
  footer,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showBackArrow = false,
  icon,
  className = '',
  isLoading = false,
  testId,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  // Handle escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        onClose();
      }
    },
    [onClose, closeOnEscape]
  );

  // Focus trap and escape listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when panel is open
      document.body.style.overflow = 'hidden';
      // Focus the close button when panel opens
      setTimeout(() => {
        firstFocusableRef.current?.focus();
      }, 100);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnBackdropClick) {
      onClose();
    }
  };

  const panelWidth = PANEL_CONFIG.widths[width];

  const panelContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0"
            style={{
              zIndex: PANEL_CONFIG.zIndex.backdrop,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={handleBackdropClick}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            initial={{ x: panelWidth }}
            animate={{ x: 0 }}
            exit={{ x: panelWidth }}
            transition={{
              type: 'spring',
              damping: 30,
              stiffness: 300,
            }}
            className={`fixed top-0 right-0 bottom-0 flex flex-col ${className}`}
            style={{
              zIndex: PANEL_CONFIG.zIndex.panel,
              width: `${panelWidth}px`,
              maxWidth: '100vw',
              backgroundColor: 'var(--color-background)',
              borderLeft: '1px solid var(--color-border)',
              boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.3)',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="panel-title"
            data-testid={testId}
          >
            {/* Header */}
            <div
              className="flex items-start gap-3 px-6 py-4 shrink-0"
              style={{
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surfaceSecondary)',
              }}
            >
              {/* Close/Back Button */}
              <button
                ref={firstFocusableRef}
                onClick={onClose}
                className="p-2 -ml-2 rounded-lg transition-colors hover:bg-[var(--color-surface)]"
                style={{ color: 'var(--color-textMuted)' }}
                aria-label={showBackArrow ? 'Go back' : 'Close panel'}
              >
                {showBackArrow ? <ChevronLeft size={20} /> : <X size={20} />}
              </button>

              {/* Icon */}
              {icon && (
                <div
                  className="p-2 rounded-lg shrink-0"
                  style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}
                >
                  {icon}
                </div>
              )}

              {/* Title & Subtitle */}
              <div className="flex-1 min-w-0">
                <h2
                  id="panel-title"
                  className="text-lg font-semibold truncate"
                  style={{ color: 'var(--color-text)' }}
                >
                  {title}
                </h2>
                {subtitle && (
                  <p
                    className="text-sm mt-0.5 truncate"
                    style={{ color: 'var(--color-textMuted)' }}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            {/* Content */}
            <div
              className="flex-1 overflow-y-auto px-6 py-4"
              style={{
                backgroundColor: 'var(--color-background)',
              }}
            >
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
                    />
                    <span style={{ color: 'var(--color-textMuted)' }}>Loading...</span>
                  </div>
                </div>
              ) : (
                children
              )}
            </div>

            {/* Footer */}
            {footer && (
              <div
                className="px-6 py-4 shrink-0"
                style={{
                  borderTop: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surfaceSecondary)',
                }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Portal to body
  return createPortal(panelContent, document.body);
};

/**
 * SlideInPanelFooter - Standard footer layout for SlideInPanel
 * Provides consistent button layout with cancel/primary actions
 */
export interface SlideInPanelFooterProps {
  /** Custom footer content. When provided, onCancel/onSubmit buttons are not rendered. */
  children?: React.ReactNode;
  onCancel?: () => void;
  onSubmit?: () => void;
  cancelText?: string;
  submitText?: string;
  isSubmitting?: boolean;
  isSubmitDisabled?: boolean;
  submitVariant?: 'primary' | 'danger' | 'success';
}

export const SlideInPanelFooter: React.FC<SlideInPanelFooterProps> = ({
  children,
  onCancel,
  onSubmit,
  cancelText = 'Cancel',
  submitText = 'Save',
  isSubmitting = false,
  isSubmitDisabled = false,
  submitVariant = 'primary',
}) => {
  // If children are provided, render them directly as custom footer content
  if (children) {
    return (
      <div className="flex items-center justify-end gap-3">
        {children}
      </div>
    );
  }

  const getSubmitColor = () => {
    switch (submitVariant) {
      case 'danger':
        return 'rgb(239, 68, 68)';
      case 'success':
        return 'rgb(34, 197, 94)';
      default:
        return 'var(--color-primary)';
    }
  };

  return (
    <div className="flex items-center justify-end gap-3">
      {onCancel && (
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--color-surface)]"
          style={{ color: 'var(--color-textMuted)' }}
        >
          {cancelText}
        </button>
      )}
      {onSubmit && (
        <button
          onClick={onSubmit}
          disabled={isSubmitting || isSubmitDisabled}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity flex items-center gap-2"
          style={{
            backgroundColor: getSubmitColor(),
            color: 'white',
            opacity: isSubmitting || isSubmitDisabled ? 0.6 : 1,
            cursor: isSubmitting || isSubmitDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {isSubmitting && (
            <div
              className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"
            />
          )}
          {isSubmitting ? 'Saving...' : submitText}
        </button>
      )}
    </div>
  );
};

/**
 * SlideInPanelSection - Content section with optional title
 * Use to organize panel content into logical groups
 */
export interface SlideInPanelSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Optional icon to display next to the section title */
  icon?: React.ReactNode;
}

export const SlideInPanelSection: React.FC<SlideInPanelSectionProps> = ({
  title,
  description,
  children,
  className = '',
}) => {
  return (
    <div className={`mb-6 last:mb-0 ${className}`}>
      {(title || description) && (
        <div className="mb-3">
          {title && (
            <h3
              className="text-sm font-semibold uppercase tracking-wide"
              style={{ color: 'var(--color-textMuted)' }}
            >
              {title}
            </h3>
          )}
          {description && (
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--color-textMuted)' }}
            >
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
};

/**
 * SlideInPanelField - Form field wrapper with label
 */
export interface SlideInPanelFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

export const SlideInPanelField: React.FC<SlideInPanelFieldProps> = ({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
}) => {
  return (
    <div className="mb-4 last:mb-0">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium mb-1.5"
        style={{ color: 'var(--color-text)' }}
      >
        {label}
        {required && <span style={{ color: 'rgb(239, 68, 68)' }}> *</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>
          {hint}
        </p>
      )}
      {error && (
        <p className="text-xs mt-1" style={{ color: 'rgb(239, 68, 68)' }}>
          {error}
        </p>
      )}
    </div>
  );
};

export default SlideInPanel;
