/**
 * Chart Formatting Tests
 */

const { config, chat, createTestResult, logInfo } = require('../config');

async function testPieChart() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid pie chart showing market share: Chrome 65%, Safari 19%, Firefox 4%, Edge 4%, Others 8%. Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasPieChart = /pie/i.test(response);
    const hasValues = /\d+/.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Pie Chart', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasPieChart,
      hasValues
    });
  } catch (error) {
    return createTestResult('Pie Chart', false, Date.now() - startTime, error);
  }
}

async function testMindMap() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid mindmap for "Software Development" with main branches: Frontend, Backend, DevOps, and Testing. Add 2-3 sub-items under each. Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasMindmap = /mindmap/i.test(response);
    const hasBranches = /Frontend|Backend|DevOps|Testing/i.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Mind Map', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasMindmap,
      hasBranches
    });
  } catch (error) {
    return createTestResult('Mind Map', false, Date.now() - startTime, error);
  }
}

async function testASCIIChart() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create an ASCII bar chart showing monthly sales data:
Jan: 45
Feb: 52
Mar: 38
Apr: 61
May: 55
Use characters like # or * for the bars.`);

    const hasAsciiArt = /[#*=|]+/.test(response);
    const hasMonths = /Jan|Feb|Mar|Apr|May/i.test(response);
    const hasStructure = response.split('\n').filter(l => l.length > 10).length >= 5;

    if (!hasAsciiArt) {
      throw new Error('Response does not contain ASCII chart');
    }

    return createTestResult('ASCII Bar Chart', true, Date.now() - startTime, null, {
      hasAsciiArt,
      hasMonths,
      hasStructure
    });
  } catch (error) {
    return createTestResult('ASCII Bar Chart', false, Date.now() - startTime, error);
  }
}

async function testTimeline() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid timeline showing major programming language releases:
- 1972: C
- 1995: Java, JavaScript
- 2009: Go
- 2012: TypeScript
- 2015: Rust
Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasTimeline = /timeline/i.test(response);
    const hasYears = /19\d{2}|20\d{2}/.test(response);
    const hasLanguages = /Java|Python|Go|TypeScript|Rust/i.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Timeline Chart', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasTimeline,
      hasYears,
      hasLanguages
    });
  } catch (error) {
    return createTestResult('Timeline Chart', false, Date.now() - startTime, error);
  }
}

async function testQuadrantChart() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid quadrant chart for project prioritization with axes:
- X-axis: Effort (Low to High)
- Y-axis: Impact (Low to High)
Place these items: Quick Wins (low effort, high impact), Major Projects (high effort, high impact), Fill-Ins (low effort, low impact), Time Sinks (high effort, low impact).
Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasQuadrant = /quadrant/i.test(response);
    const hasAxes = /axis|Effort|Impact/i.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Quadrant Chart', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasQuadrant,
      hasAxes
    });
  } catch (error) {
    return createTestResult('Quadrant Chart', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing chart formatting...');

  results.push(await testPieChart());
  results.push(await testMindMap());
  results.push(await testASCIIChart());
  results.push(await testTimeline());
  results.push(await testQuadrantChart());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
