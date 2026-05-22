import { vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.WORKFLOW_SECRET_KEY = process.env.WORKFLOW_SECRET_KEY || 'test-master-key-32-bytes-padding!';
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'test-internal-secret';

vi.setConfig({
  testTimeout: 30000,
  hookTimeout: 30000
});

beforeEach(() => {
  vi.clearAllMocks();
});

export const testUtils = {
  async waitFor(condition: () => boolean | Promise<boolean>, timeout = 5000, interval = 50): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },

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

  generateTestId(): string {
    return `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
};

export default testUtils;
