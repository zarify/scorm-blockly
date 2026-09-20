/**
 * Test case configuration helpers — the shapes the builder writes and the
 * runtime reads back.
 *
 * The interesting edges are the ones a legacy or hand-edited config can carry:
 * points stored under the old `weight` key, prompt input text that came from a
 * textarea (so strings, blank lines, CRLF), assertion objects that only set a
 * couple of fields, execution contexts that name a function without declaring a
 * scope, and list/function assertion blocks that are partial or malformed.
 *
 * `test-config.js` keeps no mutable module state, so tests import it directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPromptInputs,
  getFunctionReturnAssertion,
  getPromptInputs,
  getStdoutExecutionContext,
  getStdoutOutputAssertion,
  getStdoutPromptAssertion,
  getTestPoints,
  getVariableListAssertions,
  hasEnabledListAssertion,
  hasEnabledStdoutAssertion,
  normalizeFunctionParameterCountEnabled,
  normalizeListExpectedTypes,
  normalizeListIndexChecks,
  normalizeListLengthComparison,
  normalizeListItemTypeMode,
  normalizeListValueMatchMode,
  normalizeRuntimeTextAssertion,
  normalizeRuntimeTextMatchMode,
  normalizeTestCase,
  normalizeTestConfig,
  normalizeVariableType,
  normalizeVariableValueAssertionEnabled,
  parsePromptInputs,
  setTestPoints,
  shouldEnforcePromptInputCount,
} from '../src/shared/test-config.js';

test('points come from the modern field, falling back to the legacy weight', () => {
  assert.equal(getTestPoints({ points: 5 }), 5);
  assert.equal(getTestPoints({ weight: 7 }), 7);
  assert.equal(getTestPoints({ points: null, weight: 7 }), 7);
  assert.equal(getTestPoints({ points: undefined, weight: 7 }), 7);
  assert.equal(getTestPoints({ points: 0, weight: 7 }), 0);
  assert.equal(getTestPoints({ weight: 0 }), 0);
  assert.equal(getTestPoints({}), 0);
  assert.equal(getTestPoints(null), 0);
  assert.equal(getTestPoints(undefined), 0);
});

test('points are coerced to non-negative integers and junk reads as zero', () => {
  assert.equal(getTestPoints({ points: '12' }), 12);
  assert.equal(getTestPoints({ points: '  8  ' }), 8);
  assert.equal(getTestPoints({ points: 5.9 }), 5);
  assert.equal(getTestPoints({ points: -3 }), 0);
  assert.equal(getTestPoints({ points: '-2' }), 0);
  assert.equal(getTestPoints({ points: -0.5 }), 0);
  assert.equal(getTestPoints({ points: NaN }), 0);
  assert.equal(getTestPoints({ points: Infinity }), 0);
  assert.equal(getTestPoints({ points: 'abc' }), 0);
  assert.equal(getTestPoints({ points: true }), 1);
  assert.equal(getTestPoints({ points: {} }), 0);
});

test('setting points writes an integer and drops the legacy weight', () => {
  const legacy = { weight: 9 };
  setTestPoints(legacy, '4.7');
  assert.deepEqual(legacy, { points: 4 });
  assert.equal('weight' in legacy, false);

  const negative = { weight: 1 };
  setTestPoints(negative, -4);
  assert.deepEqual(negative, { points: 0 });

  const junk = { weight: 1 };
  setTestPoints(junk, 'abc');
  assert.deepEqual(junk, { points: 0 });

  const zero = { points: 3 };
  setTestPoints(zero, 0);
  assert.deepEqual(zero, { points: 0 });

  const replaced = { points: 3, weight: 2 };
  setTestPoints(replaced, 6);
  assert.deepEqual(replaced, { points: 6 });
});

test('a case reads its weight back after the builder rewrites it as points', () => {
  const testCase = { id: 't', type: 'stdout_match', weight: '3' };
  assert.equal(getTestPoints(testCase), 3);
  setTestPoints(testCase, getTestPoints(testCase));
  assert.equal(getTestPoints(testCase), 3);
  assert.deepEqual(testCase, { id: 't', type: 'stdout_match', points: 3 });
});

test('prompt inputs are read as text, and a non-array reads as none', () => {
  assert.deepEqual(getPromptInputs({ prompt_inputs: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(getPromptInputs({ prompt_inputs: [] }), []);
  assert.deepEqual(getPromptInputs({ prompt_inputs: 'a\nb' }), []);
  assert.deepEqual(getPromptInputs({ prompt_inputs: null }), []);
  assert.deepEqual(getPromptInputs({}), []);
  assert.deepEqual(getPromptInputs(null), []);

  assert.deepEqual(
    getPromptInputs({ prompt_inputs: [1, null, undefined, true, { a: 1 }] }),
    ['1', 'null', 'undefined', 'true', '[object Object]'],
  );
});

test('prompt input text round-trips through parse and format', () => {
  assert.deepEqual(parsePromptInputs(''), []);
  assert.deepEqual(parsePromptInputs('a'), ['a']);
  assert.deepEqual(parsePromptInputs('a\nb'), ['a', 'b']);
  assert.deepEqual(parsePromptInputs('a\r\nb'), ['a', 'b']);
  assert.deepEqual(parsePromptInputs('a\n'), ['a', '']);
  assert.deepEqual(parsePromptInputs('\n'), ['', '']);
  assert.deepEqual(parsePromptInputs('  a  \n b'), ['  a  ', ' b']);

  // Quotes, numbers and JSON-ish text are learner input, not markup.
  assert.deepEqual(parsePromptInputs('"hi"\n42\n{"a":1}'), ['"hi"', '42', '{"a":1}']);

  for (const text of ['', 'a', 'a\nb', 'a\n', '{"a":1}\n  spaced  ', 'x\ny\nz']) {
    assert.equal(formatPromptInputs(parsePromptInputs(text)), text);
  }

  assert.equal(formatPromptInputs(['a', '', 1]), 'a\n\n1');
  assert.equal(formatPromptInputs('not-an-array'), '');
  assert.equal(formatPromptInputs(null), '');
});

test('only an explicit false turns off strict prompt input counting', () => {
  assert.equal(shouldEnforcePromptInputCount({}), true);
  assert.equal(shouldEnforcePromptInputCount(null), true);
  assert.equal(shouldEnforcePromptInputCount({ strict_prompt_inputs: true }), true);
  assert.equal(shouldEnforcePromptInputCount({ strict_prompt_inputs: false }), false);
  assert.equal(shouldEnforcePromptInputCount({ strict_prompt_inputs: 0 }), true);
  assert.equal(shouldEnforcePromptInputCount({ strict_prompt_inputs: null }), true);
  assert.equal(shouldEnforcePromptInputCount({ strict_prompt_inputs: 'false' }), true);
});

test('runtime text match modes accept exact, contains and regex only', () => {
  assert.equal(normalizeRuntimeTextMatchMode('exact'), 'exact');
  assert.equal(normalizeRuntimeTextMatchMode('contains'), 'contains');
  assert.equal(normalizeRuntimeTextMatchMode('regex'), 'regex');
  assert.equal(normalizeRuntimeTextMatchMode('regex_full'), 'exact');
  assert.equal(normalizeRuntimeTextMatchMode('full'), 'exact');
  assert.equal(normalizeRuntimeTextMatchMode(''), 'exact');
  assert.equal(normalizeRuntimeTextMatchMode(null), 'exact');
  assert.equal(normalizeRuntimeTextMatchMode(undefined), 'exact');
  assert.equal(normalizeRuntimeTextMatchMode('EXACT'), 'exact');
});

test('a runtime text assertion is normalized field by field', () => {
  assert.deepEqual(normalizeRuntimeTextAssertion(undefined), {
    enabled: false,
    expected: '',
    match_mode: 'exact',
    match_any_item: false,
    show_expected: false,
    show_actual: false,
    success_message: '',
    failure_message: '',
  });

  // A non-object assertion is ignored rather than rejected.
  assert.deepEqual(normalizeRuntimeTextAssertion('x'), normalizeRuntimeTextAssertion(undefined));
  assert.deepEqual(normalizeRuntimeTextAssertion([1, 2]), normalizeRuntimeTextAssertion(undefined));
  assert.deepEqual(normalizeRuntimeTextAssertion(null), normalizeRuntimeTextAssertion(undefined));

  // Values are coerced to the types the runtime reads.
  assert.deepEqual(
    normalizeRuntimeTextAssertion({
      enabled: 0,
      expected: 5,
      match_mode: 'nonsense',
      match_any_item: '',
      show_expected: 'yes',
      show_actual: null,
      success_message: 3,
      failure_message: undefined,
    }),
    {
      enabled: false,
      expected: '5',
      match_mode: 'exact',
      match_any_item: false,
      show_expected: true,
      show_actual: false,
      success_message: '3',
      failure_message: '',
    },
  );
});

test('assertion defaults fill gaps but never override an explicit value', () => {
  const defaults = {
    enabled: true,
    expected: 'fallback',
    match_mode: 'contains',
    match_any_item: true,
    show_expected: true,
    show_actual: true,
    success_message: 'ok',
    failure_message: 'no',
  };

  assert.deepEqual(normalizeRuntimeTextAssertion(null, defaults), defaults);

  assert.deepEqual(
    normalizeRuntimeTextAssertion({ enabled: false, expected: '', match_mode: 'regex' }, defaults),
    { ...defaults, enabled: false, expected: '', match_mode: 'regex' },
  );
});

test('the output assertion inherits legacy expected_output and match_mode', () => {
  const legacy = getStdoutOutputAssertion({ expected_output: 'hi\n', match_mode: 'contains' });
  assert.equal(legacy.enabled, true);
  assert.equal(legacy.expected, 'hi\n');
  assert.equal(legacy.match_mode, 'contains');

  // Either legacy field alone is enough to switch the assertion on.
  assert.equal(getStdoutOutputAssertion({ match_mode: 'contains' }).enabled, true);
  assert.equal(getStdoutOutputAssertion({}).enabled, false);

  // A configured assertion defaults to enabled, even without the flag.
  assert.equal(getStdoutOutputAssertion({ output_assertion: { expected: 'x' } }).enabled, true);
  assert.equal(
    getStdoutOutputAssertion({ output_assertion: { enabled: false, expected: 'x' } }).enabled,
    false,
  );

  // The modern object wins for the fields it sets; legacy fields still fill gaps.
  const mixed = getStdoutOutputAssertion({
    output_assertion: { expected: 'modern' },
    expected_output: 'legacy',
    match_mode: 'contains',
  });
  assert.equal(mixed.expected, 'modern');
  assert.equal(mixed.match_mode, 'contains');

  // An explicit default overrides the derivation.
  assert.equal(
    getStdoutOutputAssertion({ output_assertion: {} }, { defaultEnabled: false }).enabled,
    false,
  );

  // A malformed assertion object leaves the legacy fields in charge.
  const malformed = getStdoutOutputAssertion({ output_assertion: [1], expected_output: 'x' });
  assert.equal(malformed.expected, 'x');
  assert.equal(malformed.enabled, true);
});

test('the prompt assertion is enabled only when one is configured', () => {
  assert.equal(getStdoutPromptAssertion({}).enabled, false);
  assert.equal(getStdoutPromptAssertion({ prompt_assertion: null }).enabled, false);
  assert.equal(getStdoutPromptAssertion({ prompt_assertion: 'x' }).enabled, false);

  const configured = getStdoutPromptAssertion({ prompt_assertion: { expected: 'p' } });
  assert.equal(configured.enabled, true);
  assert.equal(configured.expected, 'p');
  assert.equal(configured.match_mode, 'exact');

  assert.equal(
    getStdoutPromptAssertion({ prompt_assertion: {} }, { defaultEnabled: false }).enabled,
    false,
  );
});

test('a stdout test counts as asserting when either side is enabled', () => {
  assert.equal(hasEnabledStdoutAssertion({}), false);
  assert.equal(hasEnabledStdoutAssertion({ output_assertion: { enabled: true } }), true);
  assert.equal(hasEnabledStdoutAssertion({ output_assertion: { enabled: false } }), false);
  assert.equal(hasEnabledStdoutAssertion({ prompt_assertion: { expected: 'p' } }), true);
  assert.equal(
    hasEnabledStdoutAssertion({
      output_assertion: { enabled: false },
      prompt_assertion: { enabled: false },
    }),
    false,
  );
});

test('function fields imply function scope unless the scope says otherwise', () => {
  assert.deepEqual(getStdoutExecutionContext(undefined), { scope: 'main' });
  assert.deepEqual(getStdoutExecutionContext({ execution_context: { scope: 'main' } }), { scope: 'main' });
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { scope: 'function' } }),
    { scope: 'function', function_name: '', arguments: [] },
  );

  // Naming a function or listing arguments is enough to select function scope.
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { function_name: 'solve' } }),
    { scope: 'function', function_name: 'solve', arguments: [] },
  );
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { arguments: [] } }),
    { scope: 'function', function_name: '', arguments: [] },
  );

  // An unrecognised scope wins over the function fields and drops them.
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { scope: 'nonsense', function_name: 'solve' } }),
    { scope: 'main' },
  );
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { scope: null, function_name: 'solve' } }),
    { scope: 'main' },
  );
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { scope: 'main', function_name: 'solve' } }),
    { scope: 'main' },
  );

  // Malformed function fields are coerced, not rejected.
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { scope: 'function', function_name: 7 } }),
    { scope: 'function', function_name: '7', arguments: [] },
  );
  assert.deepEqual(
    getStdoutExecutionContext({ execution_context: { scope: 'function', arguments: 'x' } }),
    { scope: 'function', function_name: '', arguments: [] },
  );
  assert.deepEqual(getStdoutExecutionContext({ execution_context: 'x' }), { scope: 'main' });
});

test('variable types and list modes are validated, junk falls back', () => {
  assert.equal(normalizeVariableType('int'), 'int');
  assert.equal(normalizeVariableType('any'), 'any');
  assert.equal(normalizeVariableType('list'), 'list');
  assert.equal(normalizeVariableType('number'), 'any');
  assert.equal(normalizeVariableType(undefined), 'any');
  assert.equal(normalizeVariableType(null), 'any');

  assert.equal(normalizeListLengthComparison('gt'), 'gt');
  assert.equal(normalizeListLengthComparison('lte'), 'lte');
  assert.equal(normalizeListLengthComparison('eq'), 'equals');
  assert.equal(normalizeListLengthComparison(undefined), 'equals');

  assert.equal(normalizeListValueMatchMode('same_values_any_order'), 'same_values_any_order');
  assert.equal(normalizeListValueMatchMode('expected_subset_of_actual'), 'expected_subset_of_actual');
  assert.equal(normalizeListValueMatchMode('exact'), 'exact_order');
  assert.equal(normalizeListValueMatchMode(undefined), 'exact_order');

  assert.equal(normalizeListItemTypeMode('some'), 'some');
  assert.equal(normalizeListItemTypeMode('none'), 'none');
  assert.equal(normalizeListItemTypeMode('any'), 'all');
  assert.equal(normalizeListItemTypeMode(undefined), 'all');
});

test('expected item types drop "any" and anything that is not a list', () => {
  assert.deepEqual(
    normalizeListExpectedTypes(['int', 'any', 'float', 'nonsense', 5, null]),
    ['int', 'float'],
  );
  assert.deepEqual(normalizeListExpectedTypes([]), []);
  assert.deepEqual(normalizeListExpectedTypes('int'), []);
  assert.deepEqual(normalizeListExpectedTypes(undefined), []);
});

test('list index checks are clamped, type-normalized and keep explicit values', () => {
  assert.deepEqual(
    normalizeListIndexChecks([
      { index: '2.9', expected_type: 'int' },
      { index: -3 },
      { index: 'a', expected_value: 0 },
      { index: 1, expected_value: undefined },
      'not-an-object',
      null,
    ]),
    [
      { index: 2, expected_type: 'int' },
      { index: 0, expected_type: 'any' },
      { index: 0, expected_value: 0, expected_type: 'any' },
      { index: 1, expected_type: 'any' },
    ],
  );
  assert.deepEqual(normalizeListIndexChecks({ index: 0 }), []);
  assert.deepEqual(normalizeListIndexChecks(undefined), []);
});

test('list assertions normalize a partial or malformed block', () => {
  assert.deepEqual(getVariableListAssertions(undefined), {
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

  assert.deepEqual(
    getVariableListAssertions({
      list_assertions: {
        length_enabled: 1,
        length_value: 'x',
        length_comparison: 'gt',
        values_enabled: 0,
        values_match_mode: 'nope',
        expected_values: 'not-an-array',
        item_types_enabled: 'y',
        item_type_mode: 'some',
        expected_item_types: ['int', 'any'],
        index_checks: [{ index: 1 }],
      },
    }),
    {
      length_enabled: true,
      length_value: 0,
      length_comparison: 'gt',
      values_enabled: false,
      values_match_mode: 'exact_order',
      expected_values: [],
      item_types_enabled: true,
      item_type_mode: 'some',
      expected_item_types: ['int'],
      index_checks: [{ index: 1, expected_type: 'any' }],
    },
  );

  const negative = getVariableListAssertions({ list_assertions: { length_value: -4 } });
  assert.equal(negative.length_value, 0);
  const fractional = getVariableListAssertions({ list_assertions: { length_value: '3.9' } });
  assert.equal(fractional.length_value, 3);

  // An array is not a valid assertion block, so the defaults apply.
  assert.deepEqual(getVariableListAssertions({ list_assertions: [1] }), getVariableListAssertions({}));
});

test('a return assertion normalizes partial input and derives its enabled flag', () => {
  assert.deepEqual(getFunctionReturnAssertion(undefined), {
    enabled: false,
    arguments: [],
    expected_type: 'any',
    value_assertion_enabled: false,
    comparison: 'equals',
    show_coerced_value_hint: false,
    show_expected: false,
    show_actual: false,
    success_message: '',
    failure_message: '',
    list_assertions: getVariableListAssertions({}),
  });

  const partial = getFunctionReturnAssertion({
    return_assertion: { expected_type: 'int', comparison: 'nope', expected_value: 5 },
  });
  assert.equal(partial.enabled, true);
  assert.equal(partial.expected_type, 'int');
  assert.equal(partial.comparison, 'equals');
  assert.equal(partial.expected_value, 5);
  assert.equal(partial.value_assertion_enabled, true);

  // Any legacy-shaped field switches the assertion on.
  assert.equal(getFunctionReturnAssertion({ return_assertion: { arguments: [1] } }).enabled, true);
  assert.equal(getFunctionReturnAssertion({ return_assertion: { show_actual: true } }).enabled, true);
  assert.equal(
    getFunctionReturnAssertion({ return_assertion: { enabled: false, expected_value: 5 } }).enabled,
    false,
  );

  // A list assertion also counts as a reason to run the return assertion.
  const listOnly = getFunctionReturnAssertion({
    return_assertion: { list_assertions: { length_enabled: true, length_value: 2 } },
  });
  assert.equal(listOnly.enabled, true);
  assert.equal(listOnly.list_assertions.length_enabled, true);
  assert.equal(listOnly.list_assertions.length_value, 2);

  // A malformed assertion block behaves like a missing one.
  assert.deepEqual(getFunctionReturnAssertion({ return_assertion: 'x' }), getFunctionReturnAssertion({}));

  // expected_value is only carried when it was actually set.
  assert.equal('expected_value' in getFunctionReturnAssertion({}), false);
  assert.equal('expected_value' in getFunctionReturnAssertion({ return_assertion: { expected_value: null } }), true);
});

test('value assertion enablement falls back to the presence of an expected value', () => {
  assert.equal(normalizeVariableValueAssertionEnabled({}), false);
  assert.equal(normalizeVariableValueAssertionEnabled(null), false);
  assert.equal(normalizeVariableValueAssertionEnabled({}, { defaultEnabled: true }), true);
  assert.equal(normalizeVariableValueAssertionEnabled({}, { defaultEnabled: false }), false);
  assert.equal(normalizeVariableValueAssertionEnabled({ expected_value: 0 }), true);
  assert.equal(normalizeVariableValueAssertionEnabled({ expected_value: undefined }), false);
  assert.equal(normalizeVariableValueAssertionEnabled({ value_assertion_enabled: false, expected_value: 1 }), false);
  assert.equal(normalizeVariableValueAssertionEnabled({ value_assertion_enabled: 0 }), false);
  assert.equal(normalizeVariableValueAssertionEnabled({ value_assertion_enabled: 'yes' }), true);
});

test('parameter count enablement and list assertion presence are booleans', () => {
  assert.equal(normalizeFunctionParameterCountEnabled({}), false);
  assert.equal(normalizeFunctionParameterCountEnabled(null), false);
  assert.equal(normalizeFunctionParameterCountEnabled({ parameter_count_enabled: true }), true);
  assert.equal(normalizeFunctionParameterCountEnabled({ parameter_count_enabled: 'yes' }), true);
  assert.equal(normalizeFunctionParameterCountEnabled({ parameter_count_enabled: 0 }), false);

  assert.equal(hasEnabledListAssertion({}), false);
  assert.equal(hasEnabledListAssertion({ list_assertions: { length_enabled: true } }), true);
  assert.equal(hasEnabledListAssertion({ list_assertions: { values_enabled: true } }), true);
  assert.equal(hasEnabledListAssertion({ list_assertions: { item_types_enabled: true } }), true);
  assert.equal(hasEnabledListAssertion({ list_assertions: { index_checks: [{ index: 0 }] } }), true);
});

test('a legacy stdout test case folds its fields into the modern shape', () => {
  const testCase = {
    id: 't',
    type: 'stdout_match',
    expected_output: 'hi\n',
    match_mode: 'regex',
    prompt_inputs: ['a', 2],
    weight: '8',
  };

  const result = normalizeTestCase(testCase);

  assert.equal(result, testCase, 'normalization is in place');
  assert.deepEqual(result, {
    id: 't',
    type: 'stdout_match',
    prompt_inputs: ['a', '2'],
    points: 8,
    strict_prompt_inputs: true,
    output_assertion: {
      enabled: true,
      expected: 'hi\n',
      match_mode: 'regex',
      match_any_item: false,
      show_expected: false,
      show_actual: false,
      success_message: '',
      failure_message: '',
    },
    prompt_assertion: {
      enabled: false,
      expected: '',
      match_mode: 'exact',
      match_any_item: false,
      show_expected: false,
      show_actual: false,
      success_message: '',
      failure_message: '',
    },
    execution_context: { scope: 'main' },
  });
  assert.equal('expected_output' in result, false);
  assert.equal('match_mode' in result, false);
  assert.equal('weight' in result, false);
});

test('a stdout test can be normalized twice without changing shape', () => {
  const once = normalizeTestCase({ type: 'stdout_match', expected_output: 'x', weight: 2 });
  const snapshot = structuredClone(once);
  assert.deepEqual(normalizeTestCase(once), snapshot);
});

test('a variable_state case gains defaults and normalizes its list assertions', () => {
  const result = normalizeTestCase({
    id: 'v',
    type: 'variable_state',
    variable_name: 'items',
    weight: 3,
    list_assertions: { length_enabled: true, length_value: '2.5' },
  });

  assert.equal(result.points, 3);
  assert.equal(result.strict_prompt_inputs, true);
  assert.equal(result.expected_type, 'any');
  assert.equal(result.value_assertion_enabled, false);
  assert.equal(result.show_coerced_value_hint, false);
  assert.equal(result.list_assertions.length_enabled, true);
  assert.equal(result.list_assertions.length_value, 2);

  // An explicit false survives normalization.
  const lenient = normalizeTestCase({ type: 'variable_state', strict_prompt_inputs: false });
  assert.equal(lenient.strict_prompt_inputs, false);
});

test('a function_state case drops prompt input settings and clamps its counts', () => {
  const result = normalizeTestCase({
    id: 'f',
    type: 'function_state',
    function_name: 'solve',
    prompt_inputs: ['a'],
    strict_prompt_inputs: false,
    parameter_count: '2.7',
    parameter_count_enabled: 1,
    return_assertion: { expected_value: 'z' },
  });

  assert.equal('prompt_inputs' in result, false);
  assert.equal('strict_prompt_inputs' in result, false);
  assert.equal(result.parameter_count, 2);
  assert.equal(result.parameter_count_enabled, true);
  assert.equal(result.return_assertion.enabled, true);
  assert.equal(result.return_assertion.expected_value, 'z');

  const negative = normalizeTestCase({ type: 'function_state', parameter_count: -3 });
  assert.equal(negative.parameter_count, 0);
  const junk = normalizeTestCase({ type: 'function_state', parameter_count: 'abc' });
  assert.equal(junk.parameter_count, 0);
});

test('an unknown test type keeps its fields and only normalizes points and inputs', () => {
  const result = normalizeTestCase({
    id: 'b',
    type: 'block_structure',
    weight: '5abc',
    prompt_inputs: 'stale',
    strict_prompt_inputs: false,
    custom_field: 1,
  });

  assert.deepEqual(result, {
    id: 'b',
    type: 'block_structure',
    prompt_inputs: [],
    strict_prompt_inputs: false,
    custom_field: 1,
    points: 0,
  });
});

test('normalizing a non-object test case returns it untouched', () => {
  assert.equal(normalizeTestCase(null), null);
  assert.equal(normalizeTestCase(undefined), undefined);
  assert.equal(normalizeTestCase('x'), 'x');
  assert.equal(normalizeTestCase(42), 42);
});

test('normalizeTestConfig rewrites every case and tolerates a missing list', () => {
  const config = {
    evaluation: {
      test_cases: [
        { id: 'a', type: 'block_structure', weight: 2 },
        { id: 'b', type: 'stdout_match', expected_output: 'x' },
      ],
    },
  };

  const result = normalizeTestConfig(config);

  assert.equal(result, config, 'normalization is in place');
  assert.equal(result.evaluation.test_cases[0].points, 2);
  assert.equal('weight' in result.evaluation.test_cases[0], false);
  assert.equal(result.evaluation.test_cases[1].output_assertion.expected, 'x');

  const noEvaluation = {};
  assert.equal(normalizeTestConfig(noEvaluation), noEvaluation);
  const nullList = { evaluation: { test_cases: null } };
  assert.equal(normalizeTestConfig(nullList), nullList);
  const stringList = { evaluation: { test_cases: 'x' } };
  assert.equal(normalizeTestConfig(stringList), stringList);
  assert.equal(normalizeTestConfig(null), null);
  assert.deepEqual(normalizeTestConfig({ evaluation: { test_cases: [] } }), { evaluation: { test_cases: [] } });
});
