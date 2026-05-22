import React from 'react';

/**
 * AvatarCrumb — tinted letter-in-circle shown next to assistant /
 * sub-agent turns. Mock 01 reference: lines 1085 plus the `.avatar.av-c`
 * / `.av-asst` / `.av-g` / `.av-s` / `.av-k` styles in the mock CSS.
 *
 * v2 chatmode primitive (#502). Inline styles to dodge stylesheet
 * collisions during the parallel rebuild.
 */

export type AvatarVariant = 'asst' | 'c' | 'g' | 's' | 'k' | 'user';
export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarCrumbProps {
  /** Variant drives the tint. */
  variant: AvatarVariant;
  /**
   * The letter shown inside (defaults to first letter of variant
   * uppercased: C/G/S/K, or A for asst, U for user).
   */
  letter?: string;
  /** Size in px. Default 'md' (24px). 18 = sm, 24 = md, 32 = lg. */
  size?: AvatarSize;
  /** ARIA label override. */
  ariaLabel?: string;
  className?: string;
}

const DEFAULT_LETTER: Record<AvatarVariant, string> = {
  asst: 'A',
  c: 'C',
  g: 'G',
  s: 'S',
  k: 'K',
  user: 'U',
};

const SIZE_PX: Record<AvatarSize, number> = {
  sm: 18,
  md: 24,
  lg: 32,
};

const SIZE_FONT: Record<AvatarSize, number> = {
  sm: 10,
  md: 12,
  lg: 14,
};

const VARIANT_STYLE: Record<AvatarVariant, React.CSSProperties> = {
  asst: {
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    color: '#fff',
  },
  c: {
    background: 'rgba(245,158,11,0.20)',
    color: '#f59e0b',
    border: '1px solid rgba(245,158,11,0.40)',
  },
  g: {
    background: 'rgba(16,185,129,0.20)',
    color: '#10b981',
    border: '1px solid rgba(16,185,129,0.40)',
  },
  s: {
    background: 'rgba(239,68,68,0.20)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.40)',
  },
  k: {
    background: 'rgba(59,130,246,0.20)',
    color: '#3b82f6',
    border: '1px solid rgba(59,130,246,0.40)',
  },
  user: {
    background: 'var(--bg-3, #1c1f24)',
    color: 'var(--fg-1, #d4d4d8)',
    border: '1px solid var(--line-2, rgba(255,255,255,0.10))',
  },
};

export function AvatarCrumb({
  variant,
  letter,
  size = 'md',
  ariaLabel,
  className,
}: AvatarCrumbProps): JSX.Element {
  const px = SIZE_PX[size];
  const fontPx = SIZE_FONT[size];
  const finalLetter = letter ?? DEFAULT_LETTER[variant];
  const finalAriaLabel = ariaLabel ?? `Avatar: ${variant}`;
  const cls = [
    'cm-avatar',
    `cm-avatar-${variant}`,
    `cm-avatar-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${px}px`,
    height: `${px}px`,
    borderRadius: '50%',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: `${fontPx}px`,
    fontWeight: 600,
    lineHeight: 1,
    flexShrink: 0,
    ...VARIANT_STYLE[variant],
  };

  return (
    <span
      className={cls}
      role="img"
      aria-label={finalAriaLabel}
      style={style}
    >
      {finalLetter}
    </span>
  );
}
