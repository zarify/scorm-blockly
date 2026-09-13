import { getTestPoints } from './test-config.js';

export const VALID_TEST_TYPES = ['stdout_match', 'block_structure', 'variable_state'];
export const VALID_STDOUT_MATCH_MODES = ['exact', 'contains', 'regex'];
export const VALID_VARIABLE_COMPARISONS = ['equals', 'gt', 'lt', 'gte', 'lte', 'contains', 'type'];
export const VALID_CONDITION_TYPES = [
  'block_exists', 'block_missing', 'block_connected', 'block_nested',
  'block_field_value', 'block_count', 'workspace_empty', 'all', 'any', 'none',
];
export const VALID_HINT_EVENTS = ['workspace_change', 'test_fail', 'manual', 'timed'];

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

  if (tc.type && !VALID_TEST_TYPES.includes(tc.type)) {
    errors.push({ path: `${prefix}.type`, message: `Must be one of: ${VALID_TEST_TYPES.join(', ')}` });
  }

  if (tc.type === 'stdout_match') {
    validateRequired(tc, 'expected_output', 'string', errors, prefix);
    if (tc.match_mode && !VALID_STDOUT_MATCH_MODES.includes(tc.match_mode)) {
      errors.push({ path: `${prefix}.match_mode`, message: 'Must be exact, contains, or regex' });
    }
  } else if (tc.type === 'block_structure') {
    if (!tc.conditions) {
      errors.push({ path: `${prefix}.conditions`, message: 'Required for block_structure test type' });
    } else {
      validateCondition(tc.conditions, `${prefix}.conditions`, errors);
    }
  } else if (tc.type === 'variable_state') {
    validateRequiredString(tc, 'variable_name', errors, prefix);
    if (tc.expected_value === undefined) {
      errors.push({ path: `${prefix}.expected_value`, message: 'Required for variable_state test type' });
    }
    if (tc.comparison && !VALID_VARIABLE_COMPARISONS.includes(tc.comparison)) {
      errors.push({ path: `${prefix}.comparison`, message: 'Invalid comparison operator' });
    }
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
  } else if (condition.type === 'block_field_value') {
    validateRequiredString(condition, 'block_type', errors, path);
    validateRequiredString(condition, 'field_name', errors, path);
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

  if (hint.trigger) {
    if (!VALID_HINT_EVENTS.includes(hint.trigger.event)) {
      errors.push({ path: `${prefix}.trigger.event`, message: `Must be one of: ${VALID_HINT_EVENTS.join(', ')}` });
    }
    if (hint.trigger.conditions) {
      validateCondition(hint.trigger.conditions, `${prefix}.trigger.conditions`, errors);
    }
  }
}
