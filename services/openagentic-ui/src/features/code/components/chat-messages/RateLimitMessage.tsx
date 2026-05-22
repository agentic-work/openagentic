import React from 'react';

const ERROR_COLOR = 'var(--cm-error, #f85149)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const WARNING = 'var(--cm-warning, #d29922)';

const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export type UpsellParams = {
  shouldShowUpsell: boolean;
  isMax20x: boolean;
  isExtraUsageCommandEnabled: boolean;
  shouldAutoOpenRateLimitOptionsMenu: boolean;
  isTeamOrEnterprise: boolean;
  hasBillingAccess: boolean;
};

/**
 * Decide which upsell copy to surface for the current rate-limit posture.
 * Returns null when no upsell should be shown.
 *
 * Mirrors openagentic/src/components/messages/RateLimitMessage.tsx::getUpsellMessage
 * byte-for-byte.
 */
export function getUpsellMessage({
  shouldShowUpsell,
  isMax20x,
  isExtraUsageCommandEnabled,
  shouldAutoOpenRateLimitOptionsMenu,
  isTeamOrEnterprise,
  hasBillingAccess,
}: UpsellParams): string | null {
  if (!shouldShowUpsell) return null;

  if (isMax20x) {
    if (isExtraUsageCommandEnabled) {
      return '/extra-usage to finish what you’re working on.';
    }
    return '/login to switch to an API usage-billed account.';
  }

  if (shouldAutoOpenRateLimitOptionsMenu) {
    return 'Opening your options…';
  }

  if (!isTeamOrEnterprise && !isExtraUsageCommandEnabled) {
    return '/upgrade to increase your usage limit.';
  }

  if (isTeamOrEnterprise) {
    if (!isExtraUsageCommandEnabled) return null;

    if (hasBillingAccess) {
      return '/extra-usage to finish what you’re working on.';
    }

    return '/extra-usage to request more usage from your admin.';
  }

  return '/upgrade or /extra-usage to finish what you’re working on.';
}

export interface RateLimitMessageProps {
  text: string;
  isMax20x?: boolean;
  isExtraUsageCommandEnabled?: boolean;
  shouldShowUpsell?: boolean;
  shouldAutoOpenRateLimitOptionsMenu?: boolean;
  isTeamOrEnterprise?: boolean;
  hasBillingAccess?: boolean;
}

export const RateLimitMessage: React.FC<RateLimitMessageProps> = ({
  text,
  isMax20x = false,
  isExtraUsageCommandEnabled = false,
  shouldShowUpsell = true,
  shouldAutoOpenRateLimitOptionsMenu = false,
  isTeamOrEnterprise = false,
  hasBillingAccess = false,
}) => {
  const upsell = getUpsellMessage({
    shouldShowUpsell,
    isMax20x,
    isExtraUsageCommandEnabled,
    shouldAutoOpenRateLimitOptionsMenu,
    isTeamOrEnterprise,
    hasBillingAccess,
  });

  return (
    <div
      data-part="rate_limit"
      className="cm-part cm-rate-limit"
      style={{
        margin: '6px 0',
        padding: '8px 10px',
        border: `1px solid ${WARNING}`,
        borderRadius: 4,
        background: 'rgba(210, 153, 34, 0.06)',
        fontFamily: MONO_FONT,
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ color: ERROR_COLOR }}>{text}</div>
      {upsell && (
        <div data-part="rate_limit_upsell" style={{ color: DIM, fontSize: 12 }}>
          {upsell}
        </div>
      )}
    </div>
  );
};

export default RateLimitMessage;
