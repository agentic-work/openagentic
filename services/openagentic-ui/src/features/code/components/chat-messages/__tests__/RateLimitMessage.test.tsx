import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RateLimitMessage, getUpsellMessage } from '../RateLimitMessage';

afterEach(() => {
  cleanup();
});

describe('RateLimitMessage', () => {
  it('renders the rate-limit text inside a banner', () => {
    const { container } = render(
      <RateLimitMessage text="You have hit your usage limit." />,
    );
    expect(container.querySelector('[data-part="rate_limit"]')).not.toBeNull();
    expect(screen.getByText('You have hit your usage limit.')).toBeInTheDocument();
  });

  it('shows /extra-usage upsell for Max20x with extra-usage enabled', () => {
    const { container } = render(
      <RateLimitMessage
        text="hit limit"
        isMax20x={true}
        isExtraUsageCommandEnabled={true}
        shouldShowUpsell={true}
      />,
    );
    expect(container.textContent).toMatch(/\/extra-usage/);
  });

  it('shows /login upsell for Max20x without extra-usage enabled', () => {
    const { container } = render(
      <RateLimitMessage
        text="hit limit"
        isMax20x={true}
        isExtraUsageCommandEnabled={false}
        shouldShowUpsell={true}
      />,
    );
    expect(container.textContent).toMatch(/\/login/);
  });

  it('shows /upgrade upsell for default subscribers', () => {
    const { container } = render(
      <RateLimitMessage
        text="hit limit"
        isMax20x={false}
        isExtraUsageCommandEnabled={false}
        shouldShowUpsell={true}
      />,
    );
    expect(container.textContent).toMatch(/\/upgrade/);
  });

  it('does not render upsell when shouldShowUpsell is false', () => {
    const { container } = render(
      <RateLimitMessage text="hit" shouldShowUpsell={false} />,
    );
    expect(container.querySelector('[data-part="rate_limit_upsell"]')).toBeNull();
  });

  it('exports a pure getUpsellMessage helper', () => {
    expect(
      getUpsellMessage({
        shouldShowUpsell: true,
        isMax20x: true,
        isExtraUsageCommandEnabled: true,
        shouldAutoOpenRateLimitOptionsMenu: false,
        isTeamOrEnterprise: false,
        hasBillingAccess: false,
      }),
    ).toMatch(/\/extra-usage/);

    expect(
      getUpsellMessage({
        shouldShowUpsell: true,
        isMax20x: false,
        isExtraUsageCommandEnabled: false,
        shouldAutoOpenRateLimitOptionsMenu: false,
        isTeamOrEnterprise: false,
        hasBillingAccess: false,
      }),
    ).toMatch(/\/upgrade/);

    expect(
      getUpsellMessage({
        shouldShowUpsell: false,
        isMax20x: true,
        isExtraUsageCommandEnabled: true,
        shouldAutoOpenRateLimitOptionsMenu: false,
        isTeamOrEnterprise: false,
        hasBillingAccess: false,
      }),
    ).toBeNull();

    expect(
      getUpsellMessage({
        shouldShowUpsell: true,
        isMax20x: false,
        isExtraUsageCommandEnabled: false,
        shouldAutoOpenRateLimitOptionsMenu: true,
        isTeamOrEnterprise: false,
        hasBillingAccess: false,
      }),
    ).toMatch(/Opening/);

    expect(
      getUpsellMessage({
        shouldShowUpsell: true,
        isMax20x: false,
        isExtraUsageCommandEnabled: true,
        shouldAutoOpenRateLimitOptionsMenu: false,
        isTeamOrEnterprise: true,
        hasBillingAccess: true,
      }),
    ).toMatch(/\/extra-usage/);

    expect(
      getUpsellMessage({
        shouldShowUpsell: true,
        isMax20x: false,
        isExtraUsageCommandEnabled: true,
        shouldAutoOpenRateLimitOptionsMenu: false,
        isTeamOrEnterprise: true,
        hasBillingAccess: false,
      }),
    ).toMatch(/admin/);
  });
});
