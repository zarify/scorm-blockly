/**
 * Tests Tab — Test case builder with type-specific editors.
 */

import { getConfig, notifyChange, onConfigChange, Blockly } from './builder-app.js';
import { BLOCK_PATTERN_TYPE } from '../../shared/block-pattern.js';
import {
  FIELD_VALUE_MATCH_MODE_OPTIONS,
  getCanonicalRegexFlags,
  isRegexFieldValueMatchMode,
  normalizeFieldValueCaseSensitivity,
  normalizeFieldValueMatchMode,
} from '../../shared/field-value-matching.js';
import {
  createConditionSuggestionIds,
  getConditionBlockDefinitionMetadata,
  getSuggestedConditionBlockTypes,
} from './condition-suggestions.js';
import { renderPatternBuilder } from './pattern-builder.js';
import {
  formatPromptInputs,
  getPromptInputs,
  getVariableListAssertions,
  getStdoutOutputAssertion,
  getStdoutPromptAssertion,
  getTestPoints,
  normalizeVariableType,
  normalizeVariableValueAssertionEnabled,
  parsePromptInputs,
  setTestPoints,
  VALID_VARIABLE_TYPES,
} from '../../shared/test-config.js';

let selectedTestIndex = -1;
let suppressSelectedTestEditorSync = false;
let draggedTestIndex = null;

const TEST_TYPES = [
  { value: 'stdout_match', label: 'Output/prompt text check' },
  { value: 'block_structure', label: 'Block structure check' },
  { value: 'variable_state', label: 'Variable/list state check' },
];

const MATCH_MODES = [
  { value: 'exact', label: 'Exact match' },
  { value: 'contains', label: 'Contains' },
  { value: 'regex', label: 'Regex' },
];

const COMPARISONS = [
  { value: 'equals', label: 'Equals (==)' },
  { value: 'gt', label: 'Greater than (>)' },
  { value: 'lt', label: 'Less than (<)' },
  { value: 'gte', label: 'Greater or equal (>=)' },
  { value: 'lte', label: 'Less or equal (<=)' },
  { value: 'contains', label: 'Contains (string)' },
  { value: 'type', label: 'Type check (typeof)' },
];

const VARIABLE_TYPES = VALID_VARIABLE_TYPES.map((value) => ({
  value,
  label: ({
    any: 'Any / don\'t check type',
    int: 'Integer',
    float: 'Float',
    string: 'String',
    list: 'List',
  })[value] || value,
}));

const LIST_LENGTH_COMPARISONS = [
  { value: 'equals', label: 'Length equals' },
  { value: 'gt', label: 'Length greater than' },
  { value: 'lt', label: 'Length less than' },
  { value: 'gte', label: 'Length greater or equal' },
  { value: 'lte', label: 'Length less or equal' },
];

const LIST_VALUE_MATCH_MODES = [
  { value: 'exact_order', label: 'Exact values in exact order' },
  { value: 'same_values_any_order', label: 'Exact values in any order' },
  { value: 'expected_subset_of_actual', label: 'Expected values are a subset of the student list' },
  { value: 'expected_superset_of_actual', label: 'Expected values are a superset of the student list' },
];

const LIST_ITEM_TYPE_MODES = [
  { value: 'all', label: 'All items match one of these types' },
  { value: 'some', label: 'At least one item matches one of these types' },
  { value: 'none', label: 'No items match any of these types' },
];

export function initTestsTab() {
  document.getElementById('btn-add-test').addEventListener('click', addTest);
  onConfigChange(() => {
    renderTestList();
    updateWeightIndicator();
    if (selectedTestIndex >= 0 && !suppressSelectedTestEditorSync) renderTestEditor();
  });
  renderTestList();
  updateWeightIndicator();
}

function addTest() {
  const cfg = getConfig();
  const id = `test_${Date.now().toString(36)}`;
  cfg.evaluation.test_cases.push({
    id,
    type: 'stdout_match',
    prompt_inputs: [],
    strict_prompt_inputs: true,
    output_assertion: {
      enabled: true,
      expected: '',
      match_mode: 'exact',
      show_expected: false,
      show_actual: false,
      success_message: '',
      failure_message: '',
    },
    prompt_assertion: {
      enabled: false,
      expected: '',
      match_mode: 'exact',
      show_expected: false,
      show_actual: false,
      success_message: '',
      failure_message: '',
    },
    points: 1,
    feedback_on_pass: '',
    feedback_on_fail: '',
  });

  selectedTestIndex = cfg.evaluation.test_cases.length - 1;
  emitLocalTestChange();
  renderTestList();
  renderTestEditor();
  updateWeightIndicator();
}

function removeTest(index) {
  const cfg = getConfig();
  cfg.evaluation.test_cases.splice(index, 1);
  if (selectedTestIndex >= cfg.evaluation.test_cases.length) {
    selectedTestIndex = cfg.evaluation.test_cases.length - 1;
  }
  emitLocalTestChange();
  renderTestList();
  renderTestEditor();
  updateWeightIndicator();
}

function renderTestList() {
  const container = document.getElementById('test-list');
  const tests = getConfig().evaluation.test_cases;

  container.innerHTML = tests.map((tc, i) => `
    <div class="list-item test-list-item ${i === selectedTestIndex ? 'selected' : ''}" data-index="${i}" draggable="true">
      <span class="list-item-title">
        <strong>${tc.type}</strong> — ${tc.id} (${formatPointsLabel(getTestPoints(tc))})
      </span>
      <button class="list-item-remove" data-index="${i}" title="Remove test">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.list-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      selectedTestIndex = parseInt(el.dataset.index);
      renderTestList();
      renderTestEditor();
    });
  });

  container.querySelectorAll('.test-list-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      draggedTestIndex = parseInt(el.dataset.index, 10);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(draggedTestIndex));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedTestIndex === null) return;
      const { before } = getDropPlacement(el, e.clientY);
      el.classList.toggle('drag-over-before', before);
      el.classList.toggle('drag-over-after', !before);
    });
    el.addEventListener('dragleave', () => {
      clearDropIndicator(el);
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedTestIndex === null) return;
      const targetIndex = parseInt(el.dataset.index, 10);
      const { before } = getDropPlacement(el, e.clientY);
      moveTest(draggedTestIndex, targetIndex, before ? 'before' : 'after');
      draggedTestIndex = null;
    });
    el.addEventListener('dragend', () => {
      draggedTestIndex = null;
      clearAllDropIndicators(container);
      el.classList.remove('dragging');
    });
  });

  container.querySelectorAll('.list-item-remove').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTest(parseInt(el.dataset.index));
    });
  });
}

function moveTest(fromIndex, targetIndex, position) {
  const tests = getConfig().evaluation.test_cases;
  if (
    !Array.isArray(tests)
    || fromIndex < 0
    || targetIndex < 0
    || fromIndex >= tests.length
    || targetIndex >= tests.length
  ) {
    return;
  }
  if (fromIndex === targetIndex) {
    renderTestList();
    return;
  }

  const [moved] = tests.splice(fromIndex, 1);
  let insertIndex = targetIndex;
  if (fromIndex < targetIndex) {
    insertIndex -= 1;
  }
  if (position === 'after') {
    insertIndex += 1;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, tests.length));
  tests.splice(insertIndex, 0, moved);

  if (selectedTestIndex === fromIndex) {
    selectedTestIndex = insertIndex;
  } else if (fromIndex < selectedTestIndex && insertIndex >= selectedTestIndex) {
    selectedTestIndex -= 1;
  } else if (fromIndex > selectedTestIndex && insertIndex <= selectedTestIndex) {
    selectedTestIndex += 1;
  }

  emitLocalTestChange();
  renderTestList();
  renderTestEditor();
}

function getDropPlacement(element, pointerY) {
  const rect = element.getBoundingClientRect();
  return { before: pointerY < rect.top + rect.height / 2 };
}

function clearDropIndicator(element) {
  element.classList.remove('drag-over-before', 'drag-over-after');
}

function clearAllDropIndicators(container) {
  container.querySelectorAll('.test-list-item').forEach((element) => {
    clearDropIndicator(element);
    element.classList.remove('dragging');
  });
}

function renderTestEditor() {
  const container = document.getElementById('test-editor-content');
  const tests = getConfig().evaluation.test_cases;

  if (selectedTestIndex < 0 || selectedTestIndex >= tests.length) {
    container.innerHTML = '<p class="placeholder-text">Select a test case to edit, or add a new one.</p>';
    return;
  }

  const tc = tests[selectedTestIndex];
  const successHelp = tc.type === 'stdout_match'
    ? '<small>Shown when the whole test passes. For prompt/output checks, this overrides assertion-specific success messages.</small>'
    : '';
  const failureLabel = tc.type === 'stdout_match' ? 'Fallback feedback on fail' : 'Feedback on fail';
  const failureHelp = tc.type === 'stdout_match'
    ? '<small>Shown only when the enabled prompt/output checks do not provide their own failure message.</small>'
    : '';

  let html = `
    <div class="form-group">
      <label>Test ID</label>
      <input type="text" id="test-id" value="${escapeAttr(tc.id)}">
    </div>
    <div class="form-group">
      <label>Type</label>
      <select id="test-type">
        ${TEST_TYPES.map((t) => `<option value="${t.value}" ${tc.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
    </div>
    <div id="test-type-fields"></div>
    <div class="form-group">
      <label>Points</label>
      <input type="number" id="test-points" min="0" step="1" value="${getTestPoints(tc)}">
      <small>Integer points awarded when this test passes.</small>
    </div>
    <div class="form-group">
      <label>Feedback on pass</label>
      <textarea id="test-feedback-pass" rows="2" placeholder="Message shown to student when this test passes">${escapeHtml(tc.feedback_on_pass || '')}</textarea>
      ${successHelp}
    </div>
    <div class="form-group">
      <label>${failureLabel}</label>
      <textarea id="test-feedback" rows="2" placeholder="Message shown to student when this test fails">${escapeHtml(tc.feedback_on_fail || '')}</textarea>
      ${failureHelp}
    </div>
  `;

  container.innerHTML = html;

  // Render type-specific fields
  renderTestTypeFields(tc);

  // Bind common fields
  bindField('test-id', (v) => { tc.id = v; });
  bindField('test-type', (v) => {
    // Reset type-specific fields
    const newTc = {
      id: tc.id,
      type: v,
      points: getTestPoints(tc),
      feedback_on_pass: tc.feedback_on_pass,
      feedback_on_fail: tc.feedback_on_fail,
    };
    const bindCheckbox = (selector, field) => {
      const el = container.querySelector(selector);
      if (el) {
        el.addEventListener('change', (e) => {
          condition[field] = e.target.checked;
          onChange(condition, { rerenderBuilder: false });
        });
      }
    };
    if (v === 'stdout_match') {
      newTc.prompt_inputs = getPromptInputs(tc);
      newTc.strict_prompt_inputs = true;
      newTc.output_assertion = {
        enabled: true,
        expected: '',
        match_mode: 'exact',
        show_expected: false,
        show_actual: false,
        success_message: '',
        failure_message: '',
      };
      newTc.prompt_assertion = {
        enabled: false,
        expected: '',
        match_mode: 'exact',
        show_expected: false,
        show_actual: false,
        success_message: '',
        failure_message: '',
      };
    } else if (v === 'block_structure') {
      newTc.conditions = { type: 'workspace_empty' };
    } else if (v === 'variable_state') {
      newTc.prompt_inputs = getPromptInputs(tc);
      newTc.strict_prompt_inputs = true;
      newTc.variable_name = '';
      newTc.expected_type = 'any';
      newTc.value_assertion_enabled = true;
      newTc.expected_value = '';
      newTc.comparison = 'equals';
      newTc.show_coerced_value_hint = false;
      newTc.list_assertions = {
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
      };
    }
    Object.assign(tc, newTc);
    // Clean up old fields
    Object.keys(tc).forEach((k) => {
      if (!(k in newTc)) delete tc[k];
    });
    emitLocalTestChange();
    renderTestEditor();
    renderTestList();
  });

  const pointsInput = document.getElementById('test-points');
  pointsInput.addEventListener('input', (e) => {
    setTestPoints(tc, e.target.value);
    emitLocalTestChange();
    updateWeightIndicator();
    renderTestList();
  });

  bindField('test-feedback-pass', (v) => { tc.feedback_on_pass = v; });
  bindField('test-feedback', (v) => { tc.feedback_on_fail = v; });
}

function renderTestTypeFields(tc) {
  const container = document.getElementById('test-type-fields');
  let html = '';

  switch (tc.type) {
    case 'stdout_match': {
      tc.output_assertion = getStdoutOutputAssertion(tc, { defaultEnabled: true });
      tc.prompt_assertion = getStdoutPromptAssertion(tc);

      html = `
        <div class="form-group">
          <label>Prompt inputs</label>
          <textarea id="test-prompt-inputs" rows="3" placeholder="One prompt() response per line">${escapeHtml(formatPromptInputs(getPromptInputs(tc)))}</textarea>
          <small>Returned to <code>window.prompt()</code> in order. Use the option below to decide whether extra or missing prompt() calls should fail the test.</small>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="test-strict-prompt-inputs" ${tc.strict_prompt_inputs !== false ? 'checked' : ''}>
            Fail if the number of prompt inputs used does not match exactly
          </label>
          <small>Turn this off when you want to test prompt/output text in isolation without depending on the student program's full prompt structure.</small>
        </div>
        ${renderRuntimeTextAssertionEditor({
          prefix: 'test-output',
          title: 'Console output',
          assertion: tc.output_assertion,
          expectedLabel: 'Expected output',
          expectedPlaceholder: 'Expected console output',
          helpText: 'Use actual newlines — each line of expected output on its own line. A trailing newline is added automatically by print blocks.',
          showExpectedLabel: 'Show expected output when this check fails',
          showActualLabel: 'Show actual output when this check fails',
        })}
        ${renderRuntimeTextAssertionEditor({
          prefix: 'test-prompt',
          title: 'Prompt text',
          assertion: tc.prompt_assertion,
          expectedLabel: 'Expected prompt text',
          expectedPlaceholder: 'One prompt message per line',
          helpText: 'Matches the text passed to <code>window.prompt()</code> in order, joined with newlines. A single prompt like <code>prompt("Knock knock")</code> is entered exactly as <code>Knock knock</code>.',
          matchAnyItemLabel: 'Match any single prompt instead of the combined prompt transcript',
          showExpectedLabel: 'Show expected prompt text when this check fails',
          showActualLabel: 'Show actual prompt text when this check fails',
        })}
      `;
      break;
    }

    case 'block_structure':
      html = `
        <div class="form-group">
          <label>Condition</label>
          <div id="test-condition-builder"></div>
          <small>Block suggestions come from the saved Workspace blocks and the configured toolbox.</small>
        </div>
      `;
      break;

    case 'variable_state':
      tc.expected_type = normalizeVariableType(tc.expected_type);
      tc.value_assertion_enabled = normalizeVariableValueAssertionEnabled(tc);
      tc.show_coerced_value_hint = Boolean(tc.show_coerced_value_hint);
      tc.list_assertions = getVariableListAssertions(tc);

      html = `
        <div class="form-group">
          <label>Prompt inputs</label>
          <textarea id="test-prompt-inputs" rows="3" placeholder="One prompt() response per line">${escapeHtml(formatPromptInputs(getPromptInputs(tc)))}</textarea>
          <small>Returned to <code>window.prompt()</code> in order before variable assertions run. Use the option below to decide whether extra or missing prompt() calls should fail the test.</small>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="test-strict-prompt-inputs" ${tc.strict_prompt_inputs !== false ? 'checked' : ''}>
            Fail if the number of prompt inputs used does not match exactly
          </label>
          <small>Turn this off when you want to inspect later prompts or values without depending on the full prompt count.</small>
        </div>
        <div class="form-group">
          <label>Variable name</label>
          <input type="text" id="test-var-name" value="${escapeAttr(tc.variable_name || '')}" placeholder="e.g. count">
        </div>
        <div class="form-group">
          <label>Expected type</label>
          <select id="test-var-type">
            ${VARIABLE_TYPES.map((option) => `<option value="${option.value}" ${tc.expected_type === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
          <small>Use this for explicit type checks such as integer vs string, float, or list.</small>
        </div>
        ${tc.expected_type !== 'list' ? `
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="test-var-value-enabled" ${tc.value_assertion_enabled ? 'checked' : ''}>
            Verify the variable value
          </label>
        </div>
        <fieldset id="test-var-value-fields" ${tc.value_assertion_enabled ? '' : 'disabled'} style="border:1px solid #ddd;border-radius:6px;padding:12px;margin:0 0 12px">
          <legend style="padding:0 6px;font-weight:600">Scalar value assertion</legend>
          <div class="form-group">
            <label>Expected value</label>
            <input type="text" id="test-var-expected" value="${escapeAttr(formatScalarExpectedValue(tc.expected_value))}" placeholder="${escapeAttr(getScalarValuePlaceholder(tc.expected_type, tc.comparison))}">
            <small>${getScalarValueHelpText(tc.expected_type, tc.comparison)}</small>
          </div>
          <div class="form-group">
            <label>Comparison</label>
            <select id="test-var-comparison">
              ${COMPARISONS.map((c) => `<option value="${c.value}" ${(tc.comparison || 'equals') === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="test-var-coercion-hint" ${tc.show_coerced_value_hint ? 'checked' : ''}>
              Show a hint when the coerced value matches but the type is wrong
            </label>
          </div>
        </fieldset>
        ` : `
        <div class="form-group">
          <small>List variables can be checked by length, list contents, item types, and specific index checks. Leave every list assertion disabled if you only want to assert that the variable is a list.</small>
        </div>
        <fieldset style="border:1px solid #ddd;border-radius:6px;padding:12px;margin:0 0 12px">
          <legend style="padding:0 6px;font-weight:600">List assertions</legend>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="test-list-length-enabled" ${tc.list_assertions.length_enabled ? 'checked' : ''}>
              Verify list length
            </label>
            <div style="display:flex;gap:8px;margin-top:8px">
              <select id="test-list-length-comparison" ${tc.list_assertions.length_enabled ? '' : 'disabled'} style="flex:1">
                ${LIST_LENGTH_COMPARISONS.map((option) => `<option value="${option.value}" ${tc.list_assertions.length_comparison === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
              </select>
              <input type="number" id="test-list-length-value" min="0" value="${tc.list_assertions.length_value}" ${tc.list_assertions.length_enabled ? '' : 'disabled'} style="flex:1">
            </div>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="test-list-values-enabled" ${tc.list_assertions.values_enabled ? 'checked' : ''}>
              Verify list values
            </label>
            <select id="test-list-values-mode" ${tc.list_assertions.values_enabled ? '' : 'disabled'} style="margin-top:8px">
              ${LIST_VALUE_MATCH_MODES.map((option) => `<option value="${option.value}" ${tc.list_assertions.values_match_mode === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
            <textarea id="test-list-values" rows="4" placeholder='One expected list item per line. Use JSON for numbers, strings, booleans, nested lists, or objects.' ${tc.list_assertions.values_enabled ? '' : 'disabled'}>${escapeHtml(formatStructuredValueList(tc.list_assertions.expected_values))}</textarea>
            <small>Examples: <code>1</code>, <code>"cow"</code>, <code>[1,2]</code>. Plain unquoted text is treated as a string.</small>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="test-list-item-types-enabled" ${tc.list_assertions.item_types_enabled ? 'checked' : ''}>
              Verify item types
            </label>
            <select id="test-list-item-types-mode" ${tc.list_assertions.item_types_enabled ? '' : 'disabled'} style="margin-top:8px">
              ${LIST_ITEM_TYPE_MODES.map((option) => `<option value="${option.value}" ${tc.list_assertions.item_type_mode === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
            <input type="text" id="test-list-item-types" value="${escapeAttr(formatTypeList(tc.list_assertions.expected_item_types))}" placeholder="int, string" ${tc.list_assertions.item_types_enabled ? '' : 'disabled'}>
            <small>Allowed item types: int, float, string, list.</small>
          </div>
          <div class="form-group">
            <label>Specific index checks</label>
            <textarea id="test-list-index-checks" rows="4" placeholder='One JSON object per line, e.g. {"index":0,"expected_value":"cow"} or {"index":1,"expected_type":"int"}'>${escapeHtml(formatIndexChecks(tc.list_assertions.index_checks))}</textarea>
            <small>Use this to assert values or types at specific list indexes. Leave blank to skip index-based checks.</small>
          </div>
        </fieldset>
        `}
      `;
      break;
  }

  container.innerHTML = html;

  // Bind type-specific fields
  switch (tc.type) {
    case 'stdout_match':
      bindField('test-prompt-inputs', (v) => { tc.prompt_inputs = parsePromptInputs(v); });
      bindCheckedField('test-strict-prompt-inputs', (checked) => { tc.strict_prompt_inputs = checked; });
      bindRuntimeTextAssertionFields('test-output', tc.output_assertion);
      bindRuntimeTextAssertionFields('test-prompt', tc.prompt_assertion);
      break;

    case 'block_structure':
      // Reuse condition builder from hints tab
      const builderDiv = document.getElementById('test-condition-builder');
      if (builderDiv) {
        const handleConditionChange = (newCond, options = {}) => {
          tc.conditions = newCond;
          emitLocalTestChange();
          if (options.rerenderBuilder) {
            renderConditionBuilder(builderDiv, tc.conditions, handleConditionChange);
          }
        };
        renderConditionBuilder(builderDiv, tc.conditions || { type: 'workspace_empty' }, handleConditionChange);
      }
      break;

    case 'variable_state':
      bindField('test-prompt-inputs', (v) => { tc.prompt_inputs = parsePromptInputs(v); });
      bindCheckedField('test-strict-prompt-inputs', (checked) => { tc.strict_prompt_inputs = checked; });
      bindField('test-var-name', (v) => { tc.variable_name = v; });
      bindField('test-var-type', (v) => {
        tc.expected_type = v;
        if (v === 'list') {
          tc.value_assertion_enabled = false;
        }
        renderTestEditor();
      });
      if (tc.expected_type !== 'list') {
        bindCheckedField('test-var-value-enabled', (checked) => {
          tc.value_assertion_enabled = checked;
          const fieldset = document.getElementById('test-var-value-fields');
          if (fieldset) fieldset.disabled = !checked;
        });
        bindField('test-var-expected', (v) => {
          tc.expected_value = parseScalarExpectedValue(v, tc.expected_type, tc.comparison);
        });
        bindField('test-var-comparison', (v) => {
          tc.comparison = v;
          renderTestEditor();
        });
        bindCheckedField('test-var-coercion-hint', (checked) => {
          tc.show_coerced_value_hint = checked;
        });
      } else {
        bindCheckedField('test-list-length-enabled', (checked) => {
          tc.list_assertions.length_enabled = checked;
          toggleDisabledState('test-list-length-comparison', !checked);
          toggleDisabledState('test-list-length-value', !checked);
        });
        bindField('test-list-length-comparison', (v) => { tc.list_assertions.length_comparison = v; });
        bindField('test-list-length-value', (v) => { tc.list_assertions.length_value = Math.max(0, parseInt(v, 10) || 0); });
        bindCheckedField('test-list-values-enabled', (checked) => {
          tc.list_assertions.values_enabled = checked;
          toggleDisabledState('test-list-values-mode', !checked);
          toggleDisabledState('test-list-values', !checked);
        });
        bindField('test-list-values-mode', (v) => { tc.list_assertions.values_match_mode = v; });
        bindParsedField('test-list-values', parseStructuredValueList, (values) => {
          tc.list_assertions.expected_values = values;
        });
        bindCheckedField('test-list-item-types-enabled', (checked) => {
          tc.list_assertions.item_types_enabled = checked;
          toggleDisabledState('test-list-item-types-mode', !checked);
          toggleDisabledState('test-list-item-types', !checked);
        });
        bindField('test-list-item-types-mode', (v) => { tc.list_assertions.item_type_mode = v; });
        bindParsedField('test-list-item-types', parseTypeList, (types) => {
          tc.list_assertions.expected_item_types = types;
        });
        bindParsedField('test-list-index-checks', parseIndexChecks, (checks) => {
          tc.list_assertions.index_checks = checks;
        });
      }
      break;
  }
}

// Inline condition builder (simplified version — shared logic with hints tab)
function renderConditionBuilder(container, condition, onChange) {
  const CONDITION_TYPES = [
    { value: 'block_exists', label: 'Block exists' },
    { value: 'block_missing', label: 'Block missing' },
    { value: BLOCK_PATTERN_TYPE, label: 'Visual block pattern' },
    { value: 'block_count', label: 'Block count' },
    { value: 'workspace_empty', label: 'Workspace empty' },
    { value: 'all', label: 'ALL (AND)' },
    { value: 'any', label: 'ANY (OR)' },
    { value: 'none', label: 'NONE (NOT)' },
  ];

  const LEGACY_CONDITION_TYPES = {
    block_connected: 'Blocks connected — legacy',
    block_nested: 'Block inside another block input subtree — legacy',
    block_field_value: 'Field matches value/pattern — legacy',
  };

  container.innerHTML = `
    <div class="condition-builder">
      <select class="condition-type-select">
        ${getConditionTypeOptions(CONDITION_TYPES, LEGACY_CONDITION_TYPES, condition.type).map((ct) => `<option value="${ct.value}" ${condition.type === ct.value ? 'selected' : ''}>${ct.label}</option>`).join('')}
      </select>
      <div class="condition-fields" style="margin-top:8px"></div>
    </div>
  `;

  const typeSelect = container.querySelector('.condition-type-select');
  typeSelect.addEventListener('change', (e) => {
    const newCond = { type: e.target.value };
    if (['all', 'any', 'none'].includes(newCond.type)) {
      newCond.conditions = [{ type: 'workspace_empty' }];
    } else if (newCond.type === BLOCK_PATTERN_TYPE) {
      newCond.workspace_state = null;
      newCond.field_constraints = {};
    }
    onChange(newCond, { rerenderBuilder: true });
  });

  const fieldsDiv = container.querySelector('.condition-fields');
  renderSimpleConditionFields(fieldsDiv, condition, onChange);
}

function renderSimpleConditionFields(container, condition, onChange) {
  const datalistIds = createConditionSuggestionIds('test-condition');
  const blockTypeOptions = getSuggestedConditionBlockTypes(Blockly, getConfig())
    .map((blockType) => `<option value="${escapeAttr(blockType)}"></option>`)
    .join('');
  const outerBlockMetadata = getConditionBlockDefinitionMetadata(Blockly, condition.outer_type);
  const innerBlockMetadata = getConditionBlockDefinitionMetadata(Blockly, condition.inner_type);
  const conditionBlockMetadata = getConditionBlockDefinitionMetadata(Blockly, condition.block_type);
  const descendantMatchMode = normalizeFieldValueMatchMode(condition.match_mode);
  const descendantCaseSensitive = normalizeFieldValueCaseSensitivity(
    condition.case_sensitive,
    condition.regex_flags,
  );
  const descendantRegexFlags = getCanonicalRegexFlags(condition.regex_flags);
  const fieldMatchMode = normalizeFieldValueMatchMode(condition.match_mode);
  const fieldCaseSensitive = normalizeFieldValueCaseSensitivity(
    condition.case_sensitive,
    condition.regex_flags,
  );
  const fieldRegexFlags = getCanonicalRegexFlags(condition.regex_flags);

  const bind = (selector, field, transform, options = {}) => {
    const el = container.querySelector(selector);
    if (el) {
      const event = options.event || (el.tagName === 'SELECT' ? 'change' : 'input');
      el.addEventListener(event, (e) => {
        const nextValue = transform ? transform(e.target.value) : e.target.value;
        condition[field] = nextValue;
        options.afterChange?.(condition, nextValue);
        onChange(condition, { rerenderBuilder: Boolean(options.rerenderBuilder) });
      });
    }
  };
  const bindCheckbox = (selector, field) => {
    const el = container.querySelector(selector);
    if (el) {
      el.addEventListener('change', (e) => {
        condition[field] = e.target.checked;
        onChange(condition, { rerenderBuilder: false });
      });
    }
  };

  let html = '';
  switch (condition.type) {
    case 'block_exists':
    case 'block_missing':
      html = `
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <input type="text" class="cond-bt" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%">
      `;
      break;
    case 'block_connected':
      html = `
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <input type="text" class="cond-ut" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.upper_type || '')}" placeholder="Upper block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-lt" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.lower_type || '')}" placeholder="Lower block type" style="width:100%">`;
      break;
    case 'block_nested':
      html = `
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <datalist id="${datalistIds.inputNames}">
          ${outerBlockMetadata.inputNames.map((name) => `<option value="${escapeAttr(name)}"></option>`).join('')}
        </datalist>
        <datalist id="${datalistIds.fieldNames}">
          ${innerBlockMetadata.fieldNames.map((name) => `<option value="${escapeAttr(name)}"></option>`).join('')}
        </datalist>
        <input type="text" class="cond-ot" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.outer_type || '')}" placeholder="Parent block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-it" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.inner_type || '')}" placeholder="Matched descendant block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-in" list="${datalistIds.inputNames}" value="${escapeAttr(condition.input_name || '')}" placeholder="Outer block input name (e.g. VALUE or DO)" style="width:100%">
        <small>Use the input on the outer block. For example, <code>variables_set.VALUE</code> matches the whole value subtree, while <code>text_prompt_ext.TEXT</code> matches the prompt message input.</small>
        <input type="text" class="cond-dfn" list="${datalistIds.fieldNames}" value="${escapeAttr(condition.field_name || '')}" placeholder="Matched descendant field name (optional)" style="width:100%;margin:4px 0">
        ${condition.field_name ? `
        <input type="text" class="cond-dev" value="${escapeAttr(String(condition.expected_value ?? ''))}" placeholder="${escapeAttr(getFieldValueInputPlaceholder(descendantMatchMode, 'Expected descendant field value'))}" style="width:100%;margin-bottom:4px">
        <select class="cond-dmm" style="width:100%;margin-bottom:4px">
          ${renderFieldValueMatchModeOptions(descendantMatchMode)}
        </select>
        <label class="checkbox-label" style="margin:0 0 4px">
          <input type="checkbox" class="cond-dcs" ${descendantCaseSensitive ? 'checked' : ''}>
          Case sensitive
        </label>
        ${isRegexFieldValueMatchMode(descendantMatchMode) ? `<input type="text" class="cond-drf" value="${escapeAttr(descendantRegexFlags)}" placeholder="Extra regex flags (e.g. m)" style="width:100%;margin-bottom:4px">` : ''}
        <small>This value constraint applies only to matching <code>${escapeHtml(condition.inner_type || 'inner_type')}</code> descendants inside <code>${escapeHtml(condition.outer_type || 'outer_type')}.${escapeHtml(condition.input_name || 'input_name')}</code>.</small>
        ` : ''}
        ${outerBlockMetadata.inputNames.length > 0 ? `<small>Inputs on ${escapeHtml(condition.outer_type || 'this block')}: ${outerBlockMetadata.inputNames.join(', ')}. This works for statement inputs like DO and value inputs like VALUE or TEXT.</small>` : ''}
        ${innerBlockMetadata.fieldNames.length > 0 ? `<small>Fields on ${escapeHtml(condition.inner_type || 'this block')}: ${innerBlockMetadata.fieldNames.join(', ')}</small>` : ''}
      `;
      break;
    case BLOCK_PATTERN_TYPE:
      html = '<div class="pattern-builder-mount"></div>';
      break;
    case 'block_field_value':
      html = `
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <datalist id="${datalistIds.fieldNames}">
          ${conditionBlockMetadata.fieldNames.map((name) => `<option value="${escapeAttr(name)}"></option>`).join('')}
        </datalist>
        <input type="text" class="cond-bt" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-fn" list="${datalistIds.fieldNames}" value="${escapeAttr(condition.field_name || '')}" placeholder="Field name" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-ev" value="${escapeAttr(String(condition.expected_value ?? ''))}" placeholder="${escapeAttr(getFieldValueInputPlaceholder(fieldMatchMode, 'Expected value'))}" style="width:100%;margin-bottom:4px">
        <select class="cond-mm" style="width:100%;margin-bottom:4px">
          ${renderFieldValueMatchModeOptions(fieldMatchMode)}
        </select>
        <label class="checkbox-label" style="margin:0 0 4px">
          <input type="checkbox" class="cond-cs" ${fieldCaseSensitive ? 'checked' : ''}>
          Case sensitive
        </label>
        ${isRegexFieldValueMatchMode(fieldMatchMode) ? `<input type="text" class="cond-rf" value="${escapeAttr(fieldRegexFlags)}" placeholder="Extra regex flags (e.g. m)" style="width:100%;margin-bottom:4px">` : ''}
        <small>Choose exact, contains, regex full-match, or regex search. <code>i</code> is controlled by the case-sensitive checkbox.</small>
        ${conditionBlockMetadata.fieldNames.length > 0 ? `<small>Fields on ${escapeHtml(condition.block_type || 'this block')}: ${conditionBlockMetadata.fieldNames.join(', ')}</small>` : ''}
      `;
      break;
    case 'block_count':
      html = `
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <input type="text" class="cond-bt" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%;margin-bottom:4px">
        <div style="display:flex;gap:8px">
          <input type="number" class="cond-mn" value="${condition.min ?? 0}" placeholder="Min" min="0" style="flex:1">
          <input type="number" class="cond-mx" value="${condition.max ?? 10}" placeholder="Max" min="0" style="flex:1">
        </div>`;
      break;
    case 'workspace_empty':
      html = '<p style="font-size:12px;color:#999">Matches when workspace has no blocks.</p>';
      break;
    default:
      html = '<p style="font-size:12px;color:#999">Configure sub-conditions below.</p>';
  }

  container.innerHTML = html;

  if (condition.type === BLOCK_PATTERN_TYPE) {
    const patternContainer = container.querySelector('.pattern-builder-mount');
    if (patternContainer) {
      renderPatternBuilder(patternContainer, condition, (nextCondition) => {
        onChange(nextCondition, { rerenderBuilder: false });
      });
    }
    return;
  }

  bind('.cond-bt', 'block_type', undefined, {
    event: condition.type === 'block_field_value' ? 'change' : undefined,
    rerenderBuilder: condition.type === 'block_field_value',
  });
  bind('.cond-ut', 'upper_type');
  bind('.cond-lt', 'lower_type');
  bind('.cond-ot', 'outer_type', undefined, { event: 'change', rerenderBuilder: true });
  bind('.cond-it', 'inner_type', undefined, { event: 'change', rerenderBuilder: true });
  bind('.cond-in', 'input_name');
  bind('.cond-dfn', 'field_name', undefined, {
    event: 'change',
    afterChange: (currentCondition, nextValue) => {
      if (!String(nextValue).trim()) {
        delete currentCondition.expected_value;
        delete currentCondition.match_mode;
        delete currentCondition.case_sensitive;
        delete currentCondition.regex_flags;
      } else if (!currentCondition.match_mode) {
        currentCondition.match_mode = 'exact';
        currentCondition.case_sensitive = true;
      }
    },
    rerenderBuilder: true,
  });
  bind('.cond-dev', 'expected_value');
  bind('.cond-dmm', 'match_mode', undefined, { event: 'change', rerenderBuilder: true });
  bindCheckbox('.cond-dcs', 'case_sensitive');
  bind('.cond-drf', 'regex_flags');
  bind('.cond-fn', 'field_name');
  bind('.cond-ev', 'expected_value');
  bind('.cond-mm', 'match_mode', undefined, { event: 'change', rerenderBuilder: true });
  bindCheckbox('.cond-cs', 'case_sensitive');
  bind('.cond-rf', 'regex_flags');
  bind('.cond-mn', 'min', (v) => parseInt(v) || 0);
  bind('.cond-mx', 'max', (v) => parseInt(v) || 10);
}

function renderRuntimeTextAssertionEditor({
  prefix,
  title,
  assertion,
  expectedLabel,
  expectedPlaceholder,
  helpText,
  matchAnyItemLabel,
  showExpectedLabel,
  showActualLabel,
}) {
  return `
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="${prefix}-enabled" ${assertion.enabled ? 'checked' : ''}>
        Verify ${escapeHtml(title.toLowerCase())}
      </label>
    </div>
    <fieldset id="${prefix}-fields" ${assertion.enabled ? '' : 'disabled'} style="border:1px solid #ddd;border-radius:6px;padding:12px;margin:0 0 12px">
      <legend style="padding:0 6px;font-weight:600">${escapeHtml(title)}</legend>
      <div class="form-group">
        <label>${expectedLabel}</label>
        <textarea id="${prefix}-expected" rows="3" placeholder="${escapeAttr(expectedPlaceholder)}">${escapeHtml(assertion.expected || '')}</textarea>
        <small>${helpText}</small>
      </div>
      <div class="form-group">
        <label>Match mode</label>
        <select id="${prefix}-match-mode">
          ${MATCH_MODES.map((mode) => `<option value="${mode.value}" ${assertion.match_mode === mode.value ? 'selected' : ''}>${mode.label}</option>`).join('')}
        </select>
      </div>
      ${matchAnyItemLabel ? `
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="${prefix}-match-any-item" ${assertion.match_any_item ? 'checked' : ''}>
          ${matchAnyItemLabel}
        </label>
      </div>
      ` : ''}
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="${prefix}-show-expected" ${assertion.show_expected ? 'checked' : ''}>
          ${showExpectedLabel}
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="${prefix}-show-actual" ${assertion.show_actual ? 'checked' : ''}>
          ${showActualLabel}
        </label>
      </div>
      <div class="form-group">
        <label>Success message</label>
        <textarea id="${prefix}-success-message" rows="2" placeholder="Optional message shown when this check passes">${escapeHtml(assertion.success_message || '')}</textarea>
      </div>
      <div class="form-group">
        <label>Failure message</label>
        <textarea id="${prefix}-failure-message" rows="2" placeholder="Optional message shown when this check fails">${escapeHtml(assertion.failure_message || '')}</textarea>
      </div>
    </fieldset>
  `;
}

function bindRuntimeTextAssertionFields(prefix, assertion) {
  bindCheckedField(`${prefix}-enabled`, (checked) => {
    assertion.enabled = checked;
    const fieldset = document.getElementById(`${prefix}-fields`);
    if (fieldset) fieldset.disabled = !checked;
  });
  bindField(`${prefix}-expected`, (value) => { assertion.expected = value; });
  bindField(`${prefix}-match-mode`, (value) => { assertion.match_mode = value; });
  bindCheckedField(`${prefix}-match-any-item`, (checked) => { assertion.match_any_item = checked; });
  bindCheckedField(`${prefix}-show-expected`, (checked) => { assertion.show_expected = checked; });
  bindCheckedField(`${prefix}-show-actual`, (checked) => { assertion.show_actual = checked; });
  bindField(`${prefix}-success-message`, (value) => { assertion.success_message = value; });
  bindField(`${prefix}-failure-message`, (value) => { assertion.failure_message = value; });
}

function updateWeightIndicator() {
  const el = document.getElementById('weight-indicator');
  if (!el) return;

  const tests = getConfig().evaluation.test_cases;
  const total = tests.reduce((sum, tc) => sum + getTestPoints(tc), 0);

  if (tests.length === 0) {
    el.className = '';
    el.textContent = 'No test cases yet.';
  } else if (total > 0) {
    el.className = 'weight-ok';
    el.textContent = `✓ Total available points: ${total}`;
  } else {
    el.className = 'weight-error';
    el.textContent = '✗ All tests are worth 0 points — no score possible';
  }
}

function formatPointsLabel(points) {
  return `${points} point${points === 1 ? '' : 's'}`;
}

function bindField(id, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  const event = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(event, (e) => {
    setter(e.target.value);
    emitLocalTestChange();
  });
}

function bindParsedField(id, parser, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', (e) => {
    try {
      const parsed = parser(e.target.value);
      e.target.setCustomValidity('');
      setter(parsed);
      emitLocalTestChange();
    } catch (err) {
      e.target.setCustomValidity(err instanceof Error ? err.message : String(err));
    }
  });
}

function bindCheckedField(id, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', (e) => {
    setter(e.target.checked);
    emitLocalTestChange();
  });
}

function toggleDisabledState(id, disabled) {
  const el = document.getElementById(id);
  if (el) el.disabled = disabled;
}

function emitLocalTestChange() {
  suppressSelectedTestEditorSync = true;
  try {
    notifyChange();
  } finally {
    suppressSelectedTestEditorSync = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function formatScalarExpectedValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function getScalarValuePlaceholder(expectedType, comparison) {
  if (comparison === 'type') return 'e.g. number';
  if (expectedType === 'string') return 'e.g. cow';
  if (expectedType === 'float') return 'e.g. 3.14';
  if (expectedType === 'int') return 'e.g. 3';
  return 'e.g. 3 or cow';
}

function getScalarValueHelpText(expectedType, comparison) {
  if (comparison === 'type') {
    return 'Legacy JavaScript typeof check. Use the Expected type dropdown for int/float/string/list checks.';
  }
  if (expectedType === 'string') {
    return 'Entered text is compared as a string.';
  }
  if (expectedType === 'int' || expectedType === 'float') {
    return 'Entered text is parsed as a number for numeric comparisons.';
  }
  return 'Numbers are parsed as numbers when possible. Everything else is treated as text.';
}

function parseScalarExpectedValue(value, expectedType, comparison) {
  if (comparison === 'type') return value;
  if (expectedType === 'string') return value;
  if (expectedType === 'int' || expectedType === 'float') {
    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }
  const num = Number(value);
  return Number.isNaN(num) ? value : num;
}

function formatStructuredValueList(values) {
  if (!Array.isArray(values) || values.length === 0) return '';
  return values.map((value) => formatStructuredValue(value)).join('\n');
}

function parseStructuredValueList(text) {
  if (text.trim() === '') return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseStructuredValueLine);
}

function formatTypeList(types) {
  return Array.isArray(types) ? types.join(', ') : '';
}

function parseTypeList(text) {
  if (text.trim() === '') return [];
  return text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== 'any');
}

function formatIndexChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return '';
  return checks.map((check) => JSON.stringify(check)).join('\n');
}

function parseIndexChecks(text) {
  if (text.trim() === '') return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error('Each index check line must be valid JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Each index check line must be a JSON object.');
      }
      return parsed;
    });
}

function parseStructuredValueLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return line;
  }
}

function formatStructuredValue(value) {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
}

function getConditionTypeOptions(conditionTypes, legacyConditionTypes, currentType) {
  if (!currentType || conditionTypes.some((type) => type.value === currentType)) {
    return conditionTypes;
  }
  return [
    ...conditionTypes,
    { value: currentType, label: legacyConditionTypes[currentType] || `${currentType} — legacy` },
  ];
}

function renderFieldValueMatchModeOptions(selectedMode) {
  return FIELD_VALUE_MATCH_MODE_OPTIONS
    .map((option) => `<option value="${option.value}" ${normalizeFieldValueMatchMode(selectedMode) === option.value ? 'selected' : ''}>${option.label}</option>`)
    .join('');
}

function getFieldValueInputPlaceholder(matchMode, exactPlaceholder) {
  switch (normalizeFieldValueMatchMode(matchMode)) {
    case 'contains':
      return 'Expected substring';
    case 'regex_full':
    case 'regex_search':
      return 'Regex pattern (e.g. Who.*\\?)';
    default:
      return exactPlaceholder;
  }
}
