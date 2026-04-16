/**
 * Unauthorized Access Dialog
 * Displays federal system warning for users not in authorized Azure AD groups
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, X } from '@/shared/icons';

interface UnauthorizedAccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
  errorMessage?: string;
}

const UnauthorizedAccessDialog: React.FC<UnauthorizedAccessDialogProps> = ({ 
  isOpen, 
  onClose, 
  errorMessage 
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="glass rounded-xl max-w-md w-full shadow-2xl border border-primary"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          {/* Header with Federal System Badge */}
          <div className="bg-gradient-to-r from-error/90 to-error/90 rounded-t-xl p-4 border-b border-primary">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'var(--color-surface)' }}>
                  <Shield 
                  className="w-6 h-6"
                  style={{ color: 'var(--color-text)' }} />
                </div>
                <div>
                  <h2 
                  className="text-lg font-bold"
                  style={{ color: 'var(--color-text)' }}>Federal System</h2>
                  <p className="text-red-100 text-sm font-medium">Unauthorized Access</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X 
                className="w-5 h-5"
                style={{ color: 'var(--color-text)' }} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-error/20 rounded-full flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-error" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-error mb-3">
                  Access Denied
                </h3>
                <div className="space-y-3 text-secondary">
                  <p className="text-sm leading-relaxed">
                    You are not authorized to access this federal information system. 
                    Access is restricted to authorized personnel only.
                  </p>
                  
                  <div className="bg-error/10 border-l-4 border-error p-3 rounded-r">
                    <p className="text-sm font-medium text-error mb-1">
                      Authorization Required
                    </p>
                    <p className="text-xs text-error/80">
                      You must be a member of the "{import.meta.env.VITE_AZURE_USER_GROUPS || 'OpenAgentic-Users'}" (users) or
                      "{import.meta.env.VITE_AZURE_ADMIN_GROUPS || 'OpenAgentic-Admins'}" (administrators) Azure AD groups to access this application.
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="bg-secondary p-3 rounded border border-primary text-xs">
                      <p className="text-muted font-mono">{errorMessage}</p>
                    </div>
                  )}

                  <div className="border-t border-primary pt-3 mt-4">
                    <h4 className="text-sm font-semibold text-primary mb-2">
                      To request access:
                    </h4>
                    <ul className="text-xs space-y-1 text-muted ml-4">
                      <li>• Contact your system administrator</li>
                      <li>• Request membership to appropriate Azure AD groups</li>
                      <li>• Ensure you have proper authorization to use this system</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-primary p-4 bg-tertiary rounded-b-xl">
            <div className="text-center">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-secondary hover:opacity-80 text-primary rounded-lg transition-colors font-medium"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-muted text-center mt-2">
              Unauthorized access attempts may be logged and reported
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default UnauthorizedAccessDialog;