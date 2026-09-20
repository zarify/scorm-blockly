/**
 * Hint Evaluator — Determines which hints should be visible given the current state.
 *
 * Pure logic module: takes hint configs + workspace state + runtime context,
 * returns which hints should be displayed. No UI or side effects.
 */

import { evaluateCondition } from './workspace-inspector.js';

/**
 * @typedef {Object} HintState
 * @property {Set<string>} active - Non-checklist hints currently visible
 * @property {Set<string>} consumed - show_once hints already used up
 * @property {Map<string, number>} firstTriggered - Hint ID → timestamp when condition first became true
 * @property {Set<string>} triggered - Hint IDs that have been triggered at least once
 * @property {number} attemptCount - Number of test runs (failed) so far
 */

/**
 * Evaluate all hints and return those that should be visible.
 * @param {Array} hints - Hint config objects from activity_config.json
 * @param {object} workspace - Blockly workspace instance
 * @param {HintState} state - Current hint state
 * @param {string} event - Current trigger event ('workspace_change' | 'test_fail' | 'manual')
 * @returns {{ visibleHints: Array<{ id: string, message: string, priority: number }>, nextEvaluationDelayMs: number | null }}
 */
export function evaluateHints(hints, workspace, state, event) {
  const visibleHints = [];
  let nextEvaluationDelayMs = null;

  for (const hint of hints) {
    const evaluation = evaluateHint(hint, workspace, state, event);
    if (evaluation.visible) {
      visibleHints.push({
        id: hint.id,
        message: hint.message,
        priority: hint.priority || 1,
        display_mode: hint.display_mode || 'triggered',
        style: hint.style || null,
      });
    }

    if (evaluation.pendingDelayMs !== null) {
      nextEvaluationDelayMs = nextEvaluationDelayMs === null
        ? evaluation.pendingDelayMs
        : Math.min(nextEvaluationDelayMs, evaluation.pendingDelayMs);
    }
  }

  // Sort by priority (higher first) and return
  visibleHints.sort((a, b) => b.priority - a.priority);
  return { visibleHints, nextEvaluationDelayMs };
}

/**
 * Determine if a single hint should be shown and when it should be re-evaluated.
 */
function evaluateHint(hint, workspace, state, event) {
  const trigger = hint.trigger;
  const delay = hint.delay_seconds || 0;
  const delayAlreadyStarted = state.firstTriggered.has(hint.id);

  if (state.consumed.has(hint.id)) {
    return { visible: false, pendingDelayMs: null };
  }

  // Event must match unless the hint is already waiting for its delay timer
  // to finish from a prior matching event.
  if (trigger.event !== event && !(delay > 0 && delayAlreadyStarted)) {
    return { visible: false, pendingDelayMs: null };
  }

  // Check attempt threshold
  if (trigger.after_attempts && state.attemptCount < trigger.after_attempts) {
    return { visible: false, pendingDelayMs: null };
  }

  // Evaluate workspace conditions if present
  if (trigger.conditions) {
    const result = evaluateCondition(workspace, trigger.conditions);
    if (!result.passed) {
      // Condition not met — clear the firstTriggered timestamp
      state.firstTriggered.delete(hint.id);

      if (trigger.invalidate_on_condition_false) {
        // Also clear any triggered/completed mark so checklist items un-check
        state.triggered.delete(hint.id);
      }

      return { visible: false, pendingDelayMs: null };
    }
  }

  // Check delay — condition must have been true for delay_seconds
  if (delay > 0) {
    const now = Date.now();
    if (!state.firstTriggered.has(hint.id)) {
      state.firstTriggered.set(hint.id, now);
      return { visible: false, pendingDelayMs: delay * 1000 };
    }
    const elapsedMs = now - state.firstTriggered.get(hint.id);
    const requiredDelayMs = delay * 1000;
    if (elapsedMs < requiredDelayMs) {
      return { visible: false, pendingDelayMs: requiredDelayMs - elapsedMs };
    }
  }

  state.triggered.add(hint.id);
  return { visible: true, pendingDelayMs: null };
}

/**
 * Create a fresh HintState.
 * @returns {HintState}
 */
export function createHintState() {
  return {
    active: new Set(),
    consumed: new Set(),
    firstTriggered: new Map(),
    triggered: new Set(),
    attemptCount: 0,
  };
}

export function getManualHintRequestState(hints, workspace, state) {
  const manualHints = Array.isArray(hints)
    ? hints.filter((hint) => hint?.trigger?.event === 'manual')
    : [];

  if (manualHints.length === 0) {
    return { hasManualHints: false, canRequest: false };
  }

  return {
    hasManualHints: true,
    canRequest: manualHints.some((hint) => isManualHintEligible(hint, workspace, state)),
  };
}

function isManualHintEligible(hint, workspace, state) {
  if (!hint?.trigger || !workspace || !state) {
    return false;
  }

  if (state.consumed.has(hint.id)) {
    return false;
  }

  if (hint.trigger.after_attempts && state.attemptCount < hint.trigger.after_attempts) {
    return false;
  }

  if (!hint.trigger.conditions) {
    return true;
  }

  return evaluateCondition(workspace, hint.trigger.conditions).passed;
}
