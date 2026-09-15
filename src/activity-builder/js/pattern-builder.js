import { Blockly, getConfig } from './builder-app.js';
import { getComparableFieldValue, isVariableField } from '../../shared/blockly-field-values.js';
import {
  buildCategoryToolboxContents,
  createAuthoringToolboxCategories,
} from '../../shared/blockly-toolbox.js';
import {
  createPatternToolboxCategory,
  isPatternWildcardType,
  registerBlockPatternBlocks,
} from '../../shared/block-pattern.js';

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
    onChange(condition);
    renderInspector();
    updateStatus();
  });

  function syncWorkspaceState() {
    condition.workspace_state = serializeWorkspace(workspace);
    if (!condition.workspace_state) {
      condition.field_constraints = {};
    }
    onChange(condition);
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

    const fields = (selectedBlock.getFields?.() || []).filter((field) => field?.name);
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
      </div>
    `;

    bindInspectorEvents(selectedBlock, fields);
  }

  function bindInspectorEvents(selectedBlock, fields) {
    fields.forEach((field) => {
      const checkbox = inspectorEl.querySelector(`[data-field-enable="${field.name}"]`);
      checkbox?.addEventListener('change', (event) => {
        const enabled = event.target.checked;
        if (enabled) {
          setFieldConstraint(condition, selectedBlock.id, field.name, {
            expected_value: String(getComparableFieldValue(selectedBlock, field.name) ?? ''),
            match_mode: 'exact',
            regex_flags: '',
          });
        } else {
          clearFieldConstraint(condition, selectedBlock.id, field.name);
        }
        onChange(condition);
        renderInspector();
      });

      const valueInput = inspectorEl.querySelector(`[data-field-value="${field.name}"]`);
      valueInput?.addEventListener('input', (event) => {
        setFieldConstraintValue(condition, selectedBlock.id, field.name, 'expected_value', event.target.value);
        onChange(condition);
      });

      const modeSelect = inspectorEl.querySelector(`[data-field-mode="${field.name}"]`);
      modeSelect?.addEventListener('change', (event) => {
        setFieldConstraintValue(condition, selectedBlock.id, field.name, 'match_mode', event.target.value);
        onChange(condition);
        renderInspector();
      });

      const flagsInput = inspectorEl.querySelector(`[data-field-flags="${field.name}"]`);
      flagsInput?.addEventListener('input', (event) => {
        setFieldConstraintValue(condition, selectedBlock.id, field.name, 'regex_flags', event.target.value);
        onChange(condition);
      });
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
}

function serializeWorkspace(workspace) {
  return workspace.getAllBlocks(false).length > 0
    ? Blockly.serialization.workspaces.save(workspace)
    : null;
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
    return;
  }

  const blockIds = new Set(workspace.getAllBlocks(false).map((block) => block.id));
  for (const blockId of Object.keys(condition.field_constraints)) {
    if (!blockIds.has(blockId)) {
      delete condition.field_constraints[blockId];
    }
  }
}

function renderFieldConstraintEditor(block, field, constraint) {
  const currentValue = String(getComparableFieldValue(block, field.name) ?? '');
  const enabled = Boolean(constraint);
  const matchMode = constraint?.match_mode || 'exact';
  const expectedValue = String(constraint?.expected_value ?? currentValue);
  const regexFlags = String(constraint?.regex_flags ?? '');
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
          <label>Expected value</label>
          <input type="text" data-field-value="${escapeAttr(field.name)}" value="${escapeAttr(expectedValue)}" placeholder="Expected field value">
        </div>
        <div class="form-group">
          <label>Match mode</label>
          <select data-field-mode="${escapeAttr(field.name)}">
            <option value="exact" ${matchMode === 'exact' ? 'selected' : ''}>Exact value</option>
            <option value="regex" ${matchMode === 'regex' ? 'selected' : ''}>Regex (full match)</option>
          </select>
        </div>
        ${matchMode === 'regex' ? `
          <div class="form-group">
            <label>Regex flags</label>
            <input type="text" data-field-flags="${escapeAttr(field.name)}" value="${escapeAttr(regexFlags)}" placeholder="e.g. i">
          </div>
        ` : ''}
      ` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
