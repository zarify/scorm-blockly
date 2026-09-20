/**
 * Workspace state codec — the payload written to SCORM 1.2 `cmi.suspend_data`.
 *
 * The interesting edges are the fixed width of that field (4096 characters,
 * below which the codec would rather store nothing than store a truncated
 * program), the four encodings it chooses between, the ASCII-only data-model
 * type that pushes every non-ASCII value onto the base64/LZW path, and the
 * activity id baked into the header — a payload may only be restored by the
 * activity that wrote it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUSPEND_DATA_MAX_LENGTH,
  SUSPEND_DATA_MIN_LENGTH,
  compactWorkspaceState,
  decodeWorkspacePayload,
  encodeWorkspaceReference,
  encodeWorkspaceState,
  sanitizeActivityId,
} from '../src/scorm-template/js/workspace-state-codec.js';
import { stateOf, workspaceFromState, workspaceWith } from './helpers/blockly.js';

/** A fixed timestamp keeps every payload length in this file deterministic. */
const SAVED_AT = 1700000000000;
const SAVED_AT_BASE36 = 'loyw3v28';

const emptyWorkspace = () => ({ blocks: { languageVersion: 0, blocks: [] } });
const textBlock = (text) => ({
  blocks: { languageVersion: 0, blocks: [{ type: 'text', fields: { TEXT: text } }] },
});

/** A deterministic, high-entropy ASCII string: LZW cannot shrink it. */
function noisyText(length, seed = 0x2545f491) {
  let state = seed >>> 0;
  const chars = [];
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    chars.push(String.fromCharCode(33 + ((state >>> 0) % 94)));
  }
  return chars.join('');
}

/** 140 distinct CJK code points: not ASCII, and not compressible either. */
const uniqueCjk = () => Array.from({ length: 140 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');

const formatOf = (payload) => payload.split('|')[2];
const encode = (overrides) => encodeWorkspaceState({ activityId: 'act', savedAt: SAVED_AT, ...overrides });
const decode = (payload, activityId = 'act') => decodeWorkspacePayload({ payload, activityId });

test('the persisted payload is prefix, activity, format, base36 timestamp, data', () => {
  const payload = encode({ activityId: 'act-1', state: emptyWorkspace() });

  assert.equal(payload, `BS1|act-1|J|${SAVED_AT_BASE36}|{"blocks":{"languageVersion":0,"blocks":[]}}`);
  assert.equal(Number.parseInt(SAVED_AT_BASE36, 36), SAVED_AT);
});

test('a state with nothing to strip keeps the raw JSON format and comes back unchanged', () => {
  const state = textBlock('hello');

  const payload = encode({ state });

  // Dropping ids and coordinates changes nothing here, so the raw JSON
  // candidate is the one that survives.
  assert.equal(formatOf(payload), 'J');
  assert.deepEqual(decode(payload), { kind: 'state', format: 'J', savedAt: SAVED_AT, state });
});

test('ids and coordinates are dropped when that is what makes the payload fit', () => {
  const state = {
    blocks: {
      languageVersion: 0,
      blocks: [{ id: 'blk-1', x: 40, y: 30, type: 'math_number', fields: { NUM: 7 } }],
    },
  };

  const payload = encode({ state });

  assert.equal(formatOf(payload), 'C');
  assert.deepEqual(decode(payload), {
    kind: 'state',
    format: 'C',
    savedAt: SAVED_AT,
    state: { blocks: { languageVersion: 0, blocks: [{ type: 'math_number', fields: { NUM: 7 } }] } },
  });
});

test('a non-ASCII program takes the base64 path and the payload stays printable ASCII', () => {
  const text = `${uniqueCjk()} 🚀`;
  const state = textBlock(text);

  const payload = encode({ state });

  assert.equal(formatOf(payload), 'B');
  assert.match(payload, /^[\x20-\x7e]+$/);
  assert.equal(decode(payload).state.blocks.blocks[0].fields.TEXT, text);
});

test('a large repetitive program takes the LZW path and reloads into a real workspace', (t) => {
  const blocks = Array.from({ length: 150 }, (_, i) => ({ type: 'text', fields: { TEXT: `line ${i % 5}` } }));
  const workspace = workspaceWith(blocks);
  t.after(() => workspace.dispose());
  const state = stateOf(workspace);

  const payload = encode({ state });

  assert.equal(formatOf(payload), 'L');
  assert.ok(payload.length <= SUSPEND_DATA_MAX_LENGTH, 'payload should still fit the SCORM field');
  assert.ok(payload.length < JSON.stringify(state).length, 'compression should beat the raw state');

  const decoded = decode(payload);
  assert.equal(decoded.savedAt, SAVED_AT);
  assert.ok(!decoded.state.blocks.blocks.some((block) => 'id' in block || 'x' in block || 'y' in block));

  const reloaded = workspaceFromState(decoded.state);
  t.after(() => reloaded.dispose());
  const restored = reloaded.getTopBlocks(false).map((block) => block.getFieldValue('TEXT'));
  assert.equal(restored.length, 150);
  assert.deepEqual([...new Set(restored)].sort(), ['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
});

test('a program large enough to fill the LZW dictionary still round-trips', () => {
  // High-entropy noise fills the 16-bit dictionary, then a long repetition
  // exploits it; the noise alone would never be chosen for compression.
  const text = noisyText(120000) + 'abcdefghij'.repeat(20000);
  const state = textBlock(text);

  const payload = encode({ state, limit: 1e6 });

  assert.equal(formatOf(payload), 'L');
  assert.equal(decode(payload).state.blocks.blocks[0].fields.TEXT, text);
});

test('a payload exactly at the limit is kept, one character over is refused', () => {
  const state = textBlock(uniqueCjk());

  const payload = encode({ state });
  assert.ok(payload.length > SUSPEND_DATA_MIN_LENGTH, 'the exact-fit boundary must sit above the minimum');

  assert.equal(encode({ state, limit: payload.length }), payload);
  assert.equal(encode({ state, limit: payload.length - 1 }), null);
  assert.equal(encode({ state, limit: payload.length - 0.1 }), null);
});

test('the SCORM field width is the default limit, and an oversized program is refused', () => {
  const state = textBlock(noisyText(6000));
  const payload = encode({ state, limit: 20000 });

  assert.equal(SUSPEND_DATA_MAX_LENGTH, 4096);
  assert.ok(payload.length > SUSPEND_DATA_MAX_LENGTH);
  assert.equal(decode(payload).state.blocks.blocks[0].fields.TEXT, state.blocks.blocks[0].fields.TEXT);
  assert.equal(encode({ state }), null);
});

test('a limit under the minimum is raised to the minimum, so only tiny payloads survive', () => {
  const tiny = encode({ state: emptyWorkspace() });
  const overMinimum = encode({ state: textBlock(uniqueCjk()) });

  assert.equal(SUSPEND_DATA_MIN_LENGTH, 512);
  assert.ok(tiny.length < SUSPEND_DATA_MIN_LENGTH);
  assert.ok(overMinimum.length > SUSPEND_DATA_MIN_LENGTH);

  for (const limit of [0, 1, -1000, SUSPEND_DATA_MIN_LENGTH - 1]) {
    assert.equal(encode({ state: emptyWorkspace(), limit }), tiny, `limit ${limit} should still admit a tiny payload`);
    assert.equal(encode({ state: textBlock(uniqueCjk()), limit }), null, `limit ${limit} should refuse an over-minimum payload`);
  }
  assert.equal(encode({ state: textBlock(uniqueCjk()), limit: SUSPEND_DATA_MIN_LENGTH }), null);
});

test('a limit that is not a usable number falls back to the field width', () => {
  const state = textBlock(uniqueCjk());
  const payload = encode({ state });

  for (const limit of [NaN, Infinity, -Infinity, 'many', {}, undefined]) {
    assert.equal(encode({ state, limit }), payload, `limit ${String(limit)} should fall back to the maximum`);
  }
  // Numeric strings and fractions are coerced towards the limit they carry.
  assert.equal(encode({ state, limit: '2000' }), payload);
  assert.equal(encode({ state, limit: payload.length + 0.9 }), payload);
  // ...while null coerces to zero and therefore floors at the minimum.
  assert.equal(encode({ state, limit: null }), null);
});

test('a payload is restored only by the activity id that wrote it', () => {
  const state = emptyWorkspace();
  const forA = encode({ state, activityId: 'Act-1' });
  const forB = encode({ state, activityId: 'Act-2' });

  assert.equal(decode(forA, 'Act-1').kind, 'state');
  assert.equal(decode(forB, 'Act-2').kind, 'state');
  assert.equal(decode(forA, 'Act-2'), null);
  assert.equal(decode(forB, 'Act-1'), null);

  // Header ids are compared exactly, after sanitising, so case and stray
  // punctuation both separate two activities.
  assert.equal(decode(forA, 'act-1'), null);
  assert.equal(decode(forA, 'Act-1 '), null);
  assert.equal(decode(forA, ''), null);

  const forDefault = encode({ state, activityId: '' });
  assert.equal(decode(forDefault, 'Act-1'), null);
  assert.equal(decode(forDefault, '').kind, 'state');

  const reference = encodeWorkspaceReference({ activityId: 'Act-1', savedAt: SAVED_AT });
  assert.equal(decode(reference, 'Act-2'), null);
  assert.equal(decode(reference, 'Act-1').kind, 'reference');
});

test('an activity id containing the header delimiter cannot break the framing', () => {
  const state = textBlock('hello');

  const payload = encode({ state, activityId: 'course|1' });

  assert.equal(payload.split('|')[1], 'course_1');
  assert.equal(formatOf(payload), 'J');
  assert.deepEqual(decode(payload, 'course|1').state, state);
  // Scoping follows the sanitised id, so any id that sanitises to the same
  // string — here the literal 'course_1' — is treated as the same activity.
  assert.equal(decode(payload, 'course_1').kind, 'state');
});

test('an activity id is reduced to the ASCII subset the header can carry', () => {
  assert.equal(sanitizeActivityId('12345'), '12345');
  assert.equal(sanitizeActivityId('course-1.v2_x'), 'course-1.v2_x');
  assert.equal(sanitizeActivityId('a b'), 'a_b');
  assert.equal(sanitizeActivityId('a/b\\c'), 'a_b_c');
  assert.equal(sanitizeActivityId('id|1'), 'id_1');
  assert.equal(sanitizeActivityId('héllo'), 'h_llo');
  assert.equal(sanitizeActivityId('日本'), '__');
  assert.equal(sanitizeActivityId('a🚀b'), 'a__b');
  assert.equal(sanitizeActivityId(''), '');
  assert.equal(sanitizeActivityId(null), '');
  assert.equal(sanitizeActivityId(undefined), '');
  assert.equal(sanitizeActivityId(0), '0');
  assert.equal(sanitizeActivityId(42), '42');

  const long = sanitizeActivityId('x'.repeat(5000) + '€');
  assert.equal(long, `${'x'.repeat(5000)}_`);
});

test('a very long activity id costs payload room without changing the format', () => {
  const state = textBlock('hello');
  const activityId = 'a'.repeat(1000);

  const short = encode({ state, activityId: 'a' });
  const long = encode({ state, activityId });

  assert.equal(formatOf(long), formatOf(short));
  assert.equal(long.length, short.length + activityId.length - 1);
  assert.equal(decode(long, activityId).kind, 'state');
  assert.equal(decode(long, 'a'), null);
});

test('a reference payload decodes as a reference that carries no state', () => {
  const reference = encodeWorkspaceReference({ activityId: 'act-1', savedAt: SAVED_AT });

  assert.equal(reference, `BS1|act-1|I|${SAVED_AT_BASE36}|`);
  assert.deepEqual(decodeWorkspacePayload({ payload: reference, activityId: 'act-1' }), {
    kind: 'reference',
    format: 'I',
    savedAt: SAVED_AT,
    state: null,
  });

  const bare = encodeWorkspaceReference({ savedAt: SAVED_AT });
  assert.equal(bare, `BS1||I|${SAVED_AT_BASE36}|`);
  assert.equal(decodeWorkspacePayload({ payload: bare }).kind, 'reference');
});

test('foreign or truncated payloads are refused instead of throwing', (t) => {
  t.mock.method(console, 'warn', () => {});

  const foreign = [
    undefined,
    null,
    '',
    42,
    {},
    [],
    'BS1',
    'BS1|',
    'BS2||J|loyw3v28|{"blocks":{"blocks":[]}}',
    'bs1||J|loyw3v28|{"blocks":{"blocks":[]}}',
    'BS1||J',
    'BS1||J|loyw3v28',
    'BS1||J|loyw3v28|',
    'BS1||J|loyw3v28|{oops}',
    'BS1||j|loyw3v28|{"blocks":{"blocks":[]}}',
    'BS1||X|loyw3v28|{"blocks":{"blocks":[]}}',
    'BS1||B|loyw3v28|!!!!',
    'BS1||B|loyw3v28|aGVsbG8=',
    'BS1||B|loyw3v28|W10=',
    'BS1||B|loyw3v28|eyJibG9ja3Mi',
    'BS1||L|loyw3v28|!!!!',
    'BS1||L|loyw3v28|AAAAA',
    'BS1||C|loyw3v28|{"blocks":{}}',
  ];

  for (const payload of foreign) {
    assert.equal(decodeWorkspacePayload({ payload, activityId: '' }), null, `expected ${JSON.stringify(payload)} to be refused`);
  }
  assert.equal(decodeWorkspacePayload(), null);
});

test('a readable body that is not a workspace serialization is refused', (t) => {
  t.mock.method(console, 'warn', () => {});

  const bodies = [
    'null',
    '5',
    '"text"',
    '[]',
    '{}',
    '{"blocks":5}',
    '{"blocks":{}}',
    '{"blocks":{"blocks":{}}}',
    '{"blocks":{"blocks":null}}',
    // The pre-serializer shape (a bare block array) is not a workspace state.
    '{"blocks":[{"type":"text"}]}',
  ];

  for (const body of bodies) {
    assert.equal(decodeWorkspacePayload({ payload: `BS1||J|loyw3v28|${body}` }), null, body);
  }

  assert.deepEqual(decodeWorkspacePayload({ payload: 'BS1||J|loyw3v28|{"blocks":{"blocks":[]}}' }).state, {
    blocks: { blocks: [] },
  });
});

test('a pipe inside a field value survives the header intact', () => {
  const state = textBlock('a|b|c');

  const payload = encode({ state });

  assert.equal(formatOf(payload), 'J');
  assert.equal(decode(payload).state.blocks.blocks[0].fields.TEXT, 'a|b|c');
});

test('the timestamp survives every format', () => {
  const cjk = uniqueCjk();
  const cases = [
    ['J', textBlock('hello')],
    ['C', { blocks: { languageVersion: 0, blocks: [{ id: 'blk-1', x: 40, y: 30, type: 'math_number', fields: { NUM: 7 } }] } }],
    ['B', textBlock(cjk)],
    ['L', { blocks: { languageVersion: 0, blocks: Array.from({ length: 60 }, () => ({ type: 'text', fields: { TEXT: 'line' } })) } }],
  ];

  for (const [format, state] of cases) {
    const payload = encode({ state });
    assert.equal(formatOf(payload), format);
    assert.equal(decode(payload).savedAt, SAVED_AT);
  }
});

test('a zero, fractional, negative or huge timestamp is kept as written', () => {
  const state = emptyWorkspace();

  assert.equal(decode(encode({ state, savedAt: 0 })).savedAt, 0);
  assert.equal(decode(encode({ state, savedAt: 1000.9 })).savedAt, 1000);
  assert.equal(decode(encode({ state, savedAt: -5 })).savedAt, -5);
  assert.equal(decode(encode({ state, savedAt: Number.MAX_SAFE_INTEGER })).savedAt, Number.MAX_SAFE_INTEGER);
});

test('a missing or unusable timestamp falls back to the encode instant', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1700000000000 });

  for (const savedAt of [undefined, null, NaN, Infinity, '1234', {}]) {
    const payload = encodeWorkspaceState({ activityId: 'act', state: emptyWorkspace(), savedAt });
    assert.equal(decode(payload).savedAt, 1700000000000, `savedAt ${String(savedAt)}`);
  }

  assert.equal(decode(encodeWorkspaceState({ activityId: 'act', state: emptyWorkspace() })).savedAt, 1700000000000);
  assert.equal(
    decodeWorkspacePayload({ payload: encodeWorkspaceReference() }).savedAt,
    1700000000000,
  );
});

test('encoding without a workspace object produces no payload', () => {
  for (const state of [undefined, null, 'text', 7, true, () => {}]) {
    assert.equal(encodeWorkspaceState({ activityId: 'act', savedAt: SAVED_AT, state }), null, String(state));
  }
  assert.equal(encodeWorkspaceState(), null);
  assert.equal(encodeWorkspaceState({ savedAt: SAVED_AT }), null);
  assert.equal(encodeWorkspaceState({ state: null, limit: 1e6 }), null);
});

test('compacting strips ids and coordinates at every nesting level and leaves the input alone', () => {
  const state = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          id: 'top-1',
          x: 10,
          y: 20,
          type: 'controls_repeat_ext',
          inputs: {
            TIMES: { shadow: { id: 'shadow-1', x: 1, y: 2, type: 'math_number', fields: { NUM: 10 } } },
            DO: {
              block: {
                id: 'inner-1',
                x: 3,
                y: 4,
                type: 'text',
                fields: { TEXT: 'hi' },
                next: { block: { id: 'next-1', x: 5, y: 6, type: 'text', fields: { TEXT: 'bye' } } },
              },
            },
          },
        },
        { id: 'lone-1', type: 'math_number', fields: { NUM: 0 } },
      ],
    },
  };
  const before = JSON.parse(JSON.stringify(state));

  const compact = compactWorkspaceState(state);

  assert.deepEqual(state, before);
  assert.deepEqual(compact, {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'controls_repeat_ext',
          inputs: {
            TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } },
            DO: {
              block: {
                type: 'text',
                fields: { TEXT: 'hi' },
                next: { block: { type: 'text', fields: { TEXT: 'bye' } } },
              },
            },
          },
        },
        { type: 'math_number', fields: { NUM: 0 } },
      ],
    },
  });
});

test('compacting tolerates partial and unrecognised block shapes', () => {
  const state = {
    blocks: {
      blocks: [
        null,
        { id: 'a', x: 1, y: 2, type: 'text', inputs: { A: null, B: {}, C: undefined }, next: null },
      ],
    },
  };

  assert.deepEqual(compactWorkspaceState(state), {
    blocks: { blocks: [null, { type: 'text', inputs: { A: null, B: {} }, next: null }] },
  });

  // Shapes with no block list survive untouched, and properties JSON cannot
  // carry are dropped rather than crashing.
  assert.deepEqual(compactWorkspaceState({}), {});
  assert.deepEqual(compactWorkspaceState({ blocks: {} }), { blocks: {} });
  assert.deepEqual(compactWorkspaceState({ blocks: { blocks: null } }), { blocks: { blocks: null } });
  assert.deepEqual(
    compactWorkspaceState({ blocks: { blocks: [], unused: undefined } }),
    { blocks: { blocks: [] } },
  );
});
