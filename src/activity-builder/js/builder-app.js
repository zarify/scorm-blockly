/**
 * Builder App — Main controller for the Activity Builder tool.
 *
 * Manages tab navigation, central config state, and coordinates all tab modules.
 */

import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import { validateConfig } from '../../shared/config-validator.js';
import { createDefaultToolboxCategories } from '../../shared/blockly-toolbox.js';
import { initConfigTab } from './config-tab.js';
import { initToolboxTab } from './toolbox-tab.js';
import { initWorkspaceTab } from './workspace-tab.js';
import { initHintsTab } from './hints-tab.js';
import { initTestsTab } from './tests-tab.js';
import { initPreviewTab } from './preview-tab.js';
import { exportJSON, exportSCORM, importConfig } from './export.js';

// Central config state — this is the config being built
const state = {
  config: createDefaultConfig(),
  activeTab: 'config',
  /** @type {function[]} */
  changeListeners: [],
};

function createDefaultConfig() {
  return {
    metadata: {
      activity_id: '',
      title: '',
      version: '1.0',
      description: '',
    },
    instructions: {
      main: '',
      steps: [],
    },
    ui_settings: {
      theme: 'default',
      show_code_toggle: true,
      show_hint_panel: true,
      max_attempts: null,
    },
    blockly_setup: {
      toolbox: { categories: createDefaultToolboxCategories() },
      starting_blocks: null,
      max_blocks: null,
      disabled_blocks: [],
    },
    hints: [],
    evaluation: {
      grading_mode: 'weighted',
      max_score: 100,
      test_cases: [],
    },
  };
}

/** Get current config (returns reference — tab modules modify in place). */
export function getConfig() {
  return state.config;
}

/** Replace entire config (used by import). */
export function setConfig(newConfig) {
  state.config = newConfig;
  notifyChange();
}

/** Notify all listeners that config changed. */
export function notifyChange() {
  for (const listener of state.changeListeners) {
    listener(state.config);
  }
}

/** Register a change listener. */
export function onConfigChange(fn) {
  state.changeListeners.push(fn);
}

/** Show a toast notification. */
export function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

/** Export Blockly reference for tab modules. */
export { Blockly, javascriptGenerator };

// — Initialization —

function init() {
  setupTabs();
  setupHeaderActions();

  // Initialize all tab modules
  initConfigTab();
  initToolboxTab();
  initWorkspaceTab();
  initHintsTab();
  initTestsTab();
  initPreviewTab();
}

function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      state.activeTab = tabId;

      tabBtns.forEach((b) => b.classList.remove('active'));
      tabPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');

      // Notify tabs that might need to resize (Blockly workspaces)
      window.dispatchEvent(new Event('resize'));
      // Fire a custom event for tabs that need to know they're now visible
      window.dispatchEvent(new CustomEvent('tab-activated', { detail: { tab: tabId } }));
    });
  });
}

function setupHeaderActions() {
  document.getElementById('btn-export-json').addEventListener('click', () => {
    const validation = validateConfig(state.config);
    if (!validation.valid) {
      showToast(`Config has ${validation.errors.length} error(s) — check all tabs`, 'error');
    }
    exportJSON(state.config);
    showToast('Config exported as JSON', 'success');
  });

  document.getElementById('btn-export-scorm').addEventListener('click', async () => {
    const validation = validateConfig(state.config);
    if (!validation.valid) {
      showToast(`Fix ${validation.errors.length} error(s) before exporting SCORM`, 'error');
      return;
    }
    await exportSCORM(state.config);
    showToast('SCORM package exported!', 'success');
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });

  document.getElementById('file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const config = await importConfig(file);
      setConfig(config);
      showToast('Config imported successfully', 'success');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
    e.target.value = ''; // Reset file input
  });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
