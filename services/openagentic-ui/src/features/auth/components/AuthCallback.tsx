/**
 * Azure AD Auth Callback Component
 * Handles the redirect back from Microsoft OAuth flow
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthContext';
import { motion } from 'framer-motion';
import { Card } from '@/shared/ui/Card';
import { apiEndpoint } from '@/utils/api';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState<string | {title: string; message: string; details: string; action: string} | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const processCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const sessionId = urlParams.get('session') || urlParams.get('sessionId'); // Support both 'session' and 'sessionId' params
        const success = urlParams.get('success');
        const code = urlParams.get('code');

        if (success === 'true' && sessionId) {
          // New session-based flow - exchange sessionId for token
          try {
            // Use the proper API endpoint construction
            const response = await fetch(apiEndpoint('/auth/exchange-session'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ sessionId }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.message || 'Session exchange failed');
            }

            const data = await response.json();
            if (!data.token) {
              throw new Error('No token received from session exchange');
            }

            // Also set the token as a cookie for browser navigations
            // The cookie is used by the unified auth middleware
            document.cookie = `openagentic_token=${data.token}; path=/; max-age=86400; SameSite=Lax`;

            // Use the exchanged token to login
            await login(data.token);

            // Clear the URL params
            window.history.replaceState({}, document.title, '/');

            // Redirect to home page
            navigate('/');
          } catch (exchangeError: any) {
            console.error('Session exchange failed:', exchangeError);
            setError({
              title: 'Authentication Failed',
              message: exchangeError.message || 'Failed to exchange session for token',
              details: 'Your authentication session may have expired.',
              action: 'Please try signing in again.'
            });
            setIsProcessing(false);
            return;
          }
        } else if (success === 'true' && token) {
          // Legacy token-based flow (fallback)
          // Also set the token as a cookie for browser navigations
          document.cookie = `openagentic_token=${token}; path=/; max-age=86400; SameSite=Lax`;
          await login(token);

          // Clear the URL params
          window.history.replaceState({}, document.title, '/');

          // Redirect to home page
          navigate('/');
        } else if (code) {
          // OAuth code flow - redirect to API to exchange code for token
          // The API will process the code and redirect back with token
          window.location.href = `/api/auth/microsoft/callback?${window.location.search.substring(1)}`;
          return;
        } else {
          // Check for error in URL params
          const errorParam = urlParams.get('error');
          const messageParam = urlParams.get('message');

          if (errorParam || messageParam) {
            // Parse the error message for better UX
            let errorMessage = errorParam || 'Authentication failed';
            let detailMessage = messageParam || '';

            // Try to parse JSON error if it exists
            try {
              if (errorParam && errorParam.startsWith('{')) {
                const parsed = JSON.parse(errorParam);
                errorMessage = parsed.error || errorMessage;
                detailMessage = parsed.message || detailMessage;
              }
            } catch (e) {
              // Not JSON, use as-is
            }

            // Format the error message for display
            if (detailMessage.includes('not a member of any authorized Azure AD groups')) {
              // Extract email and group names for clearer message
              const emailMatch = detailMessage.match(/User (\S+@\S+)/);
              const groupsMatch = detailMessage.match(/\(([^)]+)\)/);

              const userEmail = emailMatch ? emailMatch[1] : 'Your account';
              const groups = groupsMatch ? groupsMatch[1] : 'authorized groups';

              setError({
                title: 'Access Denied',
                message: `${userEmail} is not authorized to access this application.`,
                details: `You need to be a member of one of these Azure AD groups: ${groups}`,
                action: 'Please contact your administrator for access.'
              });
            } else if (detailMessage.includes('invalid signature')) {
              setError({
                title: 'Authentication Error',
                message: 'Token validation failed.',
                details: 'There was an issue validating your authentication token.',
                action: 'Please try signing in again.'
              });
            } else {
              setError({
                title: errorMessage,
                message: detailMessage || 'An error occurred during authentication.',
                details: '',
                action: 'Please try signing in again.'
              });
            }
          } else {
            setError({
              title: 'Authentication Failed',
              message: 'No valid token received from the authentication service.',
              details: '',
              action: 'Please try signing in again.'
            });
          }
          setIsProcessing(false);
        }
      } catch (err) {
        console.error('Auth callback processing failed:', err);
        setError({
          title: 'System Error',
          message: 'Failed to process authentication callback.',
          details: '',
          action: 'Please try again or contact support if the issue persists.'
        });
        setIsProcessing(false);
      }
    };

    processCallback();
  }, [login, navigate]);

  const handleRetryLogin = () => {
    navigate('/login');
  };

  if (error) {
    const isStructuredError = typeof error === 'object' && error !== null;
    const errorTitle = isStructuredError ? error.title : 'Authentication Failed';
    const errorMessage = isStructuredError ? error.message : error;
    const errorDetails = isStructuredError ? error.details : '';
    const errorAction = isStructuredError ? error.action : 'Please try signing in again.';

    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="absolute inset-0 bg-grid-fg/[0.02]" />
        <Card
        className="w-full max-w-lg p-8 relative z-10"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-rule-strong)' }}>
          <div className="text-center">
            <div className="mx-auto w-16 h-16 flex items-center justify-center mb-4">
              <div className="text-4xl">
                {errorTitle === 'Access Denied' ? '🚫' : '⚠️'}
              </div>
            </div>
            <h2 
            className="text-2xl font-bold mb-4"
            style={{ color: 'var(--color-text)' }}>{errorTitle}</h2>
            <p 
            className="mb-3 text-lg"
            style={{ color: 'var(--color-textMuted)' }}>{typeof errorMessage === 'string' ? errorMessage : ''}</p>
            {errorDetails && (
              <p 
              className="mb-6 text-sm"
              style={{ color: 'var(--color-textMuted)' }}>{errorDetails}</p>
            )}
            <div className="rounded-lg p-4 mb-6" style={{ background: 'color-mix(in srgb, var(--color-nfo) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-nfo) 30%, transparent)' }}>
              <p className="text-sm" style={{ color: 'var(--color-nfo)' }}>{errorAction}</p>
            </div>
            <div className="space-y-3">
              <button
                onClick={handleRetryLogin}

                className="w-full px-4 py-3 rounded-lg transition-colors font-medium hover:opacity-90"
                style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
              >
                Sign In Again
              </button>
              {errorTitle === 'Access Denied' && (
                <p
                  className="block w-full px-4 py-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-textMuted)' }}
                >
                  Contact your administrator to request access.
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="absolute inset-0 bg-grid-fg/[0.02]" />
      <Card
      className="w-full max-w-md p-8 relative z-10"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-rule-strong)' }}>
        <div className="text-center">
          <motion.div 
            className="mx-auto w-16 h-16 flex items-center justify-center mb-4"
            animate={{ rotate: 360 }}
            transition={{ 
              duration: 2, 
              ease: "linear",
              repeat: Infinity 
            }}
          >
            <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--color-rule)', borderTopColor: 'var(--color-fg)' }} />
          </motion.div>
          <h2 
          className="text-xl font-bold mb-4"
          style={{ color: 'var(--color-text)' }}>Processing Authentication</h2>
          <p style={{ color: 'var(--color-textMuted)' }}>Please wait while we complete your login...</p>
        </div>
      </Card>
    </div>
  );
};

export default AuthCallback;