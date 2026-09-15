import * as Blockly from 'blockly';
import { getTestPoints } from './test-config.js';
import { BLOCK_PATTERN_TYPE, registerBlockPatternBlocks } from './block-pattern.js';

export const VALID_TEST_TYPES = ['stdout_match', 'block_structure', 'variable_state'];
export const VALID_STDOUT_MATCH_MODES = ['exact', 'contains', 'regex'];
export const VALID_VARIABLE_COMPARISONS = ['equals', 'gt', 'lt', 'gte', 'lte', 'contains', 'type'];
export const VALID_FIELD_VALUE_MATCH_MODES = ['exact', 'regex'];
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
      } else if (!isValidRegexFlags(condition.regex_flags)) {
        errors.push({
          path: `${path}.regex_flags`,
          message: 'Must use valid JavaScript regex flags without duplicates',
        });
      }
    }
    if (hasScopedValueConstraint && String(condition.field_name ?? '').trim() === '') {
      errors.push({
        path: `${path}.field_name`,
        message: 'Field name is required when adding a descendant value constraint',
      });
    }
    if (hasScopedValueConstraint && condition.match_mode === 'regex') {
      try {
        new RegExp(`^(?:${String(condition.expected_value ?? '')})$`, condition.regex_flags || '');
      } catch (err) {
        errors.push({
          path: `${path}.expected_value`,
          message: `Invalid regex pattern: ${err.message}`,
        });
      }
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
      } else if (!isValidRegexFlags(condition.regex_flags)) {
        errors.push({
          path: `${path}.regex_flags`,
          message: 'Must use valid JavaScript regex flags without duplicates',
        });
      }
    }
    if ((condition.match_mode || 'exact') === 'regex') {
      try {
        new RegExp(`^(?:${String(condition.expected_value ?? '')})$`, condition.regex_flags || '');
      } catch (err) {
        errors.push({
          path: `${path}.expected_value`,
          message: `Invalid regex pattern: ${err.message}`,
        });
      }
    }
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
    || condition.match_mode === 'regex'
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
          } else if (!isValidRegexFlags(constraint.regex_flags)) {
            errors.push({
              path: `${fieldPath}.regex_flags`,
              message: 'Must use valid JavaScript regex flags without duplicates',
            });
          }
        }

        if ((constraint.match_mode || 'exact') === 'regex') {
          try {
            new RegExp(
              `^(?:${String(constraint.expected_value ?? '')})$`,
              constraint.regex_flags || '',
            );
          } catch (err) {
            errors.push({
              path: `${fieldPath}.expected_value`,
              message: `Invalid regex pattern: ${err.message}`,
            });
          }
        }
      }
    }
  } finally {
    if (typeof patternWorkspace.dispose === 'function') {
      patternWorkspace.dispose();
    }
  }
}
