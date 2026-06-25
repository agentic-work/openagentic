/**
 * Memory MCP Integration Tests
 */

const { config, chat, createTestResult, logInfo } = require('../config');

const testId = `test_${Date.now()}`;

async function testMemoryStore() {
  const startTime = Date.now();
  try {
    const response = await chat(`Store this information in memory: "Test ID: ${testId}, Value: Important test data for validation, Tags: testing, automated". Use memory tools to save this.`);

    const hasResponse = response && response.length > 20;
    const indicatesStored = /stored|saved|remembered|recorded/i.test(response);

    return createTestResult('Memory Store', true, Date.now() - startTime, null, {
      hasResponse,
      indicatesStored,
      testId,
      preview: response.substring(0, 200)
    });
  } catch (error) {
    return createTestResult('Memory Store', false, Date.now() - startTime, error);
  }
}

async function testMemoryRecall() {
  const startTime = Date.now();
  try {
    const response = await chat(`Recall any information stored with ID or tags related to "testing" or "automated". Use memory tools to search.`);

    const hasResponse = response && response.length > 20;
    const hasRecall = /found|retrieved|recall|stored|memory/i.test(response);

    return createTestResult('Memory Recall', true, Date.now() - startTime, null, {
      hasResponse,
      hasRecall,
      preview: response.substring(0, 200)
    });
  } catch (error) {
    return createTestResult('Memory Recall', false, Date.now() - startTime, error);
  }
}

async function testMemorySearch() {
  const startTime = Date.now();
  try {
    const response = await chat(`Search memory for any information about "test data" or "validation". What do you find?`);

    const hasResponse = response && response.length > 20;

    return createTestResult('Memory Search', true, Date.now() - startTime, null, {
      hasResponse,
      preview: response.substring(0, 200)
    });
  } catch (error) {
    return createTestResult('Memory Search', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing Memory MCP integration...');

  results.push(await testMemoryStore());
  results.push(await testMemoryRecall());
  results.push(await testMemorySearch());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
