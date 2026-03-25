/**
 * Hint Engine — Real-time workspace monitoring and hint display.
 *
 * Listens for workspace changes, evaluates hint conditions via hint-evaluator,
 * manages hint state (shown/dismissed), and renders the hint panel UI.
 */

import { evaluateHints, createHintState } from '../../shared/hint-evaluator.js';

let hintState = null;
let hintConfigs = [];
let workspace = null;
let hintPanel = null;
let debounceTimer = null;
const DEBOUNCE_MS = 2000;

/**
 * Initialize the hint engine.
 * @param {Array} hints - Hint configs from activity config
 * @param {object} blocklyWorkspace - Blockly workspace instance
 * @param {HTMLElement} panelElement - DOM element for the hint panel
 */
export function initHintEngine(hints, blocklyWorkspace, panelElement) {
  hintConfigs = hints || [];
  workspace = blocklyWorkspace;
  hintPanel = panelElement;
  hintState = createHintState();

  if (hintConfigs.length === 0) {
    if (hintPanel) hintPanel.style.display = 'none';
    return;
  }

  // Listen for workspace changes
  workspace.addChangeListener((event) => {
    // Only respond to meaningful changes
    if (
      event.type === Blockly.Events.BLOCK_MOVE ||
      event.type === Blockly.Events.BLOCK_CHANGE ||
      event.type === Blockly.Events.BLOCK_CREATE ||
      event.type === Blockly.Events.BLOCK_DELETE
    ) {
      debouncedEvaluate('workspace_change');
    }
  });
}

function debouncedEvaluate(event) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => evaluate(event), DEBOUNCE_MS);
}

/**
 * Evaluate hints and update the UI.
 * @param {string} event - Trigger event type
 */
function evaluate(event) {
  if (!workspace || !hintState) return;

  const visibleHints = evaluateHints(hintConfigs, workspace, hintState, event);
  renderHints(visibleHints);
}

/**
 * Notify the hint engine of a test failure.
 * @param {number} attemptNumber - Current attempt count
 */
export function onTestFail(attemptNumber) {
  if (!hintState) return;
  hintState.attemptCount = attemptNumber;
  evaluate('test_fail');
}

/**
 * Manually request hints (student clicks "Get Hint").
 */
export function requestHint() {
  evaluate('manual');
}

/**
 * Dismiss a specific hint.
 * @param {string} hintId
 */
export function dismissHint(hintId) {
  if (!hintState) return;
  hintState.dismissed.add(hintId);
  evaluate('workspace_change');
}

/**
 * Render visible hints into the hint panel.
 */
function renderHints(visibleHints) {
  if (!hintPanel) return;

  if (visibleHints.length === 0) {
    hintPanel.innerHTML = '<p class="hint-empty">No hints available right now.</p>';
    return;
  }

  hintPanel.innerHTML = visibleHints
    .map(
      (hint) => `
    <div class="hint-card" data-hint-id="${hint.id}">
      <div class="hint-message">${escapeHtml(hint.message)}</div>
      <button class="hint-dismiss" onclick="BlocklyScorm.dismissHint('${hint.id}')" title="Dismiss hint">✕</button>
    </div>
  `
    )
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Import Blockly events reference
let Blockly;
export function setBlocklyRef(blocklyModule) {
  Blockly = blocklyModule;
}
