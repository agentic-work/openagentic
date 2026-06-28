/**
 * Login Component - OpenAgentic Platform
 * Modern minimal design with glassmorphism
 * Conditionally shows auth providers based on environment config
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/providers/AuthContext';
import {
  AlertCircle,
  HelpCircle,
  Sparkles
} from 'lucide-react';
import { DisclaimerModal } from './DisclaimerModal';
import { HelpModal } from './HelpModal';
import { useSystemConfig } from '@/hooks/useSystemConfig';
import { Input } from '@/shared/ui/Input';
import { Button } from '@/shared/ui/Button';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { config } = useSystemConfig();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        await login(data.token);
        navigate('/chat');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisclaimerAccept = async () => {
    if (!pendingToken) return;

    try {
      await fetch('/api/auth/accept-disclaimer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pendingToken}`,
        },
      });

      await login(pendingToken);
      navigate('/chat');
    } catch {
      setError('Failed to record disclaimer acceptance. Please try again.');
      setShowDisclaimer(false);
      setPendingToken(null);
    }
  };

  const handleDisclaimerDecline = () => {
    setShowDisclaimer(false);
    setPendingToken(null);
    setEmail('');
    setPassword('');
    setError('You must accept the disclaimer to continue.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* openagentics.io "field-guide" warm glow — signal orange on warm-black */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-[120px] animate-pulse" style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }} />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-[100px] animate-pulse" style={{ background: 'color-mix(in srgb, var(--brand-signal-soft) 8%, transparent)', animationDelay: '1s' }} />
      </div>

      {/* Grid pattern overlay (paper hairline) */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `linear-gradient(color-mix(in srgb, var(--color-fg) 50%, transparent) 1px, transparent 1px),
                           linear-gradient(90deg, color-mix(in srgb, var(--color-fg) 50%, transparent) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      {/* Main content */}
      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex justify-center mb-12"
        >
          <div className="relative flex items-center">
            <div className="absolute -inset-5 rounded-2xl blur-xl" style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }} />
            <span
              className="relative"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, letterSpacing: 'var(--tracking-h2)', color: 'var(--color-fg)' }}
            >
              <span style={{ color: 'var(--color-accent)' }}>⌥ </span>openagentic
            </span>
          </div>
        </motion.div>

        {/* Login Card — Terminal Glass frosted panel (translucent --glass-bg +
            --glass-blur + --glass-shadow over the living aurora). */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative">
            <div className="glass relative p-8">
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="text-center mb-8">
                  <div className="eyebrow text-accent mb-3">⌥ § Sign in</div>
                  <h2 className="display text-2xl mb-2 text-fg">
                    Welcome back
                  </h2>
                  <p className="text-sm text-fg-muted">
                    Sign in to continue to your workspace
                  </p>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 rounded-xl mb-6 flex items-start gap-3 border border-err/40 bg-err/10"
                  >
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-err)' }} />
                    <span className="text-sm" style={{ color: 'var(--color-err)' }}>{error}</span>
                  </motion.div>
                )}

                <form onSubmit={handleLocalLogin} className="space-y-4">
                  <Input
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={isLoading}
                    className="w-full gap-2 mt-2"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-on-accent/30 border-t-on-accent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Sign In</span>
                      </>
                    )}
                  </Button>
                </form>
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Help Link — opens the deploy-aware credential-help modal.
            Hidden entirely when LOGIN_HELP_MODAL=false (config.features.loginHelp). */}
        {config.features.loginHelp && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            onClick={() => setShowHelp(true)}
            className="btn-label w-full mt-6 py-3 px-4 rounded-none flex items-center justify-center gap-2 text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors text-xs"
          >
            <HelpCircle className="w-4 h-4" />
            <span>Need help signing in?</span>
          </motion.button>
        )}

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-8 text-center"
        >
          <p className="text-[11px] text-fg/45">
            © {new Date().getFullYear()} Agenticwork™ LLC
          </p>
        </motion.div>
      </div>

      {/* Help Modal — deploy-aware (compose vs helm) admin-credential help */}
      <HelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        deploymentMode={config.deploymentMode}
      />

      {/* Disclaimer Modal */}
      {showDisclaimer && (
        <DisclaimerModal
          isOpen={showDisclaimer}
          onAccept={handleDisclaimerAccept}
          onDecline={handleDisclaimerDecline}
        />
      )}
    </div>
  );
};

export default Login;
