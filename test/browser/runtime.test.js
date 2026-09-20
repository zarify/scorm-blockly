/**
 * Student runtime in a real browser, against a mock SCORM 1.2 runtime.
 *
 * This is the flow a student gets: the package boots, Blockly injects, Check
 * grades the program, and the result reaches the LMS. The persistence test
 * seeds `cmi.suspend_data` with a payload produced by the real codec and checks
 * that the blocks come back, which is the one path that spans the codec, the
 * persistence layer, Blockly and the DOM.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser, newPage, startStaticServer } from './helpers/harness.js';
import { MOCK_SCORM_INIT, SEED_MODEL_INIT, readLmsModel } from './helpers/mock-lms.js';
import { encodeWorkspaceState } from '../../src/scorm-template/js/workspace-state-codec.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SERVED_CONFIG = join(REPO_ROOT, 'dist/scorm-template/config/activity_config.json');
/** The id the runtime is actually serving; suspend_data is scoped to it. */
const servedActivityId = JSON.parse(readFileSync(SERVED_CONFIG, 'utf8')).metadata.activity_id;

let server;
let browser;
let skipReason = null;

before(async () => {
  browser = await launchBrowser();
  if (!browser) {
    skipReason = 'no Chrome or Chromium available (see README: npx playwright install chromium)';
    return;
  }
  server = await startStaticServer(join(REPO_ROOT, 'dist/scorm-template'));
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const ACTIVITY_URL = () => `${server.origin}/index.html`;

test('the activity loads, grades a Check, and reports the score to the LMS', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, errors, close } = await newPage(browser, {
    url: ACTIVITY_URL(),
    initScripts: [{ fn: MOCK_SCORM_INIT, arg: { seedModel: { 'cmi.core.student_id': 'student-42' } } }],
  });
  t.after(close);

  await page.waitForSelector('#btn-check');
  assert.match(await page.textContent('#status-bar'), /Activity loaded/);

  await page.click('#btn-check');
  await page.waitForSelector('#results-modal:not(.hidden)', { timeout: 15_000 });

  const model = await readLmsModel(page);
  assert.equal(model['cmi.core.score.raw'], '0', 'the empty workspace scores zero');
  assert.equal(model['cmi.core.score.min'], '0');
  assert.equal(model['cmi.core.score.max'], '100');
  assert.equal(model['cmi.core.lesson_status'], 'failed');
  assert.ok(model.__commits >= 1, 'the score reached the LMS through a commit');
  assert.equal(model.__lastCommit['cmi.core.score.raw'], '0', 'the commit carried the score');
  assert.deepEqual(errors, []);
});

test('a saved workspace is restored from cmi.suspend_data on the next launch', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const suspendData = encodeWorkspaceState({
    activityId: servedActivityId,
    state: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'text_print',
            x: 40,
            y: 40,
            inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'hello' } } } },
          },
        ],
      },
    },
  });
  assert.ok(suspendData, 'the codec produced a payload');

  const { page, errors, close } = await newPage(browser, {
    initScripts: [
      {
        fn: SEED_MODEL_INIT,
        arg: { model: { 'cmi.core.student_id': 'student-42', 'cmi.suspend_data': suspendData } },
      },
      { fn: MOCK_SCORM_INIT, arg: {} },
    ],
    url: ACTIVITY_URL(),
  });
  t.after(close);

  await page.waitForSelector('.blocklyBlockCanvas .blocklyDraggable', { timeout: 15_000 });
  const restored = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length,
    text: document.querySelector('.blocklyBlockCanvas')?.textContent ?? '',
  }));

  // A print block plus its shadow text block: only the restore can produce these.
  assert.equal(restored.blocks, 2);
  assert.match(restored.text, /hello/);
  assert.deepEqual(errors, []);
});

test('a suspend_data payload written for another activity is not restored', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const foreignPayload = encodeWorkspaceState({
    activityId: 'some_other_activity',
    state: {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: 'text_print', x: 40, y: 40 }],
      },
    },
  });

  const { page, close } = await newPage(browser, {
    initScripts: [
      {
        fn: SEED_MODEL_INIT,
        arg: { model: { 'cmi.core.student_id': 'student-42', 'cmi.suspend_data': foreignPayload } },
      },
      { fn: MOCK_SCORM_INIT, arg: {} },
    ],
    url: ACTIVITY_URL(),
  });
  t.after(close);

  await page.waitForSelector('#btn-check');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.blocklyBlockCanvas .blocklyDraggable').count(), 0);
});

test('with no LMS the activity still loads and grades in preview mode', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, errors, close } = await newPage(browser, { url: ACTIVITY_URL() });
  t.after(close);

  await page.waitForSelector('#btn-check');
  await page.click('#btn-check');
  await page.waitForSelector('#results-modal:not(.hidden)', { timeout: 15_000 });

  const results = await page.textContent('#results-modal');
  assert.match(results, /Score/);
  assert.deepEqual(errors, []);
});

test('an LMS that rejects suspend_data does not break the activity', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, errors, close } = await newPage(browser, {
    url: ACTIVITY_URL(),
    initScripts: [
      {
        fn: MOCK_SCORM_INIT,
        arg: {
          seedModel: {
            'cmi.core.student_id': 'student-42',
            'cmi.suspend_data': 'previous',
            __rejectSuspendData: true,
          },
        },
      },
    ],
  });
  t.after(close);

  await page.waitForSelector('#btn-check');
  await page.click('#btn-check');
  await page.waitForSelector('#results-modal:not(.hidden)', { timeout: 15_000 });

  const model = await readLmsModel(page);
  assert.equal(model['cmi.suspend_data'], 'previous', 'the rejected write did not land');
  assert.match(await page.textContent('#status-bar'), /Activity loaded/);
  assert.deepEqual(errors.filter((error) => !error.includes('LMS rejected')), []);
});
