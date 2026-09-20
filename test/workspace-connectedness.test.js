/**
 * Workspace connectedness modes — the `mode` field of a
 * `workspace_connectedness` condition.
 *
 * The value comes from a select in the builder, but a condition can also arrive
 * from a legacy config or a hand-edited JSON file, so the normalizer is the one
 * place that decides what an unrecognised mode means. The builder, the
 * normalizer and the inspector all call it with the raw condition value, which
 * may be absent, null or of another type entirely.
 *
 * The module keeps no mutable state, so tests import it directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WORKSPACE_CONNECTEDNESS_MODE,
  normalizeWorkspaceConnectednessMode,
  VALID_WORKSPACE_CONNECTEDNESS_MODES,
  WORKSPACE_CONNECTEDNESS_MODE_OPTIONS,
} from '../src/shared/workspace-connectedness.js';

test('a known mode is returned unchanged', () => {
  assert.equal(normalizeWorkspaceConnectednessMode('all_connected'), 'all_connected');
  assert.equal(normalizeWorkspaceConnectednessMode('all_active'), 'all_active');
});

test('an unknown, legacy or missing mode falls back to the default', () => {
  assert.equal(normalizeWorkspaceConnectednessMode(undefined), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(null), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(''), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode('connected'), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode('all_blocks_connected'), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode('active'), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode('ALL_CONNECTED'), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(' all_active '), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(0), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(1), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(true), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode({}), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(['all_active']), DEFAULT_WORKSPACE_CONNECTEDNESS_MODE);
  assert.equal(normalizeWorkspaceConnectednessMode(DEFAULT_WORKSPACE_CONNECTEDNESS_MODE), 'all_connected');
});

test('the default mode is the first valid mode', () => {
  assert.equal(DEFAULT_WORKSPACE_CONNECTEDNESS_MODE, 'all_connected');
  assert.deepEqual(VALID_WORKSPACE_CONNECTEDNESS_MODES, ['all_connected', 'all_active']);
  assert.equal(VALID_WORKSPACE_CONNECTEDNESS_MODES.includes(DEFAULT_WORKSPACE_CONNECTEDNESS_MODE), true);
});

test('every mode the builder offers survives normalization', () => {
  assert.equal(WORKSPACE_CONNECTEDNESS_MODE_OPTIONS.length, 2);

  const offered = WORKSPACE_CONNECTEDNESS_MODE_OPTIONS.map((option) => option.value);
  assert.deepEqual(offered, [...VALID_WORKSPACE_CONNECTEDNESS_MODES]);

  for (const option of WORKSPACE_CONNECTEDNESS_MODE_OPTIONS) {
    assert.equal(normalizeWorkspaceConnectednessMode(option.value), option.value, option.value);
    assert.equal(typeof option.label, 'string');
    assert.notEqual(option.label.trim(), '');
  }
});
