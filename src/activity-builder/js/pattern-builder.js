import { Blockly, getConfig } from './builder-app.js';
import { getComparableFieldValue, isVariableField } from '../../shared/blockly-field-values.js';
import {
  buildCategoryToolboxContents,
  createAuthoringToolboxCategories,
} from '../../shared/blockly-toolbox.js';
import {
  createPatternToolboxCategory,
  getBlockParamCount,
  isPatternWildcardType,
  isProcedureBlockType,
  normalizeParamCountComparison,
  PARAM_COUNT_COMPARISON_OPTIONS,
  registerBlockPatternBlocks,
} from '../../shared/block-pattern.js';
import {
  FIELD_VALUE_MATCH_MODE_OPTIONS,
  getCanonicalRegexFlags,
  isRegexFieldValueMatchMode,
  normalizeFieldValueCaseSensitivity,
  normalizeFieldValueMatchMode,
} from '../../shared/field-value-matching.js';

registerBlockPatternBlocks(Blockly);

let nextPatternBuilderId = 0;

export function renderPatternBuilder(container, condition, onChange) {
  ensurePatternConditionDefaults(condition);
  let activeBlockId = null;

  nextPatternBuilderId += 1;
  const workspaceId = `pattern-workspace-${nextPatternBuilderId}`;
  const inspectorId = `pattern-inspector-${nextPatternBuilderId}`;
  const statusId = `pattern-status-${nextPatternBuilderId}`;

  container.innerHTML = `
    <div class="pattern-builder">
      <div class="pattern-builder-help">
        Build the structure visually with real Blockly blocks. Add <strong>any block(s)</strong> or
        <strong>any value</strong> from the Pattern category when you want a wildcard gap.
      </div>
      <div class="pattern-builder-toolbar">
        <button type="button" class="btn btn-small btn-secondary pattern-clear-btn">Clear Pattern</button>
        <span id="${statusId}" class="pattern-builder-status"></span>
      </div>
      <div class="pattern-builder-layout">
        <div id="${workspaceId}" class="pattern-workspace"></div>
        <div id="${inspectorId}" class="pattern-inspector"></div>
      </div>
    </div>
  `;

  const workspaceEl = document.getElementById(workspaceId);
  const inspectorEl = document.getElementById(inspectorId);
  const statusEl = document.getElementById(statusId);
  if (!workspaceEl || !inspectorEl || !statusEl) return;

  ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach((eventName) => {
    inspectorEl.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });

  const workspace = Blockly.inject(workspaceEl, {
    toolbox: buildPatternToolbox(),
    grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
    zoom: { controls: true, wheel: true, startScale: 1.0, maxScale: 3, minScale: 0.3 },
    trashcan: true,
    scrollbars: true,
    sounds: false,
  });

  let suppressSync = true;
  try {
    if (condition.workspace_state) {
      Blockly.serialization.workspaces.load(condition.workspace_state, workspace);
    }
  } catch (err) {
    console.warn('[PatternBuilder] Failed to load pattern workspace:', err);
  } finally {
    suppressSync = false;
  }

  pruneFieldConstraints(condition, workspace);
  syncWorkspaceState();
  bindInspectorEvents();
  renderInspector();

  workspace.addChangeListener((event) => {
    if (suppressSync) return;

    const uiSelectedBlock = getSelectedBlock(workspace);
    if (uiSelectedBlock) {
      activeBlockId = uiSelectedBlock.id;
    } else if (activeBlockId && !workspace.getBlockById(activeBlockId)) {
      activeBlockId = null;
    }

    if (event?.isUiEvent) {
      if (uiSelectedBlock) {
        renderInspector();
      }
      return;
    }

    pruneFieldConstraints(condition, workspace);
    syncWorkspaceState();
    renderInspector();
  });

  container.querySelector('.pattern-clear-btn')?.addEventListener('click', () => {
    workspace.clear();
    activeBlockId = null;
    condition.workspace_state = null;
    condition.field_constraints = {};
    condition.param_constraints = {};
    onChange(condition);
    renderInspector();
    updateStatus();
  });

  function syncWorkspaceState() {
    const nextState = serializeWorkspace(workspace);
    // Mounting the builder must not notify: a nested notifyChange while a
    // listener is still rendering re-enters that listener (see hints/tests tabs).
    const changed = !isSameWorkspaceState(nextState, condition.workspace_state);
    condition.workspace_state = nextState;
    if (!condition.workspace_state) {
      condition.field_constraints = {};
      condition.param_constraints = {};
    }
    if (changed) {
      onChange(condition);
    }
    updateStatus();
  }

  function renderInspector() {
    const selectedBlock = getInspectorBlock(workspace, activeBlockId);
    activeBlockId = selectedBlock?.id || activeBlockId;
    if (!selectedBlock) {
      inspectorEl.innerHTML = `
        <div class="pattern-inspector-card">
          <h3>Pattern block settings</h3>
          <p class="placeholder-text">Select a block in the pattern workspace to add optional field constraints.</p>
        </div>
      `;
      return;
    }

    if (isPatternWildcardType(selectedBlock.type)) {
      inspectorEl.innerHTML = `
        <div class="pattern-inspector-card">
          <h3>Pattern block settings</h3>
          <p><strong>${escapeHtml(selectedBlock.type)}</strong></p>
          <p class="pattern-muted">Wildcard blocks match structure only. They do not have field-value constraints.</p>
        </div>
      `;
      return;
    }

    // Blockly 12.5 returns an iterator from getFields(), which has no join().
    const fields = [...(selectedBlock.getFields?.() || [])].filter((field) => field?.name);
    const blockConstraints = getBlockConstraints(condition, selectedBlock.id);

    inspectorEl.innerHTML = `
      <div class="pattern-inspector-card">
        <h3>Pattern block settings</h3>
        <p><strong>Selected block:</strong> <code>${escapeHtml(selectedBlock.type)}</code></p>
        ${fields.length === 0
          ? '<p class="pattern-muted">This block has no configurable fields to constrain.</p>'
          : fields
            .map((field) => renderFieldConstraintEditor(selectedBlock, field, blockConstraints[field.name]))
            .join('')}
        ${isProcedureBlockType(selectedBlock.type)
          ? renderParamCountEditor(selectedBlock, getParamConstraint(condition, selectedBlock.id))
          : ''}
      </div>
    `;

  }

  function bindInspectorEvents() {
    inspectorEl.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

      const selectedBlock = getInspectorBlock(workspace, activeBlockId);
      if (!selectedBlock) return;

      if (target.matches('[data-field-enable]')) {
        const fieldName = target.getAttribute('data-field-enable');
        if (!fieldName) return;

        if (target.checked) {
          setFieldConstraint(condition, selectedBlock.id, fieldName, {
            expected_value: String(getComparableFieldValue(selectedBlock, fieldName) ?? ''),
            match_mode: 'exact',
            case_sensitive: true,
            regex_flags: '',
          });
        } else {
          clearFieldConstraint(condition, selectedBlock.id, fieldName);
        }

        onChange(condition);
        renderInspector();
        return;
      }

      if (target.matches('[data-param-count-enable]')) {
        if (!(target instanceof HTMLInputElement)) return;

        if (target.checked) {
          setParamConstraint(condition, selectedBlock.id, {
            count: getBlockParamCount(selectedBlock),
            comparison: 'equals',
          });
        } else {
          clearParamConstraint(condition, selectedBlock.id);
        }

        onChange(condition);
        renderInspector();
        return;
      }

      if (target.matches('[data-param-count-comparison]')) {
        const current = getParamConstraint(condition, selectedBlock.id) || {
          count: getBlockParamCount(selectedBlock),
          comparison: 'equals',
        };
        setParamConstraint(condition, selectedBlock.id, {
          ...current,
          comparison: target.value,
        });
        onChange(condition);
        return;
      }

      if (target.matches('[data-field-mode]')) {
        const fieldName = target.getAttribute('data-field-mode');
        if (!fieldName) return;

        setFieldConstraintValue(condition, selectedBlock.id, fieldName, 'match_mode', target.value);
        onChange(condition);
        renderInspector();
        return;
      }

      if (target.matches('[data-field-case-sensitive]')) {
        const fieldName = target.getAttribute('data-field-case-sensitive');
        if (!fieldName || !(target instanceof HTMLInputElement)) return;

        setFieldConstraintValue(condition, selectedBlock.id, fieldName, 'case_sensitive', target.checked);
        onChange(condition);
      }
    });

    inspectorEl.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;

      const selectedBlock = getInspectorBlock(workspace, activeBlockId);
      if (!selectedBlock) return;

      if (target.matches('[data-field-value]')) {
        const fieldName = target.getAttribute('data-field-value');
        if (!fieldName) return;

        setFieldConstraintValue(condition, selectedBlock.id, fieldName, 'expected_value', target.value);
        onChange(condition);
        return;
      }

      if (target.matches('[data-param-count-value]')) {
        const current = getParamConstraint(condition, selectedBlock.id) || {
          count: getBlockParamCount(selectedBlock),
          comparison: 'equals',
        };
        setParamConstraint(condition, selectedBlock.id, {
          ...current,
          count: Math.max(0, parseInt(target.value, 10) || 0),
        });
        onChange(condition);
        return;
      }

      if (target.matches('[data-field-flags]')) {
        const fieldName = target.getAttribute('data-field-flags');
        if (!fieldName) return;

        setFieldConstraintValue(condition, selectedBlock.id, fieldName, 'regex_flags', target.value);
        onChange(condition);
      }
    });
  }

  function updateStatus() {
    const topBlocks = workspace.getTopBlocks(false).length;
    const totalBlocks = workspace.getAllBlocks(false).length;
    const rootWarning = topBlocks > 1 ? ' — keep one root block for a valid pattern' : '';
    statusEl.textContent = totalBlocks === 0
      ? 'No pattern blocks yet.'
      : `${totalBlocks} block(s), ${topBlocks} root block(s)${rootWarning}`;
  }
}

function buildPatternToolbox() {
  const categories = [createPatternToolboxCategory(), ...createAuthoringToolboxCategories()];
  return {
    kind: 'categoryToolbox',
    contents: buildCategoryToolboxContents(Blockly, categories, 'pattern builder'),
  };
}

function ensurePatternConditionDefaults(condition) {
  if (!condition.workspace_state) {
    condition.workspace_state = null;
  }
  if (!condition.field_constraints || typeof condition.field_constraints !== 'object') {
    condition.field_constraints = {};
  }
  if (!condition.param_constraints || typeof condition.param_constraints !== 'object') {
    condition.param_constraints = {};
  }
}

function serializeWorkspace(workspace) {
  return workspace.getAllBlocks(false).length > 0
    ? Blockly.serialization.workspaces.save(workspace)
    : null;
}

function isSameWorkspaceState(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function getSelectedBlock(workspace) {
  const selected = Blockly.getSelected?.();
  return selected?.workspace === workspace ? selected : null;
}

function getInspectorBlock(workspace, activeBlockId) {
  return getSelectedBlock(workspace) || (activeBlockId ? workspace.getBlockById(activeBlockId) : null);
}

function getBlockConstraints(condition, blockId) {
  return condition.field_constraints?.[blockId] || {};
}

function getParamConstraint(condition, blockId) {
  return condition.param_constraints?.[blockId] || null;
}

function setParamConstraint(condition, blockId, value) {
  if (!condition.param_constraints || typeof condition.param_constraints !== 'object') {
    condition.param_constraints = {};
  }
  condition.param_constraints[blockId] = value;
}

function clearParamConstraint(condition, blockId) {
  if (!condition.param_constraints?.[blockId]) return;
  delete condition.param_constraints[blockId];
}

function setFieldConstraint(condition, blockId, fieldName, value) {
  if (!condition.field_constraints || typeof condition.field_constraints !== 'object') {
    condition.field_constraints = {};
  }
  if (!condition.field_constraints[blockId]) {
    condition.field_constraints[blockId] = {};
  }
  condition.field_constraints[blockId][fieldName] = value;
}

function setFieldConstraintValue(condition, blockId, fieldName, key, value) {
  const current = getBlockConstraints(condition, blockId)[fieldName] || {
    expected_value: '',
    match_mode: 'exact',
    case_sensitive: true,
    regex_flags: '',
  };
  setFieldConstraint(condition, blockId, fieldName, {
    ...current,
    [key]: value,
  });
}

function clearFieldConstraint(condition, blockId, fieldName) {
  if (!condition.field_constraints?.[blockId]) return;
  delete condition.field_constraints[blockId][fieldName];
  if (Object.keys(condition.field_constraints[blockId]).length === 0) {
    delete condition.field_constraints[blockId];
  }
}

function pruneFieldConstraints(condition, workspace) {
  if (!condition.field_constraints || typeof condition.field_constraints !== 'object') {
    condition.field_constraints = {};
  }
  if (!condition.param_constraints || typeof condition.param_constraints !== 'object') {
    condition.param_constraints = {};
  }

  const blockIds = new Set(workspace.getAllBlocks(false).map((block) => block.id));
  for (const blockId of Object.keys(condition.field_constraints)) {
    if (!blockIds.has(blockId)) {
      delete condition.field_constraints[blockId];
    }
  }
  for (const blockId of Object.keys(condition.param_constraints)) {
    if (!blockIds.has(blockId)) {
      delete condition.param_constraints[blockId];
    }
  }
}

function renderFieldConstraintEditor(block, field, constraint) {
  const currentValue = String(getComparableFieldValue(block, field.name) ?? '');
  const enabled = Boolean(constraint);
  const matchMode = normalizeFieldValueMatchMode(constraint?.match_mode);
  const caseSensitive = normalizeFieldValueCaseSensitivity(
    constraint?.case_sensitive,
    constraint?.regex_flags,
  );
  const expectedValue = String(constraint?.expected_value ?? currentValue);
  const regexFlags = getCanonicalRegexFlags(constraint?.regex_flags);
  const variableFieldNote = isVariableField(block, field.name)
    ? '<div class="pattern-field-current">This matches the variable name shown to students/authors, not Blockly’s internal variable id.</div>'
    : '';

  return `
    <div class="pattern-field-editor">
      <label class="checkbox-label">
        <input type="checkbox" data-field-enable="${escapeAttr(field.name)}" ${enabled ? 'checked' : ''}>
        Match field <code>${escapeHtml(field.name)}</code>
      </label>
      <div class="pattern-field-current">Current block value: <code>${escapeHtml(currentValue)}</code></div>
      ${variableFieldNote}
      ${enabled ? `
        <div class="form-group">
          <label>${getFieldConstraintValueLabel(matchMode)}</label>
          <input type="text" data-field-value="${escapeAttr(field.name)}" value="${escapeAttr(expectedValue)}" placeholder="${escapeAttr(getFieldConstraintValuePlaceholder(matchMode))}">
        </div>
        <div class="form-group">
          <label>Comparison</label>
          <select data-field-mode="${escapeAttr(field.name)}">
            ${FIELD_VALUE_MATCH_MODE_OPTIONS.map((option) => `
              <option value="${option.value}" ${matchMode === option.value ? 'selected' : ''}>${option.label}</option>
            `).join('')}
          </select>
        </div>
        <label class="checkbox-label">
          <input type="checkbox" data-field-case-sensitive="${escapeAttr(field.name)}" ${caseSensitive ? 'checked' : ''}>
          Case sensitive
        </label>
        ${isRegexFieldValueMatchMode(matchMode) ? `
          <div class="form-group">
            <label>Extra regex flags</label>
            <input type="text" data-field-flags="${escapeAttr(field.name)}" value="${escapeAttr(regexFlags)}" placeholder="e.g. m">
            <small><code>i</code> is managed by the case-sensitive checkbox.</small>
          </div>
        ` : ''}
      ` : ''}
    </div>
  `;
}

function renderParamCountEditor(block, constraint) {
  const currentCount = getBlockParamCount(block);
  const enabled = Boolean(constraint);
  const comparison = normalizeParamCountComparison(constraint?.comparison);
  const count = enabled ? Number(constraint.count) : currentCount;
  const params = getParamNames(block);

  return `
    <div class="pattern-field-editor">
      <label class="checkbox-label">
        <input type="checkbox" data-param-count-enable ${enabled ? 'checked' : ''}>
        Match parameter count
      </label>
      <div class="pattern-field-current">
        Current signature: <code>${escapeHtml(`(${params.join(', ')})`)}</code> — ${currentCount} parameter(s)
      </div>
      ${enabled ? `
        <div class="form-group">
          <label>Comparison</label>
          <select data-param-count-comparison>
            ${PARAM_COUNT_COMPARISON_OPTIONS.map((option) => `
              <option value="${option.value}" ${comparison === option.value ? 'selected' : ''}>${option.label}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Parameter count</label>
          <input type="number" min="0" step="1" data-param-count-value value="${Number.isFinite(count) ? count : currentCount}">
          <small>Checked against the student's block, so parameter names are free.</small>
        </div>
      ` : ''}
    </div>
  `;
}

function getParamNames(block) {
  const state = block.saveExtraState?.();
  const params = Array.isArray(state?.params) ? state.params : [];
  return params
    .map((param) => (typeof param === 'string' ? param : param?.name))
    .filter((name) => typeof name === 'string' && name !== '');
}

function getFieldConstraintValueLabel(matchMode) {
  switch (normalizeFieldValueMatchMode(matchMode)) {
    case 'contains':
      return 'Expected substring';
    case 'regex_full':
    case 'regex_search':
      return 'Regex pattern';
    default:
      return 'Expected value';
  }
}

function getFieldConstraintValuePlaceholder(matchMode) {
  switch (normalizeFieldValueMatchMode(matchMode)) {
    case 'contains':
      return 'e.g. Hello';
    case 'regex_full':
    case 'regex_search':
      return 'e.g. Who.*\\?';
    default:
      return 'Expected field value';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
