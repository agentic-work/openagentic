/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from "@playwright/test";

test("check page loads", async ({ page }) => {
  console.log("Navigating to page...");
  await page.goto("https://chat-dev.openagentics.io/");
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
