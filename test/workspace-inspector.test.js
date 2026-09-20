/**
 * Workspace inspector — the structural conditions that hints, tests and the
 * builder's condition preview are all evaluated through.
 *
 * Every condition runs against a real headless Blockly workspace, so the
 * interesting edges are the ones an author can actually reach: shadow blocks
 * that nobody drew, value inputs that are not fields, variable fields that
 * compare by name, wildcard patterns that have to backtrack, and malformed
 * conditions that must answer instead of throwing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCondition } from '../src/shared/workspace-inspector.js';
import { blockState, workspaceFromState, workspaceWith } from './helpers/blockly.js';

// --- fixtures -------------------------------------------------------------

/** A `text` value block, shown as a shadow inside a `text_print` by default. */
function textValue(value, id) {
  return { type: 'text', ...(id ? { id } : {}), fields: { TEXT: value } };
}

function numberValue(value) {
  return { type: 'math_number', fields: { NUM: value } };
}

/** A `text_print` statement whose text comes from its shadow `text` block. */
function printBlock(value, id) {
  const textId = id ? `${id}_text` : undefined;
  return {
    type: 'text_print',
    ...(id ? { id } : {}),
    inputs: { TEXT: { shadow: textValue(value, textId) } },
  };
}

function conditionalBlock(body) {
  const inputs = { IF0: { shadow: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } };
  if (body) inputs.DO0 = { block: body };
  return { type: 'controls_if', inputs };
}

function repeatBlock(times, body) {
  return {
    type: 'controls_repeat_ext',
    inputs: { TIMES: { shadow: numberValue(times) }, DO: { block: body } },
  };
}

function setVariableBlock(variableId) {
  return {
    type: 'variables_set',
    fields: { VAR: { id: variableId } },
    inputs: { VALUE: { shadow: numberValue(1) } },
  };
}

/** Statements stacked underneath each other, returning the head block. */
function stacked(...blocks) {
  return blocks.reduceRight(
    (next, block) => ({ ...block, ...(next ? { next: { block: next } } : {}) }),
    null,
  );
}

/** A workspace block list holding one stack of statements. */
function program(...blocks) {
  return [stacked(...blocks)];
}

/** Workspace state carrying the variable definitions its variable blocks use. */
function stateWithVariables(blocks, variables) {
  return { ...blockState(blocks), variables };
}

function evaluateState(state, condition) {
  const workspace = workspaceFromState(state);
  try {
    return evaluateCondition(workspace, condition);
  } finally {
    workspace.dispose();
  }
}

function evaluate(blocks, condition) {
  return evaluateState(blockState(blocks), condition);
}

function passes(blocks, condition) {
  return evaluate(blocks, condition).passed;
}

// --- the condition contract ----------------------------------------------

test('an unknown condition type fails and names the type it did not recognise', () => {
  const unknown = evaluate([], { type: 'block_exists_typo' });
  assert.equal(unknown.passed, false);
  assert.match(unknown.detail, /Unknown condition type: block_exists_typo/);
  assert.match(evaluate([], {}).detail, /Unknown condition type: undefined/);
  assert.match(evaluate([], { type: null }).detail, /Unknown condition type: null/);
});

test('a condition naming a block type that Blockly does not know answers instead of throwing', () => {
  const blocks = [printBlock('hi')];
  assert.equal(passes(blocks, { type: 'block_exists', block_type: 'not_a_block' }), false);
  assert.equal(passes(blocks, { type: 'block_missing', block_type: 'not_a_block' }), true);
  assert.equal(
    passes(blocks, { type: 'block_count', block_type: 'not_a_block', min: 0, max: 0 }),
    true,
  );
  assert.equal(
    passes(blocks, {
      type: 'block_field_value',
      block_type: 'not_a_block',
      field_name: 'F',
      expected_value: 'x',
    }),
    false,
  );
  assert.equal(
    passes(blocks, {
      type: 'block_nested',
      outer_type: 'not_a_block',
      input_name: 'DO0',
      inner_type: 'text_print',
    }),
    false,
  );
  assert.equal(
    passes(blocks, {
      type: 'block_connected',
      upper_type: 'not_a_block',
      lower_type: 'text_print',
    }),
    false,
  );
});

// --- block_exists / block_missing ----------------------------------------

test('block_exists needs one block by default and says how many it saw', () => {
  assert.equal(passes([], { type: 'block_exists', block_type: 'text_print' }), false);

  const found = evaluate([printBlock('hi')], { type: 'block_exists', block_type: 'text_print' });
  assert.equal(found.passed, true);
  assert.match(found.detail, /Found 1 text_print block/);

  const missing = evaluate([], { type: 'block_exists', block_type: 'text_print' });
  assert.match(missing.detail, /Found 0 text_print block/);
});

test('block_exists honours min_count including the exact boundary', () => {
  const twoPrints = program(printBlock('a'), printBlock('b'));
  const condition = (minCount) => ({
    type: 'block_exists',
    block_type: 'text_print',
    min_count: minCount,
  });

  assert.equal(passes(twoPrints, condition(2)), true);
  assert.equal(passes(twoPrints, condition(3)), false);
  assert.equal(passes([printBlock('a')], condition(2)), false);
  assert.equal(passes([], condition(1)), false);
});

test('block_missing passes only while the type is absent, and shadow blocks count as blocks', () => {
  const blocks = [printBlock('hi')];
  assert.equal(passes(blocks, { type: 'block_missing', block_type: 'text_print' }), false);
  // The shadow `text` under the print is a block too, so it is not "missing".
  assert.equal(passes(blocks, { type: 'block_missing', block_type: 'text' }), false);
  assert.equal(passes(blocks, { type: 'block_missing', block_type: 'math_number' }), true);
  assert.equal(passes([], { type: 'block_missing', block_type: 'text_print' }), true);
});

// --- block_count ----------------------------------------------------------

test('block_count includes both of its bounds', () => {
  const one = [textValue('a')];
  const two = [textValue('a'), textValue('b')];
  const three = [textValue('a'), textValue('b'), textValue('c')];
  const condition = (min, max) => ({ type: 'block_count', block_type: 'text', min, max });

  assert.equal(passes(one, condition(1, 2)), true);
  assert.equal(passes(two, condition(1, 2)), true);
  assert.equal(passes(three, condition(1, 2)), false);
  assert.equal(passes(two, condition(2, 2)), true);
  assert.equal(passes(two, condition(0, 1)), false);
});

test('block_count is unbounded when min and max are absent, and 0–0 means exactly none', () => {
  const condition = { type: 'block_count', block_type: 'text' };
  assert.equal(passes([], condition), true);
  assert.equal(passes([textValue('a'), textValue('b')], condition), true);
  assert.equal(passes([], { ...condition, min: 0, max: 0 }), true);
  assert.equal(passes([textValue('a')], { ...condition, min: 0, max: 0 }), false);
});

test('block_count can never pass when min exceeds max', () => {
  const condition = { type: 'block_count', block_type: 'text', min: 2, max: 1 };
  assert.equal(passes([], condition), false);
  assert.equal(passes([textValue('a')], condition), false);
  assert.equal(passes([textValue('a'), textValue('b')], condition), false);
  assert.match(
    evaluate([textValue('a'), textValue('b')], condition).detail,
    /text count: 2/,
  );
});

test('block_count sees the shadow blocks the student never drew', () => {
  const blocks = program(printBlock('hi'), printBlock('there'));
  assert.equal(passes(blocks, { type: 'block_count', block_type: 'text_print', min: 2, max: 2 }), true);
  assert.equal(passes(blocks, { type: 'block_count', block_type: 'text', min: 2, max: 2 }), true);
});

// --- workspace_empty ------------------------------------------------------

test('workspace_empty is false as soon as anything is on the workspace, shadows included', () => {
  assert.equal(passes([], { type: 'workspace_empty' }), true);
  assert.equal(passes([printBlock('hi')], { type: 'workspace_empty' }), false);
  // Two blocks: the print and its shadow text.
  assert.match(
    evaluate([printBlock('hi')], { type: 'workspace_empty' }).detail,
    /Workspace has 2 block\(s\)/,
  );
});

// --- workspace_connectedness ---------------------------------------------

test('all_connected allows a single rooted program and an untouched workspace', () => {
  const connectedProgram = program(repeatBlock(2, printBlock('deep')), printBlock('after'));
  assert.equal(passes(connectedProgram, { type: 'workspace_connectedness', mode: 'all_connected' }), true);
  assert.equal(passes([], { type: 'workspace_connectedness', mode: 'all_connected' }), true);

  const twoRoots = [printBlock('a'), printBlock('b')];
  const result = evaluate(twoRoots, { type: 'workspace_connectedness', mode: 'all_connected' });
  assert.equal(result.passed, false);
  assert.match(result.detail, /Found 2 top-level block/);
});

test('all_active tolerates disconnected statement roots that all_connected rejects', () => {
  const twoRoots = [printBlock('a'), printBlock('b')];
  assert.equal(passes(twoRoots, { type: 'workspace_connectedness', mode: 'all_active' }), true);
  assert.equal(passes(twoRoots, { type: 'workspace_connectedness', mode: 'all_connected' }), false);
});

test('all_active rejects a loose value block that all_connected accepts', () => {
  const looseValue = [numberValue(7)];
  assert.equal(passes(looseValue, { type: 'workspace_connectedness', mode: 'all_connected' }), true);

  const result = evaluate(looseValue, { type: 'workspace_connectedness', mode: 'all_active' });
  assert.equal(result.passed, false);
  assert.match(result.detail, /disconnected value block\(s\): math_number/);
});

test('all_active accepts a value block plugged into a program and a hat-only definition', () => {
  const plugged = [
    {
      type: 'controls_if',
      inputs: { IF0: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } },
    },
  ];
  assert.equal(passes(plugged, { type: 'workspace_connectedness', mode: 'all_active' }), true);

  const definition = [{ type: 'procedures_defreturn', fields: { NAME: 'add' } }];
  assert.equal(passes(definition, { type: 'workspace_connectedness', mode: 'all_active' }), true);
});

test('an unrecognised connectedness mode falls back to all_connected', () => {
  const twoRoots = [printBlock('a'), printBlock('b')];
  for (const mode of [undefined, '', 'all', 'all_connected_program', 'all_top_level_active']) {
    assert.equal(passes(twoRoots, { type: 'workspace_connectedness', mode }), false);
  }
  // The mode the fallback does not cover is the only one that passes here.
  assert.equal(passes(twoRoots, { type: 'workspace_connectedness', mode: 'all_active' }), true);
});

// --- block_connected ------------------------------------------------------

test('block_connected needs the lower block directly beneath an upper block', () => {
  const stack = program(printBlock('a'), printBlock('b'));
  const condition = { type: 'block_connected', upper_type: 'text_print', lower_type: 'text_print' };
  assert.equal(passes(stack, condition), true);
  assert.equal(passes([printBlock('a')], condition), false);

  // Blocks inside a loop body are not connected to the loop block itself.
  const loop = [repeatBlock(2, printBlock('a'))];
  assert.equal(
    passes(loop, {
      type: 'block_connected',
      upper_type: 'controls_repeat_ext',
      lower_type: 'text_print',
    }),
    false,
  );
  assert.equal(
    passes(stack, { type: 'block_connected', upper_type: 'text_print', lower_type: 'controls_if' }),
    false,
  );
});

// --- block_nested ---------------------------------------------------------

test('block_nested only looks inside the named input', () => {
  const blocks = [conditionalBlock(printBlock('yes'))];
  const nested = (inputName, innerType) => ({
    type: 'block_nested',
    outer_type: 'controls_if',
    input_name: inputName,
    inner_type: innerType,
  });

  assert.equal(passes(blocks, nested('DO0', 'text_print')), true);
  assert.equal(passes(blocks, nested('IF0', 'text_print')), false);
  assert.equal(passes(blocks, nested('ELSE0', 'text_print')), false);
  // The logic value lives in IF0, and the shadow text sits one level below DO0.
  assert.equal(passes(blocks, nested('IF0', 'logic_boolean')), true);
  assert.equal(passes(blocks, nested('DO0', 'text')), true);
});

test('block_nested searches chained statements and deeper levels of the subtree', () => {
  const blocks = [conditionalBlock(stacked(printBlock('no'), repeatBlock(2, printBlock('yes'))))];
  const nested = (innerType, extra) => ({
    type: 'block_nested',
    outer_type: 'controls_if',
    input_name: 'DO0',
    inner_type: innerType,
    ...extra,
  });

  assert.equal(passes(blocks, nested('text_print')), true);
  assert.equal(passes(blocks, nested('controls_repeat_ext')), true);
  assert.equal(passes(blocks, nested('text', { field_name: 'TEXT', expected_value: 'yes' })), true);
  assert.equal(passes(blocks, nested('text', { field_name: 'TEXT', expected_value: 'no' })), true);
  assert.equal(passes(blocks, nested('text', { field_name: 'TEXT', expected_value: 'maybe' })), false);
});

test('block_nested finds the outer block wherever it sits and skips empty inputs', () => {
  const nestedInside = [repeatBlock(2, printBlock('x'))];
  assert.equal(
    passes(nestedInside, {
      type: 'block_nested',
      outer_type: 'controls_repeat_ext',
      input_name: 'DO',
      inner_type: 'text_print',
    }),
    true,
  );

  const filledAndEmpty = [conditionalBlock(printBlock('a')), conditionalBlock(undefined)];
  assert.equal(
    passes(filledAndEmpty, {
      type: 'block_nested',
      outer_type: 'controls_if',
      input_name: 'DO0',
      inner_type: 'text_print',
    }),
    true,
  );
  assert.equal(
    passes([conditionalBlock(undefined)], {
      type: 'block_nested',
      outer_type: 'controls_if',
      input_name: 'DO0',
      inner_type: 'text_print',
    }),
    false,
  );
  // A missing input name simply finds no input, rather than throwing.
  assert.equal(
    passes([conditionalBlock(printBlock('a'))], {
      type: 'block_nested',
      outer_type: 'controls_if',
      inner_type: 'text_print',
    }),
    false,
  );
});

test('block_nested matches descendant fields with the shared match modes', () => {
  const blocks = [conditionalBlock(printBlock('Hello World'))];
  const nestedText = (constraint) => ({
    type: 'block_nested',
    outer_type: 'controls_if',
    input_name: 'DO0',
    inner_type: 'text',
    field_name: 'TEXT',
    ...constraint,
  });

  assert.equal(passes(blocks, nestedText({ expected_value: 'Hello World' })), true);
  assert.equal(passes(blocks, nestedText({ expected_value: 'hello world' })), false);
  assert.equal(passes(blocks, nestedText({ expected_value: 'hello world', case_sensitive: false })), true);
  assert.equal(passes(blocks, nestedText({ expected_value: 'World', match_mode: 'contains' })), true);
  assert.equal(passes(blocks, nestedText({ expected_value: '^Hello', match_mode: 'regex_search' })), true);
  assert.equal(passes(blocks, nestedText({ expected_value: '^Hello', match_mode: 'regex_full' })), false);
});

test('block_nested reports an invalid descendant regex before it looks for one', () => {
  const result = evaluate([conditionalBlock(printBlock('x'))], {
    type: 'block_nested',
    outer_type: 'controls_if',
    input_name: 'DO0',
    inner_type: 'text',
    field_name: 'TEXT',
    match_mode: 'regex_search',
    expected_value: 'a(',
  });
  assert.equal(result.passed, false);
  assert.match(result.detail, /Invalid regex/);
});

test('block_nested fails when no descendant of that type carries the field', () => {
  const blocks = [conditionalBlock(printBlock('hi'))];
  const result = evaluate(blocks, {
    type: 'block_nested',
    outer_type: 'controls_if',
    input_name: 'DO0',
    inner_type: 'text_print',
    field_name: 'TEXT',
    expected_value: 'hi',
  });
  // `text_print.TEXT` is a value input, not a field, so no print carries it.
  assert.equal(result.passed, false);
  assert.match(result.detail, /No text_print/);
});

test('a nested variable field is matched by variable name, not by variable id', () => {
  const state = stateWithVariables(
    [conditionalBlock(setVariableBlock('var-a'))],
    [{ name: 'counter', id: 'var-a' }],
  );
  const nested = (expectedValue) => ({
    type: 'block_nested',
    outer_type: 'controls_if',
    input_name: 'DO0',
    inner_type: 'variables_set',
    field_name: 'VAR',
    expected_value: expectedValue,
  });

  assert.equal(evaluateState(state, nested('counter')).passed, true);
  assert.equal(evaluateState(state, nested('var-a')).passed, false);
});

// --- block_field_value ----------------------------------------------------

test('block_field_value matches the whole field value, case-sensitively by default', () => {
  const blocks = [textValue('Hello')];
  const condition = (extra) => ({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    expected_value: 'Hello',
    ...extra,
  });

  assert.equal(passes(blocks, condition({})), true);
  assert.equal(passes(blocks, condition({ expected_value: 'hello' })), false);
  assert.equal(passes(blocks, condition({ expected_value: 'Hell' })), false);
  assert.equal(passes(blocks, condition({ expected_value: 'Hello ' })), false);
});

test('block_field_value turns case-insensitive for the boolean or for the i flag', () => {
  const blocks = [textValue('Hello')];
  const condition = (extra) => ({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    expected_value: 'hello',
    ...extra,
  });

  assert.equal(passes(blocks, condition({ case_sensitive: false })), true);
  assert.equal(passes(blocks, condition({ regex_flags: 'i' })), true);
  // An explicit boolean wins over the flag.
  assert.equal(passes(blocks, condition({ case_sensitive: true, regex_flags: 'i' })), false);
  assert.equal(passes(blocks, condition({ regex_flags: 'g' })), false);
});

test('block_field_value contains mode takes a substring, and an empty needle takes anything', () => {
  const blocks = [textValue('Hello')];
  const condition = (expectedValue, extra) => ({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    match_mode: 'contains',
    expected_value: expectedValue,
    ...extra,
  });

  assert.equal(passes(blocks, condition('ell')), true);
  assert.equal(passes(blocks, condition('ELL', { case_sensitive: false })), true);
  assert.equal(passes(blocks, condition('zzz')), false);
  assert.equal(passes(blocks, condition('')), true);
});

test('block_field_value regex modes differ in anchoring and the legacy mode is a full match', () => {
  const blocks = [textValue('hello')];
  const condition = (matchMode, expectedValue = 'hel') => ({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    match_mode: matchMode,
    expected_value: expectedValue,
  });

  assert.equal(passes(blocks, condition('regex_search')), true);
  assert.equal(passes(blocks, condition('regex_full')), false);
  assert.equal(passes(blocks, condition('regex')), false);
  assert.equal(passes(blocks, condition('regex_full', 'hello')), true);
});

test('block_field_value reports an invalid regex instead of throwing', () => {
  const result = evaluate([textValue('hello')], {
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    match_mode: 'regex_search',
    expected_value: 'a(',
  });
  assert.equal(result.passed, false);
  assert.match(result.detail, /Invalid regex/);
});

test('block_field_value falls back to exact for a match mode it does not know', () => {
  const blocks = [textValue('Hello')];
  const condition = (expectedValue) => ({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    match_mode: 'fuzzy',
    expected_value: expectedValue,
  });

  assert.equal(passes(blocks, condition('Hello')), true);
  assert.equal(passes(blocks, condition('hello')), false);
  assert.equal(passes(blocks, condition('Hell')), false);
});

test('block_field_value passes when any single block of the type matches', () => {
  const blocks = program(printBlock('first'), printBlock('second'));
  const condition = (expectedValue) => ({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    expected_value: expectedValue,
  });

  assert.equal(passes(blocks, condition('second')), true);
  assert.equal(passes(blocks, condition('third')), false);
});

test('block_field_value treats a missing expected value as the empty string alone', () => {
  const emptyText = [textValue('')];
  const condition = (expectedValue) => ({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    expected_value: expectedValue,
  });

  assert.equal(passes(emptyText, condition(undefined)), true);
  assert.equal(passes(emptyText, condition(null)), true);
  assert.equal(passes([textValue('x')], condition(null)), false);
});

test('block_field_value does not read a value input as a field of its parent block', () => {
  const blocks = [printBlock('hi')];
  assert.equal(
    passes(blocks, {
      type: 'block_field_value',
      block_type: 'text_print',
      field_name: 'TEXT',
      expected_value: 'hi',
    }),
    false,
  );
  // The same text is reachable through the shadow block that holds it.
  assert.equal(
    passes(blocks, { type: 'block_field_value', block_type: 'text', field_name: 'TEXT', expected_value: 'hi' }),
    true,
  );
});

test('block_field_value compares numbers and other non-string fields as text', () => {
  const blocks = [numberValue(42)];
  const condition = (expectedValue) => ({
    type: 'block_field_value',
    block_type: 'math_number',
    field_name: 'NUM',
    expected_value: expectedValue,
  });

  assert.equal(passes(blocks, condition(42)), true);
  assert.equal(passes(blocks, condition('42')), true);
  assert.equal(passes(blocks, condition('42.0')), false);
  assert.equal(passes(blocks, condition(' 42')), false);
});

test('block_field_value can match a shadow block inside another block', () => {
  const blocks = [repeatBlock(3, printBlock('x'))];
  assert.equal(
    passes(blocks, { type: 'block_field_value', block_type: 'math_number', field_name: 'NUM', expected_value: 3 }),
    true,
  );
  assert.equal(
    passes(blocks, { type: 'block_field_value', block_type: 'math_number', field_name: 'NUM', expected_value: 4 }),
    false,
  );
});

test('block_field_value compares a variable field by name, not by variable id', () => {
  const state = stateWithVariables([setVariableBlock('var-a')], [{ name: 'counter', id: 'var-a' }]);
  const condition = (expectedValue) => ({
    type: 'block_field_value',
    block_type: 'variables_set',
    field_name: 'VAR',
    expected_value: expectedValue,
  });

  assert.equal(evaluateState(state, condition('counter')).passed, true);
  assert.equal(evaluateState(state, condition('var-a')).passed, false);
});

test('block_field_value fails cleanly when no block of the type has that field', () => {
  const blocks = [printBlock('hi')];
  const condition = (fieldName) => ({
    type: 'block_field_value',
    block_type: 'text_print',
    field_name: fieldName,
    expected_value: 'hi',
  });

  assert.equal(passes(blocks, condition('NOPE')), false);
  // The empty field name the config normalizer produces for a blank field.
  const blank = evaluate(blocks, condition(''));
  assert.equal(blank.passed, false);
  assert.match(blank.detail, /No text_print block has/);
});

// --- block_pattern --------------------------------------------------------

/** A pattern block for `text_print`; its shadow text carries an id to constrain. */
function patternPrint(value, id) {
  return {
    type: 'text_print',
    id,
    inputs: { TEXT: { shadow: textValue(value, `${id}_text`) } },
  };
}

function patternAnyStatement(id) {
  return { type: 'pattern_any_statement', id };
}

function patternAnyValue(id) {
  return { type: 'pattern_any_value', id };
}

function patternCondition(workspaceState, extra = {}) {
  return { type: 'block_pattern', workspace_state: workspaceState, ...extra };
}

function fieldConstraint(blockId, fieldName, constraint) {
  return { field_constraints: { [blockId]: { [fieldName]: constraint } } };
}

function paramConstraint(blockId, constraint) {
  return { param_constraints: { [blockId]: constraint } };
}

/** A procedure call pattern or workspace block with `params` parameters. */
function procedureCall(params, id, withArguments = true) {
  const inputs = {};
  if (withArguments) {
    params.forEach((_, index) => {
      inputs[`ARG${index}`] = { shadow: numberValue(index + 1) };
    });
  }
  return {
    type: 'procedures_callnoreturn',
    ...(id ? { id } : {}),
    extraState: { name: 'myFunc', params },
    ...(withArguments ? { inputs } : {}),
  };
}

test('block_pattern matches a single pattern block anywhere in the program', () => {
  const condition = patternCondition(
    blockState([patternPrint('target', 'p1')]),
    fieldConstraint('p1_text', 'TEXT', { expected_value: 'target' }),
  );

  const targetProgram = program(
    printBlock('one'),
    printBlock('two'),
    printBlock('target'),
    printBlock('four'),
  );
  assert.equal(passes(targetProgram, condition), true);
  assert.equal(passes([printBlock('one')], condition), false);
});

test('block_pattern requires its blocks in order, with the program free to continue', () => {
  const condition = patternCondition(
    blockState([{ ...patternPrint('a', 'p1'), next: { block: patternPrint('b', 'p2') } }]),
    {
      field_constraints: {
        p1_text: { TEXT: { expected_value: 'a' } },
        p2_text: { TEXT: { expected_value: 'b' } },
      },
    },
  );

  assert.equal(passes(program(printBlock('a'), printBlock('b')), condition), true);
  assert.equal(passes(program(printBlock('lead'), printBlock('a'), printBlock('b')), condition), true);
  assert.equal(passes(program(printBlock('a'), printBlock('b'), printBlock('tail')), condition), true);
  assert.equal(passes(program(printBlock('b'), printBlock('a')), condition), false);
  assert.equal(passes(program(printBlock('a'), printBlock('mid'), printBlock('b')), condition), false);
  assert.equal(passes([printBlock('a')], condition), false);
});

test('a statement wildcard matches zero or more blocks between pattern blocks', () => {
  const condition = patternCondition(
    blockState([{ ...patternAnyStatement('any'), next: { block: patternPrint('end', 'p2') } }]),
    fieldConstraint('p2_text', 'TEXT', { expected_value: 'end' }),
  );

  assert.equal(passes(program(printBlock('end')), condition), true);
  assert.equal(passes(program(printBlock('a'), printBlock('end')), condition), true);
  assert.equal(passes(program(printBlock('a'), printBlock('b'), printBlock('end')), condition), true);
  assert.equal(passes(program(printBlock('a'), printBlock('b')), condition), false);
});

test('a trailing statement wildcard makes everything after the previous block optional', () => {
  const condition = patternCondition(
    blockState([{ ...patternPrint('go', 'p1'), next: { block: patternAnyStatement('any') } }]),
    fieldConstraint('p1_text', 'TEXT', { expected_value: 'go' }),
  );

  assert.equal(passes(program(printBlock('go')), condition), true);
  assert.equal(passes(program(printBlock('go'), printBlock('x')), condition), true);
  assert.equal(passes([printBlock('x')], condition), false);
});

test('a statement wildcard on its own matches any populated workspace', () => {
  const condition = patternCondition(blockState([patternAnyStatement('any')]));
  assert.equal(passes([printBlock('x')], condition), true);
  assert.equal(passes([numberValue(1)], condition), true);
});

test('a value wildcard accepts any block in a value input', () => {
  const condition = patternCondition(
    blockState([
      {
        type: 'text_print',
        id: 'p1',
        inputs: { TEXT: { block: patternAnyValue('any_value') } },
      },
    ]),
  );

  assert.equal(passes([printBlock('anything')], condition), true);
  assert.equal(passes([printBlock('')], condition), true);
  const numeric = [{ type: 'text_print', inputs: { TEXT: { block: numberValue(9) } } }];
  assert.equal(passes(numeric, condition), true);
});

test('a value wildcard still requires a block to be plugged in', () => {
  const condition = patternCondition(
    blockState([
      { type: 'controls_if', id: 'p1', inputs: { IF0: { block: patternAnyValue('any_value') } } },
    ]),
  );

  assert.equal(passes([conditionalBlock(printBlock('x'))], condition), true);
  // A bare `controls_if` has an empty IF0, so there is no value to match.
  assert.equal(passes([{ type: 'controls_if' }], condition), false);
});

test('block_pattern matches blocks nested inside other blocks', () => {
  const condition = patternCondition(
    blockState([
      { type: 'controls_if', id: 'p1', inputs: { DO0: { block: patternPrint('inner', 'p1_body') } } },
    ]),
    fieldConstraint('p1_body_text', 'TEXT', { expected_value: 'inner' }),
  );

  assert.equal(passes([repeatBlock(2, conditionalBlock(printBlock('inner')))], condition), true);
  assert.equal(passes([repeatBlock(2, conditionalBlock(printBlock('other')))], condition), false);
});

test('a pattern statement input matches from the first block of the input', () => {
  const condition = patternCondition(
    blockState([
      { type: 'controls_if', id: 'p1', inputs: { DO0: { block: patternPrint('inner', 'p1_body') } } },
    ]),
    fieldConstraint('p1_body_text', 'TEXT', { expected_value: 'inner' }),
  );

  const behindAnother = [conditionalBlock(stacked(printBlock('lead'), printBlock('inner')))];
  assert.equal(passes(behindAnother, condition), false);
  const first = [conditionalBlock(stacked(printBlock('inner'), printBlock('lead')))];
  assert.equal(passes(first, condition), true);
});

test('pattern field constraints reuse the field value match modes', () => {
  const pattern = blockState([patternPrint('Hello World', 'p1')]);
  const withConstraint = (constraint) =>
    patternCondition(pattern, fieldConstraint('p1_text', 'TEXT', constraint));

  assert.equal(passes([printBlock('Hello World')], withConstraint({ expected_value: 'Hello World' })), true);
  assert.equal(passes([printBlock('hello world')], withConstraint({ expected_value: 'Hello World' })), false);
  assert.equal(
    passes([printBlock('hello world')], withConstraint({ expected_value: 'hello world', case_sensitive: false })),
    true,
  );
  assert.equal(
    passes([printBlock('Hello World')], withConstraint({ expected_value: 'World', match_mode: 'contains' })),
    true,
  );
  assert.equal(
    passes([printBlock('Hello World')], withConstraint({ expected_value: '^Hello', match_mode: 'regex_search' })),
    true,
  );
  assert.equal(
    passes([printBlock('Hello World')], withConstraint({ expected_value: '^Hello', match_mode: 'regex_full' })),
    false,
  );
  // An unusable constraint cannot match, and does not throw either.
  assert.equal(
    passes([printBlock('Hello World')], withConstraint({ match_mode: 'regex_search', expected_value: 'a(' })),
    false,
  );
});

test('param count constraints gate procedure calls by their argument count', () => {
  const pattern = blockState([procedureCall(['a', 'b'], 'pat', false)]);

  assert.equal(passes([procedureCall(['x', 'y'])], patternCondition(pattern, paramConstraint('pat', { count: 2, comparison: 'gte' }))), true);
  assert.equal(passes([procedureCall(['x'])], patternCondition(pattern, paramConstraint('pat', { count: 2, comparison: 'gte' }))), false);
  assert.equal(passes([procedureCall(['x', 'y'])], patternCondition(pattern, paramConstraint('pat', { count: 2, comparison: 'equals' }))), true);
  assert.equal(passes([procedureCall(['x'])], patternCondition(pattern, paramConstraint('pat', { count: 2, comparison: 'equals' }))), false);
  assert.equal(passes([procedureCall(['x'])], patternCondition(pattern, paramConstraint('pat', { count: 1, comparison: 'lte' }))), true);
  assert.equal(passes([procedureCall(['x', 'y'])], patternCondition(pattern, paramConstraint('pat', { count: 1, comparison: 'lte' }))), false);
  assert.equal(passes([procedureCall([])], patternCondition(pattern, paramConstraint('pat', { count: 0, comparison: 'equals' }))), true);
  // An unrecognised comparison falls back to "exactly".
  assert.equal(passes([procedureCall(['x', 'y'])], patternCondition(pattern, paramConstraint('pat', { count: 2, comparison: 'roughly' }))), true);
  assert.equal(passes([procedureCall(['x'])], patternCondition(pattern, paramConstraint('pat', { count: 2, comparison: 'roughly' }))), false);
});

test('a param count constraint only constrains the pattern block it is keyed to', () => {
  const pattern = blockState([procedureCall(['a'], 'pat', false)]);
  const oneParam = { count: 1, comparison: 'equals' };

  // Keyed to an id the pattern does not contain, the constraint gates nothing.
  assert.equal(passes([procedureCall(['x', 'y'])], patternCondition(pattern, paramConstraint('other', { count: 9, comparison: 'gte' }))), true);
  // Keyed to the pattern block, it does.
  assert.equal(passes([procedureCall(['x', 'y'])], patternCondition(pattern, paramConstraint('pat', oneParam))), false);
  assert.equal(passes([procedureCall(['x'])], patternCondition(pattern, paramConstraint('pat', oneParam))), true);
});

test('block_pattern rejects a pattern workspace that is not exactly one root block', () => {
  const twoRoots = evaluate(
    [printBlock('a')],
    patternCondition(blockState([patternPrint('a', 'p1'), patternPrint('b', 'p2')])),
  );
  assert.equal(twoRoots.passed, false);
  assert.match(twoRoots.detail, /exactly one root block.*2/);

  const noRoots = evaluate([printBlock('a')], patternCondition(blockState([])));
  assert.equal(noRoots.passed, false);
  assert.match(noRoots.detail, /exactly one root block.*0/);
});

test('block_pattern fails when the pattern state is missing or unusable', () => {
  for (const workspaceState of [undefined, null, '', 'nope', 42, false]) {
    const result = evaluate([printBlock('a')], patternCondition(workspaceState));
    assert.equal(result.passed, false, `state ${JSON.stringify(workspaceState)}`);
    assert.match(result.detail, /Pattern workspace is missing/);
  }
});

test('block_pattern reports a pattern state that cannot be loaded instead of throwing', () => {
  const result = evaluate(
    [printBlock('a')],
    patternCondition(blockState([{ type: 'not_a_registered_block' }])),
  );
  assert.equal(result.passed, false);
  assert.match(result.detail, /Pattern workspace could not be loaded/);
});

// --- composites -----------------------------------------------------------

test('all passes only when every child condition passes', () => {
  const blocks = program(printBlock('hi'), printBlock('there'));
  assert.equal(
    passes(blocks, {
      type: 'all',
      conditions: [
        { type: 'block_exists', block_type: 'text_print' },
        { type: 'block_missing', block_type: 'math_number' },
      ],
    }),
    true,
  );

  const mixed = evaluate(blocks, {
    type: 'all',
    conditions: [
      { type: 'block_exists', block_type: 'text_print' },
      { type: 'block_exists', block_type: 'math_number' },
    ],
  });
  assert.equal(mixed.passed, false);
  assert.match(mixed.detail, /ALL: 1\/2/);
});

test('any passes as soon as one child condition passes', () => {
  const blocks = [printBlock('hi')];
  assert.equal(
    passes(blocks, {
      type: 'any',
      conditions: [
        { type: 'block_exists', block_type: 'math_number' },
        { type: 'block_exists', block_type: 'text_print' },
      ],
    }),
    true,
  );

  const none = evaluate(blocks, {
    type: 'any',
    conditions: [
      { type: 'block_exists', block_type: 'math_number' },
      { type: 'block_missing', block_type: 'text_print' },
    ],
  });
  assert.equal(none.passed, false);
  assert.match(none.detail, /ANY: 0\/2/);
});

test('none passes only while every child condition fails', () => {
  const blocks = [printBlock('hi')];
  assert.equal(
    passes(blocks, {
      type: 'none',
      conditions: [
        { type: 'block_exists', block_type: 'math_number' },
        { type: 'block_exists', block_type: 'controls_if' },
      ],
    }),
    true,
  );
  assert.equal(
    passes(blocks, {
      type: 'none',
      conditions: [
        { type: 'block_exists', block_type: 'math_number' },
        { type: 'block_missing', block_type: 'math_number' },
      ],
    }),
    false,
  );
});

test('an empty child list is vacuously true for all and none, and false for any', () => {
  const blocks = [printBlock('hi')];
  assert.equal(passes(blocks, { type: 'all', conditions: [] }), true);
  assert.equal(passes(blocks, { type: 'none', conditions: [] }), true);
  assert.equal(passes(blocks, { type: 'any', conditions: [] }), false);
  assert.match(evaluate(blocks, { type: 'any', conditions: [] }).detail, /ANY: 0\/0/);
});

test('composite conditions nest, and an unknown child type is just a failed child', () => {
  const blocks = [conditionalBlock(stacked(printBlock('go')))];
  assert.equal(
    passes(blocks, {
      type: 'all',
      conditions: [
        {
          type: 'any',
          conditions: [
            { type: 'block_missing', block_type: 'math_number' },
            { type: 'workspace_empty' },
          ],
        },
        { type: 'none', conditions: [{ type: 'block_count', block_type: 'text_print', min: 2 }] },
        { type: 'workspace_connectedness', mode: 'all_connected' },
      ],
    }),
    true,
  );

  assert.equal(passes(blocks, { type: 'none', conditions: [{ type: 'no_such_type' }] }), true);
  assert.equal(passes(blocks, { type: 'all', conditions: [{ type: 'no_such_type' }] }), false);
  assert.equal(passes([], { type: 'all', conditions: [{ type: 'workspace_empty' }] }), true);
});
