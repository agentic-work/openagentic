import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, Key, Terminal, Server, X } from '@/shared/icons';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Drives which credential instructions to show. */
  deploymentMode: 'compose' | 'kubernetes';
}

/**
 * "Need help signing in?" modal for the login page.
 *
 * Deploy-aware: shows where the admin username/password come from for the
 * detected deployment (Docker Compose vs Kubernetes/Helm). Mirrors
 * DisclaimerModal's glass styling + AnimatePresence pattern.
 */
export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, deploymentMode }) => {
  const isK8s = deploymentMode === 'kubernetes';

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
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="border-2 rounded-xl shadow-hard-lg max-w-xl w-full max-h-[90vh] overflow-y-auto bg-surface"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)',
                filter: 'drop-shadow(0 0 30px color-mix(in srgb, var(--color-accent) 25%, transparent))',
              }}
            >
              {/* Header */}
              <div
                className="p-6 flex items-center justify-between"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                  borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
                    <HelpCircle className="w-7 h-7 text-accent" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-fg tracking-wide">Need help signing in?</h2>
                    <p className="text-sm text-fg-muted mt-1 flex items-center gap-1.5">
                      {isK8s ? <Server className="w-3.5 h-3.5" /> : <Terminal className="w-3.5 h-3.5" />}
                      {isK8s ? 'Kubernetes / Helm deployment' : 'Docker Compose deployment'}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-2 transition-colors" aria-label="Close">
                  <X className="w-5 h-5 text-fg-subtle" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-5 text-sm text-fg-muted">
                <div className="flex items-start gap-3">
                  <Key className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <p>
                    OpenAgentic uses <span className="text-fg font-semibold">local username/password</span> auth.
                    The first admin account is seeded when the platform first boots — from the values you set at
                    install time.
                  </p>
                </div>

                {isK8s ? (
                  <div className="rounded-lg p-4 space-y-3" style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
                    <p className="text-fg font-semibold">Helm deployment — your admin credentials</p>
                    <p>Set in your Helm values (e.g. <code className="text-accent">values-*.yaml</code>):</p>
                    <pre className="bg-surface-2 rounded p-3 text-xs overflow-x-auto text-fg">{`secrets:
  adminEmail: admin@openagentic.local
  adminPassword: <your-password>`}</pre>
                    <p>Inspect or reset on a running release:</p>
                    <pre className="bg-surface-2 rounded p-3 text-xs overflow-x-auto text-fg">{`# what was seeded
kubectl get secret -n <ns> openagentic-secrets \\
  -o jsonpath='{.data.admin-password}' | base64 -d

# change it: edit values + re-apply
helm upgrade openagentic ./helm/openagentic \\
  -n <ns> -f values-*.yaml`}</pre>
                  </div>
                ) : (
                  <div className="rounded-lg p-4 space-y-3" style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
                    <p className="text-fg font-semibold">Docker Compose — your admin credentials</p>
                    <p>
                      If you used <code className="text-accent">install.sh --quick</code>, the generated password was written to:
                    </p>
                    <pre className="bg-surface-2 rounded p-3 text-xs overflow-x-auto text-fg">{`~/.openagentic/admin-credentials.txt`}</pre>
                    <p>Otherwise they come from your <code className="text-accent">.env</code>:</p>
                    <pre className="bg-surface-2 rounded p-3 text-xs overflow-x-auto text-fg">{`ADMIN_USER_EMAIL=admin@openagentic.local
ADMIN_SEED_PASSWORD=<your-password>`}</pre>
                    <p>Changed <code className="text-accent">.env</code> after first boot? Re-seed:</p>
                    <pre className="bg-surface-2 rounded p-3 text-xs overflow-x-auto text-fg">{`docker compose up -d --force-recreate api`}</pre>
                  </div>
                )}

                <p className="text-xs text-fg/60">
                  Tip: the admin email/username is what you type in the username field. The seed password only
                  applies to the <em>first</em> boot — once changed in-app, update your install values to match.
                </p>
              </div>

              {/* Footer */}
              <div className="p-4 flex justify-end" style={{ borderTop: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
                <button
                  onClick={onClose}
                  className="py-2 px-5 rounded-lg text-sm font-medium text-accent hover:bg-surface-2 transition-colors"
                  style={{ border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' }}
                >
                  Got it
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default HelpModal;
