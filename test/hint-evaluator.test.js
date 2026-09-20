/**
 * Hint evaluator — decides which hints a student should see for one trigger
 * event, and when the caller should evaluate again.
 *
 * The module is pure apart from the live hint state it is handed, so the edges
 * worth pinning are the ones the engine actually has to cope with: which event
 * may show a hint, how the delay timer survives a different event, attempt
 * thresholds that sit both before and above the condition, what `show_once`
 * consumption does to an otherwise valid hint, and how a checklist item
 * un-ticks. Timers and `Date` are mocked — nothing here waits in real time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createHintState,
  evaluateHints,
  getManualHintRequestState,
} from '../src/shared/hint-evaluator.js';
import { hint } from './helpers/config.js';
import { workspaceWith } from './helpers/blockly.js';

// --- fixtures -------------------------------------------------------------

function workspaceOf(blocks = []) {
  return workspaceWith(blocks);
}

function printBlock(value) {
  return {
    type: 'text_print',
    inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: value } } } },
  };
}

function visibleIds(result) {
  return result.visibleHints.map((visible) => visible.id);
}

// --- state and pipeline ---------------------------------------------------

test('a fresh hint state is empty and shares nothing with the next one', () => {
  const state = createHintState();
  assert.deepEqual([...state.active], []);
  assert.deepEqual([...state.consumed], []);
  assert.deepEqual([...state.firstTriggered.keys()], []);
  assert.deepEqual([...state.triggered], []);
  assert.equal(state.attemptCount, 0);

  state.active.add('a');
  state.consumed.add('b');
  state.firstTriggered.set('c', 1);
  state.triggered.add('d');
  state.attemptCount = 3;

  const fresh = createHintState();
  assert.deepEqual([...fresh.active], []);
  assert.deepEqual([...fresh.consumed], []);
  assert.deepEqual([...fresh.firstTriggered.keys()], []);
  assert.deepEqual([...fresh.triggered], []);
  assert.equal(fresh.attemptCount, 0);
});

test('no hints means nothing to show and nothing to schedule', () => {
  assert.deepEqual(
    evaluateHints([], workspaceOf(), createHintState(), 'workspace_change'),
    { visibleHints: [], nextEvaluationDelayMs: null },
  );
});

test('a visible hint carries the fields the panel renders', () => {
  const hints = [
    hint({
      id: 'hint_1',
      message: 'Look at the Text category.',
      priority: 7,
      display_mode: 'checklist',
      style: 'warning',
      trigger: { conditions: null },
    }),
  ];

  const { visibleHints } = evaluateHints(hints, workspaceOf(), createHintState(), 'workspace_change');
  assert.deepEqual(visibleHints, [
    {
      id: 'hint_1',
      message: 'Look at the Text category.',
      priority: 7,
      display_mode: 'checklist',
      style: 'warning',
    },
  ]);
});

test('a hint without a style and display mode falls back to triggered with no style', () => {
  const hints = [hint({ id: 'hint_1', trigger: { conditions: null } })];
  const { visibleHints } = evaluateHints(hints, workspaceOf(), createHintState(), 'workspace_change');
  assert.deepEqual(visibleHints, [
    { id: 'hint_1', message: 'Try something.', priority: 1, display_mode: 'triggered', style: null },
  ]);
});

test('visible hints come back highest priority first', () => {
  const hints = [
    hint({ id: 'low', priority: 1, trigger: { conditions: null } }),
    hint({ id: 'high', priority: 5, trigger: { conditions: null } }),
    hint({ id: 'mid', priority: 3, trigger: { conditions: null } }),
  ];

  const { visibleHints } = evaluateHints(hints, workspaceOf(), createHintState(), 'workspace_change');
  assert.deepEqual(visibleHints.map((visible) => visible.id), ['high', 'mid', 'low']);
  // Sorting is the evaluator's whole contribution: a lower priority hint is
  // still visible, it is the panel that decides what to hide behind it.
  assert.deepEqual(
    visibleHints.map((visible) => visible.priority),
    [5, 3, 1],
  );
});

test('a missing or zero priority counts as priority 1 and keeps config order', () => {
  const noPriority = hint({ id: 'nop', trigger: { conditions: null } });
  delete noPriority.priority;
  const hints = [
    hint({ id: 'first', priority: 1, trigger: { conditions: null } }),
    noPriority,
    hint({ id: 'zero', priority: 0, trigger: { conditions: null } }),
  ];

  const { visibleHints } = evaluateHints(hints, workspaceOf(), createHintState(), 'workspace_change');
  assert.deepEqual(visibleHints.map((visible) => visible.id), ['first', 'nop', 'zero']);
  assert.deepEqual(
    visibleHints.map((visible) => visible.priority),
    [1, 1, 1],
  );
});

// --- event filtering ------------------------------------------------------

test('a hint only fires for the event it was configured for', () => {
  const hints = [hint({ id: 'hint_1', trigger: { event: 'test_fail', conditions: null } })];
  const state = createHintState();

  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), []);
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), []);
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'test_fail')), ['hint_1']);
});

test('a workspace hint and a failed-test hint stay in their own lanes', () => {
  const hints = [
    hint({ id: 'on_change', trigger: { event: 'workspace_change', conditions: null } }),
    hint({ id: 'on_fail', trigger: { event: 'test_fail', conditions: null } }),
  ];
  const state = createHintState();

  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), ['on_change']);
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'test_fail')), ['on_fail']);
  // An event the runtime never fires (the retired `timed` trigger) shows nothing.
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'timed')), []);
});

test('an unmatched event never starts a delayed hint counting', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const hints = [
    hint({ id: 'hint_1', delay_seconds: 5, trigger: { event: 'test_fail', conditions: null } }),
  ];
  const state = createHintState();

  const result = evaluateHints(hints, workspaceOf(), state, 'workspace_change');
  assert.deepEqual(result.visibleHints, []);
  assert.equal(result.nextEvaluationDelayMs, null);
  assert.equal(state.firstTriggered.has('hint_1'), false);
});

// --- conditions -----------------------------------------------------------

test('the trigger condition is evaluated against the live workspace', () => {
  const hints = [
    hint({
      id: 'hint_1',
      trigger: { conditions: { type: 'block_exists', block_type: 'text_print' } },
    }),
  ];
  const state = createHintState();

  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf([printBlock('hi')]), state, 'workspace_change')), ['hint_1']);
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), []);
});

test('a failing condition clears the first-trigger timestamp and schedules nothing', () => {
  const hints = [hint({ id: 'hint_1' })];
  const state = createHintState();
  state.firstTriggered.set('hint_1', 4242);

  const result = evaluateHints(hints, workspaceOf([printBlock('hi')]), state, 'workspace_change');
  assert.deepEqual(result.visibleHints, []);
  assert.equal(result.nextEvaluationDelayMs, null);
  assert.equal(state.firstTriggered.has('hint_1'), false);
});

test('a hint with an unusable condition is simply hidden', () => {
  for (const conditions of [
    { type: 'no_such_condition' },
    // An unknown child makes the whole composite fail, so the hint stays hidden.
    { type: 'all', conditions: [{ type: 'no_such_condition' }] },
  ]) {
    const hints = [hint({ id: 'hint_1', trigger: { conditions } })];
    assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), createHintState(), 'workspace_change')), []);
  }
});

// --- show_once / consumed -------------------------------------------------

test('a consumed hint is hidden even while its condition still holds', () => {
  const hints = [hint({ id: 'hint_1' })];
  const state = createHintState();
  const empty = workspaceOf();

  assert.deepEqual(visibleIds(evaluateHints(hints, empty, state, 'workspace_change')), ['hint_1']);
  state.consumed.add('hint_1');
  const consumed = evaluateHints(hints, empty, state, 'workspace_change');
  assert.deepEqual(consumed.visibleHints, []);
  assert.equal(consumed.nextEvaluationDelayMs, null);
});

test('consuming a hint is the caller\'s job: the evaluator never marks one used', () => {
  const state = createHintState();
  const empty = workspaceOf();

  evaluateHints([hint({ id: 'hint_1', show_once: true })], empty, state, 'workspace_change');
  evaluateHints([hint({ id: 'hint_1', show_once: true })], empty, state, 'workspace_change');
  assert.equal(state.consumed.size, 0);
  // The engine consumes a manual show_once hint when the student asks for it.
  assert.deepEqual(visibleIds(evaluateHints([hint({ id: 'hint_1', show_once: true })], empty, state, 'workspace_change')), ['hint_1']);
});

// --- after_attempts -------------------------------------------------------

test('after_attempts holds a hint back until the tests have failed that often', () => {
  const hints = [hint({ id: 'hint_1', trigger: { conditions: null, after_attempts: 2 } })];
  const state = createHintState();

  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), []);
  state.attemptCount = 1;
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), []);
  state.attemptCount = 2;
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), ['hint_1']);
});

test('an attempt threshold of 0 means no threshold at all', () => {
  const hints = [hint({ id: 'hint_1', trigger: { conditions: null, after_attempts: 0 } })];
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), createHintState(), 'workspace_change')), ['hint_1']);
});

test('the attempt threshold is checked before the condition, so a gated hint keeps waiting', () => {
  const blocked = workspaceOf([printBlock('hi')]);
  const hints = [hint({ id: 'hint_1', trigger: { after_attempts: 3 } })];
  const state = createHintState();
  state.firstTriggered.set('hint_1', 1234);

  evaluateHints(hints, blocked, state, 'workspace_change');
  assert.equal(state.firstTriggered.get('hint_1'), 1234);

  state.attemptCount = 3;
  evaluateHints(hints, blocked, state, 'workspace_change');
  assert.equal(state.firstTriggered.has('hint_1'), false);
});

// --- delay_seconds --------------------------------------------------------

test('a delay keeps the hint hidden and reports when to look again', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const hints = [hint({ id: 'hint_1', delay_seconds: 4, trigger: { conditions: null } })];
  const state = createHintState();

  const first = evaluateHints(hints, workspaceOf(), state, 'workspace_change');
  assert.deepEqual(first.visibleHints, []);
  assert.equal(first.nextEvaluationDelayMs, 4000);
  assert.equal(state.firstTriggered.get('hint_1'), 0);
  assert.equal(state.triggered.has('hint_1'), false);

  t.mock.timers.setTime(3999);
  const nearly = evaluateHints(hints, workspaceOf(), state, 'workspace_change');
  assert.deepEqual(nearly.visibleHints, []);
  assert.equal(nearly.nextEvaluationDelayMs, 1);

  t.mock.timers.setTime(4000);
  const due = evaluateHints(hints, workspaceOf(), state, 'workspace_change');
  assert.deepEqual(visibleIds(due), ['hint_1']);
  assert.equal(due.nextEvaluationDelayMs, null);
  assert.equal(state.triggered.has('hint_1'), true);
});

test('the reported wait is the soonest of the pending hints', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const hints = [
    hint({ id: 'slow', delay_seconds: 30, trigger: { conditions: null } }),
    hint({ id: 'fast', delay_seconds: 5, trigger: { conditions: null } }),
  ];
  const state = createHintState();

  assert.equal(evaluateHints(hints, workspaceOf(), state, 'workspace_change').nextEvaluationDelayMs, 5000);

  t.mock.timers.setTime(6000);
  const afterFast = evaluateHints(hints, workspaceOf(), state, 'workspace_change');
  assert.deepEqual(visibleIds(afterFast), ['fast']);
  assert.equal(afterFast.nextEvaluationDelayMs, 25000);

  t.mock.timers.setTime(31000);
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), ['slow', 'fast']);
});

test('a running delay keeps working across a different trigger event', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const hints = [
    hint({ id: 'hint_1', delay_seconds: 3, trigger: { event: 'test_fail', conditions: null } }),
  ];
  const state = createHintState();

  evaluateHints(hints, workspaceOf(), state, 'test_fail');
  assert.equal(state.firstTriggered.has('hint_1'), true);

  t.mock.timers.setTime(3000);
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf(), state, 'workspace_change')), ['hint_1']);
});

test('that delay escape closes once the condition stops holding', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const hints = [hint({ id: 'hint_1', delay_seconds: 3, trigger: { event: 'test_fail' } })];
  const state = createHintState();

  evaluateHints(hints, workspaceOf(), state, 'test_fail');
  assert.equal(state.firstTriggered.has('hint_1'), true);

  evaluateHints(hints, workspaceOf([printBlock('hi')]), state, 'test_fail');
  assert.equal(state.firstTriggered.has('hint_1'), false);

  t.mock.timers.setTime(3000);
  assert.deepEqual(visibleIds(evaluateHints(hints, workspaceOf([printBlock('hi')]), state, 'workspace_change')), []);
});

test('a delay of zero shows the hint straight away', () => {
  const hints = [hint({ id: 'hint_1', delay_seconds: 0, trigger: { conditions: null } })];
  const state = createHintState();
  const result = evaluateHints(hints, workspaceOf(), state, 'workspace_change');

  assert.deepEqual(visibleIds(result), ['hint_1']);
  assert.equal(result.nextEvaluationDelayMs, null);
  assert.equal(state.firstTriggered.has('hint_1'), false);
});

// --- checklist vs triggered ----------------------------------------------

test('a checklist hint is still returned, tagged so the panel can tick it', () => {
  const hints = [
    hint({ id: 'step_1', display_mode: 'checklist', trigger: { conditions: null } }),
    hint({ id: 'nudge', display_mode: 'triggered', trigger: { conditions: null } }),
  ];
  const state = createHintState();

  const { visibleHints } = evaluateHints(hints, workspaceOf(), state, 'workspace_change');
  assert.deepEqual(
    visibleHints.map((visible) => [visible.id, visible.display_mode]),
    [['step_1', 'checklist'], ['nudge', 'triggered']],
  );
});

test('a failed checklist condition un-ticks only when invalidation is asked for', () => {
  const empty = workspaceOf();
  const filled = workspaceOf([printBlock('hi')]);
  const keeping = [hint({ id: 'keep', display_mode: 'checklist', trigger: { conditions: { type: 'workspace_empty' } } })];
  const clearing = [
    hint({
      id: 'clear',
      display_mode: 'checklist',
      trigger: { conditions: { type: 'workspace_empty' }, invalidate_on_condition_false: true },
    }),
  ];
  const state = createHintState();

  evaluateHints(keeping, empty, state, 'workspace_change');
  evaluateHints(clearing, empty, state, 'workspace_change');
  assert.deepEqual([...state.triggered].sort(), ['clear', 'keep']);

  evaluateHints(keeping, filled, state, 'workspace_change');
  evaluateHints(clearing, filled, state, 'workspace_change');
  assert.deepEqual([...state.triggered], ['keep']);
  // Both are hidden again regardless, because the condition no longer holds.
  assert.deepEqual(visibleIds(evaluateHints(keeping, filled, state, 'workspace_change')), []);
  assert.deepEqual(visibleIds(evaluateHints(clearing, filled, state, 'workspace_change')), []);
});

test('a triggered hint is marked as triggered once its condition holds', () => {
  const state = createHintState();
  evaluateHints([hint({ id: 'hint_1' })], workspaceOf(), state, 'workspace_change');
  assert.equal(state.triggered.has('hint_1'), true);
  // An event mismatch never marks the hint.
  evaluateHints([hint({ id: 'hint_2', trigger: { event: 'test_fail', conditions: null } })], workspaceOf(), state, 'workspace_change');
  assert.equal(state.triggered.has('hint_2'), false);
});

// --- manual requests ------------------------------------------------------

test('manual request state says whether the activity has manual hints at all', () => {
  const state = createHintState();
  const empty = workspaceOf();

  assert.deepEqual(getManualHintRequestState([], empty, state), { hasManualHints: false, canRequest: false });
  assert.deepEqual(
    getManualHintRequestState([hint({ trigger: { event: 'workspace_change' } })], empty, state),
    { hasManualHints: false, canRequest: false },
  );
  assert.deepEqual(getManualHintRequestState(null, empty, state), { hasManualHints: false, canRequest: false });
  assert.deepEqual(getManualHintRequestState('nope', empty, state), { hasManualHints: false, canRequest: false });
  assert.deepEqual(getManualHintRequestState([null, undefined, {}], empty, state), { hasManualHints: false, canRequest: false });
});

test('a manual hint is requestable while its condition holds and not once consumed', () => {
  const manual = hint({ id: 'help', trigger: { event: 'manual', conditions: { type: 'workspace_empty' } } });
  const state = createHintState();

  assert.deepEqual(getManualHintRequestState([manual], workspaceOf(), state), { hasManualHints: true, canRequest: true });
  assert.deepEqual(getManualHintRequestState([manual], workspaceOf([printBlock('hi')]), state), { hasManualHints: true, canRequest: false });

  state.consumed.add('help');
  assert.equal(getManualHintRequestState([manual], workspaceOf(), state).canRequest, false);
});

test('a manual hint without conditions is requestable once its attempt threshold is met', () => {
  const manual = hint({ id: 'help', trigger: { event: 'manual', conditions: null, after_attempts: 2 } });
  const state = createHintState();
  const empty = workspaceOf();

  assert.equal(getManualHintRequestState([manual], empty, state).canRequest, false);
  state.attemptCount = 2;
  assert.equal(getManualHintRequestState([manual], empty, state).canRequest, true);

  // A delay is not consulted on a manual request: the student asked, so it shows.
  const delayed = hint({ id: 'slow', delay_seconds: 60, trigger: { event: 'manual', conditions: null } });
  assert.equal(getManualHintRequestState([delayed], empty, createHintState()).canRequest, true);
});

test('one eligible manual hint is enough to allow a request', () => {
  const first = hint({ id: 'a', trigger: { event: 'manual', conditions: null } });
  const second = hint({ id: 'b', trigger: { event: 'manual', conditions: null } });
  const state = createHintState();
  const empty = workspaceOf();

  assert.equal(getManualHintRequestState([first, second], empty, state).canRequest, true);
  state.consumed.add('a');
  assert.equal(getManualHintRequestState([first, second], empty, state).canRequest, true);
  state.consumed.add('b');
  assert.equal(getManualHintRequestState([first, second], empty, state).canRequest, false);
  // Hints that cannot be requested never have to be trusted with a workspace.
  assert.equal(getManualHintRequestState([first], empty, null).canRequest, false);
  assert.equal(getManualHintRequestState([first], null, state).canRequest, false);
});
