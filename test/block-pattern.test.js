/**
 * Block pattern helpers — the parameter-count constraint used by the visual
 * `block_pattern` condition, the wildcard blocks the pattern builder offers,
 * and the parameter counts read off real blocks.
 *
 * The edges are the ones a hand-edited pattern config or an author's toolbox
 * can produce: junk comparison names, a constraint that is absent (which must
 * mean "no constraint", not "exactly zero"), counts that are strings or
 * negative, procedure blocks with no parameters at all, and calls whose
 * argument list lives in Blockly's extra state.
 *
 * `registerBlockPatternBlocks` guards a module-level flag, but registering the
 * same definitions twice is idempotent and the flag is not observable through
 * the public API, so the real block definitions are exercised directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Blockly, workspaceWith } from './helpers/blockly.js';
import {
  createPatternToolboxCategory,
  getBlockParamCount,
  isPatternStatementWildcard,
  isPatternValueWildcard,
  isPatternWildcardType,
  isProcedureBlockType,
  matchesParamCountConstraint,
  normalizeParamCountComparison,
  normalizeParamCountConstraint,
  PARAM_COUNT_COMPARISON_EQUALS,
  PARAM_COUNT_COMPARISON_GTE,
  PARAM_COUNT_COMPARISON_LTE,
  PARAM_COUNT_COMPARISON_OPTIONS,
  PATTERN_ANY_STATEMENT_TYPE,
  PATTERN_ANY_VALUE_TYPE,
  registerBlockPatternBlocks,
  VALID_PARAM_COUNT_COMPARISONS,
} from '../src/shared/block-pattern.js';

registerBlockPatternBlocks(Blockly);

test('wildcard predicates identify their own type and nothing else', () => {
  const workspace = workspaceWith([
    { type: PATTERN_ANY_STATEMENT_TYPE, id: 'statement' },
    { type: PATTERN_ANY_VALUE_TYPE, id: 'value' },
    { type: 'text_print', id: 'print' },
  ]);

  const statement = workspace.getBlockById('statement');
  const value = workspace.getBlockById('value');
  const print = workspace.getBlockById('print');

  assert.equal(isPatternStatementWildcard(statement), true);
  assert.equal(isPatternStatementWildcard(value), false);
  assert.equal(isPatternStatementWildcard(print), false);
  assert.equal(isPatternStatementWildcard(undefined), false);
  assert.equal(isPatternStatementWildcard(null), false);

  assert.equal(isPatternValueWildcard(value), true);
  assert.equal(isPatternValueWildcard(statement), false);
  assert.equal(isPatternValueWildcard(print), false);
  assert.equal(isPatternValueWildcard(undefined), false);

  assert.equal(isPatternWildcardType(PATTERN_ANY_STATEMENT_TYPE), true);
  assert.equal(isPatternWildcardType(PATTERN_ANY_VALUE_TYPE), true);
  assert.equal(isPatternWildcardType('text_print'), false);
  assert.equal(isPatternWildcardType(''), false);
  assert.equal(isPatternWildcardType(null), false);
});

test('the wildcard blocks are registered with the connections the pattern expects', () => {
  // Registration is what the validator and inspector rely on before they load a
  // stored workspace_state, so run it again and confirm the blocks still load.
  registerBlockPatternBlocks(Blockly);
  assert.ok(Blockly.Blocks[PATTERN_ANY_STATEMENT_TYPE]);
  assert.ok(Blockly.Blocks[PATTERN_ANY_VALUE_TYPE]);

  const workspace = workspaceWith([
    { type: PATTERN_ANY_STATEMENT_TYPE, id: 'statement' },
    { type: PATTERN_ANY_VALUE_TYPE, id: 'value' },
  ]);

  const statement = workspace.getBlockById('statement');
  assert.equal(statement.type, PATTERN_ANY_STATEMENT_TYPE);
  assert.equal(Boolean(statement.previousConnection), true);
  assert.equal(Boolean(statement.nextConnection), true);
  assert.equal(Boolean(statement.outputConnection), false);
  assert.equal(isProcedureBlockType(statement.type), false);

  const value = workspace.getBlockById('value');
  assert.equal(value.type, PATTERN_ANY_VALUE_TYPE);
  assert.equal(Boolean(value.outputConnection), true);
  assert.equal(Boolean(value.previousConnection), false);
  assert.equal(Boolean(value.nextConnection), false);
});

test('a parameter count constraint rejects anything that is not an object', () => {
  assert.equal(normalizeParamCountConstraint(null), null);
  assert.equal(normalizeParamCountConstraint(undefined), null);
  assert.equal(normalizeParamCountConstraint('2'), null);
  assert.equal(normalizeParamCountConstraint(2), null);
  assert.equal(normalizeParamCountConstraint([]), null);
  assert.equal(normalizeParamCountConstraint(0), null);
  assert.equal(normalizeParamCountConstraint(false), null);
});

test('a parameter count constraint coerces junk counts down to zero', () => {
  assert.deepEqual(normalizeParamCountConstraint({ count: 3 }), { count: 3, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: '3' }), { count: 3, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: '3.9' }), { count: 3, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: -2 }), { count: 0, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: 0 }), { count: 0, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: 'x' }), { count: 0, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: NaN }), { count: 0, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: Infinity }), { count: 0, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({}), { count: 0, comparison: 'equals' });
  assert.deepEqual(normalizeParamCountConstraint({ count: true }), { count: 1, comparison: 'equals' });
});

test('an unrecognised comparison name falls back to equals', () => {
  assert.equal(normalizeParamCountComparison(PARAM_COUNT_COMPARISON_EQUALS), 'equals');
  assert.equal(normalizeParamCountComparison(PARAM_COUNT_COMPARISON_GTE), 'gte');
  assert.equal(normalizeParamCountComparison(PARAM_COUNT_COMPARISON_LTE), 'lte');
  assert.equal(normalizeParamCountComparison('at_least'), 'equals');
  assert.equal(normalizeParamCountComparison('GTE'), 'equals');
  assert.equal(normalizeParamCountComparison(''), 'equals');
  assert.equal(normalizeParamCountComparison(null), 'equals');
  assert.equal(normalizeParamCountComparison(undefined), 'equals');

  assert.deepEqual(VALID_PARAM_COUNT_COMPARISONS, ['equals', 'gte', 'lte']);
  assert.equal(
    PARAM_COUNT_COMPARISON_OPTIONS.every((option) => VALID_PARAM_COUNT_COMPARISONS.includes(option.value)),
    true,
  );
});

test('an absent constraint matches any parameter count', () => {
  for (const constraint of [null, undefined, [], 'equals', 3, false]) {
    assert.equal(matchesParamCountConstraint(0, constraint), true, `constraint ${JSON.stringify(constraint)}`);
    assert.equal(matchesParamCountConstraint(4, constraint), true, `constraint ${JSON.stringify(constraint)}`);
  }
});

test('equals matches exactly one count', () => {
  assert.equal(matchesParamCountConstraint(2, { count: 2, comparison: 'equals' }), true);
  assert.equal(matchesParamCountConstraint(2, { count: 2 }), true);
  assert.equal(matchesParamCountConstraint(3, { count: 2 }), false);
  assert.equal(matchesParamCountConstraint(1, { count: 2 }), false);
  assert.equal(matchesParamCountConstraint(0, { count: 0 }), true);
  assert.equal(matchesParamCountConstraint(1, { count: 0 }), false);

  // A missing comparison field behaves like 'equals'.
  assert.equal(matchesParamCountConstraint(2, { count: 2, comparison: undefined }), true);
  assert.equal(matchesParamCountConstraint(1, { count: 2, comparison: 'nope' }), false);
  assert.equal(matchesParamCountConstraint(2, { count: 2, comparison: 'nope' }), true);
});

test('gte and lte include their own boundary', () => {
  assert.equal(matchesParamCountConstraint(2, { count: 2, comparison: 'gte' }), true);
  assert.equal(matchesParamCountConstraint(3, { count: 2, comparison: 'gte' }), true);
  assert.equal(matchesParamCountConstraint(1, { count: 2, comparison: 'gte' }), false);
  assert.equal(matchesParamCountConstraint(0, { count: 0, comparison: 'gte' }), true);

  assert.equal(matchesParamCountConstraint(2, { count: 2, comparison: 'lte' }), true);
  assert.equal(matchesParamCountConstraint(1, { count: 2, comparison: 'lte' }), true);
  assert.equal(matchesParamCountConstraint(3, { count: 2, comparison: 'lte' }), false);
  assert.equal(matchesParamCountConstraint(0, { count: 0, comparison: 'lte' }), true);
});

test('a malformed count in a constraint reads as zero', () => {
  assert.equal(matchesParamCountConstraint(0, { count: 'x' }), true);
  assert.equal(matchesParamCountConstraint(1, { count: 'x' }), false);
  assert.equal(matchesParamCountConstraint(0, { count: -5 }), true);
  assert.equal(matchesParamCountConstraint(2, { count: -5 }), false);

  // An empty object is a real constraint on zero parameters, unlike an absent one.
  assert.equal(matchesParamCountConstraint(0, {}), true);
  assert.equal(matchesParamCountConstraint(1, {}), false);
});

test('only procedure definitions and calls report a parameter list', () => {
  for (const type of ['procedures_defnoreturn', 'procedures_defreturn', 'procedures_callnoreturn', 'procedures_callreturn']) {
    assert.equal(isProcedureBlockType(type), true, type);
  }
  for (const type of ['procedures_ifreturn', 'text_print', 'controls_if', '', null, undefined, 0]) {
    assert.equal(isProcedureBlockType(type), false, String(type));
  }
});

test('a definition with no parameters counts zero, with parameters counts them all', () => {
  const workspace = workspaceWith([
    { type: 'procedures_defnoreturn', id: 'none', fields: { NAME: 'noargs' } },
    { type: 'procedures_defnoreturn', id: 'one', fields: { NAME: 'one' }, extraState: { params: [{ name: 'a' }] } },
    {
      type: 'procedures_defnoreturn',
      id: 'three',
      fields: { NAME: 'three' },
      extraState: { params: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
    },
    {
      type: 'procedures_defreturn',
      id: 'returning',
      fields: { NAME: 'returning' },
      extraState: { params: [{ name: 'x' }] },
    },
  ]);

  assert.equal(getBlockParamCount(workspace.getBlockById('none')), 0);
  assert.equal(getBlockParamCount(workspace.getBlockById('one')), 1);
  assert.equal(getBlockParamCount(workspace.getBlockById('three')), 3);
  assert.equal(getBlockParamCount(workspace.getBlockById('returning')), 1);
});

test('a call counts its own argument list, and other blocks count zero', () => {
  const workspace = workspaceWith([
    { type: 'procedures_callnoreturn', id: 'bare', extraState: { name: 'noargs' } },
    { type: 'procedures_callnoreturn', id: 'two', extraState: { name: 'pair', params: ['a', 'b'] } },
    { type: 'procedures_callreturn', id: 'returned', extraState: { name: 'f', params: ['a'] } },
    { type: 'text_print', id: 'print' },
    { type: 'text', id: 'text', fields: { TEXT: 'hi' } },
  ]);

  assert.equal(getBlockParamCount(workspace.getBlockById('bare')), 0);
  assert.equal(getBlockParamCount(workspace.getBlockById('two')), 2);
  assert.equal(getBlockParamCount(workspace.getBlockById('returned')), 1);
  assert.equal(getBlockParamCount(workspace.getBlockById('print')), 0);
  assert.equal(getBlockParamCount(workspace.getBlockById('text')), 0);
});

test('a parameter count survives a workspace save and load round trip', () => {
  const workspace = workspaceWith([
    {
      type: 'procedures_defnoreturn',
      id: 'def',
      fields: { NAME: 'pair' },
      extraState: { params: [{ name: 'a' }, { name: 'b' }] },
    },
  ]);
  const reloaded = workspaceWith([
    {
      type: 'procedures_defnoreturn',
      id: 'def',
      fields: { NAME: 'pair' },
      extraState: workspace.getBlockById('def').saveExtraState(),
    },
  ]);

  assert.equal(getBlockParamCount(reloaded.getBlockById('def')), 2);
  assert.equal(matchesParamCountConstraint(getBlockParamCount(reloaded.getBlockById('def')), { count: 2, comparison: 'gte' }), true);
});

test('blocks that cannot report extra state count zero', () => {
  assert.equal(getBlockParamCount(null), 0);
  assert.equal(getBlockParamCount(undefined), 0);
  assert.equal(getBlockParamCount({}), 0);
  assert.equal(getBlockParamCount({ saveExtraState: () => null }), 0);
  assert.equal(getBlockParamCount({ saveExtraState: () => 'params' }), 0);
  assert.equal(getBlockParamCount({ saveExtraState: () => ({ params: 'a' }) }), 0);
  assert.equal(getBlockParamCount({ saveExtraState: () => ({ name: 'f' }) }), 0);
  assert.equal(getBlockParamCount({ saveExtraState: () => ({ params: [] }) }), 0);
});

test('the pattern toolbox category offers both wildcard blocks', () => {
  const category = createPatternToolboxCategory();

  assert.equal(category.name, 'Pattern');
  assert.deepEqual(category.blocks, [PATTERN_ANY_STATEMENT_TYPE, PATTERN_ANY_VALUE_TYPE]);
  assert.equal(typeof category.colour, 'string');

  // Every offered type must be a registered wildcard the builder can instantiate.
  for (const type of category.blocks) {
    assert.equal(isPatternWildcardType(type), true, type);
    assert.ok(Blockly.Blocks[type], `${type} is registered`);
  }

  assert.notEqual(createPatternToolboxCategory(), category, 'each call returns a fresh category');
});
