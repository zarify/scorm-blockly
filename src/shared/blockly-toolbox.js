/**
 * Shared helpers for building Blockly toolboxes safely across the builder
 * and student runtime.
 */

const warnedUnsupportedBlockSets = new Set();
const DEFAULT_CATEGORY_COLOUR_SEQUENCE = [
  '#5C81A6',
  '#5CA65C',
  '#5C68A6',
  '#5CA68D',
  '#745CA6',
  '#A65C81',
  '#995BA5',
];

export const DEFAULT_TOOLBOX_BLOCK_LIBRARY = {
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
    'text', 'text_join', 'text_append',
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

/**
 * Get a consistent default category colour from the shared palette.
 * @param {number} index
 * @returns {string}
 */
export function getDefaultCategoryColour(index) {
  return DEFAULT_CATEGORY_COLOUR_SEQUENCE[index % DEFAULT_CATEGORY_COLOUR_SEQUENCE.length];
}

/**
 * Create the default student-facing toolbox categories for new activities.
 * @returns {Array<{name: string, colour: string, blocks: string[]}>}
 */
export function createDefaultToolboxCategories() {
  return Object.entries(DEFAULT_TOOLBOX_BLOCK_LIBRARY).map(([name, blocks], index) => ({
    name,
    colour: getDefaultCategoryColour(index),
    blocks: [...blocks],
  }));
}

/**
 * Create the authoring toolbox categories used by the workspace designer.
 * @returns {Array<{name: string, colour: string, blocks?: string[], custom?: string}>}
 */
export function createAuthoringToolboxCategories() {
  return createDefaultToolboxCategories().map((category) => {
    if (category.name === 'Variables') {
      return {
        name: category.name,
        colour: category.colour,
        custom: 'VARIABLE',
      };
    }

    if (category.name === 'Functions') {
      return {
        name: category.name,
        colour: category.colour,
        custom: 'PROCEDURE',
      };
    }

    return category;
  });
}

/**
 * Build student-facing toolbox categories from the block types used in a
 * starter workspace, keeping the default category order and colours.
 * @param {string[]} blockTypes
 * @returns {Array<{name: string, colour: string, blocks: string[]}>}
 */
export function createSeededToolboxCategories(blockTypes) {
  const usedBlockTypes = new Set(blockTypes);

  return Object.entries(DEFAULT_TOOLBOX_BLOCK_LIBRARY)
    .map(([name, blocks], index) => {
      const seededBlocks = blocks.filter((blockType) => usedBlockTypes.has(blockType));
      return seededBlocks.length > 0
        ? {
            name,
            colour: getDefaultCategoryColour(index),
            blocks: seededBlocks,
          }
        : null;
    })
    .filter(Boolean);
}

/**
 * Extract unique block types from a saved Blockly workspace state.
 * @param {typeof import('blockly')} Blockly
 * @param {object|null} workspaceState
 * @returns {string[]}
 */
export function getBlockTypesFromWorkspaceState(Blockly, workspaceState) {
  if (!workspaceState) return [];

  const workspace = new Blockly.Workspace();

  try {
    Blockly.serialization.workspaces.load(workspaceState, workspace);
    return [...new Set(workspace.getAllBlocks(false).map((block) => block.type))];
  } finally {
    if (typeof workspace.dispose === 'function') {
      workspace.dispose();
    }
  }
}

/**
 * Extract block types, input names, and field names from a saved workspace.
 * @param {typeof import('blockly')} Blockly
 * @param {object|null} workspaceState
 * @returns {{
 *   blockTypes: string[],
 *   inputNamesByBlockType: Record<string, string[]>,
 *   fieldNamesByBlockType: Record<string, string[]>,
 * }}
 */
export function getWorkspaceBlockMetadata(Blockly, workspaceState) {
  if (!workspaceState) {
    return {
      blockTypes: [],
      inputNamesByBlockType: {},
      fieldNamesByBlockType: {},
    };
  }

  const workspace = new Blockly.Workspace();

  try {
    Blockly.serialization.workspaces.load(workspaceState, workspace);

    /** @type {Map<string, Set<string>>} */
    const inputNamesByBlockType = new Map();
    /** @type {Map<string, Set<string>>} */
    const fieldNamesByBlockType = new Map();

    for (const block of workspace.getAllBlocks(false)) {
      if (!inputNamesByBlockType.has(block.type)) {
        inputNamesByBlockType.set(block.type, new Set());
      }
      if (!fieldNamesByBlockType.has(block.type)) {
        fieldNamesByBlockType.set(block.type, new Set());
      }

      for (const input of block.inputList || []) {
        if (input?.name) {
          inputNamesByBlockType.get(block.type)?.add(input.name);
        }
      }

      for (const field of block.getFields?.() || []) {
        if (field?.name) {
          fieldNamesByBlockType.get(block.type)?.add(field.name);
        }
      }
    }

    return {
      blockTypes: [...new Set(workspace.getAllBlocks(false).map((block) => block.type))].sort(),
      inputNamesByBlockType: Object.fromEntries(
        [...inputNamesByBlockType.entries()].map(([blockType, names]) => [blockType, [...names].sort()]),
      ),
      fieldNamesByBlockType: Object.fromEntries(
        [...fieldNamesByBlockType.entries()].map(([blockType, names]) => [blockType, [...names].sort()]),
      ),
    };
  } finally {
    if (typeof workspace.dispose === 'function') {
      workspace.dispose();
    }
  }
}

/**
 * Check whether a Blockly block type is registered in the current runtime.
 * @param {typeof import('blockly')} Blockly
 * @param {string} blockType
 * @returns {boolean}
 */
export function isSupportedBlockType(Blockly, blockType) {
  return typeof blockType === 'string' && Boolean(Blockly?.Blocks?.[blockType]);
}

/**
 * Filter block types down to those supported by the current Blockly build.
 * Logs unsupported types once per context so Blockly upgrades fail softly.
 * @param {typeof import('blockly')} Blockly
 * @param {string[]} blockTypes
 * @param {string} context
 * @returns {string[]}
 */
export function filterSupportedBlockTypes(Blockly, blockTypes, context) {
  const supported = [];
  const unsupported = [];

  for (const blockType of blockTypes || []) {
    if (isSupportedBlockType(Blockly, blockType)) {
      supported.push(blockType);
    } else {
      unsupported.push(blockType);
    }
  }

  if (unsupported.length > 0) {
    warnUnsupportedBlockTypes(context, unsupported);
  }

  return supported;
}

/**
 * Filter a category-based block library to the blocks supported at runtime.
 * @param {typeof import('blockly')} Blockly
 * @param {Record<string, string[]>} blockLibrary
 * @param {string} context
 * @returns {Record<string, string[]>}
 */
export function getSupportedBlockLibrary(Blockly, blockLibrary, context) {
  return Object.fromEntries(
    Object.entries(blockLibrary)
      .map(([categoryName, blockTypes]) => {
        const supportedBlocks = filterSupportedBlockTypes(
          Blockly,
          blockTypes,
          `${context}: ${categoryName}`,
        );
        return supportedBlocks.length > 0 ? [[categoryName, supportedBlocks]] : [];
      })
      .flat(),
  );
}

/**
 * Build toolbox category contents while skipping unsupported block types.
 * @param {typeof import('blockly')} Blockly
 * @param {Array<{name: string, colour?: string, blocks?: string[], custom?: string}>} categories
 * @param {string} context
 * @returns {object[]}
 */
export function buildCategoryToolboxContents(Blockly, categories, context) {
  return categories
    .map((cat) => {
      if (cat.custom) {
        return {
          kind: 'category',
          name: cat.name,
          colour: cat.colour || undefined,
          custom: cat.custom,
        };
      }

      const supportedBlocks = filterSupportedBlockTypes(
        Blockly,
        cat.blocks || [],
        `${context}: ${cat.name}`,
      );

      return {
        kind: 'category',
        name: cat.name,
        colour: cat.colour || undefined,
        contents: supportedBlocks.map((blockType) => ({ kind: 'block', type: blockType })),
      };
    })
    .filter((cat) => cat.custom || (Array.isArray(cat.contents) && cat.contents.length > 0));
}

/**
 * Warn once when unsupported blocks are present so the UI stays usable.
 * @param {string} context
 * @param {string[]} blockTypes
 */
function warnUnsupportedBlockTypes(context, blockTypes) {
  const uniqueBlockTypes = [...new Set(blockTypes)].sort();
  const warningKey = `${context}|${uniqueBlockTypes.join(',')}`;
  if (warnedUnsupportedBlockSets.has(warningKey)) return;

  warnedUnsupportedBlockSets.add(warningKey);
  console.warn(
    `[BlocklyToolbox] Ignoring unsupported block type(s) in ${context}: ${uniqueBlockTypes.join(', ')}`,
  );
}
