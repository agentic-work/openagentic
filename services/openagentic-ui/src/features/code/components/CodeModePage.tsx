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
 * CodeModePage - Main entry point for Code Mode
 *
 * Renders the Openagentic-style Code Mode interface (CodeModeLayoutV2).
 * Handles authentication, session management, provisioning check, and WebSocket connection.
 *
 * Flow:
 * 1. Check if user has Code Mode access
 * 2. Check if environment is provisioned
 * 3. If not provisioned, show ProvisioningScreen
 * 4. Once provisioned, show CodeModeLayoutV2
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { apiEndpoint } from '@/utils/api';

import { CodeModeLayoutV2 } from './CodeModeLayoutV2';
import { ProvisioningScreen } from './ProvisioningScreen';
import { useCodeModeWebSocket } from '../hooks/useCodeModeWebSocket';
import { useCodeModeStore, useSession } from '@/stores/useCodeModeStore';

type ProvisioningStatus = 'checking' | 'not_provisioned' | 'provisioning' | 'ready' | 'no_access' | 'error';

export const CodeModePage: React.FC = () => {
  const { user, getAuthHeaders } = useAuth();
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const session = useSession();

  const [provisioningStatus, setProvisioningStatus] = useState<ProvisioningStatus>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // NOTE: Do NOT use selector for action - use getState() to avoid subscription that causes re-renders
  // This is critical to prevent React error #185 (infinite re-render loop)

  // Check provisioning status on mount
  useEffect(() => {
    const checkProvisioning = async () => {
      try {
        const response = await fetch(apiEndpoint('/code/provisioning/status'), {
          headers: getAuthHeaders(),
        });

        if (!response.ok) {
          if (response.status === 401) {
            navigate('/login');
            return;
          }
          throw new Error('Failed to check provisioning status');
        }

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to check status');
        }

        if (!data.hasAccess) {
          setProvisioningStatus('no_access');
          setErrorMessage('Code Mode is not enabled for your account. Please contact your administrator.');
          return;
        }

        // Check status
        switch (data.status) {
          case 'ready':
            setProvisioningStatus('ready');
            useCodeModeStore.getState().activateCodeMode();
            break;
          case 'provisioning':
            setProvisioningStatus('provisioning');
            break;
          case 'failed':
          case 'not_provisioned':
          default:
            setProvisioningStatus('not_provisioned');
            break;
        }
      } catch (err: any) {
        console.error('Failed to check provisioning:', err);
        setProvisioningStatus('error');
        setErrorMessage(err.message || 'Failed to check environment status');
      }
    };

    checkProvisioning();
  }, [getAuthHeaders, navigate]); // Removed activateCodeMode - accessed via getState()

  // Get session params from URL (if coming from admin panel)
  const sessionId = searchParams.get('sessionId');
  const workspacePath = searchParams.get('workspace');

  // Get auth token for API mode (allows using platform LLM providers)
  // This token is passed to the backend which forwards it to CLI for LLM calls
  const authToken = localStorage.getItem('auth_token') || undefined;

  // Reset init steps when entering code mode so stale state from previous sessions is cleared
  useEffect(() => {
    if (provisioningStatus === 'ready') {
      useCodeModeStore.getState().resetInitSteps();
    }
  }, [provisioningStatus]);

  // Connect WebSocket (only when provisioned)
  const { sendMessage, stopExecution } = useCodeModeWebSocket({
    userId: user?.id || 'anonymous',
    initialSessionId: sessionId || undefined,
    workspacePath: workspacePath || '~',
    authToken,
    enabled: provisioningStatus === 'ready',
  });

  // Handle exit - navigate back
  const handleExit = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // Handle provisioning complete
  const handleProvisioningComplete = useCallback(() => {
    setProvisioningStatus('ready');
    useCodeModeStore.getState().activateCodeMode();
  }, []); // No deps - uses getState()

  // Handle provisioning error
  const handleProvisioningError = useCallback((error: string) => {
    console.error('Provisioning error:', error);
    // Error handling is done in ProvisioningScreen
  }, []);

  // Loading/Checking state
  if (provisioningStatus === 'checking') {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-success)] mx-auto" />
          <p className="mt-4 text-[var(--color-textMuted)]">Checking environment status...</p>
        </div>
      </div>
    );
  }

  // No access state
  if (provisioningStatus === 'no_access') {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center max-w-md mx-4">
          <div className="text-5xl mb-4">
            <span className="text-[var(--color-error)]">⚠️</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)] mb-2">Access Denied</h1>
          <p className="text-[var(--color-textMuted)] mb-6">{errorMessage}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-2 rounded-lg bg-[var(--color-surfaceSecondary)] hover:bg-[var(--color-surfaceHover)] text-[var(--color-text)] font-medium transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (provisioningStatus === 'error') {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center max-w-md mx-4">
          <div className="text-5xl mb-4">
            <span className="text-[var(--color-error)]">❌</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)] mb-2">Something Went Wrong</h1>
          <p className="text-[var(--color-textMuted)] mb-6">{errorMessage}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 rounded-lg bg-[var(--color-success)] hover:opacity-90 text-white font-medium transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => navigate(-1)}
              className="px-6 py-2 rounded-lg bg-[var(--color-surfaceSecondary)] hover:bg-[var(--color-surfaceHover)] text-[var(--color-text)] font-medium transition-colors"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Provisioning needed
  if (provisioningStatus === 'not_provisioned' || provisioningStatus === 'provisioning') {
    return (
      <ProvisioningScreen
        onComplete={handleProvisioningComplete}
        onError={handleProvisioningError}
      />
    );
  }

  // Ready - show Code Mode
  return (
    <CodeModeLayoutV2
      userId={user?.id || 'anonymous'}
      workspacePath={workspacePath || session?.workspacePath || '~'}
      onExit={handleExit}
      theme={resolvedTheme as 'light' | 'dark'}
      onSendMessage={sendMessage}
      onStopExecution={stopExecution}
      hostname={session?.hostname}
      cliVersion={session?.cliVersion}
      storageBucket={session?.storageBucket}
      storageType={session?.storageType}
    />
  );
};

export default CodeModePage;
