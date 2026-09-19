import * as Blockly from 'blockly';
import {
  getVariableListAssertions,
  getStdoutOutputAssertion,
  getStdoutPromptAssertion,
  getTestPoints,
  hasEnabledListAssertion,
  hasEnabledStdoutAssertion,
  normalizeVariableType,
  VALID_LIST_ITEM_TYPE_MODES,
  VALID_LIST_LENGTH_COMPARISONS,
  VALID_LIST_VALUE_MATCH_MODES,
  VALID_RUNTIME_TEXT_MATCH_MODES,
  VALID_VARIABLE_TYPES,
} from './test-config.js';
import { BLOCK_PATTERN_TYPE, registerBlockPatternBlocks } from './block-pattern.js';
import {
  createFieldValueMatcher,
  getEffectiveRegexFlags,
  normalizeFieldValueCaseSensitivity,
  normalizeFieldValueMatchMode,
  VALID_FIELD_VALUE_MATCH_MODES as SHARED_VALID_FIELD_VALUE_MATCH_MODES,
} from './field-value-matching.js';

export const VALID_TEST_TYPES = ['stdout_match', 'block_structure', 'variable_state'];
export const VALID_STDOUT_MATCH_MODES = VALID_RUNTIME_TEXT_MATCH_MODES;
export const VALID_VARIABLE_COMPARISONS = ['equals', 'gt', 'lt', 'gte', 'lte', 'contains', 'type'];
export const VALID_VARIABLE_TYPES_FOR_TESTS = VALID_VARIABLE_TYPES;
export const VALID_LIST_LENGTH_COMPARISONS_FOR_TESTS = VALID_LIST_LENGTH_COMPARISONS;
export const VALID_LIST_VALUE_MATCH_MODES_FOR_TESTS = VALID_LIST_VALUE_MATCH_MODES;
export const VALID_LIST_ITEM_TYPE_MODES_FOR_TESTS = VALID_LIST_ITEM_TYPE_MODES;
export const VALID_HINT_DISPLAY_MODES = ['triggered', 'checklist'];
export const VALID_FIELD_VALUE_MATCH_MODES = SHARED_VALID_FIELD_VALUE_MATCH_MODES;
export const VALID_CONDITION_TYPES = [
  'block_exists', 'block_missing', 'block_connected', 'block_nested',
  'block_field_value', 'block_count', 'workspace_empty', 'all', 'any', 'none', BLOCK_PATTERN_TYPE,
];
export const VALID_HINT_EVENTS = ['workspace_change', 'test_fail', 'manual', 'timed'];

registerBlockPatternBlocks(Blockly);

/**
 * Config Validator — Validates activity_config objects against the JSON Schema.
 *
 * Lightweight validation without a full JSON Schema library dependency.
 * Checks the most important structural requirements and returns actionable errors.
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} path - JSON path to the invalid field (e.g., "metadata.activity_id")
 * @property {string} message - Human-readable error description
 */

/**
 * Validate an activity config object.
 * @param {object} config - The config to validate
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
export function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'Config must be a non-null object' }] };
  }

  // metadata
  validateRequired(config, 'metadata', 'object', errors);
  if (config.metadata) {
    validateRequired(config.metadata, 'activity_id', 'string', errors, 'metadata');
    validateRequired(config.metadata, 'title', 'string', errors, 'metadata');
    if (config.metadata.activity_id && !/^[a-z0-9_]+$/.test(config.metadata.activity_id)) {
      errors.push({
        path: 'metadata.activity_id',
        message: 'Must be lowercase alphanumeric with underscores only',
      });
    }
  }

  // blockly_setup
  validateRequired(config, 'blockly_setup', 'object', errors);
  if (config.blockly_setup) {
    validateRequired(config.blockly_setup, 'toolbox', 'object', errors, 'blockly_setup');
    if (config.blockly_setup.toolbox) {
      validateRequired(config.blockly_setup.toolbox, 'categories', 'array', errors, 'blockly_setup.toolbox');
      if (Array.isArray(config.blockly_setup.toolbox.categories)) {
        config.blockly_setup.toolbox.categories.forEach((cat, i) => {
          validateToolboxCategory(cat, i, errors);
        });
      }
    }
  }

  // evaluation
  validateRequired(config, 'evaluation', 'object', errors);
  if (config.evaluation) {
    validateRequired(config.evaluation, 'test_cases', 'array', errors, 'evaluation');
    if (
      config.evaluation.feedback_on_all_pass !== undefined
      && typeof config.evaluation.feedback_on_all_pass !== 'string'
    ) {
      errors.push({
        path: 'evaluation.feedback_on_all_pass',
        message: 'Must be a string',
      });
    }
    if (Array.isArray(config.evaluation.test_cases)) {
      if (config.evaluation.test_cases.length === 0) {
        errors.push({ path: 'evaluation.test_cases', message: 'Must have at least one test case' });
      }
      config.evaluation.test_cases.forEach((tc, i) => {
        validateTestCase(tc, i, errors);
      });

      const totalPoints = config.evaluation.test_cases.reduce((sum, tc) => sum + getTestPoints(tc), 0);
      if (totalPoints <= 0 && config.evaluation.test_cases.length > 0) {
        errors.push({
          path: 'evaluation.test_cases',
          message: 'At least one test must award more than 0 points',
        });
      }
    }
  }

  // hints (optional but validate if present)
  if (config.hints && Array.isArray(config.hints)) {
    config.hints.forEach((hint, i) => {
      validateHint(hint, i, errors);
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the looser draft shape used by the builder import/export flow.
 * This checks that required top-level containers exist without requiring a
 * fully publishable activity.
 * @param {object} config
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
export function validateBuilderDraftConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'Config must be a non-null object' }] };
  }

  validateRequired(config, 'metadata', 'object', errors);
  validateRequired(config, 'instructions', 'object', errors);
  if (config.instructions) {
    validateRequired(config.instructions, 'steps', 'array', errors, 'instructions');
  }
  validateRequired(config, 'ui_settings', 'object', errors);
  validateRequired(config, 'blockly_setup', 'object', errors);
  if (config.blockly_setup) {
    validateRequired(config.blockly_setup, 'toolbox', 'object', errors, 'blockly_setup');
    if (config.blockly_setup.toolbox) {
      validateRequired(config.blockly_setup.toolbox, 'categories', 'array', errors, 'blockly_setup.toolbox');
    }
  }
  if (config.hints !== undefined && !Array.isArray(config.hints)) {
    errors.push({ path: 'hints', message: 'Must be an array' });
  }
  validateRequired(config, 'evaluation', 'object', errors);
  if (config.evaluation) {
    validateRequired(config.evaluation, 'test_cases', 'array', errors, 'evaluation');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate one toolbox category.
 * @param {object} category
 * @param {number} [index]
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
export function validateToolboxCategoryConfig(category, index = 0) {
  const errors = [];
  validateToolboxCategory(category, index, errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate one test case.
 * @param {object} testCase
 * @param {number} [index]
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
export function validateTestCaseConfig(testCase, index = 0) {
  const errors = [];
  validateTestCase(testCase, index, errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate one hint.
 * @param {object} hint
 * @param {number} [index]
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
export function validateHintConfig(hint, index = 0) {
  const errors = [];
  validateHint(hint, index, errors);
  return { valid: errors.length === 0, errors };
}

function validateRequired(obj, field, expectedType, errors, prefix = '') {
  const path = prefix ? `${prefix}.${field}` : field;
  if (obj[field] === undefined || obj[field] === null) {
    errors.push({ path, message: `Required field is missing` });
    return false;
  }
  if (expectedType === 'array') {
    if (!Array.isArray(obj[field])) {
      errors.push({ path, message: `Must be an array` });
      return false;
    }
  } else if (typeof obj[field] !== expectedType) {
    errors.push({ path, message: `Must be ${expectedType}, got ${typeof obj[field]}` });
    return false;
  }
  return true;
}

function validateRequiredString(obj, field, errors, prefix = '') {
  const path = prefix ? `${prefix}.${field}` : field;
  if (!validateRequired(obj, field, 'string', errors, prefix)) return false;
  if (obj[field].trim() === '') {
    errors.push({ path, message: 'Must not be empty' });
    return false;
  }
  return true;
}

function validateToolboxCategory(category, index, errors) {
  const prefix = `blockly_setup.toolbox.categories[${index}]`;
  validateRequiredString(category, 'name', errors, prefix);
  validateRequired(category, 'blocks', 'array', errors, prefix);
  if (Array.isArray(category.blocks) && category.blocks.length === 0) {
    errors.push({ path: `${prefix}.blocks`, message: 'Category must have at least one block' });
  }
}

function validateTestCase(tc, index, errors) {
  const prefix = `evaluation.test_cases[${index}]`;

  validateRequiredString(tc, 'id', errors, prefix);
  validateRequiredString(tc, 'type', errors, prefix);

  const rawPoints = tc.points ?? tc.weight;
  if (rawPoints === undefined || rawPoints === null) {
    errors.push({ path: `${prefix}.points`, message: 'Required field is missing' });
  } else if (!Number.isInteger(rawPoints) || rawPoints < 0) {
    errors.push({ path: `${prefix}.points`, message: 'Must be an integer greater than or equal to 0' });
  }

  if (tc.prompt_inputs !== undefined) {
    if (!Array.isArray(tc.prompt_inputs) || tc.prompt_inputs.some((value) => typeof value !== 'string')) {
      errors.push({ path: `${prefix}.prompt_inputs`, message: 'Must be an array of strings' });
    }
  }
  if (tc.strict_prompt_inputs !== undefined && typeof tc.strict_prompt_inputs !== 'boolean') {
    errors.push({ path: `${prefix}.strict_prompt_inputs`, message: 'Must be a boolean' });
  }

  if (tc.feedback_on_pass !== undefined && typeof tc.feedback_on_pass !== 'string') {
    errors.push({ path: `${prefix}.feedback_on_pass`, message: 'Must be a string' });
  }
  if (tc.feedback_on_fail !== undefined && typeof tc.feedback_on_fail !== 'string') {
    errors.push({ path: `${prefix}.feedback_on_fail`, message: 'Must be a string' });
  }

  if (tc.type && !VALID_TEST_TYPES.includes(tc.type)) {
    errors.push({ path: `${prefix}.type`, message: `Must be one of: ${VALID_TEST_TYPES.join(', ')}` });
  }

  if (tc.type === 'stdout_match') {
    if (tc.expected_output !== undefined && typeof tc.expected_output !== 'string') {
      errors.push({ path: `${prefix}.expected_output`, message: 'Must be a string' });
    }
    if (tc.match_mode && !VALID_STDOUT_MATCH_MODES.includes(tc.match_mode)) {
      errors.push({ path: `${prefix}.match_mode`, message: 'Must be exact, contains, or regex' });
    }
    validateRuntimeTextAssertion(tc.output_assertion, `${prefix}.output_assertion`, errors);
    validateRuntimeTextAssertion(tc.prompt_assertion, `${prefix}.prompt_assertion`, errors);

    if (!hasEnabledStdoutAssertion(tc)) {
      errors.push({
        path: prefix,
        message: 'stdout_match must enable output_assertion, prompt_assertion, or both',
      });
    }

    const outputAssertion = getStdoutOutputAssertion(tc);
    if (outputAssertion.enabled && typeof outputAssertion.expected !== 'string') {
      errors.push({ path: `${prefix}.output_assertion.expected`, message: 'Must be a string' });
    }

    const promptAssertion = getStdoutPromptAssertion(tc);
    if (promptAssertion.enabled && typeof promptAssertion.expected !== 'string') {
      errors.push({ path: `${prefix}.prompt_assertion.expected`, message: 'Must be a string' });
    }
  } else if (tc.type === 'block_structure') {
    if (!tc.conditions) {
      errors.push({ path: `${prefix}.conditions`, message: 'Required for block_structure test type' });
    } else {
      validateCondition(tc.conditions, `${prefix}.conditions`, errors);
    }
  } else if (tc.type === 'variable_state') {
    validateRequiredString(tc, 'variable_name', errors, prefix);
    if (
      tc.expected_type !== undefined
      && !VALID_VARIABLE_TYPES_FOR_TESTS.includes(String(tc.expected_type))
    ) {
      errors.push({
        path: `${prefix}.expected_type`,
        message: `Must be one of: ${VALID_VARIABLE_TYPES_FOR_TESTS.join(', ')}`,
      });
    }
    if (
      tc.value_assertion_enabled !== undefined
      && typeof tc.value_assertion_enabled !== 'boolean'
    ) {
      errors.push({
        path: `${prefix}.value_assertion_enabled`,
        message: 'Must be a boolean',
      });
    }
    if (
      tc.show_coerced_value_hint !== undefined
      && typeof tc.show_coerced_value_hint !== 'boolean'
    ) {
      errors.push({
        path: `${prefix}.show_coerced_value_hint`,
        message: 'Must be a boolean',
      });
    }
    if (tc.comparison && !VALID_VARIABLE_COMPARISONS.includes(tc.comparison)) {
      errors.push({ path: `${prefix}.comparison`, message: 'Invalid comparison operator' });
    }

    validateVariableListAssertions(tc.list_assertions, `${prefix}.list_assertions`, errors);

    const expectsListChecks = hasEnabledListAssertion(tc);
    const valueAssertionEnabled = tc.value_assertion_enabled === undefined
      ? tc.expected_value !== undefined
      : Boolean(tc.value_assertion_enabled);
    const typeAssertionEnabled = normalizeVariableType(tc.expected_type) !== 'any';

    if (valueAssertionEnabled && tc.expected_value === undefined) {
      errors.push({
        path: `${prefix}.expected_value`,
        message: 'Required when value_assertion_enabled is true',
      });
    }
    if (!valueAssertionEnabled && !typeAssertionEnabled && !expectsListChecks) {
      errors.push({
        path: prefix,
        message: 'variable_state must enable a value assertion, a type assertion, or a list assertion',
      });
    }
  }
}

function validateRuntimeTextAssertion(assertion, path, errors) {
  if (assertion === undefined) return;

  if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
    errors.push({ path, message: 'Must be an object' });
    return;
  }

  if (assertion.enabled !== undefined && typeof assertion.enabled !== 'boolean') {
    errors.push({ path: `${path}.enabled`, message: 'Must be a boolean' });
  }
  if (assertion.expected !== undefined && typeof assertion.expected !== 'string') {
    errors.push({ path: `${path}.expected`, message: 'Must be a string' });
  }
  if (
    assertion.match_mode !== undefined
    && !VALID_STDOUT_MATCH_MODES.includes(assertion.match_mode)
  ) {
    errors.push({
      path: `${path}.match_mode`,
      message: 'Must be exact, contains, or regex',
    });
  }
  if (assertion.match_any_item !== undefined && typeof assertion.match_any_item !== 'boolean') {
    errors.push({ path: `${path}.match_any_item`, message: 'Must be a boolean' });
  }
  if (assertion.show_expected !== undefined && typeof assertion.show_expected !== 'boolean') {
    errors.push({ path: `${path}.show_expected`, message: 'Must be a boolean' });
  }
  if (assertion.show_actual !== undefined && typeof assertion.show_actual !== 'boolean') {
    errors.push({ path: `${path}.show_actual`, message: 'Must be a boolean' });
  }
  if (
    assertion.success_message !== undefined
    && typeof assertion.success_message !== 'string'
  ) {
    errors.push({ path: `${path}.success_message`, message: 'Must be a string' });
  }
  if (
    assertion.failure_message !== undefined
    && typeof assertion.failure_message !== 'string'
  ) {
    errors.push({ path: `${path}.failure_message`, message: 'Must be a string' });
  }
}

function validateVariableListAssertions(assertions, path, errors) {
  if (assertions === undefined) return;
  if (!assertions || typeof assertions !== 'object' || Array.isArray(assertions)) {
    errors.push({ path, message: 'Must be an object' });
    return;
  }

  if (assertions.length_enabled !== undefined && typeof assertions.length_enabled !== 'boolean') {
    errors.push({ path: `${path}.length_enabled`, message: 'Must be a boolean' });
  }
  if (assertions.length_value !== undefined && (!Number.isInteger(assertions.length_value) || assertions.length_value < 0)) {
    errors.push({ path: `${path}.length_value`, message: 'Must be a non-negative integer' });
  }
  if (
    assertions.length_comparison !== undefined
    && !VALID_LIST_LENGTH_COMPARISONS_FOR_TESTS.includes(assertions.length_comparison)
  ) {
    errors.push({
      path: `${path}.length_comparison`,
      message: `Must be one of: ${VALID_LIST_LENGTH_COMPARISONS_FOR_TESTS.join(', ')}`,
    });
  }
  if (assertions.values_enabled !== undefined && typeof assertions.values_enabled !== 'boolean') {
    errors.push({ path: `${path}.values_enabled`, message: 'Must be a boolean' });
  }
  if (
    assertions.values_match_mode !== undefined
    && !VALID_LIST_VALUE_MATCH_MODES_FOR_TESTS.includes(assertions.values_match_mode)
  ) {
    errors.push({
      path: `${path}.values_match_mode`,
      message: `Must be one of: ${VALID_LIST_VALUE_MATCH_MODES_FOR_TESTS.join(', ')}`,
    });
  }
  if (assertions.expected_values !== undefined && !Array.isArray(assertions.expected_values)) {
    errors.push({ path: `${path}.expected_values`, message: 'Must be an array' });
  }
  if (assertions.item_types_enabled !== undefined && typeof assertions.item_types_enabled !== 'boolean') {
    errors.push({ path: `${path}.item_types_enabled`, message: 'Must be a boolean' });
  }
  if (
    assertions.item_type_mode !== undefined
    && !VALID_LIST_ITEM_TYPE_MODES_FOR_TESTS.includes(assertions.item_type_mode)
  ) {
    errors.push({
      path: `${path}.item_type_mode`,
      message: `Must be one of: ${VALID_LIST_ITEM_TYPE_MODES_FOR_TESTS.join(', ')}`,
    });
  }
  if (assertions.expected_item_types !== undefined) {
    if (!Array.isArray(assertions.expected_item_types)) {
      errors.push({ path: `${path}.expected_item_types`, message: 'Must be an array' });
    } else if (assertions.expected_item_types.some((type) => !VALID_VARIABLE_TYPES_FOR_TESTS.includes(String(type)) || String(type) === 'any')) {
      errors.push({
        path: `${path}.expected_item_types`,
        message: `Entries must be one of: ${VALID_VARIABLE_TYPES_FOR_TESTS.filter((type) => type !== 'any').join(', ')}`,
      });
    }
  }
  if (assertions.index_checks !== undefined) {
    if (!Array.isArray(assertions.index_checks)) {
      errors.push({ path: `${path}.index_checks`, message: 'Must be an array' });
    } else {
      assertions.index_checks.forEach((check, index) => {
        const checkPath = `${path}.index_checks[${index}]`;
        if (!check || typeof check !== 'object' || Array.isArray(check)) {
          errors.push({ path: checkPath, message: 'Must be an object' });
          return;
        }
        if (!Number.isInteger(check.index) || check.index < 0) {
          errors.push({ path: `${checkPath}.index`, message: 'Must be a non-negative integer' });
        }
        if (
          check.expected_type !== undefined
          && !VALID_VARIABLE_TYPES_FOR_TESTS.includes(String(check.expected_type))
        ) {
          errors.push({
            path: `${checkPath}.expected_type`,
            message: `Must be one of: ${VALID_VARIABLE_TYPES_FOR_TESTS.join(', ')}`,
          });
        }
        if (check.expected_value === undefined && normalizeVariableType(check.expected_type) === 'any') {
          errors.push({
            path: checkPath,
            message: 'Each index check must define expected_value, expected_type, or both',
          });
        }
      });
    }
  }

  const normalized = getVariableListAssertions({ list_assertions: assertions });
  if (normalized.values_enabled && normalized.expected_values.length === 0) {
    errors.push({
      path: `${path}.expected_values`,
      message: 'Provide at least one expected list value when values_enabled is true',
    });
  }
  if (normalized.item_types_enabled && normalized.expected_item_types.length === 0) {
    errors.push({
      path: `${path}.expected_item_types`,
      message: 'Provide at least one expected item type when item_types_enabled is true',
    });
  }
}

function validateCondition(condition, path, errors) {
  if (!condition || typeof condition !== 'object') {
    errors.push({ path, message: 'Condition must be an object' });
    return;
  }

  if (!VALID_CONDITION_TYPES.includes(condition.type)) {
    errors.push({ path: `${path}.type`, message: `Must be one of: ${VALID_CONDITION_TYPES.join(', ')}` });
    return;
  }

  // Validate condition-specific fields
  if (['block_exists', 'block_missing'].includes(condition.type)) {
    validateRequiredString(condition, 'block_type', errors, path);
  } else if (condition.type === 'block_connected') {
    validateRequiredString(condition, 'upper_type', errors, path);
    validateRequiredString(condition, 'lower_type', errors, path);
  } else if (condition.type === 'block_nested') {
    validateRequiredString(condition, 'outer_type', errors, path);
    validateRequiredString(condition, 'inner_type', errors, path);
    validateRequiredString(condition, 'input_name', errors, path);
    const hasScopedValueConstraint = hasNestedScopedValueConstraint(condition);
    if (condition.field_name !== undefined && typeof condition.field_name !== 'string') {
      errors.push({ path: `${path}.field_name`, message: 'Must be a string' });
    }
    if (
      condition.match_mode !== undefined
      && !VALID_FIELD_VALUE_MATCH_MODES.includes(condition.match_mode)
    ) {
      errors.push({
        path: `${path}.match_mode`,
        message: `Must be one of: ${VALID_FIELD_VALUE_MATCH_MODES.join(', ')}`,
      });
    }
    if (condition.regex_flags !== undefined) {
      if (typeof condition.regex_flags !== 'string') {
        errors.push({ path: `${path}.regex_flags`, message: 'Must be a string' });
      } else if (!isValidRegexFlags(getEffectiveRegexFlags(
        condition.regex_flags,
        normalizeFieldValueCaseSensitivity(condition.case_sensitive, condition.regex_flags),
      ))) {
        errors.push({
          path: `${path}.regex_flags`,
          message: 'Must use valid JavaScript regex flags',
        });
      }
    }
    validateCaseSensitive(condition.case_sensitive, `${path}.case_sensitive`, errors);
    if (hasScopedValueConstraint && String(condition.field_name ?? '').trim() === '') {
      errors.push({
        path: `${path}.field_name`,
        message: 'Field name is required when adding a descendant value constraint',
      });
    }
    if (hasScopedValueConstraint) {
      validateFieldValueMatcherConfig(condition, path, errors);
    }
  } else if (condition.type === 'block_field_value') {
    validateRequiredString(condition, 'block_type', errors, path);
    validateRequiredString(condition, 'field_name', errors, path);
    if (
      condition.match_mode !== undefined
      && !VALID_FIELD_VALUE_MATCH_MODES.includes(condition.match_mode)
    ) {
      errors.push({
        path: `${path}.match_mode`,
        message: `Must be one of: ${VALID_FIELD_VALUE_MATCH_MODES.join(', ')}`,
      });
    }
    if (condition.regex_flags !== undefined) {
      if (typeof condition.regex_flags !== 'string') {
        errors.push({ path: `${path}.regex_flags`, message: 'Must be a string' });
      } else if (!isValidRegexFlags(getEffectiveRegexFlags(
        condition.regex_flags,
        normalizeFieldValueCaseSensitivity(condition.case_sensitive, condition.regex_flags),
      ))) {
        errors.push({
          path: `${path}.regex_flags`,
          message: 'Must use valid JavaScript regex flags',
        });
      }
    }
    validateCaseSensitive(condition.case_sensitive, `${path}.case_sensitive`, errors);
    validateFieldValueMatcherConfig(condition, path, errors);
  } else if (condition.type === BLOCK_PATTERN_TYPE) {
    validateBlockPatternCondition(condition, path, errors);
  } else if (condition.type === 'block_count') {
    validateRequiredString(condition, 'block_type', errors, path);
  } else if (['all', 'any', 'none'].includes(condition.type)) {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
      errors.push({ path: `${path}.conditions`, message: 'Composite condition requires a non-empty conditions array' });
    } else {
      condition.conditions.forEach((c, i) => {
        validateCondition(c, `${path}.conditions[${i}]`, errors);
      });
    }
  }
}

function validateHint(hint, index, errors) {
  const prefix = `hints[${index}]`;
  validateRequiredString(hint, 'id', errors, prefix);
  validateRequiredString(hint, 'message', errors, prefix);
  validateRequired(hint, 'trigger', 'object', errors, prefix);
  if (
    hint.display_mode !== undefined
    && !VALID_HINT_DISPLAY_MODES.includes(hint.display_mode)
  ) {
    errors.push({
      path: `${prefix}.display_mode`,
      message: `Must be one of: ${VALID_HINT_DISPLAY_MODES.join(', ')}`,
    });
  }

  if (hint.trigger) {
    if (!VALID_HINT_EVENTS.includes(hint.trigger.event)) {
      errors.push({ path: `${prefix}.trigger.event`, message: `Must be one of: ${VALID_HINT_EVENTS.join(', ')}` });
    }
    if (hint.trigger.conditions) {
      validateCondition(hint.trigger.conditions, `${prefix}.trigger.conditions`, errors);
    }
  }
}

function isValidRegexFlags(flags) {
  try {
    new RegExp('', flags);
    return new Set(flags.split('')).size === flags.length;
  } catch {
    return false;
  }
}

function hasNestedScopedValueConstraint(condition) {
  return (
    String(condition.field_name ?? '').trim() !== ''
    || condition.expected_value !== undefined
    || normalizeFieldValueMatchMode(condition.match_mode) !== 'exact'
    || condition.case_sensitive === false
    || String(condition.regex_flags ?? '') !== ''
  );
}

function validateBlockPatternCondition(condition, path, errors) {
  if (!condition.workspace_state || typeof condition.workspace_state !== 'object') {
    errors.push({
      path: `${path}.workspace_state`,
      message: 'Pattern condition requires a saved pattern workspace',
    });
    return;
  }

  if (
    condition.field_constraints !== undefined
    && (!condition.field_constraints || typeof condition.field_constraints !== 'object' || Array.isArray(condition.field_constraints))
  ) {
    errors.push({
      path: `${path}.field_constraints`,
      message: 'Must be an object keyed by pattern block id',
    });
    return;
  }

  const patternWorkspace = new Blockly.Workspace();
  try {
    try {
      Blockly.serialization.workspaces.load(condition.workspace_state, patternWorkspace);
    } catch (err) {
      errors.push({
        path: `${path}.workspace_state`,
        message: `Pattern workspace could not be loaded: ${err.message}`,
      });
      return;
    }

    const topBlocks = patternWorkspace.getTopBlocks(false);
    if (topBlocks.length === 0) {
      errors.push({
        path: `${path}.workspace_state`,
        message: 'Pattern workspace must contain at least one block',
      });
    } else if (topBlocks.length > 1) {
      errors.push({
        path: `${path}.workspace_state`,
        message: 'Pattern workspace must have exactly one root block',
      });
    }

    for (const [blockId, fields] of Object.entries(condition.field_constraints || {})) {
      const block = patternWorkspace.getBlockById(blockId);
      if (!block) {
        errors.push({
          path: `${path}.field_constraints.${blockId}`,
          message: 'Constraint references a block that is not in the pattern workspace',
        });
        continue;
      }

      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        errors.push({
          path: `${path}.field_constraints.${blockId}`,
          message: 'Block constraints must be an object keyed by field name',
        });
        continue;
      }

      for (const [fieldName, constraint] of Object.entries(fields)) {
        const fieldPath = `${path}.field_constraints.${blockId}.${fieldName}`;
        if (!constraint || typeof constraint !== 'object' || Array.isArray(constraint)) {
          errors.push({ path: fieldPath, message: 'Field constraint must be an object' });
          continue;
        }

        if (!block.getField(fieldName)) {
          errors.push({
            path: fieldPath,
            message: `Field "${fieldName}" is not present on block type ${block.type}`,
          });
        }

        if (
          constraint.match_mode !== undefined
          && !VALID_FIELD_VALUE_MATCH_MODES.includes(constraint.match_mode)
        ) {
          errors.push({
            path: `${fieldPath}.match_mode`,
            message: `Must be one of: ${VALID_FIELD_VALUE_MATCH_MODES.join(', ')}`,
          });
        }

        if (constraint.regex_flags !== undefined) {
          if (typeof constraint.regex_flags !== 'string') {
            errors.push({ path: `${fieldPath}.regex_flags`, message: 'Must be a string' });
          } else if (!isValidRegexFlags(getEffectiveRegexFlags(
            constraint.regex_flags,
            normalizeFieldValueCaseSensitivity(constraint.case_sensitive, constraint.regex_flags),
          ))) {
            errors.push({
              path: `${fieldPath}.regex_flags`,
              message: 'Must use valid JavaScript regex flags',
            });
          }
        }
        validateCaseSensitive(constraint.case_sensitive, `${fieldPath}.case_sensitive`, errors);
        validateFieldValueMatcherConfig(constraint, fieldPath, errors);
      }
    }
  } finally {
    if (typeof patternWorkspace.dispose === 'function') {
      patternWorkspace.dispose();
    }
  }
}

function validateCaseSensitive(value, path, errors) {
  if (value !== undefined && typeof value !== 'boolean') {
    errors.push({ path, message: 'Must be a boolean' });
  }
}

function validateFieldValueMatcherConfig(value, path, errors) {
  const matcher = createFieldValueMatcher(
    value.match_mode || 'exact',
    String(value.expected_value ?? ''),
    {
      caseSensitive: normalizeFieldValueCaseSensitivity(value.case_sensitive, value.regex_flags),
      regexFlags: value.regex_flags || '',
    },
  );

  if (!matcher.valid) {
    errors.push({
      path: `${path}.expected_value`,
      message: matcher.detail,
    });
  }
}
