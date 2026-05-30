/**
 * Code Block Formatting Tests
 */

const { config, chat, createTestResult, logInfo } = require('../config');

async function testPythonCode() {
  const startTime = Date.now();
  try {
    const response = await chat(`Write a Python function that calculates the Fibonacci sequence. Include proper type hints and a docstring.`);

    const hasPythonBlock = /```python[\s\S]*```/.test(response);
    const hasFunctionDef = /def\s+\w+\s*\(/.test(response);
    const hasDocstring = /"""[\s\S]*?"""/.test(response) || /'''[\s\S]*?'''/.test(response);

    if (!hasPythonBlock) {
      throw new Error('Response does not contain Python code block');
    }

    return createTestResult('Python Code Block', true, Date.now() - startTime, null, {
      hasPythonBlock,
      hasFunctionDef,
      hasDocstring
    });
  } catch (error) {
    return createTestResult('Python Code Block', false, Date.now() - startTime, error);
  }
}

async function testJavaScriptCode() {
  const startTime = Date.now();
  try {
    const response = await chat(`Write a JavaScript async function that fetches data from an API and handles errors properly. Use modern ES6+ syntax.`);

    const hasJSBlock = /```(?:javascript|js)[\s\S]*```/.test(response);
    const hasAsync = /async\s+/.test(response);
    const hasAwait = /await\s+/.test(response);
    const hasTryCatch = /try\s*{/.test(response);

    if (!hasJSBlock) {
      throw new Error('Response does not contain JavaScript code block');
    }

    return createTestResult('JavaScript Code Block', true, Date.now() - startTime, null, {
      hasJSBlock,
      hasAsync,
      hasAwait,
      hasTryCatch
    });
  } catch (error) {
    return createTestResult('JavaScript Code Block', false, Date.now() - startTime, error);
  }
}

async function testTypeScriptCode() {
  const startTime = Date.now();
  try {
    const response = await chat(`Write a TypeScript interface for a User object with id, name, email, and optional age. Then write a function that validates a user object.`);

    const hasTSBlock = /```(?:typescript|ts)[\s\S]*```/.test(response);
    const hasInterface = /interface\s+\w+/.test(response);
    const hasTypes = /:\s*(string|number|boolean)/.test(response);

    if (!hasTSBlock) {
      throw new Error('Response does not contain TypeScript code block');
    }

    return createTestResult('TypeScript Code Block', true, Date.now() - startTime, null, {
      hasTSBlock,
      hasInterface,
      hasTypes
    });
  } catch (error) {
    return createTestResult('TypeScript Code Block', false, Date.now() - startTime, error);
  }
}

async function testSQLCode() {
  const startTime = Date.now();
  try {
    const response = await chat(`Write a SQL query that joins users and orders tables, groups by user, and shows total order value. Include proper formatting.`);

    const hasSQLBlock = /```sql[\s\S]*```/.test(response);
    const hasJoin = /JOIN/i.test(response);
    const hasGroupBy = /GROUP BY/i.test(response);

    if (!hasSQLBlock) {
      throw new Error('Response does not contain SQL code block');
    }

    return createTestResult('SQL Code Block', true, Date.now() - startTime, null, {
      hasSQLBlock,
      hasJoin,
      hasGroupBy
    });
  } catch (error) {
    return createTestResult('SQL Code Block', false, Date.now() - startTime, error);
  }
}

async function testMultiLanguage() {
  const startTime = Date.now();
  try {
    const response = await chat(`Show how to make an HTTP GET request in three languages: Python, JavaScript, and Go. Use separate code blocks for each.`);

    const pythonBlock = /```python[\s\S]*```/.test(response);
    const jsBlock = /```(?:javascript|js)[\s\S]*```/.test(response);
    const goBlock = /```go[\s\S]*```/.test(response);
    const codeBlockCount = (response.match(/```\w+/g) || []).length;

    if (codeBlockCount < 3) {
      throw new Error(`Expected 3 code blocks, found ${codeBlockCount}`);
    }

    return createTestResult('Multi-Language Code Blocks', true, Date.now() - startTime, null, {
      pythonBlock,
      jsBlock,
      goBlock,
      codeBlockCount
    });
  } catch (error) {
    return createTestResult('Multi-Language Code Blocks', false, Date.now() - startTime, error);
  }
}

async function testInlineCode() {
  const startTime = Date.now();
  try {
    const response = await chat(`Explain the difference between let, const, and var in JavaScript. Use inline code formatting for the keywords.`);

    const hasInlineCode = /`[^`]+`/.test(response);
    const mentionsLet = /`let`/.test(response);
    const mentionsConst = /`const`/.test(response);
    const mentionsVar = /`var`/.test(response);

    if (!hasInlineCode) {
      throw new Error('Response does not contain inline code');
    }

    return createTestResult('Inline Code Formatting', true, Date.now() - startTime, null, {
      hasInlineCode,
      mentionsLet,
      mentionsConst,
      mentionsVar
    });
  } catch (error) {
    return createTestResult('Inline Code Formatting', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing code block formatting...');

  results.push(await testPythonCode());
  results.push(await testJavaScriptCode());
  results.push(await testTypeScriptCode());
  results.push(await testSQLCode());
  results.push(await testMultiLanguage());
  results.push(await testInlineCode());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
