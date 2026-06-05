/**
 * Login Component - OpenAgentic Platform
 * Modern minimal design with glassmorphism
 * Conditionally shows auth providers based on environment config
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/providers/AuthContext';
import {
  AlertCircle,
  X,
  Mail,
  HelpCircle,
  ArrowLeft,
  Sparkles
} from 'lucide-react';
import { DisclaimerModal } from './DisclaimerModal';
import { Input } from '@/shared/ui/Input';
import { Button } from '@/shared/ui/Button';
import {
  isGoogleLoginEnabled,
  isMicrosoftLoginEnabled,
  isLocalLoginEnabled
} from '@/config/runtime';

// Auth provider configuration from runtime config (supports dynamic env vars)
const authConfig = {
  googleEnabled: isGoogleLoginEnabled(),
  microsoftEnabled: isMicrosoftLoginEnabled(),
  localEnabled: isLocalLoginEnabled(),
};

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLocalForm, setShowLocalForm] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
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

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google/login';
  };

  const handleMicrosoftLogin = () => {
    window.location.href = '/api/auth/microsoft/login';
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

  // Count enabled providers for layout decisions
  const enabledProviders = [
    authConfig.googleEnabled,
    authConfig.microsoftEnabled,
    authConfig.localEnabled
  ].filter(Boolean).length;

  const showDivider = authConfig.localEnabled && (authConfig.googleEnabled || authConfig.microsoftEnabled);

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
              <AnimatePresence mode="wait">
                {!showLocalForm ? (
                  <motion.div
                    key="options"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -20 }}
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

                    {/* Microsoft Login - only if enabled */}
                    {authConfig.microsoftEnabled && (
                      <motion.button
                        onClick={handleMicrosoftLogin}
                        whileTap={{ scale: 0.99 }}
                        className="glass-btn glass-btn-secondary btn-label w-full py-3.5 px-4 gap-3 mb-3"
                      >
                        <svg className="w-5 h-5" viewBox="0 0 21 21" fill="none">
                          <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                          <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                          <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                          <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                        </svg>
                        <span>Continue with Microsoft</span>
                      </motion.button>
                    )}

                    {/* Google Login - only if enabled */}
                    {authConfig.googleEnabled && (
                      <motion.button
                        onClick={handleGoogleLogin}
                        whileTap={{ scale: 0.99 }}
                        className={`glass-btn glass-btn-secondary btn-label w-full py-3.5 px-4 gap-3 ${enabledProviders === 1 ? '' : 'mb-4'}`}
                      >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        <span>Continue with Google</span>
                      </motion.button>
                    )}

                    {/* Divider - only if local login is also enabled */}
                    {showDivider && (
                      <div className="flex items-center gap-4 my-6">
                        <div className="flex-1 h-px bg-rule" />
                        <span className="eyebrow text-fg-subtle">or</span>
                        <div className="flex-1 h-px bg-rule" />
                      </div>
                    )}

                    {/* Email Login - only if enabled */}
                    {authConfig.localEnabled && (
                      <motion.button
                        onClick={() => setShowLocalForm(true)}
                        whileTap={{ scale: 0.99 }}
                        className="glass-btn glass-btn-ghost btn-label w-full py-3 px-4 gap-3 text-fg-muted hover:text-fg"
                      >
                        <Mail className="w-4 h-4" />
                        <span>Continue with Email</span>
                      </motion.button>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <button
                      onClick={() => {
                        setShowLocalForm(false);
                        setError('');
                        setEmail('');
                        setPassword('');
                      }}
                      className="btn-label flex items-center gap-2 text-fg-muted hover:text-fg transition-colors mb-6 text-xs"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to options
                    </button>

                    <div className="mb-6">
                      <div className="eyebrow text-accent mb-3">⌥ § Email</div>
                      <h2 className="display text-xl mb-1 text-fg">
                        Sign in with email
                      </h2>
                      <p className="text-sm text-fg-subtle">
                        Enter your credentials to continue
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
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* Help Link */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          onClick={() => {}}
          className="btn-label w-full mt-6 py-3 px-4 rounded-none flex items-center justify-center gap-2 text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors text-xs"
        >
          <HelpCircle className="w-4 h-4" />
          <span>Need help signing in?</span>
        </motion.button>

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
