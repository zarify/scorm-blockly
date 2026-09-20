import { getDefaultCategoryColour } from './blockly-toolbox.js';
import { BLOCK_PATTERN_TYPE, normalizeParamCountConstraint } from './block-pattern.js';
import {
  VALID_CONDITION_TYPES,
  VALID_HINT_DISPLAY_MODES,
  VALID_HINT_EVENTS,
  VALID_TEST_TYPES,
  VALID_VARIABLE_COMPARISONS,
  validateHintConfig,
  validateTestCaseConfig,
  validateToolboxCategoryConfig,
} from './config-validator.js';
import {
  getCanonicalRegexFlags,
  normalizeFieldValueCaseSensitivity,
  normalizeFieldValueMatchMode,
} from './field-value-matching.js';
import { normalizeWorkspaceConnectednessMode } from './workspace-connectedness.js';
import {
  getFunctionReturnAssertion,
  getVariableListAssertions,
  getPromptInputs,
  getStdoutExecutionContext,
  getStdoutOutputAssertion,
  getStdoutPromptAssertion,
  getTestPoints,
  normalizeFunctionParameterCountEnabled,
  normalizeVariableType,
  normalizeVariableValueAssertionEnabled,
  normalizeTestConfig,
  shouldEnforcePromptInputCount,
} from './test-config.js';

/** SCORM 1.2 specifies 4096 characters for cmi.suspend_data. */
export const SUSPEND_DATA_DEFAULT_LIMIT = 4096;

/**
 * Normalize an arbitrary config object into a builder-safe draft shape.
 * Missing or malformed nested values are replaced with editable defaults so a
 * partially edited draft can always be reopened in the builder.
 * @param {object} rawConfig
 * @returns {{ config: object }}
 */
export function normalizeBuilderDraftConfig(rawConfig) {
  const source = cloneConfig(rawConfig);
  const config = createBaseConfig(source);
  const legacyHintDisplayMode = normalizeLegacyHintDisplayMode(source?.ui_settings);

  const rawCategories = source?.blockly_setup?.toolbox?.categories;
  config.blockly_setup.toolbox.categories = Array.isArray(rawCategories)
    ? rawCategories.filter(isObjectLike).map(normalizeDraftToolboxCategory)
    : [];

  const rawHints = source?.hints;
  config.hints = Array.isArray(rawHints)
    ? rawHints.filter(isObjectLike).map((hint, index) => normalizeDraftHint(hint, index, legacyHintDisplayMode))
    : [];

  const rawTests = source?.evaluation?.test_cases;
  config.evaluation.test_cases = Array.isArray(rawTests)
    ? rawTests.filter(isObjectLike).map(normalizeDraftTestCase)
    : [];

  return { config: normalizeTestConfig(config) };
}

/**
 * Prepare a config export payload by omitting incomplete optional items while
 * preserving valid data in a publishable shape.
 * @param {object} rawConfig
 * @returns {{ config: object, omissions: { categories: number, hints: number, tests: number } }}
 */
export function sanitizeConfigForExport(rawConfig) {
  const source = cloneConfig(rawConfig);
  const config = createBaseConfig(source);
  const legacyHintDisplayMode = normalizeLegacyHintDisplayMode(source?.ui_settings);
  const omissions = { categories: 0, hints: 0, tests: 0 };

  const rawCategories = source?.blockly_setup?.toolbox?.categories;
  const publishCategories = Array.isArray(rawCategories)
    ? rawCategories.filter(isObjectLike).map(normalizePublishToolboxCategory)
    : [];
  config.blockly_setup.toolbox.categories = publishCategories.filter((category, index) => {
    const valid = validateToolboxCategoryConfig(category, index).valid;
    if (!valid) omissions.categories += 1;
    return valid;
  });

  const rawHints = source?.hints;
  const publishHints = Array.isArray(rawHints)
    ? rawHints.filter(isObjectLike).map((hint) => normalizePublishHint(hint, legacyHintDisplayMode))
    : [];
  config.hints = publishHints.filter((hint, index) => {
    const valid = validateHintConfig(hint, index).valid;
    if (!valid) omissions.hints += 1;
    return valid;
  });

  const rawTests = source?.evaluation?.test_cases;
  const publishTests = Array.isArray(rawTests)
    ? rawTests.filter(isObjectLike).map(normalizePublishTestCase)
    : [];
  config.evaluation.test_cases = publishTests.filter((testCase, index) => {
    const valid = validateTestCaseConfig(testCase, index).valid;
    if (!valid) omissions.tests += 1;
    return valid;
  });

  return { config: normalizeTestConfig(config), omissions };
}

export const sanitizeConfigForScorm = sanitizeConfigForExport;

function createBaseConfig(source) {
  const metadata = isObjectLike(source?.metadata) ? source.metadata : {};
  const instructions = isObjectLike(source?.instructions) ? source.instructions : {};
  const uiSettings = isObjectLike(source?.ui_settings) ? source.ui_settings : {};
  const blocklySetup = isObjectLike(source?.blockly_setup) ? source.blockly_setup : {};
  const evaluation = isObjectLike(source?.evaluation) ? source.evaluation : {};

  return {
    metadata: {
      activity_id: asStringOr(metadata.activity_id, ''),
      title: asStringOr(metadata.title, ''),
      version: asStringOr(metadata.version, '1.0'),
      description: asStringOr(metadata.description, ''),
    },
    instructions: {
      main: asStringOr(instructions.main, ''),
      steps: Array.isArray(instructions.steps)
        ? instructions.steps.filter((step) => step !== undefined && step !== null).map((step) => String(step))
        : [],
    },
    ui_settings: {
      show_code_toggle: uiSettings.show_code_toggle === true,
      show_hint_panel: uiSettings.show_hint_panel !== false,
      // SCORM 1.2 specifies 4096 characters for cmi.suspend_data.
      suspend_data_limit: asOptionalInteger(uiSettings.suspend_data_limit, SUSPEND_DATA_DEFAULT_LIMIT)
        ?? SUSPEND_DATA_DEFAULT_LIMIT,
    },
    blockly_setup: {
      toolbox: { categories: [] },
      starting_blocks: isObjectLike(blocklySetup.starting_blocks) ? blocklySetup.starting_blocks : null,
      max_blocks: asOptionalInteger(blocklySetup.max_blocks, null),
    },
    hints: [],
    evaluation: {
      feedback_on_all_pass: asStringOr(evaluation.feedback_on_all_pass, ''),
      require_previous_test_pass: evaluation.require_previous_test_pass !== false,
      test_cases: [],
    },
  };
}

function normalizeDraftToolboxCategory(category, index) {
  return {
    name: asStringOr(category.name, `Category ${index + 1}`),
    colour: asStringOr(category.colour, getDefaultCategoryColour(index)),
    blocks: Array.isArray(category.blocks) ? category.blocks.filter(isNonEmptyString) : [],
  };
}

function normalizePublishToolboxCategory(category, index) {
  return {
    name: asStringOr(category.name, ''),
    colour: asStringOr(category.colour, getDefaultCategoryColour(index)),
    blocks: Array.isArray(category.blocks) ? category.blocks.filter(isNonEmptyString) : [],
  };
}

function normalizeDraftHint(hint, index, legacyDisplayMode = 'triggered') {
  const trigger = isObjectLike(hint.trigger) ? hint.trigger : {};

  return {
    id: asStringOr(hint.id, `hint_${index + 1}`),
    trigger: {
      event: VALID_HINT_EVENTS.includes(trigger.event) ? trigger.event : 'workspace_change',
      conditions: normalizeDraftCondition(trigger.conditions),
      after_attempts: asNonNegativeInteger(trigger.after_attempts, 0),
      invalidate_on_condition_false: Boolean(trigger.invalidate_on_condition_false),
    },
    display_mode: normalizePerHintDisplayMode(hint.display_mode, legacyDisplayMode),
    message: asStringOr(hint.message, ''),
    priority: asPositiveInteger(hint.priority, index + 1),
    delay_seconds: asNonNegativeInteger(hint.delay_seconds, 0),
    show_once: Boolean(hint.show_once),
    style: asStringOr(hint.style, '') || undefined,
  };
}

function normalizePublishHint(hint, legacyDisplayMode = 'triggered') {
  const trigger = isObjectLike(hint.trigger) ? hint.trigger : null;

  return {
    id: asStringOr(hint.id, ''),
    trigger: trigger
      ? {
          event: asStringOr(trigger.event, ''),
          ...(trigger.conditions !== undefined ? { conditions: normalizePublishCondition(trigger.conditions) } : {}),
          ...(trigger.after_attempts !== undefined
            ? { after_attempts: asNonNegativeInteger(trigger.after_attempts, 0) }
            : {}),
          ...(trigger.invalidate_on_condition_false !== undefined
            ? { invalidate_on_condition_false: Boolean(trigger.invalidate_on_condition_false) }
            : {}),
        }
      : null,
    message: asStringOr(hint.message, ''),
    ...(hint.display_mode !== undefined || legacyDisplayMode !== 'triggered'
      ? { display_mode: normalizePerHintDisplayMode(hint.display_mode, legacyDisplayMode) }
      : {}),
    ...(hint.priority !== undefined ? { priority: asPositiveInteger(hint.priority, 1) } : {}),
    ...(hint.delay_seconds !== undefined ? { delay_seconds: asNonNegativeInteger(hint.delay_seconds, 0) } : {}),
    ...(hint.show_once !== undefined ? { show_once: Boolean(hint.show_once) } : {}),
    ...(hint.style !== undefined && asStringOr(hint.style, '') ? { style: asStringOr(hint.style, '') } : {}),
  };
}

function normalizeDraftTestCase(testCase, index) {
  const type = VALID_TEST_TYPES.includes(testCase.type) ? testCase.type : 'stdout_match';
  const normalized = {
    id: asStringOr(testCase.id, `test_${index + 1}`),
    type,
    points: getTestPoints(testCase),
    feedback_on_pass: asStringOr(testCase.feedback_on_pass, ''),
    feedback_on_fail: asStringOr(testCase.feedback_on_fail, ''),
  };

  if (type === 'stdout_match') {
    normalized.prompt_inputs = getPromptInputs(testCase);
    normalized.strict_prompt_inputs = shouldEnforcePromptInputCount(testCase);
    normalized.output_assertion = getStdoutOutputAssertion(testCase, { defaultEnabled: true });
    normalized.prompt_assertion = getStdoutPromptAssertion(testCase);
    normalized.execution_context = getStdoutExecutionContext(testCase);
  } else if (type === 'block_structure') {
    normalized.conditions = normalizeDraftCondition(testCase.conditions);
  } else if (type === 'variable_state') {
    normalized.prompt_inputs = getPromptInputs(testCase);
    normalized.strict_prompt_inputs = shouldEnforcePromptInputCount(testCase);
    normalized.variable_name = asStringOr(testCase.variable_name, '');
    normalized.expected_type = normalizeVariableType(testCase.expected_type);
    normalized.value_assertion_enabled = normalizeVariableValueAssertionEnabled(testCase);
    if (testCase.expected_value !== undefined) {
      normalized.expected_value = testCase.expected_value;
    }
    normalized.comparison = VALID_VARIABLE_COMPARISONS.includes(testCase.comparison)
      ? testCase.comparison
      : 'equals';
    normalized.show_coerced_value_hint = Boolean(testCase.show_coerced_value_hint);
    normalized.list_assertions = getVariableListAssertions(testCase);
  } else if (type === 'function_state') {
    normalized.function_name = asStringOr(testCase.function_name, '');
    normalized.parameter_count_enabled = normalizeFunctionParameterCountEnabled(testCase);
    normalized.parameter_count = asNonNegativeInteger(testCase.parameter_count, 0);
    normalized.return_assertion = getFunctionReturnAssertion(testCase);
  }

  return normalized;
}

function normalizePublishTestCase(testCase) {
  const type = asStringOr(testCase.type, '');
  const normalized = {
    id: asStringOr(testCase.id, ''),
    type,
    points: getTestPoints(testCase),
    ...(testCase.feedback_on_pass !== undefined ? { feedback_on_pass: asStringOr(testCase.feedback_on_pass, '') } : {}),
    ...(testCase.feedback_on_fail !== undefined ? { feedback_on_fail: asStringOr(testCase.feedback_on_fail, '') } : {}),
  };

  if (type === 'stdout_match') {
    normalized.prompt_inputs = getPromptInputs(testCase);
    if (testCase.strict_prompt_inputs !== undefined) {
      normalized.strict_prompt_inputs = shouldEnforcePromptInputCount(testCase);
    }
    normalized.output_assertion = getStdoutOutputAssertion(testCase);
    normalized.prompt_assertion = getStdoutPromptAssertion(testCase);
    const executionContext = getStdoutExecutionContext(testCase);
    if (executionContext.scope === 'function') {
      normalized.execution_context = executionContext;
    }
  } else if (type === 'block_structure') {
    normalized.conditions = normalizePublishCondition(testCase.conditions);
  } else if (type === 'variable_state') {
    normalized.prompt_inputs = getPromptInputs(testCase);
    if (testCase.strict_prompt_inputs !== undefined) {
      normalized.strict_prompt_inputs = shouldEnforcePromptInputCount(testCase);
    }
    normalized.variable_name = asStringOr(testCase.variable_name, '');
    if (testCase.expected_type !== undefined) {
      normalized.expected_type = normalizeVariableType(testCase.expected_type);
    }
    if (testCase.value_assertion_enabled !== undefined || testCase.expected_value !== undefined) {
      normalized.value_assertion_enabled = normalizeVariableValueAssertionEnabled(testCase);
    }
    if (testCase.expected_value !== undefined) {
      normalized.expected_value = testCase.expected_value;
    }
    if (testCase.comparison !== undefined) {
      normalized.comparison = asStringOr(testCase.comparison, '');
    }
    if (testCase.show_coerced_value_hint !== undefined) {
      normalized.show_coerced_value_hint = Boolean(testCase.show_coerced_value_hint);
    }
    if (testCase.list_assertions !== undefined) {
      normalized.list_assertions = getVariableListAssertions(testCase);
    }
  } else if (type === 'function_state') {
    normalized.function_name = asStringOr(testCase.function_name, '');
    if (testCase.parameter_count_enabled !== undefined) {
      normalized.parameter_count_enabled = normalizeFunctionParameterCountEnabled(testCase);
    }
    if (testCase.parameter_count !== undefined) {
      normalized.parameter_count = asNonNegativeInteger(testCase.parameter_count, 0);
    }
    if (testCase.return_assertion !== undefined) {
      normalized.return_assertion = getFunctionReturnAssertion(testCase);
    }
  }

  return normalized;
}

function normalizeDraftCondition(condition) {
  if (!isObjectLike(condition) || !VALID_CONDITION_TYPES.includes(condition.type)) {
    return { type: 'workspace_empty' };
  }

  switch (condition.type) {
    case 'block_exists':
      return {
        type: condition.type,
        block_type: asStringOr(condition.block_type, ''),
        min_count: asPositiveInteger(condition.min_count, 1),
      };
    case 'block_missing':
      return {
        type: condition.type,
        block_type: asStringOr(condition.block_type, ''),
      };
    case 'block_connected':
      return {
        type: condition.type,
        upper_type: asStringOr(condition.upper_type, ''),
        lower_type: asStringOr(condition.lower_type, ''),
      };
    case 'block_nested':
      {
        const matchMode = normalizeFieldValueMatchMode(condition.match_mode);
        const caseSensitive = normalizeFieldValueCaseSensitivity(
          condition.case_sensitive,
          condition.regex_flags,
        );
      return {
        type: condition.type,
        outer_type: asStringOr(condition.outer_type, ''),
        inner_type: asStringOr(condition.inner_type, ''),
        input_name: asStringOr(condition.input_name, ''),
        ...(condition.field_name !== undefined
          ? { field_name: asStringOr(condition.field_name, '') }
          : {}),
        ...(condition.expected_value !== undefined
          ? { expected_value: condition.expected_value ?? '' }
          : {}),
        match_mode: matchMode,
        case_sensitive: caseSensitive,
        regex_flags: getCanonicalRegexFlags(condition.regex_flags),
      };
      }
    case 'block_field_value':
      return {
        type: condition.type,
        block_type: asStringOr(condition.block_type, ''),
        field_name: asStringOr(condition.field_name, ''),
        expected_value: condition.expected_value ?? '',
        match_mode: normalizeFieldValueMatchMode(condition.match_mode),
        case_sensitive: normalizeFieldValueCaseSensitivity(
          condition.case_sensitive,
          condition.regex_flags,
        ),
        regex_flags: getCanonicalRegexFlags(condition.regex_flags),
      };
    case BLOCK_PATTERN_TYPE:
      return {
        type: condition.type,
        workspace_state: isObjectLike(condition.workspace_state) ? condition.workspace_state : null,
        field_constraints: normalizePatternFieldConstraints(condition.field_constraints),
        param_constraints: normalizePatternParamConstraints(condition.param_constraints),
      };
    case 'block_count':
      return {
        type: condition.type,
        block_type: asStringOr(condition.block_type, ''),
        min: asNonNegativeInteger(condition.min, 0),
        max: asNonNegativeInteger(condition.max, 10),
      };
    case 'workspace_connectedness':
      return {
        type: condition.type,
        mode: normalizeWorkspaceConnectednessMode(condition.mode),
      };
    case 'all':
    case 'any':
    case 'none': {
      const conditions = Array.isArray(condition.conditions)
        ? condition.conditions.filter(isObjectLike).map(normalizeDraftCondition)
        : [];
      return {
        type: condition.type,
        conditions: conditions.length > 0 ? conditions : [{ type: 'workspace_empty' }],
      };
    }
    default:
      return { type: 'workspace_empty' };
  }
}

function normalizePublishCondition(condition) {
  if (!isObjectLike(condition)) return null;

  const type = asStringOr(condition.type, '');
  if (!VALID_CONDITION_TYPES.includes(type)) {
    return { type };
  }

  switch (type) {
    case 'block_exists':
      return {
        type,
        block_type: asStringOr(condition.block_type, ''),
        ...(condition.min_count !== undefined ? { min_count: asPositiveInteger(condition.min_count, 1) } : {}),
      };
    case 'block_missing':
      return {
        type,
        block_type: asStringOr(condition.block_type, ''),
      };
    case 'block_connected':
      return {
        type,
        upper_type: asStringOr(condition.upper_type, ''),
        lower_type: asStringOr(condition.lower_type, ''),
      };
    case 'block_nested':
      {
        const fieldName = asStringOr(condition.field_name, '').trim();
        const hasScopedValueConstraint = fieldName !== ''
          || condition.expected_value !== undefined
          || normalizeFieldValueMatchMode(condition.match_mode) !== 'exact'
          || normalizeFieldValueCaseSensitivity(condition.case_sensitive, condition.regex_flags) === false
          || getCanonicalRegexFlags(condition.regex_flags) !== '';
        const matchMode = normalizeFieldValueMatchMode(condition.match_mode);
        const caseSensitive = normalizeFieldValueCaseSensitivity(
          condition.case_sensitive,
          condition.regex_flags,
        );
        const regexFlags = getCanonicalRegexFlags(condition.regex_flags);
      return {
        type,
        outer_type: asStringOr(condition.outer_type, ''),
        inner_type: asStringOr(condition.inner_type, ''),
        input_name: asStringOr(condition.input_name, ''),
        ...(fieldName !== '' ? { field_name: fieldName } : {}),
        ...(hasScopedValueConstraint && condition.expected_value !== undefined
          ? { expected_value: condition.expected_value }
          : {}),
        ...(hasScopedValueConstraint && (condition.match_mode !== undefined || matchMode !== 'exact')
          ? { match_mode: matchMode }
          : {}),
        ...(hasScopedValueConstraint && (!caseSensitive || condition.case_sensitive !== undefined || String(condition.regex_flags ?? '').includes('i'))
          ? { case_sensitive: caseSensitive }
          : {}),
        ...(hasScopedValueConstraint && (condition.regex_flags !== undefined || regexFlags !== '')
          ? { regex_flags: regexFlags }
          : {}),
      };
      }
    case 'block_field_value':
      {
        const matchMode = normalizeFieldValueMatchMode(condition.match_mode);
        const caseSensitive = normalizeFieldValueCaseSensitivity(
          condition.case_sensitive,
          condition.regex_flags,
        );
        const regexFlags = getCanonicalRegexFlags(condition.regex_flags);
      return {
        type,
        block_type: asStringOr(condition.block_type, ''),
        field_name: asStringOr(condition.field_name, ''),
        ...(condition.expected_value !== undefined ? { expected_value: condition.expected_value } : {}),
        ...(condition.match_mode !== undefined || matchMode !== 'exact' ? { match_mode: matchMode } : {}),
        ...(!caseSensitive || condition.case_sensitive !== undefined || String(condition.regex_flags ?? '').includes('i')
          ? { case_sensitive: caseSensitive }
          : {}),
        ...(condition.regex_flags !== undefined || regexFlags !== '' ? { regex_flags: regexFlags } : {}),
      };
      }
    case BLOCK_PATTERN_TYPE: {
      const fieldConstraints = normalizePatternFieldConstraints(condition.field_constraints);
      const paramConstraints = normalizePatternParamConstraints(condition.param_constraints);
      return {
        type,
        ...(isObjectLike(condition.workspace_state) ? { workspace_state: condition.workspace_state } : {}),
        ...(Object.keys(fieldConstraints).length > 0 ? { field_constraints: fieldConstraints } : {}),
        ...(Object.keys(paramConstraints).length > 0 ? { param_constraints: paramConstraints } : {}),
      };
    }
    case 'block_count':
      return {
        type,
        block_type: asStringOr(condition.block_type, ''),
        ...(condition.min !== undefined ? { min: asNonNegativeInteger(condition.min, 0) } : {}),
        ...(condition.max !== undefined ? { max: asNonNegativeInteger(condition.max, 10) } : {}),
      };
    case 'workspace_connectedness':
      return {
        type,
        mode: normalizeWorkspaceConnectednessMode(condition.mode),
      };
    case 'all':
    case 'any':
    case 'none':
      return {
        type,
        conditions: Array.isArray(condition.conditions)
          ? condition.conditions.filter(isObjectLike).map(normalizePublishCondition)
          : [],
      };
    default:
      return { type: 'workspace_empty' };
  }
}

function cloneConfig(config) {
  if (!isObjectLike(config)) return {};
  return JSON.parse(JSON.stringify(config));
}

function isObjectLike(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function asStringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function asNonNegativeInteger(value, fallback) {
  const normalized = asOptionalInteger(value, fallback);
  if (normalized === null) return null;
  return normalized < 0 ? fallback : normalized;
}

function asPositiveInteger(value, fallback) {
  const normalized = asOptionalInteger(value, fallback);
  if (normalized === null) return fallback;
  return normalized < 1 ? fallback : normalized;
}

function normalizeLegacyHintDisplayMode(uiSettings) {
  return uiSettings?.hint_display_mode === 'checklist' ? 'checklist' : 'triggered';
}

function normalizePerHintDisplayMode(value, fallback = 'triggered') {
  if (VALID_HINT_DISPLAY_MODES.includes(value)) {
    return value;
  }
  return fallback === 'checklist' ? 'checklist' : 'triggered';
}

function normalizePatternParamConstraints(value) {
  if (!isObjectLike(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([blockId, constraint]) => {
        const normalized = normalizeParamCountConstraint(constraint);
        return normalized ? [[blockId, normalized]] : [];
      })
      .flat(),
  );
}

function normalizePatternFieldConstraints(value) {
  if (!isObjectLike(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([blockId, fields]) => {
        if (!isObjectLike(fields)) return [];

        const normalizedFields = Object.fromEntries(
          Object.entries(fields)
            .map(([fieldName, constraint]) => {
              if (!isObjectLike(constraint)) return [];
              return [[fieldName, {
                expected_value: constraint.expected_value ?? '',
                match_mode: normalizeFieldValueMatchMode(constraint.match_mode),
                case_sensitive: normalizeFieldValueCaseSensitivity(
                  constraint.case_sensitive,
                  constraint.regex_flags,
                ),
                regex_flags: getCanonicalRegexFlags(constraint.regex_flags),
              }]];
            })
            .flat(),
        );

        return Object.keys(normalizedFields).length > 0
          ? [[blockId, normalizedFields]]
          : [];
      })
      .flat(),
  );
}
