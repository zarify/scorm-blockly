/**
 * Hints Tab — Hint condition builder.
 */

import { getConfig, notifyChange, onConfigChange } from './builder-app.js';

let selectedHintIndex = -1;

const CONDITION_TYPES = [
  { value: 'block_exists', label: 'Block exists' },
  { value: 'block_missing', label: 'Block missing' },
  { value: 'block_connected', label: 'Blocks connected (sequential)' },
  { value: 'block_nested', label: 'Block nested inside another' },
  { value: 'block_field_value', label: 'Block field has value' },
  { value: 'block_count', label: 'Block count in range' },
  { value: 'workspace_empty', label: 'Workspace is empty' },
  { value: 'all', label: 'ALL conditions (AND)' },
  { value: 'any', label: 'ANY condition (OR)' },
  { value: 'none', label: 'NONE of conditions (NOT)' },
];

const TRIGGER_EVENTS = [
  { value: 'workspace_change', label: 'Workspace changes' },
  { value: 'test_fail', label: 'Test run fails' },
  { value: 'manual', label: 'Student requests hint' },
  { value: 'timed', label: 'After time delay' },
];

export function initHintsTab() {
  document.getElementById('btn-add-hint').addEventListener('click', addHint);
  onConfigChange(() => {
    renderHintList();
    if (selectedHintIndex >= 0) renderHintEditor();
  });
  renderHintList();
}

function addHint() {
  const cfg = getConfig();
  if (!cfg.hints) cfg.hints = [];

  const id = `hint_${Date.now().toString(36)}`;
  cfg.hints.push({
    id,
    trigger: {
      event: 'workspace_change',
      conditions: { type: 'workspace_empty' },
    },
    message: 'New hint — edit the message and conditions.',
    priority: cfg.hints.length + 1,
    delay_seconds: 0,
    show_once: false,
  });

  selectedHintIndex = cfg.hints.length - 1;
  notifyChange();
  renderHintList();
  renderHintEditor();
}

function removeHint(index) {
  const cfg = getConfig();
  cfg.hints.splice(index, 1);
  if (selectedHintIndex >= cfg.hints.length) {
    selectedHintIndex = cfg.hints.length - 1;
  }
  notifyChange();
  renderHintList();
  renderHintEditor();
}

function renderHintList() {
  const container = document.getElementById('hint-list');
  const hints = getConfig().hints || [];

  container.innerHTML = hints.map((hint, i) => `
    <div class="list-item ${i === selectedHintIndex ? 'selected' : ''}" data-index="${i}">
      <span class="list-item-title">${escapeHtml(hint.message.substring(0, 50))}${hint.message.length > 50 ? '...' : ''}</span>
      <button class="list-item-remove" data-index="${i}" title="Remove hint">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.list-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      selectedHintIndex = parseInt(el.dataset.index);
      renderHintList();
      renderHintEditor();
    });
  });

  container.querySelectorAll('.list-item-remove').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      removeHint(parseInt(el.dataset.index));
    });
  });
}

function renderHintEditor() {
  const container = document.getElementById('hint-editor-content');
  const hints = getConfig().hints || [];

  if (selectedHintIndex < 0 || selectedHintIndex >= hints.length) {
    container.innerHTML = '<p class="placeholder-text">Select a hint to edit, or add a new one.</p>';
    return;
  }

  const hint = hints[selectedHintIndex];

  container.innerHTML = `
    <div class="form-group">
      <label>Hint ID</label>
      <input type="text" id="hint-id" value="${escapeAttr(hint.id)}">
    </div>
    <div class="form-group">
      <label>Message</label>
      <textarea id="hint-message" rows="3">${escapeHtml(hint.message)}</textarea>
    </div>
    <div class="form-group">
      <label>Trigger Event</label>
      <select id="hint-trigger-event">
        ${TRIGGER_EVENTS.map((e) => `<option value="${e.value}" ${hint.trigger.event === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Condition</label>
      <div id="hint-condition-builder"></div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label>Priority</label>
        <input type="number" id="hint-priority" value="${hint.priority || 1}" min="1">
      </div>
      <div class="form-group" style="flex:1">
        <label>Delay (seconds)</label>
        <input type="number" id="hint-delay" value="${hint.delay_seconds || 0}" min="0">
      </div>
      <div class="form-group" style="flex:1">
        <label>After N fails</label>
        <input type="number" id="hint-after-attempts" value="${hint.trigger.after_attempts || 0}" min="0">
      </div>
    </div>
    <label class="checkbox-label">
      <input type="checkbox" id="hint-show-once" ${hint.show_once ? 'checked' : ''}>
      Show once (don't re-show after dismissal)
    </label>
  `;

  // Render condition builder
  renderConditionBuilder(
    document.getElementById('hint-condition-builder'),
    hint.trigger.conditions || { type: 'workspace_empty' },
    (newCondition) => {
      hint.trigger.conditions = newCondition;
      notifyChange();
    }
  );

  // Bind inputs
  bindField('hint-id', (v) => { hint.id = v; });
  bindField('hint-message', (v) => { hint.message = v; renderHintList(); });
  bindField('hint-trigger-event', (v) => { hint.trigger.event = v; });
  bindField('hint-priority', (v) => { hint.priority = parseInt(v) || 1; });
  bindField('hint-delay', (v) => { hint.delay_seconds = parseInt(v) || 0; });
  bindField('hint-after-attempts', (v) => { hint.trigger.after_attempts = parseInt(v) || 0; });
  bindCheckboxField('hint-show-once', (v) => { hint.show_once = v; });
}

function renderConditionBuilder(container, condition, onChange) {
  const isComposite = ['all', 'any', 'none'].includes(condition.type);

  let html = `
    <div class="condition-builder">
      <div class="condition-row">
        <select class="condition-type-select">
          ${CONDITION_TYPES.map((ct) => `<option value="${ct.value}" ${condition.type === ct.value ? 'selected' : ''}>${ct.label}</option>`).join('')}
        </select>
      </div>
      <div class="condition-fields"></div>
    </div>
  `;

  container.innerHTML = html;

  const typeSelect = container.querySelector('.condition-type-select');
  const fieldsDiv = container.querySelector('.condition-fields');

  typeSelect.addEventListener('change', (e) => {
    const newType = e.target.value;
    const newCondition = { type: newType };
    if (['all', 'any', 'none'].includes(newType)) {
      newCondition.conditions = [{ type: 'workspace_empty' }];
    }
    onChange(newCondition);
    renderConditionBuilder(container, newCondition, onChange);
  });

  renderConditionFields(fieldsDiv, condition, onChange);
}

function renderConditionFields(container, condition, onChange) {
  let html = '';

  switch (condition.type) {
    case 'block_exists':
    case 'block_missing':
      html = `
        <div class="condition-row">
          <label>Block type:</label>
          <input type="text" class="cond-block-type" value="${escapeAttr(condition.block_type || '')}" placeholder="e.g. controls_repeat_ext">
        </div>
        ${condition.type === 'block_exists' ? `
        <div class="condition-row">
          <label>Min count:</label>
          <input type="number" class="cond-min-count" value="${condition.min_count || 1}" min="1" style="width:80px">
        </div>` : ''}
      `;
      break;

    case 'block_connected':
      html = `
        <div class="condition-row">
          <label>Upper block:</label>
          <input type="text" class="cond-upper-type" value="${escapeAttr(condition.upper_type || '')}" placeholder="e.g. controls_for">
        </div>
        <div class="condition-row">
          <label>Lower block:</label>
          <input type="text" class="cond-lower-type" value="${escapeAttr(condition.lower_type || '')}" placeholder="e.g. text_print">
        </div>
      `;
      break;

    case 'block_nested':
      html = `
        <div class="condition-row">
          <label>Outer block:</label>
          <input type="text" class="cond-outer-type" value="${escapeAttr(condition.outer_type || '')}" placeholder="e.g. controls_repeat_ext">
        </div>
        <div class="condition-row">
          <label>Inner block:</label>
          <input type="text" class="cond-inner-type" value="${escapeAttr(condition.inner_type || '')}" placeholder="e.g. text_print">
        </div>
        <div class="condition-row">
          <label>Input name:</label>
          <input type="text" class="cond-input-name" value="${escapeAttr(condition.input_name || '')}" placeholder="e.g. DO">
        </div>
      `;
      break;

    case 'block_field_value':
      html = `
        <div class="condition-row">
          <label>Block type:</label>
          <input type="text" class="cond-block-type" value="${escapeAttr(condition.block_type || '')}">
        </div>
        <div class="condition-row">
          <label>Field name:</label>
          <input type="text" class="cond-field-name" value="${escapeAttr(condition.field_name || '')}">
        </div>
        <div class="condition-row">
          <label>Expected value:</label>
          <input type="text" class="cond-expected" value="${escapeAttr(String(condition.expected_value || ''))}">
        </div>
      `;
      break;

    case 'block_count':
      html = `
        <div class="condition-row">
          <label>Block type:</label>
          <input type="text" class="cond-block-type" value="${escapeAttr(condition.block_type || '')}">
        </div>
        <div class="condition-row">
          <label>Min:</label>
          <input type="number" class="cond-min" value="${condition.min || 0}" min="0" style="width:80px">
          <label>Max:</label>
          <input type="number" class="cond-max" value="${condition.max || 10}" min="0" style="width:80px">
        </div>
      `;
      break;

    case 'workspace_empty':
      html = '<p style="font-size:13px;color:#666;margin:8px 0">No additional parameters needed.</p>';
      break;

    case 'all':
    case 'any':
    case 'none':
      html = '<div class="condition-nested" id="nested-conditions"></div>';
      html += '<button class="btn btn-small btn-secondary add-nested-condition" style="margin-top:8px">+ Add sub-condition</button>';
      break;
  }

  container.innerHTML = html;

  // Bind fields based on type
  bindConditionInputs(container, condition, onChange);

  // Handle composite conditions
  if (['all', 'any', 'none'].includes(condition.type)) {
    const nestedDiv = container.querySelector('#nested-conditions');
    const subConditions = condition.conditions || [];

    subConditions.forEach((sub, i) => {
      const subContainer = document.createElement('div');
      subContainer.style.marginBottom = '8px';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-small btn-danger';
      removeBtn.textContent = '✕';
      removeBtn.style.marginBottom = '4px';
      removeBtn.addEventListener('click', () => {
        condition.conditions.splice(i, 1);
        onChange(condition);
        renderConditionFields(container, condition, onChange);
      });

      subContainer.appendChild(removeBtn);
      const builderDiv = document.createElement('div');
      subContainer.appendChild(builderDiv);
      nestedDiv.appendChild(subContainer);

      renderConditionBuilder(builderDiv, sub, (newSub) => {
        condition.conditions[i] = newSub;
        onChange(condition);
      });
    });

    container.querySelector('.add-nested-condition').addEventListener('click', () => {
      if (!condition.conditions) condition.conditions = [];
      condition.conditions.push({ type: 'workspace_empty' });
      onChange(condition);
      renderConditionFields(container, condition, onChange);
    });
  }
}

function bindConditionInputs(container, condition, onChange) {
  const bindInput = (selector, field, transform) => {
    const el = container.querySelector(selector);
    if (el) {
      el.addEventListener('input', (e) => {
        condition[field] = transform ? transform(e.target.value) : e.target.value;
        onChange(condition);
      });
    }
  };

  bindInput('.cond-block-type', 'block_type');
  bindInput('.cond-min-count', 'min_count', (v) => parseInt(v) || 1);
  bindInput('.cond-upper-type', 'upper_type');
  bindInput('.cond-lower-type', 'lower_type');
  bindInput('.cond-outer-type', 'outer_type');
  bindInput('.cond-inner-type', 'inner_type');
  bindInput('.cond-input-name', 'input_name');
  bindInput('.cond-field-name', 'field_name');
  bindInput('.cond-expected', 'expected_value');
  bindInput('.cond-min', 'min', (v) => parseInt(v) || 0);
  bindInput('.cond-max', 'max', (v) => parseInt(v) || 10);
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

function bindCheckboxField(id, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', (e) => {
    setter(e.target.checked);
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
