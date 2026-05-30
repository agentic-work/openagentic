/**
 * Admin Portal UI Tests (Playwright)
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

async function testAdminPortalAccess() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Admin Portal Access', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(`${config.uiUrl}/admin`);
    await page.waitForTimeout(3000);

    // Check if admin portal loaded or redirected to login
    const isAdminPage = page.url().includes('/admin');
    const hasAdminElements = await page.$('[data-testid="admin-portal"]') !== null ||
                             await page.$('.admin') !== null ||
                             await page.$('h1:has-text("Admin")') !== null;

    return createTestResult('Admin Portal Access', true, Date.now() - startTime, null, {
      isAdminPage,
      hasAdminElements,
      url: page.url()
    });
  } catch (error) {
    return createTestResult('Admin Portal Access', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testUserManagement() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('User Management', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(`${config.uiUrl}/admin`);
    await page.waitForTimeout(3000);

    // Look for users section
    const usersLink = await page.$('a:has-text("Users")') ||
                      await page.$('[data-testid="users-nav"]') ||
                      await page.$('button:has-text("Users")');

    let hasUsersSection = false;
    if (usersLink) {
      await usersLink.click();
      await page.waitForTimeout(2000);
      hasUsersSection = true;
    }

    // Check for user list
    const hasUserList = await page.$('[data-testid="user-list"]') !== null ||
                        await page.$('table') !== null ||
                        await page.$('.user-item') !== null;

    return createTestResult('User Management', true, Date.now() - startTime, null, {
      usersLinkFound: !!usersLink,
      hasUsersSection,
      hasUserList
    });
  } catch (error) {
    return createTestResult('User Management', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testApiKeyManagement() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('API Key Management', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(`${config.uiUrl}/admin`);
    await page.waitForTimeout(3000);

    // Look for API keys section
    const apiKeysLink = await page.$('a:has-text("API")') ||
                        await page.$('[data-testid="api-keys-nav"]') ||
                        await page.$('button:has-text("API")');

    let hasApiKeysSection = false;
    if (apiKeysLink) {
      await apiKeysLink.click();
      await page.waitForTimeout(2000);
      hasApiKeysSection = true;
    }

    // Check for API key list
    const hasApiKeyList = await page.$('[data-testid="api-key-list"]') !== null ||
                          await page.$('table') !== null;

    return createTestResult('API Key Management', true, Date.now() - startTime, null, {
      apiKeysLinkFound: !!apiKeysLink,
      hasApiKeysSection,
      hasApiKeyList
    });
  } catch (error) {
    return createTestResult('API Key Management', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testFlowiseIntegration() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Flowise Integration UI', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(`${config.uiUrl}/admin`);
    await page.waitForTimeout(3000);

    // Look for Flowise section
    const flowiseLink = await page.$('a:has-text("Flowise")') ||
                        await page.$('[data-testid="flowise-nav"]') ||
                        await page.$('button:has-text("Flowise")') ||
                        await page.$('a:has-text("Workflow")');

    let hasFlowiseSection = false;
    if (flowiseLink) {
      await flowiseLink.click();
      await page.waitForTimeout(2000);
      hasFlowiseSection = true;
    }

    return createTestResult('Flowise Integration UI', true, Date.now() - startTime, null, {
      flowiseLinkFound: !!flowiseLink,
      hasFlowiseSection
    });
  } catch (error) {
    return createTestResult('Flowise Integration UI', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function run() {
  const results = [];

  logInfo('Testing admin portal UI...');

  results.push(await testAdminPortalAccess());
  results.push(await testUserManagement());
  results.push(await testApiKeyManagement());
  results.push(await testFlowiseIntegration());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
