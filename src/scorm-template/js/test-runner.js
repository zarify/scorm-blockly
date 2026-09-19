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
