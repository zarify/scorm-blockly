/**
 * Condition suggestions — the block type list and per-block metadata that the
 * builder's condition editors offer as autocomplete.
 *
 * The behaviour worth pinning is that the list follows the config it is given:
 * the starter workspace and the toolbox both contribute, unsupported types are
 * filtered out, and a *new* starter workspace is reflected (the results are
 * cached per workspace object, so a stale cache would show up here).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Blockly, blockState } from './helpers/blockly.js';
import {
  createConditionSuggestionIds,
  getConditionBlockDefinitionMetadata,
  getSuggestedConditionBlockTypes,
} from '../src/activity-builder/js/condition-suggestions.js';

const config = (startingBlocks, toolboxBlocks = []) => ({
  blockly_setup: {
    starting_blocks: startingBlocks,
    toolbox: { categories: [{ name: 'Text', blocks: toolboxBlocks }] },
  },
});

test('suggestions include the default library, the toolbox and the starter workspace', () => {
  const suggestions = getSuggestedConditionBlockTypes(
    Blockly,
    config(blockState([{ type: 'variables_set' }]), ['text_print']),
  );

  assert.ok(suggestions.includes('text_print'), 'toolbox block');
  assert.ok(suggestions.includes('variables_set'), 'starter workspace block');
  assert.ok(suggestions.includes('controls_repeat_ext'), 'default library block');
  assert.deepEqual(suggestions, [...suggestions].sort());
  assert.equal(suggestions.length, new Set(suggestions).size);
});

test('a config without a starter workspace or toolbox still offers the defaults', () => {
  const suggestions = getSuggestedConditionBlockTypes(Blockly, {});
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.includes('text_print'));
});

test('block types this Blockly build does not have are filtered out', () => {
  const suggestions = getSuggestedConditionBlockTypes(
    Blockly,
    config(blockState([{ type: 'variables_set' }]), ['text_print', 'made_up_block']),
  );

  assert.equal(suggestions.includes('made_up_block'), false);
  assert.ok(suggestions.includes('text_print'));
});

test('a replaced starter workspace is reflected, not served from a stale cache', () => {
  // These two types are registered but absent from the default library, so the
  // starter workspace is the only thing that can put them in the list.
  const first = getSuggestedConditionBlockTypes(
    Blockly,
    config(blockState([{ type: 'variables_get_dynamic' }])),
  );
  assert.ok(first.includes('variables_get_dynamic'));
  assert.equal(first.includes('lists_create_empty'), false);

  const second = getSuggestedConditionBlockTypes(
    Blockly,
    config(blockState([{ type: 'lists_create_empty' }])),
  );
  assert.ok(second.includes('lists_create_empty'));
  assert.equal(second.includes('variables_get_dynamic'), false);
});

test('repeating a call with the same config gives the same list', () => {
  const shape = config(blockState([{ type: 'variables_set' }]), ['text_print']);
  assert.deepEqual(
    getSuggestedConditionBlockTypes(Blockly, shape),
    getSuggestedConditionBlockTypes(Blockly, shape),
  );
});

test('block definition metadata reports the inputs and fields of a block type', () => {
  assert.deepEqual(getConditionBlockDefinitionMetadata(Blockly, 'variables_set'), {
    inputNames: ['VALUE'],
    fieldNames: ['VAR'],
  });
  assert.deepEqual(getConditionBlockDefinitionMetadata(Blockly, 'controls_repeat_ext').inputNames, ['DO', 'TIMES']);
});

test('metadata for an unknown or missing block type is empty, not undefined', () => {
  const empty = { inputNames: [], fieldNames: [] };
  assert.deepEqual(getConditionBlockDefinitionMetadata(Blockly, 'not_a_block'), empty);
  assert.deepEqual(getConditionBlockDefinitionMetadata(Blockly, ''), empty);
  assert.deepEqual(getConditionBlockDefinitionMetadata(Blockly, undefined), empty);
  assert.deepEqual(getConditionBlockDefinitionMetadata(undefined, 'text_print'), empty);
});

test('suggestion set ids are unique per call', () => {
  const first = createConditionSuggestionIds();
  const second = createConditionSuggestionIds();
  assert.notDeepEqual(first, second);
  assert.notEqual(first.blockTypes, second.blockTypes);
  assert.equal(first.blockTypes.startsWith('condition-suggestions-'), true);
});
