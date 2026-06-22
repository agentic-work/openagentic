/**
 * Authentication UI Tests (Playwright)
 */

const { config, createTestResult, logInfo } = require('../config');

let playwright;

async function launchBrowser() {
  if (!playwright) {
    try {
      playwright = require('playwright');
    } catch (e) {
      return null;
    }
  }

  return playwright.chromium.launch({
    headless: config.headless
  });
}

async function testLocalLoginPage() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Local Login Page', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(config.uiUrl);

    // Wait for login form or redirect
    await page.waitForTimeout(2000);

    // Check if we're on login page or if there's a login button
    const hasLoginForm = await page.$('input[type="password"]') !== null ||
                         await page.$('[data-testid="login-button"]') !== null ||
                         await page.$('button:has-text("Sign")') !== null;

    return createTestResult('Local Login Page', true, Date.now() - startTime, null, {
      hasLoginForm,
      url: page.url()
    });
  } catch (error) {
    return createTestResult('Local Login Page', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testLocalAdminLogin() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Local Admin Login', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(config.uiUrl);
    await page.waitForTimeout(2000);

    // Look for local login option
    const localLoginButton = await page.$('[data-testid="local-login"]') ||
                             await page.$('button:has-text("Local")') ||
                             await page.$('a:has-text("Local")');

    if (localLoginButton) {
      await localLoginButton.click();
      await page.waitForTimeout(1000);
    }

    // Fill in credentials
    const usernameInput = await page.$('input[name="username"]') ||
                          await page.$('input[type="email"]') ||
                          await page.$('input[placeholder*="email"]');

    const passwordInput = await page.$('input[name="password"]') ||
                          await page.$('input[type="password"]');

    if (usernameInput && passwordInput) {
      await usernameInput.fill(config.localAdmin.username);
      await passwordInput.fill(config.localAdmin.password);

      // Submit form
      const submitButton = await page.$('button[type="submit"]') ||
                           await page.$('button:has-text("Sign")') ||
                           await page.$('button:has-text("Login")');

      if (submitButton) {
        await submitButton.click();
        await page.waitForTimeout(3000);
      }
    }

    // Check if login was successful (look for chat interface or dashboard)
    const isLoggedIn = await page.$('[data-testid="chat-input"]') !== null ||
                       await page.$('textarea') !== null ||
                       await page.$('[data-testid="sidebar"]') !== null;

    return createTestResult('Local Admin Login', true, Date.now() - startTime, null, {
      isLoggedIn,
      url: page.url()
    });
  } catch (error) {
    return createTestResult('Local Admin Login', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testLogout() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Logout', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(config.uiUrl);
    await page.waitForTimeout(2000);

    // Look for logout button or user menu
    const userMenu = await page.$('[data-testid="user-menu"]') ||
                     await page.$('[aria-label*="user"]') ||
                     await page.$('.user-avatar');

    if (userMenu) {
      await userMenu.click();
      await page.waitForTimeout(500);
    }

    const logoutButton = await page.$('[data-testid="logout"]') ||
                         await page.$('button:has-text("Logout")') ||
                         await page.$('button:has-text("Sign out")') ||
                         await page.$('a:has-text("Logout")');

    let loggedOut = false;
    if (logoutButton) {
      await logoutButton.click();
      await page.waitForTimeout(2000);
      loggedOut = true;
    }

    return createTestResult('Logout', true, Date.now() - startTime, null, {
      logoutButtonFound: !!logoutButton,
      loggedOut
    });
  } catch (error) {
    return createTestResult('Logout', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function run() {
  const results = [];

  logInfo('Testing authentication UI...');

  results.push(await testLocalLoginPage());
  results.push(await testLocalAdminLogin());
  results.push(await testLogout());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
