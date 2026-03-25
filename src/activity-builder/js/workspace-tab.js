/**
 * Workspace Tab — Visual starter blocks designer.
 *
 * Provides a full Blockly workspace where the author can arrange blocks
 * that will appear as the starting state for students.
 */

import { getConfig, notifyChange, onConfigChange, Blockly } from './builder-app.js';

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
  const categories = [
    { name: 'Logic', colour: '#5C81A6', blocks: [
      'controls_if', 'controls_ifelse', 'logic_compare', 'logic_operation',
      'logic_negate', 'logic_boolean', 'logic_null', 'logic_ternary',
    ]},
    { name: 'Loops', colour: '#5CA65C', blocks: [
      'controls_repeat_ext', 'controls_repeat', 'controls_whileUntil',
      'controls_for', 'controls_forEach', 'controls_flow_statements',
    ]},
    { name: 'Math', colour: '#5C68A6', blocks: [
      'math_number', 'math_arithmetic', 'math_single', 'math_trig',
      'math_constant', 'math_number_property', 'math_round',
      'math_on_list', 'math_modulo', 'math_constrain',
      'math_random_int', 'math_random_float',
    ]},
    { name: 'Text', colour: '#5CA68D', blocks: [
      'text', 'text_multiline', 'text_join', 'text_append',
      'text_length', 'text_isEmpty', 'text_indexOf', 'text_charAt',
      'text_getSubstring', 'text_changeCase', 'text_trim',
      'text_count', 'text_replace', 'text_reverse', 'text_print',
    ]},
    { name: 'Lists', colour: '#745CA6', blocks: [
      'lists_create_with', 'lists_repeat', 'lists_length',
      'lists_isEmpty', 'lists_indexOf', 'lists_getIndex',
      'lists_setIndex', 'lists_getSublist', 'lists_split',
      'lists_sort', 'lists_reverse',
    ]},
    { name: 'Variables', colour: '#A65C81', custom: 'VARIABLE' },
    { name: 'Functions', colour: '#995BA5', custom: 'PROCEDURE' },
  ];

  return {
    kind: 'categoryToolbox',
    contents: categories.map((cat) => {
      if (cat.custom) {
        return { kind: 'category', name: cat.name, colour: cat.colour, custom: cat.custom };
      }
      return {
        kind: 'category',
        name: cat.name,
        colour: cat.colour,
        contents: cat.blocks.map((type) => ({ kind: 'block', type })),
      };
    }),
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
