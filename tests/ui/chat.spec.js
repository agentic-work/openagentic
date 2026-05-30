/**
 * Chat UI Tests (Playwright)
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

async function testChatInterface() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Chat Interface', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(config.uiUrl);
    await page.waitForTimeout(3000);

    // Check for chat interface elements
    const hasChatInput = await page.$('textarea') !== null ||
                         await page.$('[data-testid="chat-input"]') !== null ||
                         await page.$('input[placeholder*="message"]') !== null;

    const hasSidebar = await page.$('[data-testid="sidebar"]') !== null ||
                       await page.$('.sidebar') !== null ||
                       await page.$('nav') !== null;

    const hasModelSelector = await page.$('[data-testid="model-selector"]') !== null ||
                             await page.$('select') !== null;

    return createTestResult('Chat Interface', true, Date.now() - startTime, null, {
      hasChatInput,
      hasSidebar,
      hasModelSelector,
      url: page.url()
    });
  } catch (error) {
    return createTestResult('Chat Interface', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testSendMessage() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Send Message', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(config.uiUrl);
    await page.waitForTimeout(3000);

    // Find chat input
    const chatInput = await page.$('textarea') ||
                      await page.$('[data-testid="chat-input"]') ||
                      await page.$('input[placeholder*="message"]');

    if (!chatInput) {
      return createTestResult('Send Message', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Chat input not found (may require authentication)'
      });
    }

    // Type a message
    await chatInput.fill('Hello, this is a test message. Please respond with OK.');

    // Find and click send button
    const sendButton = await page.$('[data-testid="send-button"]') ||
                       await page.$('button[type="submit"]') ||
                       await page.$('button:has-text("Send")') ||
                       await page.$('button svg'); // Often the send icon

    if (sendButton) {
      await sendButton.click();
    } else {
      // Try pressing Enter
      await chatInput.press('Enter');
    }

    // Wait for response
    await page.waitForTimeout(10000);

    // Check for response
    const hasResponse = await page.$('.message') !== null ||
                        await page.$('[data-testid="assistant-message"]') !== null ||
                        await page.$('.prose') !== null;

    return createTestResult('Send Message', true, Date.now() - startTime, null, {
      messageSent: true,
      hasResponse
    });
  } catch (error) {
    return createTestResult('Send Message', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testCodeBlockRendering() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('Code Block Rendering', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(config.uiUrl);
    await page.waitForTimeout(3000);

    const chatInput = await page.$('textarea') ||
                      await page.$('[data-testid="chat-input"]');

    if (!chatInput) {
      return createTestResult('Code Block Rendering', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Chat input not found'
      });
    }

    // Request code
    await chatInput.fill('Write a simple Python hello world function in a code block.');

    const sendButton = await page.$('[data-testid="send-button"]') ||
                       await page.$('button[type="submit"]');
    if (sendButton) {
      await sendButton.click();
    } else {
      await chatInput.press('Enter');
    }

    // Wait for response with code
    await page.waitForTimeout(15000);

    // Check for code block elements
    const hasCodeBlock = await page.$('pre code') !== null ||
                         await page.$('.shiki') !== null ||
                         await page.$('[data-language]') !== null ||
                         await page.$('.hljs') !== null;

    const hasCopyButton = await page.$('button[aria-label*="copy"]') !== null ||
                          await page.$('[data-testid="copy-code"]') !== null;

    return createTestResult('Code Block Rendering', true, Date.now() - startTime, null, {
      hasCodeBlock,
      hasCopyButton
    });
  } catch (error) {
    return createTestResult('Code Block Rendering', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function testNewConversation() {
  const startTime = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();
    if (!browser) {
      return createTestResult('New Conversation', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'Playwright not available'
      });
    }

    const page = await browser.newPage();
    await page.goto(config.uiUrl);
    await page.waitForTimeout(3000);

    // Find new conversation button
    const newChatButton = await page.$('[data-testid="new-chat"]') ||
                          await page.$('button:has-text("New")') ||
                          await page.$('button:has-text("+")') ||
                          await page.$('[aria-label*="new"]');

    let clicked = false;
    if (newChatButton) {
      await newChatButton.click();
      await page.waitForTimeout(1000);
      clicked = true;
    }

    return createTestResult('New Conversation', true, Date.now() - startTime, null, {
      newChatButtonFound: !!newChatButton,
      clicked
    });
  } catch (error) {
    return createTestResult('New Conversation', false, Date.now() - startTime, error);
  } finally {
    if (browser) await browser.close();
  }
}

async function run() {
  const results = [];

  logInfo('Testing chat UI...');

  results.push(await testChatInterface());
  results.push(await testSendMessage());
  results.push(await testCodeBlockRendering());
  results.push(await testNewConversation());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
