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
 * BaseModal - Consistent Modal Component
 *
 * Provides standardized modal styling across the application with:
 * - Consistent z-index layering (backdrop: 100, modal: 101)
 * - Unified backdrop blur and opacity
 * - Standard border radius and shadow
 * - Smooth animations via framer-motion
 * - Size variants for different use cases
 * - Liquid glass styling matching the design system
 *
 * @copyright 2026 Gnomus.ai
 */

import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@/shared/icons';

// Modal configuration constants
export const MODAL_CONFIG = {
  zIndex: {
    backdrop: 100,
    modal: 101,
  },
  sizes: {
    sm: 'max-w-md',      // 448px
    md: 'max-w-lg',      // 512px
    lg: 'max-w-2xl',     // 672px
    xl: 'max-w-4xl',     // 896px
    full: 'max-w-[90vw]', // 90% viewport width
  },
} as const;

export type ModalSize = keyof typeof MODAL_CONFIG.sizes;

export interface BaseModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title (optional - if provided, shows header) */
  title?: string;
  /** Modal content */
  children: React.ReactNode;
  /** Size variant */
  size?: ModalSize;
  /** Whether clicking backdrop closes modal (default: true) */
  closeOnBackdropClick?: boolean;
  /** Whether pressing Escape closes modal (default: true) */
  closeOnEscape?: boolean;
  /** Show close button in header (default: true when title provided) */
  showCloseButton?: boolean;
  /** Additional class names for modal container */
  className?: string;
  /** Footer content (optional) */
  footer?: React.ReactNode;
  /** Whether to show the default header border (default: true) */
  showHeaderBorder?: boolean;
  /** Custom header content (overrides title) */
  customHeader?: React.ReactNode;
}

export const BaseModal: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton,
  className = '',
  footer,
  showHeaderBorder = true,
  customHeader,
}) => {
  // Determine if close button should be shown
  const shouldShowCloseButton = showCloseButton ?? (!!title || !!customHeader);

  // Handle escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        onClose();
      }
    },
    [onClose, closeOnEscape]
  );

  // Add/remove escape listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
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

  const modalContent = (
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
              zIndex: MODAL_CONFIG.zIndex.backdrop,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(8px)',
            }}
            onClick={handleBackdropClick}
            aria-hidden="true"
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: MODAL_CONFIG.zIndex.modal }}
            onClick={handleBackdropClick}
          >
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{
                type: 'spring',
                damping: 25,
                stiffness: 300,
              }}
              className={`
                w-full ${MODAL_CONFIG.sizes[size]} rounded-2xl overflow-hidden
                ${className}
              `}
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: `
                  0 25px 50px -12px rgba(0, 0, 0, 0.5),
                  inset 0 1px 1px rgba(255, 255, 255, 0.05)
                `,
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? 'modal-title' : undefined}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              {(title || customHeader || shouldShowCloseButton) && (
                <div
                  className="relative px-6 py-4 flex items-center justify-between"
                  style={{
                    borderBottom: showHeaderBorder
                      ? '1px solid var(--color-border)'
                      : undefined,
                  }}
                >
                  {customHeader ? (
                    customHeader
                  ) : title ? (
                    <h2
                      id="modal-title"
                      className="text-lg font-semibold"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {title}
                    </h2>
                  ) : (
                    <div />
                  )}

                  {shouldShowCloseButton && (
                    <button
                      onClick={onClose}
                      className="p-2 rounded-lg transition-colors hover:bg-[var(--color-surfaceSecondary)]"
                      style={{ color: 'var(--color-textMuted)' }}
                      aria-label="Close modal"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              )}

              {/* Content */}
              <div
                className="px-6 py-4 overflow-y-auto"
                style={{
                  maxHeight: 'calc(85vh - 120px)',
                }}
              >
                {children}
              </div>

              {/* Footer */}
              {footer && (
                <div
                  className="px-6 py-4"
                  style={{
                    borderTop: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surfaceSecondary)',
                  }}
                >
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  // Portal to body
  return createPortal(modalContent, document.body);
};

/**
 * Confirmation Modal - A specialized modal for confirm/cancel dialogs
 */
export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger';
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
  isLoading = false,
}) => {
  const confirmButtonStyle =
    confirmVariant === 'danger'
      ? {
          backgroundColor: 'rgb(239, 68, 68)',
          color: 'white',
        }
      : {
          backgroundColor: 'var(--color-primary)',
          color: 'white',
        };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--color-surface)]"
            style={{ color: 'var(--color-textMuted)' }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
            style={{
              ...confirmButtonStyle,
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? 'Loading...' : confirmText}
          </button>
        </div>
      }
    >
      <div style={{ color: 'var(--color-textSecondary)' }}>{message}</div>
    </BaseModal>
  );
};

export default BaseModal;
