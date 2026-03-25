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
 * @property {number} attemptCount - Number of test runs (failed) so far
 * @property {number} elapsedSeconds - Seconds since activity was opened
 */

/**
 * Evaluate all hints and return those that should be visible.
 * @param {Array} hints - Hint config objects from activity_config.json
 * @param {object} workspace - Blockly workspace instance
 * @param {HintState} state - Current hint state
 * @param {string} event - Current trigger event ('workspace_change' | 'test_fail' | 'manual' | 'timed')
 * @returns {Array<{ id: string, message: string, priority: number }>}
 */
export function evaluateHints(hints, workspace, state, event) {
  const visible = [];

  for (const hint of hints) {
    if (shouldShowHint(hint, workspace, state, event)) {
      visible.push({
        id: hint.id,
        message: hint.message,
        priority: hint.priority || 1,
      });
    }
  }

  // Sort by priority (higher first) and return
  visible.sort((a, b) => b.priority - a.priority);
  return visible;
}

/**
 * Determine if a single hint should be shown.
 */
function shouldShowHint(hint, workspace, state, event) {
  // Skip dismissed hints that are show_once
  if (hint.show_once && state.dismissed.has(hint.id)) {
    return false;
  }

  const trigger = hint.trigger;

  // Event must match (unless evaluating all on 'manual')
  if (event !== 'manual' && trigger.event !== event) {
    return false;
  }

  // Check attempt threshold
  if (trigger.after_attempts && state.attemptCount < trigger.after_attempts) {
    return false;
  }

  // Evaluate workspace conditions if present
  if (trigger.conditions) {
    const result = evaluateCondition(workspace, trigger.conditions);
    if (!result.passed) {
      // Condition not met — clear the firstTriggered timestamp
      state.firstTriggered.delete(hint.id);
      return false;
    }
  }

  // Check delay — condition must have been true for delay_seconds
  const delay = hint.delay_seconds || 0;
  if (delay > 0) {
    const now = Date.now();
    if (!state.firstTriggered.has(hint.id)) {
      state.firstTriggered.set(hint.id, now);
    }
    const elapsed = (now - state.firstTriggered.get(hint.id)) / 1000;
    if (elapsed < delay) {
      return false;
    }
  }

  return true;
}

/**
 * Create a fresh HintState.
 * @returns {HintState}
 */
export function createHintState() {
  return {
    dismissed: new Set(),
    firstTriggered: new Map(),
    attemptCount: 0,
    elapsedSeconds: 0,
  };
}
