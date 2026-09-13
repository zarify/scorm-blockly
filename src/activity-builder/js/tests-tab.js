/**
 * Tests Tab — Test case builder with type-specific editors.
 */

import { getConfig, notifyChange, onConfigChange, Blockly } from './builder-app.js';
import {
  DEFAULT_TOOLBOX_BLOCK_LIBRARY,
  getWorkspaceBlockMetadata,
} from '../../shared/blockly-toolbox.js';
import {
  formatPromptInputs,
  getPromptInputs,
  getTestPoints,
  parsePromptInputs,
  setTestPoints,
} from '../../shared/test-config.js';

let selectedTestIndex = -1;
let suppressSelectedTestEditorSync = false;

const TEST_TYPES = [
  { value: 'stdout_match', label: 'Output match (stdout)' },
  { value: 'block_structure', label: 'Block structure check' },
  { value: 'variable_state', label: 'Variable value check' },
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
    expected_output: '',
    match_mode: 'exact',
    points: 1,
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
    <div class="list-item ${i === selectedTestIndex ? 'selected' : ''}" data-index="${i}">
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

  container.querySelectorAll('.list-item-remove').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTest(parseInt(el.dataset.index));
    });
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
      <label>Feedback on fail</label>
      <textarea id="test-feedback" rows="2" placeholder="Message shown to student when this test fails">${escapeHtml(tc.feedback_on_fail || '')}</textarea>
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
      feedback_on_fail: tc.feedback_on_fail,
    };
    if (v === 'stdout_match') {
      newTc.prompt_inputs = getPromptInputs(tc);
      newTc.expected_output = '';
      newTc.match_mode = 'exact';
    } else if (v === 'block_structure') {
      newTc.conditions = { type: 'workspace_empty' };
    } else if (v === 'variable_state') {
      newTc.prompt_inputs = getPromptInputs(tc);
      newTc.variable_name = '';
      newTc.expected_value = '';
      newTc.comparison = 'equals';
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

  bindField('test-feedback', (v) => { tc.feedback_on_fail = v; });
}

function renderTestTypeFields(tc) {
  const container = document.getElementById('test-type-fields');
  let html = '';

  switch (tc.type) {
    case 'stdout_match':
      html = `
        <div class="form-group">
          <label>Prompt inputs</label>
          <textarea id="test-prompt-inputs" rows="3" placeholder="One prompt() response per line">${escapeHtml(formatPromptInputs(getPromptInputs(tc)))}</textarea>
          <small>Returned to <code>window.prompt()</code> in order. If the program asks for more or fewer inputs than listed here, the test fails explicitly.</small>
        </div>
        <div class="form-group">
          <label>Expected output</label>
          <textarea id="test-expected-output" rows="4" placeholder="Expected console output">${escapeHtml(tc.expected_output || '')}</textarea>
          <small>Use actual newlines — each line of expected output on its own line. A trailing newline is added automatically by print blocks.</small>
        </div>
        <div class="form-group">
          <label>Match mode</label>
          <select id="test-match-mode">
            ${MATCH_MODES.map((m) => `<option value="${m.value}" ${(tc.match_mode || 'exact') === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
        </div>
      `;
      break;

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
      html = `
        <div class="form-group">
          <label>Prompt inputs</label>
          <textarea id="test-prompt-inputs" rows="3" placeholder="One prompt() response per line">${escapeHtml(formatPromptInputs(getPromptInputs(tc)))}</textarea>
          <small>Returned to <code>window.prompt()</code> in order before variable assertions run. Extra or missing inputs fail the test.</small>
        </div>
        <div class="form-group">
          <label>Variable name</label>
          <input type="text" id="test-var-name" value="${escapeAttr(tc.variable_name || '')}" placeholder="e.g. count">
        </div>
        <div class="form-group">
          <label>Expected value</label>
          <input type="text" id="test-var-expected" value="${escapeAttr(String(tc.expected_value ?? ''))}" placeholder="e.g. 3">
          <small>Numbers are compared as numbers, strings as strings</small>
        </div>
        <div class="form-group">
          <label>Comparison</label>
          <select id="test-var-comparison">
            ${COMPARISONS.map((c) => `<option value="${c.value}" ${(tc.comparison || 'equals') === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
      `;
      break;
  }

  container.innerHTML = html;

  // Bind type-specific fields
  switch (tc.type) {
    case 'stdout_match':
      bindField('test-prompt-inputs', (v) => { tc.prompt_inputs = parsePromptInputs(v); });
      bindField('test-expected-output', (v) => { tc.expected_output = v; });
      bindField('test-match-mode', (v) => { tc.match_mode = v; });
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
      bindField('test-var-name', (v) => { tc.variable_name = v; });
      bindField('test-var-expected', (v) => {
        // Try to parse as number
        const num = Number(v);
        tc.expected_value = isNaN(num) ? v : num;
      });
      bindField('test-var-comparison', (v) => { tc.comparison = v; });
      break;
  }
}

// Inline condition builder (simplified version — shared logic with hints tab)
function renderConditionBuilder(container, condition, onChange) {
  const CONDITION_TYPES = [
    { value: 'block_exists', label: 'Block exists' },
    { value: 'block_missing', label: 'Block missing' },
    { value: 'block_connected', label: 'Blocks connected' },
    { value: 'block_nested', label: 'Block nested' },
    { value: 'block_field_value', label: 'Field has value' },
    { value: 'block_count', label: 'Block count' },
    { value: 'workspace_empty', label: 'Workspace empty' },
    { value: 'all', label: 'ALL (AND)' },
    { value: 'any', label: 'ANY (OR)' },
    { value: 'none', label: 'NONE (NOT)' },
  ];

  container.innerHTML = `
    <div class="condition-builder">
      <select class="condition-type-select">
        ${CONDITION_TYPES.map((ct) => `<option value="${ct.value}" ${condition.type === ct.value ? 'selected' : ''}>${ct.label}</option>`).join('')}
      </select>
      <div class="condition-fields" style="margin-top:8px"></div>
    </div>
  `;

  const typeSelect = container.querySelector('.condition-type-select');
  typeSelect.addEventListener('change', (e) => {
    const newCond = { type: e.target.value };
    if (['all', 'any', 'none'].includes(newCond.type)) {
      newCond.conditions = [{ type: 'workspace_empty' }];
    }
    onChange(newCond, { rerenderBuilder: true });
  });

  const fieldsDiv = container.querySelector('.condition-fields');
  renderSimpleConditionFields(fieldsDiv, condition, onChange);
}

function renderSimpleConditionFields(container, condition, onChange) {
  const blockTypeOptions = getSuggestedBlockTypes()
    .map((blockType) => `<option value="${escapeAttr(blockType)}"></option>`)
    .join('');
  const outerBlockMetadata = getBlockDefinitionMetadata(condition.outer_type);
  const conditionBlockMetadata = getBlockDefinitionMetadata(condition.block_type);

  const bind = (selector, field, transform, options = {}) => {
    const el = container.querySelector(selector);
    if (el) {
      const event = options.event || (el.tagName === 'SELECT' ? 'change' : 'input');
      el.addEventListener(event, (e) => {
        condition[field] = transform ? transform(e.target.value) : e.target.value;
        onChange(condition, { rerenderBuilder: Boolean(options.rerenderBuilder) });
      });
    }
  };

  let html = '';
  switch (condition.type) {
    case 'block_exists':
    case 'block_missing':
      html = `
        <datalist id="condition-block-types">${blockTypeOptions}</datalist>
        <input type="text" class="cond-bt" list="condition-block-types" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%">
      `;
      break;
    case 'block_connected':
      html = `
        <datalist id="condition-block-types">${blockTypeOptions}</datalist>
        <input type="text" class="cond-ut" list="condition-block-types" value="${escapeAttr(condition.upper_type || '')}" placeholder="Upper block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-lt" list="condition-block-types" value="${escapeAttr(condition.lower_type || '')}" placeholder="Lower block type" style="width:100%">`;
      break;
    case 'block_nested':
      html = `
        <datalist id="condition-block-types">${blockTypeOptions}</datalist>
        <datalist id="condition-input-names">
          ${outerBlockMetadata.inputNames.map((name) => `<option value="${escapeAttr(name)}"></option>`).join('')}
        </datalist>
        <input type="text" class="cond-ot" list="condition-block-types" value="${escapeAttr(condition.outer_type || '')}" placeholder="Outer block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-it" list="condition-block-types" value="${escapeAttr(condition.inner_type || '')}" placeholder="Inner block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-in" list="condition-input-names" value="${escapeAttr(condition.input_name || '')}" placeholder="Input name (e.g. DO)" style="width:100%">
        ${outerBlockMetadata.inputNames.length > 0 ? `<small>Inputs on ${escapeHtml(condition.outer_type || 'this block')}: ${outerBlockMetadata.inputNames.join(', ')}</small>` : ''}
      `;
      break;
    case 'block_field_value':
      html = `
        <datalist id="condition-block-types">${blockTypeOptions}</datalist>
        <datalist id="condition-field-names">
          ${conditionBlockMetadata.fieldNames.map((name) => `<option value="${escapeAttr(name)}"></option>`).join('')}
        </datalist>
        <input type="text" class="cond-bt" list="condition-block-types" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-fn" list="condition-field-names" value="${escapeAttr(condition.field_name || '')}" placeholder="Field name" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-ev" value="${escapeAttr(String(condition.expected_value ?? ''))}" placeholder="Expected value" style="width:100%">
        ${conditionBlockMetadata.fieldNames.length > 0 ? `<small>Fields on ${escapeHtml(condition.block_type || 'this block')}: ${conditionBlockMetadata.fieldNames.join(', ')}</small>` : ''}
      `;
      break;
    case 'block_count':
      html = `
        <datalist id="condition-block-types">${blockTypeOptions}</datalist>
        <input type="text" class="cond-bt" list="condition-block-types" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%;margin-bottom:4px">
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

  bind('.cond-bt', 'block_type', undefined, {
    event: condition.type === 'block_field_value' ? 'change' : undefined,
    rerenderBuilder: condition.type === 'block_field_value',
  });
  bind('.cond-ut', 'upper_type');
  bind('.cond-lt', 'lower_type');
  bind('.cond-ot', 'outer_type', undefined, { event: 'change', rerenderBuilder: true });
  bind('.cond-it', 'inner_type');
  bind('.cond-in', 'input_name');
  bind('.cond-fn', 'field_name');
  bind('.cond-ev', 'expected_value');
  bind('.cond-mn', 'min', (v) => parseInt(v) || 0);
  bind('.cond-mx', 'max', (v) => parseInt(v) || 10);
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

function getSuggestedBlockTypes() {
  const workspaceMetadata = getWorkspaceBlockMetadata(
    Blockly,
    getConfig().blockly_setup?.starting_blocks || null,
  );
  const toolboxBlockTypes = (getConfig().blockly_setup?.toolbox?.categories || [])
    .flatMap((category) => category.blocks || []);
  const defaultBlockTypes = Object.values(DEFAULT_TOOLBOX_BLOCK_LIBRARY).flat();

  return [...new Set([...workspaceMetadata.blockTypes, ...toolboxBlockTypes, ...defaultBlockTypes])]
    .filter((blockType) => Blockly.Blocks?.[blockType])
    .sort();
}

function getBlockDefinitionMetadata(blockType) {
  if (!blockType || !Blockly.Blocks?.[blockType]) {
    return { inputNames: [], fieldNames: [] };
  }

  const workspace = new Blockly.Workspace();

  try {
    const block = workspace.newBlock(blockType);
    return {
      inputNames: [...new Set((block.inputList || []).map((input) => input.name).filter(Boolean))].sort(),
      fieldNames: [...new Set((block.getFields?.() || []).map((field) => field.name).filter(Boolean))].sort(),
    };
  } catch {
    return { inputNames: [], fieldNames: [] };
  } finally {
    if (typeof workspace.dispose === 'function') {
      workspace.dispose();
    }
  }
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
