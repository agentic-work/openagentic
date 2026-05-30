import React from 'react';

interface ProviderQualifierProps {
  providerType: string;
  providerDisplayName: string | null | undefined;
  modelId: string;
  /** Layout: 'inline' (single line) or 'stacked' (title + sub-line). Default 'inline'. */
  variant?: 'inline' | 'stacked';
  className?: string;
}

/**
 * Canonical Registry/picker label: ${type} · ${displayName} · ${modelId}.
 *
 * Drop-in primitive used everywhere a model id appears alongside a provider
 * — Registry list, Default Models picker, Smart Router pill, Add-Model
 * preview. Closes the "two nomic-embed-text rows look identical"
 * disambiguation gap (cross-provider Registry SoT v1).
 */
export const ProviderQualifier: React.FC<ProviderQualifierProps> = ({
  providerType,
  providerDisplayName,
  modelId,
  variant = 'inline',
  className = '',
}) => {
  const disc = (providerDisplayName && providerDisplayName.trim()) || '';

  if (variant === 'stacked') {
    return (
      <span
        data-testid="provider-qualifier"
        className={className}
        style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.2 }}
      >
        <strong>{modelId}</strong>
        <span style={{ fontSize: '0.78em', opacity: 0.75 }}>
          {providerType}
          {disc ? ` · ${disc}` : ''}
        </span>
      </span>
    );
  }

  const pieces = [providerType, disc, modelId].filter(Boolean);
  return (
    <span
      data-testid="provider-qualifier"
      className={className}
      style={{ display: 'inline', whiteSpace: 'nowrap' }}
    >
      {pieces.join(' · ')}
    </span>
  );
};
