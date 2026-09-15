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
let pendingEvaluationTimer = null;
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
  clearTimeout(debounceTimer);
  clearScheduledEvaluation();

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

  evaluate('workspace_change', { resetTransientDismissals: true });
}

function debouncedEvaluate(event) {
  clearTimeout(debounceTimer);
  clearScheduledEvaluation();
  debounceTimer = setTimeout(() => evaluate(event, { resetTransientDismissals: true }), DEBOUNCE_MS);
}

/**
 * Evaluate hints and update the UI.
 * @param {string} event - Trigger event type
 */
function evaluate(event, options = {}) {
  if (!workspace || !hintState) return;

  if (options.resetTransientDismissals) {
    resetTransientDismissals(event);
  }

  clearScheduledEvaluation();
  const { visibleHints, nextEvaluationDelayMs } = evaluateHints(
    hintConfigs,
    workspace,
    hintState,
    event,
  );
  renderHints(visibleHints);

  if (nextEvaluationDelayMs !== null) {
    pendingEvaluationTimer = setTimeout(() => evaluate(event), nextEvaluationDelayMs);
  }
}

/**
 * Notify the hint engine of a test failure.
 * @param {number} attemptNumber - Current attempt count
 */
export function onTestFail(attemptNumber) {
  if (!hintState) return;
  hintState.attemptCount = attemptNumber;
  evaluate('test_fail', { resetTransientDismissals: true });
}

/**
 * Manually request hints (student clicks "Get Hint").
 */
export function requestHint() {
  evaluate('manual', { resetTransientDismissals: true });
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

function clearScheduledEvaluation() {
  if (pendingEvaluationTimer) {
    clearTimeout(pendingEvaluationTimer);
    pendingEvaluationTimer = null;
  }
}

function resetTransientDismissals(event) {
  hintConfigs.forEach((hint) => {
    if (!hint.show_once && hint.trigger?.event === event) {
      hintState.dismissed.delete(hint.id);
    }
  });
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
      <button class="hint-dismiss" data-hint-id="${escapeAttr(hint.id)}" title="Dismiss hint">✕</button>
    </div>
  `
    )
    .join('');

  hintPanel.querySelectorAll('.hint-dismiss').forEach((button) => {
    button.addEventListener('click', () => {
      dismissHint(button.dataset.hintId);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Import Blockly events reference
let Blockly;
export function setBlocklyRef(blocklyModule) {
  Blockly = blocklyModule;
}
