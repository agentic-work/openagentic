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

import { test, Page } from '@playwright/test';

const BASE_URL = 'https://chat-dev.openagentics.io';

test('Debug Code Mode Login', async ({ page }) => {
  test.setTimeout(120000);

  // Capture console messages
  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
  
  // Capture network errors
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log('HTTP ERROR:', response.status(), response.url());
    }
  });

  console.log('Navigating to login page...');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/debug-01-login-page.png', fullPage: true });

  console.log('Clicking Continue with Email...');
  await page.getByRole('button', { name: /continue with email|sign in with email/i }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/debug-02-email-form.png', fullPage: true });

  console.log('Filling credentials...');
  await page.locator('input[type="email"]').first().fill('codemode-test-1@openagentics.io');
  await page.locator('input[type="password"]').first().fill('TestPass123!');
  await page.screenshot({ path: 'test-results/debug-03-filled-form.png', fullPage: true });

  console.log('Clicking Sign in...');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  
  // Wait for network to settle
  await page.waitForLoadState('networkidle');
  console.log('Current URL after login:', page.url());
  await page.screenshot({ path: 'test-results/debug-04-after-login.png', fullPage: true });

  // Wait a moment
  await page.waitForTimeout(2000);

  console.log('Navigating to /code...');
  await page.goto(`${BASE_URL}/code`);
  await page.waitForLoadState('networkidle');
  console.log('Current URL at /code:', page.url());
  await page.screenshot({ path: 'test-results/debug-05-code-page.png', fullPage: true });

  // Wait and take more screenshots
  await page.waitForTimeout(3000);
  console.log('After 3 second wait:', page.url());
  await page.screenshot({ path: 'test-results/debug-06-code-page-wait.png', fullPage: true });

  // Get page content
  const bodyText = await page.textContent('body');
  console.log('Page text contains:', bodyText?.substring(0, 500));
});
