import React from 'react'

/**
 * SoTBanner — a one-line reminder that the Model Registry is the only
 * source of truth for routable models across chat/flows/agents/code-mode.
 *
 * Drop on any page that touches model selection: Provider Management,
 * Default Models, Models, Code Mode session defaults, Agent Registry,
 * Workflow node configuration. Identical wording everywhere — that's the
 * point. Variation creates confusion about what "the rule" actually is.
 *
 * Theme-aware: --bg-1 background, --line-2 border, --ok left bar.
 */
export function SoTBanner({
  context,
  onReadRule,
}: {
  /** Optional suffix sentence ("…for code-mode specifically.") */
  context?: string
  /** Hook for "Read the rule →" link — typically navigates to docs. */
  onReadRule?: () => void
}) {
  return (
    <div
      role="note"
      className="font-mono text-fg-2 mb-4 flex items-center gap-3 rounded border border-ln-2 bg-bg-1 px-4 py-3 text-[11px]"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: 'var(--ap-success, var(--ok))',
        background:
          'linear-gradient(90deg, color-mix(in srgb, var(--ap-success, var(--ok)) 8%, var(--ap-bg-1, var(--bg-1))), var(--ap-bg-1, var(--bg-1)) 60%)',
      }}
    >
      <span
        className="font-semibold tracking-[0.1em]"
        style={{ color: 'var(--ap-success, var(--ok))' }}
      >
        REGISTRY · SoT
      </span>
      <span className="text-fg-2">
        This registry is the <b className="text-fg-0">only</b> place models become routable across{' '}
        <b className="text-fg-0">chat</b>, <b className="text-fg-0">flows</b>,{' '}
        <b className="text-fg-0">agents</b>, and <b className="text-fg-0">code-mode</b>. If a model
        isn't here with <span className="text-fg-0">enabled=true</span> AND its provider is enabled,
        it cannot serve any request anywhere on the platform.
        {context ? ` ${context}` : ''}
      </span>
      {onReadRule && (
        <button
          type="button"
          onClick={onReadRule}
          className="ml-auto whitespace-nowrap text-[11px] font-mono hover:underline"
          style={{ color: 'var(--ap-accent, var(--accent))' }}
        >
          Read the rule →
        </button>
      )}
    </div>
  )
}
