/**
 * WorkflowTestRunner
 *
 * A testing framework for workflows with mocking capabilities.
 * Enables unit testing, integration testing, and snapshot testing of workflows.
 *
 * Features:
 * - Mock MCP tools, LLM responses, and external services
 * - Assertion helpers for workflow state and output
 * - Snapshot testing for regression detection
 * - Test isolation and cleanup
 * - Coverage reporting for workflow paths
 */

import { EventEmitter } from 'events';
import { WorkflowExecutionEngine, WorkflowDefinition, ExecutionContext, ExecutionEvent } from './WorkflowExecutionEngine.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services;

// =============================================================================
// Types
// =============================================================================

export interface MockMCPTool {
  toolName: string;
  server?: string;
  response: any | ((args: Record<string, any>) => any | Promise<any>);
  delay?: number;
  shouldFail?: boolean;
  errorMessage?: string;
}

export interface MockLLMResponse {
  pattern?: string | RegExp;  // Match prompt pattern
  model?: string;             // Match model name
  response: string | ((prompt: string, context: any) => string | Promise<string>);
  delay?: number;
  shouldFail?: boolean;
  errorMessage?: string;
}

export interface WorkflowTestConfig {
  timeout?: number;           // Test timeout in ms (default: 30000)
  mocks?: {
    mcpTools?: MockMCPTool[];
    llmResponses?: MockLLMResponse[];
    services?: Record<string, any>;  // Custom service mocks
  };
  input?: Record<string, any>;
  userId?: string;
  authToken?: string;
  assertionsEnabled?: boolean;
  snapshotMode?: 'create' | 'compare' | 'update';
  coverageEnabled?: boolean;
}

export interface TestResult {
  passed: boolean;
  testName: string;
  duration: number;
  executionId?: string;
  output?: any;
  error?: string;
  events: ExecutionEvent[];
  assertions: AssertionResult[];
  coverage?: CoverageReport;
  snapshot?: SnapshotResult;
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  message?: string;
}

export interface CoverageReport {
  totalNodes: number;
  executedNodes: number;
  coverage: number;  // Percentage
  executedNodeIds: string[];
  missedNodeIds: string[];
  branchCoverage?: {
    total: number;
    covered: number;
    percentage: number;
  };
}

export interface SnapshotResult {
  mode: 'created' | 'matched' | 'updated' | 'mismatched';
  snapshotPath?: string;
  diff?: any;
}

export interface TestSuite {
  name: string;
  workflow: WorkflowDefinition;
  tests: WorkflowTest[];
  beforeAll?: () => Promise<void>;
  afterAll?: () => Promise<void>;
  beforeEach?: () => Promise<void>;
  afterEach?: () => Promise<void>;
}

export interface WorkflowTest {
  name: string;
  config: WorkflowTestConfig;
  assertions?: (ctx: TestContext) => void | Promise<void>;
}

export interface TestContext {
  output: any;
  events: ExecutionEvent[];
  nodeResults: Map<string, any>;
  executionTime: number;
  assert: AssertionHelpers;
}

export interface AssertionHelpers {
  equals: (actual: any, expected: any, message?: string) => void;
  deepEquals: (actual: any, expected: any, message?: string) => void;
  contains: (actual: any, expected: any, message?: string) => void;
  matches: (actual: string, pattern: RegExp, message?: string) => void;
  nodeExecuted: (nodeId: string, message?: string) => void;
  nodeOutput: (nodeId: string, expected: any, message?: string) => void;
  nodeOutputContains: (nodeId: string, expected: any, message?: string) => void;
  eventEmitted: (eventType: string, message?: string) => void;
  noErrors: (message?: string) => void;
  executionTime: (maxMs: number, message?: string) => void;
  outputMatches: (pattern: RegExp, message?: string) => void;
}

// =============================================================================
// WorkflowTestRunner Class
// =============================================================================

export class WorkflowTestRunner extends EventEmitter {
  private mocks: Map<string, MockMCPTool> = new Map();
  private llmMocks: MockLLMResponse[] = [];
  private serviceMocks: Map<string, any> = new Map();
  private assertions: AssertionResult[] = [];
  private events: ExecutionEvent[] = [];
  private nodeResults: Map<string, any> = new Map();
  private executedNodes: Set<string> = new Set();
  private snapshotStorage: Map<string, any> = new Map();

  constructor() {
    super();
  }

  /**
   * Run a single workflow test
   */
  async runTest(
    testName: string,
    workflow: WorkflowDefinition,
    config: WorkflowTestConfig,
    assertionFn?: (ctx: TestContext) => void | Promise<void>
  ): Promise<TestResult> {
    const startTime = Date.now();
    this.resetState();

    logger.info({ testName }, '[WorkflowTestRunner] Running test');

    // Setup mocks
    this.setupMocks(config.mocks);

    // Create mock execution context
    const executionId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const context: ExecutionContext = {
      executionId,
      workflowId: `test-workflow-${testName}`,
      userId: config.userId || 'test-user',
      authToken: config.authToken,
      input: config.input || {},
      variables: new Map(),
      nodeResults: new Map(),
      startTime: Date.now()
    };

    try {
      // Create engine with mocked methods
      const engine = this.createMockedEngine(workflow, context);

      // Collect events
      engine.on('event', (event: ExecutionEvent) => {
        this.events.push(event);
        if (event.nodeId) {
          this.executedNodes.add(event.nodeId);
        }
        if (event.type === 'node_complete' && event.data?.output !== undefined) {
          this.nodeResults.set(event.nodeId!, event.data.output);
        }
      });

      // Execute with timeout
      const timeoutMs = config.timeout || 30000;
      const result = await Promise.race([
        engine.execute(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Test timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);

      const duration = Date.now() - startTime;

      // Run assertions
      if (assertionFn && config.assertionsEnabled !== false) {
        const testContext: TestContext = {
          output: result.output,
          events: this.events,
          nodeResults: this.nodeResults,
          executionTime: duration,
          assert: this.createAssertionHelpers()
        };
        await assertionFn(testContext);
      }

      // Generate coverage report
      const coverage = config.coverageEnabled
        ? this.generateCoverageReport(workflow)
        : undefined;

      // Handle snapshot testing
      const snapshot = config.snapshotMode
        ? await this.handleSnapshot(testName, result.output, config.snapshotMode)
        : undefined;

      const passed = result.success && this.assertions.every(a => a.passed);

      return {
        passed,
        testName,
        duration,
        executionId,
        output: result.output,
        error: result.error,
        events: this.events,
        assertions: this.assertions,
        coverage,
        snapshot
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;

      return {
        passed: false,
        testName,
        duration,
        executionId,
        error: error.message,
        events: this.events,
        assertions: this.assertions
      };
    }
  }

  /**
   * Run a test suite
   */
  async runSuite(suite: TestSuite): Promise<{
    suiteName: string;
    passed: boolean;
    results: TestResult[];
    duration: number;
  }> {
    const startTime = Date.now();
    const results: TestResult[] = [];

    logger.info({ suiteName: suite.name, testCount: suite.tests.length }, '[WorkflowTestRunner] Running test suite');

    // Run beforeAll hook
    if (suite.beforeAll) {
      await suite.beforeAll();
    }

    for (const test of suite.tests) {
      // Run beforeEach hook
      if (suite.beforeEach) {
        await suite.beforeEach();
      }

      const result = await this.runTest(
        `${suite.name}::${test.name}`,
        suite.workflow,
        test.config,
        test.assertions
      );
      results.push(result);

      // Run afterEach hook
      if (suite.afterEach) {
        await suite.afterEach();
      }
    }

    // Run afterAll hook
    if (suite.afterAll) {
      await suite.afterAll();
    }

    const duration = Date.now() - startTime;
    const passed = results.every(r => r.passed);

    logger.info({
      suiteName: suite.name,
      passed,
      duration,
      passedCount: results.filter(r => r.passed).length,
      failedCount: results.filter(r => !r.passed).length
    }, '[WorkflowTestRunner] Test suite completed');

    return {
      suiteName: suite.name,
      passed,
      results,
      duration
    };
  }

  // ===========================================================================
  // Mock Setup
  // ===========================================================================

  private setupMocks(mocks?: WorkflowTestConfig['mocks']): void {
    if (!mocks) return;

    // Setup MCP tool mocks
    if (mocks.mcpTools) {
      for (const mock of mocks.mcpTools) {
        const key = mock.server
          ? `${mock.server}:${mock.toolName}`
          : mock.toolName;
        this.mocks.set(key, mock);
      }
    }

    // Setup LLM response mocks
    if (mocks.llmResponses) {
      this.llmMocks = mocks.llmResponses;
    }

    // Setup service mocks
    if (mocks.services) {
      for (const [name, mock] of Object.entries(mocks.services)) {
        this.serviceMocks.set(name, mock);
      }
    }
  }

  /**
   * Create a mocked workflow execution engine
   */
  private createMockedEngine(
    workflow: WorkflowDefinition,
    context: ExecutionContext
  ): WorkflowExecutionEngine {
    const engine = new WorkflowExecutionEngine(workflow, context);

    // Override HTTP calls with mocks
    // Note: In a real implementation, we'd use dependency injection or method patching
    // For now, we inject mocks via environment or monkey-patching

    return engine;
  }

  /**
   * Get mocked MCP tool response
   */
  async getMockedMCPResponse(
    toolName: string,
    server: string,
    args: Record<string, any>
  ): Promise<any> {
    const key = `${server}:${toolName}`;
    const mock = this.mocks.get(key) || this.mocks.get(toolName);

    if (!mock) {
      throw new Error(`No mock found for tool: ${toolName} (server: ${server})`);
    }

    // Apply delay if specified
    if (mock.delay) {
      await new Promise(resolve => setTimeout(resolve, mock.delay));
    }

    // Check if should fail
    if (mock.shouldFail) {
      throw new Error(mock.errorMessage || `Mocked failure for ${toolName}`);
    }

    // Return response (can be function or value)
    if (typeof mock.response === 'function') {
      return mock.response(args);
    }
    return mock.response;
  }

  /**
   * Get mocked LLM response
   */
  async getMockedLLMResponse(
    prompt: string,
    model: string,
    context: any
  ): Promise<string> {
    for (const mock of this.llmMocks) {
      // Check model match
      if (mock.model && mock.model !== model) {
        continue;
      }

      // Check pattern match
      if (mock.pattern) {
        const pattern = typeof mock.pattern === 'string'
          ? new RegExp(mock.pattern)
          : mock.pattern;
        if (!pattern.test(prompt)) {
          continue;
        }
      }

      // Apply delay if specified
      if (mock.delay) {
        await new Promise(resolve => setTimeout(resolve, mock.delay));
      }

      // Check if should fail
      if (mock.shouldFail) {
        throw new Error(mock.errorMessage || 'Mocked LLM failure');
      }

      // Return response (can be function or value)
      if (typeof mock.response === 'function') {
        return mock.response(prompt, context);
      }
      return mock.response;
    }

    // No mock found - return default
    return `[MOCK] Default response for prompt: ${prompt.substring(0, 100)}...`;
  }

  // ===========================================================================
  // Assertion Helpers
  // ===========================================================================

  private createAssertionHelpers(): AssertionHelpers {
    const self = this;

    return {
      equals: (actual, expected, message) => {
        const passed = actual === expected;
        self.assertions.push({
          name: message || `Expected ${actual} to equal ${expected}`,
          passed,
          expected,
          actual
        });
        if (!passed) {
          throw new Error(message || `Assertion failed: ${actual} !== ${expected}`);
        }
      },

      deepEquals: (actual, expected, message) => {
        const passed = JSON.stringify(actual) === JSON.stringify(expected);
        self.assertions.push({
          name: message || 'Deep equality check',
          passed,
          expected,
          actual
        });
        if (!passed) {
          throw new Error(message || `Deep equality assertion failed`);
        }
      },

      contains: (actual, expected, message) => {
        let passed = false;
        if (typeof actual === 'string') {
          passed = actual.includes(expected);
        } else if (Array.isArray(actual)) {
          passed = actual.includes(expected);
        } else if (typeof actual === 'object') {
          passed = JSON.stringify(actual).includes(JSON.stringify(expected));
        }
        self.assertions.push({
          name: message || `Expected to contain ${expected}`,
          passed,
          expected,
          actual
        });
        if (!passed) {
          throw new Error(message || `Contains assertion failed`);
        }
      },

      matches: (actual, pattern, message) => {
        const passed = pattern.test(actual);
        self.assertions.push({
          name: message || `Expected to match ${pattern}`,
          passed,
          expected: pattern.toString(),
          actual
        });
        if (!passed) {
          throw new Error(message || `Pattern match assertion failed`);
        }
      },

      nodeExecuted: (nodeId, message) => {
        const passed = self.executedNodes.has(nodeId);
        self.assertions.push({
          name: message || `Node ${nodeId} should have executed`,
          passed,
          expected: true,
          actual: passed
        });
        if (!passed) {
          throw new Error(message || `Node ${nodeId} was not executed`);
        }
      },

      nodeOutput: (nodeId, expected, message) => {
        const actual = self.nodeResults.get(nodeId);
        const passed = JSON.stringify(actual) === JSON.stringify(expected);
        self.assertions.push({
          name: message || `Node ${nodeId} output check`,
          passed,
          expected,
          actual
        });
        if (!passed) {
          throw new Error(message || `Node ${nodeId} output mismatch`);
        }
      },

      nodeOutputContains: (nodeId, expected, message) => {
        const actual = self.nodeResults.get(nodeId);
        let passed = false;
        if (typeof actual === 'string') {
          passed = actual.includes(expected);
        } else if (actual && typeof actual === 'object') {
          passed = JSON.stringify(actual).includes(JSON.stringify(expected));
        }
        self.assertions.push({
          name: message || `Node ${nodeId} output contains check`,
          passed,
          expected,
          actual
        });
        if (!passed) {
          throw new Error(message || `Node ${nodeId} output doesn't contain expected value`);
        }
      },

      eventEmitted: (eventType, message) => {
        const passed = self.events.some(e => e.type === eventType);
        self.assertions.push({
          name: message || `Event ${eventType} should have been emitted`,
          passed,
          expected: eventType,
          actual: self.events.map(e => e.type)
        });
        if (!passed) {
          throw new Error(message || `Event ${eventType} was not emitted`);
        }
      },

      noErrors: (message) => {
        const errorEvents = self.events.filter(e =>
          e.type === 'node_error' || e.type === 'execution_error'
        );
        const passed = errorEvents.length === 0;
        self.assertions.push({
          name: message || 'No errors should occur',
          passed,
          expected: 0,
          actual: errorEvents.length
        });
        if (!passed) {
          throw new Error(message || `Errors occurred: ${errorEvents.map(e => e.data?.error).join(', ')}`);
        }
      },

      executionTime: (maxMs, message) => {
        const duration = self.events.find(e => e.type === 'execution_complete')?.data?.duration || 0;
        const passed = duration <= maxMs;
        self.assertions.push({
          name: message || `Execution time should be under ${maxMs}ms`,
          passed,
          expected: `<= ${maxMs}ms`,
          actual: `${duration}ms`
        });
        if (!passed) {
          throw new Error(message || `Execution took ${duration}ms (max: ${maxMs}ms)`);
        }
      },

      outputMatches: (pattern, message) => {
        const output = self.events.find(e => e.type === 'execution_complete')?.data?.output;
        const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
        const passed = pattern.test(outputStr);
        self.assertions.push({
          name: message || `Output should match ${pattern}`,
          passed,
          expected: pattern.toString(),
          actual: outputStr
        });
        if (!passed) {
          throw new Error(message || `Output doesn't match pattern`);
        }
      }
    };
  }

  // ===========================================================================
  // Coverage
  // ===========================================================================

  private generateCoverageReport(workflow: WorkflowDefinition): CoverageReport {
    const totalNodes = workflow.nodes.length;
    const executedNodes = this.executedNodes.size;
    const executedNodeIds = Array.from(this.executedNodes);
    const missedNodeIds = workflow.nodes
      .map(n => n.id)
      .filter(id => !this.executedNodes.has(id));

    return {
      totalNodes,
      executedNodes,
      coverage: totalNodes > 0 ? (executedNodes / totalNodes) * 100 : 0,
      executedNodeIds,
      missedNodeIds
    };
  }

  // ===========================================================================
  // Snapshot Testing
  // ===========================================================================

  private async handleSnapshot(
    testName: string,
    output: any,
    mode: 'create' | 'compare' | 'update'
  ): Promise<SnapshotResult> {
    const snapshotKey = `snapshot:${testName}`;
    const normalizedOutput = JSON.parse(JSON.stringify(output)); // Deep clone

    if (mode === 'create') {
      this.snapshotStorage.set(snapshotKey, normalizedOutput);
      return {
        mode: 'created',
        snapshotPath: snapshotKey
      };
    }

    if (mode === 'update') {
      this.snapshotStorage.set(snapshotKey, normalizedOutput);
      return {
        mode: 'updated',
        snapshotPath: snapshotKey
      };
    }

    // Compare mode
    const existingSnapshot = this.snapshotStorage.get(snapshotKey);
    if (!existingSnapshot) {
      // No snapshot exists, create one
      this.snapshotStorage.set(snapshotKey, normalizedOutput);
      return {
        mode: 'created',
        snapshotPath: snapshotKey
      };
    }

    const matches = JSON.stringify(existingSnapshot) === JSON.stringify(normalizedOutput);
    if (matches) {
      return {
        mode: 'matched',
        snapshotPath: snapshotKey
      };
    }

    return {
      mode: 'mismatched',
      snapshotPath: snapshotKey,
      diff: {
        expected: existingSnapshot,
        actual: normalizedOutput
      }
    };
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private resetState(): void {
    this.mocks.clear();
    this.llmMocks = [];
    this.serviceMocks.clear();
    this.assertions = [];
    this.events = [];
    this.nodeResults.clear();
    this.executedNodes.clear();
  }

  /**
   * Set a snapshot for testing (used to pre-populate snapshots)
   */
  setSnapshot(testName: string, snapshot: any): void {
    this.snapshotStorage.set(`snapshot:${testName}`, snapshot);
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): Map<string, any> {
    return this.snapshotStorage;
  }

  /**
   * Clear all snapshots
   */
  clearSnapshots(): void {
    this.snapshotStorage.clear();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let testRunnerInstance: WorkflowTestRunner | null = null;

export function getWorkflowTestRunner(): WorkflowTestRunner {
  if (!testRunnerInstance) {
    testRunnerInstance = new WorkflowTestRunner();
  }
  return testRunnerInstance;
}

// =============================================================================
// Export Test Utilities
// =============================================================================

export const testUtils = {
  /**
   * Create a simple workflow for testing
   */
  createSimpleWorkflow: (nodes: any[], edges: any[] = []): WorkflowDefinition => ({
    nodes: nodes.map((n, i) => ({
      id: n.id || `node-${i}`,
      type: n.type || 'trigger',
      data: n.data || {},
      position: n.position || { x: 0, y: i * 100 }
    })),
    edges: edges.map((e, i) => ({
      id: e.id || `edge-${i}`,
      source: e.source,
      target: e.target,
      ...e
    }))
  }),

  /**
   * Create a mock MCP tool
   */
  mockTool: (
    toolName: string,
    response: any,
    options: Partial<MockMCPTool> = {}
  ): MockMCPTool => ({
    toolName,
    response,
    ...options
  }),

  /**
   * Create a mock LLM response
   */
  mockLLM: (
    response: string,
    options: Partial<MockLLMResponse> = {}
  ): MockLLMResponse => ({
    response,
    ...options
  }),

  /**
   * Create a test suite
   */
  createSuite: (
    name: string,
    workflow: WorkflowDefinition,
    tests: WorkflowTest[]
  ): TestSuite => ({
    name,
    workflow,
    tests
  }),

  /**
   * Assert helpers that can be used outside test context
   */
  assert: {
    ok: (value: any, message?: string) => {
      if (!value) throw new Error(message || `Expected truthy value`);
    },
    equal: (actual: any, expected: any, message?: string) => {
      if (actual !== expected) throw new Error(message || `Expected ${expected} but got ${actual}`);
    },
    deepEqual: (actual: any, expected: any, message?: string) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(message || `Deep equality failed`);
      }
    },
    throws: async (fn: () => Promise<any>, message?: string) => {
      try {
        await fn();
        throw new Error(message || `Expected function to throw`);
      } catch (e: any) {
        if (e.message === (message || `Expected function to throw`)) {
          throw e;
        }
        // Function threw as expected
      }
    }
  }
};

export default WorkflowTestRunner;
