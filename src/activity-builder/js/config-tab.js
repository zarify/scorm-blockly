/**
 * Config Tab — Metadata, instructions, and UI settings.
 */

import { getConfig, notifyChange, onConfigChange } from './builder-app.js';

let lastConfigRef = null;

export function initConfigTab() {
  lastConfigRef = getConfig();

  // Bind metadata fields
  bindInput('cfg-title', (val) => {
    const cfg = getConfig();
    cfg.metadata.title = val;
    cfg.metadata.activity_id = slugify(val);
    document.getElementById('cfg-activity-id').value = cfg.metadata.activity_id;
  });

  bindInput('cfg-version', (val) => { getConfig().metadata.version = val; });
  bindInput('cfg-description', (val) => { getConfig().metadata.description = val; });

  // Instructions
  bindInput('cfg-instructions-main', (val) => { getConfig().instructions.main = val; });
  initStepsList();

  // UI Settings
  bindCheckbox('cfg-show-code', (val) => { getConfig().ui_settings.show_code_toggle = val; });
  bindCheckbox('cfg-show-hints', (val) => { getConfig().ui_settings.show_hint_panel = val; });
  bindInput('cfg-max-attempts', (val) => {
    getConfig().ui_settings.max_attempts = val ? parseInt(val, 10) : null;
  });

  onConfigChange((newCfg) => {
    if (newCfg === lastConfigRef) return;
    populateFromConfig(newCfg);
    lastConfigRef = newCfg;
  });
}

function populateFromConfig(cfg) {
  document.getElementById('cfg-title').value = cfg.metadata?.title || '';
  document.getElementById('cfg-activity-id').value = cfg.metadata?.activity_id || '';
  document.getElementById('cfg-version').value = cfg.metadata?.version || '1.0';
  document.getElementById('cfg-description').value = cfg.metadata?.description || '';
  document.getElementById('cfg-instructions-main').value = cfg.instructions?.main || '';
  document.getElementById('cfg-show-code').checked = cfg.ui_settings?.show_code_toggle === true;
  document.getElementById('cfg-show-hints').checked = cfg.ui_settings?.show_hint_panel !== false;
  document.getElementById('cfg-max-attempts').value = cfg.ui_settings?.max_attempts || '';
  renderSteps(cfg.instructions?.steps || []);
}

function initStepsList() {
  document.getElementById('btn-add-step').addEventListener('click', () => {
    const cfg = getConfig();
    if (!cfg.instructions.steps) cfg.instructions.steps = [];
    cfg.instructions.steps.push('');
    renderSteps(cfg.instructions.steps);
    notifyChange();
  });
  renderSteps(getConfig().instructions?.steps || []);
}

function renderSteps(steps) {
  const container = document.getElementById('instruction-steps-list');
  container.innerHTML = '';
  steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'step-item';
    div.innerHTML = `
      <span style="color:#999;font-size:12px;width:20px">${i + 1}.</span>
      <input type="text" value="${escapeAttr(step)}" placeholder="Step ${i + 1}...">
      <button class="step-remove" title="Remove step">✕</button>
    `;
    div.querySelector('input').addEventListener('input', (e) => {
      getConfig().instructions.steps[i] = e.target.value;
      notifyChange();
    });
    div.querySelector('.step-remove').addEventListener('click', () => {
      getConfig().instructions.steps.splice(i, 1);
      renderSteps(getConfig().instructions.steps);
      notifyChange();
    });
    container.appendChild(div);
  });
}

function bindInput(id, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', (e) => {
    setter(e.target.value);
    notifyChange();
  });
}

function bindCheckbox(id, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', (e) => {
    setter(e.target.checked);
    notifyChange();
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50);
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
