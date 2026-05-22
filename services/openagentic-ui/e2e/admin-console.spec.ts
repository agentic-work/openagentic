/**
 * Admin Console Test
 * Tests Admin portal navigation, OAT Tool Synthesis pages, and Feedback Analytics
 * Also validates theming - checks for hardcoded colors
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
// Azure AD test user - must be admin in the platform
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

test.use({ ignoreHTTPSErrors: true });

async function login(page: any) {
  console.log('=== LOGIN FLOW (Azure AD) ===');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    console.log('Already logged in!');
    return;
  }

  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    const msEmailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await msEmailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msEmailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }

    const msPasswordInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await msPasswordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msPasswordInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }

    const staySignedIn = page.locator('button:has-text("No"), input[value="No"]');
    if (await staySignedIn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await staySignedIn.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }

  await page.waitForSelector('textarea', { timeout: 60000 });
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch {}

  const skipButton = page.locator('button:has-text("Skip"), button:has-text("Close"), button:has-text("Get Started")').first();
  if (await skipButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipButton.click();
    await page.waitForTimeout(500);
  }

  console.log('Login complete!');

  // Dismiss welcome modal if present
  await page.waitForTimeout(1000);
  const welcomeBackdrop = page.locator('.fixed.inset-0.bg-black\\/70');
  if (await welcomeBackdrop.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Dismissing welcome modal...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    if (await welcomeBackdrop.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.mouse.click(10, 10);
      await page.waitForTimeout(1000);
    }
  }
}

test.describe('Admin Console', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });
    page.on('response', async response => {
      if (response.status() >= 400) {
        console.log(`[HTTP ${response.status()}] ${response.url()}`);
      }
    });
  });

  test('Open Admin Portal and navigate to key pages', async ({ page }) => {
    test.setTimeout(180000);

    await login(page);
    await page.waitForTimeout(2000);

    console.log('\n=== OPENING ADMIN PORTAL ===');

    // Step 1: Click Settings button in the sidebar to open dropdown
    // The button shows "Settings & more" when expanded, but just an icon when collapsed
    console.log('Looking for Settings button...');

    // Try expanded sidebar first (has text), then collapsed (just icon)
    let settingsButton = page.locator('text=Settings & more').first();
    let foundSettingsButton = await settingsButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (!foundSettingsButton) {
      // Try finding the Settings button by its icon or title attribute
      settingsButton = page.locator('button[title="Settings"], button:has(svg), [aria-label*="Settings"]').last();
      foundSettingsButton = await settingsButton.isVisible({ timeout: 3000 }).catch(() => false);
    }

    if (!foundSettingsButton) {
      // Look for any button in the bottom section of sidebar with Settings-like appearance
      settingsButton = page.locator('.border-t button').first();
      foundSettingsButton = await settingsButton.isVisible({ timeout: 3000 }).catch(() => false);
    }

    if (foundSettingsButton) {
      console.log('Clicking Settings & more...');
      await settingsButton.click();
      await page.waitForTimeout(1000);

      // Step 2: Click "Admin Panel" in the dropdown menu
      console.log('Looking for Admin Panel button...');
      // The dropdown is a portal, look for it with specific text
      const adminPanelButton = page.locator('button:has-text("Admin Panel"), span:has-text("Admin Panel")').first();
      const foundAdminPanel = await adminPanelButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Found Admin Panel: ${foundAdminPanel}`);

      if (foundAdminPanel) {
        console.log('Clicking Admin Panel...');
        await adminPanelButton.click();
        await page.waitForTimeout(2000);
      } else {
        console.log('Admin Panel button not found - user may not be admin');
      }
    } else {
      console.log('Settings button not found');
    }

    // Check if admin portal is now visible (full-screen overlay)
    await page.screenshot({ path: '/tmp/admin-1-after-click.png', fullPage: true });
    console.log('Screenshot 1: After clicking Admin Panel');

    await page.screenshot({ path: '/tmp/admin-2-portal-open.png', fullPage: true });
    console.log('Screenshot 2: Admin portal state');

    // Check for Admin Portal sections in sidebar - look for "Admin Console" header or "Dashboard Overview"
    const hasAdminSidebar = await page.locator('text=Admin Console').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasDashboard = await page.locator('text=Dashboard Overview').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Admin Console header visible: ${hasAdminSidebar}`);
    console.log(`Dashboard Overview visible: ${hasDashboard}`);

    if (hasAdminSidebar) {
      console.log('\n=== TESTING ADMIN SECTIONS ===');

      // Test OAT Tool Synthesis section
      const oatSection = page.locator('text=OAT Tool Synthesis').first();
      const hasOAT = await oatSection.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`OAT Tool Synthesis section available: ${hasOAT}`);

      if (hasOAT) {
        console.log('Clicking OAT Tool Synthesis section...');
        await oatSection.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: '/tmp/admin-3-oat-expanded.png', fullPage: true });
        console.log('Screenshot 3: OAT Tool Synthesis expanded');

        // Look for subsections that appeared
        const pageText = await page.locator('body').textContent();
        console.log(`Page contains Configuration: ${pageText?.includes('Configuration')}`);
        console.log(`Page contains Pending Approvals: ${pageText?.includes('Pending Approvals')}`);

        // Click on Configuration if visible
        const oatConfig = page.locator('text=Configuration').first();
        if (await oatConfig.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('Clicking OAT Configuration...');
          await oatConfig.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: '/tmp/admin-4-oat-config.png', fullPage: true });
          console.log('Screenshot 4: OAT Configuration');
        }
      }

      // Test Monitoring & Logs section
      console.log('\n=== TESTING MONITORING & LOGS ===');
      const monitoringSection = page.locator('text=Monitoring & Logs').first();
      const hasMonitoring = await monitoringSection.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`Monitoring & Logs section available: ${hasMonitoring}`);

      if (hasMonitoring) {
        console.log('Clicking Monitoring & Logs section...');
        await monitoringSection.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: '/tmp/admin-5-monitoring-expanded.png', fullPage: true });
        console.log('Screenshot 5: Monitoring & Logs expanded');

        // Click on Feedback Analytics
        const feedbackAnalytics = page.locator('text=Feedback Analytics').first();
        if (await feedbackAnalytics.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log('Clicking Feedback Analytics...');
          await feedbackAnalytics.click();
          await page.waitForTimeout(3000);
          await page.screenshot({ path: '/tmp/admin-6-feedback-analytics.png', fullPage: true });
          console.log('Screenshot 6: Feedback Analytics');

          // Check for data presence
          const bodyText = await page.locator('body').textContent() || '';
          const hasNoDataMsg = bodyText.includes('No data') || bodyText.includes('No feedback') || bodyText.includes('No results');
          console.log(`Feedback Analytics - No data message: ${hasNoDataMsg}`);
          console.log(`Page content preview: ${bodyText.substring(0, 500)}`);
        }

        // Click on Usage Analytics
        const usageAnalytics = page.locator('text=Usage Analytics').first();
        if (await usageAnalytics.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log('Clicking Usage Analytics...');
          await usageAnalytics.click();
          await page.waitForTimeout(3000);
          await page.screenshot({ path: '/tmp/admin-7-usage-analytics.png', fullPage: true });
          console.log('Screenshot 7: Usage Analytics');
        }
      }
    }

    // Final screenshot
    await page.screenshot({ path: '/tmp/admin-8-final.png', fullPage: true });
    console.log('Screenshot 8: Final state');

    console.log('\n=== ADMIN CONSOLE TEST COMPLETE ===');
    console.log('Screenshots saved to /tmp/admin-*.png');
  });

  test('Check for hardcoded colors in Admin Portal', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await page.waitForTimeout(2000);

    console.log('\n=== CHECKING FOR HARDCODED COLORS ===');

    // Open admin portal using keyboard shortcut
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(2000);

    // Get all visible elements with inline styles containing hardcoded colors
    const hardcodedColorElements = await page.evaluate(() => {
      const results: { selector: string; style: string; color: string }[] = [];

      // Common hardcoded color patterns to check
      const hardcodedPatterns = [
        /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g, // Hex colors (but not inside var names)
        /rgb\([^)]+\)/gi,
        /rgba\([^)]+\)/gi,
        /hsl\([^)]+\)/gi,
        /hsla\([^)]+\)/gi,
      ];

      // Allowed patterns (CSS variables, etc.)
      const allowedPatterns = [
        /var\(--[^)]+\)/gi,
        /currentColor/gi,
        /inherit/gi,
        /transparent/gi,
      ];

      document.querySelectorAll('*').forEach((el) => {
        const style = el.getAttribute('style');
        if (style) {
          // Check for hardcoded colors
          for (const pattern of hardcodedPatterns) {
            const matches = style.match(pattern);
            if (matches) {
              // Verify it's not inside a var() or allowed pattern
              let isAllowed = false;
              for (const allowed of allowedPatterns) {
                if (style.match(allowed)) {
                  isAllowed = true;
                  break;
                }
              }
              if (!isAllowed) {
                const tagName = el.tagName.toLowerCase();
                const classList = el.className ? `.${String(el.className).split(' ').join('.')}` : '';
                results.push({
                  selector: `${tagName}${classList}`,
                  style: style.substring(0, 100),
                  color: matches[0]
                });
              }
            }
          }
        }
      });

      return results.slice(0, 20); // Limit to first 20
    });

    if (hardcodedColorElements.length > 0) {
      console.log('Found potential hardcoded colors:');
      hardcodedColorElements.forEach((el, i) => {
        console.log(`  ${i + 1}. ${el.selector}: ${el.color}`);
      });
    } else {
      console.log('No obvious hardcoded colors found in inline styles!');
    }

    // Check for common problematic color classes
    const problematicClasses = await page.evaluate(() => {
      const colorClasses = [
        'bg-gray-', 'bg-blue-', 'bg-red-', 'bg-green-', 'bg-yellow-',
        'text-gray-', 'text-blue-', 'text-red-', 'text-green-',
        'border-gray-', 'border-blue-', 'border-red-'
      ];

      let count = 0;
      document.querySelectorAll('*').forEach((el) => {
        const classList = el.className;
        if (typeof classList === 'string') {
          for (const prefix of colorClasses) {
            if (classList.includes(prefix)) {
              count++;
              break;
            }
          }
        }
      });

      return count;
    });

    console.log(`Elements with Tailwind color classes (may or may not be themed): ${problematicClasses}`);

    await page.screenshot({ path: '/tmp/admin-colors-check.png', fullPage: true });
    console.log('Screenshot saved: /tmp/admin-colors-check.png');

    console.log('\n=== HARDCODED COLOR CHECK COMPLETE ===');
  });
});
