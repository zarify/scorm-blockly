/**
 * Test Runner — Executes student code and evaluates against test cases.
 *
 * Three assertion types:
 * - stdout_match: compare console.log output
 * - block_structure: inspect workspace for required block patterns
 * - variable_state: inspect variable values after execution
 *
 * Code runs in a Web Worker with a timeout to prevent infinite loops.
 */

import { evaluateCondition } from '../../shared/workspace-inspector.js';

const EXECUTION_TIMEOUT_MS = 5000;

/**
 * @typedef {Object} TestResult
 * @property {string} id - Test case ID
 * @property {boolean} passed
 * @property {number} weight - Points for this test
 * @property {number} score - Points earned (weight if passed, 0 if not)
 * @property {string} feedback - Student-facing feedback
 * @property {string} [detail] - Additional detail for debugging
 */

/**
 * Run all test cases against the current workspace and generated code.
 * @param {Array} testCases - test_cases from config
 * @param {string} generatedCode - JavaScript code from Blockly generator
 * @param {object} workspace - Blockly workspace instance
 * @returns {Promise<{ results: TestResult[], totalScore: number, maxScore: number }>}
 */
export async function runTests(testCases, generatedCode, workspace) {
  const results = [];

  // Run code once for stdout and variable tests
  let executionResult = null;
  const needsExecution = testCases.some(
    (tc) => tc.type === 'stdout_match' || tc.type === 'variable_state'
  );

  if (needsExecution) {
    executionResult = await executeCode(generatedCode);
  }

  for (const tc of testCases) {
    let result;
    switch (tc.type) {
      case 'stdout_match':
        result = assertStdout(tc, executionResult);
        break;
      case 'block_structure':
        result = assertBlockStructure(tc, workspace);
        break;
      case 'variable_state':
        result = assertVariableState(tc, executionResult);
        break;
      default:
        result = {
          id: tc.id,
          passed: false,
          weight: tc.weight,
          score: 0,
          feedback: `Unknown test type: ${tc.type}`,
        };
    }
    results.push(result);
  }

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = results.reduce((sum, r) => sum + r.weight, 0);

  return { results, totalScore, maxScore };
}

/**
 * Execute code in a sandboxed environment with timeout.
 * Uses a Web Worker if available, falls back to Function constructor.
 */
async function executeCode(code) {
  // Build worker code that captures console.log and variable state
  const workerSource = `
    const __stdout = [];
    const __origLog = console.log;
    console.log = function() {
      const line = Array.from(arguments).map(String).join(' ');
      __stdout.push(line);
    };

    try {
      // Execute the student code
      const __fn = new Function(${JSON.stringify(code)});
      __fn();

      // Capture variables from workspace (they'll be in global scope of the Function)
      const __vars = {};
      const __varFn = new Function(${JSON.stringify(code)} + ';return typeof count!=="undefined"?{count}:{}');
      try {
        const __result = __varFn();
        Object.assign(__vars, __result);
      } catch(e) {}

      postMessage({
        success: true,
        stdout: __stdout.join('\\n') + ((__stdout.length > 0) ? '\\n' : ''),
        variables: __vars,
        error: null
      });
    } catch (err) {
      postMessage({
        success: false,
        stdout: __stdout.join('\\n') + ((__stdout.length > 0) ? '\\n' : ''),
        variables: {},
        error: err.toString()
      });
    }
  `;

  return new Promise((resolve) => {
    try {
      const blob = new Blob([workerSource], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);

      const timeout = setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({
          success: false,
          stdout: '',
          variables: {},
          error: 'Execution timed out (possible infinite loop)',
        });
      }, EXECUTION_TIMEOUT_MS);

      worker.onmessage = (e) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(e.data);
      };

      worker.onerror = (e) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({
          success: false,
          stdout: '',
          variables: {},
          error: e.message || 'Worker error',
        });
      };
    } catch {
      // Web Worker not available — fallback to direct execution
      resolve(executeCodeDirect(code));
    }
  });
}

/**
 * Fallback: execute code directly (no worker isolation).
 */
function executeCodeDirect(code) {
  const stdout = [];
  const origLog = console.log;
  console.log = (...args) => stdout.push(args.map(String).join(' '));

  try {
    new Function(code)();
    console.log = origLog;
    return {
      success: true,
      stdout: stdout.join('\n') + (stdout.length > 0 ? '\n' : ''),
      variables: {},
      error: null,
    };
  } catch (err) {
    console.log = origLog;
    return {
      success: false,
      stdout: stdout.join('\n') + (stdout.length > 0 ? '\n' : ''),
      variables: {},
      error: err.toString(),
    };
  }
}

function assertStdout(tc, executionResult) {
  const weight = tc.weight || 0;

  if (!executionResult.success && !executionResult.stdout) {
    return {
      id: tc.id,
      passed: false,
      weight,
      score: 0,
      feedback: tc.feedback_on_fail || `Code error: ${executionResult.error}`,
      detail: executionResult.error,
    };
  }

  const actual = executionResult.stdout;
  const expected = tc.expected_output;
  const mode = tc.match_mode || 'exact';
  let passed = false;

  switch (mode) {
    case 'exact':
      passed = actual === expected;
      break;
    case 'contains':
      passed = actual.includes(expected);
      break;
    case 'regex':
      try {
        passed = new RegExp(expected).test(actual);
      } catch {
        passed = false;
      }
      break;
  }

  return {
    id: tc.id,
    passed,
    weight,
    score: passed ? weight : 0,
    feedback: passed ? 'Output matches!' : tc.feedback_on_fail || `Expected output did not match.`,
    detail: passed ? null : `Expected: ${JSON.stringify(expected)}\nGot: ${JSON.stringify(actual)}`,
  };
}

function assertBlockStructure(tc, workspace) {
  const weight = tc.weight || 0;
  const result = evaluateCondition(workspace, tc.conditions);

  return {
    id: tc.id,
    passed: result.passed,
    weight,
    score: result.passed ? weight : 0,
    feedback: result.passed
      ? 'Block structure is correct!'
      : tc.feedback_on_fail || 'Required block arrangement not found.',
    detail: result.detail,
  };
}

function assertVariableState(tc, executionResult) {
  const weight = tc.weight || 0;

  if (!executionResult.success) {
    return {
      id: tc.id,
      passed: false,
      weight,
      score: 0,
      feedback: tc.feedback_on_fail || `Code error: ${executionResult.error}`,
      detail: executionResult.error,
    };
  }

  const actual = executionResult.variables[tc.variable_name];
  const expected = tc.expected_value;
  const comparison = tc.comparison || 'equals';

  if (actual === undefined) {
    return {
      id: tc.id,
      passed: false,
      weight,
      score: 0,
      feedback: tc.feedback_on_fail || `Variable "${tc.variable_name}" not found after execution.`,
      detail: `Available variables: ${Object.keys(executionResult.variables).join(', ') || 'none'}`,
    };
  }

  let passed = false;
  switch (comparison) {
    case 'equals':
      passed = actual == expected;
      break;
    case 'gt':
      passed = actual > expected;
      break;
    case 'lt':
      passed = actual < expected;
      break;
    case 'gte':
      passed = actual >= expected;
      break;
    case 'lte':
      passed = actual <= expected;
      break;
    case 'contains':
      passed = String(actual).includes(String(expected));
      break;
    case 'type':
      passed = typeof actual === expected;
      break;
  }

  return {
    id: tc.id,
    passed,
    weight,
    score: passed ? weight : 0,
    feedback: passed
      ? `Variable "${tc.variable_name}" has the correct value!`
      : tc.feedback_on_fail || `Variable "${tc.variable_name}" doesn't have the expected value.`,
    detail: passed ? null : `Expected ${tc.variable_name} ${comparison} ${expected}, got ${actual}`,
  };
}
