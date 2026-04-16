/**
 * AdminUI - Unified UI Components for Admin Portal
 *
 * Design principles (Vercel/Stripe/Linear inspired):
 * - Clean, minimal styling
 * - Consistent typography and spacing
 * - Subtle borders and shadows
 * - Professional color palette
 */
import React from 'react';

// ============================================================================
// STATUS BADGES
// ============================================================================

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default' | 'primary';

interface StatusBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

const badgeColors: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  success: {
    bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
    text: 'var(--color-success)',
    dot: 'var(--color-success)',
  },
  warning: {
    bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
    text: 'var(--color-warning)',
    dot: 'var(--color-warning)',
  },
  error: {
    bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)',
    text: 'var(--color-error)',
    dot: 'var(--color-error)',
  },
  info: {
    bg: 'color-mix(in srgb, var(--accent-info, var(--color-primary)) 12%, transparent)',
    text: 'var(--accent-info, var(--color-primary))',
    dot: 'var(--accent-info, var(--color-primary))',
  },
  primary: {
    bg: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
    text: 'var(--color-primary)',
    dot: 'var(--color-primary)',
  },
  default: {
    bg: 'var(--color-surfaceSecondary)',
    text: 'var(--color-textMuted)',
    dot: 'var(--color-textMuted)',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  variant = 'default',
  children,
  dot = false,
  className = '',
}) => {
  const colors = badgeColors[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      style={{
        padding: dot ? '4px 10px 4px 8px' : '4px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 500,
        backgroundColor: colors.bg,
        color: colors.text,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: colors.dot,
          }}
        />
      )}
      {children}
    </span>
  );
};

// ============================================================================
// CARDS
// ============================================================================

interface AdminCardProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
}

const paddingMap = {
  none: '0',
  sm: '16px',
  md: '20px',
  lg: '24px',
};

export const AdminCard: React.FC<AdminCardProps> = ({
  children,
  title,
  description,
  actions,
  padding = 'md',
  className = '',
  hoverable = false,
  onClick,
}) => {
  return (
    <div
      className={`admin-card ${className}`}
      onClick={onClick}
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: '12px',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: hoverable ? 'border-color 0.15s, box-shadow 0.15s' : undefined,
      }}
      onMouseEnter={(e) => {
        if (hoverable) {
          e.currentTarget.style.borderColor = 'var(--color-borderHover)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
        }
      }}
      onMouseLeave={(e) => {
        if (hoverable) {
          e.currentTarget.style.borderColor = 'var(--color-border)';
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
    >
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div>
            {title && (
              <h3
                style={{
                  color: 'var(--color-text)',
                  fontSize: '15px',
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
              >
                {title}
              </h3>
            )}
            {description && (
              <p
                style={{
                  color: 'var(--color-textMuted)',
                  fontSize: '13px',
                  margin: '4px 0 0 0',
                }}
              >
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div style={{ padding: paddingMap[padding] }}>{children}</div>
    </div>
  );
};

// ============================================================================
// STAT CARDS
// ============================================================================

interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon?: React.ReactNode;
  className?: string;
  highlight?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  change,
  changeType = 'neutral',
  icon,
  className = '',
}) => {
  const changeColors = {
    positive: 'var(--color-success)',
    negative: 'var(--color-error)',
    neutral: 'var(--color-textMuted)',
  };

  return (
    <div
      className={`stat-card ${className}`}
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: '12px',
        border: '1px solid var(--color-border)',
        padding: '20px',
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p
            style={{
              color: 'var(--color-textMuted)',
              fontSize: '13px',
              fontWeight: 500,
              margin: '0 0 8px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            {label}
          </p>
          <p
            style={{
              color: 'var(--color-text)',
              fontSize: '28px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {change && (
            <p
              style={{
                color: changeColors[changeType],
                fontSize: '13px',
                fontWeight: 500,
                margin: '8px 0 0 0',
              }}
            >
              {changeType === 'positive' && '↑ '}
              {changeType === 'negative' && '↓ '}
              {change}
            </p>
          )}
        </div>
        {icon && (
          <div
            style={{
              padding: '10px',
              borderRadius: '10px',
              backgroundColor: 'var(--color-surfaceSecondary)',
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// BUTTONS
// ============================================================================

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface AdminButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
}

const buttonSizes: Record<ButtonSize, { padding: string; fontSize: string; height: string }> = {
  sm: { padding: '0 12px', fontSize: '12px', height: '32px' },
  md: { padding: '0 16px', fontSize: '13px', height: '36px' },
  lg: { padding: '0 20px', fontSize: '14px', height: '40px' },
};

const buttonVariants: Record<ButtonVariant, { bg: string; text: string; border: string; hoverBg: string }> = {
  primary: {
    bg: 'var(--color-primary)',
    text: 'white',
    border: 'transparent',
    hoverBg: 'color-mix(in srgb, var(--color-primary) 85%, black)',
  },
  secondary: {
    bg: 'transparent',
    text: 'var(--color-text)',
    border: 'var(--color-border)',
    hoverBg: 'var(--color-surfaceHover)',
  },
  ghost: {
    bg: 'transparent',
    text: 'var(--color-textSecondary)',
    border: 'transparent',
    hoverBg: 'var(--color-surfaceHover)',
  },
  danger: {
    bg: 'var(--color-error)',
    text: 'white',
    border: 'transparent',
    hoverBg: 'color-mix(in srgb, var(--color-error) 85%, black)',
  },
};

export const AdminButton: React.FC<AdminButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  children,
  disabled,
  className = '',
  ...props
}) => {
  const sizeStyles = buttonSizes[size];
  const variantStyles = buttonVariants[variant];

  return (
    <button
      className={`admin-button ${className}`}
      disabled={disabled || loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: sizeStyles.padding,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        fontWeight: 500,
        borderRadius: '8px',
        border: `1px solid ${variantStyles.border}`,
        backgroundColor: variantStyles.bg,
        color: variantStyles.text,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.15s, border-color 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.backgroundColor = variantStyles.hoverBg;
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.backgroundColor = variantStyles.bg;
        }
      }}
      {...props}
    >
      {loading ? (
        <span
          className="animate-spin"
          style={{
            width: '14px',
            height: '14px',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
          }}
        />
      ) : icon ? (
        icon
      ) : null}
      {children}
      {iconRight && !loading && iconRight}
    </button>
  );
};

// ============================================================================
// SECTION HEADER
// ============================================================================

interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  description,
  actions,
  className = '',
}) => {
  return (
    <div
      className={`section-header ${className}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '16px',
        marginBottom: '24px',
      }}
    >
      <div>
        <h2
          style={{
            color: 'var(--color-text)',
            fontSize: '20px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          {title}
        </h2>
        {description && (
          <p
            style={{
              color: 'var(--color-textMuted)',
              fontSize: '14px',
              margin: '6px 0 0 0',
              maxWidth: '600px',
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
};

// ============================================================================
// EMPTY STATE
// ============================================================================

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div
      className={`empty-state ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      {icon && (
        <div
          style={{
            marginBottom: '16px',
            padding: '16px',
            borderRadius: '12px',
            backgroundColor: 'var(--color-surfaceSecondary)',
          }}
        >
          {icon}
        </div>
      )}
      <h3
        style={{
          color: 'var(--color-text)',
          fontSize: '16px',
          fontWeight: 600,
          margin: '0 0 8px 0',
        }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            color: 'var(--color-textMuted)',
            fontSize: '14px',
            margin: '0 0 20px 0',
            maxWidth: '360px',
          }}
        >
          {description}
        </p>
      )}
      {action}
    </div>
  );
};

// ============================================================================
// DIVIDER
// ============================================================================

interface DividerProps {
  className?: string;
}

export const Divider: React.FC<DividerProps> = ({ className = '' }) => {
  return (
    <hr
      className={className}
      style={{
        border: 'none',
        borderTop: '1px solid var(--color-border)',
        margin: '24px 0',
      }}
    />
  );
};

// ============================================================================
// LABEL
// ============================================================================

interface LabelProps {
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}

export const Label: React.FC<LabelProps> = ({ children, htmlFor, required, className = '' }) => {
  return (
    <label
      htmlFor={htmlFor}
      className={className}
      style={{
        display: 'block',
        color: 'var(--color-text)',
        fontSize: '13px',
        fontWeight: 500,
        marginBottom: '6px',
      }}
    >
      {children}
      {required && <span style={{ color: 'var(--color-error)', marginLeft: '4px' }}>*</span>}
    </label>
  );
};

// ============================================================================
// INPUT
// ============================================================================

interface AdminInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  icon?: React.ReactNode;
}

export const AdminInput: React.FC<AdminInputProps> = ({
  error,
  icon,
  className = '',
  style,
  ...props
}) => {
  return (
    <div className="relative">
      {icon && (
        <div
          style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-textMuted)',
          }}
        >
          {icon}
        </div>
      )}
      <input
        className={`admin-input ${className}`}
        style={{
          width: '100%',
          padding: icon ? '10px 12px 10px 40px' : '10px 12px',
          borderRadius: '8px',
          border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
          fontSize: '14px',
          outline: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          ...style,
        }}
        {...props}
      />
      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: '12px', marginTop: '4px' }}>{error}</p>
      )}
    </div>
  );
};

// Export all components
export default {
  StatusBadge,
  AdminCard,
  StatCard,
  AdminButton,
  SectionHeader,
  EmptyState,
  Divider,
  Label,
  AdminInput,
};
