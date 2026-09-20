/**
 * Activity Builder in a real browser.
 *
 * These cover what the Node suite cannot: `Blockly.inject`, the tab rendering,
 * and the import/export flows. Two of the tests are regressions for bugs that
 * only ever showed up here — importing a config while a visual block pattern is
 * selected used to recurse until the renderer wedged, and a config whose
 * starting workspace names a block this build no longer has used to blank the
 * condition editor.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

import { importConfigIntoBuilder, launchBrowser, newPage, openTab, startStaticServer } from './helpers/harness.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXAMPLES = join(REPO_ROOT, 'examples');

let server;
let browser;
let skipReason = null;

before(async () => {
  browser = await launchBrowser();
  if (!browser) {
    skipReason = 'no Chrome or Chromium available (see README: npx playwright install chromium)';
    return;
  }
  server = await startStaticServer(join(REPO_ROOT, 'dist'));
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function builderPage() {
  const handle = await newPage(browser, { url: `${server.origin}/activity-builder/` });
  await handle.page.waitForSelector('#cfg-title');
  return handle;
}

async function writeConfig(config) {
  const directory = await mkdtemp(join(tmpdir(), 'scorm-builder-'));
  const path = join(directory, 'activity_config.json');
  await writeFile(path, JSON.stringify(config, null, 2));
  return path;
}

test('the builder loads and imports a config from disk', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, errors, close } = await builderPage();
  t.after(close);

  const toast = await importConfigIntoBuilder(page, join(EXAMPLES, 'hello-world.json'));
  assert.equal(toast, 'Config imported successfully');
  assert.equal(await page.inputValue('#cfg-activity-id'), 'hello_world');

  await openTab(page, 'hints');
  assert.equal(await page.locator('.hint-list-item').count(), 2);
  assert.deepEqual(errors, []);
});

test('config settings removed from the schema still import and export', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, close } = await builderPage();
  t.after(close);

  const configPath = await writeConfig({
    metadata: { activity_id: 'legacy_activity', title: 'Legacy' },
    instructions: { main: 'Do it', steps: [] },
    ui_settings: {
      theme: 'high_contrast',
      show_code_toggle: true,
      show_hint_panel: true,
      suspend_data_limit: 2048,
    },
    blockly_setup: {
      toolbox: { categories: [{ name: 'Text', colour: '#5CA68D', blocks: ['text_print', 'text'] }] },
      starting_blocks: null,
      max_blocks: 30,
      disabled_blocks: ['controls_for'],
    },
    hints: [],
    evaluation: {
      grading_mode: 'pass_fail',
      max_score: 50,
      require_previous_test_pass: true,
      test_cases: [
        {
          id: 'test_print',
          type: 'stdout_match',
          points: 10,
          output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' },
        },
      ],
    },
  });

  assert.equal(await importConfigIntoBuilder(page, configPath), 'Config imported successfully');

  const exported = await page.evaluate(async () => {
    const chunks = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      chunks.push(blob.text());
      return original(blob);
    };
    document.getElementById('btn-export-json').click();
    return (await Promise.all(chunks))[0] ?? null;
  });

  assert.ok(exported, 'the export produced a blob');
  const config = JSON.parse(exported);
  assert.deepEqual(Object.keys(config.ui_settings).sort(), [
    'show_code_toggle',
    'show_hint_panel',
    'suspend_data_limit',
  ]);
  assert.deepEqual(Object.keys(config.blockly_setup).sort(), ['max_blocks', 'starting_blocks', 'toolbox']);
  assert.equal(config.blockly_setup.max_blocks, 30);
  assert.deepEqual(Object.keys(config.evaluation).sort(), [
    'feedback_on_all_pass',
    'require_previous_test_pass',
    'test_cases',
  ]);
});

test('a visual block pattern condition renders when its hint is selected', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, errors, close } = await builderPage();
  t.after(close);

  const configPath = await writeConfig({
    metadata: { activity_id: 'pattern_activity', title: 'Pattern' },
    instructions: { main: '', steps: [] },
    ui_settings: { show_code_toggle: false, show_hint_panel: true, suspend_data_limit: 4096 },
    blockly_setup: {
      toolbox: { categories: [{ name: 'Text', colour: '#5CA68D', blocks: ['text_print', 'text'] }] },
      starting_blocks: null,
      max_blocks: null,
    },
    hints: [
      {
        id: 'hint_pattern',
        trigger: {
          event: 'workspace_change',
          conditions: {
            type: 'block_pattern',
            workspace_state: {
              blocks: { languageVersion: 0, blocks: [{ type: 'text_print', x: 40, y: 40 }] },
            },
          },
        },
        display_mode: 'triggered',
        message: 'Print something.',
        priority: 1,
        delay_seconds: 0,
        show_once: false,
      },
    ],
    evaluation: {
      require_previous_test_pass: true,
      feedback_on_all_pass: '',
      test_cases: [
        {
          id: 'test_print',
          type: 'stdout_match',
          points: 10,
          output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' },
        },
      ],
    },
  });

  // The recursion needed a *config replacement* while a pattern condition was
  // already mounted: importing once leaves the hint unselected (placeholder),
  // so select a hint first, then import the config that turns its condition into
  // a visual block pattern. Before the fix this re-entered the render until the
  // renderer wedged.
  await importConfigIntoBuilder(page, join(EXAMPLES, 'hello-world.json'));
  await openTab(page, 'hints');
  await page.click('.hint-list-item');
  await page.waitForSelector('#hint-id', { timeout: 10_000 });

  await importConfigIntoBuilder(page, configPath);

  // The editor must finish rendering, with the pattern workspace mounted and the
  // saved pattern loaded into it.
  await page.waitForSelector('.pattern-workspace .blocklyWorkspace', { timeout: 10_000 });
  const editor = await page.evaluate(() => ({
    conditionType: document.querySelector('#hint-condition-builder .condition-type-select')?.value ?? null,
    patternBlocks: document.querySelectorAll('.pattern-workspace .blocklyBlockCanvas .blocklyDraggable').length,
    inspectorRendered: (document.querySelector('.pattern-inspector')?.innerHTML.length ?? 0) > 0,
    status: document.querySelector('.pattern-builder-status')?.textContent?.trim() ?? null,
  }));

  assert.equal(editor.conditionType, 'block_pattern');
  assert.ok(editor.patternBlocks > 0, 'the saved pattern loaded into its workspace');
  assert.equal(editor.inspectorRendered, true);
  assert.deepEqual(errors, []);
});

test('a starting workspace naming a block this build does not have still renders', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, errors, close } = await builderPage();
  t.after(close);

  const configPath = await writeConfig({
    metadata: { activity_id: 'stale_activity', title: 'Stale' },
    instructions: { main: '', steps: [] },
    ui_settings: { show_code_toggle: false, show_hint_panel: true, suspend_data_limit: 4096 },
    blockly_setup: {
      toolbox: { categories: [{ name: 'Text', colour: '#5CA68D', blocks: ['text_print', 'text'] }] },
      starting_blocks: {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'text_print',
              x: 20,
              y: 20,
              inputs: { TEXT: { block: { type: 'obsolete_text_block', fields: { TEXT: 'hi' } } } },
            },
          ],
        },
      },
      max_blocks: null,
    },
    hints: [
      {
        id: 'hint_one',
        trigger: { event: 'workspace_change', conditions: { type: 'block_missing', block_type: 'text_print' } },
        display_mode: 'triggered',
        message: 'Add a print block.',
        priority: 1,
        delay_seconds: 0,
        show_once: false,
      },
    ],
    evaluation: {
      require_previous_test_pass: true,
      feedback_on_all_pass: '',
      test_cases: [
        {
          id: 'test_print',
          type: 'stdout_match',
          points: 10,
          output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' },
        },
      ],
    },
  });

  assert.equal(await importConfigIntoBuilder(page, configPath), 'Config imported successfully');
  await openTab(page, 'hints');
  await page.click('.hint-list-item');

  const editor = await page.evaluate(() => ({
    conditionType: document.querySelector('#hint-condition-builder .condition-type-select')?.value ?? null,
    fieldsLength: document.querySelector('#hint-condition-builder .condition-fields')?.innerHTML.length ?? 0,
    blockTypeOptions: document.querySelectorAll('#hint-condition-builder datalist option').length,
  }));

  assert.equal(editor.conditionType, 'block_missing');
  assert.ok(editor.fieldsLength > 0, 'the condition fields rendered');
  assert.ok(editor.blockTypeOptions > 0, 'block suggestions still rendered');
  assert.deepEqual(errors, []);
});

test('typing in a test field does not rebuild the selected pattern editor', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, errors, close } = await builderPage();
  t.after(close);

  const configPath = await writeConfig({
    metadata: { activity_id: 'pattern_test_activity', title: 'Pattern test' },
    instructions: { main: '', steps: [] },
    ui_settings: { show_code_toggle: false, show_hint_panel: true, suspend_data_limit: 4096 },
    blockly_setup: {
      toolbox: { categories: [{ name: 'Text', colour: '#5CA68D', blocks: ['text_print', 'text'] }] },
      starting_blocks: null,
      max_blocks: null,
    },
    hints: [],
    evaluation: {
      require_previous_test_pass: true,
      feedback_on_all_pass: '',
      test_cases: [
        {
          id: 'test_pattern',
          type: 'block_structure',
          points: 10,
          conditions: {
            type: 'block_pattern',
            workspace_state: { blocks: { languageVersion: 0, blocks: [{ type: 'text_print', x: 40, y: 40 }] } },
          },
        },
      ],
    },
  });

  await importConfigIntoBuilder(page, configPath);
  await openTab(page, 'tests');
  await page.click('.test-list-item');
  await page.waitForSelector('.pattern-workspace .blocklyWorkspace', { timeout: 10_000 });

  // Mark the mounted nodes; a rebuild replaces them and the marks disappear.
  const marked = await page.evaluate(() => {
    const workspace = document.querySelector('.pattern-workspace');
    const editor = document.getElementById('test-editor-content');
    workspace.dataset.marker = 'original';
    editor.dataset.marker = 'original';
    return true;
  });
  assert.equal(marked, true);

  await page.click('#test-feedback');
  for (const character of 'abcdefghij') {
    await page.type('#test-feedback', character, { delay: 20 });
  }

  const after = await page.evaluate(() => ({
    workspaceMarker: document.querySelector('.pattern-workspace')?.dataset.marker ?? null,
    editorMarker: document.getElementById('test-editor-content')?.dataset.marker ?? null,
    patternBlocks: document.querySelectorAll('.pattern-workspace .blocklyBlockCanvas .blocklyDraggable').length,
    feedback: document.getElementById('test-feedback')?.value ?? null,
  }));

  assert.equal(after.workspaceMarker, 'original', 'the pattern workspace was not re-injected');
  assert.equal(after.editorMarker, 'original', 'the editor was not rebuilt');
  assert.ok(after.patternBlocks > 0);
  assert.equal(after.feedback.endsWith('abcdefghij'), true, 'the typed text reached the field');
  assert.deepEqual(errors, []);
});

test('Export SCORM downloads a package built from the current config', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, close } = await builderPage();
  t.after(close);

  await importConfigIntoBuilder(page, join(EXAMPLES, 'hello-world.json'));
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.click('#btn-export-scorm'),
  ]);

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));

  const files = Object.entries(zip.files)
    .filter(([, entry]) => !entry.dir)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(files, [
    'config/activity_config.json',
    'css/style.css',
    'imsmanifest.xml',
    'index.html',
    'js/app.bundle.js',
  ]);

  const config = JSON.parse(await zip.file('config/activity_config.json').async('string'));
  assert.equal(config.metadata.activity_id, 'hello_world');
  assert.equal(config.evaluation.test_cases.length, 1);
  assert.equal('theme' in config.ui_settings, false);
  assert.equal('grading_mode' in config.evaluation, false);

  const manifest = await zip.file('imsmanifest.xml').async('string');
  assert.match(manifest, /hello_world/);

  const bundle = await zip.file('js/app.bundle.js').async('string');
  assert.equal(bundle.includes('sourceMappingURL'), false, 'no source map reference ships');
});
