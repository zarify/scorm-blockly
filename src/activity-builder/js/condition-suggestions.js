import {
  DEFAULT_TOOLBOX_BLOCK_LIBRARY,
  getWorkspaceBlockMetadata,
} from '../../shared/blockly-toolbox.js';

let nextSuggestionSetId = 0;

export function getSuggestedConditionBlockTypes(Blockly, config) {
  const workspaceMetadata = getWorkspaceBlockMetadata(
    Blockly,
    config?.blockly_setup?.starting_blocks || null,
  );
  const toolboxBlockTypes = (config?.blockly_setup?.toolbox?.categories || [])
    .flatMap((category) => category.blocks || []);
  const defaultBlockTypes = Object.values(DEFAULT_TOOLBOX_BLOCK_LIBRARY).flat();

  return [...new Set([...workspaceMetadata.blockTypes, ...toolboxBlockTypes, ...defaultBlockTypes])]
    .filter((blockType) => Blockly.Blocks?.[blockType])
    .sort();
}

export function getConditionBlockDefinitionMetadata(Blockly, blockType) {
  if (!blockType || !Blockly.Blocks?.[blockType]) {
    return { inputNames: [], fieldNames: [] };
  }

  const workspace = new Blockly.Workspace();

  try {
    const block = workspace.newBlock(blockType);
    return {
      inputNames: [...new Set((block.inputList || []).map((input) => input.name).filter(Boolean))].sort(),
      fieldNames: [...new Set((block.getFields?.() || []).map((field) => field.name).filter(Boolean))].sort(),
    };
  } catch {
    return { inputNames: [], fieldNames: [] };
  } finally {
    if (typeof workspace.dispose === 'function') {
      workspace.dispose();
    }
  }
}

export function createConditionSuggestionIds(prefix = 'condition-suggestions') {
  nextSuggestionSetId += 1;
  return {
    blockTypes: `${prefix}-block-types-${nextSuggestionSetId}`,
    inputNames: `${prefix}-input-names-${nextSuggestionSetId}`,
    fieldNames: `${prefix}-field-names-${nextSuggestionSetId}`,
  };
}
