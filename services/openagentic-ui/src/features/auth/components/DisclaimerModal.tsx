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
            className="fixed inset-0 bg-black/90 z-50"
            onClick={onDecline}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 border-2 border-yellow-500/50 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(234, 179, 8, 0.3))',
              }}
            >
              {/* Header */}
              <div className="bg-yellow-500/10 border-b border-yellow-500/30 p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-yellow-500/20 rounded-lg">
                    <AlertTriangle className="w-8 h-8 text-yellow-500" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-yellow-500 tracking-wide">
                      FEDERAL GOVERNMENT SYSTEM NOTICE
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                      Please read carefully before proceeding
                    </p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Warning Box */}
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-gray-300 space-y-2">
                      <p className="font-semibold text-red-400">
                        AUTHORIZED USE ONLY
                      </p>
                      <p>
                        This is a U.S. Government information system. By accessing and using this system, you acknowledge and consent to the following:
                      </p>
                    </div>
                  </div>
                </div>

                {/* Terms List */}
                <div className="space-y-3 text-sm text-gray-300">
                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 font-bold mt-1">•</span>
                    <p>
                      <strong className="text-white">Monitoring and Recording:</strong> This system is subject to monitoring at all times. All activities on this system may be monitored, intercepted, recorded, read, copied, or captured in any manner and disclosed in any manner, by authorized personnel.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 font-bold mt-1">•</span>
                    <p>
                      <strong className="text-white">No Expectation of Privacy:</strong> Users of this system have no expectation of privacy regarding any communications or data processed or stored on this system.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 font-bold mt-1">•</span>
                    <p>
                      <strong className="text-white">Authorized Use Only:</strong> Use of this system constitutes consent to monitoring and recording. Unauthorized use of this system is prohibited and subject to criminal and civil penalties.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 font-bold mt-1">•</span>
                    <p>
                      <strong className="text-white">Evidence in Legal Proceedings:</strong> System administrators may provide evidence of any criminal activity discovered on this system to law enforcement officials.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 font-bold mt-1">•</span>
                    <p>
                      <strong className="text-white">Compliance Requirements:</strong> All users must comply with federal information security policies, including but not limited to FISMA, NIST standards, and agency-specific security requirements.
                    </p>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 font-bold mt-1">•</span>
                    <p>
                      <strong className="text-white">Data Classification:</strong> You are responsible for properly handling and protecting all information according to its classification level. Unauthorized disclosure of sensitive information may result in disciplinary action and criminal prosecution.
                    </p>
                  </div>
                </div>

                {/* Final Warning */}
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <p className="text-sm text-gray-300">
                    <strong className="text-yellow-400">BY CLICKING "I ACCEPT" BELOW:</strong> You acknowledge that you have read, understood, and agree to comply with all terms and conditions stated above. You consent to monitoring and acknowledge that unauthorized use may result in disciplinary action and prosecution under applicable federal laws.
                  </p>
                </div>
              </div>

              {/* Footer with Actions */}
              <div className="bg-gray-900/50 border-t border-gray-700 p-6">
                <div className="flex gap-4 justify-end">
                  <motion.button
                    onClick={onDecline}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Decline
                  </motion.button>

                  <motion.button
                    onClick={onAccept}
                    whileHover={{ scale: 1.02, boxShadow: '0 0 20px rgba(34, 197, 94, 0.5)' }}
                    whileTap={{ scale: 0.98 }}
                    className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white rounded-lg font-semibold transition-all flex items-center gap-2"
                    style={{
                      filter: 'drop-shadow(0 0 10px rgba(34, 197, 94, 0.3))',
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
