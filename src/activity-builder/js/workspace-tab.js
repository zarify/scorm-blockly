/**
 * Workspace Tab — Visual starter blocks designer.
 *
 * Provides a full Blockly workspace where the author can arrange blocks
 * that will appear as the starting state for students.
 */

import { getConfig, notifyChange, onConfigChange, Blockly } from './builder-app.js';
import {
  buildCategoryToolboxContents,
  createAuthoringToolboxCategories,
} from '../../shared/blockly-toolbox.js';

let designerWorkspace = null;

export function initWorkspaceTab() {
  document.getElementById('btn-save-workspace').addEventListener('click', saveWorkspace);
  document.getElementById('btn-clear-workspace').addEventListener('click', clearWorkspace);

  onConfigChange((cfg) => {
    loadWorkspaceFromConfig(cfg);
  });

  // Initialize workspace when tab becomes visible
  window.addEventListener('tab-activated', (e) => {
    if (e.detail.tab === 'workspace') {
      ensureWorkspace();
    }
  });
}

function ensureWorkspace() {
  const container = document.getElementById('starter-workspace');
  if (!container || container.offsetParent === null) return;

  if (designerWorkspace) {
    Blockly.svgResize(designerWorkspace);
    return;
  }

  // Build a full toolbox with ALL blocks so the author can use anything
  const fullToolbox = buildFullToolbox();

  designerWorkspace = Blockly.inject(container, {
    toolbox: fullToolbox,
    grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
    zoom: { controls: true, wheel: true, startScale: 1.0, maxScale: 3, minScale: 0.3 },
    trashcan: true,
    scrollbars: true,
    sounds: false,
  });

  // Load existing starting blocks if any
  loadWorkspaceFromConfig(getConfig());

  // Track changes
  designerWorkspace.addChangeListener(() => updateStatus());
}

function buildFullToolbox() {
  const categories = createAuthoringToolboxCategories();

  return {
    kind: 'categoryToolbox',
    contents: buildCategoryToolboxContents(Blockly, categories, 'workspace starter toolbox'),
  };
}

function saveWorkspace() {
  if (!designerWorkspace) return;

  const blocks = designerWorkspace.getAllBlocks(false);
  if (blocks.length === 0) {
    getConfig().blockly_setup.starting_blocks = null;
  } else {
    getConfig().blockly_setup.starting_blocks = Blockly.serialization.workspaces.save(designerWorkspace);
  }

  notifyChange();
  updateStatus('Saved!');
}

function clearWorkspace() {
  if (!designerWorkspace) return;
  designerWorkspace.clear();
  updateStatus('Cleared');
}

function loadWorkspaceFromConfig(cfg) {
  if (!designerWorkspace) return;

  if (cfg.blockly_setup?.starting_blocks) {
    try {
      designerWorkspace.clear();
      Blockly.serialization.workspaces.load(cfg.blockly_setup.starting_blocks, designerWorkspace);
    } catch (err) {
      console.warn('[WorkspaceTab] Failed to load starting blocks:', err);
    }
  }
}

function updateStatus(message) {
  const el = document.getElementById('workspace-status');
  if (!el) return;

  if (message) {
    el.textContent = `✓ ${message}`;
    el.style.color = '#2e7d32';
    return;
  }

  if (!designerWorkspace) return;
  const blockCount = designerWorkspace.getAllBlocks(false).length;
  const saved = getConfig().blockly_setup.starting_blocks;
  const savedCount = saved ? 'saved' : 'not saved';
  el.textContent = `${blockCount} block(s) on workspace (${savedCount})`;
  el.style.color = '#666';
}
