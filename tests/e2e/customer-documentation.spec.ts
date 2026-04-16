/**
 * E2E Test: Customer Documentation Videos
 *
 * Creates customer-facing documentation with time markers for voiceover.
 * Records video of key workflows with annotations for each step.
 *
 * Run with: npx playwright test customer-documentation.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Configure video recording at the top level
test.use({
  video: 'on',
  viewport: { width: 1920, height: 1080 }
});

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

interface TimeMarker {
  timestamp: string;
  action: string;
  description: string;
  screenshot?: string;
}

class DocumentationRecorder {
  private markers: TimeMarker[] = [];
  private startTime: number;
  private videoName: string;

  constructor(videoName: string) {
    this.videoName = videoName;
    this.startTime = Date.now();
  }

  addMarker(action: string, description: string, screenshot?: string) {
    const elapsed = Date.now() - this.startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const timestamp = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    this.markers.push({
      timestamp,
      action,
      description,
      screenshot
    });

    console.log(`[${timestamp}] ${action}: ${description}`);
  }

  getMarkers(): TimeMarker[] {
    return this.markers;
  }

  generateScript(): string {
    let script = `# ${this.videoName} - Voiceover Script\n\n`;
    script += `Total Duration: ${this.markers.length > 0 ? this.markers[this.markers.length - 1].timestamp : '00:00'}\n\n`;
    script += `## Time Markers\n\n`;

    for (const marker of this.markers) {
      script += `### [${marker.timestamp}] ${marker.action}\n`;
      script += `${marker.description}\n`;
      if (marker.screenshot) {
        script += `*Screenshot: ${marker.screenshot}*\n`;
      }
      script += `\n`;
    }

    return script;
  }
}

test.describe('Customer Documentation Videos', () => {
  test.setTimeout(600000); // 10 minute timeout

  test('Video 1: Getting Started - Login and First Chat', async ({ page }) => {
    const recorder = new DocumentationRecorder('Getting Started with OpenAgentic Chat');

    recorder.addMarker('INTRO', 'Welcome to OpenAgentic Chat! In this guide, we will show you how to log in and send your first message.');

    // Navigate to app
    recorder.addMarker('NAVIGATE', 'Open your browser and navigate to chat-dev.openagentic.io');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'screenshots/doc-01-landing.png' });
    recorder.addMarker('SCREENSHOT', 'This is the login page where you can choose your authentication method.', 'doc-01-landing.png');

    // Select local login
    await page.waitForTimeout(2000);
    recorder.addMarker('LOGIN', 'Click on the Local Login option to sign in with your email and password');
    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: 'screenshots/doc-02-login-form.png' });
    recorder.addMarker('SCREENSHOT', 'The login form appears. Enter your credentials here.', 'doc-02-login-form.png');

    // Fill credentials
    recorder.addMarker('CREDENTIALS', 'Enter your email address in the email field');
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]'));
    await emailInput.fill(TEST_EMAIL);
    await page.waitForTimeout(500);

    recorder.addMarker('CREDENTIALS', 'Enter your password in the password field');
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill(TEST_PASSWORD);
    await page.screenshot({ path: 'screenshots/doc-03-credentials.png' });
    recorder.addMarker('SCREENSHOT', 'Your credentials are entered. Now click Sign In.', 'doc-03-credentials.png');

    // Submit login
    recorder.addMarker('SUBMIT', 'Click the Sign In button to authenticate');
    await page.locator('button[type="submit"]').click();

    // Wait for dashboard
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/doc-04-dashboard.png' });
    recorder.addMarker('SUCCESS', 'You are now logged in! This is your chat dashboard.', 'doc-04-dashboard.png');

    // Send first message
    recorder.addMarker('CHAT', 'Let us send our first message. Click on the chat input area.');
    const chatInput = page.locator('textarea').first();
    await chatInput.click();
    await page.waitForTimeout(500);

    recorder.addMarker('TYPE', 'Type your message. For example: Hello, what can you help me with?');
    await chatInput.fill('Hello, what can you help me with?');
    await page.screenshot({ path: 'screenshots/doc-05-typing.png' });
    recorder.addMarker('SCREENSHOT', 'Your message is ready to send.', 'doc-05-typing.png');

    // Send message
    recorder.addMarker('SEND', 'Press Enter or click the Send button to send your message');
    await page.keyboard.press('Enter');

    // Wait for response
    recorder.addMarker('WAITING', 'The AI is now processing your request. Watch for the response to appear.');
    await page.waitForTimeout(10000);
    await page.screenshot({ path: 'screenshots/doc-06-response.png' });
    recorder.addMarker('RESPONSE', 'The AI has responded! You can continue the conversation by typing another message.', 'doc-06-response.png');

    recorder.addMarker('OUTRO', 'Congratulations! You have successfully logged in and sent your first message. Explore more features in the next tutorials.');

    // Save voiceover script
    const script = recorder.generateScript();
    fs.writeFileSync('screenshots/doc-video1-script.md', script);
    console.log('\n\n=== VOICEOVER SCRIPT ===\n' + script);
  });

  test('Video 2: Using Chat Features - History and Sessions', async ({ page }) => {
    const recorder = new DocumentationRecorder('Chat Features - History and Sessions');

    recorder.addMarker('INTRO', 'In this tutorial, we will explore chat history and session management features.');

    // Login first
    await page.goto(BASE_URL);
    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }
    await page.locator('input[type="email"]').or(page.locator('input[name="email"]')).fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
    await page.waitForTimeout(2000);

    recorder.addMarker('LOGGED_IN', 'We are now logged in and ready to explore chat features.');
    await page.screenshot({ path: 'screenshots/doc-history-01.png' });

    // Look for sidebar/history
    recorder.addMarker('SIDEBAR', 'Notice the sidebar on the left. This shows your chat history and sessions.');
    const sidebar = page.locator('[class*="sidebar"]').or(page.locator('nav')).first();
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.screenshot({ path: 'screenshots/doc-history-02-sidebar.png' });
      recorder.addMarker('SCREENSHOT', 'The sidebar contains your previous conversations.', 'doc-history-02-sidebar.png');
    }

    // Create new chat
    recorder.addMarker('NEW_CHAT', 'To start a new conversation, look for the New Chat button.');
    const newChatButton = page.locator('text=New Chat')
      .or(page.locator('button:has-text("New")'))
      .or(page.locator('[aria-label*="new" i]'));

    if (await newChatButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.screenshot({ path: 'screenshots/doc-history-03-newchat.png' });
      recorder.addMarker('SCREENSHOT', 'Click this button to start a fresh conversation.', 'doc-history-03-newchat.png');
      await newChatButton.first().click();
      await page.waitForTimeout(1000);
    }

    // Send messages to build history
    recorder.addMarker('BUILD_HISTORY', 'Let us send a few messages to build chat history.');
    const chatInput = page.locator('textarea').first();

    const messages = [
      'What is the weather like today?',
      'Tell me about TypeScript',
      'How do I create a REST API?'
    ];

    for (const msg of messages) {
      await chatInput.click();
      await chatInput.fill(msg);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
    }

    await page.screenshot({ path: 'screenshots/doc-history-04-messages.png' });
    recorder.addMarker('HISTORY', 'Your conversation history is now visible in this session.', 'doc-history-04-messages.png');

    recorder.addMarker('OUTRO', 'You now know how to navigate chat history and manage sessions. These conversations are saved and can be accessed later.');

    const script = recorder.generateScript();
    fs.writeFileSync('screenshots/doc-video2-script.md', script);
    console.log('\n\n=== VOICEOVER SCRIPT ===\n' + script);
  });

  test('Video 3: Admin Features - Managing Users and Prompts', async ({ page }) => {
    const recorder = new DocumentationRecorder('Admin Features - Users and Prompts');

    recorder.addMarker('INTRO', 'This tutorial covers administrative features including user management and prompt templates.');

    // Login
    await page.goto(BASE_URL);
    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }
    await page.locator('input[type="email"]').or(page.locator('input[name="email"]')).fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
    await page.waitForTimeout(2000);

    recorder.addMarker('LOGGED_IN', 'Logged in as administrator.');

    // Navigate to admin
    recorder.addMarker('ADMIN', 'Look for the Admin or Settings button to access administrative features.');
    const adminButton = page.locator('text=Admin')
      .or(page.locator('[aria-label*="Admin" i]'))
      .or(page.locator('text=Settings'));

    if (await adminButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.screenshot({ path: 'screenshots/doc-admin-01.png' });
      recorder.addMarker('SCREENSHOT', 'The Admin button gives you access to management features.', 'doc-admin-01.png');

      await adminButton.first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'screenshots/doc-admin-02-panel.png' });
      recorder.addMarker('ADMIN_PANEL', 'This is the admin panel where you can manage various settings.', 'doc-admin-02-panel.png');

      // Look for Users section
      const usersTab = page.locator('text=Users').first();
      if (await usersTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await usersTab.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/doc-admin-03-users.png' });
        recorder.addMarker('USERS', 'The Users section shows all registered users and their roles.', 'doc-admin-03-users.png');
      }

      // Look for Prompts section
      const promptsTab = page.locator('text=Prompts').or(page.locator('text=Templates')).first();
      if (await promptsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await promptsTab.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/doc-admin-04-prompts.png' });
        recorder.addMarker('PROMPTS', 'Here you can manage system prompts and templates.', 'doc-admin-04-prompts.png');
      }

      // Look for Usage/Analytics
      const usageTab = page.locator('text=Usage').or(page.locator('text=Analytics')).first();
      if (await usageTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await usageTab.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/doc-admin-05-usage.png' });
        recorder.addMarker('USAGE', 'The Usage section shows analytics and consumption metrics.', 'doc-admin-05-usage.png');
      }
    }

    recorder.addMarker('OUTRO', 'You have explored the main admin features. Use these tools to manage your OpenAgentic deployment.');

    const script = recorder.generateScript();
    fs.writeFileSync('screenshots/doc-video3-script.md', script);
    console.log('\n\n=== VOICEOVER SCRIPT ===\n' + script);
  });

  test('Video 4: Flowise Integration - Creating Workflows', async ({ page }) => {
    const recorder = new DocumentationRecorder('Flowise Integration - Creating Workflows');

    recorder.addMarker('INTRO', 'This tutorial shows how to use Flowise to create automated workflows and chatbots.');

    // Login
    await page.goto(BASE_URL);
    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }
    await page.locator('input[type="email"]').or(page.locator('input[name="email"]')).fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
    await page.waitForTimeout(2000);

    recorder.addMarker('LOGGED_IN', 'We are logged in and ready to access Flowise.');

    // Navigate to Flowise
    recorder.addMarker('FLOWISE', 'Look for the Flowise button in the navigation.');
    const flowiseButton = page.locator('text=Flowise')
      .or(page.locator('[aria-label*="Flowise" i]'))
      .or(page.locator('button:has-text("Flowise")'));

    if (await flowiseButton.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await page.screenshot({ path: 'screenshots/doc-flowise-01.png' });
      recorder.addMarker('SCREENSHOT', 'Click the Flowise button to open the workflow builder.', 'doc-flowise-01.png');

      await flowiseButton.first().click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'screenshots/doc-flowise-02-loading.png' });
      recorder.addMarker('LOADING', 'Flowise is loading. Please wait for the interface to appear.', 'doc-flowise-02-loading.png');

      await page.waitForTimeout(10000);
      await page.screenshot({ path: 'screenshots/doc-flowise-03-interface.png' });
      recorder.addMarker('INTERFACE', 'This is the Flowise interface where you can create and manage workflows.', 'doc-flowise-03-interface.png');

      // Try to access iframe content
      const frame = page.frameLocator('iframe').first();

      // Look for Chatflows menu
      const chatflowsMenu = frame.locator('text=Chatflows').first();
      if (await chatflowsMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
        await chatflowsMenu.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/doc-flowise-04-chatflows.png' });
        recorder.addMarker('CHATFLOWS', 'Chatflows are pre-built conversation templates you can customize.', 'doc-flowise-04-chatflows.png');
      }

      // Look for Agentflows
      const agentflowsMenu = frame.locator('text=Agentflows').first();
      if (await agentflowsMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
        await agentflowsMenu.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/doc-flowise-05-agentflows.png' });
        recorder.addMarker('AGENTFLOWS', 'Agentflows are AI agents that can perform tasks autonomously.', 'doc-flowise-05-agentflows.png');
      }
    }

    recorder.addMarker('OUTRO', 'You now know how to access Flowise. Explore the workflow builder to create custom chatbots and agents.');

    const script = recorder.generateScript();
    fs.writeFileSync('screenshots/doc-video4-script.md', script);
    console.log('\n\n=== VOICEOVER SCRIPT ===\n' + script);
  });

  test('Generate Documentation Index', async ({ page }) => {
    // Create an index file for all documentation
    const index = `# OpenAgentic Chat - Customer Documentation

## Video Tutorials

1. **Getting Started** - Learn how to log in and send your first message
   - Script: doc-video1-script.md
   - Duration: ~2 minutes

2. **Chat Features** - Explore chat history and session management
   - Script: doc-video2-script.md
   - Duration: ~3 minutes

3. **Admin Features** - Managing users and prompt templates
   - Script: doc-video3-script.md
   - Duration: ~3 minutes

4. **Flowise Integration** - Creating automated workflows
   - Script: doc-video4-script.md
   - Duration: ~4 minutes

## Screenshots

All screenshots are saved in the screenshots/ directory with the naming convention:
- doc-XX-description.png

## Usage Notes

- Videos are recorded at 1920x1080 resolution
- Each video includes time markers for voiceover synchronization
- Scripts include step-by-step narration text

## Production Notes

To create the final videos:
1. Review the screenshots and scripts
2. Record voiceover using the time markers
3. Combine screenshots/video with voiceover in editing software
4. Add transitions and background music as needed
`;

    fs.writeFileSync('screenshots/documentation-index.md', index);
    console.log('\n\n=== DOCUMENTATION INDEX CREATED ===\n');
    console.log('Check screenshots/ directory for all materials');
  });
});
