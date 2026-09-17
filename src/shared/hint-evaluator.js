/**
 * Hint Evaluator — Determines which hints should be visible given the current state.
 *
 * Pure logic module: takes hint configs + workspace state + runtime context,
 * returns which hints should be displayed. No UI or side effects.
 */

import { evaluateCondition } from './workspace-inspector.js';

/**
 * @typedef {Object} HintState
 * @property {Set<string>} dismissed - Hint IDs the student has dismissed
 * @property {Map<string, number>} firstTriggered - Hint ID → timestamp when condition first became true
 * @property {Set<string>} triggered - Hint IDs that have been triggered at least once
 * @property {number} attemptCount - Number of test runs (failed) so far
 * @property {number} elapsedSeconds - Seconds since activity was opened
 */

/**
 * Evaluate all hints and return those that should be visible.
 * @param {Array} hints - Hint config objects from activity_config.json
 * @param {object} workspace - Blockly workspace instance
 * @param {HintState} state - Current hint state
 * @param {string} event - Current trigger event ('workspace_change' | 'test_fail' | 'manual' | 'timed')
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

  // Event must match unless the hint is already waiting for its delay timer
  // to finish from a prior matching event, or we're evaluating all on manual.
  if (event !== 'manual' && trigger.event !== event && !(delay > 0 && delayAlreadyStarted)) {
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

      // If configured, mark this hint dismissed/invalidated when its condition becomes false
      if (trigger.invalidate_on_condition_false) {
        state.dismissed.add(hint.id);
        // Also clear any triggered/completed mark so checklist items un-check
        state.triggered.delete(hint.id);
      } else {
        if (!hint.show_once) {
          state.dismissed.delete(hint.id);
        }
      }

      return { visible: false, pendingDelayMs: null };
    }
  }

  if (state.dismissed.has(hint.id)) {
    return { visible: false, pendingDelayMs: null };
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
    dismissed: new Set(),
    firstTriggered: new Map(),
    triggered: new Set(),
    attemptCount: 0,
    elapsedSeconds: 0,
  };
}
