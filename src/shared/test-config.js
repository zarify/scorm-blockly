/**
 * Shared helpers for working with test case configuration.
 */

export const VALID_RUNTIME_TEXT_MATCH_MODES = ['exact', 'contains', 'regex'];
export const VALID_VARIABLE_TYPES = ['any', 'int', 'float', 'string', 'list'];
export const VALID_LIST_LENGTH_COMPARISONS = ['equals', 'gt', 'lt', 'gte', 'lte'];
export const VALID_LIST_VALUE_MATCH_MODES = [
  'exact_order',
  'same_values_any_order',
  'expected_subset_of_actual',
  'expected_superset_of_actual',
];
export const VALID_LIST_ITEM_TYPE_MODES = ['all', 'some', 'none'];

const DEFAULT_RUNTIME_TEXT_ASSERTION = Object.freeze({
  enabled: false,
  expected: '',
  match_mode: 'exact',
  match_any_item: false,
  show_expected: false,
  show_actual: false,
  success_message: '',
  failure_message: '',
});

const DEFAULT_LIST_ASSERTIONS = Object.freeze({
  length_enabled: false,
  length_value: 0,
  length_comparison: 'equals',
  values_enabled: false,
  values_match_mode: 'exact_order',
  expected_values: [],
  item_types_enabled: false,
  item_type_mode: 'all',
  expected_item_types: [],
  index_checks: [],
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
 * Whether prompt input count mismatches should fail this test.
 * @param {object} testCase
 * @returns {boolean}
 */
export function shouldEnforcePromptInputCount(testCase) {
  return testCase?.strict_prompt_inputs !== false;
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
 * @returns {{ enabled: boolean, expected: string, match_mode: string, match_any_item: boolean, show_expected: boolean, show_actual: boolean, success_message: string, failure_message: string }}
 */
export function normalizeRuntimeTextAssertion(assertion, defaults = {}) {
  const source = isObjectLike(assertion) ? assertion : {};
  const fallback = { ...DEFAULT_RUNTIME_TEXT_ASSERTION, ...defaults };

  return {
    enabled: source.enabled !== undefined ? Boolean(source.enabled) : Boolean(fallback.enabled),
    expected: source.expected !== undefined ? String(source.expected) : String(fallback.expected ?? ''),
    match_mode: normalizeRuntimeTextMatchMode(source.match_mode ?? fallback.match_mode),
    match_any_item: source.match_any_item !== undefined ? Boolean(source.match_any_item) : Boolean(fallback.match_any_item),
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
 * @returns {{ enabled: boolean, expected: string, match_mode: string, match_any_item: boolean, show_expected: boolean, show_actual: boolean, success_message: string, failure_message: string }}
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
 * @returns {{ enabled: boolean, expected: string, match_mode: string, match_any_item: boolean, show_expected: boolean, show_actual: boolean, success_message: string, failure_message: string }}
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

export function normalizeVariableType(value) {
  return VALID_VARIABLE_TYPES.includes(value) ? value : 'any';
}

export function normalizeListLengthComparison(value) {
  return VALID_LIST_LENGTH_COMPARISONS.includes(value) ? value : 'equals';
}

export function normalizeListValueMatchMode(value) {
  return VALID_LIST_VALUE_MATCH_MODES.includes(value) ? value : 'exact_order';
}

export function normalizeListItemTypeMode(value) {
  return VALID_LIST_ITEM_TYPE_MODES.includes(value) ? value : 'all';
}

export function normalizeVariableValueAssertionEnabled(testCase, options = {}) {
  if (testCase?.value_assertion_enabled !== undefined) {
    return Boolean(testCase.value_assertion_enabled);
  }
  return options.defaultEnabled ?? testCase?.expected_value !== undefined;
}

export function normalizeListExpectedTypes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry))
    .filter((entry) => VALID_VARIABLE_TYPES.includes(entry) && entry !== 'any');
}

export function normalizeListIndexChecks(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isObjectLike)
    .map((entry) => ({
      index: Math.max(0, Math.trunc(Number(entry.index) || 0)),
      ...(entry.expected_value !== undefined ? { expected_value: entry.expected_value } : {}),
      expected_type: normalizeVariableType(entry.expected_type),
    }));
}

export function getVariableListAssertions(testCase) {
  const source = isObjectLike(testCase?.list_assertions) ? testCase.list_assertions : {};

  return {
    length_enabled: Boolean(source.length_enabled),
    length_value: Math.max(0, Math.trunc(Number(source.length_value) || 0)),
    length_comparison: normalizeListLengthComparison(source.length_comparison),
    values_enabled: Boolean(source.values_enabled),
    values_match_mode: normalizeListValueMatchMode(source.values_match_mode),
    expected_values: Array.isArray(source.expected_values) ? source.expected_values : [],
    item_types_enabled: Boolean(source.item_types_enabled),
    item_type_mode: normalizeListItemTypeMode(source.item_type_mode),
    expected_item_types: normalizeListExpectedTypes(source.expected_item_types),
    index_checks: normalizeListIndexChecks(source.index_checks),
  };
}

export function hasEnabledListAssertion(testCase) {
  const assertions = getVariableListAssertions(testCase);
  return assertions.length_enabled
    || assertions.values_enabled
    || assertions.item_types_enabled
    || assertions.index_checks.length > 0;
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

  if (testCase.type === 'stdout_match' || testCase.type === 'variable_state') {
    testCase.strict_prompt_inputs = shouldEnforcePromptInputCount(testCase);
  }

  if (testCase.type === 'stdout_match') {
    testCase.output_assertion = getStdoutOutputAssertion(testCase);
    testCase.prompt_assertion = getStdoutPromptAssertion(testCase);
    delete testCase.expected_output;
    delete testCase.match_mode;
  } else if (testCase.type === 'variable_state') {
    testCase.expected_type = normalizeVariableType(testCase.expected_type);
    testCase.value_assertion_enabled = normalizeVariableValueAssertionEnabled(testCase);
    testCase.show_coerced_value_hint = Boolean(testCase.show_coerced_value_hint);
    testCase.list_assertions = getVariableListAssertions(testCase);
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
