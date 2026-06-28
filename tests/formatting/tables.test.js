/**
 * Table Formatting Tests
 */

const { config, chat, createTestResult, logInfo } = require('../config');

async function testSimpleTable() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a simple markdown table with 3 columns (Name, Age, City) and 3 rows of sample data. Use proper markdown table syntax.`);

    // Check for table syntax
    const hasTableSyntax = response.includes('|') && response.includes('---');
    const hasHeaders = /\|\s*Name\s*\|.*Age.*\|.*City\s*\|/i.test(response);
    const rowCount = (response.match(/\n\|/g) || []).length;

    if (!hasTableSyntax) {
      throw new Error('Response does not contain table syntax');
    }

    return createTestResult('Simple Table', true, Date.now() - startTime, null, {
      hasTableSyntax,
      hasHeaders,
      rowCount,
      preview: response.substring(0, 300)
    });
  } catch (error) {
    return createTestResult('Simple Table', false, Date.now() - startTime, error);
  }
}

async function testComplexTable() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a detailed comparison table of 3 cloud providers (AWS, Azure, GCP) comparing:
- Compute services
- Storage options
- Pricing model
- Global regions
Use proper markdown table formatting with alignment.`);

    const hasTableSyntax = response.includes('|') && response.includes('---');
    const mentionsProviders = ['aws', 'azure', 'gcp'].every(p =>
      response.toLowerCase().includes(p)
    );

    if (!hasTableSyntax) {
      throw new Error('Response does not contain table syntax');
    }

    return createTestResult('Complex Comparison Table', true, Date.now() - startTime, null, {
      hasTableSyntax,
      mentionsProviders,
      responseLength: response.length
    });
  } catch (error) {
    return createTestResult('Complex Comparison Table', false, Date.now() - startTime, error);
  }
}

async function testNestedFormatting() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a table showing programming language features. Include:
- Bold text for language names
- Code blocks for syntax examples
- Links where appropriate
Use markdown table format.`);

    const hasTableSyntax = response.includes('|');
    const hasBold = response.includes('**');
    const hasCode = response.includes('`');

    if (!hasTableSyntax) {
      throw new Error('Response does not contain table syntax');
    }

    return createTestResult('Table with Nested Formatting', true, Date.now() - startTime, null, {
      hasTableSyntax,
      hasBold,
      hasCode
    });
  } catch (error) {
    return createTestResult('Table with Nested Formatting', false, Date.now() - startTime, error);
  }
}

async function testNumericTable() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a table showing quarterly sales data for 2024:
Q1: $1,234,567
Q2: $1,456,789
Q3: $1,678,901
Q4: $1,890,123
Include columns for: Quarter, Revenue, Growth %, and Notes.
Use right-alignment for numeric columns.`);

    const hasTableSyntax = response.includes('|');
    const hasNumbers = /\$[\d,]+/.test(response);
    const hasPercentages = /%/.test(response);

    if (!hasTableSyntax) {
      throw new Error('Response does not contain table syntax');
    }

    return createTestResult('Numeric Data Table', true, Date.now() - startTime, null, {
      hasTableSyntax,
      hasNumbers,
      hasPercentages
    });
  } catch (error) {
    return createTestResult('Numeric Data Table', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing table formatting...');

  results.push(await testSimpleTable());
  results.push(await testComplexTable());
  results.push(await testNestedFormatting());
  results.push(await testNumericTable());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
