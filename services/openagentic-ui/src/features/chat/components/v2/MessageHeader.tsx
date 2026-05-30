import React from 'react';

/**
 * Mock anatomy: `.msg-asst .msg-head`
 *   - 28×28 avatar (purple gradient for assistant; agent-c/g/s/k variants)
 *   - 13px bold name
 *   - 10px monospace model pill with `<span class="tag">family</span>` prefix
 *   - 11px tabular-nums timestamp
 *   - NO per-message cost pill (per user direction; topbar pill keeps it)
 *
 * Reference: mocks/UX/01-cloud-ops.html lines 184-214 (.msg-asst, .avatar, .msg-head).
 */

export type AgentVariant = 'asst' | 'c' | 'g' | 's' | 'k';

export interface MessageHeaderProps {
  /** Display name (e.g. "Assistant", "Cost Analysis Agent"). */
  name: string;
  /** Agent variant — drives the avatar gradient + the avatar letter. */
  variant?: AgentVariant;
  /** Single character to show inside the avatar — defaults to first char of `name`. */
  avatarLetter?: string;
  /**
   * Model identifier the model picked or was routed to. Split into `tag`
   * (family — e.g. "gpt", "claude", "gemini") + `id` (the rest). The mock
   * shows `<span class="tag">gpt</span>5.2`.
   */
  modelTag?: string;
  modelId?: string;
  /** Pre-formatted timestamp (e.g. "5:11 PM"). */
  timestamp?: string;
  /**
   * Phase 3 cm-msg-asst grid: when the parent `<div className="cm-msg-asst">`
   * already renders the 28px avatar in col-1, MessageHeader renders only
   * the cm-msg-head row (name + model + time) in col-2 row-1 to avoid
   * doubling up the avatar. Default false keeps legacy callers (sub-agents,
   * non-grid contexts) on the inline-avatar layout.
   */
  noAvatar?: boolean;
}

function defaultAvatarLetter(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'A';
  return trimmed[0].toUpperCase();
}

/**
 * Modern Claude.ai look — no "A" letter inside the avatar (per user
 * direction: "remove the 'A' assistant — that's 1970s style I want
 * modern clean claude.ai style"). The avatar gradient block stays for
 * sub-agent variants where it's a contextual signal (different colors
 * per agent type), but the assistant variant renders an empty block to
 * keep the 8px-baseline grid aligned without the letter clutter.
 *
 * For assistant messages we also drop the "Assistant" display name —
 * Claude.ai/ChatGPT don't put a name on every turn. Sub-agent variants
 * keep the name since that's the load-bearing signal for "which agent
 * just spoke".
 */
export function MessageHeader({
  name,
  variant = 'asst',
  avatarLetter,
  modelTag,
  modelId,
  timestamp,
  noAvatar = false,
}: MessageHeaderProps) {
  // Sub-agent variants (c/g/s/k) show a contextual letter inside their
  // colored gradient — useful when multiple agents speak in one turn.
  // The plain assistant variant is anonymous (no letter, no name).
  const isAssistant = variant === 'asst';
  const letter = isAssistant ? '' : (avatarLetter ?? defaultAvatarLetter(name));

  return (
    <div className="cm-msg-head">
      {!noAvatar && (
        <div className={`cm-avatar cm-av-${variant}`} aria-hidden>
          {letter}
        </div>
      )}
      {!isAssistant && <span className="cm-name">{name}</span>}
      {(modelTag || modelId) && (
        <span className="cm-model">
          {modelTag && <span className="cm-tag">{modelTag}</span>}
          {modelId}
        </span>
      )}
      <span className="cm-spacer" />
      {timestamp && (
        <span className="cm-time" data-testid="msg-timestamp">
          {timestamp}
        </span>
      )}
    </div>
  );
}
