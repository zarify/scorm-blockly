/**
 * Shared helpers for working with test case configuration.
 */

export const VALID_RUNTIME_TEXT_MATCH_MODES = ['exact', 'contains', 'regex'];

const DEFAULT_RUNTIME_TEXT_ASSERTION = Object.freeze({
  enabled: false,
  expected: '',
  match_mode: 'exact',
  show_expected: false,
  show_actual: false,
  success_message: '',
  failure_message: '',
});

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
 * Normalize the comparison mode used by prompt/output assertions.
 * @param {string} matchMode
 * @returns {string}
 */
export function normalizeRuntimeTextMatchMode(matchMode) {
  return VALID_RUNTIME_TEXT_MATCH_MODES.includes(matchMode) ? matchMode : 'exact';
}

/**
 * Normalize a prompt/output assertion object into a predictable shape.
 * @param {object} assertion
 * @param {Partial<typeof DEFAULT_RUNTIME_TEXT_ASSERTION>} [defaults]
 * @returns {{ enabled: boolean, expected: string, match_mode: string, show_expected: boolean, show_actual: boolean, success_message: string, failure_message: string }}
 */
export function normalizeRuntimeTextAssertion(assertion, defaults = {}) {
  const source = isObjectLike(assertion) ? assertion : {};
  const fallback = { ...DEFAULT_RUNTIME_TEXT_ASSERTION, ...defaults };

  return {
    enabled: source.enabled !== undefined ? Boolean(source.enabled) : Boolean(fallback.enabled),
    expected: source.expected !== undefined ? String(source.expected) : String(fallback.expected ?? ''),
    match_mode: normalizeRuntimeTextMatchMode(source.match_mode ?? fallback.match_mode),
    show_expected: source.show_expected !== undefined ? Boolean(source.show_expected) : Boolean(fallback.show_expected),
    show_actual: source.show_actual !== undefined ? Boolean(source.show_actual) : Boolean(fallback.show_actual),
    success_message: source.success_message !== undefined ? String(source.success_message) : String(fallback.success_message ?? ''),
    failure_message: source.failure_message !== undefined ? String(source.failure_message) : String(fallback.failure_message ?? ''),
  };
}

/**
 * Get the normalized output assertion for a stdout_match test.
 * Falls back to legacy expected_output/match_mode fields when present.
 * @param {object} testCase
 * @param {{ defaultEnabled?: boolean }} [options]
 * @returns {{ enabled: boolean, expected: string, match_mode: string, show_expected: boolean, show_actual: boolean, success_message: string, failure_message: string }}
 */
export function getStdoutOutputAssertion(testCase, options = {}) {
  const rawAssertion = isObjectLike(testCase?.output_assertion) ? testCase.output_assertion : null;
  const hasLegacyFields = testCase?.expected_output !== undefined || testCase?.match_mode !== undefined;
  const defaultEnabled = options.defaultEnabled ?? (rawAssertion ? true : hasLegacyFields);

  return normalizeRuntimeTextAssertion(rawAssertion, {
    enabled: defaultEnabled,
    expected: testCase?.expected_output ?? '',
    match_mode: testCase?.match_mode ?? 'exact',
  });
}

/**
 * Get the normalized prompt-text assertion for a stdout_match test.
 * @param {object} testCase
 * @param {{ defaultEnabled?: boolean }} [options]
 * @returns {{ enabled: boolean, expected: string, match_mode: string, show_expected: boolean, show_actual: boolean, success_message: string, failure_message: string }}
 */
export function getStdoutPromptAssertion(testCase, options = {}) {
  const rawAssertion = isObjectLike(testCase?.prompt_assertion) ? testCase.prompt_assertion : null;
  const defaultEnabled = options.defaultEnabled ?? Boolean(rawAssertion);

  return normalizeRuntimeTextAssertion(rawAssertion, {
    enabled: defaultEnabled,
  });
}

/**
 * Whether a stdout_match test enables at least one of its assertions.
 * @param {object} testCase
 * @returns {boolean}
 */
export function hasEnabledStdoutAssertion(testCase) {
  return getStdoutOutputAssertion(testCase).enabled || getStdoutPromptAssertion(testCase).enabled;
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

  if (testCase.type === 'stdout_match') {
    testCase.output_assertion = getStdoutOutputAssertion(testCase);
    testCase.prompt_assertion = getStdoutPromptAssertion(testCase);
    delete testCase.expected_output;
    delete testCase.match_mode;
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

function isObjectLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
