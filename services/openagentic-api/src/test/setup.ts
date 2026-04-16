/**
 * Vitest Test Setup
 *
 * Global test setup and configuration for the API test suite.
 * Configures environment, mocks, and shared test utilities.
 */

import { vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // Suppress logs during tests

// Mock environment variables for tests
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.MILVUS_HOST = process.env.MILVUS_HOST || 'localhost';
process.env.MILVUS_PORT = process.env.MILVUS_PORT || '19530';

// Ollama testing configuration - can be overridden by TEST_OLLAMA_BASE_URL
process.env.OLLAMA_BASE_URL = process.env.TEST_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
process.env.OLLAMA_MODEL = process.env.TEST_OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'gpt-oss';
process.env.OLLAMA_ENABLED = process.env.OLLAMA_ENABLED || 'true';

// Test timeouts
vi.setConfig({
  testTimeout: 30000,
  hookTimeout: 30000
});

// Global test hooks
beforeAll(async () => {
  // Setup before all tests
  console.log('[Test Setup] Starting test suite...');
});

afterAll(async () => {
  // Cleanup after all tests
  console.log('[Test Setup] Test suite complete.');
});

beforeEach(() => {
  // Reset mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Cleanup after each test
});

// Export test utilities
export const testUtils = {
  /**
   * Wait for a condition to be true
   */
  async waitFor(condition: () => boolean | Promise<boolean>, timeout = 5000, interval = 100): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },

  /**
   * Create a mock logger
   */
  createMockLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis()
    };
  },

  /**
   * Generate a unique test ID
   */
  generateTestId(): string {
    return `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
};

export default testUtils;
