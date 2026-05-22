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
          fontSize: 48,
          marginBottom: 12,
        }}
      >🔒</div>
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
