import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Shield, X } from '@/shared/icons';

interface DisclaimerModalProps {
  isOpen: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({
  isOpen,
  onAccept,
  onDecline,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50"
            style={{ background: 'color-mix(in srgb, var(--color-bg) 90%, transparent)' }}
            onClick={onDecline}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="border-2 rounded-xl shadow-hard-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-surface"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-warn) 50%, transparent)',
                filter: 'drop-shadow(0 0 30px color-mix(in srgb, var(--color-warn) 30%, transparent))',
              }}
            >
              {/* Header */}
              <div className="p-6" style={{ background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--color-warn) 30%, transparent)' }}>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-warn) 20%, transparent)' }}>
                    <AlertTriangle className="w-8 h-8 text-warn" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-warn tracking-wide">
                      FEDERAL GOVERNMENT SYSTEM NOTICE
                    </h2>
                    <p className="text-sm text-fg-muted mt-1">
                      Please read carefully before proceeding
                    </p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Warning Box */}
                <div className="rounded-lg p-4" style={{ background: 'color-mix(in srgb, var(--color-err) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-err) 30%, transparent)' }}>
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-err mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-fg-muted space-y-2">
                      <p className="font-semibold text-err">
                        AUTHORIZED USE ONLY
                      </p>
                      <p>
                        This is a U.S. Government information system. By accessing and using this system, you acknowledge and consent to the following:
                      </p>
                    </div>
                  </div>
                </div>

                {/* Terms List */}
                <div className="space-y-3 text-sm text-fg-muted">
                  <div className="flex items-start gap-2">
                    <span className="text-warn font-bold mt-1">•</span>
                    <p>
                      <strong className="text-fg">Monitoring and Recording:</strong> This system is subject to monitoring at all times. All activities on this system may be monitored, intercepted, recorded, read, copied, or captured in any manner and disclosed in any manner, by authorized personnel.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-warn font-bold mt-1">•</span>
                    <p>
                      <strong className="text-fg">No Expectation of Privacy:</strong> Users of this system have no expectation of privacy regarding any communications or data processed or stored on this system.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-warn font-bold mt-1">•</span>
                    <p>
                      <strong className="text-fg">Authorized Use Only:</strong> Use of this system constitutes consent to monitoring and recording. Unauthorized use of this system is prohibited and subject to criminal and civil penalties.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-warn font-bold mt-1">•</span>
                    <p>
                      <strong className="text-fg">Evidence in Legal Proceedings:</strong> System administrators may provide evidence of any criminal activity discovered on this system to law enforcement officials.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-warn font-bold mt-1">•</span>
                    <p>
                      <strong className="text-fg">Compliance Requirements:</strong> All users must comply with federal information security policies, including but not limited to FISMA, NIST standards, and agency-specific security requirements.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-warn font-bold mt-1">•</span>
                    <p>
                      <strong className="text-fg">Data Classification:</strong> You are responsible for properly handling and protecting all information according to its classification level. Unauthorized disclosure of sensitive information may result in disciplinary action and criminal prosecution.
                    </p>
                  </div>
                </div>

                {/* Final Warning */}
                <div className="rounded-lg p-4" style={{ background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warn) 30%, transparent)' }}>
                  <p className="text-sm text-fg-muted">
                    <strong className="text-warn">BY CLICKING "I ACCEPT" BELOW:</strong> You acknowledge that you have read, understood, and agree to comply with all terms and conditions stated above. You consent to monitoring and acknowledge that unauthorized use may result in disciplinary action and prosecution under applicable federal laws.
                  </p>
                </div>
              </div>

              {/* Footer with Actions */}
              <div className="p-6" style={{ background: 'color-mix(in srgb, var(--color-bg) 50%, transparent)', borderTop: '1px solid var(--color-rule)' }}>
                <div className="flex gap-4 justify-end">
                  <motion.button
                    onClick={onDecline}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="px-6 py-3 bg-surface-2 hover:bg-surface text-fg rounded-lg font-semibold transition-colors flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Decline
                  </motion.button>

                  <motion.button
                    onClick={onAccept}
                    whileHover={{ scale: 1.02, boxShadow: '0 0 20px color-mix(in srgb, var(--color-ok) 50%, transparent)' }}
                    whileTap={{ scale: 0.98 }}
                    className="px-6 py-3 text-on-accent rounded-lg font-semibold transition-all flex items-center gap-2"
                    style={{
                      background: 'linear-gradient(to right, var(--color-ok), color-mix(in srgb, var(--color-ok) 85%, var(--color-bg)))',
                      filter: 'drop-shadow(0 0 10px color-mix(in srgb, var(--color-ok) 30%, transparent))',
                    }}
                  >
                    <Shield className="w-4 h-4" />
                    I Accept
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
