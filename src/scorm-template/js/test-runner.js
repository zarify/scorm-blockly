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
 * @property {number} points - Points for this test
 * @property {number} score - Points earned (points if passed, 0 if not)
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

  const executionPlan = new Map();
  for (const tc of testCases) {
    if (tc.type !== 'stdout_match' && tc.type !== 'variable_state') continue;

    const promptInputs = getPromptInputs(tc);
    const planKey = getExecutionPlanKey(promptInputs);
    if (!executionPlan.has(planKey)) {
      executionPlan.set(planKey, { promptInputs, variableNames: new Set() });
    }

    if (tc.type === 'variable_state' && tc.variable_name) {
      executionPlan.get(planKey).variableNames.add(tc.variable_name);
    }
  }

  const executionResults = new Map();
  for (const [planKey, plan] of executionPlan.entries()) {
    executionResults.set(
      planKey,
      await executeCode(generatedCode, plan.promptInputs, [...plan.variableNames]),
    );
  }

  for (const tc of testCases) {
    const executionResult = executionResults.get(getExecutionPlanKey(getPromptInputs(tc))) || null;
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
          points: getTestPoints(tc),
          score: 0,
          feedback: `Unknown test type: ${tc.type}`,
        };
    }
    results.push(result);
  }

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = results.reduce((sum, r) => sum + r.points, 0);

  return { results, totalScore, maxScore };
}

/**
 * Execute student code for an interactive run.
 * Uses the browser's real prompt() so learners/authors can supply input live.
 * @param {string} generatedCode
 * @returns {{ success: boolean, stdout: string, prompts: Array<{message: string, response: string | null, cancelled: boolean}>, error: string | null }}
 */
export function executeInteractiveRun(generatedCode) {
  const stdout = [];
  const promptOwner = globalThis.window || globalThis;
  const originalConsoleLog = console.log;
  const originalPrompt = globalThis.prompt;
  const originalWindowPrompt = promptOwner.prompt;
  const nativePrompt =
    typeof originalWindowPrompt === 'function'
      ? originalWindowPrompt.bind(promptOwner)
      : typeof originalPrompt === 'function'
        ? originalPrompt.bind(globalThis)
        : null;
  const promptLog = [];

  console.log = (...args) => stdout.push(args.map(String).join(' '));

  const promptImpl = (message, defaultValue = '') => {
    const normalizedMessage = String(message ?? '');
    const normalizedDefault = defaultValue == null ? '' : String(defaultValue);
    const response = nativePrompt ? nativePrompt(normalizedMessage, normalizedDefault) : normalizedDefault;

    promptLog.push({
      message: normalizedMessage,
      response: response == null ? null : String(response),
      cancelled: response == null,
    });

    return response;
  };

  globalThis.prompt = promptImpl;
  promptOwner.prompt = promptImpl;

  try {
    new Function(generatedCode)();
    return {
      success: true,
      stdout: stdout.join('\n') + (stdout.length > 0 ? '\n' : ''),
      prompts: promptLog,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      stdout: stdout.join('\n') + (stdout.length > 0 ? '\n' : ''),
      prompts: promptLog,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    console.log = originalConsoleLog;
    globalThis.prompt = originalPrompt;
    promptOwner.prompt = originalWindowPrompt;
  }
}

/**
 * Execute code in a sandboxed environment with timeout.
 * Uses a Web Worker if available, falls back to Function constructor.
 */
async function executeCode(code, promptInputs = [], variableNames = []) {
  const variableCaptureSource = buildVariableCaptureSource(variableNames);
  const promptInputCount = promptInputs.length;

  // Build worker code that captures console.log and variable state
  const workerSource = `
    const __stdout = [];
    const __initialPromptInputs = ${JSON.stringify(promptInputs)};
    const __promptLog = [];
    const __makePrompt = function(initialInputs, shouldLog = true) {
      const queue = [...initialInputs];
      return function(message, defaultValue = '') {
        const fallback = defaultValue == null ? '' : String(defaultValue);
        const usedProvidedInput = queue.length > 0;
        const response = usedProvidedInput ? String(queue.shift()) : fallback;
        if (shouldLog) {
          __promptLog.push({ message: String(message ?? ''), response, usedProvidedInput });
        }
        return response;
      };
    };
    const __assignPrompt = function(promptImpl) {
      self.prompt = promptImpl;
      self.window = Object.assign(self.window || {}, { prompt: promptImpl });
    };
    console.log = function() {
      const line = Array.from(arguments).map(String).join(' ');
      __stdout.push(line);
    };
    __assignPrompt(__makePrompt(__initialPromptInputs));

    try {
      // Execute the student code
      const __fn = new Function(${JSON.stringify(code)});
      __fn();

      const __vars = {};
      if (${JSON.stringify(variableCaptureSource)} !== '{}') {
        __assignPrompt(__makePrompt(__initialPromptInputs, false));
        const __varFn = new Function(${JSON.stringify(code + '\nreturn ' + variableCaptureSource + ';')});
        try {
          const __result = __varFn();
          Object.assign(__vars, __result);
        } catch (e) {}
      }

      postMessage({
        success: true,
        stdout: __stdout.join('\\n') + ((__stdout.length > 0) ? '\\n' : ''),
        variables: __vars,
        prompts: __promptLog,
        promptDiagnostics: {
          configuredInputCount: __initialPromptInputs.length,
          promptCallCount: __promptLog.length,
          usedProvidedInputCount: __promptLog.filter((entry) => entry.usedProvidedInput).length,
          underflowCount: __promptLog.filter((entry) => !entry.usedProvidedInput).length,
          unusedInputCount: Math.max(0, __initialPromptInputs.length - __promptLog.filter((entry) => entry.usedProvidedInput).length)
        },
        error: null
      });
    } catch (err) {
      postMessage({
        success: false,
        stdout: __stdout.join('\\n') + ((__stdout.length > 0) ? '\\n' : ''),
        variables: {},
        prompts: __promptLog,
        promptDiagnostics: {
          configuredInputCount: __initialPromptInputs.length,
          promptCallCount: __promptLog.length,
          usedProvidedInputCount: __promptLog.filter((entry) => entry.usedProvidedInput).length,
          underflowCount: __promptLog.filter((entry) => !entry.usedProvidedInput).length,
          unusedInputCount: Math.max(0, __initialPromptInputs.length - __promptLog.filter((entry) => entry.usedProvidedInput).length)
        },
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
          prompts: [],
          promptDiagnostics: createPromptDiagnostics(promptInputCount, 0, 0),
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
          prompts: [],
          promptDiagnostics: createPromptDiagnostics(promptInputCount, 0, 0),
          error: e.message || 'Worker error',
        });
      };
    } catch {
      // Web Worker not available — fallback to direct execution
      resolve(executeCodeDirect(code, promptInputs, variableNames));
    }
  });
}

/**
 * Fallback: execute code directly (no worker isolation).
 */
function executeCodeDirect(code, promptInputs = [], variableNames = []) {
  const stdout = [];
  const origLog = console.log;
  const promptOwner = globalThis.window || globalThis;
  const origPrompt = globalThis.prompt;
  const origWindowPrompt = promptOwner.prompt;
  const remainingPromptInputs = [...promptInputs];
  const promptLog = [];

  console.log = (...args) => stdout.push(args.map(String).join(' '));
  const promptImpl = (message, defaultValue = '') => {
    const fallback = defaultValue == null ? '' : String(defaultValue);
    const usedProvidedInput = remainingPromptInputs.length > 0;
    const response = usedProvidedInput ? String(remainingPromptInputs.shift()) : fallback;
    promptLog.push({ message: String(message ?? ''), response, usedProvidedInput });
    return response;
  };
  globalThis.prompt = promptImpl;
  promptOwner.prompt = promptImpl;

  try {
    new Function(code)();
    const variables = readVariablesFromCode(code, variableNames, promptInputs);
    console.log = origLog;
    globalThis.prompt = origPrompt;
    promptOwner.prompt = origWindowPrompt;
    return {
      success: true,
      stdout: stdout.join('\n') + (stdout.length > 0 ? '\n' : ''),
      variables,
      prompts: promptLog,
      promptDiagnostics: createPromptDiagnostics(
        promptInputs.length,
        promptLog.length,
        promptLog.filter((entry) => entry.usedProvidedInput).length,
      ),
      error: null,
    };
  } catch (err) {
    console.log = origLog;
    globalThis.prompt = origPrompt;
    promptOwner.prompt = origWindowPrompt;
    return {
      success: false,
      stdout: stdout.join('\n') + (stdout.length > 0 ? '\n' : ''),
      variables: {},
      prompts: promptLog,
      promptDiagnostics: createPromptDiagnostics(
        promptInputs.length,
        promptLog.length,
        promptLog.filter((entry) => entry.usedProvidedInput).length,
      ),
      error: err.toString(),
    };
  }
}

function assertStdout(tc, executionResult) {
  const points = getTestPoints(tc);
  const promptMismatch = getPromptMismatch(executionResult);

  if (promptMismatch) {
    return {
      id: tc.id,
      passed: false,
      points,
      score: 0,
      feedback: promptMismatch.feedback,
      detail: promptMismatch.detail,
    };
  }

  if (!executionResult.success && !executionResult.stdout) {
    return {
      id: tc.id,
      passed: false,
      points,
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
    points,
    score: passed ? points : 0,
    feedback: passed ? 'Output matches!' : tc.feedback_on_fail || `Expected output did not match.`,
    detail: passed ? null : `Expected: ${JSON.stringify(expected)}\nGot: ${JSON.stringify(actual)}`,
  };
}

function assertBlockStructure(tc, workspace) {
  const points = getTestPoints(tc);
  const result = evaluateCondition(workspace, tc.conditions);

  return {
    id: tc.id,
    passed: result.passed,
    points,
    score: result.passed ? points : 0,
    feedback: result.passed
      ? 'Block structure is correct!'
      : tc.feedback_on_fail || 'Required block arrangement not found.',
    detail: result.detail,
  };
}

function assertVariableState(tc, executionResult) {
  const points = getTestPoints(tc);
  const promptMismatch = getPromptMismatch(executionResult);

  if (promptMismatch) {
    return {
      id: tc.id,
      passed: false,
      points,
      score: 0,
      feedback: promptMismatch.feedback,
      detail: promptMismatch.detail,
    };
  }

  if (!executionResult.success) {
    return {
      id: tc.id,
      passed: false,
      points,
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
      points,
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
    points,
    score: passed ? points : 0,
    feedback: passed
      ? `Variable "${tc.variable_name}" has the correct value!`
      : tc.feedback_on_fail || `Variable "${tc.variable_name}" doesn't have the expected value.`,
    detail: passed ? null : `Expected ${tc.variable_name} ${comparison} ${expected}, got ${actual}`,
  };
}

function getExecutionPlanKey(promptInputs) {
  return JSON.stringify(promptInputs);
}

function getPromptInputs(testCase) {
  return Array.isArray(testCase?.prompt_inputs)
    ? testCase.prompt_inputs.map((value) => String(value))
    : [];
}

function getTestPoints(testCase) {
  const value = testCase?.points ?? testCase?.weight ?? 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0;
}

function buildVariableCaptureSource(variableNames) {
  const safeVariableNames = [...new Set(variableNames.filter(isSafeIdentifier))];
  if (safeVariableNames.length === 0) return '{}';

  return `{${safeVariableNames.map((name) => `${JSON.stringify(name)}: typeof ${name} !== "undefined" ? ${name} : undefined`).join(',')}}`;
}

function readVariablesFromCode(code, variableNames, promptInputs = []) {
  const variableCaptureSource = buildVariableCaptureSource(variableNames);
  if (variableCaptureSource === '{}') return {};

  const promptOwner = globalThis.window || globalThis;
  const origPrompt = globalThis.prompt;
  const origWindowPrompt = promptOwner.prompt;
  const remainingPromptInputs = [...promptInputs];
  const promptImpl = (_message, defaultValue = '') => {
    const fallback = defaultValue == null ? '' : String(defaultValue);
    return remainingPromptInputs.length > 0 ? String(remainingPromptInputs.shift()) : fallback;
  };

  try {
    globalThis.prompt = promptImpl;
    promptOwner.prompt = promptImpl;
    return new Function(`${code}\nreturn ${variableCaptureSource};`)();
  } catch {
    return {};
  } finally {
    globalThis.prompt = origPrompt;
    promptOwner.prompt = origWindowPrompt;
  }
}

function isSafeIdentifier(name) {
  return typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function formatCount(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function createPromptDiagnostics(configuredInputCount, promptCallCount, usedProvidedInputCount) {
  const normalizedConfiguredCount = Math.max(0, configuredInputCount);
  const normalizedPromptCallCount = Math.max(0, promptCallCount);
  const normalizedUsedCount = Math.max(0, usedProvidedInputCount);

  return {
    configuredInputCount: normalizedConfiguredCount,
    promptCallCount: normalizedPromptCallCount,
    usedProvidedInputCount: normalizedUsedCount,
    underflowCount: Math.max(0, normalizedPromptCallCount - normalizedUsedCount),
    unusedInputCount: Math.max(0, normalizedConfiguredCount - normalizedUsedCount),
  };
}

function getPromptMismatch(executionResult) {
  const diagnostics = executionResult?.promptDiagnostics;
  if (!diagnostics) return null;

  if (diagnostics.underflowCount > 0) {
    const expectedCount = diagnostics.configuredInputCount;
    const actualCount = diagnostics.promptCallCount;
    return {
      feedback: `Your program asked for ${formatCount(actualCount, 'input')}, but the test expected ${formatCount(expectedCount, 'input')}.`,
      detail: `Your program asked for ${actualCount} prompt input(s), but this test only provided ${expectedCount}. Add or remove input steps so they match exactly.`,
    };
  }

  if (diagnostics.unusedInputCount > 0) {
    const expectedCount = diagnostics.configuredInputCount;
    const actualCount = diagnostics.promptCallCount;
    return {
      feedback: `Your program asked for ${formatCount(actualCount, 'input')}, but the test expected ${formatCount(expectedCount, 'input')}.`,
      detail: `This test provided ${expectedCount} prompt input(s), but your program only used ${actualCount}. Add or remove input steps so they match exactly.`,
    };
  }

  return null;
}
