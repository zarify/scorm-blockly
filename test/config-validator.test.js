/**
 * Config validation — the gate between an authored `activity_config` and every
 * consumer downstream of it (the builder's save path, the SCORM template, the
 * grader).
 *
 * The interesting edges are the ones a hand-edited, imported or legacy config
 * carries: missing containers, ids outside the activity_id charset, tests that
 * award nothing, test types whose required sub-shape is absent, condition trees
 * with unknown or malformed nodes, pattern conditions whose serialized
 * workspace will not load, and hints whose trigger is half-specified.
 *
 * Paths are asserted exactly — the builder highlights the offending field by
 * path — while messages are matched loosely wherever the wording is
 * user-facing (the `Must be one of: …` enumerations, prose sentences).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBuilderDraftConfig,
  validateConfig,
  validateHintConfig,
  validateTestCaseConfig,
  validateToolboxCategoryConfig,
} from '../src/shared/config-validator.js';
import { activityConfig, blockPatternTestConfig, hint } from './helpers/config.js';
import { stateOf, workspaceWith } from './helpers/blockly.js';

/** Every error path, in the order the validator produced them. */
const pathsOf = (result) => result.errors.map((error) => error.path);

/** The error(s) recorded against one JSON path. */
const errorsAt = (result, path) => result.errors.filter((error) => error.path === path);

/** Exactly one error at `path`, matching `pattern` when one is given. */
function assertOneErrorAt(result, path, pattern) {
  const matches = errorsAt(result, path);
  assert.equal(
    matches.length,
    1,
    `expected 1 error at "${path}", got ${JSON.stringify(result.errors)}`,
  );
  if (pattern) assert.match(matches[0].message, pattern);
  return matches[0];
}

function assertValid(result) {
  assert.deepEqual(result, { valid: true, errors: [] });
}

/** A stdout_match test that passes on its own. */
function stdoutTest(overrides = {}) {
  return {
    id: 'print',
    type: 'stdout_match',
    points: 10,
    output_assertion: { enabled: true, expected: 'hi\n' },
    ...overrides,
  };
}

/** A block_structure test wrapping `conditions`. */
function structureTest(conditions, overrides = {}) {
  return { id: 'shape', type: 'block_structure', points: 10, conditions, ...overrides };
}

/** Serialized single-block pattern workspace whose root is a `text` block. */
const textPatternState = () => stateOf(workspaceWith([{ type: 'text', id: 'txt1' }]));

/** Serialized pattern workspace whose single root is a procedure definition. */
const procedurePatternState = () => stateOf(
  workspaceWith([{ type: 'procedures_defnoreturn', id: 'proc1', fields: { NAME: 'doIt' } }]),
);

test('a non-object config is rejected with one pathless error, in both validators', () => {
  const expected = { valid: false, errors: [{ path: '', message: 'Config must be a non-null object' }] };

  for (const input of [null, undefined, NaN, 0, false, 1, true, '', 'activity', () => {}]) {
    assert.deepEqual(validateConfig(input), expected, `full validation accepted ${String(input)}`);
    assert.deepEqual(
      validateBuilderDraftConfig(input),
      expected,
      `draft validation accepted ${String(input)}`,
    );
  }
});

test('an array is an object to the validator, so it reports the missing containers instead', () => {
  const result = validateConfig([]);

  assert.equal(result.valid, false);
  assert.deepEqual(pathsOf(result), ['metadata', 'blockly_setup', 'evaluation']);
  assert.equal(errorsAt(result, '').length, 0);
});

test('every missing top-level container is reported once, at its own path', () => {
  const full = validateConfig({});
  assert.deepEqual(pathsOf(full), ['metadata', 'blockly_setup', 'evaluation']);
  assertOneErrorAt(full, 'metadata', /Required field is missing/);
  assertOneErrorAt(full, 'blockly_setup', /Required field is missing/);
  assertOneErrorAt(full, 'evaluation', /Required field is missing/);

  const draft = validateBuilderDraftConfig({});
  assert.deepEqual(pathsOf(draft), [
    'metadata',
    'instructions',
    'ui_settings',
    'blockly_setup',
    'evaluation',
  ]);
});

test('a null container is reported as missing, not as the wrong type', () => {
  const result = validateConfig({ metadata: null, blockly_setup: null, evaluation: null });
  assert.deepEqual(pathsOf(result), ['metadata', 'blockly_setup', 'evaluation']);
  assertOneErrorAt(result, 'evaluation', /Required field is missing/);

  const nested = validateConfig(activityConfig({ evaluation: { test_cases: null } }));
  assert.deepEqual(pathsOf(nested), ['evaluation.test_cases']);
});

test('activity_id rejects anything outside lowercase letters, digits and underscores', () => {
  const rejected = [
    'Test_Activity', 'TEST', 'test-activity', 'test activity', 'activité',
    'Ünicode', 'test.activity', 'test/activity', 'test:1',
  ];
  for (const activity_id of rejected) {
    const result = validateConfig(activityConfig({ metadata: { activity_id } }));
    assert.equal(result.valid, false, `"${activity_id}" should be rejected`);
    assertOneErrorAt(result, 'metadata.activity_id', /lowercase alphanumeric/);
  }

  for (const activity_id of ['test_activity', 'test_activity_2', 'a', 'a1', '123']) {
    const result = validateConfig(activityConfig({ metadata: { activity_id } }));
    assert.equal(
      errorsAt(result, 'metadata.activity_id').length,
      0,
      `"${activity_id}" should be accepted`,
    );
  }
});

test('metadata fields are checked for presence and type before the charset rule', () => {
  const wrongTypes = validateConfig(activityConfig({ metadata: { activity_id: 42, title: 7 } }));
  assertOneErrorAt(wrongTypes, 'metadata.activity_id', /Must be string, got number/);
  assertOneErrorAt(wrongTypes, 'metadata.title', /Must be string, got number/);

  const empty = validateConfig(activityConfig({
    metadata: { activity_id: undefined, title: undefined },
  }));
  assert.deepEqual(pathsOf(empty), ['metadata.activity_id', 'metadata.title']);
  assertOneErrorAt(empty, 'metadata.title', /Required field is missing/);
});

test('suspend_data_limit must be an integer of at least 512 characters', () => {
  for (const suspend_data_limit of [511, 0, -1, -4096, 1.5, 512.5, '4096', 'lots', true, NaN, Infinity, []]) {
    const result = validateConfig(activityConfig({ ui_settings: { suspend_data_limit } }));
    assert.equal(result.valid, false, `${String(suspend_data_limit)} should be rejected`);
    assertOneErrorAt(result, 'ui_settings.suspend_data_limit', /integer of at least 512/);
  }

  for (const suspend_data_limit of [512, 513, 4096, 1000000, undefined, null]) {
    const result = validateConfig(activityConfig({ ui_settings: { suspend_data_limit } }));
    assertValid(result);
  }

  // ui_settings is optional as a whole; only the limit inside it is checked.
  const withoutUiSettings = activityConfig();
  delete withoutUiSettings.ui_settings;
  assertValid(validateConfig(withoutUiSettings));
});

test('test_cases must be a present, non-empty array', () => {
  const empty = validateConfig(activityConfig({ evaluation: { test_cases: [] } }));
  assertOneErrorAt(empty, 'evaluation.test_cases', /at least one test case/);

  const missing = validateConfig(activityConfig({ evaluation: { test_cases: undefined } }));
  assertOneErrorAt(missing, 'evaluation.test_cases', /Required field is missing/);

  for (const test_cases of ['x', {}, 42, true]) {
    const result = validateConfig(activityConfig({ evaluation: { test_cases } }));
    assert.deepEqual(pathsOf(result), ['evaluation.test_cases']);
    assertOneErrorAt(result, 'evaluation.test_cases', /Must be an array/);
  }
});

test('at least one test must award more than zero points', () => {
  const allZero = validateConfig(activityConfig({
    evaluation: { test_cases: [stdoutTest({ points: 0 }), stdoutTest({ id: 'second', points: 0 })] },
  }));
  assertOneErrorAt(allZero, 'evaluation.test_cases', /at least one test must award more than 0 points/i);

  const mixed = validateConfig(activityConfig({
    evaluation: { test_cases: [stdoutTest({ points: 0 }), stdoutTest({ id: 'second', points: 5 })] },
  }));
  assertValid(mixed);
});

test('weight is accepted as the legacy alias for points, and points wins when both exist', () => {
  assertValid(validateConfig(activityConfig({
    evaluation: { test_cases: [stdoutTest({ points: undefined, weight: 10 })] },
  })));
  assertValid(validateTestCaseConfig(stdoutTest({ points: undefined, weight: 10 })));

  const zeroWeight = validateConfig(activityConfig({
    evaluation: { test_cases: [stdoutTest({ points: undefined, weight: 0 })] },
  }));
  assertOneErrorAt(zeroWeight, 'evaluation.test_cases', /more than 0 points/);

  const shadowed = validateConfig(activityConfig({
    evaluation: { test_cases: [stdoutTest({ points: 0, weight: 10 })] },
  }));
  assertOneErrorAt(shadowed, 'evaluation.test_cases', /more than 0 points/);
});

test('points are per-test non-negative integers, and a missing value is its own error', () => {
  assertValid(validateTestCaseConfig(stdoutTest({ points: 0 })));

  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ points: -5 })),
    'evaluation.test_cases[0].points',
    /greater than or equal to 0/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ points: 1.5 })),
    'evaluation.test_cases[0].points',
    /greater than or equal to 0/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ points: '10' })),
    'evaluation.test_cases[0].points',
    /greater than or equal to 0/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ points: undefined })),
    'evaluation.test_cases[0].points',
    /Required field is missing/,
  );

  // A negative score is reported per test first, then by the total.
  const aggregate = validateConfig(activityConfig({
    evaluation: { test_cases: [stdoutTest({ points: -5 })] },
  }));
  assert.deepEqual(pathsOf(aggregate), [
    'evaluation.test_cases[0].points',
    'evaluation.test_cases',
  ]);
});

test('a test case reports its own index in every path', () => {
  const blank = validateTestCaseConfig({}, 2);
  assert.deepEqual(pathsOf(blank), [
    'evaluation.test_cases[2].id',
    'evaluation.test_cases[2].type',
    'evaluation.test_cases[2].points',
  ]);
  assertOneErrorAt(blank, 'evaluation.test_cases[2].id', /Required field is missing/);

  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ id: '   ' })),
    'evaluation.test_cases[0].id',
    /Must not be empty/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ id: 7 })),
    'evaluation.test_cases[0].id',
    /Must be string, got number/,
  );
});

test('an unknown test type is reported once and skips the type-specific rules', () => {
  const result = validateTestCaseConfig(stdoutTest({ type: 'stdout_matcher' }));

  assert.deepEqual(pathsOf(result), ['evaluation.test_cases[0].type']);
  assertOneErrorAt(result, 'evaluation.test_cases[0].type', /Must be one of/);
});

test('block_structure requires a condition tree', () => {
  const missing = validateTestCaseConfig({ id: 'shape', type: 'block_structure', points: 5 });
  assert.deepEqual(pathsOf(missing), ['evaluation.test_cases[0].conditions']);
  assertOneErrorAt(missing, 'evaluation.test_cases[0].conditions', /Required for block_structure/);

  assertValid(validateTestCaseConfig(structureTest({ type: 'workspace_empty' })));
});

test('variable_state needs a variable name and a reason to check something', () => {
  const nameless = validateTestCaseConfig({ id: 'total', type: 'variable_state', points: 5 });
  assertOneErrorAt(nameless, 'evaluation.test_cases[0].variable_name', /Required field is missing/);
  assertOneErrorAt(nameless, 'evaluation.test_cases[0]', /must enable a value assertion/);

  const bare = validateTestCaseConfig({
    id: 'total', type: 'variable_state', points: 5, variable_name: 'total',
  });
  assert.deepEqual(pathsOf(bare), ['evaluation.test_cases[0]']);
  assertOneErrorAt(bare, 'evaluation.test_cases[0]', /must enable a value assertion/);

  assertValid(validateTestCaseConfig({
    id: 'total', type: 'variable_state', points: 5, variable_name: 'total', expected_type: 'int',
  }));
  assertValid(validateTestCaseConfig({
    id: 'total', type: 'variable_state', points: 5, variable_name: 'total', expected_value: 0,
  }));
});

test('variable_state assertion options are checked against the allowed sets', () => {
  const onWithoutValue = validateTestCaseConfig({
    id: 'total', type: 'variable_state', points: 5, variable_name: 'total',
    value_assertion_enabled: true, expected_type: 'int',
  });
  assertOneErrorAt(
    onWithoutValue,
    'evaluation.test_cases[0].expected_value',
    /Required when value_assertion_enabled/,
  );

  const offAndTypeless = validateTestCaseConfig({
    id: 'total', type: 'variable_state', points: 5, variable_name: 'total',
    value_assertion_enabled: false, expected_value: 3,
  });
  assertOneErrorAt(offAndTypeless, 'evaluation.test_cases[0]', /must enable a value assertion/);
  assert.equal(errorsAt(offAndTypeless, 'evaluation.test_cases[0].expected_value').length, 0);

  assertOneErrorAt(
    validateTestCaseConfig({
      id: 'total', type: 'variable_state', points: 5, variable_name: 'total',
      expected_value: 1, comparison: 'bogus',
    }),
    'evaluation.test_cases[0].comparison',
    /Invalid comparison operator/,
  );
  assertOneErrorAt(
    validateTestCaseConfig({
      id: 'total', type: 'variable_state', points: 5, variable_name: 'total',
      expected_type: 'nope',
    }),
    'evaluation.test_cases[0].expected_type',
    /Must be one of/,
  );
  assertOneErrorAt(
    validateTestCaseConfig({
      id: 'total', type: 'variable_state', points: 5, variable_name: 'total',
      expected_value: 1, value_assertion_enabled: 'yes',
    }),
    'evaluation.test_cases[0].value_assertion_enabled',
    /Must be a boolean/,
  );
});

test('function_state needs a function name and a count when counting parameters', () => {
  const nameless = validateTestCaseConfig({ id: 'call', type: 'function_state', points: 5 });
  assertOneErrorAt(nameless, 'evaluation.test_cases[0].function_name', /Required field is missing/);

  assertValid(validateTestCaseConfig({
    id: 'call', type: 'function_state', points: 5, function_name: 'add',
  }));

  const counting = validateTestCaseConfig({
    id: 'call', type: 'function_state', points: 5, function_name: 'add',
    parameter_count_enabled: true,
  });
  assertOneErrorAt(counting, 'evaluation.test_cases[0].parameter_count', /Required when parameter_count_enabled/);

  assertOneErrorAt(
    validateTestCaseConfig({
      id: 'call', type: 'function_state', points: 5, function_name: 'add', parameter_count: -1,
    }),
    'evaluation.test_cases[0].parameter_count',
    /non-negative integer/,
  );

  assertOneErrorAt(
    validateTestCaseConfig({
      id: 'call', type: 'function_state', points: 5, function_name: 'add',
      return_assertion: { enabled: true },
    }),
    'evaluation.test_cases[0].return_assertion',
    /must enable a value assertion/,
  );
});

test('stdout_match must enable an assertion, and legacy fields enable one implicitly', () => {
  const noneEnabled = validateTestCaseConfig(stdoutTest({
    output_assertion: { enabled: false },
    prompt_assertion: { enabled: false },
  }));
  assert.deepEqual(pathsOf(noneEnabled), ['evaluation.test_cases[0]']);
  assertOneErrorAt(noneEnabled, 'evaluation.test_cases[0]', /enable output_assertion, prompt_assertion, or both/);

  assertValid(validateTestCaseConfig(stdoutTest({
    output_assertion: { enabled: false },
    prompt_assertion: { enabled: true, expected: 'name' },
  })));

  // 1.0 configs carry only expected_output / match_mode; those enable the output assertion.
  assertValid(validateTestCaseConfig({
    id: 'print', type: 'stdout_match', points: 5, expected_output: 'hi\n',
  }));
  assertOneErrorAt(
    validateTestCaseConfig({ id: 'print', type: 'stdout_match', points: 5, match_mode: 'fuzzy' }),
    'evaluation.test_cases[0].match_mode',
    /exact, contains, or regex/,
  );
});

test('stdout_match assertion fields are type-checked at their own path', () => {
  const badOutput = validateTestCaseConfig(stdoutTest({
    output_assertion: { enabled: true, expected: 42, match_mode: 'fuzzy', match_any_item: 'yes' },
  }));
  assertOneErrorAt(badOutput, 'evaluation.test_cases[0].output_assertion.expected', /Must be a string/);
  assertOneErrorAt(badOutput, 'evaluation.test_cases[0].output_assertion.match_mode', /exact, contains, or regex/);
  assertOneErrorAt(badOutput, 'evaluation.test_cases[0].output_assertion.match_any_item', /Must be a boolean/);

  const badPrompt = validateTestCaseConfig(stdoutTest({
    prompt_assertion: { enabled: true, expected: 7 },
  }));
  assertOneErrorAt(badPrompt, 'evaluation.test_cases[0].prompt_assertion.expected', /Must be a string/);

  // A malformed assertion object also leaves stdout_match with nothing enabled.
  const notAnObject = validateTestCaseConfig(stdoutTest({ output_assertion: 'hi\n' }));
  assert.deepEqual(pathsOf(notAnObject), [
    'evaluation.test_cases[0].output_assertion',
    'evaluation.test_cases[0]',
  ]);
  assertOneErrorAt(notAnObject, 'evaluation.test_cases[0].output_assertion', /Must be an object/);
  assertOneErrorAt(notAnObject, 'evaluation.test_cases[0]', /enable output_assertion, prompt_assertion/);
});

test('stdout_match execution context checks scope, arguments and function name', () => {
  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ execution_context: { scope: 'sandbox' } })),
    'evaluation.test_cases[0].execution_context.scope',
    /Must be one of/,
  );

  const functionScope = validateTestCaseConfig(stdoutTest({
    execution_context: { scope: 'function', function_name: 'add' },
  }));
  assert.deepEqual(pathsOf(functionScope), ['evaluation.test_cases[0].execution_context.arguments']);
  assertOneErrorAt(
    functionScope,
    'evaluation.test_cases[0].execution_context.arguments',
    /Required when execution_context.scope is "function"/,
  );

  // Naming a function without a scope is enough to infer function scope.
  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({ execution_context: { function_name: 'add' } })),
    'evaluation.test_cases[0].execution_context.arguments',
    /Required when execution_context.scope is "function"/,
  );

  const mainScope = validateTestCaseConfig(stdoutTest({
    execution_context: { scope: 'main', function_name: 'add' },
  }));
  assert.equal(mainScope.valid, true);

  assertOneErrorAt(
    validateTestCaseConfig(stdoutTest({
      execution_context: { scope: 'function', function_name: 'add', arguments: '1,2' },
    })),
    'evaluation.test_cases[0].execution_context.arguments',
    /Must be an array/,
  );

  assertValid(validateTestCaseConfig(stdoutTest({
    execution_context: { scope: 'function', function_name: 'add', arguments: ['1', '2'] },
  })));
});

test('an unknown condition type is reported at the node and stops the walk', () => {
  const unknown = validateTestCaseConfig(structureTest({ type: 'block_exist' }));
  assert.deepEqual(pathsOf(unknown), ['evaluation.test_cases[0].conditions.type']);
  assertOneErrorAt(unknown, 'evaluation.test_cases[0].conditions.type', /Must be one of/);

  for (const conditions of ['workspace_empty', 42, true]) {
    const result = validateTestCaseConfig(structureTest(conditions));
    assert.deepEqual(pathsOf(result), ['evaluation.test_cases[0].conditions']);
    assertOneErrorAt(result, 'evaluation.test_cases[0].conditions', /Condition must be an object/);
  }

  // An array is an object, so it reaches the type check with no type field.
  const emptyArray = validateTestCaseConfig(structureTest([]));
  assert.deepEqual(pathsOf(emptyArray), ['evaluation.test_cases[0].conditions.type']);
  assertOneErrorAt(emptyArray, 'evaluation.test_cases[0].conditions.type', /Must be one of/);

  // A falsy condition tree is caught before the object check.
  for (const conditions of [null, undefined, false, 0, '']) {
    const result = validateTestCaseConfig(structureTest(conditions));
    assert.deepEqual(pathsOf(result), ['evaluation.test_cases[0].conditions']);
    assertOneErrorAt(result, 'evaluation.test_cases[0].conditions', /Required for block_structure/);
  }
});

test('each condition type reports its own missing required fields', () => {
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({ type: 'block_exists' })),
    'evaluation.test_cases[0].conditions.block_type',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({ type: 'block_missing' })),
    'evaluation.test_cases[0].conditions.block_type',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({ type: 'block_count' })),
    'evaluation.test_cases[0].conditions.block_type',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({ type: 'block_connected', upper_type: 'text_print' })),
    'evaluation.test_cases[0].conditions.lower_type',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({
      type: 'block_nested', outer_type: 'controls_repeat_ext', inner_type: 'text_print',
    })),
    'evaluation.test_cases[0].conditions.input_name',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({ type: 'workspace_connectedness' })),
    'evaluation.test_cases[0].conditions.mode',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({ type: 'block_exists', block_type: '   ' })),
    'evaluation.test_cases[0].conditions.block_type',
    /Must not be empty/,
  );
});

test('composite conditions need a non-empty conditions array', () => {
  for (const type of ['all', 'any', 'none']) {
    for (const conditions of [undefined, null, [], 'x', {}, 7]) {
      const node = { type };
      if (conditions !== undefined) node.conditions = conditions;
      const result = validateTestCaseConfig(structureTest(node));
      assertOneErrorAt(
        result,
        'evaluation.test_cases[0].conditions.conditions',
        /non-empty conditions array/,
      );
    }
  }
});

test('an invalid condition nested in a composite is reported at its full path', () => {
  const result = validateTestCaseConfig(structureTest({
    type: 'any',
    conditions: [
      { type: 'workspace_empty' },
      { type: 'all', conditions: [{ type: 'block_exists', block_type: '' }, { type: 'nope' }] },
    ],
  }));

  assert.deepEqual(pathsOf(result), [
    'evaluation.test_cases[0].conditions.conditions[1].conditions[0].block_type',
    'evaluation.test_cases[0].conditions.conditions[1].conditions[1].type',
  ]);
  assertOneErrorAt(
    result,
    'evaluation.test_cases[0].conditions.conditions[1].conditions[0].block_type',
    /Must not be empty/,
  );
});

test('field value conditions reject unknown match modes and unusable regexes', () => {
  const fieldValue = (overrides) => structureTest({
    type: 'block_field_value', block_type: 'text', field_name: 'TEXT', ...overrides,
  });

  assertOneErrorAt(
    validateTestCaseConfig(fieldValue({ match_mode: 'fuzzy' })),
    'evaluation.test_cases[0].conditions.match_mode',
    /Must be one of/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(fieldValue({ match_mode: 'regex_full', expected_value: 'a(' })),
    'evaluation.test_cases[0].conditions.expected_value',
    /Invalid regex/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(fieldValue({ regex_flags: 'zz' })),
    'evaluation.test_cases[0].conditions.regex_flags',
    /regex flags/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(fieldValue({ case_sensitive: 'yes' })),
    'evaluation.test_cases[0].conditions.case_sensitive',
    /Must be a boolean/,
  );

  assertValid(validateTestCaseConfig(fieldValue({ expected_value: 'hi' })));
  assertValid(validateTestCaseConfig(fieldValue({
    match_mode: 'regex_full', expected_value: 'h.llo', regex_flags: 'm', case_sensitive: false,
  })));
});

test('a block_nested value constraint without a field name is rejected', () => {
  const nested = (overrides) => structureTest({
    type: 'block_nested',
    outer_type: 'controls_repeat_ext',
    inner_type: 'text_print',
    input_name: 'DO',
    ...overrides,
  });

  assertOneErrorAt(
    validateTestCaseConfig(nested({ expected_value: 'hi' })),
    'evaluation.test_cases[0].conditions.field_name',
    /Field name is required/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(nested({ match_mode: 'contains' })),
    'evaluation.test_cases[0].conditions.field_name',
    /Field name is required/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(nested({ field_name: 'TEXT', match_mode: 'regex_full', expected_value: 'a(' })),
    'evaluation.test_cases[0].conditions.expected_value',
    /Invalid regex/,
  );

  assertValid(validateTestCaseConfig(nested({ field_name: 'TEXT', expected_value: 'hi' })));
  assertValid(validateTestCaseConfig(nested({})));
});

test('workspace_connectedness mode must be one of the two known modes', () => {
  assertOneErrorAt(
    validateTestCaseConfig(structureTest({ type: 'workspace_connectedness', mode: 'mostly_connected' })),
    'evaluation.test_cases[0].conditions.mode',
    /Must be one of/,
  );

  for (const mode of ['all_connected', 'all_active']) {
    assertValid(validateTestCaseConfig(structureTest({ type: 'workspace_connectedness', mode })));
  }
});

test('a pattern condition needs one loadable root block', () => {
  const pattern = (overrides) => structureTest({ type: 'block_pattern', ...overrides });

  assertOneErrorAt(
    validateTestCaseConfig(pattern({})),
    'evaluation.test_cases[0].conditions.workspace_state',
    /saved pattern workspace/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({ workspace_state: {} })),
    'evaluation.test_cases[0].conditions.workspace_state',
    /at least one block/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({ workspace_state: stateOf(workspaceWith([])) })),
    'evaluation.test_cases[0].conditions.workspace_state',
    /at least one block/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({
      workspace_state: stateOf(workspaceWith([{ type: 'text' }, { type: 'text' }])),
    })),
    'evaluation.test_cases[0].conditions.workspace_state',
    /exactly one root/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({
      workspace_state: { blocks: { languageVersion: 0, blocks: [{ type: 'no_such_block' }] } },
    })),
    'evaluation.test_cases[0].conditions.workspace_state',
    /could not be loaded/,
  );

  assertValid(validateTestCaseConfig(pattern({ workspace_state: textPatternState() })));
  assertValid(validateConfig(blockPatternTestConfig(textPatternState())));
});

test('pattern field constraints must point at a block and field in the pattern', () => {
  const pattern = (overrides) => structureTest({
    type: 'block_pattern', workspace_state: textPatternState(), ...overrides,
  });

  assertOneErrorAt(
    validateTestCaseConfig(pattern({ field_constraints: { missing: { TEXT: { expected_value: 'x' } } } })),
    'evaluation.test_cases[0].conditions.field_constraints.missing',
    /not in the pattern workspace/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({ field_constraints: { txt1: { NOPE: { expected_value: 'x' } } } })),
    'evaluation.test_cases[0].conditions.field_constraints.txt1.NOPE',
    /is not present on block type text/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({ field_constraints: 'x' })),
    'evaluation.test_cases[0].conditions.field_constraints',
    /keyed by pattern block id/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({ field_constraints: { txt1: 'x' } })),
    'evaluation.test_cases[0].conditions.field_constraints.txt1',
    /keyed by field name/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({ field_constraints: { txt1: { TEXT: 'x' } } })),
    'evaluation.test_cases[0].conditions.field_constraints.txt1.TEXT',
    /Field constraint must be an object/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({ field_constraints: { txt1: { TEXT: { match_mode: 'fuzzy' } } } })),
    'evaluation.test_cases[0].conditions.field_constraints.txt1.TEXT.match_mode',
    /Must be one of/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({
      field_constraints: { txt1: { TEXT: { match_mode: 'regex_full', expected_value: 'a(' } } },
    })),
    'evaluation.test_cases[0].conditions.field_constraints.txt1.TEXT.expected_value',
    /Invalid regex/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(pattern({
      field_constraints: { txt1: { TEXT: { match_mode: 'regex_full', expected_value: 'a', regex_flags: 'zz' } } },
    })),
    'evaluation.test_cases[0].conditions.field_constraints.txt1.TEXT.regex_flags',
    /regex flags/,
  );

  assertValid(validateTestCaseConfig(pattern({
    field_constraints: { txt1: { TEXT: { match_mode: 'contains', expected_value: 'h' } } },
  })));
});

test('pattern parameter constraints need a procedure block and a known comparison', () => {
  const paramConstraints = (workspace_state, param_constraints) => structureTest({
    type: 'block_pattern', workspace_state, param_constraints,
  });

  assertOneErrorAt(
    validateTestCaseConfig(paramConstraints(textPatternState(), { txt1: { comparison: 'gte', count: 1 } })),
    'evaluation.test_cases[0].conditions.param_constraints.txt1',
    /does not expose a parameter list/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(paramConstraints(procedurePatternState(), { missing: { count: 1 } })),
    'evaluation.test_cases[0].conditions.param_constraints.missing',
    /not in the pattern workspace/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(paramConstraints(procedurePatternState(), { proc1: { comparison: 'at_least', count: 1 } })),
    'evaluation.test_cases[0].conditions.param_constraints.proc1.comparison',
    /Must be one of/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(paramConstraints(procedurePatternState(), { proc1: { comparison: 'equals', count: -1 } })),
    'evaluation.test_cases[0].conditions.param_constraints.proc1.count',
    /non-negative integer/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(paramConstraints(procedurePatternState(), { proc1: { comparison: 'equals', count: 1.5 } })),
    'evaluation.test_cases[0].conditions.param_constraints.proc1.count',
    /non-negative integer/,
  );
  assertOneErrorAt(
    validateTestCaseConfig(paramConstraints(procedurePatternState(), { proc1: 'two' })),
    'evaluation.test_cases[0].conditions.param_constraints.proc1',
    /must be an object/i,
  );
  assertOneErrorAt(
    validateTestCaseConfig(paramConstraints(procedurePatternState(), 'x')),
    'evaluation.test_cases[0].conditions.param_constraints',
    /keyed by pattern block id/,
  );

  assertValid(validateTestCaseConfig(
    paramConstraints(procedurePatternState(), { proc1: { comparison: 'gte', count: 2 } }),
  ));
});

test('a hint needs a non-empty id, a non-empty message and a trigger object', () => {
  const empty = validateHintConfig({}, 2);
  assert.deepEqual(pathsOf(empty), ['hints[2].id', 'hints[2].message', 'hints[2].trigger']);
  assertOneErrorAt(empty, 'hints[2].id', /Required field is missing/);

  assertOneErrorAt(validateHintConfig(hint({ id: '   ' })), 'hints[0].id', /Must not be empty/);
  assertOneErrorAt(validateHintConfig(hint({ message: '' })), 'hints[0].message', /Must not be empty/);
  assertOneErrorAt(
    validateHintConfig(hint({ message: 42 })),
    'hints[0].message',
    /Must be string, got number/,
  );

  assertValid(validateHintConfig(hint()));
});

test('a null hint trigger is reported once and skips the event check', () => {
  const result = validateHintConfig(hint({ trigger: null }));

  assert.deepEqual(pathsOf(result), ['hints[0].trigger']);
  assertOneErrorAt(result, 'hints[0].trigger', /Required field is missing/);
});

test('the hint trigger event must be one of the four known events', () => {
  assertOneErrorAt(
    validateHintConfig(hint({ trigger: { event: 'on_load' } })),
    'hints[0].trigger.event',
    /Must be one of/,
  );
  assertOneErrorAt(
    validateHintConfig({ id: 'h', message: 'm', trigger: {} }),
    'hints[0].trigger.event',
    /Must be one of/,
  );

  for (const event of ['workspace_change', 'test_fail', 'manual']) {
    assertValid(validateHintConfig({ id: 'h', message: 'm', trigger: { event } }));
  }

  // `timed` was offered by the builder and accepted by the schema, but nothing
  // in the runtime ever fired it, so a hint using it could never appear.
  assertOneErrorAt(
    validateHintConfig({ id: 'h', message: 'm', trigger: { event: 'timed' } }),
    'hints[0].trigger.event',
    /Must be one of/,
  );
});

test('the hint display mode must be triggered or checklist, and defaults when omitted', () => {
  assertOneErrorAt(
    validateHintConfig(hint({ display_mode: 'always' })),
    'hints[0].display_mode',
    /Must be one of/,
  );
  assertOneErrorAt(
    validateHintConfig(hint({ display_mode: 1 })),
    'hints[0].display_mode',
    /Must be one of/,
  );

  for (const display_mode of ['triggered', 'checklist']) {
    assertValid(validateHintConfig(hint({ display_mode })));
  }
  assertValid(validateHintConfig(hint({ display_mode: undefined })));
});

test('hint trigger conditions are validated with the same rules as test conditions', () => {
  const trigger = (conditions) => ({ id: 'h', message: 'm', trigger: { event: 'workspace_change', conditions } });

  assertOneErrorAt(
    validateHintConfig(trigger({ type: 'block_exists' })),
    'hints[0].trigger.conditions.block_type',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateHintConfig(trigger({ type: 'none', conditions: [] })),
    'hints[0].trigger.conditions.conditions',
    /non-empty conditions array/,
  );
  assertOneErrorAt(
    validateHintConfig(trigger({ type: 'workspace_connectedness', mode: 'nope' })),
    'hints[0].trigger.conditions.mode',
    /Must be one of/,
  );

  assertValid(validateHintConfig(trigger({ type: 'workspace_empty' })));
  assertValid(validateHintConfig({ id: 'h', message: 'm', trigger: { event: 'manual' } }));
});

test('hints are validated through the full config at their hints path', () => {
  const result = validateConfig(activityConfig({
    hints: [hint(), hint({ id: 'hint_2', trigger: { event: 'nope' } })],
  }));

  assert.equal(result.valid, false);
  assert.deepEqual(pathsOf(result), ['hints[1].trigger.event']);
  assertOneErrorAt(result, 'hints[1].trigger.event', /Must be one of/);

  assertValid(validateConfig(activityConfig({ hints: [] })));
  assertValid(validateConfig(activityConfig({ hints: [hint()] })));
});

test('a toolbox category needs a name and a non-empty block list', () => {
  assertValid(validateToolboxCategoryConfig({ name: 'Text', blocks: ['text_print', 'text'] }));

  assertOneErrorAt(
    validateToolboxCategoryConfig({ blocks: ['text_print'] }),
    'blockly_setup.toolbox.categories[0].name',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateToolboxCategoryConfig({ name: '', blocks: ['text_print'] }, 2),
    'blockly_setup.toolbox.categories[2].name',
    /Must not be empty/,
  );
  assertOneErrorAt(
    validateToolboxCategoryConfig({ name: 'Text' }, 1),
    'blockly_setup.toolbox.categories[1].blocks',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateToolboxCategoryConfig({ name: 'Text', blocks: [] }, 1),
    'blockly_setup.toolbox.categories[1].blocks',
    /at least one block/,
  );

  const wrongType = validateToolboxCategoryConfig({ name: 'Text', blocks: 'text_print' });
  assert.deepEqual(pathsOf(wrongType), ['blockly_setup.toolbox.categories[0].blocks']);
  assertOneErrorAt(wrongType, 'blockly_setup.toolbox.categories[0].blocks', /Must be an array/);
});

test('toolbox categories and containers are checked inside a full config', () => {
  const result = validateConfig(activityConfig({
    blockly_setup: {
      toolbox: { categories: [{ name: 'Text', blocks: ['text_print'] }, { name: '', blocks: [] }] },
    },
  }));
  assert.deepEqual(pathsOf(result), [
    'blockly_setup.toolbox.categories[1].name',
    'blockly_setup.toolbox.categories[1].blocks',
  ]);

  assertOneErrorAt(
    validateConfig(activityConfig({ blockly_setup: { toolbox: undefined } })),
    'blockly_setup.toolbox',
    /Required field is missing/,
  );
  assertOneErrorAt(
    validateConfig(activityConfig({ blockly_setup: { toolbox: { categories: {} } } })),
    'blockly_setup.toolbox.categories',
    /Must be an array/,
  );

  assertValid(validateConfig(activityConfig({ blockly_setup: { toolbox: { categories: [] } } })));
});

test('draft validation tolerates an unfinished activity that full validation rejects', () => {
  const draftOnly = {
    metadata: {},
    instructions: { steps: [] },
    ui_settings: {},
    blockly_setup: { toolbox: { categories: [] } },
    evaluation: { test_cases: [] },
  };

  assertValid(validateBuilderDraftConfig(draftOnly));

  const full = validateConfig(draftOnly);
  assert.equal(full.valid, false);
  assert.deepEqual(pathsOf(full), ['metadata.activity_id', 'metadata.title', 'evaluation.test_cases']);
});

test('draft validation requires the containers the builder writes but ignores their contents', () => {
  assertValid(validateBuilderDraftConfig(activityConfig()));

  const sparse = validateBuilderDraftConfig({
    metadata: {}, instructions: {}, ui_settings: {}, blockly_setup: {}, evaluation: {},
  });
  assert.deepEqual(pathsOf(sparse), [
    'instructions.steps',
    'blockly_setup.toolbox',
    'evaluation.test_cases',
  ]);

  assertOneErrorAt(
    validateBuilderDraftConfig({
      metadata: {}, instructions: { steps: 'x' }, ui_settings: {}, blockly_setup: {}, evaluation: {},
    }),
    'instructions.steps',
    /Must be an array/,
  );

  assertOneErrorAt(
    validateBuilderDraftConfig({
      metadata: {},
      instructions: { steps: [] },
      ui_settings: {},
      blockly_setup: { toolbox: { categories: [] } },
      evaluation: { test_cases: 'x' },
    }),
    'evaluation.test_cases',
    /Must be an array/,
  );

  // Out-of-charset ids, out-of-range limits and unknown test types are all
  // accepted by the draft shape — it only checks the container structure.
  assertValid(validateBuilderDraftConfig({
    metadata: { activity_id: 'NOT-An-ID' },
    instructions: { steps: [] },
    ui_settings: { suspend_data_limit: -1 },
    blockly_setup: { toolbox: { categories: [] } },
    evaluation: { test_cases: [{ type: 'nope', points: -1 }] },
  }));
});

test('draft validation requires hints to be an array when present', () => {
  const withHints = (hints) => ({
    metadata: {},
    instructions: { steps: [] },
    ui_settings: {},
    blockly_setup: { toolbox: { categories: [] } },
    evaluation: { test_cases: [] },
    hints,
  });

  assertOneErrorAt(validateBuilderDraftConfig(withHints('x')), 'hints', /Must be an array/);
  assertValid(validateBuilderDraftConfig(withHints([])));
  assertValid(validateBuilderDraftConfig(withHints([hint()])));
});

test('the reference config and both config fixtures pass full validation', () => {
  assertValid(validateConfig(activityConfig()));
  assertValid(validateConfig(activityConfig({ hints: [hint()] })));
  assertValid(validateConfig(blockPatternTestConfig(textPatternState())));
  assertValid(validateConfig(blockPatternTestConfig(procedurePatternState(), { id: 'proc_shape', points: 5 })));
});
