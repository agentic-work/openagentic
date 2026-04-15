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
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0a0f]">
      {/* Animated gradient background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/50 via-transparent to-blue-950/50" />
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-violet-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-600/10 rounded-full blur-[150px]" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
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
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-r from-violet-600/20 to-blue-600/20 rounded-2xl blur-xl" />
            <img
              src="/company-logo.svg"
              alt="OpenAgentic"
              className="relative h-16 w-auto drop-shadow-2xl"
            />
          </div>
        </motion.div>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative">
            {/* Card glow effect */}
            <div className="absolute -inset-[1px] bg-gradient-to-b from-white/20 to-white/5 rounded-2xl" />

            <div className="relative bg-white/[0.03] backdrop-blur-2xl rounded-2xl border border-white/10 p-8">
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
                      <h2 className="text-2xl font-semibold text-white mb-2">
                        Welcome back
                      </h2>
                      <p className="text-white/50 text-sm">
                        Sign in to continue to your workspace
                      </p>
                    </div>

                    {error && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-4 rounded-xl mb-6 flex items-start gap-3 bg-red-500/10 border border-red-500/20"
                      >
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
                        <span className="text-sm text-red-400">{error}</span>
                      </motion.div>
                    )}

                    {/* Microsoft Login - only if enabled */}
                    {authConfig.microsoftEnabled && (
                      <motion.button
                        onClick={handleMicrosoftLogin}
                        whileHover={{ scale: 1.01, backgroundColor: 'rgba(255,255,255,0.08)' }}
                        whileTap={{ scale: 0.99 }}
                        className="w-full py-3.5 px-4 rounded-xl font-medium text-white flex items-center justify-center gap-3 mb-3 transition-all duration-200 bg-white/5 border border-white/10 hover:border-white/20"
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
                        whileHover={{ scale: 1.01, backgroundColor: 'rgba(255,255,255,0.08)' }}
                        whileTap={{ scale: 0.99 }}
                        className={`w-full py-3.5 px-4 rounded-xl font-medium text-white flex items-center justify-center gap-3 transition-all duration-200 bg-white/5 border border-white/10 hover:border-white/20 ${enabledProviders === 1 ? '' : 'mb-4'}`}
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
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-xs text-white/30 uppercase tracking-wider">or</span>
                        <div className="flex-1 h-px bg-white/10" />
                      </div>
                    )}

                    {/* Email Login - only if enabled */}
                    {authConfig.localEnabled && (
                      <motion.button
                        onClick={() => setShowLocalForm(true)}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className="w-full py-3 px-4 rounded-xl font-medium text-white/70 flex items-center justify-center gap-3 transition-all duration-200 border border-dashed border-white/10 hover:border-white/20 hover:text-white hover:bg-white/[0.02]"
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
                      className="flex items-center gap-2 text-white/50 hover:text-white transition-colors mb-6 text-sm"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to options
                    </button>

                    <div className="mb-6">
                      <h2 className="text-xl font-semibold text-white mb-1">
                        Sign in with email
                      </h2>
                      <p className="text-white/40 text-sm">
                        Enter your credentials to continue
                      </p>
                    </div>

                    {error && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-4 rounded-xl mb-6 flex items-start gap-3 bg-red-500/10 border border-red-500/20"
                      >
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
                        <span className="text-sm text-red-400">{error}</span>
                      </motion.div>
                    )}

                    <form onSubmit={handleLocalLogin} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">
                          Email
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none transition-all focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                          placeholder="you@example.com"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">
                          Password
                        </label>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none transition-all focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                          placeholder="Enter your password"
                          required
                        />
                      </div>
                      <motion.button
                        type="submit"
                        disabled={isLoading}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className="w-full py-3.5 rounded-xl font-semibold text-white flex items-center justify-center gap-2 mt-6 transition-all disabled:opacity-60 disabled:cursor-not-allowed relative overflow-hidden group"
                        style={{
                          background: 'linear-gradient(135deg, #7C3AED 0%, #4F46E5 50%, #3B82F6 100%)',
                        }}
                      >
                        <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                        {isLoading ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            <span>Sign In</span>
                          </>
                        )}
                      </motion.button>
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
          onClick={() => setShowSupport(true)}
          className="w-full mt-6 py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-white/40 hover:text-white/70 hover:bg-white/5 transition-all text-sm"
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
          <p className="text-[11px] text-white/20">
            © {new Date().getFullYear()} OpenAgentic
          </p>
        </motion.div>
      </div>

      {/* Support Modal */}
      <AnimatePresence>
        {showSupport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowSupport(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0a0a0f] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-white">Get Support</h2>
                <button
                  onClick={() => setShowSupport(false)}
                  className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <a
                href="mailto:support@openagentics.io"
                className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/[0.07] transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <p className="font-medium text-white">Email Support</p>
                  <p className="text-sm text-white/50">support@openagentics.io</p>
                </div>
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Terms Modal */}
      <AnimatePresence>
        {showTerms && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowTerms(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0a0a0f] border border-white/10 rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-white">Terms of Service</h2>
                <button
                  onClick={() => setShowTerms(false)}
                  className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="text-sm space-y-4 text-white/60">
                <p>
                  By accessing and using OpenAgentic, you agree to our terms of service.
                  This platform provides AI-assisted services for enterprise operations.
                </p>
                <p>
                  Your use of this system indicates acceptance of our data handling practices
                  and security protocols. All activities may be monitored for quality and security purposes.
                </p>
                <p>
                  All data processed through this platform is subject to our data governance policies
                  and security requirements.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Privacy Modal */}
      <AnimatePresence>
        {showPrivacy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowPrivacy(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0a0a0f] border border-white/10 rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-white">Privacy Policy</h2>
                <button
                  onClick={() => setShowPrivacy(false)}
                  className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="text-sm space-y-4 text-white/60">
                <p>
                  OpenAgentic collects and maintains information necessary to provide AI-assisted services.
                  This includes conversation data, usage analytics, and account information.
                </p>
                <p>
                  Your data is protected under our privacy policy and enterprise security standards.
                  We do not share your data with third parties except as outlined in our privacy policy.
                </p>
                <p>
                  For questions about data handling, contact our support team at support@openagentics.io.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
