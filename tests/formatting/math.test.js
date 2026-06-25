/**
 * Math Formula Formatting Tests (LaTeX/KaTeX)
 */

const { config, chat, createTestResult, logInfo } = require('../config');

async function testBasicMath() {
  const startTime = Date.now();
  try {
    const response = await chat(`Write the quadratic formula using LaTeX math notation. Use $$ for display math.`);

    // Check for LaTeX math syntax
    const hasDisplayMath = /\$\$[\s\S]*\$\$/.test(response);
    const hasInlineMath = /\$[^$]+\$/.test(response);
    const hasQuadraticTerms = /frac|sqrt|pm|\^2/.test(response);

    if (!hasDisplayMath && !hasInlineMath) {
      throw new Error('Response does not contain math notation');
    }

    return createTestResult('Basic Math Formula', true, Date.now() - startTime, null, {
      hasDisplayMath,
      hasInlineMath,
      hasQuadraticTerms
    });
  } catch (error) {
    return createTestResult('Basic Math Formula', false, Date.now() - startTime, error);
  }
}

async function testComplexEquations() {
  const startTime = Date.now();
  try {
    const response = await chat(`Show the Gaussian distribution formula (normal distribution) using LaTeX notation. Include the full probability density function.`);

    const hasMath = /\$\$[\s\S]*\$\$/.test(response) || /\$[^$]+\$/.test(response);
    const hasExp = /exp|e\^/.test(response);
    const hasSigma = /sigma|\\sigma/.test(response);

    if (!hasMath) {
      throw new Error('Response does not contain math notation');
    }

    return createTestResult('Complex Equation (Gaussian)', true, Date.now() - startTime, null, {
      hasMath,
      hasExp,
      hasSigma
    });
  } catch (error) {
    return createTestResult('Complex Equation (Gaussian)', false, Date.now() - startTime, error);
  }
}

async function testMatrixNotation() {
  const startTime = Date.now();
  try {
    const response = await chat(`Show matrix multiplication example with a 2x2 matrix using LaTeX notation. Use the matrix or pmatrix environment.`);

    const hasMath = /\$\$[\s\S]*\$\$/.test(response) || /\$[^$]+\$/.test(response);
    const hasMatrix = /matrix|pmatrix|bmatrix/.test(response);
    const hasMultiplication = /\\cdot|\\times|\*/.test(response);

    if (!hasMath) {
      throw new Error('Response does not contain math notation');
    }

    return createTestResult('Matrix Notation', true, Date.now() - startTime, null, {
      hasMath,
      hasMatrix,
      hasMultiplication
    });
  } catch (error) {
    return createTestResult('Matrix Notation', false, Date.now() - startTime, error);
  }
}

async function testCalculusFormulas() {
  const startTime = Date.now();
  try {
    const response = await chat(`Show the fundamental theorem of calculus using LaTeX notation. Include both the definite integral form and the derivative relationship.`);

    const hasMath = /\$\$[\s\S]*\$\$/.test(response) || /\$[^$]+\$/.test(response);
    const hasIntegral = /int|\\int/.test(response);
    const hasDerivative = /frac\{d|\\frac\{d|d\/dx/.test(response);

    if (!hasMath) {
      throw new Error('Response does not contain math notation');
    }

    return createTestResult('Calculus Formulas', true, Date.now() - startTime, null, {
      hasMath,
      hasIntegral,
      hasDerivative
    });
  } catch (error) {
    return createTestResult('Calculus Formulas', false, Date.now() - startTime, error);
  }
}

async function testMixedContent() {
  const startTime = Date.now();
  try {
    const response = await chat(`Explain Einstein's mass-energy equivalence formula. Include the equation in LaTeX and explain each variable. Mix text with inline math.`);

    const hasDisplayMath = /\$\$[\s\S]*\$\$/.test(response);
    const hasInlineMath = /\$[^$]+\$/.test(response);
    const mentionsE = /E\s*=|energy/i.test(response);
    const mentionsC = /c\^?2|speed of light/i.test(response);

    const hasMath = hasDisplayMath || hasInlineMath;

    if (!hasMath) {
      throw new Error('Response does not contain math notation');
    }

    return createTestResult('Mixed Text and Math', true, Date.now() - startTime, null, {
      hasDisplayMath,
      hasInlineMath,
      mentionsE,
      mentionsC
    });
  } catch (error) {
    return createTestResult('Mixed Text and Math', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing math formula formatting...');

  results.push(await testBasicMath());
  results.push(await testComplexEquations());
  results.push(await testMatrixNotation());
  results.push(await testCalculusFormulas());
  results.push(await testMixedContent());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
