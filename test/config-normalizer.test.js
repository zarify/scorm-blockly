/**
 * Config normalization — the boundary every activity config crosses twice:
 * once on the way in (a hand-written, legacy or half-edited config becoming a
 * builder draft) and once on the way out (the draft becoming the payload that
 * is exported to JSON and to a SCORM package).
 *
 * The interesting edges are the ones real configs arrive with: whole sections
 * missing, a section of the wrong type, keys written by an older schema,
 * out-of-range numbers, and items too incomplete to publish.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUSPEND_DATA_DEFAULT_LIMIT,
  normalizeBuilderDraftConfig,
  sanitizeConfigForExport,
  sanitizeConfigForScorm,
} from '../src/shared/config-normalizer.js';
import { validateConfig } from '../src/shared/config-validator.js';
import { getDefaultCategoryColour } from '../src/shared/blockly-toolbox.js';
import { activityConfig, blockPatternTestConfig } from './helpers/config.js';
import { blockState } from './helpers/blockly.js';

/** A config that reaches most branches of both normalizers. */
function richConfig() {
  return {
    metadata: {
      activity_id: 'rich_activity',
      title: 'Rich',
      version: '2.1',
      description: 'd',
      unknown_meta: true,
    },
    instructions: { main: 'Do it', steps: ['one', 2, null] },
    ui_settings: {
      theme: 'dark',
      show_code_toggle: true,
      show_hint_panel: false,
      suspend_data_limit: 2048,
      unknown_ui: 1,
    },
    blockly_setup: {
      toolbox: {
        categories: [
          { name: 'Text', colour: '#111111', blocks: ['text_print', 'text', '', 7] },
          { name: 'Loops', blocks: ['controls_repeat_ext'] },
          null,
        ],
      },
      starting_blocks: { blocks: { languageVersion: 0, blocks: [] } },
      max_blocks: 25,
      disabled_blocks: ['controls_for', '', 3],
    },
    hints: [
      {
        id: 'hint_a',
        message: 'First',
        trigger: {
          event: 'test_fail',
          conditions: {
            type: 'block_nested',
            outer_type: 'text_print',
            inner_type: 'text',
            input_name: 'TEXT',
            field_name: 'TEXT',
            expected_value: 'hi',
            match_mode: 'regex',
            regex_flags: 'gi',
          },
          after_attempts: 2,
          invalidate_on_condition_false: true,
        },
        display_mode: 'triggered',
        priority: 2,
        delay_seconds: 1.9,
        show_once: true,
        style: 'warning',
        unknown_hint: 1,
      },
      {
        id: 'hint_b',
        message: 'Second',
        trigger: {
          event: 'manual',
          conditions: {
            type: 'block_field_value',
            block_type: 'text',
            field_name: 'TEXT',
            expected_value: 'x',
            match_mode: 'regex',
            regex_flags: 'i',
          },
        },
      },
    ],
    evaluation: {
      grading_mode: 'weighted',
      max_score: 50,
      feedback_on_all_pass: 'nice',
      require_previous_test_pass: false,
      unknown_eval: 1,
      test_cases: [
        {
          id: 'test_stdout',
          type: 'stdout_match',
          weight: 4,
          expected_output: 'hi\n',
          match_mode: 'contains',
          prompt_inputs: [1, true],
          strict_prompt_inputs: false,
          unknown_test: 1,
        },
        {
          id: 'test_vars',
          type: 'variable_state',
          points: 6,
          variable_name: 'count',
          expected_type: 'number',
          expected_value: 3,
          comparison: 'gt',
          show_coerced_value_hint: true,
          unknown_test: 2,
        },
      ],
    },
  };
}

/** One serialized pattern workspace with a single `text` root (a real TEXT field). */
function patternState() {
  return blockState([{ type: 'text', id: 'b1', fields: { TEXT: 'hi' } }]);
}

/** Draft-normalized condition for a one-test config. */
function draftCondition(raw) {
  const { config } = normalizeBuilderDraftConfig({
    evaluation: { test_cases: [{ type: 'block_structure', conditions: raw }] },
  });
  return config.evaluation.test_cases[0].conditions;
}

/** Export-normalized condition payload (and how many tests were dropped). */
function exportCondition(raw) {
  const { config, omissions } = sanitizeConfigForExport({
    evaluation: { test_cases: [{ id: 't', type: 'block_structure', points: 1, conditions: raw }] },
  });
  return { conditions: config.evaluation.test_cases[0]?.conditions, testOmissions: omissions.tests };
}

function keysOf(value) {
  return Object.keys(value).sort();
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('a config with no sections at all still produces a complete draft', () => {
  for (const raw of [undefined, null, 0, 'nope', true, [], () => {}]) {
    const { config } = normalizeBuilderDraftConfig(raw);
    assert.deepEqual(config.metadata, {
      activity_id: '',
      title: '',
      version: '1.0',
      description: '',
    });
    assert.deepEqual(config.instructions, { main: '', steps: [] });
    assert.deepEqual(config.ui_settings, {
      theme: 'default',
      show_code_toggle: false,
      show_hint_panel: true,
      suspend_data_limit: SUSPEND_DATA_DEFAULT_LIMIT,
    });
    assert.deepEqual(config.blockly_setup.toolbox.categories, []);
    assert.equal(config.blockly_setup.starting_blocks, null);
    assert.equal(config.blockly_setup.max_blocks, null);
    assert.deepEqual(config.blockly_setup.disabled_blocks, []);
    assert.deepEqual(config.hints, []);
    assert.deepEqual(config.evaluation.test_cases, []);
    assert.equal(config.evaluation.grading_mode, 'weighted');
    assert.equal(config.evaluation.max_score, 100);
    assert.equal(config.evaluation.feedback_on_all_pass, '');
    assert.equal(config.evaluation.require_previous_test_pass, true);
  }

  // The published default is the SCORM 1.2 cmi.suspend_data size.
  assert.equal(SUSPEND_DATA_DEFAULT_LIMIT, 4096);
});

test('a section of the wrong type is replaced wholesale, not half-read', () => {
  const { config } = normalizeBuilderDraftConfig({
    metadata: 'text',
    instructions: 'text',
    ui_settings: [],
    blockly_setup: 'text',
    hints: 'text',
    evaluation: null,
  });
  assert.deepEqual(config.metadata, {
    activity_id: '',
    title: '',
    version: '1.0',
    description: '',
  });
  assert.deepEqual(config.instructions, { main: '', steps: [] });
  assert.deepEqual(config.ui_settings, {
    theme: 'default',
    show_code_toggle: false,
    show_hint_panel: true,
    suspend_data_limit: SUSPEND_DATA_DEFAULT_LIMIT,
  });
  assert.deepEqual(config.blockly_setup.toolbox.categories, []);
  assert.deepEqual(config.hints, []);
  assert.deepEqual(config.evaluation.test_cases, []);
  assert.equal(config.evaluation.max_score, 100);
});

test('readable fields inside a partly broken section survive', () => {
  const { config } = normalizeBuilderDraftConfig({
    metadata: { activity_id: 'a_1', title: 42, description: null },
    instructions: { main: 'go', steps: 'nope' },
    ui_settings: { theme: 'dark', show_code_toggle: true, show_hint_panel: false },
    evaluation: { grading_mode: 'pass_fail', max_score: '55', require_previous_test_pass: false },
  });
  assert.deepEqual(config.metadata, {
    activity_id: 'a_1',
    title: '',
    version: '1.0',
    description: '',
  });
  assert.deepEqual(config.instructions, { main: 'go', steps: [] });
  assert.equal(config.ui_settings.theme, 'dark');
  assert.equal(config.ui_settings.show_code_toggle, true);
  assert.equal(config.ui_settings.show_hint_panel, false);
  assert.equal(config.evaluation.grading_mode, 'pass_fail');
  assert.equal(config.evaluation.max_score, 55);
  assert.equal(config.evaluation.require_previous_test_pass, false);
});

test('only known keys reach the draft, at every level', () => {
  const { config } = normalizeBuilderDraftConfig({
    metadata: { activity_id: 'a', title: 't', version: '2.0', description: 'd', created_at: 'x' },
    ui_settings: { theme: 'dark', hint_display_mode: 'checklist', traffic_light: true },
    blockly_setup: { max_blocks: 5, mystery: 1, toolbox: { categories: [], zoom: 2 } },
    evaluation: { max_score: 10, rubric: {} },
    hints: [
      {
        id: 'h',
        message: 'm',
        unknown_hint_key: 1,
        trigger: { event: 'manual', conditions: { type: 'workspace_empty' }, unknown_trigger_key: 2 },
      },
    ],
    extra_top_level: true,
  });

  assert.deepEqual(keysOf(config), [
    'blockly_setup',
    'evaluation',
    'hints',
    'instructions',
    'metadata',
    'ui_settings',
  ]);
  assert.deepEqual(keysOf(config.metadata), ['activity_id', 'description', 'title', 'version']);
  assert.deepEqual(keysOf(config.ui_settings), [
    'show_code_toggle',
    'show_hint_panel',
    'suspend_data_limit',
    'theme',
  ]);
  assert.deepEqual(keysOf(config.blockly_setup.toolbox), ['categories']);
  assert.deepEqual(keysOf(config.evaluation), [
    'feedback_on_all_pass',
    'grading_mode',
    'max_score',
    'require_previous_test_pass',
    'test_cases',
  ]);
  assert.deepEqual(keysOf(config.hints[0].trigger), [
    'after_attempts',
    'conditions',
    'event',
    'invalidate_on_condition_false',
  ]);
  assert.deepEqual(keysOf(config.hints[0]), [
    'delay_seconds',
    'display_mode',
    'id',
    'message',
    'priority',
    'show_once',
    'style',
    'trigger',
  ]);
});

test('ui_settings booleans only treat an explicit value as set', () => {
  const showCode = (value) =>
    normalizeBuilderDraftConfig({ ui_settings: { show_code_toggle: value } }).config.ui_settings
      .show_code_toggle;
  assert.equal(showCode(true), true);
  assert.equal(showCode('true'), false);
  assert.equal(showCode(1), false);
  assert.equal(showCode(undefined), false);

  const showHints = (value) =>
    normalizeBuilderDraftConfig({ ui_settings: { show_hint_panel: value } }).config.ui_settings
      .show_hint_panel;
  assert.equal(showHints(false), false);
  assert.equal(showHints(true), true);
  assert.equal(showHints(undefined), true);
  assert.equal(showHints('false'), true); // only an explicit false hides the panel
  assert.equal(showHints(0), true);

  const theme = (value) =>
    normalizeBuilderDraftConfig({ ui_settings: { theme: value } }).config.ui_settings.theme;
  assert.equal(theme('dark'), 'dark');
  assert.equal(theme(''), '');
  assert.equal(theme(5), 'default');
  assert.equal(theme(null), 'default');
});

test('suspend_data_limit falls back to the SCORM default when it cannot be read as a number', () => {
  const limit = (value) =>
    normalizeBuilderDraftConfig({ ui_settings: { suspend_data_limit: value } }).config.ui_settings
      .suspend_data_limit;

  assert.equal(limit(undefined), SUSPEND_DATA_DEFAULT_LIMIT);
  assert.equal(limit(null), SUSPEND_DATA_DEFAULT_LIMIT);
  assert.equal(limit(''), SUSPEND_DATA_DEFAULT_LIMIT);
  assert.equal(limit('lots'), SUSPEND_DATA_DEFAULT_LIMIT);
  assert.equal(limit({}), SUSPEND_DATA_DEFAULT_LIMIT);
  assert.equal(limit(Infinity), SUSPEND_DATA_DEFAULT_LIMIT);
  assert.equal(limit(NaN), SUSPEND_DATA_DEFAULT_LIMIT);

  // Anything that does read as a finite number is kept, truncated to an integer.
  assert.equal(limit(2048), 2048);
  assert.equal(limit('2048'), 2048);
  assert.equal(limit(2048.9), 2048);
  assert.equal(limit(0), 0);
  assert.equal(limit(-1), -1);
});

test('an out-of-range suspend_data_limit reaches the export validator untouched', () => {
  const draft = (value) =>
    normalizeBuilderDraftConfig({ ...activityConfig(), ui_settings: { suspend_data_limit: value } })
      .config;

  // The draft keeps what the author wrote, including values the schema rejects.
  assert.equal(draft(100).ui_settings.suspend_data_limit, 100);
  assert.equal(draft(511.9).ui_settings.suspend_data_limit, 511);
  assert.equal(draft(-1).ui_settings.suspend_data_limit, -1);

  for (const value of [100, 511, -1, true]) {
    const validation = validateConfig(draft(value));
    assert.equal(validation.valid, false, `expected ${value} to be rejected`);
    assert.ok(
      validation.errors.some((error) => error.path === 'ui_settings.suspend_data_limit'),
      `expected a suspend_data_limit error for ${value}`,
    );
  }

  // The documented minimum is the boundary the export accepts.
  assert.equal(validateConfig(draft(512)).valid, true);
});

test('instruction steps drop nullish entries and stringify the rest', () => {
  const { config } = normalizeBuilderDraftConfig({
    instructions: { steps: [1, null, undefined, 'x', true, ''] },
  });
  assert.deepEqual(config.instructions.steps, ['1', 'x', 'true', '']);
});

test('blockly_setup numbers, lists and starting blocks are read defensively', () => {
  const setup = (raw) => normalizeBuilderDraftConfig({ blockly_setup: raw }).config.blockly_setup;

  assert.equal(setup({ max_blocks: '25' }).max_blocks, 25);
  assert.equal(setup({ max_blocks: 12.7 }).max_blocks, 12);
  assert.equal(setup({ max_blocks: 'many' }).max_blocks, null);
  assert.equal(setup({ max_blocks: 0 }).max_blocks, 0);
  assert.equal(setup({ max_blocks: null }).max_blocks, null);

  assert.deepEqual(setup({ disabled_blocks: ['text_print', '', '   ', 7, null] }).disabled_blocks, [
    'text_print',
  ]);
  assert.deepEqual(setup({ disabled_blocks: 'text_print' }).disabled_blocks, []);

  assert.equal(setup({ starting_blocks: [] }).starting_blocks, null);
  assert.equal(setup({ starting_blocks: 'blocks' }).starting_blocks, null);
  assert.deepEqual(setup({ starting_blocks: { blocks: {} } }).starting_blocks, { blocks: {} });
});

test('a section list that is not an array is treated as empty', () => {
  const { config: draft } = normalizeBuilderDraftConfig({
    hints: null,
    evaluation: { test_cases: {} },
    blockly_setup: { toolbox: { categories: 'text' } },
  });
  assert.deepEqual(draft.hints, []);
  assert.deepEqual(draft.evaluation.test_cases, []);
  assert.deepEqual(draft.blockly_setup.toolbox.categories, []);

  const { config: exported, omissions } = sanitizeConfigForExport({
    hints: 'text',
    evaluation: { test_cases: 5 },
    blockly_setup: { toolbox: { categories: null } },
  });
  assert.deepEqual(exported.hints, []);
  assert.deepEqual(exported.evaluation.test_cases, []);
  assert.deepEqual(exported.blockly_setup.toolbox.categories, []);
  assert.deepEqual(omissions, { categories: 0, hints: 0, tests: 0 });
});

test('toolbox categories default their colour by position, skipping non-objects', () => {
  const { config } = normalizeBuilderDraftConfig({
    blockly_setup: { toolbox: { categories: ['nope', null, {}, { name: 'Second' }] } },
  });
  const categories = config.blockly_setup.toolbox.categories;

  assert.equal(categories.length, 2);
  assert.deepEqual(
    categories.map((category) => category.name),
    ['Category 1', 'Second'],
  );
  assert.equal(categories[0].colour, getDefaultCategoryColour(0));
  assert.equal(categories[1].colour, getDefaultCategoryColour(1));
  assert.notEqual(categories[0].colour, categories[1].colour);

  const [first, second] = normalizeBuilderDraftConfig({
    blockly_setup: {
      toolbox: {
        categories: [
          { name: 'A', colour: '#000000', blocks: ['text_print', '', '  ', 7, null] },
          { name: 'B' },
        ],
      },
    },
  }).config.blockly_setup.toolbox.categories;

  assert.equal(first.colour, '#000000');
  assert.deepEqual(first.blocks, ['text_print']);
  // An explicit colour on an earlier category does not shift the default sequence.
  assert.equal(second.colour, getDefaultCategoryColour(1));
});

test('an incomplete category is dropped from the export and counted', () => {
  const { config, omissions } = sanitizeConfigForExport({
    blockly_setup: {
      toolbox: {
        categories: [
          { name: 'Kept', blocks: ['text_print'] },
          { name: 'Filtered', blocks: ['math_number', 7, '', '  ', null] },
          { name: '', blocks: ['text_print'] },
          { name: 'No blocks', blocks: [] },
          { name: 'Blank only', blocks: ['  '] },
          { blocks: ['text_print'] },
        ],
      },
    },
  });

  assert.deepEqual(config.blockly_setup.toolbox.categories, [
    { name: 'Kept', colour: getDefaultCategoryColour(0), blocks: ['text_print'] },
    { name: 'Filtered', colour: getDefaultCategoryColour(1), blocks: ['math_number'] },
  ]);
  assert.equal(omissions.categories, 4);

  // The draft keeps an unnamed category editable instead of dropping it.
  const { config: draft } = normalizeBuilderDraftConfig({
    blockly_setup: { toolbox: { categories: [{ blocks: ['text_print'] }] } },
  });
  assert.equal(draft.blockly_setup.toolbox.categories[0].name, 'Category 1');
});

test('exported categories, hints and tests carry only their known fields', () => {
  const { config } = sanitizeConfigForExport({
    blockly_setup: { toolbox: { categories: [{ name: 'A', blocks: ['text_print'], junk: 1 }] } },
    hints: [
      { id: 'h', message: 'm', trigger: { event: 'workspace_change', junk: 1 }, junk: 2 },
    ],
    evaluation: {
      test_cases: [
        {
          id: 't',
          type: 'stdout_match',
          points: 5,
          output_assertion: { enabled: true, expected: 'x' },
          junk: 3,
        },
      ],
    },
  });

  assert.deepEqual(keysOf(config.blockly_setup.toolbox.categories[0]), ['blocks', 'colour', 'name']);
  assert.deepEqual(keysOf(config.hints[0]), ['id', 'message', 'trigger']);
  assert.deepEqual(keysOf(config.hints[0].trigger), ['event']);
  assert.deepEqual(keysOf(config.evaluation.test_cases[0]), [
    'execution_context',
    'id',
    'output_assertion',
    'points',
    'prompt_assertion',
    'prompt_inputs',
    'strict_prompt_inputs',
    'type',
  ]);
});

test('a complete config exports unchanged with no omissions', () => {
  const { config, omissions } = sanitizeConfigForExport(activityConfig());
  assert.deepEqual(omissions, { categories: 0, hints: 0, tests: 0 });
  assert.equal(validateConfig(config).valid, true);
  assert.equal(config.metadata.activity_id, 'test_activity');
  assert.deepEqual(config.evaluation.test_cases.map((testCase) => testCase.id), ['test_print']);
  assert.equal(config.evaluation.test_cases[0].output_assertion.expected, 'hi\n');

  const pattern = sanitizeConfigForExport(blockPatternTestConfig(patternState()));
  assert.deepEqual(pattern.omissions, { categories: 0, hints: 0, tests: 0 });
  assert.equal(validateConfig(pattern.config).valid, true);
});

test('a draft hint fills in a usable trigger and per-index defaults', () => {
  const { config } = normalizeBuilderDraftConfig({
    hints: [
      null,
      {
        trigger: 'nope',
        message: 7,
        priority: 0,
        delay_seconds: -4,
        show_once: 'yes',
        style: '',
      },
    ],
  });

  assert.equal(config.hints.length, 1);
  const [hint] = config.hints;
  assert.equal(hint.id, 'hint_1'); // the index counts objects only
  assert.equal(hint.message, '');
  assert.equal(hint.trigger.event, 'workspace_change');
  assert.deepEqual(hint.trigger.conditions, { type: 'workspace_empty' });
  assert.equal(hint.trigger.after_attempts, 0);
  assert.equal(hint.trigger.invalidate_on_condition_false, false);
  assert.equal(hint.priority, 1); // a non-positive priority falls back to the position
  assert.equal(hint.delay_seconds, 0);
  assert.equal(hint.show_once, true);
  assert.equal(hint.style, undefined);

  const explicit = normalizeBuilderDraftConfig({
    hints: [
      {
        id: 'h9',
        trigger: {
          event: 'timed',
          after_attempts: 3,
          invalidate_on_condition_false: true,
        },
        priority: 4,
        delay_seconds: 2.9,
        show_once: false,
        style: 'warning',
      },
    ],
  }).config.hints[0];

  assert.equal(explicit.trigger.event, 'timed');
  assert.equal(explicit.trigger.after_attempts, 3);
  assert.equal(explicit.trigger.invalidate_on_condition_false, true);
  assert.equal(explicit.priority, 4);
  assert.equal(explicit.delay_seconds, 2);
  assert.equal(explicit.show_once, false);
  assert.equal(explicit.style, 'warning');

  const unknownEvent = normalizeBuilderDraftConfig({
    hints: [{ trigger: { event: 'on_load', after_attempts: 'lots' } }],
  }).config.hints[0];
  assert.equal(unknownEvent.trigger.event, 'workspace_change');
  assert.equal(unknownEvent.trigger.after_attempts, 0);

  // A blank id is kept for editing rather than replaced by the index default.
  assert.equal(normalizeBuilderDraftConfig({ hints: [{ id: '', message: 'm' }] }).config.hints[0].id, '');
});

test('legacy ui_settings.hint_display_mode seeds hints that never chose a mode', () => {
  const modes = (raw) => normalizeBuilderDraftConfig(raw).config.hints.map((hint) => hint.display_mode);

  assert.deepEqual(
    modes({
      ui_settings: { hint_display_mode: 'checklist' },
      hints: [
        { id: 'a', message: 'm' },
        { id: 'b', message: 'm', display_mode: 'triggered' },
        { id: 'c', message: 'm', display_mode: 'nope' },
      ],
    }),
    ['checklist', 'triggered', 'checklist'],
  );

  // Only the exact legacy value counts; anything else means the modern default.
  assert.deepEqual(
    modes({
      ui_settings: { hint_display_mode: 'bogus' },
      hints: [
        { id: 'a', message: 'm' },
        { id: 'b', message: 'm', display_mode: 'checklist' },
        { id: 'c', message: 'm', display_mode: 'nope' },
      ],
    }),
    ['triggered', 'checklist', 'triggered'],
  );
});

test('an export keeps an inherited display mode and omits an unset default one', () => {
  const { config } = sanitizeConfigForExport({
    ui_settings: { hint_display_mode: 'checklist' },
    hints: [
      { id: 'a', message: 'm', trigger: { event: 'workspace_change' } },
      { id: 'b', message: 'm', trigger: { event: 'manual' }, display_mode: 'triggered' },
    ],
  });
  assert.deepEqual(
    config.hints.map((hint) => hint.display_mode),
    ['checklist', 'triggered'],
  );

  const { config: plain, omissions } = sanitizeConfigForExport({
    hints: [{ id: 'a', message: 'm', trigger: { event: 'manual' } }],
  });
  assert.deepEqual(omissions, { categories: 0, hints: 0, tests: 0 });
  assert.equal('display_mode' in plain.hints[0], false);
  assert.equal('priority' in plain.hints[0], false);
  assert.equal('delay_seconds' in plain.hints[0], false);
  assert.equal('show_once' in plain.hints[0], false);
});

test('the legacy `regex` match mode becomes an anchored full match', () => {
  const fieldValue = draftCondition({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    match_mode: 'regex',
  });
  assert.equal(fieldValue.match_mode, 'regex_full');
  assert.equal(fieldValue.case_sensitive, true);
  assert.equal(fieldValue.regex_flags, '');

  const nested = draftCondition({
    type: 'block_nested',
    outer_type: 'text_print',
    inner_type: 'text',
    input_name: 'TEXT',
    field_name: 'TEXT',
    match_mode: 'regex',
    regex_flags: 'gi',
  });
  assert.equal(nested.match_mode, 'regex_full');
  assert.equal(nested.case_sensitive, false); // the i flag asks for a loose match
  assert.equal(nested.regex_flags, ''); // and neither g nor i is carried over

  // An explicit case sensitivity outranks the flag it was written alongside.
  const explicit = draftCondition({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    match_mode: 'regex',
    case_sensitive: true,
    regex_flags: 'i',
  });
  assert.equal(explicit.case_sensitive, true);

  const pattern = draftCondition({
    type: 'block_pattern',
    workspace_state: patternState(),
    field_constraints: { b1: { TEXT: { match_mode: 'regex', regex_flags: 'i' } } },
  });
  assert.equal(pattern.field_constraints.b1.TEXT.match_mode, 'regex_full');
  assert.equal(pattern.field_constraints.b1.TEXT.case_sensitive, false);

  const exported = exportCondition({
    type: 'block_field_value',
    block_type: 'text',
    field_name: 'TEXT',
    expected_value: 'x',
    match_mode: 'regex',
  });
  assert.equal(exported.testOmissions, 0);
  assert.equal(exported.conditions.match_mode, 'regex_full');
});

test('legacy condition fields are rebuilt into the canonical shape', () => {
  assert.deepEqual(
    draftCondition({ type: 'block_connected', upper_type: 5, lower_type: 'text_print', extra: 1 }),
    { type: 'block_connected', upper_type: '', lower_type: 'text_print' },
  );
  assert.deepEqual(draftCondition({ type: 'block_exists', block_type: 'text_print', min_count: 0 }), {
    type: 'block_exists',
    block_type: 'text_print',
    min_count: 1,
  });
  assert.deepEqual(draftCondition({ type: 'block_missing', block_type: 3 }), {
    type: 'block_missing',
    block_type: '',
  });
  assert.deepEqual(
    draftCondition({
      type: 'block_nested',
      outer_type: 'text_print',
      inner_type: 'text',
      input_name: 'TEXT',
    }),
    {
      type: 'block_nested',
      outer_type: 'text_print',
      inner_type: 'text',
      input_name: 'TEXT',
      match_mode: 'exact',
      case_sensitive: true,
      regex_flags: '',
    },
  );

  // A sibling value constraint is only carried when the author supplied one.
  const withoutValue = draftCondition({
    type: 'block_nested',
    outer_type: 'text_print',
    inner_type: 'text',
    input_name: 'TEXT',
  });
  assert.equal('field_name' in withoutValue, false);
  assert.equal('expected_value' in withoutValue, false);

  assert.equal(
    draftCondition({
      type: 'block_nested',
      outer_type: 'a',
      inner_type: 'b',
      input_name: 'i',
      field_name: 'f',
      expected_value: 3,
    }).expected_value,
    3, // numbers are kept as written
  );
  assert.equal(
    draftCondition({
      type: 'block_nested',
      outer_type: 'a',
      inner_type: 'b',
      input_name: 'i',
      field_name: 'f',
      expected_value: null,
    }).expected_value,
    '',
  );
  assert.equal(
    draftCondition({
      type: 'block_field_value',
      block_type: 'text',
      field_name: 'TEXT',
      expected_value: null,
    }).expected_value,
    '',
  );
});

test('an unrecognised condition type is neutralised in a draft but invalidates the export', () => {
  const raw = {
    hints: [
      {
        id: 'h',
        message: 'm',
        trigger: { event: 'workspace_change', conditions: { type: 'on_save' } },
      },
    ],
    evaluation: {
      test_cases: [{ id: 't', type: 'block_structure', points: 1, conditions: { type: 'on_save' } }],
    },
  };

  const { config: draft } = normalizeBuilderDraftConfig(raw);
  assert.deepEqual(draft.hints[0].trigger.conditions, { type: 'workspace_empty' });
  assert.deepEqual(draft.evaluation.test_cases[0].conditions, { type: 'workspace_empty' });
  assert.deepEqual(draftCondition('nope'), { type: 'workspace_empty' });
  assert.deepEqual(draftCondition(null), { type: 'workspace_empty' });

  const { config: exported, omissions } = sanitizeConfigForExport(raw);
  assert.deepEqual(exported.hints, []);
  assert.deepEqual(exported.evaluation.test_cases, []);
  assert.equal(omissions.hints, 1);
  assert.equal(omissions.tests, 1);

  // A condition that is not an object at all never validates.
  const { omissions: nullConditionOmissions } = sanitizeConfigForExport({
    evaluation: {
      test_cases: [{ id: 't', type: 'block_structure', points: 1, conditions: 'nope' }],
    },
  });
  assert.equal(nullConditionOmissions.tests, 1);
});

test('numeric condition bounds are clamped to their documented ranges', () => {
  assert.deepEqual(draftCondition({ type: 'block_count', block_type: 'text_print' }), {
    type: 'block_count',
    block_type: 'text_print',
    min: 0,
    max: 10,
  });
  assert.deepEqual(
    draftCondition({ type: 'block_count', block_type: 'text_print', min: -2, max: '3' }),
    { type: 'block_count', block_type: 'text_print', min: 0, max: 3 },
  );
  assert.deepEqual(
    draftCondition({ type: 'block_count', block_type: 'text_print', min: 7.8, max: 'lots' }),
    { type: 'block_count', block_type: 'text_print', min: 7, max: 10 },
  );

  assert.deepEqual(draftCondition({ type: 'workspace_connectedness', mode: 'all_active' }), {
    type: 'workspace_connectedness',
    mode: 'all_active',
  });
  assert.deepEqual(draftCondition({ type: 'workspace_connectedness', mode: 'bogus' }), {
    type: 'workspace_connectedness',
    mode: 'all_connected',
  });

  // The export leaves untouched bounds untouched rather than inventing them.
  const exported = exportCondition({ type: 'block_count', block_type: 'text_print' });
  assert.equal(exported.testOmissions, 0);
  assert.deepEqual(exported.conditions, { type: 'block_count', block_type: 'text_print' });
});

test('a composite condition never keeps an empty or unusable child list', () => {
  assert.deepEqual(draftCondition({ type: 'all', conditions: [] }), {
    type: 'all',
    conditions: [{ type: 'workspace_empty' }],
  });
  assert.deepEqual(draftCondition({ type: 'none', conditions: 'junk' }), {
    type: 'none',
    conditions: [{ type: 'workspace_empty' }],
  });
  assert.deepEqual(
    draftCondition({
      type: 'any',
      conditions: [null, { type: 'bogus' }, { type: 'block_exists', block_type: 'text_print' }],
    }),
    {
      type: 'any',
      conditions: [
        { type: 'workspace_empty' },
        { type: 'block_exists', block_type: 'text_print', min_count: 1 },
      ],
    },
  );

  // The export does not paper over an empty child list: the test is dropped.
  const empty = exportCondition({ type: 'all', conditions: [] });
  assert.equal(empty.conditions, undefined);
  assert.equal(empty.testOmissions, 1);

  const bogusChild = exportCondition({
    type: 'any',
    conditions: [{ type: 'workspace_empty' }, { type: 'on_save' }],
  });
  assert.equal(bogusChild.conditions, undefined);
  assert.equal(bogusChild.testOmissions, 1);
});

test('a pattern condition keeps its workspace state only when it is an object', () => {
  assert.equal(draftCondition({ type: 'block_pattern' }).workspace_state, null);
  assert.equal(
    draftCondition({ type: 'block_pattern', workspace_state: [] }).workspace_state,
    null,
  );
  assert.equal(
    draftCondition({ type: 'block_pattern', workspace_state: 'saved' }).workspace_state,
    null,
  );
  assert.deepEqual(
    draftCondition({ type: 'block_pattern', workspace_state: patternState() }).workspace_state,
    patternState(),
  );

  // Without a saved pattern the export cannot keep the test.
  const missing = exportCondition({ type: 'block_pattern' });
  assert.equal(missing.conditions, undefined);
  assert.equal(missing.testOmissions, 1);
});

test('empty or unusable pattern constraint maps never reach the export', () => {
  const dropped = exportCondition({
    type: 'block_pattern',
    workspace_state: patternState(),
    field_constraints: { b1: 'not an object', b2: { TEXT: 'neither is this' } },
    param_constraints: 'nope',
  });
  assert.equal(dropped.testOmissions, 0);
  assert.deepEqual(dropped.conditions, {
    type: 'block_pattern',
    workspace_state: patternState(),
  });

  const kept = exportCondition({
    type: 'block_pattern',
    workspace_state: patternState(),
    field_constraints: {
      b1: { TEXT: { expected_value: 'hi', match_mode: 'regex', regex_flags: 'i' } },
    },
  });
  assert.equal(kept.testOmissions, 0);
  assert.deepEqual(kept.conditions, {
    type: 'block_pattern',
    workspace_state: patternState(),
    field_constraints: {
      b1: {
        TEXT: {
          expected_value: 'hi',
          match_mode: 'regex_full',
          case_sensitive: false,
          regex_flags: '',
        },
      },
    },
  });

  const draft = draftCondition({
    type: 'block_pattern',
    workspace_state: patternState(),
    field_constraints: { b1: { TEXT: 'nope' } },
    param_constraints: { b1: { count: -3, comparison: 'nope' } },
  });
  assert.deepEqual(draft.field_constraints, {});
  assert.deepEqual(draft.param_constraints, { b1: { count: 0, comparison: 'equals' } });

  // A parameter-count constraint survives against a real procedure call root.
  const procedureState = blockState([
    { type: 'procedures_callnoreturn', id: 'p1', extraState: { name: 'doSomething' } },
  ]);
  const params = exportCondition({
    type: 'block_pattern',
    workspace_state: procedureState,
    param_constraints: { p1: { count: '2', comparison: 'not a comparison' } },
  });
  assert.equal(params.testOmissions, 0);
  assert.deepEqual(params.conditions, {
    type: 'block_pattern',
    workspace_state: procedureState,
    param_constraints: { p1: { count: 2, comparison: 'equals' } },
  });
});

test('legacy stdout fields are folded into assertions, and function context only survives when used', () => {
  const { config } = normalizeBuilderDraftConfig({
    evaluation: {
      test_cases: [
        {
          id: 't',
          type: 'stdout_match',
          expected_output: 'hi',
          match_mode: 'contains',
          prompt_inputs: [1, true],
          strict_prompt_inputs: false,
        },
      ],
    },
  });
  const [testCase] = config.evaluation.test_cases;

  assert.deepEqual(testCase.prompt_inputs, ['1', 'true']);
  assert.equal(testCase.strict_prompt_inputs, false);
  assert.equal(testCase.output_assertion.enabled, true);
  assert.equal(testCase.output_assertion.expected, 'hi');
  assert.equal(testCase.output_assertion.match_mode, 'contains');
  assert.equal(testCase.prompt_assertion.enabled, false);
  assert.deepEqual(testCase.execution_context, { scope: 'main' });
  assert.equal('expected_output' in testCase, false);
  assert.equal('match_mode' in testCase, false);

  const { config: exported } = sanitizeConfigForExport({
    evaluation: {
      test_cases: [
        {
          id: 't',
          type: 'stdout_match',
          points: 1,
          output_assertion: { enabled: true, expected: 'x' },
          execution_context: { scope: 'function', function_name: 'greet' },
        },
      ],
    },
  });
  assert.deepEqual(exported.evaluation.test_cases[0].execution_context, {
    scope: 'function',
    function_name: 'greet',
    arguments: [],
  });

  const { config: mainScoped } = sanitizeConfigForExport({
    evaluation: {
      test_cases: [
        {
          id: 't',
          type: 'stdout_match',
          points: 1,
          output_assertion: { enabled: true, expected: 'x' },
          execution_context: { scope: 'main' },
        },
      ],
    },
  });
  assert.deepEqual(mainScoped.evaluation.test_cases[0].execution_context, { scope: 'main' });
});

test('a legacy test weight becomes points and is never retained', () => {
  const withPoints = (raw) =>
    normalizeBuilderDraftConfig({ evaluation: { test_cases: [raw] } }).config.evaluation
      .test_cases[0];

  const assertion = { enabled: true, expected: 'x' };
  assert.equal(withPoints({ type: 'stdout_match', weight: 7, output_assertion: assertion }).points, 7);
  assert.equal(
    withPoints({ type: 'stdout_match', weight: '3', output_assertion: assertion }).points,
    3,
  );
  assert.equal(
    withPoints({ type: 'stdout_match', weight: 2.9, output_assertion: assertion }).points,
    2,
  );
  assert.equal(
    withPoints({ type: 'stdout_match', weight: -4, output_assertion: assertion }).points,
    0,
  );
  assert.equal(
    withPoints({ type: 'stdout_match', weight: 'lots', output_assertion: assertion }).points,
    0,
  );
  // An explicit points value wins over a legacy weight.
  assert.equal(
    withPoints({ type: 'stdout_match', points: 2, weight: 9, output_assertion: assertion }).points,
    2,
  );
  // A null points value defers to the weight, an absent one also does.
  assert.equal(
    withPoints({ type: 'stdout_match', points: null, weight: 5, output_assertion: assertion }).points,
    5,
  );
  assert.equal(
    'weight' in withPoints({ type: 'stdout_match', weight: 5, output_assertion: assertion }),
    false,
  );

  const { config: exported } = sanitizeConfigForExport({
    evaluation: {
      test_cases: [{ id: 't', type: 'stdout_match', weight: 6, output_assertion: assertion }],
    },
  });
  assert.equal(exported.evaluation.test_cases[0].points, 6);
  assert.equal('weight' in exported.evaluation.test_cases[0], false);
  assert.equal(validateConfig(exported).valid, true);
});

test('each incomplete category, hint and test is dropped once and counted', () => {
  const { config, omissions } = sanitizeConfigForExport({
    blockly_setup: {
      toolbox: {
        categories: [
          { name: 'Good', blocks: ['text_print'] },
          { name: 'Missing blocks', blocks: [] },
          { blocks: ['text_print'] },
        ],
      },
    },
    hints: [
      { id: 'hint_ok', message: 'kept', trigger: { event: 'workspace_change' } },
      { id: '', message: 'no id', trigger: { event: 'workspace_change' } },
      { id: 'no_message', message: '   ', trigger: { event: 'workspace_change' } },
      { id: 'no_trigger', message: 'x' },
      { id: 'bad_event', message: 'x', trigger: { event: 'on_save' } },
    ],
    evaluation: {
      test_cases: [
        {
          id: 'test_ok',
          type: 'stdout_match',
          points: 5,
          output_assertion: { enabled: true, expected: 'hi\n' },
        },
        { id: '', type: 'stdout_match', points: 5, output_assertion: { enabled: true, expected: 'hi\n' } },
        { id: 'unknown_type', type: 'quiz', points: 5 },
        { id: 'no_assertion', type: 'stdout_match', points: 5 },
        { id: 'no_conditions', type: 'block_structure', points: 5 },
      ],
    },
  });

  assert.equal(omissions.categories, 2);
  assert.equal(omissions.hints, 4);
  assert.equal(omissions.tests, 4);
  assert.deepEqual(
    config.blockly_setup.toolbox.categories.map((category) => category.name),
    ['Good'],
  );
  assert.deepEqual(
    config.hints.map((hint) => hint.id),
    ['hint_ok'],
  );
  assert.deepEqual(
    config.evaluation.test_cases.map((testCase) => testCase.id),
    ['test_ok'],
  );

  // What survives the omissions is a config the export validator accepts.
  assert.equal(validateConfig(config).valid, true);
});

test('an incomplete hint condition drops the hint rather than shipping a broken trigger', () => {
  const { config, omissions } = sanitizeConfigForExport({
    hints: [
      {
        id: 'h',
        message: 'm',
        trigger: { event: 'workspace_change', conditions: { type: 'block_pattern' } },
      },
    ],
  });
  assert.deepEqual(config.hints, []);
  assert.equal(omissions.hints, 1);
});

test('normalising an already normalised config changes nothing', () => {
  const once = normalizeBuilderDraftConfig(richConfig()).config;
  assert.deepEqual(normalizeBuilderDraftConfig(once).config, once);
  assert.deepEqual(normalizeBuilderDraftConfig(normalizeBuilderDraftConfig(once).config).config, once);

  const exported = sanitizeConfigForExport(richConfig());
  const again = sanitizeConfigForExport(exported.config);
  assert.deepEqual(again.config, exported.config);
  // Everything that survived the first pass is publishable, so nothing drops.
  assert.deepEqual(again.omissions, { categories: 0, hints: 0, tests: 0 });
  assert.deepEqual(exported.omissions, { categories: 0, hints: 0, tests: 0 });
});

test('normalising never mutates or shares the caller config', () => {
  const raw = deepFreeze(richConfig());
  const snapshot = JSON.parse(JSON.stringify(raw));

  const draft = normalizeBuilderDraftConfig(raw).config;
  assert.deepEqual(JSON.parse(JSON.stringify(raw)), snapshot);

  const exported = sanitizeConfigForExport(raw);
  assert.deepEqual(JSON.parse(JSON.stringify(raw)), snapshot);

  // The results are detached copies: writing to them cannot reach the input.
  draft.metadata.title = 'changed';
  draft.blockly_setup.starting_blocks.blocks.added = true;
  exported.config.ui_settings.theme = 'changed';
  assert.deepEqual(JSON.parse(JSON.stringify(raw)), snapshot);
});

test('the SCORM alias produces exactly the export payload', () => {
  const viaExport = sanitizeConfigForExport(richConfig());
  const viaScorm = sanitizeConfigForScorm(richConfig());
  assert.deepEqual(viaScorm.config, viaExport.config);
  assert.deepEqual(viaScorm.omissions, viaExport.omissions);

  assert.deepEqual(sanitizeConfigForScorm({}).omissions, { categories: 0, hints: 0, tests: 0 });
});
