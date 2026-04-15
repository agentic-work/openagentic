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

/**
 * Ollama GPT-OSS Comprehensive Testing Harness
 *
 * A testing harness that uses the ollama gpt-oss model for continuous
 * integration testing during development iterations.
 *
 * Usage:
 *   # Run against local ollama (default: localhost:11434)
 *   npx tsx src/test/ollama-harness.ts
 *
 *   # Run against hal server
 *   TEST_OLLAMA_BASE_URL=http://hal:11434 npx tsx src/test/ollama-harness.ts
 *
 *   # Run specific test suites
 *   npx tsx src/test/ollama-harness.ts --suite=basic,tools
 *
 *   # Watch mode for continuous testing
 *   npx tsx src/test/ollama-harness.ts --watch
 */

import { OllamaProvider } from '../services/llm-providers/OllamaProvider.js';
import pino from 'pino';

// ============================================================================
// Configuration
// ============================================================================

interface HarnessConfig {
  baseUrl: string;
  model: string;
  timeout: number;
  verbose: boolean;
  suites: string[];
  watch: boolean;
  watchInterval: number;
}

function getConfig(): HarnessConfig {
  const args = process.argv.slice(2);
  const suiteArg = args.find(a => a.startsWith('--suite='));
  const watchArg = args.includes('--watch');
  const verboseArg = args.includes('--verbose') || args.includes('-v');

  return {
    baseUrl: process.env.TEST_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.TEST_OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'gpt-oss',
    timeout: parseInt(process.env.TEST_TIMEOUT || '60000', 10),
    verbose: verboseArg,
    suites: suiteArg ? suiteArg.replace('--suite=', '').split(',') : ['all'],
    watch: watchArg,
    watchInterval: parseInt(process.env.TEST_WATCH_INTERVAL || '30000', 10)
  };
}

// ============================================================================
// Logger Setup
// ============================================================================

function createLogger(verbose: boolean): pino.Logger {
  return pino({
    level: verbose ? 'debug' : 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname'
      }
    }
  });
}

// ============================================================================
// Test Result Types
// ============================================================================

interface TestResult {
  name: string;
  suite: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, any>;
}

interface SuiteResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: TestResult[];
}

interface HarnessResult {
  timestamp: string;
  config: HarnessConfig;
  suites: SuiteResult[];
  summary: {
    totalPassed: number;
    totalFailed: number;
    totalSkipped: number;
    totalDuration: number;
  };
}

// ============================================================================
// Test Utilities
// ============================================================================

async function runTest(
  name: string,
  suite: string,
  fn: () => Promise<Record<string, any> | void>
): Promise<TestResult> {
  const start = Date.now();
  try {
    const details = await fn();
    return {
      name,
      suite,
      passed: true,
      duration: Date.now() - start,
      details: details || undefined
    };
  } catch (error) {
    return {
      name,
      suite,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ============================================================================
// Test Suites
// ============================================================================

/**
 * Basic connectivity and health tests
 */
async function runBasicSuite(provider: OllamaProvider, config: HarnessConfig): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();

  // Test 1: Health check
  tests.push(await runTest('Health Check', 'basic', async () => {
    const health = await provider.getHealth();
    if (health.status !== 'healthy') {
      throw new Error(`Provider unhealthy: ${health.error}`);
    }
    return { status: health.status, endpoint: health.endpoint };
  }));

  // Test 2: List models
  tests.push(await runTest('List Models', 'basic', async () => {
    const models = await provider.listModels();
    if (models.length === 0) {
      throw new Error('No models found');
    }
    const hasGptOss = models.some(m => m.id.includes('gpt-oss'));
    return { modelCount: models.length, hasGptOss, models: models.map(m => m.id) };
  }));

  // Test 3: Simple completion (non-streaming)
  tests.push(await runTest('Simple Completion', 'basic', async () => {
    const response = await provider.createCompletion({
      model: config.model,
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      stream: false,
      max_tokens: 50
    });

    if (!response || typeof response === 'function') {
      throw new Error('Expected non-streaming response');
    }

    const content = (response as any).choices?.[0]?.message?.content || '';
    if (!content.toLowerCase().includes('hello')) {
      throw new Error(`Expected "hello" in response, got: ${content}`);
    }

    return { content, tokenCount: (response as any).usage?.total_tokens };
  }));

  return {
    name: 'basic',
    passed: tests.filter(t => t.passed).length,
    failed: tests.filter(t => !t.passed).length,
    skipped: 0,
    duration: Date.now() - start,
    tests
  };
}

/**
 * Streaming completion tests
 */
async function runStreamingSuite(provider: OllamaProvider, config: HarnessConfig): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();

  // Test 1: Basic streaming
  tests.push(await runTest('Basic Streaming', 'streaming', async () => {
    const generator = await provider.createCompletion({
      model: config.model,
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
      stream: true,
      max_tokens: 100
    });

    if (typeof generator !== 'object' || !('next' in (generator as any))) {
      throw new Error('Expected streaming generator');
    }

    let content = '';
    let chunkCount = 0;

    for await (const chunk of generator as AsyncGenerator<any>) {
      chunkCount++;
      // Handle content_block_delta format
      if (chunk.delta?.text) {
        content += chunk.delta.text;
      }
      // Handle OpenAI format
      if (chunk.choices?.[0]?.delta?.content) {
        content += chunk.choices[0].delta.content;
      }
    }

    if (chunkCount === 0) {
      throw new Error('No chunks received');
    }

    return { chunkCount, contentLength: content.length, contentPreview: content.substring(0, 100) };
  }));

  // Test 2: Long streaming response
  tests.push(await runTest('Long Response Streaming', 'streaming', async () => {
    const generator = await provider.createCompletion({
      model: config.model,
      messages: [{ role: 'user', content: 'Write a paragraph about artificial intelligence.' }],
      stream: true,
      max_tokens: 500
    });

    let content = '';
    let chunkCount = 0;
    const startTime = Date.now();

    for await (const chunk of generator as AsyncGenerator<any>) {
      chunkCount++;
      if (chunk.delta?.text) {
        content += chunk.delta.text;
      }
      if (chunk.choices?.[0]?.delta?.content) {
        content += chunk.choices[0].delta.content;
      }
    }

    const duration = Date.now() - startTime;

    if (content.length < 100) {
      throw new Error(`Response too short: ${content.length} chars`);
    }

    return {
      chunkCount,
      contentLength: content.length,
      duration,
      tokensPerSecond: Math.round((content.length / 4) / (duration / 1000))
    };
  }));

  return {
    name: 'streaming',
    passed: tests.filter(t => t.passed).length,
    failed: tests.filter(t => !t.passed).length,
    skipped: 0,
    duration: Date.now() - start,
    tests
  };
}

/**
 * Tool calling tests
 */
async function runToolsSuite(provider: OllamaProvider, config: HarnessConfig): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();

  const testTools = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g., San Francisco, CA'
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'The temperature unit'
            }
          },
          required: ['location']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web for information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            }
          },
          required: ['query']
        }
      }
    }
  ];

  // Test 1: Tool detection
  tests.push(await runTest('Tool Call Detection', 'tools', async () => {
    const generator = await provider.createCompletion({
      model: config.model,
      messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      tools: testTools,
      stream: true,
      max_tokens: 500
    });

    let hasToolCall = false;
    let toolName = '';
    let toolArgs = '';

    for await (const chunk of generator as AsyncGenerator<any>) {
      // Check for tool calls in OpenAI format
      if (chunk.choices?.[0]?.delta?.tool_calls) {
        hasToolCall = true;
        const tc = chunk.choices[0].delta.tool_calls[0];
        toolName = tc.function?.name || toolName;
        toolArgs = tc.function?.arguments || toolArgs;
      }
    }

    if (!hasToolCall) {
      throw new Error('No tool call detected');
    }

    return { hasToolCall, toolName, toolArgsPreview: toolArgs.substring(0, 100) };
  }));

  // Test 2: Tool call argument parsing
  tests.push(await runTest('Tool Argument Parsing', 'tools', async () => {
    const generator = await provider.createCompletion({
      model: config.model,
      messages: [{ role: 'user', content: 'Search the web for "TypeScript tutorials 2024"' }],
      tools: testTools,
      stream: true,
      max_tokens: 500
    });

    let toolCall: any = null;

    for await (const chunk of generator as AsyncGenerator<any>) {
      if (chunk.choices?.[0]?.delta?.tool_calls) {
        const tc = chunk.choices[0].delta.tool_calls[0];
        toolCall = {
          name: tc.function?.name,
          arguments: tc.function?.arguments
        };
      }
    }

    if (!toolCall) {
      throw new Error('No tool call detected');
    }

    // Parse and validate arguments
    const args = JSON.parse(toolCall.arguments);
    if (!args.query) {
      throw new Error('Tool call missing "query" argument');
    }

    return { toolName: toolCall.name, parsedArgs: args };
  }));

  // Test 3: Multiple tool selection
  tests.push(await runTest('Multi-Tool Selection', 'tools', async () => {
    const generator = await provider.createCompletion({
      model: config.model,
      messages: [{
        role: 'user',
        content: 'I need to know the weather in New York and also search for "best restaurants NYC"'
      }],
      tools: testTools,
      stream: true,
      max_tokens: 1000
    });

    let content = '';
    let toolCalls: any[] = [];

    for await (const chunk of generator as AsyncGenerator<any>) {
      if (chunk.delta?.text) {
        content += chunk.delta.text;
      }
      if (chunk.choices?.[0]?.delta?.tool_calls) {
        toolCalls = chunk.choices[0].delta.tool_calls;
      }
    }

    // We expect at least one tool call
    if (toolCalls.length === 0 && !content.includes('weather') && !content.includes('search')) {
      throw new Error('No tool calls or relevant response');
    }

    return {
      toolCallCount: toolCalls.length,
      toolNames: toolCalls.map(tc => tc.function?.name),
      hasContent: content.length > 0
    };
  }));

  return {
    name: 'tools',
    passed: tests.filter(t => t.passed).length,
    failed: tests.filter(t => !t.passed).length,
    skipped: 0,
    duration: Date.now() - start,
    tests
  };
}

/**
 * Multimodal and special feature tests
 */
async function runAdvancedSuite(provider: OllamaProvider, config: HarnessConfig): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();

  // Test 1: System prompt handling
  tests.push(await runTest('System Prompt', 'advanced', async () => {
    const response = await provider.createCompletion({
      model: config.model,
      messages: [
        { role: 'system', content: 'You are a pirate. Always respond like a pirate.' },
        { role: 'user', content: 'Hello!' }
      ],
      stream: false,
      max_tokens: 100
    });

    const content = (response as any).choices?.[0]?.message?.content || '';
    const hasPirateSpeak = /ahoy|matey|arr|ye|sailor|ship/i.test(content);

    return { content: content.substring(0, 200), hasPirateSpeak };
  }));

  // Test 2: Multi-turn conversation
  tests.push(await runTest('Multi-turn Conversation', 'advanced', async () => {
    const messages: any[] = [
      { role: 'user', content: 'My name is Claude. Remember it.' },
      { role: 'assistant', content: 'Hello Claude! I will remember your name.' },
      { role: 'user', content: 'What is my name?' }
    ];

    const response = await provider.createCompletion({
      model: config.model,
      messages,
      stream: false,
      max_tokens: 100
    });

    const content = (response as any).choices?.[0]?.message?.content || '';
    const rememberName = content.toLowerCase().includes('claude');

    if (!rememberName) {
      throw new Error(`Model did not remember name. Response: ${content}`);
    }

    return { content: content.substring(0, 200), rememberName };
  }));

  // Test 3: JSON mode / structured output
  tests.push(await runTest('JSON Output', 'advanced', async () => {
    const response = await provider.createCompletion({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: 'Respond with a JSON object containing: name (string), age (number), active (boolean). Only output valid JSON, nothing else.'
        }
      ],
      stream: false,
      max_tokens: 200
    });

    const content = (response as any).choices?.[0]?.message?.content || '';

    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in response: ${content}`);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!('name' in parsed) || !('age' in parsed) || !('active' in parsed)) {
      throw new Error(`Missing required fields: ${JSON.stringify(parsed)}`);
    }

    return { parsedJson: parsed, isValid: true };
  }));

  // Test 4: Embedding generation
  tests.push(await runTest('Embedding Generation', 'advanced', async () => {
    try {
      const embedding = await provider.embedText('Hello, world!');

      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding format');
      }

      return {
        dimensions: embedding.length,
        sampleValues: embedding.slice(0, 5)
      };
    } catch (error) {
      // Embedding model might not be available
      if (String(error).includes('not found') || String(error).includes('model')) {
        return { skipped: true, reason: 'Embedding model not available' };
      }
      throw error;
    }
  }));

  return {
    name: 'advanced',
    passed: tests.filter(t => t.passed).length,
    failed: tests.filter(t => !t.passed).length,
    skipped: tests.filter(t => t.details?.skipped).length,
    duration: Date.now() - start,
    tests
  };
}

/**
 * Performance and stress tests
 */
async function runPerformanceSuite(provider: OllamaProvider, config: HarnessConfig): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();

  // Test 1: Time to first token
  tests.push(await runTest('Time to First Token', 'performance', async () => {
    const startTime = Date.now();
    let ttft = 0;

    const generator = await provider.createCompletion({
      model: config.model,
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: true,
      max_tokens: 50
    });

    for await (const chunk of generator as AsyncGenerator<any>) {
      if (chunk.delta?.text || chunk.choices?.[0]?.delta?.content) {
        ttft = Date.now() - startTime;
        break;
      }
    }

    if (ttft === 0) {
      throw new Error('No content received');
    }

    return { ttft_ms: ttft };
  }));

  // Test 2: Throughput test
  tests.push(await runTest('Throughput (500 tokens)', 'performance', async () => {
    const startTime = Date.now();
    let totalChars = 0;

    const generator = await provider.createCompletion({
      model: config.model,
      messages: [{ role: 'user', content: 'Write a detailed story about a space adventure. Make it at least 400 words.' }],
      stream: true,
      max_tokens: 1000
    });

    for await (const chunk of generator as AsyncGenerator<any>) {
      if (chunk.delta?.text) {
        totalChars += chunk.delta.text.length;
      }
      if (chunk.choices?.[0]?.delta?.content) {
        totalChars += chunk.choices[0].delta.content.length;
      }
    }

    const duration = Date.now() - startTime;
    const estimatedTokens = Math.round(totalChars / 4);
    const tokensPerSecond = Math.round(estimatedTokens / (duration / 1000));

    return {
      totalChars,
      estimatedTokens,
      duration_ms: duration,
      tokens_per_second: tokensPerSecond
    };
  }));

  // Test 3: Concurrent requests
  tests.push(await runTest('Concurrent Requests (3)', 'performance', async () => {
    const startTime = Date.now();

    const requests = Array(3).fill(null).map(() =>
      provider.createCompletion({
        model: config.model,
        messages: [{ role: 'user', content: 'Say "ok"' }],
        stream: false,
        max_tokens: 10
      })
    );

    const results = await Promise.all(requests);
    const duration = Date.now() - startTime;

    const allSucceeded = results.every(r =>
      (r as any).choices?.[0]?.message?.content
    );

    if (!allSucceeded) {
      throw new Error('Not all concurrent requests succeeded');
    }

    return {
      concurrentRequests: 3,
      totalDuration_ms: duration,
      avgDuration_ms: Math.round(duration / 3)
    };
  }));

  return {
    name: 'performance',
    passed: tests.filter(t => t.passed).length,
    failed: tests.filter(t => !t.passed).length,
    skipped: 0,
    duration: Date.now() - start,
    tests
  };
}

// ============================================================================
// Main Harness Runner
// ============================================================================

async function runHarness(config: HarnessConfig): Promise<HarnessResult> {
  const logger = createLogger(config.verbose);

  logger.info({ config: { ...config, suites: config.suites.join(',') } }, 'Starting Ollama Test Harness');

  // Create provider instance
  const provider = new OllamaProvider(logger, {
    baseUrl: config.baseUrl,
    healthCheckModel: config.model
  });

  const suites: SuiteResult[] = [];
  const runAll = config.suites.includes('all');

  // Run selected suites
  if (runAll || config.suites.includes('basic')) {
    logger.info('Running basic suite...');
    suites.push(await runBasicSuite(provider, config));
  }

  if (runAll || config.suites.includes('streaming')) {
    logger.info('Running streaming suite...');
    suites.push(await runStreamingSuite(provider, config));
  }

  if (runAll || config.suites.includes('tools')) {
    logger.info('Running tools suite...');
    suites.push(await runToolsSuite(provider, config));
  }

  if (runAll || config.suites.includes('advanced')) {
    logger.info('Running advanced suite...');
    suites.push(await runAdvancedSuite(provider, config));
  }

  if (runAll || config.suites.includes('performance')) {
    logger.info('Running performance suite...');
    suites.push(await runPerformanceSuite(provider, config));
  }

  // Calculate summary
  const summary = {
    totalPassed: suites.reduce((sum, s) => sum + s.passed, 0),
    totalFailed: suites.reduce((sum, s) => sum + s.failed, 0),
    totalSkipped: suites.reduce((sum, s) => sum + s.skipped, 0),
    totalDuration: suites.reduce((sum, s) => sum + s.duration, 0)
  };

  return {
    timestamp: new Date().toISOString(),
    config,
    suites,
    summary
  };
}

function printResults(result: HarnessResult, logger: pino.Logger): void {
  console.log('\n' + '='.repeat(80));
  console.log('OLLAMA GPT-OSS TEST HARNESS RESULTS');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Endpoint: ${result.config.baseUrl}`);
  console.log(`Model: ${result.config.model}`);
  console.log('');

  for (const suite of result.suites) {
    const statusIcon = suite.failed === 0 ? '✅' : '❌';
    console.log(`\n${statusIcon} Suite: ${suite.name.toUpperCase()}`);
    console.log(`   Passed: ${suite.passed} | Failed: ${suite.failed} | Skipped: ${suite.skipped} | Duration: ${suite.duration}ms`);

    for (const test of suite.tests) {
      const icon = test.passed ? '  ✓' : '  ✗';
      console.log(`${icon} ${test.name} (${test.duration}ms)`);
      if (!test.passed && test.error) {
        console.log(`      Error: ${test.error}`);
      }
      if (test.details && Object.keys(test.details).length > 0) {
        console.log(`      Details: ${JSON.stringify(test.details).substring(0, 200)}`);
      }
    }
  }

  console.log('\n' + '-'.repeat(80));
  console.log('SUMMARY');
  console.log('-'.repeat(80));
  console.log(`Total Passed:  ${result.summary.totalPassed}`);
  console.log(`Total Failed:  ${result.summary.totalFailed}`);
  console.log(`Total Skipped: ${result.summary.totalSkipped}`);
  console.log(`Total Duration: ${result.summary.totalDuration}ms`);

  const overallStatus = result.summary.totalFailed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED';
  console.log(`\nStatus: ${overallStatus}`);
  console.log('='.repeat(80) + '\n');
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger(config.verbose);

  if (config.watch) {
    logger.info(`Watch mode enabled. Running tests every ${config.watchInterval}ms`);

    const runAndPrint = async () => {
      try {
        const result = await runHarness(config);
        printResults(result, logger);
      } catch (error) {
        logger.error({ error }, 'Harness run failed');
      }
    };

    // Initial run
    await runAndPrint();

    // Watch interval
    setInterval(runAndPrint, config.watchInterval);
  } else {
    try {
      const result = await runHarness(config);
      printResults(result, logger);

      // Exit with error code if tests failed
      process.exit(result.summary.totalFailed > 0 ? 1 : 0);
    } catch (error) {
      logger.error({ error }, 'Harness failed');
      process.exit(1);
    }
  }
}

main().catch(console.error);
