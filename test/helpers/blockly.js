/**
 * Headless Blockly workspaces for tests.
 *
 * Blockly's serialization, field values, condition evaluation and block
 * structure assertions all work without a DOM, so the runtime's grading logic
 * can be tested for real (with the real block definitions) in plain Node.
 * `Blockly.inject` needs a DOM and is deliberately out of reach here.
 */

import * as Blockly from 'blockly';

export { Blockly };

/** Serialized workspace state containing the given top-level blocks. */
export function blockState(blocks = []) {
  return { blocks: { languageVersion: 0, blocks } };
}

/** A workspace loaded from serialized state (empty when state is null). */
export function workspaceFromState(state) {
  const workspace = new Blockly.Workspace();
  if (state) {
    Blockly.serialization.workspaces.load(state, workspace);
  }
  return workspace;
}

/** A workspace containing the given top-level block definitions. */
export function workspaceWith(blocks = []) {
  return workspaceFromState(blockState(blocks));
}

/** Serialized state of a live workspace, in the shape the config stores. */
export function stateOf(workspace) {
  return Blockly.serialization.workspaces.save(workspace);
}
