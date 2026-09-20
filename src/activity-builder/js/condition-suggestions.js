import {
  DEFAULT_TOOLBOX_BLOCK_LIBRARY,
  getWorkspaceBlockMetadata,
} from '../../shared/blockly-toolbox.js';

let nextSuggestionSetId = 0;

/**
 * Reading block metadata means loading the saved starter workspace into a
 * throwaway Blockly workspace, which costs ~2.5 ms for a 60-block program and
 * runs on every condition render. The builder replaces `starting_blocks` (on
 * import and on save) instead of mutating it, so the object itself is a safe
 * cache key.
 */
let cachedStartingBlocks;
let cachedWorkspaceMetadata = null;

function getWorkspaceMetadataFor(Blockly, startingBlocks) {
  if (cachedWorkspaceMetadata && cachedStartingBlocks === startingBlocks) {
    return cachedWorkspaceMetadata;
  }

  cachedWorkspaceMetadata = getWorkspaceBlockMetadata(Blockly, startingBlocks);
  cachedStartingBlocks = startingBlocks;
  return cachedWorkspaceMetadata;
}

/**
 * Block type, input name and field name metadata per block type. The result is
 * shared between callers and must be treated as read-only.
 */
const blockDefinitionMetadataCache = new Map();

export function getSuggestedConditionBlockTypes(Blockly, config) {
  const workspaceMetadata = getWorkspaceMetadataFor(
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
  if (!blockType || !Blockly?.Blocks?.[blockType]) {
    return { inputNames: [], fieldNames: [] };
  }

  const cached = blockDefinitionMetadataCache.get(blockType);
  if (cached) return cached;

  const workspace = new Blockly.Workspace();

  try {
    const block = workspace.newBlock(blockType);
    const metadata = {
      inputNames: [...new Set((block.inputList || []).map((input) => input.name).filter(Boolean))].sort(),
      fieldNames: [...new Set((block.getFields?.() || []).map((field) => field.name).filter(Boolean))].sort(),
    };
    blockDefinitionMetadataCache.set(blockType, metadata);
    return metadata;
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
