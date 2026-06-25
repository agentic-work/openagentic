/**
 * Mermaid Diagram Formatting Tests
 */

const { config, chat, createTestResult, logInfo } = require('../config');

async function testFlowchart() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid flowchart showing a simple user login process: Start -> Enter Credentials -> Validate -> Success/Failure branches -> End. Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasFlowchart = /flowchart|graph/i.test(response);
    const hasArrows = /-->|->/.test(response);
    const hasDecision = /\{.*\}/.test(response) || /diamond|decision/i.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Mermaid Flowchart', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasFlowchart,
      hasArrows,
      hasDecision
    });
  } catch (error) {
    return createTestResult('Mermaid Flowchart', false, Date.now() - startTime, error);
  }
}

async function testSequenceDiagram() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid sequence diagram showing API authentication flow between Client, API Gateway, Auth Service, and Database. Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasSequence = /sequenceDiagram/i.test(response);
    const hasParticipants = /participant|actor/i.test(response);
    const hasMessages = /->>|-->>|->|-->/.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Mermaid Sequence Diagram', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasSequence,
      hasParticipants,
      hasMessages
    });
  } catch (error) {
    return createTestResult('Mermaid Sequence Diagram', false, Date.now() - startTime, error);
  }
}

async function testClassDiagram() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid class diagram showing a simple e-commerce system with classes: User, Order, Product, and Cart. Show relationships and some methods. Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasClassDiagram = /classDiagram/i.test(response);
    const hasClasses = /class\s+\w+/.test(response);
    const hasRelationships = /--|->|<\|--|\.\.>/.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Mermaid Class Diagram', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasClassDiagram,
      hasClasses,
      hasRelationships
    });
  } catch (error) {
    return createTestResult('Mermaid Class Diagram', false, Date.now() - startTime, error);
  }
}

async function testStateDiagram() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid state diagram showing order states: Pending -> Processing -> Shipped -> Delivered, with a Cancelled state branching from Pending and Processing. Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasStateDiagram = /stateDiagram|state/.test(response);
    const hasStates = /\[.*\]|state\s+/.test(response);
    const hasTransitions = /-->/.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Mermaid State Diagram', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasStateDiagram,
      hasStates,
      hasTransitions
    });
  } catch (error) {
    return createTestResult('Mermaid State Diagram', false, Date.now() - startTime, error);
  }
}

async function testGanttChart() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid Gantt chart for a software project with phases: Planning (1 week), Development (3 weeks), Testing (1 week), Deployment (3 days). Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasGantt = /gantt/i.test(response);
    const hasTasks = /task|section/i.test(response);
    const hasDates = /\d+[dwm]|\d{4}-\d{2}-\d{2}/.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Mermaid Gantt Chart', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasGantt,
      hasTasks,
      hasDates
    });
  } catch (error) {
    return createTestResult('Mermaid Gantt Chart', false, Date.now() - startTime, error);
  }
}

async function testERDiagram() {
  const startTime = Date.now();
  try {
    const response = await chat(`Create a Mermaid ER diagram for a blog system with entities: User, Post, Comment, and Tag. Show relationships and cardinalities. Use mermaid code block.`);

    const hasMermaidBlock = /```mermaid[\s\S]*```/.test(response);
    const hasERDiagram = /erDiagram/i.test(response);
    const hasEntities = /\w+\s*{/.test(response) || /\w+\s+\|\|/.test(response);
    const hasRelationships = /\|\|--|o{|\}o--\|\|/.test(response) || /--/.test(response);

    if (!hasMermaidBlock) {
      throw new Error('Response does not contain Mermaid code block');
    }

    return createTestResult('Mermaid ER Diagram', true, Date.now() - startTime, null, {
      hasMermaidBlock,
      hasERDiagram,
      hasEntities,
      hasRelationships
    });
  } catch (error) {
    return createTestResult('Mermaid ER Diagram', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing Mermaid diagram formatting...');

  results.push(await testFlowchart());
  results.push(await testSequenceDiagram());
  results.push(await testClassDiagram());
  results.push(await testStateDiagram());
  results.push(await testGanttChart());
  results.push(await testERDiagram());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
