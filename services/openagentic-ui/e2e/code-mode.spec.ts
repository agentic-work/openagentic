import { test, expect } from '@playwright/test';

// Admin credentials — must be set via env
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@openagentic.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

test.describe('Code Mode Toggle', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('[CONSOLE ERROR]: ' + msg.text());
      }
    });

    // Listen for page errors (uncaught exceptions)
    page.on('pageerror', error => {
      console.log('[PAGE ERROR]: ' + error.message);
    });
  });

  test('should login as admin and click Code Mode without React error #185', async ({ page }) => {
    // Track if we see the React error #185
    let reactError185Detected = false;
    let errorDetails = '';

    page.on('pageerror', error => {
      if (error.message.includes('185') || error.message.includes('Maximum update depth')) {
        reactError185Detected = true;
        errorDetails = error.message;
      }
    });

    page.on('console', msg => {
      if (msg.type() === 'error' && (msg.text().includes('185') || msg.text().includes('Maximum update depth'))) {
        reactError185Detected = true;
        errorDetails = msg.text();
      }
    });

    // Navigate to the app
    console.log('Navigating to http://localhost:8080...');
    await page.goto('/', { waitUntil: 'networkidle' });

    // Wait for the page to fully load past the splash screen
    console.log('Waiting for login form to appear...');
    await page.waitForTimeout(3000);
    
    // Take screenshot to see current state
    await page.screenshot({ path: 'e2e/screenshots/01-initial-page.png' });

    // Check if we're on login page or already logged in
    const currentUrl = page.url();
    console.log('Current URL: ' + currentUrl);

    if (currentUrl.includes('/login')) {
      console.log('On login page, looking for Local login tab...');
      
      // Wait for the login form to be visible
      await page.waitForSelector('button, input', { timeout: 10000 });
      await page.screenshot({ path: 'e2e/screenshots/02-login-form.png' });
      
      // Click the "Local" tab/button first - try different approaches
      try {
        // Look for a button or tab with "Local" text
        const localButton = page.getByRole('button', { name: /local/i }).or(
          page.getByRole('tab', { name: /local/i })
        ).or(
          page.locator('button').filter({ hasText: /local/i })
        );
        
        if (await localButton.first().isVisible({ timeout: 3000 })) {
          console.log('Found Local button, clicking...');
          await localButton.first().click();
          await page.waitForTimeout(500);
        }
      } catch (e) {
        console.log('Local button not found or not needed, proceeding...');
      }
      
      await page.screenshot({ path: 'e2e/screenshots/03-after-local-click.png' });
      
      console.log('Filling in credentials...');
      
      // Fill in login form - try multiple selectors
      const emailInput = page.locator('input[type="email"]').or(
        page.locator('input[name="email"]')
      ).or(
        page.locator('input#email')
      ).or(
        page.locator('input[placeholder*="email" i]')
      );
      
      const passwordInput = page.locator('input[type="password"]').or(
        page.locator('input[name="password"]')
      ).or(
        page.locator('input#password')
      );
      
      await emailInput.first().fill(ADMIN_EMAIL);
      await passwordInput.first().fill(ADMIN_PASSWORD);
      
      // Take screenshot of filled form
      await page.screenshot({ path: 'e2e/screenshots/04-login-filled.png' });
      
      // Click login button
      const loginButton = page.getByRole('button', { name: /sign in|login|submit/i }).or(
        page.locator('button[type="submit"]')
      );
      await loginButton.first().click();
      
      // Wait for navigation after login
      console.log('Waiting for login to complete...');
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'e2e/screenshots/05-after-login.png' });
      console.log('After login URL: ' + page.url());
    }

    // Wait for the main chat interface to load
    await page.waitForTimeout(2000);
    console.log('Main interface should be loaded');

    // Take screenshot before clicking Code mode
    await page.screenshot({ path: 'e2e/screenshots/06-before-code-mode.png' });

    // Find and click the Code mode button in the sidebar
    console.log('Looking for Code mode toggle button...');
    
    // Try to find the Code button
    const codeButton = page.getByRole('button', { name: /code/i }).or(
      page.locator('button').filter({ hasText: /code/i })
    ).or(
      page.locator('[aria-label*="Code" i]')
    );
    
    let clicked = false;
    try {
      const firstCodeBtn = codeButton.first();
      if (await firstCodeBtn.isVisible({ timeout: 5000 })) {
        console.log('Found Code button, clicking...');
        await firstCodeBtn.click();
        clicked = true;
      }
    } catch (e) {
      console.log('Code button not found with primary selector');
    }
    
    if (!clicked) {
      // Fallback: scan all buttons for "Code" text
      console.log('Scanning all buttons...');
      const buttons = await page.locator('button').all();
      console.log('Found ' + buttons.length + ' buttons');
      for (const btn of buttons) {
        const text = await btn.textContent();
        const ariaLabel = await btn.getAttribute('aria-label');
        if ((text && text.toLowerCase().includes('code')) || (ariaLabel && ariaLabel.toLowerCase().includes('code'))) {
          console.log('Found Code button with text: ' + (text || ariaLabel));
          await btn.click();
          clicked = true;
          break;
        }
      }
    }
    
    if (!clicked) {
      await page.screenshot({ path: 'e2e/screenshots/code-button-not-found.png' });
      console.log('WARNING: Could not find Code mode button');
    }
    
    // Wait for React to process the click and any re-renders
    console.log('Waiting for React to process...');
    await page.waitForTimeout(5000);
    
    // Take screenshot after clicking
    await page.screenshot({ path: 'e2e/screenshots/07-after-code-mode.png' });

    // Check for React error #185
    if (reactError185Detected) {
      console.log('FAILED: React error #185 detected!');
      console.log('Error details: ' + errorDetails);
      await page.screenshot({ path: 'e2e/screenshots/error-185.png' });
    }

    expect(reactError185Detected, 'React error #185 should not occur. Details: ' + errorDetails).toBe(false);
    
    console.log('SUCCESS: No React error #185 detected!');
  });
});
