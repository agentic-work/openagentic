/**
 * Azure MCP Integration Tests
 */

const { config, chat, createTestResult, logInfo } = require('../config');

async function testAzureSubscriptions() {
  const startTime = Date.now();
  try {
    const response = await chat(`Use the Azure MCP tools to list my Azure subscriptions. If you can't access Azure tools, explain why.`, null);

    // Check if MCP was invoked or if there's a meaningful response
    const hasResponse = response && response.length > 50;
    const mentionsAzure = /azure|subscription|tenant/i.test(response);
    const indicatesNoAccess = /cannot|unavailable|no access|not available|don't have/i.test(response);

    return createTestResult('Azure Subscriptions', true, Date.now() - startTime, null, {
      hasResponse,
      mentionsAzure,
      indicatesNoAccess,
      preview: response.substring(0, 200)
    });
  } catch (error) {
    return createTestResult('Azure Subscriptions', false, Date.now() - startTime, error);
  }
}

async function testAzureResourceGroups() {
  const startTime = Date.now();
  try {
    const response = await chat(`List all Azure resource groups available to me. Use any available Azure MCP tools.`);

    const hasResponse = response && response.length > 50;
    const mentionsResourceGroups = /resource group|resourcegroup/i.test(response);

    return createTestResult('Azure Resource Groups', true, Date.now() - startTime, null, {
      hasResponse,
      mentionsResourceGroups,
      preview: response.substring(0, 200)
    });
  } catch (error) {
    return createTestResult('Azure Resource Groups', false, Date.now() - startTime, error);
  }
}

async function testAzureCosts() {
  const startTime = Date.now();
  try {
    const response = await chat(`What are my current Azure costs? Use Azure MCP tools to get cost management data if available.`);

    const hasResponse = response && response.length > 50;
    const mentionsCosts = /cost|spending|budget|\$/i.test(response);

    return createTestResult('Azure Cost Management', true, Date.now() - startTime, null, {
      hasResponse,
      mentionsCosts,
      preview: response.substring(0, 200)
    });
  } catch (error) {
    return createTestResult('Azure Cost Management', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing Azure MCP integration...');
  logInfo('Note: These tests require Azure MCP to be configured and authenticated');

  results.push(await testAzureSubscriptions());
  results.push(await testAzureResourceGroups());
  results.push(await testAzureCosts());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
