/**
 * Tests Tab — Test case builder with type-specific editors.
 */

import { getConfig, notifyChange, onConfigChange } from './builder-app.js';

let selectedTestIndex = -1;

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
    if (selectedTestIndex >= 0) renderTestEditor();
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
    expected_output: '',
    match_mode: 'exact',
    weight: 0,
    feedback_on_fail: '',
  });

  selectedTestIndex = cfg.evaluation.test_cases.length - 1;
  notifyChange();
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
  notifyChange();
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
        <strong>${tc.type}</strong> — ${tc.id} (${tc.weight}%)
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
      <label>Weight (%)</label>
      <input type="range" id="test-weight" min="0" max="100" value="${tc.weight}">
      <span id="test-weight-display">${tc.weight}%</span>
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
  bindField('test-id', (v) => { tc.id = v; renderTestList(); });
  bindField('test-type', (v) => {
    // Reset type-specific fields
    const newTc = { id: tc.id, type: v, weight: tc.weight, feedback_on_fail: tc.feedback_on_fail };
    if (v === 'stdout_match') {
      newTc.expected_output = '';
      newTc.match_mode = 'exact';
    } else if (v === 'block_structure') {
      newTc.conditions = { type: 'workspace_empty' };
    } else if (v === 'variable_state') {
      newTc.variable_name = '';
      newTc.expected_value = '';
      newTc.comparison = 'equals';
    }
    Object.assign(tc, newTc);
    // Clean up old fields
    Object.keys(tc).forEach((k) => {
      if (!(k in newTc)) delete tc[k];
    });
    notifyChange();
    renderTestEditor();
    renderTestList();
  });

  const weightSlider = document.getElementById('test-weight');
  const weightDisplay = document.getElementById('test-weight-display');
  weightSlider.addEventListener('input', (e) => {
    tc.weight = parseInt(e.target.value);
    weightDisplay.textContent = `${tc.weight}%`;
    notifyChange();
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
          <label>Expected output</label>
          <textarea id="test-expected-output" rows="4" placeholder="Expected console output (use \\n for newlines)">${escapeHtml(tc.expected_output || '')}</textarea>
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
        </div>
      `;
      break;

    case 'variable_state':
      html = `
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
      bindField('test-expected-output', (v) => { tc.expected_output = v; });
      bindField('test-match-mode', (v) => { tc.match_mode = v; });
      break;

    case 'block_structure':
      // Reuse condition builder from hints tab
      const builderDiv = document.getElementById('test-condition-builder');
      if (builderDiv) {
        renderConditionBuilder(builderDiv, tc.conditions || { type: 'workspace_empty' }, (newCond) => {
          tc.conditions = newCond;
          notifyChange();
        });
      }
      break;

    case 'variable_state':
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
    onChange(newCond);
    renderConditionBuilder(container, newCond, onChange);
  });

  const fieldsDiv = container.querySelector('.condition-fields');
  renderSimpleConditionFields(fieldsDiv, condition, onChange);
}

function renderSimpleConditionFields(container, condition, onChange) {
  const bind = (selector, field, transform) => {
    const el = container.querySelector(selector);
    if (el) {
      el.addEventListener('input', (e) => {
        condition[field] = transform ? transform(e.target.value) : e.target.value;
        onChange(condition);
      });
    }
  };

  let html = '';
  switch (condition.type) {
    case 'block_exists':
    case 'block_missing':
      html = `<input type="text" class="cond-bt" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%">`;
      break;
    case 'block_connected':
      html = `
        <input type="text" class="cond-ut" value="${escapeAttr(condition.upper_type || '')}" placeholder="Upper block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-lt" value="${escapeAttr(condition.lower_type || '')}" placeholder="Lower block type" style="width:100%">`;
      break;
    case 'block_nested':
      html = `
        <input type="text" class="cond-ot" value="${escapeAttr(condition.outer_type || '')}" placeholder="Outer block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-it" value="${escapeAttr(condition.inner_type || '')}" placeholder="Inner block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-in" value="${escapeAttr(condition.input_name || '')}" placeholder="Input name (e.g. DO)" style="width:100%">`;
      break;
    case 'block_field_value':
      html = `
        <input type="text" class="cond-bt" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-fn" value="${escapeAttr(condition.field_name || '')}" placeholder="Field name" style="width:100%;margin-bottom:4px">
        <input type="text" class="cond-ev" value="${escapeAttr(String(condition.expected_value || ''))}" placeholder="Expected value" style="width:100%">`;
      break;
    case 'block_count':
      html = `
        <input type="text" class="cond-bt" value="${escapeAttr(condition.block_type || '')}" placeholder="Block type" style="width:100%;margin-bottom:4px">
        <div style="display:flex;gap:8px">
          <input type="number" class="cond-mn" value="${condition.min || 0}" placeholder="Min" min="0" style="flex:1">
          <input type="number" class="cond-mx" value="${condition.max || 10}" placeholder="Max" min="0" style="flex:1">
        </div>`;
      break;
    case 'workspace_empty':
      html = '<p style="font-size:12px;color:#999">Matches when workspace has no blocks.</p>';
      break;
    default:
      html = '<p style="font-size:12px;color:#999">Configure sub-conditions below.</p>';
  }

  container.innerHTML = html;

  bind('.cond-bt', 'block_type');
  bind('.cond-ut', 'upper_type');
  bind('.cond-lt', 'lower_type');
  bind('.cond-ot', 'outer_type');
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
  const total = tests.reduce((sum, tc) => sum + (tc.weight || 0), 0);

  if (tests.length === 0) {
    el.className = '';
    el.textContent = 'No test cases yet.';
  } else if (total === 100) {
    el.className = 'weight-ok';
    el.textContent = `✓ Weights sum to ${total}%`;
  } else if (total > 0) {
    el.className = 'weight-warn';
    el.textContent = `⚠ Weights sum to ${total}% (should be 100%)`;
  } else {
    el.className = 'weight-error';
    el.textContent = `✗ All weights are 0 — no score possible`;
  }
}

function bindField(id, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  const event = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(event, (e) => {
    setter(e.target.value);
    notifyChange();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
