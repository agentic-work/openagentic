import { test, expect } from '@playwright/test';

test('Smart Router Prometheus Query Test', async ({ page }) => {
  const BASE_URL = 'https://chat-dev.openagentic.io';
  
  console.log('\n=== Smart Router Test ===\n');
  
  // Step 1: Navigate and login
  console.log('STEP 1: Logging in as admin');
  await page.goto(BASE_URL);
  await page.waitForTimeout(2000);
  
  // Click "Continue with Email"
  const emailButton = page.locator('button:has-text("Continue with Email"), button:has-text("Sign in with Email")');
  if (await emailButton.isVisible()) {
    await emailButton.click();
    await page.waitForTimeout(1000);
  }
  
  // Fill credentials
  await page.fill('input[type="email"], input[name="email"]', 'admin@openagentic.io');
  await page.fill('input[type="password"], input[name="password"]', process.env.ADMIN_PASSWORD || '');
  
  // Click sign in
  await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    if (btn) btn.click();
  });
  
  await page.waitForTimeout(3000);
  console.log('  Logged in! URL:', page.url());
  
  // Dismiss modal more aggressively
  console.log('\nSTEP 1.5: Dismissing modals');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  
  // Click any visible dismiss buttons
  const dismissButtons = ['Skip', 'Close', 'Get Started', 'Dismiss', 'Got it', 'Continue'];
  for (const btnText of dismissButtons) {
    try {
      const btn = page.locator(`button:has-text("${btnText}")`).first();
      if (await btn.isVisible({ timeout: 500 })) {
        console.log(`  Clicking "${btnText}" button`);
        await btn.click({ force: true });
        await page.waitForTimeout(500);
      }
    } catch (e) {}
  }
  
  // Click outside any modal
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);
  
  // Check if modal is still there
  const modalOverlay = page.locator('div.fixed.inset-0.bg-black\\/70');
  if (await modalOverlay.isVisible({ timeout: 1000 })) {
    console.log('  Modal still visible, trying to close via clicking backdrop');
    await modalOverlay.click({ position: { x: 10, y: 10 }, force: true });
    await page.waitForTimeout(500);
  }
  
  await page.waitForTimeout(1000);
  
  // Step 2: Check Smart Router setting
  console.log('\nSTEP 2: Checking model selector');
  
  const modelSelector = page.locator('button:has-text("Smart Router"), button:has-text("Model")').first();
  if (await modelSelector.isVisible({ timeout: 3000 })) {
    const selectorText = await modelSelector.textContent();
    console.log('  Model selector text:', selectorText);
  }
  
  // Step 3: Send the Prometheus query
  console.log('\nSTEP 3: Sending Prometheus query');
  const prompt = 'Show me my latest prometheus metrics from the cluster. What are the current CPU and memory usage across all pods?';
  console.log('  Prompt:', prompt);
  
  // Find textarea - wait for it to be actionable
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10000 });
  
  // Make sure no modal is blocking
  await page.evaluate(() => {
    // Remove any modal overlays
    document.querySelectorAll('div.fixed.inset-0').forEach(el => {
      if ((el as HTMLElement).style.zIndex === '100' || el.classList.contains('bg-black/70')) {
        (el as HTMLElement).remove();
      }
    });
  });
  
  await textarea.fill(prompt);
  await page.waitForTimeout(500);
  
  // Use keyboard to submit
  await textarea.press('Enter');
  // Or try Ctrl+Enter
  await page.waitForTimeout(500);
  
  // If that didn't work, try clicking send
  const sendBtn = page.locator('button[aria-label*="Send"]').first();
  if (await sendBtn.isVisible({ timeout: 1000 })) {
    await sendBtn.click({ force: true });
  }
  
  console.log('  Message sent, waiting for response...');
  
  // Step 4: Monitor the response
  console.log('\nSTEP 4: Monitoring response (60s max)');
  
  let lastResponseLength = 0;
  let noChangeCount = 0;
  
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    
    // Get page content for debugging
    const pageText = await page.textContent('body');
    
    // Check for error patterns
    if (pageText?.includes('RESOURCE_NOT_FOUND')) {
      console.log('\n  ❌ RESOURCE_NOT_FOUND ERROR DETECTED!');
      // Find the error message
      const errorDiv = await page.locator(':has-text("RESOURCE_NOT_FOUND")').first().textContent();
      console.log('  Error context:', errorDiv?.slice(0, 300));
      break;
    }
    
    if (pageText?.includes('Error Code:')) {
      console.log('\n  ❌ ERROR CODE DETECTED!');
      const errorMatch = pageText.match(/Error Code: ([A-Z_]+)/);
      if (errorMatch) {
        console.log('  Error code:', errorMatch[1]);
      }
    }
    
    // Check for any response content
    const responseLength = pageText?.length || 0;
    if (responseLength > lastResponseLength + 50) {
      console.log(`  [${i*2}s] New content detected (${responseLength - lastResponseLength} chars)`);
      lastResponseLength = responseLength;
      noChangeCount = 0;
    } else {
      noChangeCount++;
      if (noChangeCount > 5) {
        console.log(`  [${i*2}s] No new content for 10s, response may be complete`);
        break;
      }
    }
  }
  
  // Step 5: Capture final state
  console.log('\nSTEP 5: Final Analysis');
  
  await page.screenshot({ path: '/tmp/smart-router-result.png', fullPage: true });
  console.log('  Screenshot saved to /tmp/smart-router-result.png');
  
  // Get the assistant's response
  const messages = await page.locator('[class*="message"], [class*="assistant"], [class*="response"]').allTextContents();
  console.log('\n  Messages found:', messages.length);
  
  // Print the last message (likely the response)
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    console.log('\n  Last message (truncated):');
    console.log('  ', lastMsg.slice(0, 800));
  }
  
  console.log('\n=== Test Complete ===\n');
});
