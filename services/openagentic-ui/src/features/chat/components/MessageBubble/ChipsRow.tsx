/**
 * ChipsRow — end-of-message follow-up chip row (G1).
 *
 * Renders below the final assistant text + below any artifact bands.
 * Each chip is an imperative-verb call to action ("drill into prod-west-rg →",
 * "make slide ⎘"). Clicking a chip fills the composer with the chip's prompt
 * and auto-submits via onSubmit.
 *
 * Theme: resolves all colors via global `var(--cm-*)` tokens — no hardcoded
 * hex/rgb so the row respects light/dark mode + the user-selected accent.
 *
 * Mocks: end-state-{01,07,08,13}.html.
 */
import React from 'react';
import { useFollowupChipsStore } from '@/stores/useFollowupChipsStore';

export interface FollowupChip {
  label: string;
  prompt: string;
}

export interface ChipsRowProps {
  chips: FollowupChip[];
  onSubmit: (prompt: string) => void;
}

export function ChipsRow({ chips, onSubmit }: ChipsRowProps): JSX.Element | null {
  const chipsEnabled = useFollowupChipsStore((s) => s.enabled);
  if (!chipsEnabled) return null;
  if (!chips || chips.length === 0) return null;
  return (
    <div
      data-testid="followup-row"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
      }}
    >
      {chips.map((chip, i) => (
        <FollowupChipButton
          key={`${i}-${chip.label}`}
          chip={chip}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}

interface FollowupChipButtonProps {
  chip: FollowupChip;
  onSubmit: (prompt: string) => void;
}

function FollowupChipButton({ chip, onSubmit }: FollowupChipButtonProps): JSX.Element {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      data-testid="followup-chip"
      onClick={() => onSubmit(chip.prompt)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        appearance: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '0.875rem',
        lineHeight: 1.2,
        padding: '6px 12px',
        borderRadius: 'var(--cm-radius-md)',
        border: '1px solid var(--cm-line-2)',
        background: hovered ? 'var(--cm-accent-soft)' : 'var(--cm-bg-2)',
        color: hovered ? 'var(--cm-accent)' : 'var(--cm-fg-1)',
        textAlign: 'left',
        transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
      }}
    >
      {chip.label}
    </button>
  );
}

export default ChipsRow;
