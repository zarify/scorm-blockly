/**
 * Hints Tab — Hint condition builder.
 */

import { getConfig, notifyChange, onConfigChange, Blockly } from './builder-app.js';
import { BLOCK_PATTERN_TYPE } from '../../shared/block-pattern.js';
import {
  createConditionSuggestionIds,
  getConditionBlockDefinitionMetadata,
  getSuggestedConditionBlockTypes,
} from './condition-suggestions.js';
import { renderPatternBuilder } from './pattern-builder.js';

let selectedHintIndex = -1;
let lastConfigRef = null;

const CONDITION_TYPES = [
  { value: 'block_exists', label: 'Block exists' },
  { value: 'block_missing', label: 'Block missing' },
  { value: BLOCK_PATTERN_TYPE, label: 'Visual block pattern' },
  { value: 'block_count', label: 'Block count in range' },
  { value: 'workspace_empty', label: 'Workspace is empty' },
  { value: 'all', label: 'ALL conditions (AND)' },
  { value: 'any', label: 'ANY condition (OR)' },
  { value: 'none', label: 'NONE of conditions (NOT)' },
];

const LEGACY_CONDITION_TYPES = {
  block_connected: 'Blocks connected (sequential) — legacy',
  block_nested: 'Block inside another block input subtree — legacy',
  block_field_value: 'Block field matches value/pattern — legacy',
};

const TRIGGER_EVENTS = [
  { value: 'workspace_change', label: 'Workspace changes' },
  { value: 'test_fail', label: 'Test run fails' },
  { value: 'manual', label: 'Student requests hint' },
  { value: 'timed', label: 'After time delay' },
];

const HINT_DISPLAY_MODES = [
  { value: 'triggered', label: 'Hidden until triggered' },
  { value: 'checklist', label: 'Always visible checklist item' },
];

export function initHintsTab() {
  document.getElementById('btn-add-hint').addEventListener('click', addHint);
  lastConfigRef = getConfig();
  onConfigChange(() => {
    const config = getConfig();
    if (config === lastConfigRef) return;

    const hints = config.hints || [];
    if (selectedHintIndex >= hints.length) {
      selectedHintIndex = hints.length - 1;
    }

    renderHintList();
    renderHintEditor();
    lastConfigRef = config;
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
    display_mode: 'triggered',
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
      <span class="list-item-title">${escapeHtml(getHintListTitle(hint.message))}</span>
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
      <label>Display Mode</label>
      <select id="hint-display-mode">
        ${HINT_DISPLAY_MODES.map((mode) => `<option value="${mode.value}" ${getHintDisplayMode(hint) === mode.value ? 'selected' : ''}>${mode.label}</option>`).join('')}
      </select>
      <small>${getHintDisplayMode(hint) === 'checklist'
        ? 'Checklist items stay visible in the sidebar and tick off once triggered.'
        : 'Triggered hints stay hidden until their trigger conditions fire.'}</small>
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
      <input type="checkbox" id="hint-show-once" ${hint.show_once ? 'checked' : ''} ${getHintDisplayMode(hint) === 'checklist' ? 'disabled' : ''}>
      ${getHintDisplayMode(hint) === 'checklist'
        ? 'Show once does not apply to checklist items'
        : "Show once (don't re-show after dismissal)"}
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
  bindField('hint-message', (v) => {
    hint.message = v;
    updateHintListTitle(selectedHintIndex, v);
  });
  bindField('hint-display-mode', (v) => {
    hint.display_mode = v === 'checklist' ? 'checklist' : 'triggered';
    if (hint.display_mode === 'checklist') {
      hint.show_once = false;
    }
    renderHintEditor();
  });
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
          ${getConditionTypeOptions(condition.type).map((ct) => `<option value="${ct.value}" ${condition.type === ct.value ? 'selected' : ''}>${ct.label}</option>`).join('')}
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
    } else if (newType === BLOCK_PATTERN_TYPE) {
      newCondition.workspace_state = null;
      newCondition.field_constraints = {};
    }
    onChange(newCondition);
    renderConditionBuilder(container, newCondition, onChange);
  });

  renderConditionFields(fieldsDiv, condition, onChange);
}

function renderConditionFields(container, condition, onChange) {
  const datalistIds = createConditionSuggestionIds('hint-condition');
  const blockTypeOptions = getSuggestedConditionBlockTypes(Blockly, getConfig())
    .map((blockType) => `<option value="${escapeAttr(blockType)}"></option>`)
    .join('');
  const outerBlockMetadata = getConditionBlockDefinitionMetadata(Blockly, condition.outer_type);
  const innerBlockMetadata = getConditionBlockDefinitionMetadata(Blockly, condition.inner_type);
  const conditionBlockMetadata = getConditionBlockDefinitionMetadata(Blockly, condition.block_type);
  let html = '';

  switch (condition.type) {
    case 'block_exists':
    case 'block_missing':
      html = `
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <div class="condition-row">
          <label>Block type:</label>
          <input type="text" class="cond-block-type" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.block_type || '')}" placeholder="e.g. controls_repeat_ext">
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
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <div class="condition-row">
          <label>Upper block:</label>
          <input type="text" class="cond-upper-type" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.upper_type || '')}" placeholder="e.g. controls_for">
        </div>
        <div class="condition-row">
          <label>Lower block:</label>
          <input type="text" class="cond-lower-type" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.lower_type || '')}" placeholder="e.g. text_print">
        </div>
      `;
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
        <div class="condition-row">
          <label>Parent block:</label>
          <input type="text" class="cond-outer-type" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.outer_type || '')}" placeholder="e.g. controls_repeat_ext">
        </div>
        <div class="condition-row">
          <label>Matched descendant block:</label>
          <input type="text" class="cond-inner-type" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.inner_type || '')}" placeholder="e.g. text_print">
        </div>
        <div class="condition-row">
          <label>Outer block input name:</label>
          <input type="text" class="cond-input-name" list="${datalistIds.inputNames}" value="${escapeAttr(condition.input_name || '')}" placeholder="e.g. DO or VALUE">
        </div>
        <p style="font-size:12px;color:#666;margin:8px 0 0">
          Use the input on the <strong>outer</strong> block that this subtree hangs from. For example,
          <code>variables_set.VALUE</code> matches the whole value plugged into "set ... to", while
          <code>text_prompt_ext.TEXT</code> matches the prompt message input.
        </p>
        <div class="condition-row" style="margin-top:12px">
          <label>Matched descendant field name (optional):</label>
          <input type="text" class="cond-desc-field-name" list="${datalistIds.fieldNames}" value="${escapeAttr(condition.field_name || '')}" placeholder="e.g. TEXT">
        </div>
        ${condition.field_name
          ? `
        <div class="condition-row">
          <label>${(condition.match_mode || 'exact') === 'regex' ? 'Regex pattern:' : 'Expected descendant field value:'}</label>
          <input type="text" class="cond-desc-expected" value="${escapeAttr(String(condition.expected_value ?? ''))}" placeholder="${(condition.match_mode || 'exact') === 'regex' ? 'e.g. Who.*\\?' : `e.g. Who's there?`}">
        </div>
        <div class="condition-row">
          <label>Descendant value match mode:</label>
          <select class="cond-desc-match-mode">
            <option value="exact" ${(condition.match_mode || 'exact') === 'exact' ? 'selected' : ''}>Exact value</option>
            <option value="regex" ${(condition.match_mode || 'exact') === 'regex' ? 'selected' : ''}>Regex (full match)</option>
          </select>
        </div>
        ${(condition.match_mode || 'exact') === 'regex' ? `
        <div class="condition-row">
          <label>Regex flags:</label>
          <input type="text" class="cond-desc-regex-flags" value="${escapeAttr(condition.regex_flags || '')}" placeholder="e.g. i">
        </div>` : ''}
        <p style="font-size:12px;color:#666;margin:8px 0 0">
          This value constraint is checked only on matching <code>${escapeHtml(condition.inner_type || 'inner_type')}</code> descendants inside
          <code>${escapeHtml(condition.outer_type || 'outer_type')}.${escapeHtml(condition.input_name || 'input_name')}</code>.
        </p>`
          : ''}
        ${outerBlockMetadata.inputNames.length > 0
          ? `<p style="font-size:12px;color:#666;margin:8px 0 0">Inputs on ${escapeHtml(condition.outer_type || 'this block')}: ${outerBlockMetadata.inputNames.join(', ')}. This works for statement inputs like DO and value inputs like VALUE or TEXT.</p>`
          : ''}
        ${innerBlockMetadata.fieldNames.length > 0
          ? `<p style="font-size:12px;color:#666;margin:8px 0 0">Fields on ${escapeHtml(condition.inner_type || 'this block')}: ${innerBlockMetadata.fieldNames.join(', ')}</p>`
          : ''}
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
        <div class="condition-row">
          <label>Block type:</label>
          <input type="text" class="cond-block-type" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.block_type || '')}">
        </div>
        <div class="condition-row">
          <label>Field name:</label>
          <input type="text" class="cond-field-name" list="${datalistIds.fieldNames}" value="${escapeAttr(condition.field_name || '')}">
        </div>
        <div class="condition-row">
          <label>${(condition.match_mode || 'exact') === 'regex' ? 'Regex pattern:' : 'Expected value:'}</label>
          <input type="text" class="cond-expected" value="${escapeAttr(String(condition.expected_value || ''))}" placeholder="${(condition.match_mode || 'exact') === 'regex' ? 'e.g. Who.*\\?' : 'e.g. Hello'}">
        </div>
        <div class="condition-row">
          <label>Value match mode:</label>
          <select class="cond-match-mode">
            <option value="exact" ${(condition.match_mode || 'exact') === 'exact' ? 'selected' : ''}>Exact value</option>
            <option value="regex" ${(condition.match_mode || 'exact') === 'regex' ? 'selected' : ''}>Regex (full match)</option>
          </select>
        </div>
        ${(condition.match_mode || 'exact') === 'regex' ? `
        <div class="condition-row">
          <label>Regex flags:</label>
          <input type="text" class="cond-regex-flags" value="${escapeAttr(condition.regex_flags || '')}" placeholder="e.g. i">
        </div>` : ''}
        <p style="font-size:12px;color:#666;margin:8px 0 0">
          Regex mode matches the <strong>entire</strong> field value, not a substring. Use patterns like
          <code>.*</code> as a wildcard, or flags like <code>i</code> for case-insensitive matching.
        </p>
        ${conditionBlockMetadata.fieldNames.length > 0
          ? `<p style="font-size:12px;color:#666;margin:8px 0 0">Fields on ${escapeHtml(condition.block_type || 'this block')}: ${conditionBlockMetadata.fieldNames.join(', ')}</p>`
          : ''}
      `;
      break;

    case 'block_count':
      html = `
        <datalist id="${datalistIds.blockTypes}">${blockTypeOptions}</datalist>
        <div class="condition-row">
          <label>Block type:</label>
          <input type="text" class="cond-block-type" list="${datalistIds.blockTypes}" value="${escapeAttr(condition.block_type || '')}">
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

  if (condition.type === BLOCK_PATTERN_TYPE) {
    const patternContainer = container.querySelector('.pattern-builder-mount');
    if (patternContainer) {
      renderPatternBuilder(patternContainer, condition, onChange);
    }
    return;
  }

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
  const bindInput = (selector, field, transform, options = {}) => {
    const el = container.querySelector(selector);
    if (el) {
      const event = options.event || 'input';
      el.addEventListener(event, (e) => {
        const nextValue = transform ? transform(e.target.value) : e.target.value;
        condition[field] = nextValue;
        options.afterChange?.(condition, nextValue);
        onChange(condition);
        if (options.rerenderFields) {
          renderConditionFields(container, condition, onChange);
        }
      });
    }
  };

  bindInput('.cond-block-type', 'block_type', undefined, {
    event: condition.type === 'block_field_value' ? 'change' : 'input',
    rerenderFields: condition.type === 'block_field_value',
  });
  bindInput('.cond-min-count', 'min_count', (v) => parseInt(v) || 1);
  bindInput('.cond-upper-type', 'upper_type');
  bindInput('.cond-lower-type', 'lower_type');
  bindInput('.cond-outer-type', 'outer_type', undefined, {
    event: 'change',
    rerenderFields: true,
  });
  bindInput('.cond-inner-type', 'inner_type', undefined, {
    event: 'change',
    rerenderFields: true,
  });
  bindInput('.cond-input-name', 'input_name');
  bindInput('.cond-desc-field-name', 'field_name', undefined, {
    event: 'change',
    afterChange: (currentCondition, nextValue) => {
      if (!String(nextValue).trim()) {
        delete currentCondition.expected_value;
        delete currentCondition.match_mode;
        delete currentCondition.regex_flags;
      } else if (!currentCondition.match_mode) {
        currentCondition.match_mode = 'exact';
      }
    },
    rerenderFields: true,
  });
  bindInput('.cond-desc-expected', 'expected_value');
  bindInput('.cond-desc-match-mode', 'match_mode', undefined, {
    event: 'change',
    rerenderFields: true,
  });
  bindInput('.cond-desc-regex-flags', 'regex_flags');
  bindInput('.cond-field-name', 'field_name');
  bindInput('.cond-expected', 'expected_value');
  bindInput('.cond-match-mode', 'match_mode', undefined, {
    event: 'change',
    rerenderFields: true,
  });
  bindInput('.cond-regex-flags', 'regex_flags');
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

function getHintListTitle(message) {
  const safeMessage = typeof message === 'string' ? message : String(message ?? '');
  return `${safeMessage.substring(0, 50)}${safeMessage.length > 50 ? '...' : ''}`;
}

function updateHintListTitle(index, message) {
  const title = document.querySelector(`.list-item[data-index="${index}"] .list-item-title`);
  if (!title) return;
  title.textContent = getHintListTitle(message);
}

function getHintDisplayMode(hint) {
  return hint.display_mode === 'checklist' ? 'checklist' : 'triggered';
}

function getConditionTypeOptions(currentType) {
  if (!currentType || CONDITION_TYPES.some((type) => type.value === currentType)) {
    return CONDITION_TYPES;
  }
  return [
    ...CONDITION_TYPES,
    { value: currentType, label: LEGACY_CONDITION_TYPES[currentType] || `${currentType} — legacy` },
  ];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
