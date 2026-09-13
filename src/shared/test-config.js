/**
 * Shared helpers for working with test case configuration.
 */

/**
 * Get the point value for a test case, supporting legacy `weight`.
 * @param {object} testCase
 * @returns {number}
 */
export function getTestPoints(testCase) {
  const value = testCase?.points ?? testCase?.weight ?? 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0;
}

/**
 * Assign points to a test case and drop the legacy `weight` field.
 * @param {object} testCase
 * @param {number} points
 */
export function setTestPoints(testCase, points) {
  testCase.points = Math.max(0, Math.trunc(Number(points) || 0));
  delete testCase.weight;
}

/**
 * Get prompt() responses configured for a test case.
 * @param {object} testCase
 * @returns {string[]}
 */
export function getPromptInputs(testCase) {
  if (!Array.isArray(testCase?.prompt_inputs)) return [];
  return testCase.prompt_inputs.map((value) => String(value));
}

/**
 * Format prompt inputs for editing in a textarea.
 * @param {string[]} promptInputs
 * @returns {string}
 */
export function formatPromptInputs(promptInputs) {
  return getPromptInputs({ prompt_inputs: promptInputs }).join('\n');
}

/**
 * Parse prompt inputs entered as one value per line.
 * @param {string} text
 * @returns {string[]}
 */
export function parsePromptInputs(text) {
  return text === '' ? [] : text.split(/\r?\n/);
}

/**
 * Normalize legacy/new test case shapes in place.
 * @param {object} testCase
 * @returns {object}
 */
export function normalizeTestCase(testCase) {
  if (!testCase || typeof testCase !== 'object') return testCase;

  setTestPoints(testCase, getTestPoints(testCase));

  if (testCase.prompt_inputs !== undefined) {
    testCase.prompt_inputs = getPromptInputs(testCase);
  }

  return testCase;
}

/**
 * Normalize all tests in an activity config in place.
 * @param {object} config
 * @returns {object}
 */
export function normalizeTestConfig(config) {
  if (!config?.evaluation?.test_cases || !Array.isArray(config.evaluation.test_cases)) {
    return config;
  }

  config.evaluation.test_cases.forEach(normalizeTestCase);
  return config;
}
