/**
 * Toolbox helpers — shared by the builder (authoring toolbox, condition
 * suggestions) and the runtime (student toolbox).
 *
 * These run against real headless Blockly workspaces, so the tests use the real
 * block definitions rather than a hand-written stand-in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as Blockly from 'blockly';

import {
  DEFAULT_TOOLBOX_BLOCK_LIBRARY,
  buildCategoryToolboxContents,
  createAuthoringToolboxCategories,
  createDefaultToolboxCategories,
  createSeededToolboxCategories,
  filterSupportedBlockTypes,
  getBlockTypesFromWorkspaceState,
  getDefaultCategoryColour,
  getWorkspaceBlockMetadata,
  isSupportedBlockType,
  registerDynamicToolboxCategoryCallbacks,
} from '../src/shared/blockly-toolbox.js';
import { blockState } from './helpers/blockly.js';

test('category colours cycle through the palette', () => {
  const first = getDefaultCategoryColour(0);
  assert.match(first, /^#[0-9A-F]{6}$/i);
  assert.equal(getDefaultCategoryColour(1) === first, false);
  assert.equal(getDefaultCategoryColour(7), first);
  assert.equal(getDefaultCategoryColour(14), first);
});

test('default categories are non-empty, ordered and freshly allocated', () => {
  const categories = createDefaultToolboxCategories();
  assert.deepEqual(
    categories.map((category) => category.name),
    Object.keys(DEFAULT_TOOLBOX_BLOCK_LIBRARY),
  );
  for (const category of categories) {
    assert.ok(category.blocks.length > 0, `${category.name} should offer blocks`);
    assert.ok(category.colour);
  }

  // Editing a returned category must not leak into the next call.
  categories[0].blocks.push('made_up_block');
  categories[0].name = 'Renamed';
  const again = createDefaultToolboxCategories();
  assert.equal(again[0].name, Object.keys(DEFAULT_TOOLBOX_BLOCK_LIBRARY)[0]);
  assert.equal(again[0].blocks.includes('made_up_block'), false);
});

test('the authoring toolbox swaps Variables and Functions for custom categories', () => {
  const authoring = createAuthoringToolboxCategories();
  const byName = Object.fromEntries(authoring.map((category) => [category.name, category]));

  assert.equal(byName.Variables.custom, 'VARIABLE');
  assert.equal(byName.Variables.blocks, undefined);
  assert.equal(byName.Functions.custom, 'PROCEDURE');
  assert.equal(byName.Functions.blocks, undefined);

  const text = byName.Text;
  assert.equal(text.custom, undefined);
  assert.ok(text.blocks.includes('text_print'));
  assert.equal(text.colour, createDefaultToolboxCategories().find((c) => c.name === 'Text').colour);
});

test('seeded categories keep only the used blocks, in library order', () => {
  const seeded = createSeededToolboxCategories(['text_print', 'math_number', 'controls_if']);
  assert.deepEqual(
    seeded.map((category) => category.name),
    ['Logic', 'Math', 'Text'],
  );

  const text = seeded.find((category) => category.name === 'Text');
  assert.deepEqual(text.blocks, ['text_print']);

  // Input order does not decide block order inside a category.
  const reversed = createSeededToolboxCategories(['text', 'text_print']);
  assert.deepEqual(reversed.find((category) => category.name === 'Text').blocks, ['text', 'text_print']);
});

test('seeding tolerates duplicates, unknown types and an empty list', () => {
  const duplicated = createSeededToolboxCategories(['text_print', 'text_print']);
  assert.deepEqual(duplicated.find((category) => category.name === 'Text').blocks, ['text_print']);

  assert.deepEqual(createSeededToolboxCategories(['not_a_block']), []);
  assert.deepEqual(createSeededToolboxCategories([]), []);
  assert.deepEqual(createSeededToolboxCategories(undefined), []);
});

test('block types are collected from a saved workspace, deduplicated and nested-aware', () => {
  const state = blockState([
    {
      type: 'variables_set',
      fields: { VAR: 'total' },
      inputs: { VALUE: { block: { type: 'math_number', fields: { NUM: 1 } } } },
    },
    { type: 'text_print', inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'hi' } } } } },
    { type: 'math_number', fields: { NUM: 2 } },
  ]);

  const types = getBlockTypesFromWorkspaceState(Blockly, state);
  assert.deepEqual([...types].sort(), ['math_number', 'text', 'text_print', 'variables_set']);
  assert.equal(types.length, new Set(types).size);
});

test('collecting block types from an empty or absent state yields nothing', () => {
  assert.deepEqual(getBlockTypesFromWorkspaceState(Blockly, null), []);
  assert.deepEqual(getBlockTypesFromWorkspaceState(Blockly, blockState([])), []);
  assert.deepEqual(getBlockTypesFromWorkspaceState(Blockly, { nonsense: true }), []);
});

test('workspace metadata lists inputs and fields per block type', () => {
  const state = blockState([
    {
      type: 'variables_set',
      fields: { VAR: 'total' },
      inputs: { VALUE: { block: { type: 'math_number', fields: { NUM: 1 } } } },
    },
  ]);

  const metadata = getWorkspaceBlockMetadata(Blockly, state);
  assert.deepEqual(metadata.blockTypes, ['math_number', 'variables_set']);
  assert.deepEqual(metadata.inputNamesByBlockType.variables_set, ['VALUE']);
  assert.deepEqual(metadata.fieldNamesByBlockType.variables_set, ['VAR']);
  assert.deepEqual(metadata.fieldNamesByBlockType.math_number, ['NUM']);
  assert.deepEqual(metadata.inputNamesByBlockType.math_number, []);
});

test('metadata merges two uses of the same block type', () => {
  const state = blockState([
    { type: 'text_print', inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'a' } } } } },
    { type: 'text_print', inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'b' } } } } },
  ]);

  const metadata = getWorkspaceBlockMetadata(Blockly, state);
  assert.deepEqual(metadata.blockTypes, ['text', 'text_print']);
  assert.deepEqual(metadata.fieldNamesByBlockType.text, ['TEXT']);
});

test('metadata for an absent workspace is empty, not undefined', () => {
  assert.deepEqual(getWorkspaceBlockMetadata(Blockly, null), {
    blockTypes: [],
    inputNamesByBlockType: {},
    fieldNamesByBlockType: {},
  });
  assert.deepEqual(getWorkspaceBlockMetadata(Blockly, blockState([])), {
    blockTypes: [],
    inputNamesByBlockType: {},
    fieldNamesByBlockType: {},
  });
});

test('a starting workspace naming a block this build does not have is ignored, not fatal', () => {
  // Reachable by opening an activity authored against an older Blockly, or a
  // hand-edited config. Reading metadata happens while the builder renders its
  // condition editors, so throwing here blanks the editor.
  const stale = blockState([
    {
      type: 'text_print',
      inputs: { TEXT: { block: { type: 'obsolete_text_block', fields: { TEXT: 'hi' } } } },
    },
  ]);

  assert.deepEqual(getBlockTypesFromWorkspaceState(Blockly, stale), []);
  assert.deepEqual(getWorkspaceBlockMetadata(Blockly, stale), {
    blockTypes: [],
    inputNamesByBlockType: {},
    fieldNamesByBlockType: {},
  });
});

test('a starting workspace with a malformed input is ignored, not fatal', () => {
  const malformed = blockState([
    { type: 'text_print', inputs: { NOT_AN_INPUT: { block: { type: 'text', fields: { TEXT: 'hi' } } } } },
  ]);

  assert.deepEqual(getBlockTypesFromWorkspaceState(Blockly, malformed), []);
  assert.deepEqual(getWorkspaceBlockMetadata(Blockly, malformed), {
    blockTypes: [],
    inputNamesByBlockType: {},
    fieldNamesByBlockType: {},
  });
});

test('support checks reject unregistered and non-string types', () => {
  assert.equal(isSupportedBlockType(Blockly, 'text_print'), true);
  assert.equal(isSupportedBlockType(Blockly, 'procedures_defreturn'), true);
  assert.equal(isSupportedBlockType(Blockly, 'not_a_block'), false);
  assert.equal(isSupportedBlockType(Blockly, ''), false);
  assert.equal(isSupportedBlockType(Blockly, null), false);
  assert.equal(isSupportedBlockType(Blockly, undefined), false);
  assert.equal(isSupportedBlockType(Blockly, 42), false);
  assert.equal(isSupportedBlockType(undefined, 'text_print'), false);
});

test('filtering keeps the requested order and drops unsupported types', () => {
  const filtered = filterSupportedBlockTypes(
    Blockly,
    ['text_print', 'not_a_block', 'math_number', 'text_print'],
    'unit test: filtering',
  );
  assert.deepEqual(filtered, ['text_print', 'math_number', 'text_print']);

  assert.deepEqual(filterSupportedBlockTypes(Blockly, [], 'unit test: empty'), []);
  assert.deepEqual(filterSupportedBlockTypes(Blockly, undefined, 'unit test: undefined'), []);
  assert.deepEqual(
    filterSupportedBlockTypes(Blockly, ['nope'], 'unit test: all unsupported'),
    [],
  );
});

test('toolbox contents use real categories and skip empty ones', () => {
  const contents = buildCategoryToolboxContents(
    Blockly,
    [
      { name: 'Empty', blocks: ['gone'] },
      { name: 'Text', colour: '#123456', blocks: ['text_print', 'gone'] },
    ],
    'unit test: contents',
  );

  assert.equal(contents.length, 1);
  assert.deepEqual(contents[0], {
    kind: 'category',
    name: 'Text',
    colour: '#123456',
    contents: [{ kind: 'block', type: 'text_print' }],
  });
});

test('a category without a colour omits the colour rather than blanking it', () => {
  const contents = buildCategoryToolboxContents(
    Blockly,
    [{ name: 'Text', blocks: ['text_print'] }],
    'unit test: colour',
  );
  assert.equal(contents[0].colour, undefined);
});

test('procedure calls turn a category into a dynamic one, keyed by its original index', () => {
  const contents = buildCategoryToolboxContents(
    Blockly,
    [
      { name: 'Empty', blocks: ['gone'] },
      { name: 'Functions', blocks: ['procedures_callnoreturn'] },
    ],
    'unit test: procedures',
  );

  assert.equal(contents.length, 1);
  assert.equal(contents[0].name, 'Functions');
  assert.equal(contents[0].custom, 'SCORM_PROCEDURE_1');
  assert.equal(contents[0].contents, undefined);
});

test('custom categories pass through untouched', () => {
  const contents = buildCategoryToolboxContents(
    Blockly,
    [{ name: 'Variables', colour: '#5CA68D', custom: 'VARIABLE' }],
    'unit test: custom',
  );
  assert.deepEqual(contents, [
    { kind: 'category', name: 'Variables', colour: '#5CA68D', custom: 'VARIABLE' },
  ]);
});

test('dynamic category callbacks are only registered where they are needed', () => {
  const registered = new Map();
  const fakeBlockly = {
    Blocks: Blockly.Blocks,
    Procedures: { flyoutCategory: () => [] },
  };
  const fakeWorkspace = {
    registerToolboxCategoryCallback(key, callback) {
      registered.set(key, callback);
    },
  };

  registerDynamicToolboxCategoryCallbacks(fakeWorkspace, fakeBlockly, [
    { name: 'Text', blocks: ['text_print'] },
    { name: 'Variables', custom: 'VARIABLE' },
    { name: 'Functions', blocks: ['procedures_defnoreturn'] },
  ]);

  assert.deepEqual([...registered.keys()], []);
});

test('the dynamic procedure callback filters out block types the category does not offer', () => {
  const registered = new Map();
  const fakeBlockly = {
    Blocks: Blockly.Blocks,
    Procedures: {
      flyoutCategory: () => [
        { kind: 'block', type: 'procedures_defnoreturn' },
        { kind: 'block', type: 'procedures_callnoreturn' },
        { kind: 'button', text: 'Create function' },
      ],
    },
  };
  const fakeWorkspace = {
    registerToolboxCategoryCallback(key, callback) {
      registered.set(key, callback);
    },
  };

  registerDynamicToolboxCategoryCallbacks(fakeWorkspace, fakeBlockly, [
    { name: 'Functions', blocks: ['procedures_callnoreturn'] },
  ]);

  const callback = registered.get('SCORM_PROCEDURE_0');
  assert.equal(typeof callback, 'function');

  const items = callback({});
  assert.deepEqual(
    items.map((item) => item.type ?? item.kind),
    ['procedures_callnoreturn', 'button'],
  );
});

test('registering dynamic callbacks is a no-op on a runtime without toolbox support', () => {
  assert.doesNotThrow(() => {
    registerDynamicToolboxCategoryCallbacks({}, Blockly, [
      { name: 'Functions', blocks: ['procedures_callnoreturn'] },
    ]);
  });
  assert.doesNotThrow(() => {
    registerDynamicToolboxCategoryCallbacks(
      { registerToolboxCategoryCallback() {} },
      { Blocks: Blockly.Blocks },
      [{ name: 'Functions', blocks: ['procedures_callnoreturn'] }],
    );
  });
});
