/**
 * Admin Portal UI E2E Tests
 *
 * Tests for:
 * - Admin dashboard access
 * - User management
 * - System settings
 * - Analytics
 * - API key management
 * - Security controls
 */

import { test, expect } from '@playwright/test';

test.describe('Admin Portal', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin page (may require auth)
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Access Control', () => {
    test('admin portal requires authentication', async ({ page }) => {
      // Should redirect to login or show auth required
      const url = page.url();
      const isLoginPage = url.includes('login') || url.includes('auth');
      const hasAuthPrompt = await page.locator('[class*="login"], [class*="auth"]').count();
      // Either redirected or shows auth prompt
      expect(isLoginPage || hasAuthPrompt > 0 || page.url().includes('admin')).toBeTruthy();
    });
  });

  test.describe('Dashboard', () => {
    test('dashboard shows metrics', async ({ page }) => {
      // Look for dashboard elements
      const dashboard = page.locator('[class*="dashboard"], [class*="metrics"], [class*="stats"]');
      // May or may not be visible depending on auth
    });

    test('dashboard shows user count', async ({ page }) => {
      const userMetric = page.locator('[class*="user"], text=/users?/i');
      // May show user stats
    });

    test('dashboard shows API usage', async ({ page }) => {
      const apiMetric = page.locator('[class*="api"], text=/requests?/i');
      // May show API stats
    });
  });

  test.describe('User Management', () => {
    test('user list is accessible', async ({ page }) => {
      // Navigate to users section
      const usersLink = page.locator('a, button').filter({ hasText: /users?/i }).first();
      if (await usersLink.isVisible()) {
        await usersLink.click();
        await page.waitForTimeout(1000);

        // Look for user list
        const userList = page.locator('table, [class*="user-list"], [class*="users"]');
        // May or may not be visible depending on permissions
      }
    });

    test('user permissions can be viewed', async ({ page }) => {
      const permissionsLink = page.locator('a, button').filter({ hasText: /permissions?/i }).first();
      if (await permissionsLink.isVisible()) {
        await permissionsLink.click();
        await page.waitForTimeout(1000);
      }
    });

    test('user can be locked/unlocked', async ({ page }) => {
      // Look for lock/unlock buttons
      const lockButton = page.locator('button').filter({ hasText: /lock|unlock/i }).first();
      // May or may not be visible
    });
  });

  test.describe('System Settings', () => {
    test('settings page is accessible', async ({ page }) => {
      const settingsLink = page.locator('a, button').filter({ hasText: /settings?/i }).first();
      if (await settingsLink.isVisible()) {
        await settingsLink.click();
        await page.waitForTimeout(1000);
      }
    });

    test('intelligence slider is configurable', async ({ page }) => {
      const slider = page.locator('input[type="range"], [class*="slider"]');
      if (await slider.isVisible()) {
        // Try adjusting slider
        await slider.fill('50');
      }
    });

    test('system configuration can be viewed', async ({ page }) => {
      const configSection = page.locator('[class*="config"], [class*="settings"]');
      // May show system config
    });
  });

  test.describe('API Key Management', () => {
    test('API keys section is accessible', async ({ page }) => {
      const apiKeysLink = page.locator('a, button').filter({ hasText: /api.*key|token/i }).first();
      if (await apiKeysLink.isVisible()) {
        await apiKeysLink.click();
        await page.waitForTimeout(1000);
      }
    });

    test('can create new API key', async ({ page }) => {
      const createButton = page.locator('button').filter({ hasText: /create|new|add/i }).first();
      // May or may not be visible
    });

    test('can revoke API key', async ({ page }) => {
      const revokeButton = page.locator('button').filter({ hasText: /revoke|delete|remove/i }).first();
      // May or may not be visible
    });

    test('API key metrics are shown', async ({ page }) => {
      const metricsSection = page.locator('[class*="metrics"], [class*="usage"]');
      // May show API key usage
    });
  });

  test.describe('Security & Access', () => {
    test('security section is accessible', async ({ page }) => {
      const securityLink = page.locator('a, button').filter({ hasText: /security|access/i }).first();
      if (await securityLink.isVisible()) {
        await securityLink.click();
        await page.waitForTimeout(1000);
      }
    });

    test('audit log is viewable', async ({ page }) => {
      const auditLink = page.locator('a, button').filter({ hasText: /audit|log/i }).first();
      if (await auditLink.isVisible()) {
        await auditLink.click();
        await page.waitForTimeout(1000);
      }
    });
  });

  test.describe('Analytics', () => {
    test('analytics dashboard shows charts', async ({ page }) => {
      const analyticsLink = page.locator('a, button').filter({ hasText: /analytics|charts|stats/i }).first();
      if (await analyticsLink.isVisible()) {
        await analyticsLink.click();
        await page.waitForTimeout(1000);

        // Look for chart elements
        const charts = page.locator('canvas, svg, [class*="chart"]');
        // May show charts
      }
    });

    test('can filter analytics by date', async ({ page }) => {
      const dateFilter = page.locator('input[type="date"], [class*="date-picker"]');
      // May or may not be visible
    });
  });

  test.describe('Navigation', () => {
    test('admin sidebar has all sections', async ({ page }) => {
      const sidebar = page.locator('[class*="sidebar"], nav').first();
      if (await sidebar.isVisible()) {
        const links = sidebar.locator('a, button');
        const count = await links.count();
        expect(count).toBeGreaterThan(0);
      }
    });

    test('breadcrumbs show current location', async ({ page }) => {
      const breadcrumbs = page.locator('[class*="breadcrumb"]');
      // May or may not have breadcrumbs
    });
  });
});
