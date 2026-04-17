import React from 'react';

export const UPGRADE_URL = 'https://agenticwork.io';

interface UpsellCardProps {
  feature: string;
  description?: string;
  compact?: boolean;
}

export const UpsellCard: React.FC<UpsellCardProps> = ({ feature, description, compact }) => {
  const message = `${feature} is part of the Enterprise edition.`;
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
        <span>{message}</span>
        <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#b784f5', fontWeight: 600 }}>
          Upgrade →
        </a>
      </div>
    );
  }
  return (
    <div
      style={{
        padding: 20,
        border: '1px solid #b784f5',
        borderRadius: 8,
        background: 'rgba(183, 132, 245, 0.06)',
        maxWidth: 560,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#b784f5', marginBottom: 6, letterSpacing: 0.6 }}>
        ENTERPRISE EDITION
      </div>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>{feature}</h3>
      {description && <p style={{ marginTop: 0, marginBottom: 16, color: '#6b7280', lineHeight: 1.5 }}>{description}</p>}
      <a
        href={UPGRADE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          padding: '8px 16px',
          background: '#b784f5',
          color: 'white',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        Learn more →
      </a>
    </div>
  );
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
    ⚠ OSS integrity check failed — this build appears to have been tampered with. See {UPGRADE_URL}.
  </div>
);
