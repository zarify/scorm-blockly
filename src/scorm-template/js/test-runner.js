/**
 * Test Runner — Executes student code and evaluates against test cases.
 *
 * Three assertion types:
 * - stdout_match: compare configured runtime text assertions (stdout, prompt text, or both)
 * - block_structure: inspect workspace for required block patterns
 * - variable_state: inspect variable values after execution
 *
 * Code runs in a Web Worker with a timeout to prevent infinite loops.
 */

import { evaluateCondition } from '../../shared/workspace-inspector.js';
import {
  getPromptInputs as getConfiguredPromptInputs,
  getVariableListAssertions,
  getStdoutOutputAssertion,
  getStdoutPromptAssertion,
  normalizeVariableType,
  normalizeVariableValueAssertionEnabled,
  shouldEnforcePromptInputCount,
} from '../../shared/test-config.js';

const EXECUTION_TIMEOUT_MS = 5000;
const ASYNC_FUNCTION = Object.getPrototypeOf(async function emptyAsyncFunction() {}).constructor;
export const INTERACTIVE_RUN_CANCELLED_ERROR = 'Run cancelled.';

/**
 * @typedef {Object} TestResult
 * @property {string} id - Test case ID
 * @property {boolean} passed
 * @property {number} points - Points for this test
 * @property {number} score - Points earned (points if passed, 0 if not)
 * @property {string} feedback - Student-facing feedback
 * @property {string} [detail] - Additional detail for debugging
 * @property {string} [student_detail] - Optional extra detail shown to the student
 */

/**
 * Run all test cases against the current workspace and generated code.
 * @param {Array} testCases - test_cases from config
 * @param {string} generatedCode - JavaScript code from Blockly generator
 * @param {object} workspace - Blockly workspace instance
 * @param {{ requirePreviousTestPass?: boolean }} [options]
 * @returns {Promise<{ results: TestResult[], totalScore: number, maxScore: number, hasBlockedTests: boolean }>}
 */
export async function runTests(testCases, generatedCode, workspace, options = {}) {
  const results = [];
  const executionResults = new Map();
  const executionPlans = buildExecutionPlans(testCases);
  const requirePreviousTestPass = options.requirePreviousTestPass === true;

  for (let index = 0; index < testCases.length; index += 1) {
    const tc = testCases[index];
    if (requirePreviousTestPass && index > 0 && !results[index - 1].passed) {
      break;
    }

    const executionResult = await getExecutionResultForTest(
      tc,
      generatedCode,
      executionPlans,
      executionResults,
    );
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
  const maxScore = testCases.reduce((sum, tc) => sum + getTestPoints(tc), 0);
  const hasBlockedTests = requirePreviousTestPass && results.length < testCases.length;

  return { results, totalScore, maxScore, hasBlockedTests };
}

function buildExecutionPlans(testCases) {
  const executionPlans = new Map();

  for (const tc of testCases) {
    if (tc.type !== 'stdout_match' && tc.type !== 'variable_state') continue;

    const promptInputs = getPromptInputs(tc);
    const planKey = getExecutionPlanKey(promptInputs);
    if (!executionPlans.has(planKey)) {
      executionPlans.set(planKey, { promptInputs, variableNames: new Set() });
    }

    if (tc.type === 'variable_state' && tc.variable_name) {
      executionPlans.get(planKey).variableNames.add(tc.variable_name);
    }
  }

  return executionPlans;
}

async function getExecutionResultForTest(testCase, generatedCode, executionPlans, executionResults) {
  if (testCase.type !== 'stdout_match' && testCase.type !== 'variable_state') {
    return null;
  }

  const planKey = getExecutionPlanKey(getPromptInputs(testCase));
  const plan = executionPlans.get(planKey);

  if (!executionResults.has(planKey)) {
    executionResults.set(
      planKey,
      await executeCode(generatedCode, plan.promptInputs, [...plan.variableNames]),
    );
  }

  return executionResults.get(planKey);
}

/**
 * Execute student code for an interactive run.
 * @param {string} generatedCode
 * @param {{ onStdout?: (line: string) => void, requestInput?: ({ message: string, defaultValue: string, inputType: 'text' | 'number' }) => Promise<string> | string, isCancelled?: () => boolean }} [hooks]
 * @returns {Promise<{ success: boolean, cancelled: boolean, stdout: string, variables: object, prompts: Array<{message: string, response: string | null, cancelled: boolean}>, promptDiagnostics: null, error: string | null }>}
 */
export async function executeInteractiveRun(generatedCode, hooks = {}) {
  const executionContext = createExecutionContext({
    promptInputCount: null,
    inputProvider: createInteractiveInputProvider(hooks.requestInput),
    onStdout: hooks.onStdout,
    isCancelled: hooks.isCancelled,
  });

  return executeProgramWithContext(generatedCode, executionContext);
}

/**
 * Execute code in a sandboxed environment with timeout.
 * Uses a Web Worker if available, falls back to Function constructor.
 */
async function executeCode(code, promptInputs = [], variableNames = []) {
  const variableCaptureSource = buildVariableCaptureSource(variableNames);
  const promptInputCount = promptInputs.length;
  const programSource = buildExecutableProgramSource(code, variableCaptureSource);
  const workerSource = buildWorkerExecutionSource(programSource, promptInputs);

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
async function executeCodeDirect(code, promptInputs = [], variableNames = []) {
  const executionContext = createExecutionContext({
    promptInputCount: promptInputs.length,
    inputProvider: createScriptedInputProvider(promptInputs),
    variableNames,
  });

  return executeProgramWithContext(code, executionContext);
}

function buildExecutableProgramSource(code, variableCaptureSource) {
  return [
    'const console = { log: (...args) => __runtime.writeLine(...args) };',
    code,
    `return ${variableCaptureSource};`,
  ].join('\n');
}

function buildWorkerExecutionSource(programSource, promptInputs) {
  return `
    const AsyncFunction = Object.getPrototypeOf(async function emptyAsyncFunction() {}).constructor;
    const __stdout = [];
    const __initialPromptInputs = ${JSON.stringify(promptInputs)};
    const __promptLog = [];
    const __queue = [...__initialPromptInputs];
    const __programSource = ${JSON.stringify(programSource)};
    const __runtime = {
      async writeLine() {
        const line = Array.from(arguments).map(String).join(' ');
        __stdout.push(line);
        return line;
      },
      async promptText(message, defaultValue = '') {
        const normalizedMessage = String(message ?? '');
        const normalizedDefault = defaultValue == null ? '' : String(defaultValue);
        const usedProvidedInput = __queue.length > 0;
        const response = usedProvidedInput ? String(__queue.shift()) : normalizedDefault;
        __promptLog.push({
          message: normalizedMessage,
          response,
          cancelled: false,
          usedProvidedInput,
        });
        return response;
      },
      async promptNumber(message, defaultValue = '') {
        const response = await __runtime.promptText(message, defaultValue);
        if (response.trim() === '' || Number.isNaN(Number(response))) {
          throw new Error('ValueError: could not convert string to float: ' + JSON.stringify(response));
        }
        return Number(response);
      },
      readVar(name, value) {
        if (value === undefined) {
          throw new Error("NameError: name '" + String(name) + "' is not defined");
        }
        return value;
      },
    };

    const __buildPromptDiagnostics = function() {
      const usedProvidedInputCount = __promptLog.filter((entry) => entry.usedProvidedInput).length;
      return {
        configuredInputCount: __initialPromptInputs.length,
        promptCallCount: __promptLog.length,
        usedProvidedInputCount,
        underflowCount: Math.max(0, __promptLog.length - usedProvidedInputCount),
        unusedInputCount: Math.max(0, __initialPromptInputs.length - usedProvidedInputCount),
      };
    };

    const __postResult = function(success, variables, error) {
      postMessage({
        success,
        stdout: __stdout.join('\\n') + (__stdout.length > 0 ? '\\n' : ''),
        variables,
        prompts: __promptLog.map((entry) => ({
          message: entry.message,
          response: entry.response,
          cancelled: entry.cancelled,
        })),
        promptDiagnostics: __buildPromptDiagnostics(),
        error,
      });
    };

    (async function runProgram() {
      try {
        const __fn = new AsyncFunction('__runtime', __programSource);
        const __variables = await __fn(__runtime);
        __postResult(true, __variables && typeof __variables === 'object' ? __variables : {}, null);
      } catch (error) {
        __postResult(false, {}, error instanceof Error ? error.message : String(error));
      }
    })();
  `;
}

function createScriptedInputProvider(promptInputs = []) {
  const queue = [...promptInputs];
  return async ({ defaultValue = '' } = {}) => {
    const normalizedDefault = defaultValue == null ? '' : String(defaultValue);
    const usedProvidedInput = queue.length > 0;
    return {
      response: usedProvidedInput ? String(queue.shift()) : normalizedDefault,
      usedProvidedInput,
      cancelled: false,
    };
  };
}

function createInteractiveInputProvider(requestInput) {
  return async ({ message, defaultValue = '', inputType = 'text' } = {}) => {
    const normalizedDefault = defaultValue == null ? '' : String(defaultValue);
    if (typeof requestInput !== 'function') {
      return {
        response: normalizedDefault,
        usedProvidedInput: false,
        cancelled: false,
      };
    }

    const response = await requestInput({
      message: String(message ?? ''),
      defaultValue: normalizedDefault,
      inputType,
    });

    return {
      response: response == null ? normalizedDefault : String(response),
      usedProvidedInput: true,
      cancelled: false,
    };
  };
}

function createExecutionContext({
  promptInputCount = null,
  inputProvider,
  onStdout = null,
  variableNames = [],
  isCancelled = null,
} = {}) {
  const stdout = [];
  const promptLog = [];
  const assertNotCancelled = () => {
    if (typeof isCancelled === 'function' && isCancelled()) {
      throw new Error(INTERACTIVE_RUN_CANCELLED_ERROR);
    }
  };

  const runtime = {
    async writeLine(...args) {
      assertNotCancelled();
      const line = args.map(String).join(' ');
      stdout.push(line);
      if (typeof onStdout === 'function') {
        onStdout(line);
      }
      return line;
    },
    async promptText(message, defaultValue = '') {
      assertNotCancelled();
      const normalizedMessage = String(message ?? '');
      const normalizedDefault = defaultValue == null ? '' : String(defaultValue);
      const inputResult = typeof inputProvider === 'function'
        ? await inputProvider({
            message: normalizedMessage,
            defaultValue: normalizedDefault,
            inputType: 'text',
          })
        : {
            response: normalizedDefault,
            usedProvidedInput: false,
            cancelled: false,
          };
      assertNotCancelled();

      const response = inputResult?.response == null
        ? normalizedDefault
        : String(inputResult.response);

      promptLog.push({
        message: normalizedMessage,
        response,
        cancelled: inputResult?.cancelled === true,
        usedProvidedInput: inputResult?.usedProvidedInput === true,
      });

      return response;
    },
    async promptNumber(message, defaultValue = '') {
      const response = await runtime.promptText(message, defaultValue);
      return coercePromptNumber(response);
    },
    readVar(name, value) {
      if (value === undefined) {
        throw new Error(`NameError: name '${String(name)}' is not defined`);
      }
      return value;
    },
  };

  return {
    stdout,
    promptLog,
    promptInputCount,
    runtime,
    variableNames,
  };
}

async function executeProgramWithContext(code, executionContext) {
  try {
    const variableCaptureSource = buildVariableCaptureSource(executionContext.variableNames || []);
    const programSource = buildExecutableProgramSource(code, variableCaptureSource);
    const variables = await new ASYNC_FUNCTION('__runtime', programSource)(executionContext.runtime);
    return buildExecutionResult(executionContext, {
      success: true,
      cancelled: false,
      variables: isObjectLike(variables) ? variables : {},
      error: null,
    });
  } catch (error) {
    return buildExecutionResult(executionContext, {
      success: false,
      cancelled: isCancellationError(error),
      variables: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildExecutionResult(executionContext, { success, cancelled = false, variables, error }) {
  const usedProvidedInputCount = executionContext.promptLog
    .filter((entry) => entry.usedProvidedInput)
    .length;

  return {
    success,
    cancelled,
    stdout: executionContext.stdout.join('\n') + (executionContext.stdout.length > 0 ? '\n' : ''),
    variables,
    prompts: executionContext.promptLog.map((entry) => ({
      message: entry.message,
      response: entry.response,
      cancelled: entry.cancelled,
    })),
    promptDiagnostics: executionContext.promptInputCount == null
      ? null
      : createPromptDiagnostics(
          executionContext.promptInputCount,
          executionContext.promptLog.length,
          usedProvidedInputCount,
        ),
    error,
  };
}

function isCancellationError(error) {
  return (error instanceof Error ? error.message : String(error)) === INTERACTIVE_RUN_CANCELLED_ERROR;
}

function coercePromptNumber(value) {
  const normalizedValue = String(value ?? '');
  if (normalizedValue.trim() === '') {
    throw new Error(`ValueError: could not convert string to float: ${JSON.stringify(normalizedValue)}`);
  }

  const numericValue = Number(normalizedValue);
  if (Number.isNaN(numericValue)) {
    throw new Error(`ValueError: could not convert string to float: ${JSON.stringify(normalizedValue)}`);
  }

  return numericValue;
}

function isObjectLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertStdout(tc, executionResult) {
  const points = getTestPoints(tc);
  const promptMismatch = shouldEnforcePromptInputCount(tc)
    ? getPromptMismatch(executionResult)
    : null;

  if (promptMismatch) {
    return {
      id: tc.id,
      passed: false,
      points,
      score: 0,
      feedback: promptMismatch.feedback,
      detail: promptMismatch.detail,
      student_detail: promptMismatch.detail,
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

  const assertions = [];
  const outputAssertion = getStdoutOutputAssertion(tc);
  if (outputAssertion.enabled) {
    assertions.push(evaluateRuntimeTextAssertion({
      assertion: outputAssertion,
      actual: executionResult.stdout,
      label: 'Output',
      defaultSuccessMessage: 'Output matches!',
      defaultFailureMessage: 'Expected output did not match.',
    }));
  }

  const promptAssertion = getStdoutPromptAssertion(tc);
  if (promptAssertion.enabled) {
    assertions.push(evaluateRuntimeTextAssertion({
      assertion: promptAssertion,
      actual: getPromptTranscript(executionResult.prompts),
      actualItems: getPromptMessages(executionResult.prompts),
      label: 'Prompt text',
      defaultSuccessMessage: 'Prompt text matches!',
      defaultFailureMessage: 'Expected prompt text did not match.',
    }));
  }

  const failedAssertions = assertions.filter((assertion) => !assertion.passed);
  const passed = failedAssertions.length === 0;

  return {
    id: tc.id,
    passed,
    points,
    score: passed ? points : 0,
    feedback: passed
      ? tc.feedback_on_pass || buildStdoutSuccessFeedback(assertions)
      : buildStdoutFailureFeedback(tc, failedAssertions),
    detail: passed ? null : failedAssertions.map((assertion) => assertion.detail).join('\n\n'),
    student_detail: passed ? null : buildStudentFacingAssertionDetail(failedAssertions),
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
      ? tc.feedback_on_pass || 'Block structure is correct!'
      : tc.feedback_on_fail || 'Required block arrangement not found.',
    detail: result.detail,
  };
}

function assertVariableState(tc, executionResult) {
  const points = getTestPoints(tc);
  const promptMismatch = shouldEnforcePromptInputCount(tc)
    ? getPromptMismatch(executionResult)
    : null;

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

  const checks = [];
  const studentHints = [];
  const actualType = getValueType(actual);
  const expectedType = normalizeVariableType(tc.expected_type);

  if (expectedType !== 'any') {
    const passed = actualType === expectedType;
    checks.push({
      passed,
      detail: passed
        ? `Type matches expected ${expectedType}`
        : `Expected ${tc.variable_name} to be ${expectedType}, got ${actualType}`,
    });
  }

  const valueAssertionEnabled = normalizeVariableValueAssertionEnabled(tc);
  const comparison = tc.comparison || 'equals';
  const expected = tc.expected_value;

  if (valueAssertionEnabled) {
    const valuePassed = compareVariableValues(actual, expected, comparison);
    checks.push({
      passed: valuePassed,
      detail: valuePassed
        ? `Value comparison passed (${comparison})`
        : `Expected ${tc.variable_name} ${comparison} ${formatDebugValue(expected)}, got ${formatDebugValue(actual)}`,
    });

    if (
      !valuePassed
      && tc.show_coerced_value_hint
      && expectedType !== 'any'
      && expectedType !== 'list'
    ) {
      const coercedActual = coerceValueForType(actual, expectedType);
      if (coercedActual !== COERCION_FAILED && compareVariableValues(coercedActual, expected, comparison)) {
        studentHints.push(
          `The value is correct, but not the correct type. ${capitalizeIdentifier(tc.variable_name)} is ${withIndefiniteArticle(actualType)}, not ${withIndefiniteArticle(expectedType)}.`,
        );
      }
    } else if (
      valuePassed
      && tc.show_coerced_value_hint
      && expectedType !== 'any'
      && expectedType !== 'list'
      && actualType !== expectedType
    ) {
      const coercedActual = coerceValueForType(actual, expectedType);
      if (coercedActual !== COERCION_FAILED && compareVariableValues(coercedActual, expected, comparison)) {
        studentHints.push(
          `The value is correct, but not the correct type. ${capitalizeIdentifier(tc.variable_name)} should be ${withIndefiniteArticle(expectedType)}, not ${withIndefiniteArticle(actualType)}.`,
        );
      }
    }
  }

  const listAssertions = getVariableListAssertions(tc);
  if (hasAnyListChecks(listAssertions)) {
    if (!Array.isArray(actual)) {
      checks.push({
        passed: false,
        detail: `Expected ${tc.variable_name} to be a list before applying list assertions, got ${actualType}`,
      });
    } else {
      checks.push(...evaluateListAssertions(tc.variable_name, actual, listAssertions, tc.show_coerced_value_hint, studentHints));
    }
  }

  const failedChecks = checks.filter((check) => !check.passed);
  const passed = failedChecks.length === 0;

  return {
    id: tc.id,
    passed,
    points,
    score: passed ? points : 0,
    feedback: passed
      ? tc.feedback_on_pass || `Variable "${tc.variable_name}" has the correct value!`
      : tc.feedback_on_fail || `Variable "${tc.variable_name}" doesn't have the expected value.`,
    detail: passed ? null : failedChecks.map((check) => check.detail).join('\n\n'),
    student_detail: !passed && studentHints.length > 0 ? studentHints.join('\n\n') : null,
  };
}

const COERCION_FAILED = Symbol('coercion-failed');

function hasAnyListChecks(listAssertions) {
  return listAssertions.length_enabled
    || listAssertions.values_enabled
    || listAssertions.item_types_enabled
    || listAssertions.index_checks.length > 0;
}

function compareVariableValues(actual, expected, comparison) {
  switch (comparison) {
    case 'equals':
      return actual == expected;
    case 'gt':
      return actual > expected;
    case 'lt':
      return actual < expected;
    case 'gte':
      return actual >= expected;
    case 'lte':
      return actual <= expected;
    case 'contains':
      return String(actual).includes(String(expected));
    case 'type':
      return typeof actual === expected;
    default:
      return false;
  }
}

function getValueType(value) {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'number') return 'float';
  if (value === null) return 'null';
  return typeof value;
}

function coerceValueForType(value, expectedType) {
  switch (expectedType) {
    case 'int':
      if (typeof value === 'number') return Math.trunc(value);
      if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
        return Math.trunc(Number(value));
      }
      return COERCION_FAILED;
    case 'float':
      if (typeof value === 'number') return Number(value);
      if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
        return Number(value);
      }
      return COERCION_FAILED;
    case 'string':
      return String(value);
    default:
      return COERCION_FAILED;
  }
}

function evaluateListAssertions(variableName, actualList, listAssertions, showCoercedValueHint, studentHints) {
  const checks = [];

  if (listAssertions.length_enabled) {
    const actualLength = actualList.length;
    const expectedLength = listAssertions.length_value;
    const comparisonPassed = compareVariableValues(actualLength, expectedLength, listAssertions.length_comparison);
    checks.push({
      passed: comparisonPassed,
      detail: comparisonPassed
        ? `List length ${listAssertions.length_comparison} ${expectedLength}`
        : `Expected ${variableName} length ${listAssertions.length_comparison} ${expectedLength}, got ${actualLength}`,
    });
  }

  if (listAssertions.values_enabled) {
    const valuesPassed = compareListValues(actualList, listAssertions.expected_values, listAssertions.values_match_mode);
    checks.push({
      passed: valuesPassed,
      detail: valuesPassed
        ? `List values matched (${listAssertions.values_match_mode})`
        : `Expected ${variableName} values to match mode ${listAssertions.values_match_mode}. Expected ${formatDebugValue(listAssertions.expected_values)}, got ${formatDebugValue(actualList)}`,
    });
  }

  if (listAssertions.item_types_enabled) {
    const itemTypesPassed = compareListItemTypes(actualList, listAssertions.expected_item_types, listAssertions.item_type_mode);
    checks.push({
      passed: itemTypesPassed,
      detail: itemTypesPassed
        ? `List item types matched mode ${listAssertions.item_type_mode}`
        : `Expected ${variableName} item types to satisfy ${listAssertions.item_type_mode} ${listAssertions.expected_item_types.join(', ')}, got ${actualList.map(getValueType).join(', ') || 'empty list'}`,
    });
  }

  for (const check of listAssertions.index_checks) {
    const entry = actualList[check.index];
    const exists = check.index < actualList.length;
    if (!exists) {
      checks.push({
        passed: false,
        detail: `Expected ${variableName}[${check.index}] to exist, but the list length is ${actualList.length}`,
      });
      continue;
    }

    const entryChecks = [];
    const entryType = getValueType(entry);
    const expectedType = normalizeVariableType(check.expected_type);

    if (expectedType !== 'any') {
      entryChecks.push({
        passed: entryType === expectedType,
        detail: `Expected ${variableName}[${check.index}] to be ${expectedType}, got ${entryType}`,
      });
    }
    if (check.expected_value !== undefined) {
      const valuePassed = compareVariableValues(entry, check.expected_value, 'equals');
      entryChecks.push({
        passed: valuePassed,
        detail: `Expected ${variableName}[${check.index}] to equal ${formatDebugValue(check.expected_value)}, got ${formatDebugValue(entry)}`,
      });
      if (
        !valuePassed
        && showCoercedValueHint
        && expectedType !== 'any'
        && expectedType !== 'list'
      ) {
        const coercedEntry = coerceValueForType(entry, expectedType);
        if (coercedEntry !== COERCION_FAILED && compareVariableValues(coercedEntry, check.expected_value, 'equals')) {
          studentHints.push(
            `The value at ${variableName}[${check.index}] is correct, but not the correct type. It is ${withIndefiniteArticle(entryType)}, not ${withIndefiniteArticle(expectedType)}.`,
          );
        }
      }
    }

    const failedEntryChecks = entryChecks.filter((entryCheck) => !entryCheck.passed);
    checks.push({
      passed: failedEntryChecks.length === 0,
      detail: failedEntryChecks.length === 0
        ? `${variableName}[${check.index}] matched the expected index rule`
        : failedEntryChecks.map((entryCheck) => entryCheck.detail).join('\n'),
    });
  }

  return checks;
}

function compareListValues(actualList, expectedValues, matchMode) {
  switch (matchMode) {
    case 'exact_order':
      return deepEqual(actualList, expectedValues);
    case 'same_values_any_order':
      return multisetIncludes(actualList, expectedValues) && multisetIncludes(expectedValues, actualList);
    case 'expected_subset_of_actual':
      return multisetIncludes(actualList, expectedValues);
    case 'expected_superset_of_actual':
      return multisetIncludes(expectedValues, actualList);
    default:
      return false;
  }
}

function compareListItemTypes(actualList, expectedTypes, mode) {
  const actualTypes = actualList.map(getValueType);
  const matches = actualTypes.map((type) => expectedTypes.includes(type));
  switch (mode) {
    case 'all':
      return matches.every(Boolean);
    case 'some':
      return matches.some(Boolean);
    case 'none':
      return matches.every((match) => !match);
    default:
      return false;
  }
}

function multisetIncludes(containerValues, candidateValues) {
  const counts = new Map();
  for (const value of containerValues) {
    const key = serializeComparableValue(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const value of candidateValues) {
    const key = serializeComparableValue(value);
    const remaining = counts.get(key) || 0;
    if (remaining <= 0) return false;
    counts.set(key, remaining - 1);
  }
  return true;
}

function deepEqual(left, right) {
  return serializeComparableValue(left) === serializeComparableValue(right);
}

function serializeComparableValue(value) {
  return JSON.stringify(value);
}

function formatDebugValue(value) {
  return JSON.stringify(value);
}

function withIndefiniteArticle(typeName) {
  if (typeof typeName !== 'string' || typeName === '') return String(typeName);
  return /^[aeiou]/i.test(typeName) ? `an ${typeName}` : `a ${typeName}`;
}

function capitalizeIdentifier(name) {
  const text = String(name ?? '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'The variable';
}

function formatStudentFacingValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => `[${index}] ${formatStudentFacingValue(item)}`).join('\n');
  }
  return JSON.stringify(value, null, 2);
}

function getExecutionPlanKey(promptInputs) {
  return JSON.stringify(promptInputs);
}

function getPromptInputs(testCase) {
  return getConfiguredPromptInputs(testCase);
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

function evaluateRuntimeTextAssertion({
  assertion,
  actual,
  actualItems = [],
  label,
  defaultSuccessMessage,
  defaultFailureMessage,
}) {
  const valuesToCheck = assertion.match_any_item ? actualItems : [actual];
  const passed = valuesToCheck.some((candidate) => doesRuntimeTextMatch(candidate, assertion.expected, assertion.match_mode));
  const actualForDisplay = assertion.match_any_item ? valuesToCheck : actual;
  const scopeLabel = assertion.match_any_item ? 'any single item' : 'combined transcript';

  const successMessage = assertion.success_message || defaultSuccessMessage;
  const failureMessage = assertion.failure_message || defaultFailureMessage;

  return {
    label,
    expected: assertion.expected,
    actual: actualForDisplay,
    passed,
    feedback: passed ? successMessage : failureMessage,
    usedCustomSuccessMessage: Boolean(assertion.success_message),
    usedCustomFailureMessage: Boolean(assertion.failure_message),
    detail: `${label} (${assertion.match_mode}, ${scopeLabel})\nExpected: ${JSON.stringify(assertion.expected)}\nGot: ${JSON.stringify(actualForDisplay)}`,
    studentDetail: passed ? null : createStudentAssertionDetail(label, assertion, actualForDisplay),
  };
}

function doesRuntimeTextMatch(actual, expected, matchMode) {
  switch (matchMode) {
    case 'exact':
      return actual === expected;
    case 'contains':
      return actual.includes(expected);
    case 'regex':
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function buildStdoutSuccessFeedback(assertions) {
  const customMessages = assertions
    .filter((assertion) => assertion.usedCustomSuccessMessage)
    .map((assertion) => assertion.feedback);

  if (customMessages.length > 0) {
    return customMessages.join(' ');
  }

  if (assertions.length === 1) {
    return assertions[0].feedback;
  }

  return 'Prompt text and output match!';
}

function buildStdoutFailureFeedback(testCase, failedAssertions) {
  if (failedAssertions.some((assertion) => assertion.usedCustomFailureMessage)) {
    return failedAssertions.map((assertion) => assertion.feedback).join(' ');
  }

  if (testCase.feedback_on_fail) {
    return testCase.feedback_on_fail;
  }

  if (failedAssertions.length === 1) {
    return failedAssertions[0].feedback;
  }

  return 'Prompt text and output did not match.';
}

function buildStudentFacingAssertionDetail(failedAssertions) {
  const sections = failedAssertions
    .map((assertion) => assertion.studentDetail)
    .filter(Boolean)
    .flatMap((detail) => Array.isArray(detail.sections) ? detail.sections : []);

  return sections.length > 0 ? { sections } : null;
}

function createStudentAssertionDetail(label, assertion, actual) {
  const sections = [];
  if (assertion.show_expected) {
    sections.push({
      title: `Expected ${label.toLowerCase()}`,
      value: formatStudentFacingValue(assertion.expected),
    });
  }
  if (assertion.show_actual) {
    sections.push({
      title: `Actual ${label.toLowerCase()}`,
      value: formatStudentFacingValue(actual),
    });
  }
  return sections.length > 0 ? { sections } : null;
}

function getPromptTranscript(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) return '';
  return prompts.map((entry) => String(entry?.message ?? '')).join('\n');
}

function getPromptMessages(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) return [];
  return prompts.map((entry) => String(entry?.message ?? ''));
}
