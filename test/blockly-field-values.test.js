/**
 * Field value extraction — what `block_field_value` conditions and pattern
 * field constraints compare against.
 *
 * The contract that matters for authors: a variable field is compared by the
 * variable's name (what the student and author see), never by Blockly's
 * internal variable id.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Blockly, workspaceWith } from './helpers/blockly.js';
import { getComparableFieldValue, isVariableField } from '../src/shared/blockly-field-values.js';

test('a variable field yields the variable name, not its id', () => {
  const workspace = new Blockly.Workspace();
  const variable = workspace.createVariable('total');
  const block = workspace.newBlock('variables_set');
  block.getField('VAR').setValue(variable.getId());

  const value = getComparableFieldValue(block, 'VAR');
  assert.equal(value, 'total');
  assert.notEqual(value, variable.getId());
  assert.equal(isVariableField(block, 'VAR'), true);
});

test('numeric and text fields are compared as text', () => {
  const workspace = workspaceWith([
    { type: 'math_number', fields: { NUM: 5 } },
    { type: 'text', fields: { TEXT: 'hello' } },
  ]);
  const [numberBlock, textBlock] = workspace.getAllBlocks(false);

  assert.equal(getComparableFieldValue(numberBlock, 'NUM'), '5');
  assert.equal(getComparableFieldValue(textBlock, 'TEXT'), 'hello');
  assert.equal(isVariableField(numberBlock, 'NUM'), false);
  assert.equal(isVariableField(textBlock, 'TEXT'), false);
});

test('an empty text field is the empty string, not null', () => {
  const [block] = workspaceWith([{ type: 'text', fields: { TEXT: '' } }]).getAllBlocks(false);
  assert.equal(getComparableFieldValue(block, 'TEXT'), '');
});

test('a field the block does not have yields null and is not a variable', () => {
  const [block] = workspaceWith([{ type: 'math_number', fields: { NUM: 1 } }]).getAllBlocks(false);
  assert.equal(getComparableFieldValue(block, 'MISSING'), null);
  assert.equal(isVariableField(block, 'MISSING'), false);
});

test('a missing block is handled without throwing', () => {
  assert.equal(getComparableFieldValue(null, 'ANY'), null);
  assert.equal(getComparableFieldValue(undefined, 'ANY'), null);
  assert.equal(isVariableField(null, 'ANY'), false);
});

test('a block that only exposes getFieldValue passes its value through unchanged', () => {
  // Documents the fallback used for block shapes without field objects: the
  // value is returned as-is, so callers still have to coerce it.
  const stub = { getFieldValue: (name) => (name === 'A' ? 7 : undefined) };
  assert.equal(getComparableFieldValue(stub, 'A'), 7);
  assert.equal(getComparableFieldValue(stub, 'B'), null);
  assert.equal(isVariableField(stub, 'A'), false);
});
