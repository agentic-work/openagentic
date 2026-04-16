import { test, expect } from "@playwright/test";

test("check page loads", async ({ page }) => {
  console.log("Navigating to page...");
  await page.goto("https://chat-dev.openagentic.io/");
  console.log("Waiting for content...");
  await page.waitForTimeout(5000);
  
  const content = await page.content();
  console.log("Page content length:", content.length);
  
  // Check for various elements
  const body = await page.locator("body").textContent().catch(() => "");
  console.log("Body text length:", body?.length || 0);
  console.log("Body preview:", body?.substring(0, 500) || "EMPTY");
  
  await page.screenshot({ path: "e2e/screenshots/page-check.png", fullPage: true });
  
  // Check for login elements
  const hasLocal = await page.locator('button:has-text("Local")').isVisible({ timeout: 1000 }).catch(() => false);
  console.log("Has Local button:", hasLocal);
  
  const hasEmail = await page.locator('input[type="email"]').isVisible({ timeout: 1000 }).catch(() => false);
  console.log("Has email input:", hasEmail);
  
  const hasTextarea = await page.locator('textarea').isVisible({ timeout: 1000 }).catch(() => false);
  console.log("Has textarea:", hasTextarea);
  
  expect(content.length).toBeGreaterThan(100);
});
