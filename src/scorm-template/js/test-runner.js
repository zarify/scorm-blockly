/**
 * Test Runner — Executes student code and evaluates against test cases.
 *
 * Three assertion types:
 * - stdout_match: compare configured runtime text assertions (stdout, prompt text, or both)
 * - block_structure: inspect workspace for required block patterns
 * - variable_state: inspect variable values after execution
 * - function_state: inspect function definitions and return values
 *
 * Code runs in a Web Worker with a timeout to prevent infinite loops.
 */

import { evaluateCondition } from '../../shared/workspace-inspector.js';
import {
  getFunctionReturnAssertion,
  getPromptInputs as getConfiguredPromptInputs,
  getStdoutExecutionContext,
  getVariableListAssertions,
  getStdoutOutputAssertion,
  getStdoutPromptAssertion,
  normalizeFunctionParameterCountEnabled,
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
      case 'function_state':
        result = assertFunctionState(tc, executionResult);
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
    if (tc.type === 'stdout_match') {
      const stdoutExecutionContext = getStdoutExecutionContext(tc);
      if (stdoutExecutionContext.scope === 'function') {
        executionPlans.set(getStdoutExecutionPlanKey(tc), {
          promptInputs: getPromptInputs(tc),
          variableNames: new Set(),
          functionNames: new Set(stdoutExecutionContext.function_name ? [stdoutExecutionContext.function_name] : []),
          functionCalls: [
            createFunctionCallPlan(
              stdoutExecutionContext.function_name,
              stdoutExecutionContext.arguments,
            ),
          ],
        });
        continue;
      }
    }

    if (tc.type === 'stdout_match' || tc.type === 'variable_state') {
      const promptInputs = getPromptInputs(tc);
      const planKey = getExecutionPlanKey(promptInputs);
      if (!executionPlans.has(planKey)) {
        executionPlans.set(planKey, {
          promptInputs,
          variableNames: new Set(),
          functionNames: new Set(),
          functionCalls: [],
        });
      }

      if (tc.type === 'variable_state' && tc.variable_name) {
        executionPlans.get(planKey).variableNames.add(tc.variable_name);
      }
      continue;
    }

    if (tc.type === 'function_state') {
      const returnAssertion = getFunctionReturnAssertion(tc);
      const functionCalls = returnAssertion.enabled && tc.function_name
        ? [createFunctionCallPlan(tc.function_name, returnAssertion.arguments)]
        : [];
      executionPlans.set(getFunctionExecutionPlanKey(tc), {
        promptInputs: [],
        variableNames: new Set(),
        functionNames: new Set(tc.function_name ? [tc.function_name] : []),
        functionCalls,
      });
    }
  }

  return executionPlans;
}

async function getExecutionResultForTest(testCase, generatedCode, executionPlans, executionResults) {
  if (
    testCase.type !== 'stdout_match'
    && testCase.type !== 'variable_state'
    && testCase.type !== 'function_state'
  ) {
    return null;
  }

  const planKey = testCase.type === 'function_state'
    ? getFunctionExecutionPlanKey(testCase)
    : testCase.type === 'stdout_match' && getStdoutExecutionContext(testCase).scope === 'function'
      ? getStdoutExecutionPlanKey(testCase)
    : getExecutionPlanKey(getPromptInputs(testCase));
  const plan = executionPlans.get(planKey);

  if (!executionResults.has(planKey)) {
    executionResults.set(
      planKey,
      await executeCode(generatedCode, {
        promptInputs: plan.promptInputs,
        variableNames: [...plan.variableNames],
        functionNames: [...plan.functionNames],
        functionCalls: plan.functionCalls,
      }),
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
  if (typeof Worker === 'function') {
    return executeInteractiveRunInWorker(generatedCode, hooks);
  }

  // No Worker (Node, or a browser without one): run on this thread, where
  // cancellation is cooperative and only takes effect at a print or a prompt.
  const executionContext = createExecutionContext({
    promptInputCount: null,
    inputProvider: createInteractiveInputProvider(hooks.requestInput),
    onStdout: hooks.onStdout,
    isCancelled: hooks.isCancelled,
  });

  return executeProgramWithContext(generatedCode, executionContext);
}

/**
 * Run the student's program in a Worker.
 *
 * There is deliberately no deadline here, unlike `executeCode` for grading: a
 * Run may legitimately be waiting at a prompt for as long as the student needs,
 * and a Worker parked on `await` costs nothing. The Worker is for the two things
 * a run on this thread cannot do — keep the page answering input while the
 * program works, and stop it outright when the student cancels.
 *
 * @param {string} generatedCode
 * @param {{
 *   onStdout?: (line: string) => void,
 *   requestInput?: (request: { message: string, defaultValue: string, inputType: string }) => Promise<string> | string,
 *   registerTerminate?: (terminate: () => void) => void,
 * }} [hooks] - `registerTerminate` receives a function that kills the program
 *   immediately, wherever it is (a loop, a prompt, anything).
 * @returns {Promise<object>} the same execution result shape as the fallback
 */
function executeInteractiveRunInWorker(generatedCode, hooks = {}) {
  const programSource = buildExecutableProgramSource(generatedCode, buildExecutionCaptureSource({}));
  const workerSource = buildInteractiveWorkerSource(programSource);
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));
  const worker = new Worker(url);

  const stdout = [];
  const promptLog = [];
  let settled = false;

  return new Promise((resolve) => {
    const finish = ({ success, cancelled = false, error = null }) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({
        success,
        cancelled,
        stdout: stdout.length > 0 ? `${stdout.join('\n')}\n` : '',
        variables: {},
        functions: {},
        functionCalls: {},
        prompts: promptLog.map((entry) => ({ ...entry })),
        promptDiagnostics: null,
        error,
      });
    };

    hooks.registerTerminate?.(() => {
      finish({ success: false, cancelled: true, error: INTERACTIVE_RUN_CANCELLED_ERROR });
    });

    worker.onmessage = async (event) => {
      const message = event.data || {};

      if (message.type === 'stdout') {
        stdout.push(message.line);
        hooks.onStdout?.(message.line);
        return;
      }

      if (message.type === 'input') {
        if (settled) return;

        let response = message.defaultValue == null ? '' : String(message.defaultValue);
        try {
          if (typeof hooks.requestInput === 'function') {
            const answer = await hooks.requestInput({
              message: message.message,
              defaultValue: response,
              inputType: message.inputType,
            });
            response = answer == null ? '' : String(answer);
          }
        } catch {
          // The student cancelled at the prompt: that is a cancelled run, and the
          // program is still parked in the Worker, so it has to be killed.
          promptLog.push({ message: message.message, response: '', cancelled: true, usedProvidedInput: false });
          finish({ success: false, cancelled: true, error: INTERACTIVE_RUN_CANCELLED_ERROR });
          return;
        }

        promptLog.push({ message: message.message, response, cancelled: false, usedProvidedInput: false });
        if (!settled) {
          worker.postMessage({ type: 'input-response', requestId: message.requestId, value: response });
        }
        return;
      }

      if (message.type === 'done') {
        finish({ success: message.success === true, error: message.error ?? null });
      }
    };

    worker.onerror = (event) => {
      finish({ success: false, error: event?.message || 'Worker error' });
    };
  });
}

/**
 * The Worker half of an interactive run: streams output, asks the page for input
 * and waits for the answer, and reports how the program ended.
 * @param {string} programSource
 * @returns {string}
 */
function buildInteractiveWorkerSource(programSource) {
  return `
    const AsyncFunction = Object.getPrototypeOf(async function emptyAsyncFunction() {}).constructor;
    const __programSource = ${JSON.stringify(programSource)};
    const __pendingInputs = new Map();
    let __nextRequestId = 0;

    self.onmessage = (event) => {
      const message = event.data || {};
      const pending = __pendingInputs.get(message.requestId);
      if (!pending) return;
      __pendingInputs.delete(message.requestId);
      if (message.type === 'input-response') {
        pending.resolve(String(message.value ?? ''));
      } else {
        pending.reject(new Error(${JSON.stringify(INTERACTIVE_RUN_CANCELLED_ERROR)}));
      }
    };

    function __requestInput(message, defaultValue, inputType) {
      const requestId = __nextRequestId++;
      return new Promise((resolve, reject) => {
        __pendingInputs.set(requestId, { resolve, reject });
        postMessage({ type: 'input', requestId, message, defaultValue, inputType });
      });
    }

    const __runtime = {
      async writeLine() {
        const line = Array.from(arguments).map(String).join(' ');
        postMessage({ type: 'stdout', line });
        return line;
      },
      async promptText(message, defaultValue = '') {
        const normalizedMessage = String(message ?? '');
        const normalizedDefault = defaultValue == null ? '' : String(defaultValue);
        return __requestInput(normalizedMessage, normalizedDefault, 'text');
      },
      async promptNumber(message, defaultValue = '') {
        const response = await __runtime.promptText(message, defaultValue);
        if (String(response).trim() === '' || Number.isNaN(Number(response))) {
          throw new Error('ValueError: could not convert string to float: ' + JSON.stringify(String(response)));
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

    (async function runProgram() {
      try {
        const __fn = new AsyncFunction('__runtime', __programSource);
        await __fn(__runtime);
        postMessage({ type: 'done', success: true, error: null });
      } catch (error) {
        postMessage({ type: 'done', success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  `;
}

/**
 * Execute code in a sandboxed environment with timeout.
 * Uses a Web Worker if available, falls back to Function constructor.
 */
async function executeCode(code, executionPlan = {}) {
  const promptInputs = Array.isArray(executionPlan.promptInputs) ? executionPlan.promptInputs : [];
  const variableNames = Array.isArray(executionPlan.variableNames) ? executionPlan.variableNames : [];
  const functionNames = Array.isArray(executionPlan.functionNames) ? executionPlan.functionNames : [];
  const functionCalls = Array.isArray(executionPlan.functionCalls) ? executionPlan.functionCalls : [];
  const captureSource = buildExecutionCaptureSource({ variableNames, functionNames, functionCalls });
  const promptInputCount = promptInputs.length;
  const programSource = buildExecutableProgramSource(code, captureSource);
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
      resolve(executeCodeDirect(code, executionPlan));
    }
  });
}

/**
 * Fallback: execute code directly (no worker isolation).
 */
async function executeCodeDirect(code, executionPlan = {}) {
  const promptInputs = Array.isArray(executionPlan.promptInputs) ? executionPlan.promptInputs : [];
  const executionContext = createExecutionContext({
    promptInputCount: promptInputs.length,
    inputProvider: createScriptedInputProvider(promptInputs),
    variableNames: Array.isArray(executionPlan.variableNames) ? executionPlan.variableNames : [],
    functionNames: Array.isArray(executionPlan.functionNames) ? executionPlan.functionNames : [],
    functionCalls: Array.isArray(executionPlan.functionCalls) ? executionPlan.functionCalls : [],
  });

  return executeProgramWithContext(code, executionContext);
}

function buildExecutableProgramSource(code, captureSource) {
  return [
    'const console = { log: (...args) => __runtime.writeLine(...args) };',
    code,
    `return ${captureSource};`,
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
      inspectFunction(name, value) {
        const defined = value !== undefined;
        return {
          name: String(name),
          defined,
          isFunction: typeof value === 'function',
          valueType: defined ? __runtime.getValueType(value) : 'undefined',
          parameterCount: typeof value === 'function' ? value.length : null,
        };
      },
      async invokeFunction(name, value, args) {
        const stdoutStart = __stdout.length;
        const promptStart = __promptLog.length;
        const info = __runtime.inspectFunction(name, value);
        if (!info.isFunction) {
          return {
            called: false,
            success: false,
            returnValue: undefined,
            returnType: 'undefined',
            error: info.defined
              ? String(name) + ' is defined, but it is ' + info.valueType + ' instead of a function'
              : "NameError: name '" + String(name) + "' is not defined",
            stdout: '',
            prompts: [],
          };
        }
        try {
          const returnValue = await value(...(Array.isArray(args) ? args : []));
          return {
            called: true,
            success: true,
            returnValue,
            returnType: __runtime.getValueType(returnValue),
            error: null,
            stdout: __stdout.slice(stdoutStart).join('\\n') + (__stdout.length > stdoutStart ? '\\n' : ''),
            prompts: __promptLog.slice(promptStart).map((entry) => ({
              message: entry.message,
              response: entry.response,
              cancelled: entry.cancelled,
            })),
          };
        } catch (error) {
          return {
            called: true,
            success: false,
            returnValue: undefined,
            returnType: 'undefined',
            error: error instanceof Error ? error.message : String(error),
            stdout: __stdout.slice(stdoutStart).join('\\n') + (__stdout.length > stdoutStart ? '\\n' : ''),
            prompts: __promptLog.slice(promptStart).map((entry) => ({
              message: entry.message,
              response: entry.response,
              cancelled: entry.cancelled,
            })),
          };
        }
      },
      getValueType(value) {
        if (Array.isArray(value)) return 'list';
        if (typeof value === 'string') return 'string';
        if (typeof value === 'number' && Number.isFinite(value)) {
          return Number.isInteger(value) ? 'int' : 'float';
        }
        if (typeof value === 'number') return 'float';
        if (value === null) return 'null';
        return typeof value;
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

    const __postResult = function(success, executionState, error) {
      postMessage({
        success,
        stdout: __stdout.join('\\n') + (__stdout.length > 0 ? '\\n' : ''),
        variables: executionState && executionState.variables && typeof executionState.variables === 'object' ? executionState.variables : {},
        functions: executionState && executionState.functions && typeof executionState.functions === 'object' ? executionState.functions : {},
        functionCalls: executionState && executionState.functionCalls && typeof executionState.functionCalls === 'object' ? executionState.functionCalls : {},
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
        const __executionState = await __fn(__runtime);
        __postResult(true, __executionState && typeof __executionState === 'object' ? __executionState : {}, null);
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
  functionNames = [],
  functionCalls = [],
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
    inspectFunction(name, value) {
      const defined = value !== undefined;
      return {
        name: String(name),
        defined,
        isFunction: typeof value === 'function',
        valueType: getValueType(value),
        parameterCount: typeof value === 'function' ? value.length : null,
      };
    },
    async invokeFunction(name, value, args) {
      const stdoutStart = stdout.length;
      const promptStart = promptLog.length;
      const info = runtime.inspectFunction(name, value);
      if (!info.isFunction) {
        return {
          called: false,
          success: false,
          returnValue: undefined,
          returnType: 'undefined',
          error: info.defined
            ? `${String(name)} is defined, but it is ${info.valueType} instead of a function`
            : `NameError: name '${String(name)}' is not defined`,
          stdout: '',
          prompts: [],
        };
      }
      try {
        const returnValue = await value(...(Array.isArray(args) ? args : []));
        return {
          called: true,
          success: true,
          returnValue,
          returnType: getValueType(returnValue),
          error: null,
          stdout: stdout.slice(stdoutStart).join('\n') + (stdout.length > stdoutStart ? '\n' : ''),
          prompts: promptLog.slice(promptStart).map((entry) => ({
            message: entry.message,
            response: entry.response,
            cancelled: entry.cancelled,
          })),
        };
      } catch (error) {
        return {
          called: true,
          success: false,
          returnValue: undefined,
          returnType: 'undefined',
          error: error instanceof Error ? error.message : String(error),
          stdout: stdout.slice(stdoutStart).join('\n') + (stdout.length > stdoutStart ? '\n' : ''),
          prompts: promptLog.slice(promptStart).map((entry) => ({
            message: entry.message,
            response: entry.response,
            cancelled: entry.cancelled,
          })),
        };
      }
    },
  };

  return {
    stdout,
    promptLog,
    promptInputCount,
    runtime,
    variableNames,
    functionNames,
    functionCalls,
  };
}

async function executeProgramWithContext(code, executionContext) {
  try {
    const captureSource = buildExecutionCaptureSource({
      variableNames: executionContext.variableNames || [],
      functionNames: executionContext.functionNames || [],
      functionCalls: executionContext.functionCalls || [],
    });
    const programSource = buildExecutableProgramSource(code, captureSource);
    const executionState = await new ASYNC_FUNCTION('__runtime', programSource)(executionContext.runtime);
    return buildExecutionResult(executionContext, {
      success: true,
      cancelled: false,
      executionState: isObjectLike(executionState) ? executionState : {},
      error: null,
    });
  } catch (error) {
    return buildExecutionResult(executionContext, {
      success: false,
      cancelled: isCancellationError(error),
      executionState: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildExecutionResult(executionContext, { success, cancelled = false, executionState, error }) {
  const usedProvidedInputCount = executionContext.promptLog
    .filter((entry) => entry.usedProvidedInput)
    .length;

  return {
    success,
    cancelled,
    stdout: executionContext.stdout.join('\n') + (executionContext.stdout.length > 0 ? '\n' : ''),
    variables: isObjectLike(executionState?.variables) ? executionState.variables : {},
    functions: isObjectLike(executionState?.functions) ? executionState.functions : {},
    functionCalls: isObjectLike(executionState?.functionCalls) ? executionState.functionCalls : {},
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

  const stdoutExecutionContext = getStdoutExecutionContext(tc);
  let actualStdout = executionResult.stdout;
  let actualPrompts = executionResult.prompts;

  if (stdoutExecutionContext.scope === 'function') {
    const callKey = getFunctionCallKey(
      stdoutExecutionContext.function_name,
      stdoutExecutionContext.arguments,
    );
    const callResult = executionResult.functionCalls?.[callKey];

    if (!callResult) {
      return {
        id: tc.id,
        passed: false,
        points,
        score: 0,
        feedback: tc.feedback_on_fail || `Function "${stdoutExecutionContext.function_name}" could not be called.`,
        detail: `The configured call to ${formatFunctionCall(stdoutExecutionContext.function_name, stdoutExecutionContext.arguments)} did not run.`,
      };
    }

    if (!callResult.success) {
      return {
        id: tc.id,
        passed: false,
        points,
        score: 0,
        feedback: tc.feedback_on_fail || `Function "${stdoutExecutionContext.function_name}" could not be called.`,
        detail: `Calling ${formatFunctionCall(stdoutExecutionContext.function_name, stdoutExecutionContext.arguments)} failed: ${callResult.error}`,
      };
    }

    actualStdout = callResult.stdout;
    actualPrompts = callResult.prompts;
  }

  const assertions = [];
  const outputAssertion = getStdoutOutputAssertion(tc);
  if (outputAssertion.enabled) {
    assertions.push(evaluateRuntimeTextAssertion({
      assertion: outputAssertion,
      actual: actualStdout,
      label: 'Output',
      defaultSuccessMessage: 'Output matches!',
      defaultFailureMessage: 'Expected output did not match.',
    }));
  }

  const promptAssertion = getStdoutPromptAssertion(tc);
  if (promptAssertion.enabled) {
    assertions.push(evaluateRuntimeTextAssertion({
      assertion: promptAssertion,
      actual: getPromptTranscript(actualPrompts),
      actualItems: getPromptMessages(actualPrompts),
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

function assertFunctionState(tc, executionResult) {
  const points = getTestPoints(tc);

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

  const functionInfo = executionResult.functions?.[tc.function_name];
  if (!functionInfo?.defined) {
    return {
      id: tc.id,
      passed: false,
      points,
      score: 0,
      feedback: tc.feedback_on_fail || `Function "${tc.function_name}" was not found after execution.`,
      detail: `Available functions: ${Object.keys(executionResult.functions || {}).filter((name) => executionResult.functions?.[name]?.isFunction).join(', ') || 'none'}`,
    };
  }

  if (!functionInfo.isFunction) {
    return {
      id: tc.id,
      passed: false,
      points,
      score: 0,
      feedback: tc.feedback_on_fail || `Function "${tc.function_name}" is not callable.`,
      detail: `"${tc.function_name}" is defined, but it is ${withIndefiniteArticle(functionInfo.valueType)} instead of a function.`,
    };
  }

  const checks = [];
  const returnAssertion = getFunctionReturnAssertion(tc);

  if (normalizeFunctionParameterCountEnabled(tc)) {
    const expectedParameterCount = Math.max(0, Math.trunc(Number(tc.parameter_count) || 0));
    const parameterCountPassed = functionInfo.parameterCount === expectedParameterCount;
    checks.push({
      passed: parameterCountPassed,
      detail: parameterCountPassed
        ? `Function declares ${expectedParameterCount} parameter(s)`
        : `Expected ${tc.function_name} to declare ${expectedParameterCount} parameter(s), got ${functionInfo.parameterCount}`,
    });
  }

  if (returnAssertion.enabled) {
    const callKey = getFunctionCallKey(tc.function_name, returnAssertion.arguments);
    const callResult = executionResult.functionCalls?.[callKey];
    const returnCheck = evaluateFunctionReturnAssertion(tc.function_name, returnAssertion, callResult);
    checks.push(returnCheck);
  }

  const failedChecks = checks.filter((check) => !check.passed);
  const passed = failedChecks.length === 0;
  const onlyFailedCheck = failedChecks.length === 1 ? failedChecks[0] : null;
  const returnAssertionUsed = returnAssertion.enabled;

  return {
    id: tc.id,
    passed,
    points,
    score: passed ? points : 0,
    feedback: passed
      ? tc.feedback_on_pass
        || (returnAssertionUsed && returnAssertion.success_message
          ? returnAssertion.success_message
          : buildFunctionSuccessFeedback(tc))
      : onlyFailedCheck?.customFailureMessage
        || tc.feedback_on_fail
        || buildFunctionFailureFeedback(tc, onlyFailedCheck),
    detail: passed ? null : failedChecks.map((check) => check.detail).join('\n\n'),
    student_detail: passed ? null : buildCombinedStudentDetail({
      note: failedChecks.map((check) => check.studentNote).filter(Boolean).join('\n\n') || null,
      sections: failedChecks.flatMap((check) => Array.isArray(check.studentSections) ? check.studentSections : []),
    }),
  };
}

const COERCION_FAILED = Symbol('coercion-failed');

function evaluateFunctionReturnAssertion(functionName, returnAssertion, callResult) {
  if (!callResult) {
    return {
      passed: false,
      detail: `The configured call to ${formatFunctionCall(functionName, returnAssertion.arguments)} did not run.`,
      customFailureMessage: returnAssertion.failure_message || '',
      studentNote: null,
      studentSections: [],
    };
  }

  if (!callResult.success) {
    return {
      passed: false,
      detail: `Calling ${formatFunctionCall(functionName, returnAssertion.arguments)} failed: ${callResult.error}`,
      customFailureMessage: returnAssertion.failure_message || '',
      studentNote: null,
      studentSections: [],
    };
  }

  const actual = callResult.returnValue;
  const actualType = getValueType(actual);
  const expectedType = normalizeVariableType(returnAssertion.expected_type);
  const checks = [];
  const studentHints = [];

  if (expectedType !== 'any') {
    const typePassed = actualType === expectedType;
    checks.push({
      passed: typePassed,
      detail: typePassed
        ? `Return type matches expected ${expectedType}`
        : `Expected ${formatFunctionCall(functionName, returnAssertion.arguments)} to return ${withIndefiniteArticle(expectedType)}, got ${withIndefiniteArticle(actualType)}`,
    });
  }

  if (returnAssertion.value_assertion_enabled) {
    const expectedValue = returnAssertion.expected_value;
    const comparison = returnAssertion.comparison || 'equals';
    const valuePassed = compareVariableValues(actual, expectedValue, comparison);
    checks.push({
      passed: valuePassed,
      detail: valuePassed
        ? `Return value comparison passed (${comparison})`
        : `Expected ${formatFunctionCall(functionName, returnAssertion.arguments)} ${comparison} ${formatDebugValue(expectedValue)}, got ${formatDebugValue(actual)}`,
    });

    if (
      !valuePassed
      && returnAssertion.show_coerced_value_hint
      && expectedType !== 'any'
      && expectedType !== 'list'
    ) {
      const coercedActual = coerceValueForType(actual, expectedType);
      if (coercedActual !== COERCION_FAILED && compareVariableValues(coercedActual, expectedValue, comparison)) {
        studentHints.push(
          `The returned value is correct, but not the correct type. ${capitalizeIdentifier(functionName)} should return ${withIndefiniteArticle(expectedType)}, not ${withIndefiniteArticle(actualType)}.`,
        );
      }
    } else if (
      valuePassed
      && returnAssertion.show_coerced_value_hint
      && expectedType !== 'any'
      && expectedType !== 'list'
      && actualType !== expectedType
    ) {
      const coercedActual = coerceValueForType(actual, expectedType);
      if (coercedActual !== COERCION_FAILED && compareVariableValues(coercedActual, expectedValue, comparison)) {
        studentHints.push(
          `The returned value is correct, but not the correct type. ${capitalizeIdentifier(functionName)} should return ${withIndefiniteArticle(expectedType)}, not ${withIndefiniteArticle(actualType)}.`,
        );
      }
    }
  }

  const listAssertions = getVariableListAssertions(returnAssertion);
  if (hasAnyListChecks(listAssertions)) {
    if (!Array.isArray(actual)) {
      checks.push({
        passed: false,
        detail: `Expected ${formatFunctionCall(functionName, returnAssertion.arguments)} to return a list before applying list assertions, got ${actualType}`,
      });
    } else {
      checks.push(...evaluateListAssertions('returned value', actual, listAssertions, returnAssertion.show_coerced_value_hint, studentHints));
    }
  }

  const failedChecks = checks.filter((check) => !check.passed);
  const passed = failedChecks.length === 0;
  const studentDetail = !passed
    ? createStudentValueDetail({
      showExpected: returnAssertion.show_expected,
      showActual: returnAssertion.show_actual,
      expectedValue: returnAssertion.expected_value,
      actualValue: actual,
      label: 'return value',
      note: studentHints.join('\n\n') || null,
    })
    : null;

  return {
    passed,
    detail: passed
      ? `Return assertion passed for ${formatFunctionCall(functionName, returnAssertion.arguments)}`
      : failedChecks.map((check) => check.detail).join('\n'),
    customSuccessMessage: returnAssertion.success_message || '',
    customFailureMessage: returnAssertion.failure_message || '',
    studentNote: studentDetail?.note || null,
    studentSections: Array.isArray(studentDetail?.sections) ? studentDetail.sections : [],
  };
}

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
  return value === undefined ? 'undefined' : JSON.stringify(value);
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
  if (value === undefined) {
    return 'undefined';
  }
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

function buildExecutionCaptureSource({ variableNames = [], functionNames = [], functionCalls = [] } = {}) {
  const variableCaptureSource = buildVariableCaptureSource(variableNames);
  const functionCaptureSource = buildFunctionCaptureSource(functionNames);
  const functionCallCaptureSource = buildFunctionCallCaptureSource(functionCalls);

  return `{
    variables: ${variableCaptureSource},
    functions: ${functionCaptureSource},
    functionCalls: ${functionCallCaptureSource}
  }`;
}

function buildVariableCaptureSource(variableNames) {
  const safeVariableNames = [...new Set(variableNames.filter(isSafeIdentifier))];
  if (safeVariableNames.length === 0) return '{}';

  return `{${safeVariableNames.map((name) => `${JSON.stringify(name)}: typeof ${name} !== "undefined" ? ${name} : undefined`).join(',')}}`;
}

function buildFunctionCaptureSource(functionNames) {
  const safeFunctionNames = [...new Set(functionNames.filter(isSafeIdentifier))];
  if (safeFunctionNames.length === 0) return '{}';

  return `{${safeFunctionNames.map((name) => {
    const safeName = JSON.stringify(name);
    return `${safeName}: __runtime.inspectFunction(${safeName}, typeof ${name} !== "undefined" ? ${name} : undefined)`;
  }).join(',')}}`;
}

function buildFunctionCallCaptureSource(functionCalls) {
  const normalizedCalls = Array.isArray(functionCalls)
    ? functionCalls.filter((call) => isObjectLike(call) && isSafeIdentifier(call.name))
    : [];
  if (normalizedCalls.length === 0) return '{}';

  return `{${normalizedCalls.map((call) => `${JSON.stringify(call.key)}: await __runtime.invokeFunction(${JSON.stringify(call.name)}, typeof ${call.name} !== "undefined" ? ${call.name} : undefined, ${JSON.stringify(call.arguments)})`).join(',')}}`;
}

function isSafeIdentifier(name) {
  return typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function createFunctionCallPlan(functionName, args = []) {
  return {
    key: getFunctionCallKey(functionName, args),
    name: functionName,
    arguments: Array.isArray(args) ? args : [],
  };
}

function getFunctionExecutionPlanKey(testCase) {
  const returnAssertion = getFunctionReturnAssertion(testCase);
  return JSON.stringify({
    type: 'function_state',
    functionName: testCase.function_name || '',
    parameterCountEnabled: normalizeFunctionParameterCountEnabled(testCase),
    parameterCount: Math.max(0, Math.trunc(Number(testCase.parameter_count) || 0)),
    returnAssertion: returnAssertion.enabled
      ? {
        arguments: returnAssertion.arguments,
        expected_type: returnAssertion.expected_type,
        value_assertion_enabled: returnAssertion.value_assertion_enabled,
        expected_value: returnAssertion.expected_value,
        comparison: returnAssertion.comparison,
        list_assertions: returnAssertion.list_assertions,
      }
      : null,
  });
}

function getStdoutExecutionPlanKey(testCase) {
  const executionContext = getStdoutExecutionContext(testCase);
  return JSON.stringify({
    type: 'stdout_match',
    promptInputs: getPromptInputs(testCase),
    execution_context: executionContext.scope === 'function'
      ? {
        scope: executionContext.scope,
        function_name: executionContext.function_name,
        arguments: executionContext.arguments,
      }
      : { scope: executionContext.scope },
  });
}

function getFunctionCallKey(functionName, args = []) {
  return JSON.stringify({
    functionName: String(functionName ?? ''),
    arguments: Array.isArray(args) ? args : [],
  });
}

function formatFunctionCall(functionName, args = []) {
  const formattedArgs = (Array.isArray(args) ? args : [])
    .map((arg) => formatDebugValue(arg))
    .join(', ');
  return `${String(functionName ?? '')}(${formattedArgs})`;
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

function buildFunctionSuccessFeedback(testCase) {
  const functionName = String(testCase?.function_name ?? '');
  if (normalizeFunctionParameterCountEnabled(testCase) && getFunctionReturnAssertion(testCase).enabled) {
    return `Function "${functionName}" has the correct definition and return value!`;
  }
  if (normalizeFunctionParameterCountEnabled(testCase)) {
    return `Function "${functionName}" exists and has the correct parameter count!`;
  }
  if (getFunctionReturnAssertion(testCase).enabled) {
    return `Function "${functionName}" returns the expected value!`;
  }
  return `Function "${functionName}" exists and is callable!`;
}

function buildFunctionFailureFeedback(testCase, failedCheck = null) {
  const functionName = String(testCase?.function_name ?? '');
  if (failedCheck?.detail?.startsWith(`Calling ${functionName}(`)) {
    return `Calling function "${functionName}" caused an error.`;
  }
  if (failedCheck?.detail?.includes('parameter(s)')) {
    return `Function "${functionName}" does not have the expected number of parameters.`;
  }
  if (getFunctionReturnAssertion(testCase).enabled) {
    return `Function "${functionName}" did not meet the expected return checks.`;
  }
  return `Function "${functionName}" did not meet the expected checks.`;
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

function createStudentValueDetail({
  showExpected = false,
  showActual = false,
  expectedValue = undefined,
  actualValue = undefined,
  label = 'value',
  note = null,
} = {}) {
  const sections = [];
  if (showExpected && expectedValue !== undefined) {
    sections.push({
      title: `Expected ${label}`,
      value: formatStudentFacingValue(expectedValue),
    });
  }
  if (showActual) {
    sections.push({
      title: `Actual ${label}`,
      value: formatStudentFacingValue(actualValue),
    });
  }
  return buildCombinedStudentDetail({ note, sections });
}

function buildCombinedStudentDetail({ note = null, sections = [] } = {}) {
  const normalizedSections = Array.isArray(sections) ? sections.filter(Boolean) : [];
  const normalizedNote = typeof note === 'string' && note.trim() ? note : null;

  if (!normalizedNote && normalizedSections.length === 0) {
    return null;
  }
  return {
    ...(normalizedNote ? { note: normalizedNote } : {}),
    ...(normalizedSections.length > 0 ? { sections: normalizedSections } : {}),
  };
}

function getPromptTranscript(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) return '';
  return prompts.map((entry) => String(entry?.message ?? '')).join('\n');
}

function getPromptMessages(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) return [];
  return prompts.map((entry) => String(entry?.message ?? ''));
}
