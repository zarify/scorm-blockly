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

import { launchBrowser, newPage, serveRuntimeWithConfig, startStaticServer } from './helpers/harness.js';
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

const baseConfig = JSON.parse(readFileSync(SERVED_CONFIG, 'utf8'));

/** A loop that prints `times` lines, which is what the console has to render. */
const printLoop = (times) => ({
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'controls_repeat_ext',
        x: 40,
        y: 40,
        inputs: {
          TIMES: { block: { type: 'math_number', fields: { NUM: times } } },
          DO: { block: { type: 'text_print', inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'row' } } } } } },
        },
      },
    ],
  },
});

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

test('a program printing thousands of lines is appended in batches, not one row at a time', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Appending per line and reading scrollHeight per append made a 10,000 line
  // program take 15 seconds. The invariant is that the transcript grows in a
  // handful of batches (one per frame, plus the final flush) and still ends up
  // with every line.
  const runtime = await serveRuntimeWithConfig({
    ...baseConfig,
    blockly_setup: { ...baseConfig.blockly_setup, starting_blocks: printLoop(2000) },
  });
  t.after(() => runtime.close());

  const { page, errors, close } = await newPage(browser, {
    url: `${runtime.origin}/index.html`,
    initScripts: [
      { fn: SEED_MODEL_INIT, arg: { model: { 'cmi.core.student_id': 'student-42' } } },
      { fn: MOCK_SCORM_INIT, arg: {} },
    ],
  });
  t.after(close);

  await page.waitForSelector('#btn-check');
  await page.waitForFunction(
    () => document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length > 2,
    undefined,
    { timeout: 20_000 },
  );

  await page.evaluate(() => document.getElementById('btn-run').click());
  await page.waitForSelector('[data-console-transcript]', { timeout: 20_000 });
  await page.evaluate(() => {
    window.__transcriptAppends = 0;
    const observer = new MutationObserver((records) => {
      window.__transcriptAppends += records.filter((record) => record.type === 'childList').length;
    });
    observer.observe(document.querySelector('[data-console-transcript]'), { childList: true });
  });

  await page.waitForFunction(
    () => !document.getElementById('btn-run').disabled,
    undefined,
    { timeout: 60_000 },
  );

  const result = await page.evaluate(() => ({
    outputEntries: document.querySelectorAll('[data-console-transcript] .console-entry-output').length,
    statusEntries: document.querySelectorAll('[data-console-transcript] .console-entry-status').length,
    appends: window.__transcriptAppends,
    status: document.getElementById('status-bar')?.textContent ?? '',
  }));

  assert.equal(result.outputEntries, 2000, 'every printed line is present');
  assert.equal(result.statusEntries, 1, 'the closing status line is present');
  assert.ok(result.appends < 50, `transcript grew in ${result.appends} batches`);
  assert.match(result.status, /Program finished/);
  assert.deepEqual(errors, []);
});

test('a program that asks for input still renders its prompt and the answer', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // The prompt row has to be in the DOM immediately (the student types into it),
  // so it must flush anything the output batching has buffered.
  const runtime = await serveRuntimeWithConfig({
    ...baseConfig,
    blockly_setup: {
      ...baseConfig.blockly_setup,
      starting_blocks: {
        blocks: {
          languageVersion: 0,
          blocks: [
            { type: 'text_print', x: 40, y: 40, inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'before' } } } } },
            {
              type: 'text_print',
              x: 40,
              y: 120,
              inputs: {
                TEXT: {
                  block: {
                    type: 'text_prompt_ext',
                    fields: { TYPE: 'TEXT' },
                    inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'Your name?' } } } },
                  },
                },
              },
            },
          ],
        },
      },
    },
  });
  t.after(() => runtime.close());

  const { page, errors, close } = await newPage(browser, {
    url: `${runtime.origin}/index.html`,
    initScripts: [
      { fn: SEED_MODEL_INIT, arg: { model: { 'cmi.core.student_id': 'student-42' } } },
      { fn: MOCK_SCORM_INIT, arg: {} },
    ],
  });
  t.after(close);

  await page.waitForSelector('#btn-check');
  await page.waitForFunction(
    () => document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length > 3,
    undefined,
    { timeout: 20_000 },
  );

  await page.evaluate(() => document.getElementById('btn-run').click());
  await page.waitForSelector('[data-console-form]:not(.hidden)', { timeout: 20_000 });
  await page.fill('#console-stdin', 'Ada');
  await page.click('.console-submit-button');
  await page.waitForFunction(() => !document.getElementById('btn-run').disabled, undefined, { timeout: 20_000 });

  const transcript = await page.textContent('[data-console-transcript]');
  assert.match(transcript, /before/, 'the line printed before the prompt is present');
  assert.match(transcript, /Your name\?/, 'the prompt is present');
  assert.match(transcript, /Ada/, 'the answer is echoed and printed');
  assert.deepEqual(errors, []);
});

test('the results modal is locked while a Check is grading', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Closing during a Run is the cancel path, so the modal stays closable there.
  // Grading is different: the results are about to be replaced, and closing
  // would leave the student looking at a dismissed modal mid-Check.
  const runtime = await serveRuntimeWithConfig({
    ...baseConfig,
    blockly_setup: { ...baseConfig.blockly_setup, starting_blocks: printLoop(50) },
  });
  t.after(() => runtime.close());

  const { page, errors, close } = await newPage(browser, {
    url: `${runtime.origin}/index.html`,
    initScripts: [
      { fn: SEED_MODEL_INIT, arg: { model: { 'cmi.core.student_id': 'student-42' } } },
      { fn: MOCK_SCORM_INIT, arg: {} },
    ],
  });
  t.after(close);

  await page.waitForSelector('#btn-check');
  await page.waitForFunction(
    () => document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length > 2,
    undefined,
    { timeout: 20_000 },
  );

  // The lock is taken synchronously, before grading awaits anything.
  const lockedDuringCheck = await page.evaluate(() => {
    document.getElementById('btn-check').click();
    return document.getElementById('btn-close-results-modal').disabled;
  });
  assert.equal(lockedDuringCheck, true, 'the modal is locked as soon as grading starts');

  await page.waitForFunction(
    () => !document.getElementById('btn-close-results-modal').disabled,
    undefined,
    { timeout: 30_000 },
  );
  assert.match(await page.textContent('#results-modal'), /Check results/);
  assert.deepEqual(errors, []);
});
