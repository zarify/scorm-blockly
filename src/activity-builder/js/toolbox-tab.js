/**
 * Toolbox Tab — Category and block selection with live preview.
 */

import { getConfig, notifyChange, onConfigChange, Blockly } from './builder-app.js';

// All standard Blockly block types organized by category
const BLOCKLY_BLOCK_LIBRARY = {
  Logic: [
    'controls_if', 'controls_ifelse', 'logic_compare', 'logic_operation',
    'logic_negate', 'logic_boolean', 'logic_null', 'logic_ternary',
  ],
  Loops: [
    'controls_repeat_ext', 'controls_repeat', 'controls_whileUntil',
    'controls_for', 'controls_forEach', 'controls_flow_statements',
  ],
  Math: [
    'math_number', 'math_arithmetic', 'math_single', 'math_trig',
    'math_constant', 'math_number_property', 'math_round',
    'math_on_list', 'math_modulo', 'math_constrain',
    'math_random_int', 'math_random_float', 'math_atan2',
  ],
  Text: [
    'text', 'text_multiline', 'text_join', 'text_append',
    'text_length', 'text_isEmpty', 'text_indexOf',
    'text_charAt', 'text_getSubstring', 'text_changeCase',
    'text_trim', 'text_count', 'text_replace',
    'text_reverse', 'text_print', 'text_prompt_ext',
  ],
  Lists: [
    'lists_create_with', 'lists_create_with_container',
    'lists_repeat', 'lists_length', 'lists_isEmpty',
    'lists_indexOf', 'lists_getIndex', 'lists_setIndex',
    'lists_getSublist', 'lists_split', 'lists_sort',
    'lists_reverse',
  ],
  Variables: ['variables_get', 'variables_set'],
  Functions: [
    'procedures_defnoreturn', 'procedures_defreturn',
    'procedures_ifreturn', 'procedures_callnoreturn',
    'procedures_callreturn',
  ],
};

let selectedCategoryIndex = -1;
let previewWorkspace = null;

export function initToolboxTab() {
  document.getElementById('btn-add-category').addEventListener('click', addCategory);
  document.getElementById('block-search').addEventListener('input', (e) => renderBlockList(e.target.value));

  onConfigChange(() => {
    renderCategoryList();
    if (selectedCategoryIndex >= 0) renderBlockList();
  });

  renderCategoryList();

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
    colour: '#5C81A6',
    blocks: [],
  });
  notifyChange();
  renderCategoryList();
  selectCategory(cfg.blockly_setup.toolbox.categories.length - 1);
}

function removeCategory(index) {
  const cfg = getConfig();
  cfg.blockly_setup.toolbox.categories.splice(index, 1);
  if (selectedCategoryIndex >= cfg.blockly_setup.toolbox.categories.length) {
    selectedCategoryIndex = cfg.blockly_setup.toolbox.categories.length - 1;
  }
  notifyChange();
  renderCategoryList();
  renderBlockList();
  updatePreview();
}

function selectCategory(index) {
  selectedCategoryIndex = index;
  renderCategoryList();
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
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index);
      getConfig().blockly_setup.toolbox.categories[idx].name = e.target.value;
      notifyChange();
      updatePreview();
    });
    el.addEventListener('click', () => selectCategory(parseInt(el.dataset.index)));
  });

  container.querySelectorAll('.category-color-input').forEach((el) => {
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index);
      getConfig().blockly_setup.toolbox.categories[idx].colour = e.target.value;
      notifyChange();
      renderCategoryList();
      updatePreview();
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
  for (const [libCat, blocks] of Object.entries(BLOCKLY_BLOCK_LIBRARY)) {
    for (const blockType of blocks) {
      allBlocks.push({ type: blockType, category: libCat });
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
      notifyChange();
      updatePreview();
    });
  });
}

function updatePreview() {
  const container = document.getElementById('toolbox-preview-workspace');
  if (!container || container.offsetParent === null) return;

  // Build toolbox from current config
  const categories = getConfig().blockly_setup.toolbox.categories;
  const toolboxDef = {
    kind: 'categoryToolbox',
    contents: categories.map((cat) => ({
      kind: 'category',
      name: cat.name,
      colour: cat.colour || undefined,
      contents: cat.blocks.map((blockType) => ({ kind: 'block', type: blockType })),
    })),
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
