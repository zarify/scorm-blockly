/**
 * Workspace persistence — the layered store behind `restore`/`persist`.
 *
 * Layer 1 is the LMS's `cmi.suspend_data` (a truncating 4096-character field),
 * layer 2 is IndexedDB on the Moodle origin. Node ships no IndexedDB, so this
 * file provides a small asynchronous stand-in (`createFakeIndexedDb`) with the
 * same observable contract for the calls the module makes: `open` (with the
 * upgrade notification), `transaction().objectStore()`, and `get`/`getAll`/
 * `put`/`delete` requests that settle on a later microtask. It also models the
 * two failure modes that matter here — a store that cannot be opened at all,
 * and a `put` that fails with `QuotaExceededError`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as scorm from '../src/scorm-template/js/scorm-wrapper.js';
import { createWorkspacePersistence } from '../src/scorm-template/js/workspace-persistence.js';
import {
  decodeWorkspacePayload,
  encodeWorkspaceReference,
  encodeWorkspaceState,
} from '../src/scorm-template/js/workspace-state-codec.js';
import { installLms } from './helpers/lms.js';
import { blockState, stateOf, workspaceFromState, workspaceWith } from './helpers/blockly.js';

const ACTIVITY_ID = 'activity-1';
const STUDENT_ID = 'student-42';
const SUSPEND_DATA = 'cmi.suspend_data';
const SPEC_LIMIT = 4096;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const numberBlock = (value) => ({ type: 'math_number', fields: { NUM: String(value) } });

/** A state of `count` top-level number blocks, with no ids or coordinates to strip. */
const numbersState = (count) => blockState(
  Array.from({ length: count }, (_, index) => numberBlock(index + 1)),
);

/** Larger than the 4096-character suspend_data field can hold. */
const hugeState = () => numbersState(600);

/** A state as a live Blockly workspace serializes it. */
const programState = () => stateOf(workspaceWith([
  { type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } } },
  numberBlock(42),
]));

/** Length of the layer-1 encoding of a state, ignoring any cap. */
function payloadLength(state) {
  const payload = encodeWorkspaceState({
    activityId: ACTIVITY_ID,
    state,
    savedAt: 0,
    limit: Number.MAX_SAFE_INTEGER,
  });
  assert.ok(payload, 'fixture state must be encodable');
  return payload.length;
}

/* -------------------------------------------------------------------------- */
/* A minimal IndexedDB                                                        */
/* -------------------------------------------------------------------------- */

function createFakeIndexedDb({ failOpen = false } = {}) {
  const store = new Map();
  const storeNames = new Set();
  const putDelays = [];
  const putErrors = [];
  const clone = (value) => structuredClone(value);
  const makeRequest = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });

  /** Settle a request after `hops` microtasks, so handlers are attached first. */
  const settle = (request, { result, error }, hops = 0) => {
    let turn = Promise.resolve();
    for (let hop = 0; hop < hops; hop += 1) turn = turn.then(() => {});
    turn.then(() => {
      if (error) {
        request.error = error;
        request.onerror?.(new Error('request failed'));
      } else {
        request.result = result;
        request.onsuccess?.();
      }
    });
  };

  const objectStore = () => ({
    get(key) {
      const request = makeRequest();
      settle(request, { result: store.has(key) ? clone(store.get(key)) : undefined });
      return request;
    },
    getAll() {
      const request = makeRequest();
      settle(request, { result: [...store.values()].map(clone) });
      return request;
    },
    put(value) {
      const request = makeRequest();
      const error = putErrors.shift();
      if (error) {
        settle(request, { error });
        return request;
      }
      store.set(value.key, clone(value));
      settle(request, { result: value.key }, putDelays.shift() ?? 0);
      return request;
    },
    delete(key) {
      const request = makeRequest();
      store.delete(key);
      settle(request, { result: undefined });
      return request;
    },
  });

  const database = {
    objectStoreNames: { contains: (name) => storeNames.has(name) },
    createObjectStore: (name) => {
      storeNames.add(name);
      return {};
    },
    transaction: (name) => {
      if (!storeNames.has(name)) throw new Error(`No such object store: ${name}`);
      return { objectStore: () => objectStore() };
    },
  };

  return {
    indexedDB: {
      open() {
        if (failOpen) throw new Error('IndexedDB is unavailable here');
        const request = makeRequest();
        request.result = database;
        Promise.resolve()
          .then(() => request.onupgradeneeded?.())
          .then(() => request.onsuccess?.());
        return request;
      },
    },
    /** The live records, so a test can age, corrupt or evict them. */
    store,
    /** The only record, failing loudly when the store holds another number of them. */
    only() {
      const records = [...store.values()];
      assert.equal(records.length, 1, 'expected exactly one stored record');
      return records[0];
    },
    seed(record) {
      store.set(record.key, clone(record));
    },
    delaysNextPut(hops) {
      putDelays.push(hops);
    },
    failsNextPut(error) {
      putErrors.push(error);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Install a fake LMS (and, optionally, the fake IndexedDB) and open a session.
 * Extra controllers created through `openController` share the same LMS, which
 * is what a later page load looks like.
 */
function startSession(t, { lms = {}, indexedDb = false, connect = true, persistence = {} } = {}) {
  const fake = indexedDb ? createFakeIndexedDb(indexedDb === true ? {} : indexedDb) : null;
  if (fake) globalThis.indexedDB = fake.indexedDB;
  else delete globalThis.indexedDB;

  const server = installLms(lms);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Swallowed: the module's warnings are asserted through the mock's calls.
  const warn = t.mock.method(console, 'warn', () => {});
  const warnings = [];

  const openController = (options = {}) => createWorkspacePersistence({
    activityId: ACTIVITY_ID,
    studentId: STUDENT_ID,
    onWarning: (message) => warnings.push(message),
    ...options,
  });

  const controller = openController(persistence);

  if (connect) scorm.init();
  else scorm.terminate();

  t.after(() => {
    scorm.terminate();
    server.restore();
    delete globalThis.indexedDB;
  });

  return { lms: server, fake, controller, openController, warnings, warn };
}

/** Warnings the persistence module itself logged (the SCORM wrapper logs its own). */
function persistenceWarnings(warn) {
  return warn.mock.calls
    .map((call) => String(call.arguments[0]))
    .filter((message) => message.startsWith('[WorkspacePersistence]'));
}

/** Number of writes the module made through the LMS's suspend_data field. */
function suspendDataWrites(lms) {
  return lms.callsOf('LMSSetValue').filter((call) => call.args[0] === SUSPEND_DATA).length;
}

/** Emptied through the LMS API, the way a student's field starts out elsewhere. */
function clearSuspendDataFromLms(lms) {
  lms.model.delete(SUSPEND_DATA);
}

const storedState = (lms) => decodeWorkspacePayload({
  payload: lms.valueOf(SUSPEND_DATA),
  activityId: ACTIVITY_ID,
});

/**
 * A controller for the same package served from another Moodle path. The
 * module reads `location.pathname` once, when the controller is created, to
 * tell two copies of one package apart.
 */
function controllerAtPath(pathname, options = {}) {
  const previous = globalThis.location;
  globalThis.location = { pathname };
  try {
    return createWorkspacePersistence({
      activityId: ACTIVITY_ID,
      studentId: STUDENT_ID,
      onWarning: () => {},
      ...options,
    });
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
}

/* -------------------------------------------------------------------------- */
/* Restore                                                                    */
/* -------------------------------------------------------------------------- */

test('restore reports nothing stored, with no notice', async (t) => {
  const { controller } = startSession(t, { persistence: { studentId: '' } });

  assert.deepEqual(await controller.restore(), { state: null, source: null, savedAt: 0, notice: null });
});

test('restore ignores suspend_data written for another activity, without a notice', async (t) => {
  const { lms, controller } = startSession(t, { persistence: { studentId: '' } });
  const mine = numbersState(1);

  lms.model.set(SUSPEND_DATA, encodeWorkspaceState({
    activityId: 'another-activity',
    state: numbersState(2),
    savedAt: 10,
    limit: SPEC_LIMIT,
  }));
  assert.deepEqual(await controller.restore(), { state: null, source: null, savedAt: 0, notice: null });

  lms.model.set(SUSPEND_DATA, encodeWorkspaceState({
    activityId: ACTIVITY_ID,
    state: mine,
    savedAt: 20,
    limit: SPEC_LIMIT,
  }));
  assert.deepEqual(await controller.restore(), {
    state: mine,
    source: 'suspend_data',
    savedAt: 20,
    notice: null,
  });
});

test('restore ignores a truncated payload and still uses the browser copy', async (t) => {
  const { lms, fake, controller, openController } = startSession(t, { indexedDb: true });
  const state = numbersState(3);
  await controller.persist(state);
  const stored = lms.valueOf(SUSPEND_DATA);

  // The LMS stored only the first 30 characters of the field.
  lms.model.set(SUSPEND_DATA, stored.slice(0, 30));
  const restored = await controller.restore();
  assert.equal(restored.source, 'indexeddb');
  assert.deepEqual(restored.state, fake.only().state);
  assert.equal(restored.notice, null);

  // With no browser copy the truncated payload is simply nothing.
  const anonymous = openController({ studentId: '' });
  assert.deepEqual(await anonymous.restore(), { state: null, source: null, savedAt: 0, notice: null });

  // Raw JSON from an older version of the package is ignored rather than reported as lost.
  lms.model.set(SUSPEND_DATA, JSON.stringify(blockState([numberBlock(1)])));
  assert.deepEqual(await anonymous.restore(), { state: null, source: null, savedAt: 0, notice: null });
});

test('restore prefers the suspend_data snapshot when both layers hold it', async (t) => {
  const { fake, controller } = startSession(t, { indexedDb: true });
  const state = numbersState(2);
  await controller.persist(state);
  const record = fake.only();

  const restored = await controller.restore();
  assert.equal(restored.source, 'suspend_data');
  assert.equal(restored.savedAt, record.savedAt);
  assert.deepEqual(restored.state, state);
});

test('restore takes the newest snapshot when the layers disagree', async (t) => {
  const { lms, fake, controller, openController } = startSession(t, { indexedDb: true });
  const older = numbersState(1);
  await controller.persist(older);
  const record = fake.only();
  const base = record.savedAt;

  // The browser copy is newer than the copy the LMS is holding.
  const newerOnDevice = numbersState(2);
  record.savedAt = base + 60_000;
  record.state = structuredClone(newerOnDevice);
  assert.deepEqual(await openController().restore(), {
    state: newerOnDevice,
    source: 'indexeddb',
    savedAt: base + 60_000,
    notice: null,
  });

  // A session on another device left a newer copy in the LMS.
  const newerOnLms = numbersState(3);
  record.savedAt = base - 60_000;
  record.state = structuredClone(older);
  lms.model.set(SUSPEND_DATA, encodeWorkspaceState({
    activityId: ACTIVITY_ID,
    state: newerOnLms,
    savedAt: base + 120_000,
    limit: SPEC_LIMIT,
  }));
  assert.deepEqual(await openController().restore(), {
    state: newerOnLms,
    source: 'suspend_data',
    savedAt: base + 120_000,
    notice: null,
  });
});

test('restore ignores a record for another activity or one holding an unusable state', async (t) => {
  const { lms, fake, controller } = startSession(t, { indexedDb: true });
  await controller.persist(numbersState(2));
  const record = fake.only();
  clearSuspendDataFromLms(lms);

  record.activityId = 'a-different-activity';
  assert.deepEqual(await controller.restore(), { state: null, source: null, savedAt: 0, notice: null });

  record.activityId = ACTIVITY_ID;
  record.state = { blocks: { languageVersion: 0 } };
  assert.deepEqual(await controller.restore(), { state: null, source: null, savedAt: 0, notice: null });
});

test('a reference in suspend_data with the browser copy gone reports the lost copy', async (t) => {
  const { lms, fake, controller, openController } = startSession(t, { indexedDb: true });
  const state = numbersState(2);
  await controller.persist(state);
  const record = fake.only();

  // The LMS knows about the saved session; this browser has lost the blocks.
  fake.store.clear();
  lms.model.set(SUSPEND_DATA, encodeWorkspaceReference({
    activityId: ACTIVITY_ID,
    savedAt: record.savedAt,
  }));
  const lost = await openController().restore();
  assert.equal(lost.state, null);
  assert.equal(lost.source, null);
  assert.equal(lost.savedAt, 0);
  assert.match(lost.notice, /no longer has the saved copy/);

  // The same reference, with the browser copy back in place.
  fake.seed(record);
  const found = await openController().restore();
  assert.equal(found.source, 'indexeddb');
  assert.equal(found.notice, null);
  assert.deepEqual(found.state, state);
});

test('an empty student id keeps the browser copy out of reach', async (t) => {
  const { fake, controller, openController, warnings } = startSession(t, { indexedDb: true });
  const onLms = numbersState(1);
  const onDevice = numbersState(4);
  await controller.persist(onLms);
  const record = fake.only();
  record.savedAt += 60_000;
  record.state = structuredClone(onDevice);

  const anonymous = openController({ studentId: '' });
  assert.equal(anonymous.isIndexedDbAvailable(), false);
  const restored = await anonymous.restore();
  assert.equal(restored.source, 'suspend_data');
  assert.deepEqual(restored.state, onLms);

  // Without a student id there is no fallback layer for what the LMS cannot keep.
  assert.equal(await anonymous.persist(hugeState()), 'none');
  assert.equal(fake.store.size, 1);
  assert.deepEqual(warnings, [
    'Your blocks are too large to save, so progress will not be restored next session.',
  ]);
});

test('a second copy of the package in the same browser does not see the first copy’s state', async (t) => {
  const { lms, fake, controller } = startSession(t, { indexedDb: true });
  const stateA = numbersState(1);
  await controller.persist(stateA);
  const recordA = fake.only();
  clearSuspendDataFromLms(lms);

  const elsewhere = controllerAtPath('/mod/scorm/instance-2/view.php');
  // Layer 1 is shared, layer 2 is not: the other copy finds nothing to restore.
  assert.deepEqual(await elsewhere.restore(), { state: null, source: null, savedAt: 0, notice: null });

  const stateB = numbersState(2);
  assert.equal(await elsewhere.persist(stateB), 'suspend_data');
  assert.equal(fake.store.size, 2);
  assert.deepEqual(fake.store.get(recordA.key).state, stateA);

  // Each copy reads back its own browser record.
  clearSuspendDataFromLms(lms);
  assert.deepEqual((await elsewhere.restore()).state, stateB);
  assert.deepEqual((await controller.restore()).state, stateA);
});

/* -------------------------------------------------------------------------- */
/* Persist                                                                    */
/* -------------------------------------------------------------------------- */

test('persist writes a payload the next session can load, and names the layer', async (t) => {
  const { lms, controller, openController } = startSession(t, { indexedDb: true });
  const state = programState();

  assert.equal(await controller.persist(state), 'suspend_data');
  assert.equal(storedState(lms).kind, 'state');

  const next = await openController().restore();
  assert.equal(next.source, 'suspend_data');
  const workspace = workspaceFromState(next.state);
  assert.deepEqual(
    workspace.getTopBlocks(false).map((block) => block.type).sort(),
    ['math_number', 'text_print'],
  );
  assert.ok(workspace.getAllBlocks(false).some(
    (block) => block.type === 'text' && block.getFieldValue('TEXT') === 'hello',
  ));
});

test('persist leaves an unchanged state alone', async (t) => {
  const { lms, fake, controller } = startSession(t, { indexedDb: true });
  const state = numbersState(2);
  await controller.persist(state);
  const writes = suspendDataWrites(lms);
  const savedAt = fake.only().savedAt;

  assert.equal(await controller.persist(state), 'suspend_data');
  assert.equal(await controller.persist(structuredClone(state)), 'suspend_data');
  assert.equal(suspendDataWrites(lms), writes);
  assert.equal(fake.only().savedAt, savedAt);

  assert.equal(await controller.persist(numbersState(3)), 'suspend_data');
  assert.equal(suspendDataWrites(lms), writes + 1);
});

test('a snapshot restored from the browser copy is not written back on load', async (t) => {
  const { lms, controller, openController } = startSession(t, {
    indexedDb: true,
    lms: { rejectSuspendData: true },
  });
  const state = numbersState(2);
  assert.equal(await controller.persist(state), 'indexeddb');
  const writes = suspendDataWrites(lms);

  const next = await openController();
  const restored = await next.restore();
  assert.equal(restored.source, 'indexeddb');
  assert.deepEqual(restored.state, state);

  assert.equal(await next.persist(restored.state), 'indexeddb');
  assert.equal(suspendDataWrites(lms), writes);
});

test('two persists in flight land in order', async (t) => {
  const { lms, fake, controller } = startSession(t, { indexedDb: true });
  fake.delaysNextPut(8);

  const results = await Promise.all([
    controller.persist(numbersState(1)),
    controller.persist(numbersState(5)),
  ]);
  assert.deepEqual(results, ['suspend_data', 'suspend_data']);

  assert.equal(storedState(lms).state.blocks.blocks.length, 5);
  const order = lms.callsOf('LMSSetValue')
    .filter((call) => call.args[0] === SUSPEND_DATA)
    .map((call) => decodeWorkspacePayload({ payload: call.args[1], activityId: ACTIVITY_ID })
      ?.state?.blocks?.blocks?.length);
  assert.deepEqual(order, [1, 5]);
});

test('nothing is written before the SCORM session is active', async (t) => {
  const { lms, controller, warnings } = startSession(t, {
    connect: false,
    persistence: { studentId: '' },
  });
  const state = numbersState(1);

  assert.equal(await controller.persist(state), 'none');
  assert.equal(controller.persistNow(state), 'none');
  assert.deepEqual(lms.callsOf('LMSSetValue'), []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(await controller.restore(), { state: null, source: null, savedAt: 0, notice: null });
});

test('persistNow writes straight through the suspend_data layer', async (t) => {
  const { lms, controller, warnings } = startSession(t, { indexedDb: true });
  const first = numbersState(1);
  await controller.persist(first);

  const second = numbersState(2);
  assert.equal(controller.persistNow(second), 'suspend_data');
  assert.deepEqual(storedState(lms).state, second);
  const writes = suspendDataWrites(lms);
  assert.equal(controller.persistNow(second), 'suspend_data');
  assert.equal(suspendDataWrites(lms), writes);

  // Something too large for the field cannot use the browser copy left by `persist`.
  assert.equal(controller.persistNow(hugeState()), 'indexeddb');
  assert.deepEqual(warnings, [
    'Your blocks are stored in this browser only — they are too large for the LMS to keep.',
  ]);
  assert.deepEqual(storedState(lms).state, second);
});

/* -------------------------------------------------------------------------- */
/* Failure paths                                                              */
/* -------------------------------------------------------------------------- */

test('a truncating LMS is caught by read-back: the cap drops, one warning, the browser copy takes over', async (t) => {
  const { lms, fake, controller, warn, warnings } = startSession(t, {
    indexedDb: true,
    lms: { suspendDataLimit: 300 },
  });
  const small = numbersState(1);
  const big = numbersState(20);
  assert.ok(payloadLength(small) <= 300 && payloadLength(big) > 300, 'fixture sizes');

  assert.equal(await controller.persist(small), 'suspend_data');
  assert.equal(controller.getEffectiveLimit(), SPEC_LIMIT);
  assert.deepEqual(persistenceWarnings(warn), []);

  assert.equal(await controller.persist(big), 'indexeddb');
  assert.equal(controller.getEffectiveLimit(), 300);
  assert.deepEqual(fake.only().state, big);
  // The truncated write was replaced by the last snapshot that fit.
  assert.deepEqual(storedState(lms).state, small);
  const logged = persistenceWarnings(warn);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /stored 300 of \d+ characters; capping suspend data at 300/);
  assert.deepEqual(warnings, []);

  // A second truncating write warns no further, and does not shrink the cap again.
  assert.equal(await controller.persist(numbersState(8)), 'indexeddb');
  assert.equal(controller.getEffectiveLimit(), 300);
  assert.deepEqual(persistenceWarnings(warn).length, 1);
  assert.deepEqual(storedState(lms).state, small);
});

test('the cap learned in an earlier session is reused instead of rediscovered', async (t) => {
  const { lms, fake, controller, openController, warn } = startSession(t, {
    indexedDb: true,
    lms: { suspendDataLimit: 300 },
  });
  const small = numbersState(1);
  assert.equal(await controller.persist(numbersState(20)), 'indexeddb');
  assert.equal(controller.getEffectiveLimit(), 300);

  // The learned cap reaches the record on the next write.
  assert.equal(await controller.persist(small), 'suspend_data');
  assert.equal(fake.only().suspendLimit, 300);
  assert.equal(persistenceWarnings(warn).length, 1);

  const writes = suspendDataWrites(lms);
  const next = await openController();
  const restored = await next.restore();
  assert.equal(restored.source, 'suspend_data');
  assert.equal(next.getEffectiveLimit(), 300);
  // Reading the cap back wrote nothing.
  assert.equal(suspendDataWrites(lms), writes);
  assert.equal(persistenceWarnings(warn).length, 1);

  const fitting = numbersState(2);
  assert.ok(payloadLength(fitting) <= 300, 'fixture must fit the learned cap');
  assert.equal(await next.persist(fitting), 'suspend_data');
  assert.equal(persistenceWarnings(warn).length, 1);
});

test('an LMS that stores nothing at all does not drag the cap to zero', async (t) => {
  const { lms, fake, controller, openController, warnings, warn } = startSession(t, {
    indexedDb: true,
    lms: { suspendDataLimit: 0 },
  });
  const state = numbersState(3);

  assert.equal(await controller.persist(state), 'indexeddb');
  assert.equal(controller.getEffectiveLimit(), SPEC_LIMIT);
  // Nothing half-written is left behind for the next session to read.
  assert.equal(lms.valueOf(SUSPEND_DATA), '');
  assert.equal(persistenceWarnings(warn).length, 1);
  assert.deepEqual(warnings, []);

  const next = await openController().restore();
  assert.equal(next.source, 'indexeddb');
  assert.deepEqual(next.state, fake.only().state);
  assert.deepEqual(next.state, state);
});

test('a write the LMS refuses leaves the browser copy as the only layer, without alarming the student', async (t) => {
  const { lms, fake, controller, warnings, warn } = startSession(t, {
    indexedDb: true,
    lms: { rejectSuspendData: true },
  });

  assert.equal(await controller.persist(numbersState(1)), 'indexeddb');
  assert.equal(await controller.persist(numbersState(2)), 'indexeddb');
  assert.equal(lms.valueOf(SUSPEND_DATA), '');
  assert.ok(lms.rejected.length > 0);
  // The work is stored in the browser, so there is nothing to warn about.
  assert.deepEqual(warnings, []);
  assert.deepEqual(persistenceWarnings(warn), []);
  assert.deepEqual(fake.only().state, numbersState(2));
});

test('a refused write with no browser copy tells the student the work will not be restored', async (t) => {
  const { controller, warnings } = startSession(t, {
    lms: { rejectSuspendData: true },
    persistence: { studentId: '' },
  });

  assert.equal(await controller.persist(numbersState(1)), 'none');
  assert.equal(await controller.persist(numbersState(2)), 'none');
  assert.deepEqual(warnings, [
    'The LMS did not store your blocks, so progress will not be restored next session.',
  ]);
});

test('a workspace too large for either layer warns once with the consequence', async (t) => {
  const { controller, openController, warnings } = startSession(t, { indexedDb: true });
  const huge = hugeState();
  assert.equal(encodeWorkspaceState({
    activityId: ACTIVITY_ID,
    state: huge,
    savedAt: 0,
    limit: SPEC_LIMIT,
  }), null, 'fixture must not fit the spec limit');

  const anonymous = openController({ studentId: '' });
  assert.equal(await anonymous.persist(huge), 'none');
  assert.equal(await anonymous.persist(huge), 'none');

  // The browser copy can hold it, and the student is told where it went.
  assert.equal(await controller.persist(huge), 'indexeddb');
  assert.deepEqual(warnings, [
    'Your blocks are too large to save, so progress will not be restored next session.',
    'Your blocks are stored in this browser only — they are too large for the LMS to keep.',
  ]);
});

test('a broken IndexedDB never breaks the suspend_data layer', async (t) => {
  const { controller, openController } = startSession(t, { indexedDb: { failOpen: true } });
  const state = numbersState(2);

  assert.equal(await controller.persist(state), 'suspend_data');
  assert.equal(controller.isIndexedDbAvailable(), false);

  const restored = await openController().restore();
  assert.equal(restored.source, 'suspend_data');
  assert.deepEqual(restored.state, state);
});

test('a full browser store makes room instead of losing the save', async (t) => {
  const { fake, controller } = startSession(t, { indexedDb: true });
  const stranger = {
    key: 'other::record',
    activityId: 'another-activity',
    studentId: STUDENT_ID,
    savedAt: Date.now(),
    suspendLimit: SPEC_LIMIT,
    state: numbersState(1),
  };
  fake.seed(stranger);
  fake.failsNextPut(Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' }));

  const state = numbersState(2);
  assert.equal(await controller.persist(state), 'suspend_data');
  assert.equal(fake.store.has(stranger.key), false);
  assert.deepEqual(fake.only().state, state);
});

test('an unusable state never leaves a broken payload behind', async (t) => {
  const { lms, controller, openController } = startSession(t, { indexedDb: true });

  for (const unusable of [null, undefined, 'not a state', { blocks: {} }]) {
    await controller.persist(unusable);
    const stored = storedState(lms);
    assert.ok(stored === null || stored.kind === 'reference', `layer 1 holds ${JSON.stringify(stored)}`);
  }

  // The junk records are not handed back as a workspace.
  const restored = await openController().restore();
  assert.equal(restored.state, null);

  // And a real state still stores normally afterwards.
  const state = numbersState(2);
  assert.equal(await controller.persist(state), 'suspend_data');
  assert.deepEqual(storedState(lms).state, state);
});

/* -------------------------------------------------------------------------- */
/* Limits and discard                                                         */
/* -------------------------------------------------------------------------- */

test('the cap is normalized before it reaches the encoder', () => {
  const cap = (limit) => createWorkspacePersistence({ activityId: ACTIVITY_ID, limit })
    .getEffectiveLimit();

  assert.equal(cap(0), SPEC_LIMIT);
  assert.equal(cap(-10), SPEC_LIMIT);
  assert.equal(cap(Number.NaN), SPEC_LIMIT);
  assert.equal(cap(Number.POSITIVE_INFINITY), SPEC_LIMIT);
  assert.equal(cap(undefined), SPEC_LIMIT);
  assert.equal(cap(1024.9), 1024);
  assert.equal(cap('2048'), 2048);
});

test('discard clears both layers and keeps the given state as the baseline', async (t) => {
  const { lms, fake, controller } = startSession(t, { indexedDb: true });
  const state = numbersState(2);
  await controller.persist(state);
  assert.equal(fake.store.size, 1);
  const writes = suspendDataWrites(lms);

  await controller.discard(state);
  assert.equal(lms.valueOf(SUSPEND_DATA), '');
  assert.equal(fake.store.size, 0);

  // The reset does not write the same state straight back.
  assert.equal(await controller.persist(state), 'none');
  assert.equal(suspendDataWrites(lms), writes + 1);

  // A changed workspace stores again, into both layers.
  assert.equal(await controller.persist(numbersState(3)), 'suspend_data');
  assert.equal(fake.store.size, 1);
});
