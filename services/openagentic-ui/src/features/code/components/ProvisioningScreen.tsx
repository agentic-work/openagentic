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
 * ProvisioningScreen - First-time Code Mode Setup UI
 *
 * Displays a progress screen while provisioning the user's sandboxed
 * development environment (storage, sandbox, vscode, openagentic).
 * Shows real-time progress via SSE from the API.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  HardDrive,
  Shield,
  Code2,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
} from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';

interface ProvisioningStep {
  name: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  message?: string;
  progress?: number;
}

interface ProvisioningProgress {
  userId: string;
  status: 'pending' | 'provisioning' | 'ready' | 'failed' | 'suspended';
  statusMessage: string;
  steps: ProvisioningStep[];
  overallProgress: number;
  estimatedTimeRemaining?: number;
}

interface ProvisioningScreenProps {
  onComplete: () => void;
  onError?: (error: string) => void;
}

// Status message based on current step (removed rotating "fun" messages)
const getStatusMessage = (steps: ProvisioningStep[]): string => {
  const runningStep = steps.find(s => s.status === 'running');
  if (runningStep) {
    switch (runningStep.name) {
      case 'storage': return 'Provisioning cloud storage...';
      case 'sandbox': return 'Creating sandbox environment...';
      case 'vscode': return 'Setting up VS Code...';
      case 'openagentic': return 'Initializing AI assistant...';
      case 'validation': return 'Validating environment...';
      default: return 'Setting up your environment...';
    }
  }
  const failedStep = steps.find(s => s.status === 'failed');
  if (failedStep) return 'Setup encountered an error';
  return 'Preparing your development environment...';
};

// Step icons
const stepIcons: Record<string, React.ReactNode> = {
  storage: <HardDrive size={20} />,
  sandbox: <Shield size={20} />,
  vscode: <Code2 size={20} />,
  openagentic: <Sparkles size={20} />,
  validation: <CheckCircle2 size={20} />,
};

const stepLabels: Record<string, string> = {
  storage: 'Cloud Storage',
  sandbox: 'Sandbox Environment',
  vscode: 'VS Code',
  openagentic: 'AI Assistant',
  validation: 'Environment Check',
};

export const ProvisioningScreen: React.FC<ProvisioningScreenProps> = ({
  onComplete,
  onError,
}) => {
  const { getAuthHeaders } = useAuth();
  const [progress, setProgress] = useState<ProvisioningProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Get current status message based on progress
  const currentSteps = progress?.steps || [
    { name: 'storage', status: 'pending' as const },
    { name: 'sandbox', status: 'pending' as const },
    { name: 'vscode', status: 'pending' as const },
    { name: 'openagentic', status: 'pending' as const },
    { name: 'validation', status: 'pending' as const },
  ];
  const statusMessage = getStatusMessage(currentSteps);

  // Start provisioning
  const startProvisioning = useCallback(async () => {
    setError(null);
    setIsRetrying(false);

    // Close any existing EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Use fetch with POST to start, which returns SSE stream
      const response = await fetch(apiEndpoint('/code/provisioning/start'), {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.alreadyProvisioned) {
          onComplete();
          return;
        }
        throw new Error(data.error || 'Failed to start provisioning');
      }

      // Handle SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Failed to get response stream');
      }

      let buffer = '';

      const processStream = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                handleSSEEvent(eventType, data);
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
            }
          }
        }
      };

      processStream().catch((err) => {
        console.error('Stream error:', err);
        setError(err.message || 'Connection lost');
      });

    } catch (err: any) {
      console.error('Provisioning error:', err);
      setError(err.message || 'Failed to start provisioning');
      onError?.(err.message);
    }
  }, [getAuthHeaders, onComplete, onError]);

  // Handle SSE events
  const handleSSEEvent = (eventType: string, data: any) => {
    switch (eventType) {
      case 'start':
        console.log('[Provisioning] Started:', data);
        break;

      case 'progress':
        setProgress(data as ProvisioningProgress);
        break;

      case 'complete':
        if (data.success) {
          setProgress((prev) =>
            prev
              ? { ...prev, status: 'ready', overallProgress: 100 }
              : null
          );
          setTimeout(() => onComplete(), 1000); // Brief delay to show completion
        } else {
          setError(data.error || 'Provisioning failed');
        }
        break;

      case 'error':
        setError(data.error || 'An error occurred');
        onError?.(data.error);
        break;
    }
  };

  // Start provisioning on mount
  useEffect(() => {
    startProvisioning();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [startProvisioning]);

  // Retry handler
  const handleRetry = () => {
    setIsRetrying(true);
    startProvisioning();
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-[var(--color-background)]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full mx-4"
      >
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <motion.div
            className="text-5xl mb-4 inline-block"
            animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span className="text-[var(--color-success)]">◆</span>
          </motion.div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)] mb-2">
            Setting Up Your Environment
          </h1>
          <p className="text-[var(--color-textMuted)] text-sm">
            {error ? 'Something went wrong' : statusMessage}
          </p>
        </div>

        {/* Error State */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30"
          >
            <div className="flex items-center gap-3 text-red-400">
              <XCircle size={20} />
              <span className="text-sm">{error}</span>
            </div>
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="mt-4 w-full py-2 px-4 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {isRetrying ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Try Again
            </button>
          </motion.div>
        )}

        {/* Progress Steps */}
        {!error && (
          <div className="space-y-3 mb-8">
            {currentSteps.map((step, index) => (
              <motion.div
                key={step.name}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`
                  flex items-center gap-4 p-3 rounded-lg transition-all
                  ${step.status === 'running' ? 'bg-[#22C55E]/10 ring-1 ring-[#22C55E]/30' : ''}
                  ${step.status === 'complete' ? 'bg-[#22C55E]/5' : ''}
                  ${step.status === 'failed' ? 'bg-red-500/10' : ''}
                `}
              >
                {/* Icon */}
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    ${step.status === 'pending' ? 'bg-[#21262d] text-[#8b949e]' : ''}
                    ${step.status === 'running' ? 'bg-[#22C55E]/20 text-[#22C55E]' : ''}
                    ${step.status === 'complete' ? 'bg-[#22C55E]/20 text-[#22C55E]' : ''}
                    ${step.status === 'failed' ? 'bg-red-500/20 text-red-400' : ''}
                  `}
                >
                  {step.status === 'running' ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : step.status === 'complete' ? (
                    <CheckCircle2 size={20} />
                  ) : step.status === 'failed' ? (
                    <XCircle size={20} />
                  ) : (
                    stepIcons[step.name]
                  )}
                </div>

                {/* Label and status */}
                <div className="flex-1">
                  <div
                    className={`
                      font-medium text-sm
                      ${step.status === 'pending' ? 'text-[#8b949e]' : ''}
                      ${step.status === 'running' ? 'text-[#22C55E]' : ''}
                      ${step.status === 'complete' ? 'text-[#22C55E]' : ''}
                      ${step.status === 'failed' ? 'text-red-400' : ''}
                    `}
                  >
                    {stepLabels[step.name] || step.name}
                  </div>
                  {step.message && (
                    <div className="text-xs text-[#8b949e] mt-0.5">
                      {step.message}
                    </div>
                  )}
                </div>

                {/* Status indicator */}
                {step.status === 'complete' && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="text-[#22C55E]"
                  >
                    <CheckCircle2 size={16} />
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Overall Progress Bar */}
        {!error && (
          <div className="space-y-2">
            <div className="h-2 bg-[#21262d] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-[#22C55E] to-[#28A745]"
                initial={{ width: 0 }}
                animate={{ width: `${progress?.overallProgress || 0}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="flex justify-between text-xs text-[#8b949e]">
              <span>{progress?.overallProgress || 0}% complete</span>
              {progress?.estimatedTimeRemaining && progress.estimatedTimeRemaining > 0 && (
                <span>~{progress.estimatedTimeRemaining}s remaining</span>
              )}
            </div>
          </div>
        )}

        {/* Footer message */}
        <div className="mt-8 text-center text-xs text-[#6e7681]">
          This is a one-time setup. Your environment will be ready for future visits.
        </div>
      </motion.div>
    </div>
  );
};

export default ProvisioningScreen;
