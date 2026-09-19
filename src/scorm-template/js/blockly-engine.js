/**
 * Blockly Engine — Initializes and manages the Blockly workspace from config.
 *
 * Handles toolbox generation, starter block loading, and code generation.
 */

import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import {
  buildCategoryToolboxContents,
  registerDynamicToolboxCategoryCallbacks,
} from '../../shared/blockly-toolbox.js';
import { configureJavascriptGenerator } from '../../shared/blockly-code-generator.js';

let workspace = null;

configureJavascriptGenerator(javascriptGenerator);

/**
 * Initialize the Blockly workspace.
 * @param {HTMLElement} container - DOM element to inject Blockly into
 * @param {object} blocklySetup - blockly_setup from activity config
 * @param {object} uiSettings - ui_settings from activity config
 * @returns {Blockly.WorkspaceSvg}
 */
export function initWorkspace(container, blocklySetup, uiSettings) {
  const toolboxDef = buildToolboxDefinition(blocklySetup.toolbox);

  const options = {
    toolbox: toolboxDef,
    grid: {
      spacing: 20,
      length: 3,
      colour: '#ccc',
      snap: true,
    },
    zoom: {
      controls: true,
      wheel: true,
      startScale: 1.0,
      maxScale: 3,
      minScale: 0.3,
      scaleSpeed: 1.2,
    },
    trashcan: true,
    scrollbars: true,
    sounds: false,
  };

  if (blocklySetup.max_blocks) {
    options.maxBlocks = blocklySetup.max_blocks;
  }

  workspace = Blockly.inject(container, options);
  registerDynamicToolboxCategoryCallbacks(workspace, Blockly, blocklySetup.toolbox.categories);

  // Load starter blocks if provided
  if (blocklySetup.starting_blocks) {
    try {
      Blockly.serialization.workspaces.load(blocklySetup.starting_blocks, workspace);
    } catch (err) {
      console.error('[BlocklyEngine] Failed to load starting blocks:', err);
    }
  }

  return workspace;
}

/**
 * Build a Blockly toolbox definition from config categories.
 * @param {object} toolboxConfig - toolbox section from config
 * @returns {object} Blockly toolbox definition
 */
function buildToolboxDefinition(toolboxConfig) {
  const contents = buildCategoryToolboxContents(
    Blockly,
    toolboxConfig.categories,
    'student toolbox',
  );

  return { kind: 'categoryToolbox', contents };
}

/**
 * Generate JavaScript code from the current workspace.
 * @returns {string}
 */
export function generateCode() {
  if (!workspace) throw new Error('Workspace not initialized');
  javascriptGenerator.INFINITE_LOOP_TRAP = 'if(--__loopTrap<=0){throw "Infinite loop detected";}\n';
  const code = javascriptGenerator.workspaceToCode(workspace);
  return `var __loopTrap=10000;\n${code}`;
}

/**
 * Get the current workspace instance.
 * @returns {Blockly.WorkspaceSvg|null}
 */
export function getWorkspace() {
  return workspace;
}

/**
 * Serialize the current workspace state as JSON.
 * @returns {object}
 */
export function serializeWorkspace() {
  if (!workspace) return null;
  return Blockly.serialization.workspaces.save(workspace);
}

/**
 * Clear the workspace.
 */
export function clearWorkspace() {
  if (workspace) workspace.clear();
}

/**
 * Resize the workspace to fit its container. Call on window resize.
 */
export function resizeWorkspace() {
  if (workspace) Blockly.svgResize(workspace);
}

// Re-export Blockly for use by other modules that need it
export { Blockly };
