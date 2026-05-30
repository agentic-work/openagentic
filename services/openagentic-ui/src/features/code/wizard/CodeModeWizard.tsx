/**
 * CodeModeWizard — guided first-run wizard for Code Mode.
 *
 * Flow: Welcome → Prereq → Model → Workspace → Launch
 *
 * Props:
 *   onLaunched(session)  — called with the created session object on success
 *   onClose?()           — called when the user dismisses the wizard
 */
import React, { useEffect, useState } from 'react';
import { apiRequest } from '@/utils/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'welcome' | 'prereq' | 'model' | 'workspace' | 'launch';
type WorkspaceType = 'empty' | 'clone';

interface ModelOption {
  id: string;
  name: string;
  provider?: string;
}

interface WizardProps {
  onLaunched: (session: any) => void;
  onClose?: () => void;
  /** Which step to start on. Defaults to 'welcome'. */
  startStep?: Phase;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

const stepLabel: Record<Phase, string> = {
  welcome: 'Welcome',
  prereq: 'Prerequisites',
  model: 'Pick a Model',
  workspace: 'Workspace',
  launch: 'Launch',
};

const PHASE_ORDER: Phase[] = ['welcome', 'prereq', 'model', 'workspace', 'launch'];

function progressIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

// ---------------------------------------------------------------------------
// Step content components
// ---------------------------------------------------------------------------

function WelcomeStep() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ap-fg-2, #aaa)' }}>
        Code Mode gives you a full AI coding assistant powered by Claude Code — running in an
        isolated workspace with access to a live terminal.
      </p>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ap-fg-2, #aaa)' }}>
        This wizard takes about 30 seconds to set up your first session.
      </p>
    </div>
  );
}

function PrereqStep({
  loading,
  models,
  error,
}: {
  loading: boolean;
  models: ModelOption[] | null;
  error: string | null;
}) {
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            border: '2px solid var(--ap-fg-3, #666)',
            borderTopColor: 'var(--ap-accent, #6c63ff)',
            borderRadius: '50%',
            animation: 'cmw-spin 0.7s linear infinite',
          }}
        />
        <style>{`@keyframes cmw-spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ fontSize: 13, color: 'var(--ap-fg-2, #aaa)' }}>Checking models…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ color: 'var(--ap-err, #ff5555)', fontSize: 13 }}>
        Failed to fetch models: {error}
      </div>
    );
  }

  if (!models || models.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--ap-bg-2, #1e1e1e)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--ap-warn, #f0a500)',
          }}
        >
          No models configured yet.
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ap-fg-2, #aaa)' }}>
          At least one LLM provider must be configured before using Code Mode.
          Please visit Provider Management to add a provider, then return here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--ap-bg-2, #1e1e1e)',
          borderRadius: 8,
        }}
      >
        <span style={{ color: 'var(--ap-success, #50fa7b)', fontSize: 16 }}>✓</span>
        <span style={{ fontSize: 13, color: 'var(--ap-fg-1, #e0e0e0)' }}>
          Model available — {models.length} model{models.length !== 1 ? 's' : ''} ready
        </span>
      </div>
    </div>
  );
}

function ModelStep({
  models,
  selectedModel,
  onSelect,
}: {
  models: ModelOption[];
  selectedModel: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label
        htmlFor="cmw-model-select"
        style={{ fontSize: 13, color: 'var(--ap-fg-2, #aaa)', fontWeight: 500 }}
      >
        Select the model to use for this Code Mode session:
      </label>
      <select
        id="cmw-model-select"
        value={selectedModel}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          borderRadius: 8,
          border: '1px solid var(--ap-ln-2, #333)',
          background: 'var(--ap-bg-0, #0d0d0d)',
          color: 'var(--ap-fg-1, #e0e0e0)',
          cursor: 'pointer',
        }}
      >
        <option value="">Smart Router (default)</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name || m.id}
          </option>
        ))}
      </select>
    </div>
  );
}

function WorkspaceStep({
  workspaceType,
  repoUrl,
  onTypeChange,
  onRepoUrlChange,
}: {
  workspaceType: WorkspaceType;
  repoUrl: string;
  onTypeChange: (t: WorkspaceType) => void;
  onRepoUrlChange: (url: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ap-fg-2, #aaa)' }}>
        Choose how to initialize the workspace for this session:
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            fontSize: 14,
            color: 'var(--ap-fg-1, #e0e0e0)',
          }}
        >
          <input
            type="radio"
            name="cmw-workspace-type"
            value="empty"
            checked={workspaceType === 'empty'}
            onChange={() => onTypeChange('empty')}
            aria-label="Empty workspace"
          />
          Empty workspace
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            fontSize: 14,
            color: 'var(--ap-fg-1, #e0e0e0)',
          }}
        >
          <input
            type="radio"
            name="cmw-workspace-type"
            value="clone"
            checked={workspaceType === 'clone'}
            onChange={() => onTypeChange('clone')}
            aria-label="Clone a repository"
          />
          Clone a repository
        </label>
      </div>

      {workspaceType === 'clone' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="cmw-repo-url"
            style={{ fontSize: 12, color: 'var(--ap-fg-3, #666)' }}
          >
            Repository URL
          </label>
          <input
            id="cmw-repo-url"
            type="url"
            value={repoUrl}
            onChange={(e) => onRepoUrlChange(e.target.value)}
            placeholder="https://github.com/org/repo"
            style={{
              padding: '8px 10px',
              fontSize: 13,
              borderRadius: 8,
              border: '1px solid var(--ap-ln-2, #333)',
              background: 'var(--ap-bg-0, #0d0d0d)',
              color: 'var(--ap-fg-1, #e0e0e0)',
            }}
          />
        </div>
      )}
    </div>
  );
}

function LaunchStep({
  launching,
  error,
  onLaunch,
}: {
  launching: boolean;
  error: string | null;
  onLaunch: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ap-fg-2, #aaa)' }}>
        Everything looks good. Click below to start your Code Mode session.
      </p>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--ap-bg-2, #1e1e1e)',
            borderRadius: 8,
            color: 'var(--ap-err, #ff5555)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onLaunch}
        disabled={launching}
        style={{
          padding: '10px 18px',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          border: 'none',
          background: 'var(--ap-accent, #6c63ff)',
          color: '#fff',
          cursor: launching ? 'not-allowed' : 'pointer',
          opacity: launching ? 0.6 : 1,
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {launching && (
          <span
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'cmw-spin 0.7s linear infinite',
            }}
          />
        )}
        Open Code Mode
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export function CodeModeWizard({ onLaunched, onClose, startStep = 'welcome' }: WizardProps) {
  const [phase, setPhase] = useState<Phase>(startStep);

  // Prereq state
  const [modelsLoading, setModelsLoading] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Model selection
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Workspace
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>('empty');
  const [repoUrl, setRepoUrl] = useState('');

  // Launch
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Phase transitions
  // ---------------------------------------------------------------------------

  const phaseIdx = progressIndex(phase);
  const isFirst = phaseIdx === 0;
  const isLast = phaseIdx === PHASE_ORDER.length - 1;

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await apiRequest('/api/chat/models');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      // /api/chat/models returns { models: [...] }; also tolerate a bare array.
      setModels(Array.isArray(data) ? data : (data?.models ?? []));
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Unknown error');
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleNext = () => {
    const next = PHASE_ORDER[phaseIdx + 1];
    if (!next) return;

    // Trigger side-effects when entering a new phase
    if (next === 'prereq' && models === null) {
      void fetchModels();
    }

    setPhase(next);
  };

  const handleBack = () => {
    const prev = PHASE_ORDER[phaseIdx - 1];
    if (prev) setPhase(prev);
  };

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await apiRequest('/api/code/sessions', {
        method: 'POST',
        body: JSON.stringify({
          model: selectedModel || undefined,
          repoUrl: workspaceType === 'clone' && repoUrl ? repoUrl : undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Session creation failed: ${text}`);
      }
      const session = await res.json();
      onLaunched(session);
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLaunching(false);
    }
  };

  // Can user advance?
  const canAdvance =
    phase === 'prereq'
      ? !modelsLoading && (models === null || models.length > 0)
      : true;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: 520,
        background: 'var(--ap-bg-1, #141414)',
        border: '1px solid var(--ap-ln-2, #2a2a2a)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--ap-ln-2, #2a2a2a)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 20,
              fontFamily: 'var(--font-disp, ui-serif)',
              fontStyle: 'italic',
              color: 'var(--ap-fg-0, #f0f0f0)',
            }}
          >
            Code Mode
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ap-fg-3, #666)' }}>
            {stepLabel[phase]}
          </p>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ap-fg-3, #666)',
              cursor: 'pointer',
              fontSize: 18,
              padding: '2px 6px',
              borderRadius: 6,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 2,
          background: 'var(--ap-ln-2, #2a2a2a)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            background: 'var(--ap-accent, #6c63ff)',
            width: `${((phaseIdx + 1) / PHASE_ORDER.length) * 100}%`,
            transition: 'width 0.25s ease',
          }}
        />
      </div>

      {/* Step content */}
      <div style={{ padding: '22px 22px 18px', flex: 1 }}>
        {phase === 'welcome' && <WelcomeStep />}
        {phase === 'prereq' && (
          <PrereqStep loading={modelsLoading} models={models} error={modelsError} />
        )}
        {phase === 'model' && (
          <ModelStep
            models={models ?? []}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
          />
        )}
        {phase === 'workspace' && (
          <WorkspaceStep
            workspaceType={workspaceType}
            repoUrl={repoUrl}
            onTypeChange={setWorkspaceType}
            onRepoUrlChange={setRepoUrl}
          />
        )}
        {phase === 'launch' && (
          <LaunchStep launching={launching} error={launchError} onLaunch={handleLaunch} />
        )}
      </div>

      {/* Footer navigation — not shown on Launch step (which has its own CTA) */}
      {phase !== 'launch' && (
        <div
          style={{
            padding: '12px 22px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--ap-ln-2, #2a2a2a)',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            disabled={isFirst}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid var(--ap-ln-2, #333)',
              background: 'transparent',
              color: isFirst ? 'var(--ap-fg-3, #555)' : 'var(--ap-fg-1, #e0e0e0)',
              cursor: isFirst ? 'not-allowed' : 'pointer',
            }}
          >
            Back
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance || isLast}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              background:
                !canAdvance || isLast
                  ? 'var(--ap-bg-2, #2a2a2a)'
                  : 'var(--ap-accent, #6c63ff)',
              color:
                !canAdvance || isLast ? 'var(--ap-fg-3, #555)' : '#fff',
              cursor: !canAdvance || isLast ? 'not-allowed' : 'pointer',
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default CodeModeWizard;
