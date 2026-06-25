#!/usr/bin/env node
/**
 * Main test runner for OpenAgentic Chat test suite
 */

const fs = require('fs');
const path = require('path');
const { logSection, logPass, logFail, logInfo, colors } = require('./config');

// Parse command line arguments
const args = process.argv.slice(2);
const categoryArg = args.find(a => a.startsWith('--category'));
const selectedCategory = categoryArg ? categoryArg.split('=')[1] || args[args.indexOf('--category') + 1] : null;

// Test categories and their files
const testCategories = {
  api: {
    name: 'API Tests',
    files: [
      'api/auth.test.js',
      'api/chat.test.js',
      'api/models.test.js',
      'api/admin.test.js'
    ]
  },
  formatting: {
    name: 'Formatting Tests',
    files: [
      'formatting/tables.test.js',
      'formatting/code.test.js',
      'formatting/math.test.js',
      'formatting/mermaid.test.js',
      'formatting/charts.test.js'
    ]
  },
  mcp: {
    name: 'MCP Integration Tests',
    files: [
      'mcp/azure.test.js',
      'mcp/web.test.js',
      'mcp/memory.test.js'
    ]
  },
  concurrent: {
    name: 'Concurrent Load Tests',
    files: [
      'concurrent/parallel-sessions.test.js'
    ]
  },
  prompts: {
    name: 'Prompt Template Tests',
    files: [
      'prompts/crud.test.js'
    ]
  },
  flowise: {
    name: 'Flowise Workflow Tests',
    files: [
      'flowise/agent-flow.test.js'
    ]
  },
  ui: {
    name: 'UI Tests (Playwright)',
    files: [
      'ui/auth.spec.js',
      'ui/chat.spec.js',
      'ui/admin.spec.js'
    ]
  }
};

// Ensure output directory exists
const outputDir = './test-results';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Results storage
const allResults = {
  timestamp: new Date().toISOString(),
  categories: {},
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0
  }
};

async function runTestFile(filePath) {
  const fullPath = path.join(__dirname, filePath);

  if (!fs.existsSync(fullPath)) {
    return { skipped: true, reason: 'File not found' };
  }

  try {
    const testModule = require(fullPath);

    if (typeof testModule.run === 'function') {
      return await testModule.run();
    } else if (typeof testModule === 'function') {
      return await testModule();
    } else {
      return { skipped: true, reason: 'No run function exported' };
    }
  } catch (error) {
    return {
      passed: false,
      error: error.message,
      stack: error.stack
    };
  }
}

async function runCategory(categoryKey, category) {
  logSection(category.name);

  const categoryResults = {
    name: category.name,
    tests: [],
    summary: { total: 0, passed: 0, failed: 0, skipped: 0 }
  };

  for (const file of category.files) {
    const testName = path.basename(file, '.test.js').replace('.spec', '');
    logInfo(`Running: ${testName}`);

    const startTime = Date.now();
    const result = await runTestFile(file);
    const duration = Date.now() - startTime;

    if (result.skipped) {
      console.log(`  ${colors.yellow}SKIP${colors.reset} ${result.reason}`);
      categoryResults.summary.skipped++;
    } else if (result.passed === false || result.error) {
      logFail(`${testName} (${duration}ms)`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      categoryResults.summary.failed++;
    } else {
      logPass(`${testName} (${duration}ms)`);
      categoryResults.summary.passed++;
    }

    categoryResults.summary.total++;
    categoryResults.tests.push({
      file,
      name: testName,
      duration,
      ...result
    });
  }

  return categoryResults;
}

async function main() {
  console.log(`\n${colors.cyan}╔══════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║   OpenAgentic Chat - Comprehensive Tests     ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════╝${colors.reset}\n`);

  const startTime = Date.now();

  // Determine which categories to run
  const categoriesToRun = selectedCategory
    ? { [selectedCategory]: testCategories[selectedCategory] }
    : testCategories;

  if (selectedCategory && !testCategories[selectedCategory]) {
    console.error(`Unknown category: ${selectedCategory}`);
    console.log('Available categories:', Object.keys(testCategories).join(', '));
    process.exit(1);
  }

  // Run each category
  for (const [key, category] of Object.entries(categoriesToRun)) {
    const results = await runCategory(key, category);
    allResults.categories[key] = results;

    allResults.summary.total += results.summary.total;
    allResults.summary.passed += results.summary.passed;
    allResults.summary.failed += results.summary.failed;
    allResults.summary.skipped += results.summary.skipped;
  }

  const totalDuration = Date.now() - startTime;

  // Print summary
  logSection('Summary');
  console.log(`Total Tests: ${allResults.summary.total}`);
  console.log(`${colors.green}Passed: ${allResults.summary.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${allResults.summary.failed}${colors.reset}`);
  console.log(`${colors.yellow}Skipped: ${allResults.summary.skipped}${colors.reset}`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  // Save results to file
  const resultsFile = path.join(outputDir, `results-${Date.now()}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to: ${resultsFile}`);

  // Exit with appropriate code
  process.exit(allResults.summary.failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
