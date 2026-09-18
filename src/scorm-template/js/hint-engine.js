/**
 * Hint Engine — Real-time workspace monitoring and hint display.
 *
 * Listens for workspace changes, evaluates hint conditions via hint-evaluator,
 * manages hint state, and renders the hint panel UI.
 */

import {
  evaluateHints,
  createHintState,
  getManualHintRequestState,
} from '../../shared/hint-evaluator.js';
import { renderInlineMarkdown } from '../../shared/inline-markdown.js';
import { evaluateCondition } from '../../shared/workspace-inspector.js';

let hintState = null;
let hintConfigs = [];
let workspace = null;
let hintPanel = null;
let hintUiOptions = {
  enabled: true,
  legacyDisplayMode: 'triggered',
  onRequestAvailabilityChange: null,
};
let debounceTimer = null;
let pendingEvaluationTimer = null;
const DEFAULT_DEBOUNCE_MS = 250; // shorter default to reduce perceived lag
let debounceMs = DEFAULT_DEBOUNCE_MS;

/**
 * Initialize the hint engine.
 * @param {Array} hints - Hint configs from activity config
 * @param {object} blocklyWorkspace - Blockly workspace instance
 * @param {HTMLElement} panelElement - DOM element for the hint panel
 * @param {{ enabled?: boolean, legacyDisplayMode?: string, onRequestAvailabilityChange?: Function }} options
 */
export function initHintEngine(hints, blocklyWorkspace, panelElement, options = {}) {
  hintConfigs = hints || [];
  workspace = blocklyWorkspace;
  hintPanel = panelElement;
  hintUiOptions = {
    enabled: options.enabled !== false,
    legacyDisplayMode: options.legacyDisplayMode === 'checklist' ? 'checklist' : 'triggered',
    onRequestAvailabilityChange: typeof options.onRequestAvailabilityChange === 'function'
      ? options.onRequestAvailabilityChange
      : null,
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
    notifyHintRequestAvailability();
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

  evaluate('workspace_change');
}

function debouncedEvaluate(event) {
  clearTimeout(debounceTimer);
  clearScheduledEvaluation();
  debounceTimer = setTimeout(() => evaluate(event), debounceMs);
}

/**
 * Evaluate hints and update the UI.
 * @param {string} event - Trigger event type
 */
function evaluate(event) {
  if (!workspace || !hintState) return;

  clearScheduledEvaluation();
  const { visibleHints, nextEvaluationDelayMs } = evaluateHints(
    hintConfigs,
    workspace,
    hintState,
    event,
  );
  syncActiveHints(visibleHints, event);
  renderHints();
  notifyHintRequestAvailability();

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
  evaluate('test_fail');
}

/**
 * Manually request hints (student clicks "Get Hint").
 */
export function requestHint() {
  evaluate('manual');
}

function clearScheduledEvaluation() {
  if (pendingEvaluationTimer) {
    clearTimeout(pendingEvaluationTimer);
    pendingEvaluationTimer = null;
  }
}

function renderHints() {
  if (!hintPanel) return;

  const checklistHints = hintConfigs.filter((hint) => getHintDisplayMode(hint) === 'checklist');
  const activeHints = hintConfigs.filter(
    (hint) => getHintDisplayMode(hint) !== 'checklist' && hintState?.active.has(hint.id),
  );
  if (checklistHints.length === 0 && activeHints.length === 0) {
    hintPanel.style.display = 'none';
    hintPanel.innerHTML = '';
    return;
  }

  hintPanel.style.display = '';
  const sections = ['<section class="hint-section"><h3>💡 Hints</h3>'];
  if (activeHints.length > 0) {
    sections.push(
      activeHints
        .map((hint) => {
          const styleClass = hint.style ? ` hint-${hint.style}` : '';
          return `
            <div class="hint-card${styleClass}" data-hint-id="${hint.id}">
              <div class="hint-message formatted-text">${renderInlineMarkdown(hint.message)}</div>
            </div>
          `;
        })
        .join(''),
    );
  }
  if (checklistHints.length > 0) {
    sections.push(renderChecklistHints(checklistHints));
  }
  sections.push('</section>');
  hintPanel.innerHTML = sections.join('');
}

function renderChecklistHints(checklistHints) {
  return `
    <ul class="hint-checklist">
      ${checklistHints
      .map((hint) => {
        const completed = hintState?.triggered.has(hint.id);
        return `
          <li class="hint-checklist-item ${completed ? 'is-complete' : ''}">
            <span class="hint-checklist-icon" aria-hidden="true">${completed ? '☑' : '☐'}</span>
            <span class="hint-checklist-message formatted-text">${renderInlineMarkdown(hint.message)}</span>
          </li>
        `;
      })
      .join('')}
    </ul>
  `;
}

function syncActiveHints(visibleHints, event) {
  const firedHintIds = new Set(visibleHints.map((hint) => hint.id));

  hintConfigs.forEach((hint) => {
    if (getHintDisplayMode(hint) === 'checklist') {
      return;
    }

    if (firedHintIds.has(hint.id)) {
      hintState.active.add(hint.id);
      if (hint.show_once && event === 'manual' && hint.trigger?.event === 'manual') {
        hintState.consumed.add(hint.id);
      }
      return;
    }

    if (!shouldAutoInvalidateHint(hint)) {
      return;
    }

    hintState.active.delete(hint.id);
    hintState.firstTriggered.delete(hint.id);
    if (hint.show_once) {
      hintState.consumed.add(hint.id);
    }
  });
}

function shouldAutoInvalidateHint(hint) {
  if (!hintState?.active.has(hint.id)) {
    return false;
  }

  if (!hint.trigger?.invalidate_on_condition_false || !hint.trigger.conditions) {
    return false;
  }

  return !evaluateCondition(workspace, hint.trigger.conditions).passed;
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

function notifyHintRequestAvailability() {
  if (typeof hintUiOptions.onRequestAvailabilityChange !== 'function') {
    return;
  }

  hintUiOptions.onRequestAvailabilityChange(
    getManualHintRequestState(hintConfigs, workspace, hintState),
  );
}

// Import Blockly events reference
let Blockly;
export function setBlocklyRef(blocklyModule) {
  Blockly = blocklyModule;
}
