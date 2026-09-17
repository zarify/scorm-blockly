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
let hintUiOptions = { enabled: true, legacyDisplayMode: 'triggered' };
let debounceTimer = null;
let pendingEvaluationTimer = null;
const DEFAULT_DEBOUNCE_MS = 250; // shorter default to reduce perceived lag
let debounceMs = DEFAULT_DEBOUNCE_MS;

/**
 * Initialize the hint engine.
 * @param {Array} hints - Hint configs from activity config
 * @param {object} blocklyWorkspace - Blockly workspace instance
 * @param {HTMLElement} panelElement - DOM element for the hint panel
 * @param {{ enabled?: boolean, legacyDisplayMode?: string }} options
 */
export function initHintEngine(hints, blocklyWorkspace, panelElement, options = {}) {
  hintConfigs = hints || [];
  workspace = blocklyWorkspace;
  hintPanel = panelElement;
  hintUiOptions = {
    enabled: options.enabled !== false,
    legacyDisplayMode: options.legacyDisplayMode === 'checklist' ? 'checklist' : 'triggered',
  };
  debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs : DEFAULT_DEBOUNCE_MS;
  hintState = createHintState();
  clearTimeout(debounceTimer);
  clearScheduledEvaluation();

  if (!hintUiOptions.enabled || hintConfigs.length === 0) {
    if (hintPanel) {
      hintPanel.style.display = 'none';
      hintPanel.innerHTML = '';
    }
    return;
  }

  // Listen for workspace changes — respond to most events so field edits
  // (e.g. text field updates, variable renames) trigger evaluations immediately.
  // Ignore only harmless selection UI events to avoid noisy re-evaluations.
  workspace.addChangeListener((event) => {
    // If this is a UI event for selection changes, ignore it
    if (event.type === Blockly.Events.UI && event.element === 'selected') return;

    // Debounce and evaluate for any other event
    debouncedEvaluate('workspace_change');
  });

  evaluate('workspace_change', { resetTransientDismissals: true });
}

function debouncedEvaluate(event) {
  clearTimeout(debounceTimer);
  clearScheduledEvaluation();
  debounceTimer = setTimeout(() => evaluate(event, { resetTransientDismissals: true }), debounceMs);
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

  const checklistHints = hintConfigs.filter((hint) => getHintDisplayMode(hint) === 'checklist');
  const checklistHintIds = new Set(checklistHints.map((hint) => hint.id));

  // Build a quick map of visible hints by id for fast lookup
  const visibleMap = new Map(visibleHints.map((h) => [h.id, h]));

  // Determine if there's anything to show
  const nonChecklistDefined = hintConfigs.filter((hint) => !checklistHintIds.has(hint.id));
  const anyNonChecklistVisible = nonChecklistDefined.some((h) => visibleMap.has(h.id));
  if (checklistHints.length === 0 && !anyNonChecklistVisible) {
    hintPanel.style.display = 'none';
    hintPanel.innerHTML = '';
    return;
  }

  hintPanel.style.display = '';
  const sections = [];

  // Render non-checklist hints inline in the order they appear in hintConfigs
  if (nonChecklistDefined.length > 0) {
    sections.push(`<section class="hint-section"><h3>💡 Hints</h3>`);

    sections.push(
      nonChecklistDefined
        .map((cfg) => {
          const visible = visibleMap.get(cfg.id);
          if (!visible) return null; // not currently visible, don't render a gap

          const styleClass = cfg.style ? ` hint-${cfg.style}` : '';
          const successClass = (cfg.display_mode === 'checklist' && hintState?.triggered.has(cfg.id)) ? ' is-success' : '';

          // For triggered (hidden-until-fired) hints we do not render a manual dismiss button;
          // they obey configured rules (show_once, invalidate_on_condition_false, etc.)
          const allowManualDismiss = cfg.allow_manual_dismiss !== false && getHintDisplayMode(cfg) !== 'triggered';

          return `
            <div class="hint-card${styleClass}${successClass}" data-hint-id="${cfg.id}">
              <div class="hint-message">${escapeHtml(visible.message)}</div>
              ${allowManualDismiss ? `<button class="hint-dismiss" data-hint-id="${escapeAttr(cfg.id)}" title="Dismiss hint">✕</button>` : ''}
            </div>
          `;
        })
        .filter(Boolean)
        .join(''),
    );

    sections.push(`</section>`);
  }

  if (checklistHints.length > 0) {
    sections.push(renderChecklistHints(checklistHints));
  }

  hintPanel.innerHTML = sections.join('');

  // Wire up dismiss handlers only for buttons that exist (manual dismiss is optional)
  hintPanel.querySelectorAll('.hint-dismiss').forEach((button) => {
    button.addEventListener('click', () => {
      dismissHint(button.dataset.hintId);
    });
  });
}

function renderChecklistHints(checklistHints) {
  return `
    <section class="hint-section">
      <h3>✅ Hint checklist</h3>
      <ul class="hint-checklist">
        ${checklistHints
        .map((hint) => {
          const completed = hintState?.triggered.has(hint.id);
          return `
            <li class="hint-checklist-item ${completed ? 'is-complete' : ''}">
              <span class="hint-checklist-icon" aria-hidden="true">${completed ? '☑' : '☐'}</span>
              <span class="hint-checklist-message">${escapeHtml(hint.message)}</span>
            </li>
          `;
        })
        .join('')}
      </ul>
    </section>
  `;
}

function getHintDisplayMode(hint) {
  if (hint?.display_mode === 'checklist') {
    return 'checklist';
  }
  if (hint?.display_mode === 'triggered') {
    return 'triggered';
  }
  return hintUiOptions.legacyDisplayMode === 'checklist' ? 'checklist' : 'triggered';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
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
