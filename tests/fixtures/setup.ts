/**
 * Test Fixtures and Setup for OpenAgentic Test Harness
 *
 * Provides:
 * - Database test utilities
 * - API client helpers
 * - Mock data generators
 * - Test environment configuration
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

// Custom error class for API errors with status code
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Test environment configuration
export interface TestEnvironment {
  apiBaseUrl: string;
  uiBaseUrl: string;
  mcpProxyUrl: string;
  databaseUrl: string;
  redisUrl: string;
  testApiKey: string;
  testUserId: string;
  isDocker: boolean;
  isHelm: boolean;
}

export const getTestEnv = (): TestEnvironment => {
  const isDocker = process.env.TEST_ENV === 'docker';
  const isHelm = process.env.TEST_ENV === 'helm';

  return {
    apiBaseUrl: process.env.TEST_API_URL || 'http://localhost:8000',
    uiBaseUrl: process.env.TEST_UI_URL || 'http://localhost:5173',
    mcpProxyUrl: process.env.TEST_MCP_URL || 'http://localhost:8090',
    databaseUrl: process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/openagentic_test',
    redisUrl: process.env.TEST_REDIS_URL || 'redis://localhost:6379',
    testApiKey: process.env.TEST_API_KEY || 'oa_test_key_for_testing_only_not_real',
    testUserId: process.env.TEST_USER_ID || 'test-user-id',
    isDocker,
    isHelm
  };
};

// API client for testing
export class TestAPIClient {
  private baseUrl: string;
  private apiKey: string;
  private token?: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  setToken(token: string) {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    } else {
      headers['X-API-Key'] = this.apiKey;
    }

    return headers;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    if (!response.ok) {
      throw new APIError(`API GET ${path} failed: ${response.status} ${response.statusText}`, response.status, response.statusText);
    }
    return response.json();
  }

  async post<T>(path: string, body: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new APIError(`API POST ${path} failed: ${response.status} ${response.statusText}`, response.status, response.statusText);
    }
    return response.json();
  }

  async stream(path: string, body: any): Promise<ReadableStream<Uint8Array>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new APIError(`API STREAM ${path} failed: ${response.status} ${response.statusText}`, response.status, response.statusText);
    }
    return response.body!;
  }

  async delete(path: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!response.ok) {
      throw new APIError(`API DELETE ${path} failed: ${response.status} ${response.statusText}`, response.status, response.statusText);
    }
  }
}

// Mock data generators
export const mockData = {
  generateUserId: () => `test_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  generateSessionId: () => `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  generateEmail: () => `test_${Date.now()}@example.com`,

  createTestUser: () => ({
    id: mockData.generateUserId(),
    email: mockData.generateEmail(),
    name: 'Test User',
    isAdmin: false,
    groups: ['users']
  }),

  createTestSession: (userId: string) => ({
    id: mockData.generateSessionId(),
    userId,
    title: 'Test Chat Session',
    model: 'gpt-oss'
  }),

  createTestMessage: (content: string) => ({
    role: 'user' as const,
    content
  }),

  // Test prompts for various scenarios
  testPrompts: {
    simple: 'What is 2+2?',
    complex: 'Analyze the current state of cloud computing and provide a detailed breakdown of the major providers.',
    toolRequired: 'Search the web for the latest news about AI.',
    imageGen: 'Generate an image of a sunset over mountains.',
    codeReview: 'Review this code and suggest improvements: function add(a,b) { return a+b; }',
    memoryTest: 'Remember that my name is TestUser for future conversations.',
    flowiseWorkflow: 'Create a simple workflow that processes user input.',
    adminAction: 'List all users in the system.'
  }
};

// Test container management
let containers: StartedTestContainer[] = [];

export const startTestContainers = async () => {
  // Only start containers if not using external Docker/Helm deployment
  const env = getTestEnv();
  if (env.isDocker || env.isHelm) {
    console.log('Using external deployment, skipping container startup');
    return;
  }

  console.log('Starting test containers...');

  // PostgreSQL
  const postgres = await new GenericContainer('postgres:15')
    .withEnvironment({
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgres',
      POSTGRES_DB: 'openagentic_test'
    })
    .withExposedPorts(5432)
    .start();
  containers.push(postgres);

  // Redis
  const redis = await new GenericContainer('redis:7')
    .withExposedPorts(6379)
    .start();
  containers.push(redis);

  console.log('Test containers started');

  return {
    postgresPort: postgres.getMappedPort(5432),
    redisPort: redis.getMappedPort(6379)
  };
};

export const stopTestContainers = async () => {
  console.log('Stopping test containers...');
  for (const container of containers) {
    await container.stop();
  }
  containers = [];
  console.log('Test containers stopped');
};

// Global hooks
beforeAll(async () => {
  console.log('Setting up test environment...');
});

afterAll(async () => {
  console.log('Cleaning up test environment...');
});
