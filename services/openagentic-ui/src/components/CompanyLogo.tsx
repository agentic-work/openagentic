/**
 * CompanyLogo — renders the official [openagentic] brand mark
 * stored at /public/company-logo.svg. Sidebar header + About panel
 * both consume this. `icon` variant shows just the "A" glyph for
 * the collapsed sidebar rail.
 *
 * The previous "A in a violet square" placeholder was wrong — user
 * explicitly asked for the correct brand asset back.
 */

import React from 'react';

interface CompanyLogoProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  variant?: 'full' | 'compact' | 'icon';
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({
  className = '',
  width,
  height,
  variant = 'full',
}) => {
  const dims = (() => {
    if (variant === 'icon') return { w: width ?? 28, h: height ?? 28 };
    if (variant === 'compact') return { w: width ?? 160, h: height ?? 28 };
    return { w: width ?? 220, h: height ?? 38 };
  })();

  if (variant === 'icon') {
    return (
      <div
        className={className}
        aria-label="OpenAgentic"
        style={{
          width: dims.w,
          height: dims.h,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: 'conic-gradient(from 220deg, #8b5cf6, #6366f1, #8b5cf6)',
          color: 'white',
          fontWeight: 700,
          fontSize: Math.max(11, Math.floor(Number(dims.h) * 0.55)),
          boxShadow:
            '0 0 0 1px rgba(139,92,246,.3), 0 4px 12px rgba(139,92,246,.2)',
          flexShrink: 0,
        }}
      >
        A
      </div>
    );
  }

  return (
    <img
      src="/company-logo.svg"
      alt="OpenAgentic"
      className={className}
      width={dims.w}
      height={dims.h}
      style={{
        width: dims.w,
        height: dims.h,
        objectFit: 'contain',
        display: 'inline-block',
      }}
    />
  );
};

export default CompanyLogo;
