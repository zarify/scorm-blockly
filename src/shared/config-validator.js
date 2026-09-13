import { getTestPoints } from './test-config.js';

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
          const prefix = `blockly_setup.toolbox.categories[${i}]`;
          validateRequired(cat, 'name', 'string', errors, prefix);
          validateRequired(cat, 'blocks', 'array', errors, prefix);
          if (Array.isArray(cat.blocks) && cat.blocks.length === 0) {
            errors.push({ path: `${prefix}.blocks`, message: 'Category must have at least one block' });
          }
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

function validateTestCase(tc, index, errors) {
  const prefix = `evaluation.test_cases[${index}]`;

  validateRequired(tc, 'id', 'string', errors, prefix);
  validateRequired(tc, 'type', 'string', errors, prefix);

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

  const validTypes = ['stdout_match', 'block_structure', 'variable_state'];
  if (tc.type && !validTypes.includes(tc.type)) {
    errors.push({ path: `${prefix}.type`, message: `Must be one of: ${validTypes.join(', ')}` });
  }

  if (tc.type === 'stdout_match') {
    validateRequired(tc, 'expected_output', 'string', errors, prefix);
    if (tc.match_mode && !['exact', 'contains', 'regex'].includes(tc.match_mode)) {
      errors.push({ path: `${prefix}.match_mode`, message: 'Must be exact, contains, or regex' });
    }
  } else if (tc.type === 'block_structure') {
    if (!tc.conditions) {
      errors.push({ path: `${prefix}.conditions`, message: 'Required for block_structure test type' });
    } else {
      validateCondition(tc.conditions, `${prefix}.conditions`, errors);
    }
  } else if (tc.type === 'variable_state') {
    validateRequired(tc, 'variable_name', 'string', errors, prefix);
    if (tc.expected_value === undefined) {
      errors.push({ path: `${prefix}.expected_value`, message: 'Required for variable_state test type' });
    }
    if (tc.comparison && !['equals', 'gt', 'lt', 'gte', 'lte', 'contains', 'type'].includes(tc.comparison)) {
      errors.push({ path: `${prefix}.comparison`, message: 'Invalid comparison operator' });
    }
  }
}

function validateCondition(condition, path, errors) {
  if (!condition || typeof condition !== 'object') {
    errors.push({ path, message: 'Condition must be an object' });
    return;
  }

  const validTypes = [
    'block_exists', 'block_missing', 'block_connected', 'block_nested',
    'block_field_value', 'block_count', 'workspace_empty', 'all', 'any', 'none',
  ];

  if (!validTypes.includes(condition.type)) {
    errors.push({ path: `${path}.type`, message: `Must be one of: ${validTypes.join(', ')}` });
    return;
  }

  // Validate condition-specific fields
  if (['block_exists', 'block_missing'].includes(condition.type)) {
    validateRequired(condition, 'block_type', 'string', errors, path);
  } else if (condition.type === 'block_connected') {
    validateRequired(condition, 'upper_type', 'string', errors, path);
    validateRequired(condition, 'lower_type', 'string', errors, path);
  } else if (condition.type === 'block_nested') {
    validateRequired(condition, 'outer_type', 'string', errors, path);
    validateRequired(condition, 'inner_type', 'string', errors, path);
    validateRequired(condition, 'input_name', 'string', errors, path);
  } else if (condition.type === 'block_field_value') {
    validateRequired(condition, 'block_type', 'string', errors, path);
    validateRequired(condition, 'field_name', 'string', errors, path);
  } else if (condition.type === 'block_count') {
    validateRequired(condition, 'block_type', 'string', errors, path);
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
  validateRequired(hint, 'id', 'string', errors, prefix);
  validateRequired(hint, 'message', 'string', errors, prefix);
  validateRequired(hint, 'trigger', 'object', errors, prefix);

  if (hint.trigger) {
    const validEvents = ['workspace_change', 'test_fail', 'manual', 'timed'];
    if (!validEvents.includes(hint.trigger.event)) {
      errors.push({ path: `${prefix}.trigger.event`, message: `Must be one of: ${validEvents.join(', ')}` });
    }
    if (hint.trigger.conditions) {
      validateCondition(hint.trigger.conditions, `${prefix}.trigger.conditions`, errors);
    }
  }
}
