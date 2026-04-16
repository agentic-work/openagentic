/**
 * Web MCP Integration Tests
 */

const { config, chat, createTestResult, logInfo } = require('../config');

async function testWebSearch() {
  const startTime = Date.now();
  try {
    const response = await chat(`Search the web for "TypeScript 5.0 new features" using web search tools. Summarize the top results.`);

    const hasResponse = response && response.length > 100;
    const mentionsTypeScript = /typescript|ts/i.test(response);
    const hasResults = /feature|update|release|version/i.test(response);

    return createTestResult('Web Search', true, Date.now() - startTime, null, {
      hasResponse,
      mentionsTypeScript,
      hasResults,
      preview: response.substring(0, 300)
    });
  } catch (error) {
    return createTestResult('Web Search', false, Date.now() - startTime, error);
  }
}

async function testWebFetch() {
  const startTime = Date.now();
  try {
    const response = await chat(`Fetch and summarize the content from https://httpbin.org/html using web fetch tools.`);

    const hasResponse = response && response.length > 50;
    const hasContent = /html|content|page|website|text/i.test(response);

    return createTestResult('Web Fetch', true, Date.now() - startTime, null, {
      hasResponse,
      hasContent,
      preview: response.substring(0, 300)
    });
  } catch (error) {
    return createTestResult('Web Fetch', false, Date.now() - startTime, error);
  }
}

async function testWebSearchAndRead() {
  const startTime = Date.now();
  try {
    const response = await chat(`Search for "Node.js best practices 2024" and read the top result. Provide a summary of the key points.`);

    const hasResponse = response && response.length > 100;
    const hasNodeJS = /node\.?js|nodejs/i.test(response);
    const hasPractices = /practice|best|tip|recommend/i.test(response);

    return createTestResult('Web Search and Read', true, Date.now() - startTime, null, {
      hasResponse,
      hasNodeJS,
      hasPractices,
      preview: response.substring(0, 300)
    });
  } catch (error) {
    return createTestResult('Web Search and Read', false, Date.now() - startTime, error);
  }
}

async function testWebNewsSearch() {
  const startTime = Date.now();
  try {
    const response = await chat(`Search for recent news about artificial intelligence. Use news search tools if available.`);

    const hasResponse = response && response.length > 100;
    const hasAI = /ai|artificial intelligence|machine learning|llm/i.test(response);
    const hasNews = /news|article|report|announcement/i.test(response);

    return createTestResult('Web News Search', true, Date.now() - startTime, null, {
      hasResponse,
      hasAI,
      hasNews,
      preview: response.substring(0, 300)
    });
  } catch (error) {
    return createTestResult('Web News Search', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing Web MCP integration...');

  results.push(await testWebSearch());
  results.push(await testWebFetch());
  results.push(await testWebSearchAndRead());
  results.push(await testWebNewsSearch());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
