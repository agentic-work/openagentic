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
    background: 'linear-gradient(135deg, var(--cm-accent), var(--cm-accent))',
    color: 'var(--cm-bg)',
  },
  c: {
    background: 'color-mix(in srgb, var(--cm-warning) 20%, transparent)',
    color: 'var(--cm-warning)',
    border: '1px solid color-mix(in srgb, var(--cm-warning) 40%, transparent)',
  },
  g: {
    background: 'color-mix(in srgb, var(--cm-success) 20%, transparent)',
    color: 'var(--cm-success)',
    border: '1px solid color-mix(in srgb, var(--cm-success) 40%, transparent)',
  },
  s: {
    background: 'color-mix(in srgb, var(--cm-error) 20%, transparent)',
    color: 'var(--cm-error)',
    border: '1px solid color-mix(in srgb, var(--cm-error) 40%, transparent)',
  },
  k: {
    background: 'color-mix(in srgb, var(--cm-accent) 20%, transparent)',
    color: 'var(--cm-accent)',
    border: '1px solid color-mix(in srgb, var(--cm-accent) 40%, transparent)',
  },
  user: {
    background: 'var(--cm-bg-tertiary)',
    color: 'var(--cm-text)',
    border: '1px solid var(--cm-border)',
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
