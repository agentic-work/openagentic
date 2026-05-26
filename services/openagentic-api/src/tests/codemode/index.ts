/**
 * Code Mode Test Harness
 *
 * Comprehensive test suite for validating Code Mode session management,
 * token lifecycle, LLM providers, workspace integrity, and WebSocket connections.
 *
 * Run: npx tsx src/tests/codemode/index.ts
 * With env: BASE_URL=https://chat-dev.openagentic.io npx tsx src/tests/codemode/index.ts
 */

import { SessionLifecycleTests } from './session-lifecycle.test.js';
import { TokenLifecycleTests } from './token-lifecycle.test.js';
import { LLMProviderTests } from './llm-provider.test.js';
import { WorkspaceTests } from './workspace.test.js';
import { WebSocketTests } from './websocket.test.js';

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, any>;
}

export interface TestSuiteResult {
  name: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  duration: number;
}

export interface TestConfig {
  baseUrl: string;
  testUserEmail: string;
  testUserPassword: string;
  verbose: boolean;
  timeout: number;
}

const defaultConfig: TestConfig = {
  baseUrl: process.env.BASE_URL || 'https://chat-dev.openagentic.io',
  testUserEmail: process.env.TEST_USER_EMAIL || 'codemode-test-1@openagentic.io',
  testUserPassword: process.env.TEST_USER_PASSWORD || 'TestPass123!',
  verbose: process.env.VERBOSE === 'true',
  timeout: parseInt(process.env.TEST_TIMEOUT || '30000', 10),
};

async function runTestSuite(
  name: string,
  testClass: { run: (config: TestConfig) => Promise<TestResult[]> },
  config: TestConfig
): Promise<TestSuiteResult> {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${name}`);
  console.log('='.repeat(60));

  let tests: TestResult[] = [];
  try {
    tests = await testClass.run(config);
  } catch (error: any) {
    tests = [{
      name: 'Suite initialization',
      passed: false,
      duration: 0,
      error: error.message,
    }];
  }

  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;
  const duration = Date.now() - startTime;

  // Print results
  for (const test of tests) {
    const status = test.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${status} ${test.name} (${test.duration}ms)`);
    if (!test.passed && test.error) {
      console.log(`       Error: ${test.error}`);
    }
    if (config.verbose && test.details) {
      console.log(`       Details: ${JSON.stringify(test.details, null, 2)}`);
    }
  }

  console.log(`\nSuite Summary: ${passed} passed, ${failed} failed (${duration}ms)`);

  return { name, tests, passed, failed, duration };
}

async function authenticate(config: TestConfig): Promise<string> {
  console.log(`Authenticating as ${config.testUserEmail}...`);

  const response = await fetch(`${config.baseUrl}/api/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: config.testUserEmail,
      password: config.testUserPassword,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Authentication failed: ${error}`);
  }

  const data = await response.json();
  if (!data.accessToken) {
    throw new Error('No access token in response');
  }

  console.log('Authentication successful');
  return data.accessToken;
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('       CODE MODE SESSION TEST HARNESS');
  console.log('='.repeat(60));
  console.log(`\nTarget: ${defaultConfig.baseUrl}`);
  console.log(`User: ${defaultConfig.testUserEmail}`);
  console.log(`Timeout: ${defaultConfig.timeout}ms`);

  // Authenticate
  let token: string;
  try {
    token = await authenticate(defaultConfig);
  } catch (error: any) {
    console.error(`\n\x1b[31mFATAL: Authentication failed\x1b[0m`);
    console.error(error.message);
    process.exit(1);
  }

  // Create config with token
  const configWithToken = {
    ...defaultConfig,
    token,
  };

  // Run test suites
  const suites = [
    { name: 'Session Lifecycle', tests: SessionLifecycleTests },
    { name: 'Token Lifecycle', tests: TokenLifecycleTests },
    { name: 'LLM Provider', tests: LLMProviderTests },
    { name: 'Workspace Integrity', tests: WorkspaceTests },
    { name: 'WebSocket Connection', tests: WebSocketTests },
  ];

  const results: TestSuiteResult[] = [];
  for (const suite of suites) {
    const result = await runTestSuite(suite.name, suite.tests, configWithToken as any);
    results.push(result);
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('                    FINAL SUMMARY');
  console.log('='.repeat(60));

  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  for (const result of results) {
    const status = result.failed === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${status} ${result.name}: ${result.passed}/${result.passed + result.failed}`);
  }

  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('='.repeat(60));

  // Exit with appropriate code
  process.exit(totalFailed > 0 ? 1 : 0);
}

// Export for programmatic use
export { runTestSuite, authenticate, defaultConfig };

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Test harness failed:', error);
    process.exit(1);
  });
}
