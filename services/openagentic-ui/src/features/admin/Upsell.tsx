import React from 'react';

export const UPGRADE_URL = 'https://agenticwork.io/purchase';
export const MARKETING_URL = 'https://agenticwork.io';

/**
 * The OSS edition deliberately shows every enterprise admin entry point
 * in the sidebar so operators understand what's available in the hosted
 * edition. When the user clicks one of those entries, the route content
 * renders <LockScreen> instead of the real route — visible, clickable,
 * locked, with a single CTA to https://agenticwork.io/purchase.
 *
 * Code Mode follows the same pattern: the entry exists in the chat
 * sidebar so users can see it, but clicking shows the lock screen.
 *
 * `feature` and `description` are surfaced verbatim to the user; pick
 * a short, plain-English string ("Audit Logs", "Code Mode") rather
 * than a code identifier.
 */
interface LockScreenProps {
  feature: string;
  description?: string;
  /** Optional list of capability bullets to render under the description. */
  capabilities?: string[];
}

export const LockScreen: React.FC<LockScreenProps> = ({ feature, description, capabilities }) => (
  <div
    role="region"
    aria-label={`${feature} — enterprise feature locked`}
    style={{
      minHeight: 480,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
    }}
  >
    <div
      style={{
        maxWidth: 560,
        width: '100%',
        padding: 32,
        borderRadius: 12,
        background: 'rgba(183, 132, 245, 0.06)',
        border: '1px solid #b784f5',
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 72,
          height: 72,
          margin: '0 auto 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="awBrandGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7C3AED" />
              <stop offset="55%" stopColor="#3B82F6" />
              <stop offset="80%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#FBBF24" />
            </linearGradient>
            <linearGradient id="awBracketGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#D1D5DB" />
              <stop offset="100%" stopColor="#9CA3AF" />
            </linearGradient>
            <filter id="awGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Rounded backdrop with subtle gradient wash */}
          <rect x="2" y="2" width="68" height="68" rx="16" fill="url(#awBrandGradient)" opacity="0.10" />
          <rect x="2" y="2" width="68" height="68" rx="16" fill="none" stroke="url(#awBrandGradient)" strokeWidth="1.2" opacity="0.55" />
          {/* Brackets — the agenticwork wordmark signature */}
          <path d="M16 20 L11 20 L11 52 L16 52" stroke="url(#awBracketGradient)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M56 20 L61 20 L61 52 L56 52" stroke="url(#awBracketGradient)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {/* "A" monogram, gradient-filled, sitting between the brackets */}
          <path d="M36 22 L24 50 L29 50 L31.6 43.4 L40.4 43.4 L43 50 L48 50 Z M33.4 38.6 L36 32.2 L38.6 38.6 Z" fill="url(#awBrandGradient)" filter="url(#awGlow)" />
          {/* Small lock badge — bottom-right — to mark the locked state */}
          <g transform="translate(48 48)">
            <circle cx="8" cy="8" r="9" fill="#1f1f24" stroke="url(#awBrandGradient)" strokeWidth="1.4" />
            <rect x="5" y="8" width="6" height="5" rx="1" fill="#c4b5fd" />
            <path d="M6.2 8 V6.4 a1.8 1.8 0 0 1 3.6 0 V8" stroke="#c4b5fd" strokeWidth="1" fill="none" strokeLinecap="round" />
          </g>
        </svg>
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#b784f5',
          marginBottom: 8,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        Enterprise edition
      </div>
      <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 24 }}>{feature}</h2>
      {description && (
        <p style={{ marginTop: 0, marginBottom: 16, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.6 }}>
          {description}
        </p>
      )}
      {capabilities && capabilities.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 auto 24px',
            maxWidth: 380,
            textAlign: 'left',
            color: 'var(--color-text-secondary, #6b7280)',
            lineHeight: 1.8,
          }}
        >
          {capabilities.map((c) => (
            <li key={c} style={{ paddingLeft: 20, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 0, color: '#b784f5' }}>✓</span> {c}
            </li>
          ))}
        </ul>
      )}
      <a
        href={UPGRADE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          padding: '12px 24px',
          background: '#b784f5',
          color: 'white',
          borderRadius: 8,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 15,
        }}
      >
        Unlock with the hosted edition →
      </a>
      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
        Or learn more at{' '}
        <a
          href={MARKETING_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#b784f5', textDecoration: 'underline' }}
        >
          agenticwork.io
        </a>
      </div>
    </div>
  </div>
);

/**
 * Compact inline upsell — used in admin pages that have some free
 * content plus a locked sub-section (e.g. "free model browser, but
 * the cost-per-token sort needs the hosted edition").
 */
interface UpsellCardProps {
  feature: string;
  description?: string;
  compact?: boolean;
}

export const UpsellCard: React.FC<UpsellCardProps> = ({ feature, description, compact }) => {
  if (compact) {
    return (
      <div
        style={{
          padding: '8px 12px',
          border: '1px solid #b784f5',
          borderRadius: 6,
          background: 'rgba(183, 132, 245, 0.08)',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span>🔒 {feature} is part of the hosted edition.</span>
        <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#b784f5', fontWeight: 600 }}>
          Unlock →
        </a>
      </div>
    );
  }
  return <LockScreen feature={feature} description={description} />;
};

export const TamperedBanner: React.FC = () => (
  <div
    style={{
      padding: '10px 16px',
      background: '#fee2e2',
      color: '#991b1b',
      borderBottom: '1px solid #fecaca',
      fontSize: 13,
      textAlign: 'center',
    }}
  >
    ⚠ OSS integrity check failed — this build appears to have been tampered with. See {MARKETING_URL}.
  </div>
);
