/**
 * Toolbox Tab — Category and block selection with live preview.
 */

import { getConfig, notifyChange, onConfigChange, showToast, Blockly } from './builder-app.js';
import {
  buildCategoryToolboxContents,
 createSeededToolboxCategories,
 DEFAULT_TOOLBOX_BLOCK_LIBRARY,
 getBlockTypesFromWorkspaceState,
 getDefaultCategoryColour,
} from '../../shared/blockly-toolbox.js';

let selectedCategoryIndex = -1;
let previewWorkspace = null;
let suppressLocalConfigSync = false;

export function initToolboxTab() {
  document.getElementById('btn-add-category').addEventListener('click', addCategory);
  document.getElementById('btn-seed-toolbox').addEventListener('click', seedToolboxFromWorkspace);
  document.getElementById('block-search').addEventListener('input', (e) => renderBlockList(e.target.value));

  onConfigChange(() => {
    if (suppressLocalConfigSync) return;
    renderCategoryList();
    if (selectedCategoryIndex >= 0) renderBlockList();
    updateSeedButtonState();
    updatePreview();
  });

  renderCategoryList();
  updateSeedButtonState();

  // Initialize preview workspace when tab becomes visible
  window.addEventListener('tab-activated', (e) => {
    if (e.detail.tab === 'toolbox') {
      updatePreview();
    }
  });
}

function addCategory() {
  const cfg = getConfig();
  const name = `Category ${cfg.blockly_setup.toolbox.categories.length + 1}`;
  cfg.blockly_setup.toolbox.categories.push({
    name,
    colour: getDefaultCategoryColour(cfg.blockly_setup.toolbox.categories.length),
    blocks: [],
  });
  emitLocalConfigChange();
  renderCategoryList();
  selectCategory(cfg.blockly_setup.toolbox.categories.length - 1);
}

function seedToolboxFromWorkspace() {
  const startingBlocks = getConfig().blockly_setup?.starting_blocks;
  if (!startingBlocks) {
    showToast('Save starting blocks in Workspace before seeding the toolbox.', 'error');
    return;
  }

  const blockTypes = getBlockTypesFromWorkspaceState(Blockly, startingBlocks)
    .filter((blockType) => Blockly.Blocks?.[blockType]);
  const seededCategories = createSeededToolboxCategories(blockTypes);

  if (seededCategories.length === 0) {
    showToast('No supported starter blocks were found to seed the toolbox.', 'error');
    return;
  }

  const confirmed = window.confirm(
    'Replace the current student toolbox with categories inferred from the saved Workspace blocks? You can customize the result afterward.',
  );
  if (!confirmed) return;

  getConfig().blockly_setup.toolbox.categories = seededCategories;
  selectedCategoryIndex = 0;
  emitLocalConfigChange();
  renderCategoryList();
  renderBlockList();
  updatePreview();
  showToast(`Toolbox seeded from Workspace (${blockTypes.length} block type(s)).`, 'success');
}

function removeCategory(index) {
  const cfg = getConfig();
  cfg.blockly_setup.toolbox.categories.splice(index, 1);
  if (selectedCategoryIndex >= cfg.blockly_setup.toolbox.categories.length) {
    selectedCategoryIndex = cfg.blockly_setup.toolbox.categories.length - 1;
  }
  emitLocalConfigChange();
  renderCategoryList();
  renderBlockList();
  updatePreview();
}

function selectCategory(index, { rerenderCategories = true } = {}) {
  selectedCategoryIndex = index;
  if (rerenderCategories) {
    renderCategoryList();
  } else {
    updateCategorySelectionUI();
  }
  renderBlockList();
}

function renderCategoryList() {
  const container = document.getElementById('category-list');
  const categories = getConfig().blockly_setup.toolbox.categories;

  container.innerHTML = categories.map((cat, i) => `
    <div class="category-item ${i === selectedCategoryIndex ? 'selected' : ''}" data-index="${i}">
      <div class="category-color" style="background:${cat.colour || '#999'}"></div>
      <input type="text" class="category-name-input" value="${escapeAttr(cat.name)}"
             style="border:none;background:transparent;font-size:14px;flex:1;min-width:0"
             data-index="${i}">
      <input type="color" value="${cat.colour || '#5C81A6'}" class="category-color-input"
             style="width:24px;height:24px;border:none;cursor:pointer;padding:0"
             data-index="${i}">
      <button class="category-remove" data-index="${i}" title="Remove category">✕</button>
    </div>
  `).join('');

  // Event delegation
  container.querySelectorAll('.category-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      selectCategory(parseInt(el.dataset.index));
    });
  });

  container.querySelectorAll('.category-name-input').forEach((el) => {
    el.addEventListener('focus', (e) => {
      selectCategory(parseInt(e.target.dataset.index), { rerenderCategories: false });
    });
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index);
      getConfig().blockly_setup.toolbox.categories[idx].name = e.target.value;
      emitLocalConfigChange();
      updateCurrentCategoryName();
      updatePreview();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCategory(parseInt(el.dataset.index), { rerenderCategories: false });
    });
  });

  container.querySelectorAll('.category-color-input').forEach((el) => {
    el.addEventListener('focus', (e) => {
      selectCategory(parseInt(e.target.dataset.index), { rerenderCategories: false });
    });
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index);
      getConfig().blockly_setup.toolbox.categories[idx].colour = e.target.value;
      emitLocalConfigChange();
      const categoryItem = e.target.closest('.category-item');
      const colorSwatch = categoryItem?.querySelector('.category-color');
      if (colorSwatch) {
        colorSwatch.style.background = e.target.value;
      }
      updatePreview();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCategory(parseInt(el.dataset.index), { rerenderCategories: false });
    });
  });

  container.querySelectorAll('.category-remove').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCategory(parseInt(el.dataset.index));
    });
  });
}

function renderBlockList(searchFilter = '') {
  const container = document.getElementById('block-list');
  const nameSpan = document.getElementById('current-category-name');

  if (selectedCategoryIndex < 0) {
    container.innerHTML = '<p class="placeholder-text">Select a category to add blocks.</p>';
    nameSpan.textContent = '';
    return;
  }

  const categories = getConfig().blockly_setup.toolbox.categories;
  if (selectedCategoryIndex >= categories.length) {
    selectedCategoryIndex = -1;
    container.innerHTML = '<p class="placeholder-text">Select a category.</p>';
    nameSpan.textContent = '';
    return;
  }

  const cat = categories[selectedCategoryIndex];
  nameSpan.textContent = `— ${cat.name}`;
  const selectedBlocks = new Set(cat.blocks);

  // Flatten all blocks from the library
  const allBlocks = [];
  for (const [libCat, blocks] of Object.entries(DEFAULT_TOOLBOX_BLOCK_LIBRARY)) {
    for (const blockType of blocks) {
      if (Blockly.Blocks?.[blockType]) {
        allBlocks.push({ type: blockType, category: libCat });
      }
    }
  }

  const filter = searchFilter.toLowerCase();
  const filtered = filter
    ? allBlocks.filter((b) => b.type.includes(filter) || b.category.toLowerCase().includes(filter))
    : allBlocks;

  container.innerHTML = filtered.map((block) => `
    <div class="block-item">
      <input type="checkbox" id="block-${block.type}" ${selectedBlocks.has(block.type) ? 'checked' : ''}
             data-block-type="${block.type}">
      <label for="block-${block.type}">
        <code>${block.type}</code>
        <small style="color:#999;margin-left:4px">(${block.category})</small>
      </label>
    </div>
  `).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const blockType = e.target.dataset.blockType;
      const cat = getConfig().blockly_setup.toolbox.categories[selectedCategoryIndex];
      if (e.target.checked) {
        if (!cat.blocks.includes(blockType)) cat.blocks.push(blockType);
      } else {
        cat.blocks = cat.blocks.filter((b) => b !== blockType);
      }
      emitLocalConfigChange();
      updatePreview();
    });
  });
}

function emitLocalConfigChange() {
  suppressLocalConfigSync = true;
  try {
    notifyChange();
  } finally {
    suppressLocalConfigSync = false;
  }
}

function updateSeedButtonState() {
  const button = document.getElementById('btn-seed-toolbox');
  if (!button) return;

  const hasSavedWorkspace = Boolean(getConfig().blockly_setup?.starting_blocks);
  button.disabled = !hasSavedWorkspace;
  button.title = hasSavedWorkspace
    ? 'Replace the current student toolbox with categories inferred from the saved Workspace blocks'
    : 'Save starting blocks in the Workspace tab first';
}

function updateCategorySelectionUI() {
  const container = document.getElementById('category-list');
  if (!container) return;

  container.querySelectorAll('.category-item').forEach((el) => {
    el.classList.toggle('selected', parseInt(el.dataset.index) === selectedCategoryIndex);
  });
}

function updateCurrentCategoryName() {
  const categories = getConfig().blockly_setup.toolbox.categories;
  const nameSpan = document.getElementById('current-category-name');
  if (!nameSpan) return;

  if (selectedCategoryIndex < 0 || selectedCategoryIndex >= categories.length) {
    nameSpan.textContent = '';
    return;
  }

  nameSpan.textContent = `— ${categories[selectedCategoryIndex].name}`;
}

function updatePreview() {
  const container = document.getElementById('toolbox-preview-workspace');
  if (!container || container.offsetParent === null) return;

  // Build toolbox from current config
  const categories = getConfig().blockly_setup.toolbox.categories;
  const toolboxDef = {
    kind: 'categoryToolbox',
    contents: buildCategoryToolboxContents(Blockly, categories, 'toolbox preview'),
  };

  if (previewWorkspace) {
    previewWorkspace.dispose();
    previewWorkspace = null;
  }

  try {
    previewWorkspace = Blockly.inject(container, {
      toolbox: toolboxDef,
      readOnly: false,
      scrollbars: true,
      zoom: { controls: false, wheel: false },
      trashcan: false,
      sounds: false,
    });
  } catch (err) {
    console.warn('[ToolboxTab] Preview failed:', err.message);
  }
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
