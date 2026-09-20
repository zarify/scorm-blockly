/**
 * Test runner — executing a student program and grading it against the
 * configured test cases.
 *
 * `runTests()` and `executeInteractiveRun()` both run the code the Blockly
 * generator emits: `await __runtime.writeLine(...)` for print blocks,
 * `await __runtime.promptText/promptNumber(...)` for prompt blocks,
 * `__runtime.readVar("name", name)` for variable readers, async procedures,
 * and a `var __loopTrap=10000;` guard that every generated loop decrements.
 * Some cases below generate that code for real from a headless workspace,
 * the rest use hand-written code in exactly those shapes.
 *
 * The edges that matter are the ones a config can express: point/weight
 * arithmetic, `require_previous_test_pass` truncating the run, counting
 * `prompt()` calls, loose value comparison next to strict type checks, list
 * and function assertions that cannot all be satisfied, and student code that
 * crashes, loops, or has to be cancelled.
 *
 * Node has no `Worker`, so every case here runs the direct-execution
 * fallback. The worker path — and with it the 5s execution timeout — is not
 * exercised.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { javascriptGenerator } from 'blockly/javascript';

import { configureJavascriptGenerator } from '../src/shared/blockly-code-generator.js';
import {
  executeInteractiveRun,
  INTERACTIVE_RUN_CANCELLED_ERROR,
  runTests,
} from '../src/scorm-template/js/test-runner.js';
import { blockState, workspaceFromState, workspaceWith } from './helpers/blockly.js';

configureJavascriptGenerator(javascriptGenerator);

/** A workspace containing the given top-level blocks and named variables. */
function workspaceFrom(variables, blocks) {
  return workspaceFromState({
    ...blockState(blocks),
    ...(variables ? { variables } : {}),
  });
}

/** Code exactly as `blockly-engine.generateCode()` emits it. */
function generatedCodeFrom({ variables, blocks }) {
  javascriptGenerator.INFINITE_LOOP_TRAP = 'if(--__loopTrap<=0){throw "Infinite loop detected";}\n';
  const workspace = workspaceFrom(variables, blocks);
  try {
    return `var __loopTrap=10000;\n${javascriptGenerator.workspaceToCode(workspace)}`;
  } finally {
    workspace.dispose();
  }
}

function emptyWorkspace() {
  return workspaceWith([]);
}

/** Grade a single test case, returning its result. */
async function grade(testCase, { code = '', workspace = emptyWorkspace() } = {}) {
  const { results } = await runTests([testCase], code, workspace);
  return results[0];
}

function stdoutCase(overrides = {}) {
  return {
    id: 'stdout_case',
    type: 'stdout_match',
    points: 1,
    output_assertion: { enabled: true, expected: '', match_mode: 'exact' },
    ...overrides,
  };
}

function variableCase(overrides = {}) {
  return { id: 'variable_case', type: 'variable_state', points: 1, variable_name: 'value', ...overrides };
}

function functionCase(overrides = {}) {
  return { id: 'function_case', type: 'function_state', points: 1, function_name: 'double', ...overrides };
}

function blockCase(conditions, overrides = {}) {
  return { id: 'block_case', type: 'block_structure', points: 1, conditions, ...overrides };
}

const PRINT_HI = `await __runtime.writeLine('hi');\n`;
const PRINT_TWO_LINES = `await __runtime.writeLine('first');\nawait __runtime.writeLine('second');\n`;

/* ------------------------------------------------------------------ *
 * Scoring and aggregation
 * ------------------------------------------------------------------ */

test('a passing test scores its points and a failing one scores nothing', async () => {
  const { results, totalScore, maxScore } = await runTests([
    stdoutCase({ id: 'passes', points: 10, output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' } }),
    stdoutCase({ id: 'fails', points: 5, output_assertion: { enabled: true, expected: 'nope\n', match_mode: 'exact' } }),
  ], PRINT_HI, emptyWorkspace());

  assert.deepEqual(results.map((result) => [result.id, result.passed, result.score]), [
    ['passes', true, 10],
    ['fails', false, 0],
  ]);
  assert.deepEqual(results.map((result) => result.points), [10, 5]);
  assert.equal(totalScore, 10);
  assert.equal(maxScore, 15);
});

test('an empty run scores zero and blocks nothing', async () => {
  const outcome = await runTests([], PRINT_HI, emptyWorkspace());
  assert.deepEqual(outcome, { results: [], totalScore: 0, maxScore: 0, hasBlockedTests: false });
});

test('points fall back to the legacy weight field, and an explicit zero wins over it', async () => {
  const { results } = await runTests([
    { id: 'weight_only', type: 'block_structure', weight: '7', conditions: { type: 'workspace_empty' } },
    { id: 'weight_string', type: 'block_structure', weight: 4, conditions: { type: 'workspace_empty' } },
    { id: 'points_zero', type: 'block_structure', points: 0, weight: 9, conditions: { type: 'workspace_empty' } },
    { id: 'points_null', type: 'block_structure', points: null, weight: 3, conditions: { type: 'workspace_empty' } },
    { id: 'nothing', type: 'block_structure', conditions: { type: 'workspace_empty' } },
  ], '', emptyWorkspace());

  assert.deepEqual(results.map((result) => [result.id, result.points]), [
    ['weight_only', 7],
    ['weight_string', 4],
    ['points_zero', 0],
    ['points_null', 3],
    ['nothing', 0],
  ]);
});

test('points are truncated to whole numbers, negatives and junk score zero', async () => {
  const { results, maxScore } = await runTests([
    { id: 'fractional', type: 'block_structure', points: 7.9, conditions: { type: 'workspace_empty' } },
    { id: 'negative', type: 'block_structure', points: -5, conditions: { type: 'workspace_empty' } },
    { id: 'text', type: 'block_structure', points: 'abc', conditions: { type: 'workspace_empty' } },
    { id: 'not_a_number', type: 'block_structure', points: NaN, conditions: { type: 'workspace_empty' } },
    { id: 'infinite', type: 'block_structure', points: Infinity, conditions: { type: 'workspace_empty' } },
    { id: 'enormous', type: 'block_structure', points: 1e21, conditions: { type: 'workspace_empty' } },
  ], '', emptyWorkspace());

  assert.deepEqual(results.map((result) => result.points), [7, 0, 0, 0, 0, 1e21]);
  assert.equal(maxScore, 7 + 1e21);
});

test('a test case of an unknown type fails without stopping the run', async () => {
  const { results, totalScore, maxScore } = await runTests([
    { id: 'weird', type: 'no_such_type', points: 4 },
    stdoutCase({ id: 'after', points: 2, output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' } }),
  ], PRINT_HI, emptyWorkspace());

  assert.equal(results[0].passed, false);
  assert.equal(results[0].score, 0);
  assert.equal(results[0].feedback, 'Unknown test type: no_such_type');
  assert.equal(results[1].passed, true);
  assert.equal(totalScore, 2);
  assert.equal(maxScore, 6);
});

test('feedback overrides replace the built-in messages', async () => {
  const passed = await grade(stdoutCase({
    feedback_on_pass: 'Nailed it.',
    output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' },
  }), { code: PRINT_HI });
  assert.equal(passed.feedback, 'Nailed it.');

  const failed = await grade(stdoutCase({
    feedback_on_fail: 'Have another go.',
    output_assertion: { enabled: true, expected: 'bye\n', match_mode: 'exact' },
  }), { code: PRINT_HI });
  assert.equal(failed.feedback, 'Have another go.');
});

/* ------------------------------------------------------------------ *
 * require_previous_test_pass
 * ------------------------------------------------------------------ */

test('a failing test stops the run and the tests behind it are never reported as failed', async () => {
  const { results, totalScore, maxScore, hasBlockedTests } = await runTests([
    stdoutCase({ id: 'first', points: 3, output_assertion: { enabled: true, expected: 'wrong\n', match_mode: 'exact' } }),
    blockCase({ type: 'workspace_empty' }, { id: 'would_pass', points: 5 }),
    stdoutCase({ id: 'never_seen', points: 2 }),
  ], PRINT_HI, emptyWorkspace(), { requirePreviousTestPass: true });

  assert.equal(hasBlockedTests, true);
  assert.deepEqual(results.map((result) => result.id), ['first']);
  assert.equal(results[0].passed, false);
  assert.equal(totalScore, 0);
  // Blocked tests still count towards the maximum, so the run is visibly short.
  assert.equal(maxScore, 10);
});

test('blocked tests never execute', async () => {
  const counted = `globalThis.__runCount = (globalThis.__runCount || 0) + 1;
await __runtime.writeLine('run ' + globalThis.__runCount);
`;
  delete globalThis.__runCount;
  try {
    const { results } = await runTests([
      stdoutCase({ id: 'first', output_assertion: { enabled: true, expected: 'wrong\n', match_mode: 'exact' } }),
      stdoutCase({ id: 'second', output_assertion: { enabled: true, expected: 'run 2\n', match_mode: 'exact' } }),
    ], counted, emptyWorkspace(), { requirePreviousTestPass: true });

    assert.deepEqual(results.map((result) => result.id), ['first']);
    assert.equal(globalThis.__runCount, 1);
  } finally {
    delete globalThis.__runCount;
  }
});

test('without the option a failure does not stop anything', async () => {
  const { results, hasBlockedTests } = await runTests([
    stdoutCase({ id: 'fails', output_assertion: { enabled: true, expected: 'wrong\n', match_mode: 'exact' } }),
    blockCase({ type: 'workspace_empty' }, { id: 'still_graded' }),
  ], PRINT_HI, emptyWorkspace());

  assert.deepEqual(results.map((result) => [result.id, result.passed]), [
    ['fails', false],
    ['still_graded', true],
  ]);
  assert.equal(hasBlockedTests, false);
});

test('only the literal true turns gating on', async () => {
  const cases = [stdoutCase({ id: 'fails', output_assertion: { enabled: true, expected: 'wrong\n', match_mode: 'exact' } }), blockCase({ type: 'workspace_empty' }, { id: 'after' })];

  for (const option of [undefined, false, 1, 'true', {}]) {
    const { results, hasBlockedTests } = await runTests(cases, PRINT_HI, emptyWorkspace(), { requirePreviousTestPass: option });
    assert.equal(results.length, 2, `gating should stay off for ${JSON.stringify(option)}`);
    assert.equal(hasBlockedTests, false);
  }
});

test('a failure on the last test blocks nothing', async () => {
  const { results, hasBlockedTests } = await runTests([
    blockCase({ type: 'workspace_empty' }, { id: 'passes' }),
    stdoutCase({ id: 'fails', output_assertion: { enabled: true, expected: 'wrong\n', match_mode: 'exact' } }),
  ], PRINT_HI, emptyWorkspace(), { requirePreviousTestPass: true });

  assert.deepEqual(results.map((result) => result.id), ['passes', 'fails']);
  assert.equal(hasBlockedTests, false);
});

/* ------------------------------------------------------------------ *
 * stdout_match
 * ------------------------------------------------------------------ */

test('exact output matching includes the newline a print block adds', async () => {
  const withNewline = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' },
  }), { code: PRINT_HI });
  assert.equal(withNewline.passed, true);
  assert.equal(withNewline.score, 1);

  const withoutNewline = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'hi', match_mode: 'exact' },
  }), { code: PRINT_HI });
  assert.equal(withoutNewline.passed, false);
  assert.match(withoutNewline.detail, /Expected: "hi"/);
  assert.match(withoutNewline.detail, /Got: "hi\\n"/);
});

test('each print becomes its own line, so multi-line expectations line up', async () => {
  const passed = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'first\nsecond\n', match_mode: 'exact' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(passed.passed, true);

  const reordered = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'second\nfirst\n', match_mode: 'exact' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(reordered.passed, false);
});

test('contains accepts the expected text anywhere in the output, and an empty needle always matches', async () => {
  const substring = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'second', match_mode: 'contains' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(substring.passed, true);

  // Extra output is the difference between the two modes.
  const exact = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'first\n', match_mode: 'exact' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(exact.passed, false);

  const emptyNeedle = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: '', match_mode: 'contains' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(emptyNeedle.passed, true);
});

test('regex matching is unanchored, and an invalid pattern fails instead of throwing', async () => {
  const unanchored = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: '^first\\nsecond\\n$', match_mode: 'regex' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(unanchored.passed, true);

  const midLine = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'irs', match_mode: 'regex' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(midLine.passed, true);

  const invalid = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'first(', match_mode: 'regex' },
  }), { code: PRINT_TWO_LINES });
  assert.equal(invalid.passed, false);
  assert.match(invalid.detail, /Output \(regex/);
});

test('an unknown match mode falls back to exact', async () => {
  const passed = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'starts_with' },
  }), { code: PRINT_HI });
  assert.equal(passed.passed, true);

  const failed = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'hi', match_mode: 'starts_with' },
  }), { code: PRINT_HI });
  assert.equal(failed.passed, false);
});

test('legacy expected_output and match_mode fields are still graded', async () => {
  const legacy = await grade({
    id: 'legacy',
    type: 'stdout_match',
    points: 1,
    expected_output: 'say hi',
    match_mode: 'contains',
  }, { code: `await __runtime.writeLine('please say hi now');\n` });
  assert.equal(legacy.passed, true);
});

test('an empty expectation matches a program that prints nothing', async () => {
  const silent = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: '', match_mode: 'exact' },
  }), { code: 'var unused = 1;\n' });
  assert.equal(silent.passed, true);
});

test('console.log joins arguments with spaces, and undefined prints as text', async () => {
  const result = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'a 1 true\n\nundefined\n[object Object]\n', match_mode: 'exact' },
  }), {
    code: "console.log('a', 1, true);\nconsole.log();\nconsole.log(undefined);\nconsole.log({ x: 1 });\n",
  });
  assert.equal(result.passed, true);
  assert.equal(result.detail, null);
});

test('a stdout test with no enabled assertion passes whenever the program runs', async () => {
  const ran = await grade({ id: 'no_assertions', type: 'stdout_match', points: 2 }, { code: PRINT_HI });
  assert.equal(ran.passed, true);
  assert.equal(ran.score, 2);

  const crashed = await grade({ id: 'no_assertions', type: 'stdout_match', points: 2 }, { code: "throw new Error('boom');\n" });
  assert.equal(crashed.passed, false);
  assert.equal(crashed.feedback, 'Code error: boom');
});

test('output printed before a crash is still graded, a silent crash is not', async () => {
  const result = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' },
  }), { code: `await __runtime.writeLine('hi');\nthrow new TypeError('nope');\n` });

  // Output printed before the crash is still graded, so this one passes.
  assert.equal(result.passed, true);

  const noOutput = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: '', match_mode: 'exact' },
  }), { code: "throw new TypeError('nope');\n" });
  assert.equal(noOutput.passed, false);
  assert.equal(noOutput.feedback, 'Code error: nope');
  assert.equal(noOutput.detail, 'nope');
});

test('a syntax error is a failed test rather than a rejected run', async () => {
  const result = await grade(stdoutCase(), { code: 'function (\n' });
  assert.equal(result.passed, false);
  assert.match(result.feedback, /^Code error: /);
  assert.ok(result.detail.length > 0);
});

test('reading a variable that was never assigned surfaces the NameError', async () => {
  const result = await grade(variableCase({
    variable_name: 'total',
    expected_value: 0,
  }), { code: 'var total;\nawait __runtime.writeLine(__runtime.readVar("total", total));\n' });

  assert.equal(result.passed, false);
  assert.equal(result.feedback, "Code error: NameError: name 'total' is not defined");
});

/* ------------------------------------------------------------------ *
 * stdout_match — prompt text
 * ------------------------------------------------------------------ */

test('prompt assertions read the prompt messages, not what the program prints', async () => {
  const twoPrompts = `await __runtime.promptText('First question');
await __runtime.promptText('Second question');
await __runtime.writeLine('noise');
`;
  const joined = await grade(stdoutCase({
    prompt_inputs: ['one', 'two'],
    output_assertion: { enabled: false },
    prompt_assertion: { enabled: true, expected: 'First question\nSecond question', match_mode: 'exact' },
  }), { code: twoPrompts });
  assert.equal(joined.passed, true);

  const onlySecond = await grade(stdoutCase({
    prompt_inputs: ['one', 'two'],
    output_assertion: { enabled: false },
    prompt_assertion: { enabled: true, expected: 'Second question', match_mode: 'exact' },
  }), { code: twoPrompts });
  assert.equal(onlySecond.passed, false);
  assert.match(onlySecond.detail, /First question\\nSecond question/);

  const anyItem = await grade(stdoutCase({
    prompt_inputs: ['one', 'two'],
    output_assertion: { enabled: false },
    prompt_assertion: { enabled: true, expected: 'Second question', match_mode: 'exact', match_any_item: true },
  }), { code: twoPrompts });
  assert.equal(anyItem.passed, true);
});

test('a prompt-only assertion ignores console output and vice versa', async () => {
  const code = `await __runtime.promptText('Name');\nawait __runtime.writeLine('printed');\n`;

  const promptOnly = await grade(stdoutCase({
    prompt_inputs: ['Ada'],
    output_assertion: { enabled: false },
    prompt_assertion: { enabled: true, expected: 'Name', match_mode: 'contains' },
  }), { code });
  assert.equal(promptOnly.passed, true);

  const outputOnly = await grade(stdoutCase({
    prompt_inputs: ['Ada'],
    output_assertion: { enabled: true, expected: 'printed\n', match_mode: 'exact' },
  }), { code });
  assert.equal(outputOnly.passed, true);

  // Prompt text never leaks into stdout.
  const impossible = await grade(stdoutCase({
    prompt_inputs: ['Ada'],
    output_assertion: { enabled: true, expected: 'Name\n', match_mode: 'exact' },
  }), { code });
  assert.equal(impossible.passed, false);
});

test('both assertions must pass and custom messages decide the feedback', async () => {
  const code = `await __runtime.promptText('Name?');
await __runtime.writeLine('Ada');
`;
  const bothPass = await grade(stdoutCase({
    prompt_inputs: ['Ada'],
    output_assertion: {
      enabled: true, expected: 'Ada\n', match_mode: 'exact', success_message: 'Output is right.',
    },
    prompt_assertion: {
      enabled: true, expected: 'Name?', match_mode: 'exact', success_message: 'Prompt is right.',
    },
  }), { code });
  assert.equal(bothPass.passed, true);
  assert.equal(bothPass.feedback, 'Output is right. Prompt is right.');

  const oneFails = await grade(stdoutCase({
    feedback_on_fail: 'Ignored when the assertion has its own message.',
    prompt_inputs: ['Ada'],
    output_assertion: {
      enabled: true, expected: 'Ada\n', match_mode: 'exact', failure_message: 'Print the name you were given.',
    },
    prompt_assertion: { enabled: true, expected: 'Name?', match_mode: 'exact' },
  }), { code: `await __runtime.promptText('Name?');\nawait __runtime.writeLine('Bob');\n` });
  assert.equal(oneFails.passed, false);
  assert.equal(oneFails.feedback, 'Print the name you were given.');

  // Both assertions failing without their own messages falls back to one line.
  const bothFail = await grade(stdoutCase({
    prompt_inputs: ['Ada'],
    output_assertion: { enabled: true, expected: 'Ada\n', match_mode: 'exact' },
    prompt_assertion: { enabled: true, expected: 'Nope?', match_mode: 'exact' },
  }), { code: `await __runtime.promptText('Name?');\nawait __runtime.writeLine('Bob');\n` });
  assert.equal(bothFail.passed, false);
  assert.equal(bothFail.feedback, 'Prompt text and output did not match.');
});

test('show_expected and show_actual build the student-facing sections', async () => {
  const result = await grade(stdoutCase({
    output_assertion: {
      enabled: true, expected: 'expected line', match_mode: 'exact', show_expected: true, show_actual: true,
    },
  }), { code: PRINT_HI });

  assert.equal(result.passed, false);
  assert.deepEqual(result.student_detail, {
    sections: [
      { title: 'Expected output', value: 'expected line' },
      { title: 'Actual output', value: 'hi\n' },
    ],
  });

  const hidden = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'expected line', match_mode: 'exact' },
  }), { code: PRINT_HI });
  assert.equal(hidden.student_detail, null);
});

/* ------------------------------------------------------------------ *
 * prompt input counting (strict_prompt_inputs)
 * ------------------------------------------------------------------ */

test('asking for more prompts than the test supplies fails the test', async () => {
  const result = await grade(stdoutCase({
    prompt_inputs: ['only one'],
    points: 3,
    output_assertion: { enabled: true, expected: 'a\nb\n', match_mode: 'exact' },
  }), {
    code: `await __runtime.writeLine(await __runtime.promptText('A'));
await __runtime.writeLine(await __runtime.promptText('B'));
`,
  });

  assert.equal(result.passed, false);
  assert.equal(result.score, 0);
  assert.equal(result.feedback, 'Your program asked for 2 inputs, but the test expected 1 input.');
  assert.match(result.detail, /only provided 1/);
  assert.equal(result.student_detail, result.detail);
});

test('supplying inputs the program never asks for fails the test', async () => {
  const result = await grade(stdoutCase({
    prompt_inputs: ['unused'],
    output_assertion: { enabled: true, expected: 'out\n', match_mode: 'exact' },
  }), { code: `await __runtime.writeLine('out');\n` });

  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Your program asked for 0 inputs, but the test expected 1 input.');
  assert.match(result.detail, /only used 0/);
});

test('a test that configures no inputs still fails a program that prompts', async () => {
  const result = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: '\n', match_mode: 'exact' },
  }), { code: `await __runtime.writeLine(await __runtime.promptText('anything?'));\n` });

  assert.equal(result.passed, false);
  assert.match(result.feedback, /asked for 1 input/);
});

test('strict_prompt_inputs false drops the count check', async () => {
  const underflow = await grade(stdoutCase({
    strict_prompt_inputs: false,
    prompt_inputs: [],
    output_assertion: { enabled: true, expected: '\n', match_mode: 'exact' },
  }), { code: `await __runtime.writeLine(await __runtime.promptText('anything?'));\n` });
  assert.equal(underflow.passed, true);

  const unused = await grade(stdoutCase({
    strict_prompt_inputs: false,
    prompt_inputs: ['never used'],
    output_assertion: { enabled: true, expected: 'out\n', match_mode: 'exact' },
  }), { code: `await __runtime.writeLine('out');\n` });
  assert.equal(unused.passed, true);
});

test('configured inputs are handed to successive prompts in order', async () => {
  const code = `await __runtime.writeLine(await __runtime.promptText('First'));
await __runtime.writeLine(await __runtime.promptNumber('Second'));
`;
  const result = await grade(stdoutCase({
    prompt_inputs: ['Ada', '41'],
    output_assertion: { enabled: true, expected: 'Ada\n41\n', match_mode: 'exact' },
  }), { code });
  assert.equal(result.passed, true);
});

test('prompt inputs that are not an array are ignored, and entries are used as text', async () => {
  const prompting = `await __runtime.writeLine(await __runtime.promptText('Q'));\n`;

  const notAnArray = await grade(stdoutCase({
    prompt_inputs: 'Ada',
    output_assertion: { enabled: true, expected: 'Ada\n', match_mode: 'exact' },
  }), { code: prompting });
  assert.equal(notAnArray.passed, false);
  assert.match(notAnArray.feedback, /asked for 1 input/);

  const numericEntry = await grade(stdoutCase({
    prompt_inputs: [41],
    output_assertion: { enabled: true, expected: '41\n', match_mode: 'exact' },
  }), { code: prompting });
  assert.equal(numericEntry.passed, true);
});

test('only an explicit false turns the prompt count check off', async () => {
  for (const strict of [undefined, null, true, 'false', 0]) {
    const result = await grade(stdoutCase({
      strict_prompt_inputs: strict,
      output_assertion: { enabled: true, expected: '\n', match_mode: 'exact' },
    }), { code: `await __runtime.writeLine(await __runtime.promptText('Q'));\n` });
    assert.equal(result.passed, false, `strict_prompt_inputs: ${JSON.stringify(strict)} should still be checked`);
  }
});

test('a numeric prompt turns bad input into a failed test', async () => {
  const result = await grade(stdoutCase({
    prompt_inputs: ['not a number'],
    output_assertion: { enabled: true, expected: '42\n', match_mode: 'exact' },
  }), { code: `await __runtime.writeLine(await __runtime.promptNumber('How many?'));\n` });

  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Code error: ValueError: could not convert string to float: "not a number"');
});

test('function_state ignores prompt counts, as the builder promises', async () => {
  const result = await grade(functionCase({
    function_name: 'double',
    return_assertion: { enabled: true, arguments: [3], expected_value: 6 },
  }), {
    code: `await __runtime.promptText('ignored');
async function double(n) {
  return n * 2;
}
`,
  });

  assert.equal(result.passed, true);
});

/* ------------------------------------------------------------------ *
 * variable_state
 * ------------------------------------------------------------------ */

test('equals compares loosely, so a numeric string passes a numeric expectation', async () => {
  const loose = await grade(variableCase({
    expected_type: 'any',
    expected_value: 5,
  }), { code: `var value = '5';\n` });
  assert.equal(loose.passed, true);

  const alsoLoose = await grade(variableCase({
    expected_type: 'any',
    expected_value: 1,
  }), { code: 'var value = true;\n' });
  assert.equal(alsoLoose.passed, true);

  const different = await grade(variableCase({
    expected_type: 'any',
    expected_value: 5,
  }), { code: "var value = '5 apples';\n" });
  assert.equal(different.passed, false);
});

test('type checks separate int from float, and an unknown type means any type', async () => {
  const intValue = await grade(variableCase({ expected_type: 'int', value_assertion_enabled: false }), { code: 'var value = 5;\n' });
  assert.equal(intValue.passed, true);

  const floatExpected = await grade(variableCase({ expected_type: 'float', value_assertion_enabled: false }), { code: 'var value = 5;\n' });
  assert.equal(floatExpected.passed, false);
  assert.match(floatExpected.detail, /Expected value to be float, got int/);

  const floatValue = await grade(variableCase({ expected_type: 'float', value_assertion_enabled: false }), { code: 'var value = 5.5;\n' });
  assert.equal(floatValue.passed, true);

  const nonFinite = await grade(variableCase({ expected_type: 'float', value_assertion_enabled: false }), { code: 'var value = Infinity;\n' });
  assert.equal(nonFinite.passed, true);

  const anything = await grade(variableCase({ expected_type: 'nonsense', value_assertion_enabled: false }), { code: 'var value = null;\n' });
  assert.equal(anything.passed, true);
});

test('gt, lt, gte and lte compare at their boundaries', async () => {
  const boundaries = [
    ['gt', 10, 9, true],
    ['gt', 10, 10, false],
    ['gte', 10, 10, true],
    ['gte', 10, 11, false],
    ['lt', 10, 11, true],
    ['lt', 10, 10, false],
    ['lte', 10, 10, true],
    ['lte', 10, 9, false],
  ];

  for (const [comparison, actual, expected, passed] of boundaries) {
    const result = await grade(variableCase({
      expected_type: 'any',
      comparison,
      expected_value: expected,
    }), { code: `var value = ${actual};\n` });
    assert.equal(result.passed, passed, `${actual} ${comparison} ${expected}`);
  }
});

test('contains stringifies the actual value', async () => {
  const inString = await grade(variableCase({
    expected_type: 'any', comparison: 'contains', expected_value: 'ell',
  }), { code: "var value = 'hello';\n" });
  assert.equal(inString.passed, true);

  const inList = await grade(variableCase({
    expected_type: 'any', comparison: 'contains', expected_value: '2',
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(inList.passed, true);

  const missing = await grade(variableCase({
    expected_type: 'any', comparison: 'contains', expected_value: 'zzz',
  }), { code: "var value = 'hello';\n" });
  assert.equal(missing.passed, false);
});

test('the type comparison uses the JavaScript type name of the value', async () => {
  const number = await grade(variableCase({
    expected_type: 'any', comparison: 'type', expected_value: 'number',
  }), { code: 'var value = 1.5;\n' });
  assert.equal(number.passed, true);

  const string = await grade(variableCase({
    expected_type: 'any', comparison: 'type', expected_value: 'string',
  }), { code: 'var value = 1.5;\n' });
  assert.equal(string.passed, false);

  const array = await grade(variableCase({
    expected_type: 'any', comparison: 'type', expected_value: 'object',
  }), { code: 'var value = [1];\n' });
  assert.equal(array.passed, true);
});

test('an unknown comparison never passes', async () => {
  const result = await grade(variableCase({
    expected_type: 'any', comparison: 'roughly', expected_value: 5,
  }), { code: 'var value = 5;\n' });
  assert.equal(result.passed, false);
});

test('value assertions can be switched off while the type check still runs', async () => {
  const result = await grade(variableCase({
    expected_type: 'int',
    value_assertion_enabled: false,
    expected_value: 99,
  }), { code: 'var value = 5;\n' });
  assert.equal(result.passed, true);
});

test('a variable that never got a value is reported as missing', async () => {
  const result = await grade(variableCase({
    variable_name: 'total',
    expected_value: 0,
  }), { code: 'var other = 1;\n' });

  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Variable "total" not found after execution.');
  assert.equal(result.detail, 'Available variables: total');
});

test('null is a real value, an unassigned variable is missing', async () => {
  const nullValue = await grade(variableCase({ expected_type: 'any', expected_value: null }), { code: 'var value = null;\n' });
  assert.equal(nullValue.passed, true);

  const undefinedValue = await grade(variableCase({ expected_type: 'any', expected_value: null }), { code: 'var value;\n' });
  assert.equal(undefinedValue.passed, false);
  assert.match(undefinedValue.feedback, /not found after execution/);
});

test('a variable name that is not an identifier is never captured', async () => {
  const result = await grade(variableCase({
    variable_name: 'my-value',
    expected_value: 1,
  }), { code: 'globalThis["my-value"] = 1;\n' });
  assert.equal(result.passed, false);
  assert.match(result.feedback, /not found after execution/);
});

test('the coerced-value hint explains a right value stored in the wrong type', async () => {
  const result = await grade(variableCase({
    expected_type: 'int',
    expected_value: 5,
    show_coerced_value_hint: true,
  }), { code: 'var value = 5.7;\n' });

  assert.equal(result.passed, false);
  assert.match(result.detail, /Expected value equals 5, got 5\.7/);
  assert.match(result.student_detail, /correct, but not the correct type/);

  const typeAlreadyRight = await grade(variableCase({
    expected_type: 'int',
    expected_value: 5,
    show_coerced_value_hint: true,
  }), { code: 'var value = 5;\n' });
  assert.equal(typeAlreadyRight.passed, true);
  assert.equal(typeAlreadyRight.student_detail, null);

  const uncoercible = await grade(variableCase({
    expected_type: 'int',
    expected_value: 5,
    show_coerced_value_hint: true,
  }), { code: "var value = 'five';\n" });
  assert.equal(uncoercible.passed, false);
  assert.equal(uncoercible.student_detail, null);
});

/* ------------------------------------------------------------------ *
 * variable_state — list assertions
 * ------------------------------------------------------------------ */

test('list length comparisons reuse the value comparison modes', async () => {
  const passed = await grade(variableCase({
    list_assertions: { length_enabled: true, length_value: 3, length_comparison: 'gte' },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(passed.passed, true);

  const failed = await grade(variableCase({
    list_assertions: { length_enabled: true, length_value: 3 },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(failed.passed, false);
  assert.match(failed.detail, /length equals 3, got 2/);

  const empty = await grade(variableCase({
    list_assertions: { length_enabled: true, length_value: 0 },
  }), { code: 'var value = [];\n' });
  assert.equal(empty.passed, true);

  const negative = await grade(variableCase({
    list_assertions: { length_enabled: true, length_value: -2, length_comparison: 'lte' },
  }), { code: 'var value = [];\n' });
  assert.equal(negative.passed, true);
});

test('list values compare in order, as a multiset, or as a subset', async () => {
  const inOrder = await grade(variableCase({
    list_assertions: { values_enabled: true, expected_values: [1, 2, 3] },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(inOrder.passed, true);

  const wrongOrder = await grade(variableCase({
    list_assertions: { values_enabled: true, expected_values: [3, 2, 1] },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(wrongOrder.passed, false);

  const anyOrder = await grade(variableCase({
    list_assertions: { values_enabled: true, values_match_mode: 'same_values_any_order', expected_values: [3, 1, 2] },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(anyOrder.passed, true);

  // Duplicates are counted, not ignored.
  const duplicates = await grade(variableCase({
    list_assertions: { values_enabled: true, values_match_mode: 'same_values_any_order', expected_values: [1, 1, 2] },
  }), { code: 'var value = [1, 2, 2];\n' });
  assert.equal(duplicates.passed, false);

  const subset = await grade(variableCase({
    list_assertions: { values_enabled: true, values_match_mode: 'expected_subset_of_actual', expected_values: [2] },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(subset.passed, true);

  const superset = await grade(variableCase({
    list_assertions: { values_enabled: true, values_match_mode: 'expected_superset_of_actual', expected_values: [1, 2, 3, 4] },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(superset.passed, true);

  const wrongSuperset = await grade(variableCase({
    list_assertions: { values_enabled: true, values_match_mode: 'expected_superset_of_actual', expected_values: [1] },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(wrongSuperset.passed, false);
});

test('an unknown list value mode falls back to exact order', async () => {
  const result = await grade(variableCase({
    list_assertions: { values_enabled: true, values_match_mode: 'sideways', expected_values: [1, 2] },
  }), { code: 'var value = [2, 1];\n' });
  assert.equal(result.passed, false);
  assert.match(result.detail, /mode exact_order/);
});

test('item type modes are all, some and none, and an empty list satisfies all and none', async () => {
  const allTypes = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'all', expected_item_types: ['int'] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(allTypes.passed, true);

  const allMixed = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'all', expected_item_types: ['int'] },
  }), { code: "var value = [1, 'two'];\n" });
  assert.equal(allMixed.passed, false);

  const someTypes = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'some', expected_item_types: ['string'] },
  }), { code: "var value = [1, 'two'];\n" });
  assert.equal(someTypes.passed, true);

  const noneTypes = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'none', expected_item_types: ['string'] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(noneTypes.passed, true);

  const noneWithString = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'none', expected_item_types: ['string'] },
  }), { code: "var value = ['one'];\n" });
  assert.equal(noneWithString.passed, false);

  const emptyAll = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'all', expected_item_types: ['int'] },
  }), { code: 'var value = [];\n' });
  assert.equal(emptyAll.passed, true);

  const emptySome = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'some', expected_item_types: ['int'] },
  }), { code: 'var value = [];\n' });
  assert.equal(emptySome.passed, false);

  const emptyNone = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'none', expected_item_types: ['int'] },
  }), { code: 'var value = [];\n' });
  assert.equal(emptyNone.passed, true);
});

test('the any wildcard is dropped from expected item types, so it can only satisfy none', async () => {
  const none = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'none', expected_item_types: ['any'] },
  }), { code: 'var value = [1];\n' });
  assert.equal(none.passed, true);

  const all = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'all', expected_item_types: ['any'] },
  }), { code: 'var value = [1];\n' });
  assert.equal(all.passed, false);
});

test('index checks assert existence, type and value of one entry', async () => {
  const passed = await grade(variableCase({
    list_assertions: { index_checks: [{ index: 1, expected_type: 'int', expected_value: 2 }] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(passed.passed, true);

  const wrongValue = await grade(variableCase({
    list_assertions: { index_checks: [{ index: 1, expected_value: 9 }] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(wrongValue.passed, false);
  assert.match(wrongValue.detail, /value\[1\] to equal 9, got 2/);

  const wrongType = await grade(variableCase({
    list_assertions: { index_checks: [{ index: 0, expected_type: 'string' }] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(wrongType.passed, false);
  assert.match(wrongType.detail, /value\[0\] to be string, got int/);

  const missing = await grade(variableCase({
    list_assertions: { index_checks: [{ index: 5 }] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(missing.passed, false);
  assert.match(missing.detail, /value\[5\] to exist, but the list length is 2/);
});

test('odd index values are clamped and rounded the way the config normalizer does', async () => {
  const negative = await grade(variableCase({
    list_assertions: { index_checks: [{ index: -3, expected_value: 1 }] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(negative.passed, true);

  const fractional = await grade(variableCase({
    list_assertions: { index_checks: [{ index: 1.9, expected_value: 2 }] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(fractional.passed, true);

  const junk = await grade(variableCase({
    list_assertions: { index_checks: [{ index: 'nonsense', expected_value: 1 }, 'not an object'] },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(junk.passed, true);
});

test('list assertions on a value that is not a list fail with a clear message', async () => {
  const result = await grade(variableCase({
    list_assertions: { length_enabled: true, length_value: 2 },
  }), { code: 'var value = 5;\n' });

  assert.equal(result.passed, false);
  assert.match(result.detail, /Expected value to be a list before applying list assertions, got int/);
});

test('null and undefined entries are reported with their own type names', async () => {
  // `null` is not one of the configurable expected types, so the way to see
  // how the two are told apart is the item type list in the failure detail.
  const result = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'all', expected_item_types: ['int'] },
  }), { code: 'var value = [null, undefined, 1];\n' });

  assert.equal(result.passed, false);
  assert.match(result.detail, /got null, undefined, int/);
});

test('an empty string and a zero item are typed, not treated as missing', async () => {
  const result = await grade(variableCase({
    list_assertions: { item_types_enabled: true, item_type_mode: 'all', expected_item_types: ['string', 'int'] },
  }), { code: "var value = ['', 0];\n" });
  assert.equal(result.passed, true);
});

test('list assertions combine with the type and value checks', async () => {
  const result = await grade(variableCase({
    expected_type: 'list',
    list_assertions: { length_enabled: true, length_value: 2 },
  }), { code: 'var value = [1, 2];\n' });
  assert.equal(result.passed, true);

  const wrongTypeAndLength = await grade(variableCase({
    expected_type: 'string',
    value_assertion_enabled: false,
    list_assertions: { length_enabled: true, length_value: 5, values_enabled: true, expected_values: [1, 2] },
  }), { code: 'var value = [1, 2, 3];\n' });
  assert.equal(wrongTypeAndLength.passed, false);
  assert.match(wrongTypeAndLength.detail, /Expected value to be string, got list/);
  assert.match(wrongTypeAndLength.detail, /length equals 5, got 3/);
  assert.match(wrongTypeAndLength.detail, /values to match mode exact_order/);
});

/* ------------------------------------------------------------------ *
 * function_state
 * ------------------------------------------------------------------ */

test('a function that was never defined is reported as missing', async () => {
  const result = await grade(functionCase({ function_name: 'double' }), {
    code: 'async function other() { return 1; }\n',
  });

  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Function "double" was not found after execution.');
  assert.match(result.detail, /Available functions:/);
});

test('a name that is defined but not callable is reported as such', async () => {
  const result = await grade(functionCase({ function_name: 'double' }), { code: 'var double = 3;\n' });

  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Function "double" is not callable.');
  assert.match(result.detail, /defined, but it is an int instead of a function/);
});

test('parameter count checks compare the declared arity', async () => {
  const twoParams = 'async function double(a, b) { return a + b; }\n';

  const matching = await grade(functionCase({
    parameter_count_enabled: true, parameter_count: 2,
  }), { code: twoParams });
  assert.equal(matching.passed, true);

  const mismatched = await grade(functionCase({
    parameter_count_enabled: true, parameter_count: 1,
  }), { code: twoParams });
  assert.equal(mismatched.passed, false);
  assert.equal(mismatched.feedback, 'Function "double" does not have the expected number of parameters.');
  assert.match(mismatched.detail, /declare 1 parameter\(s\), got 2/);

  // Default values and rest parameters do not count towards arity.
  const withDefault = await grade(functionCase({
    parameter_count_enabled: true, parameter_count: 0,
  }), { code: 'function double(a = 1) { return a; }\n' });
  assert.equal(withDefault.passed, true);

  const withRest = await grade(functionCase({
    parameter_count_enabled: true, parameter_count: 0,
  }), { code: 'function double(...rest) { return rest.length; }\n' });
  assert.equal(withRest.passed, true);

  // An unusable count is treated as zero rather than skipping the check.
  const junkCount = await grade(functionCase({
    parameter_count_enabled: true, parameter_count: 'many',
  }), { code: twoParams });
  assert.equal(junkCount.passed, false);
  assert.match(junkCount.detail, /declare 0 parameter\(s\), got 2/);
});

test('the parameter check is off unless it is enabled', async () => {
  const result = await grade(functionCase({ parameter_count: 99 }), {
    code: 'async function double(a) { return a * 2; }\n',
  });
  assert.equal(result.passed, true);
});

test('a return assertion calls the function with the configured arguments', async () => {
  const code = 'async function double(n) { return n * 2; }\n';

  const passed = await grade(functionCase({
    return_assertion: { enabled: true, arguments: [4], expected_type: 'int', expected_value: 8 },
  }), { code });
  assert.equal(passed.passed, true);
  assert.equal(passed.feedback, 'Function "double" returns the expected value!');

  const wrongReturn = await grade(functionCase({
    return_assertion: { enabled: true, arguments: [4], expected_value: 9 },
  }), { code });
  assert.equal(wrongReturn.passed, false);
  assert.match(wrongReturn.detail, /double\(4\) equals 9, got 8/);

  const wrongType = await grade(functionCase({
    return_assertion: { enabled: true, arguments: [4], expected_type: 'string', value_assertion_enabled: false },
  }), { code });
  assert.equal(wrongType.passed, false);
  assert.match(wrongType.detail, /to return a string, got an int/);
});

test('the call arguments are part of what the assertion checks', async () => {
  const code = 'async function double(n) { return n * 2; }\n';

  const rightArgs = await grade(functionCase({
    return_assertion: { enabled: true, arguments: [4], expected_value: 8 },
  }), { code });
  assert.equal(rightArgs.passed, true);

  // A different call configuration means a different call, checked on its own.
  const otherArgs = await grade(functionCase({
    return_assertion: { enabled: true, arguments: [5], expected_value: 8 },
  }), { code });
  assert.equal(otherArgs.passed, false);
  assert.match(otherArgs.detail, /double\(5\) equals 8, got 10/);
});

test('two tests of the same function with different arguments each run', async () => {
  const { results, totalScore } = await runTests([
    functionCase({ id: 'first', return_assertion: { enabled: true, arguments: [1], expected_value: 2 } }),
    functionCase({ id: 'second', return_assertion: { enabled: true, arguments: [2], expected_value: 4 } }),
  ], 'async function double(n) { return n * 2; }\n', emptyWorkspace());

  assert.deepEqual(results.map((result) => [result.id, result.passed]), [['first', true], ['second', true]]);
  assert.equal(totalScore, 2);
});

test('a return assertion with nothing to check passes once the call runs', async () => {
  const result = await grade(functionCase({
    return_assertion: { enabled: true, arguments: [] },
  }), { code: 'async function double() { return 4; }\n' });
  assert.equal(result.passed, true);
});

test('a function that throws fails the return check instead of the run', async () => {
  const result = await grade(functionCase({
    return_assertion: { enabled: true, arguments: [1], expected_value: 2 },
  }), { code: "async function double(n) { throw new Error('no doubling today'); }\n" });

  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Calling function "double" caused an error.');
  assert.match(result.detail, /Calling double\(1\) failed: no doubling today/);
});

test('a return assertion can grade list results', async () => {
  const result = await grade(functionCase({
    return_assertion: {
      enabled: true,
      arguments: [],
      expected_type: 'list',
      list_assertions: { length_enabled: true, length_value: 2, values_enabled: true, expected_values: [1, 2] },
    },
  }), { code: 'async function double() { return [1, 2]; }\n' });
  assert.equal(result.passed, true);

  const wrongLength = await grade(functionCase({
    return_assertion: {
      enabled: true,
      arguments: [],
      expected_type: 'list',
      list_assertions: { length_enabled: true, length_value: 3 },
    },
  }), { code: 'async function double() { return [1, 2]; }\n' });
  assert.equal(wrongLength.passed, false);
  assert.match(wrongLength.detail, /length equals 3, got 2/);
});

test('a return assertion can require the right value in the wrong type', async () => {
  const result = await grade(functionCase({
    return_assertion: {
      enabled: true, arguments: [], expected_type: 'int', expected_value: 3, show_coerced_value_hint: true,
    },
  }), { code: 'async function double() { return 3.9; }\n' });

  assert.equal(result.passed, false);
  assert.match(result.detail, /return an int, got a float/);
  assert.match(result.student_detail.note, /correct, but not the correct type/);
});

test('a function name that is not an identifier is never captured', async () => {
  const result = await grade(functionCase({ function_name: 'double-it' }), {
    code: 'globalThis.doubleit = () => 1;\n',
  });
  assert.equal(result.passed, false);
  assert.match(result.feedback, /was not found after execution/);
});

test('a crashing program fails a function test as a code error', async () => {
  const result = await grade(functionCase({ function_name: 'double' }), { code: "throw new Error('boom');\n" });
  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Code error: boom');
});

/* ------------------------------------------------------------------ *
 * stdout_match — function execution scope
 * ------------------------------------------------------------------ */

test('function-scoped output is only what the call itself printed', async () => {
  const code = `async function shout(message) {
  await __runtime.writeLine(String(message).toUpperCase());
}
await __runtime.writeLine('main line');
`;

  const scoped = await grade(stdoutCase({
    execution_context: { scope: 'function', function_name: 'shout', arguments: ['hi'] },
    output_assertion: { enabled: true, expected: 'HI\n', match_mode: 'exact' },
  }), { code });
  assert.equal(scoped.passed, true);

  const wholeProgram = await grade(stdoutCase({
    execution_context: { scope: 'function', function_name: 'shout', arguments: ['hi'] },
    output_assertion: { enabled: true, expected: 'main line\nHI\n', match_mode: 'exact' },
  }), { code });
  assert.equal(wholeProgram.passed, false);
});

test('a function-scoped test whose function cannot be called fails with the reason', async () => {
  const code = 'async function shout(message) { return message; }\n';

  const missing = await grade(stdoutCase({
    execution_context: { scope: 'function', function_name: 'nope', arguments: [] },
  }), { code });
  assert.equal(missing.passed, false);
  assert.equal(missing.feedback, 'Function "nope" could not be called.');
  assert.match(missing.detail, /Calling nope\(\) failed: NameError/);

  const notCallable = await grade(stdoutCase({
    execution_context: { scope: 'function', function_name: 'shout' },
    output_assertion: { enabled: true, expected: '', match_mode: 'exact' },
  }), { code: 'var shout = 1;\n' });
  assert.equal(notCallable.passed, false);
  assert.match(notCallable.detail, /Calling shout\(\) failed/);
});

/* ------------------------------------------------------------------ *
 * block_structure
 * ------------------------------------------------------------------ */

test('a real workspace is graded by block existence conditions', async () => {
  const workspace = workspaceWith([
    { type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi' } } } } },
  ]);

  const found = await grade(blockCase({ type: 'block_exists', block_type: 'text_print' }), { workspace });
  assert.equal(found.passed, true);
  assert.equal(found.feedback, 'Block structure is correct!');

  const missing = await grade(blockCase({ type: 'block_exists', block_type: 'controls_repeat_ext' }), { workspace });
  assert.equal(missing.passed, false);
  assert.equal(missing.feedback, 'Required block arrangement not found.');
  assert.match(missing.detail, /need at least 1/);

  const counted = await grade(blockCase({ type: 'block_count', block_type: 'text_print', min: 2 }), { workspace });
  assert.equal(counted.passed, false);
  assert.match(counted.detail, /text_print count: 1/);
});

test('nested all, any and none conditions grade the real workspace', async () => {
  const workspace = workspaceWith([{ type: 'text_print' }, { type: 'controls_repeat_ext' }]);

  const passing = await grade(blockCase({
    type: 'all',
    conditions: [
      { type: 'block_exists', block_type: 'text_print' },
      {
        type: 'any',
        conditions: [
          { type: 'block_missing', block_type: 'controls_repeat_ext' },
          { type: 'block_exists', block_type: 'controls_repeat_ext' },
        ],
      },
    ],
  }), { workspace });
  assert.equal(passing.passed, true);
  assert.match(passing.detail, /ALL: 2\/2 passed/);

  const failing = await grade(blockCase({
    type: 'all',
    conditions: [
      { type: 'block_exists', block_type: 'text_print', min_count: 5 },
      { type: 'block_exists', block_type: 'controls_repeat_ext' },
    ],
  }), { workspace });
  assert.equal(failing.passed, false);
  assert.match(failing.detail, /ALL: 1\/2 passed/);
});

test('an unknown condition type fails the test with a detail instead of throwing', async () => {
  const result = await grade(blockCase({ type: 'no_such_condition' }), { workspace: emptyWorkspace() });
  assert.equal(result.passed, false);
  assert.equal(result.detail, 'Unknown condition type: no_such_condition');
});

test('a block_structure test needs no generated code at all', async () => {
  const { results } = await runTests([
    blockCase({ type: 'workspace_empty' }, { points: 4 }),
  ], undefined, emptyWorkspace());

  assert.equal(results[0].passed, true);
  assert.equal(results[0].score, 4);
});

test('a block_pattern condition matches a nested arrangement in the real workspace', async () => {
  const pattern = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: 'controls_repeat_ext',
        inputs: {
          TIMES: { shadow: { type: 'math_number', fields: { NUM: 3 } } },
          DO: {
            block: {
              type: 'text_print',
              inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi' } } } },
            },
          },
        },
      }],
    },
  };
  const nestedWorkspace = workspaceWith(pattern.blocks.blocks);

  const matched = await grade(blockCase({ type: 'block_pattern', workspace_state: pattern }), { workspace: nestedWorkspace });
  assert.equal(matched.passed, true);
  assert.match(matched.detail, /Pattern rooted at controls_repeat_ext/);

  const printOnlyWorkspace = workspaceWith([
    { type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi' } } } } },
  ]);
  const unmatched = await grade(blockCase({ type: 'block_pattern', workspace_state: pattern }), { workspace: printOnlyWorkspace });
  assert.equal(unmatched.passed, false);
  assert.match(unmatched.detail, /No workspace block matched the pattern/);
});

test('a malformed block_pattern condition is reported, not thrown', async () => {
  const noState = await grade(blockCase({ type: 'block_pattern' }), { workspace: emptyWorkspace() });
  assert.equal(noState.passed, false);
  assert.equal(noState.detail, 'Pattern workspace is missing');

  const twoRoots = {
    blocks: {
      languageVersion: 0,
      blocks: [{ type: 'text_print' }, { type: 'text_print' }],
    },
  };
  const multipleRoots = await grade(blockCase({ type: 'block_pattern', workspace_state: twoRoots }), { workspace: emptyWorkspace() });
  assert.equal(multipleRoots.passed, false);
  assert.match(multipleRoots.detail, /must have exactly one root block, found 2/);
});

test('a wildcard in the middle of a pattern chain requires a following statement', async () => {
  const pattern = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: 'text_print',
        inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } },
        next: {
          block: {
            type: 'pattern_any_statement',
            next: {
              block: {
                type: 'text_print',
                inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } },
              },
            },
          },
        },
      }],
    },
  };
  const twoPrints = workspaceWith([
    { type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'a' } } } }, next: { block: { type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'b' } } } } } } },
  ]);
  const onePrint = workspaceWith([
    { type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'a' } } } } },
  ]);

  const matched = await grade(blockCase({ type: 'block_pattern', workspace_state: pattern }), { workspace: twoPrints });
  assert.equal(matched.passed, true);

  const unmatched = await grade(blockCase({ type: 'block_pattern', workspace_state: pattern }), { workspace: onePrint });
  assert.equal(unmatched.passed, false);
});

test('pattern field constraints are checked against the matched block fields', async () => {
  const workspace = workspaceWith([
    { type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi there' } } } } },
  ]);
  const pattern = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: 'text_print',
        id: 'pat_print',
        inputs: { TEXT: { shadow: { type: 'text', id: 'pat_text', fields: { TEXT: '' } } } },
      }],
    },
  };

  const contains = await grade(blockCase({
    type: 'block_pattern',
    workspace_state: pattern,
    field_constraints: { pat_text: { TEXT: { expected_value: 'hi', match_mode: 'contains' } } },
  }), { workspace });
  assert.equal(contains.passed, true);

  const wrongText = await grade(blockCase({
    type: 'block_pattern',
    workspace_state: pattern,
    field_constraints: { pat_text: { TEXT: { expected_value: 'bye' } } },
  }), { workspace });
  assert.equal(wrongText.passed, false);

  // text_print has no TEXT field of its own; the shadow block carries it.
  const unknownField = await grade(blockCase({
    type: 'block_pattern',
    workspace_state: pattern,
    field_constraints: { pat_print: { TEXT: { expected_value: 'hi there' } } },
  }), { workspace });
  assert.equal(unknownField.passed, false);
});

test('a conditions object without a type fails the test gracefully', async () => {
  const empty = await grade(blockCase({}), { workspace: emptyWorkspace() });
  assert.equal(empty.passed, false);
  assert.equal(empty.detail, 'Unknown condition type: undefined');
  assert.equal(empty.score, 0);

  const emptyList = await grade(blockCase([]), { workspace: emptyWorkspace() });
  assert.equal(emptyList.passed, false);
  assert.equal(emptyList.detail, 'Unknown condition type: undefined');
});

test('test cases missing their type or target name fail as not found', async () => {
  const noType = await grade({ id: 'x', points: 1 }, { code: 'var a = 1;\n' });
  assert.equal(noType.passed, false);
  assert.equal(noType.feedback, 'Unknown test type: undefined');

  const noVariableName = await grade({ id: 'v', type: 'variable_state', points: 1, expected_value: 1 }, { code: 'var a = 1;\n' });
  assert.equal(noVariableName.passed, false);
  assert.equal(noVariableName.feedback, 'Variable "undefined" not found after execution.');

  const noFunctionName = await grade({ id: 'f', type: 'function_state', points: 1 }, { code: 'var a = 1;\n' });
  assert.equal(noFunctionName.passed, false);
  assert.equal(noFunctionName.feedback, 'Function "undefined" was not found after execution.');
});

/* ------------------------------------------------------------------ *
 * Execution limits
 * ------------------------------------------------------------------ */

test('a generated loop is stopped by the loop trap instead of hanging the run', async () => {
  const code = generatedCodeFrom({
    blocks: [{
      type: 'controls_repeat_ext',
      inputs: {
        TIMES: { shadow: { type: 'math_number', fields: { NUM: 1000000 } } },
        DO: {
          block: {
            type: 'text_print',
            inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'tick' } } } },
          },
        },
      },
    }],
  });
  assert.match(code, /__loopTrap/);

  const result = await grade(variableCase({ variable_name: 'total' }), { code });
  assert.equal(result.passed, false);
  assert.equal(result.feedback, 'Code error: Infinite loop detected');
});

test('a long-running but finite program is graded normally in the direct fallback', async () => {
  // The 5s timeout lives in the worker path, and Node has no Worker, so a
  // silent endless loop written by hand cannot be graded here at all — it
  // would hang the process. What is checkable is that long-running finite
  // code is not cut short.
  const result = await grade(stdoutCase({
    output_assertion: { enabled: true, expected: 'done\n', match_mode: 'exact' },
  }), {
    code: `var total = 0;
for (var i = 0; i < 200000; i++) { total += i; }
await __runtime.writeLine(total > 0 ? 'done' : 'never');
`,
  });
  assert.equal(result.passed, true);
});

/* ------------------------------------------------------------------ *
 * Execution plan reuse
 * ------------------------------------------------------------------ */

test('tests that share prompt inputs reuse one execution, new inputs run again', async () => {
  const counted = `globalThis.__runCount = (globalThis.__runCount || 0) + 1;
if (globalThis.__runCount > 1) {
  await __runtime.promptText('echo');
}
await __runtime.writeLine('run ' + globalThis.__runCount);
`;
  delete globalThis.__runCount;
  try {
    const { results, totalScore } = await runTests([
      stdoutCase({
        id: 'first',
        output_assertion: { enabled: true, expected: 'run 1\n', match_mode: 'exact' },
      }),
      variableCase({ id: 'second', variable_name: 'total', prompt_inputs: [] }),
      stdoutCase({
        id: 'third',
        prompt_inputs: ['x'],
        output_assertion: { enabled: true, expected: 'run 2\n', match_mode: 'exact' },
      }),
    ], counted, emptyWorkspace());

    // The variable test shared the first stdout test's run: had it executed
    // again, the last test would have printed "run 3".
    assert.deepEqual(results.map((result) => [result.id, result.passed]), [
      ['first', true],
      ['second', false],
      ['third', true],
    ]);
    assert.equal(globalThis.__runCount, 2);
    assert.equal(totalScore, 2);
  } finally {
    delete globalThis.__runCount;
  }
});

test('every variable a test asks about is captured from the shared run', async () => {
  const code = `var total = 3;
var extra = 4;
`;
  const { results, totalScore } = await runTests([
    variableCase({ id: 'total_test', variable_name: 'total', expected_value: 3 }),
    variableCase({ id: 'extra_test', variable_name: 'extra', expected_value: 4 }),
    variableCase({ id: 'missing_test', variable_name: 'absent', expected_value: 0 }),
  ], code, emptyWorkspace());

  assert.deepEqual(results.map((result) => [result.id, result.passed]), [
    ['total_test', true],
    ['extra_test', true],
    ['missing_test', false],
  ]);
  assert.equal(totalScore, 2);
  assert.equal(results[2].detail, 'Available variables: total, extra, absent');
});

/* ------------------------------------------------------------------ *
 * Generated code, end to end
 * ------------------------------------------------------------------ */

test('a generated program of variables and prints is graded on both value and output', async () => {
  const code = generatedCodeFrom({
    variables: [{ name: 'greeting', id: 'v1' }],
    blocks: [
      {
        type: 'variables_set',
        fields: { VAR: { id: 'v1' } },
        inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'Hello' } } } },
      },
      {
        type: 'text_append',
        fields: { VAR: { id: 'v1' } },
        inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: ' world' } } } },
      },
      {
        type: 'text_print',
        inputs: { TEXT: { block: { type: 'variables_get', fields: { VAR: { id: 'v1' } } } } },
      },
    ],
  });
  assert.match(code, /await __runtime\.writeLine\(__runtime\.readVar\("greeting", greeting\)\);/);

  const { results, totalScore } = await runTests([
    variableCase({
      id: 'variable',
      variable_name: 'greeting',
      expected_type: 'string',
      expected_value: 'Hello world',
    }),
    stdoutCase({
      id: 'output',
      output_assertion: { enabled: true, expected: 'Hello world\n', match_mode: 'exact' },
    }),
  ], code, emptyWorkspace());

  assert.deepEqual(results.map((result) => [result.id, result.passed]), [['variable', true], ['output', true]]);
  assert.equal(totalScore, 2);
});

test('a generated prompt program is graded on its prompt and its output', async () => {
  const code = generatedCodeFrom({
    variables: [{ name: 'name', id: 'v1' }],
    blocks: [
      {
        type: 'variables_set',
        fields: { VAR: { id: 'v1' } },
        inputs: {
          VALUE: {
            block: {
              type: 'text_prompt_ext',
              fields: { TYPE: 'TEXT' },
              inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'Name?' } } } },
            },
          },
        },
      },
      {
        type: 'text_print',
        inputs: { TEXT: { block: { type: 'variables_get', fields: { VAR: { id: 'v1' } } } } },
      },
    ],
  });
  assert.match(code, /await __runtime\.promptText\('Name\?'\)/);

  const result = await grade(stdoutCase({
    prompt_inputs: ['Ada'],
    output_assertion: { enabled: true, expected: 'Ada\n', match_mode: 'exact' },
    prompt_assertion: { enabled: true, expected: 'Name?', match_mode: 'exact', match_any_item: true },
  }), { code });
  assert.equal(result.passed, true);

  const wrongInput = await grade(stdoutCase({
    prompt_inputs: ['Ada', 'extra'],
    output_assertion: { enabled: true, expected: 'Ada\n', match_mode: 'exact' },
  }), { code });
  assert.equal(wrongInput.passed, false);
  assert.match(wrongInput.feedback, /asked for 1 input/);
});

test('a generated procedure is graded by parameter count, call and printed result', async () => {
  const code = generatedCodeFrom({
    blocks: [
      {
        type: 'procedures_defreturn',
        fields: { NAME: 'add' },
        extraState: { params: [{ name: 'a', id: 'pa' }, { name: 'b', id: 'pb' }] },
        inputs: {
          RETURN: {
            block: {
              type: 'math_arithmetic',
              fields: { OP: 'ADD' },
              inputs: {
                A: {
                  shadow: { type: 'math_number', fields: { NUM: 0 } },
                  block: { type: 'variables_get', fields: { VAR: { id: 'pa' } } },
                },
                B: {
                  shadow: { type: 'math_number', fields: { NUM: 0 } },
                  block: { type: 'variables_get', fields: { VAR: { id: 'pb' } } },
                },
              },
            },
          },
        },
      },
      {
        type: 'text_print',
        inputs: {
          TEXT: {
            block: {
              type: 'procedures_callreturn',
              fields: { NAME: 'add' },
              extraState: { params: ['a', 'b'] },
              inputs: {
                ARG0: { shadow: { type: 'math_number', fields: { NUM: 2 } } },
                ARG1: { shadow: { type: 'math_number', fields: { NUM: 3 } } },
              },
            },
          },
        },
      },
    ],
  });
  assert.match(code, /async function add\(a, b\)/);
  assert.match(code, /await __runtime\.writeLine\(await add\(2, 3\)\);/);

  const { results, totalScore, maxScore } = await runTests([
    functionCase({
      id: 'definition',
      function_name: 'add',
      parameter_count_enabled: true,
      parameter_count: 2,
      return_assertion: { enabled: true, arguments: [2, 3], expected_type: 'int', expected_value: 5 },
    }),
    stdoutCase({
      id: 'call_output',
      output_assertion: { enabled: true, expected: '5\n', match_mode: 'exact' },
    }),
  ], code, emptyWorkspace());

  assert.deepEqual(results.map((result) => [result.id, result.passed]), [
    ['definition', true],
    ['call_output', true],
  ]);
  assert.equal(totalScore, 2);
  assert.equal(maxScore, 2);
});

test('a return assertion sees the resolved value of an async generated procedure', async () => {
  const code = `async function double(n) {
  await __runtime.writeLine('working');
  return n * 2;
}
`;
  const result = await grade(functionCase({
    function_name: 'double',
    return_assertion: { enabled: true, arguments: [21], expected_type: 'int', expected_value: 42 },
  }), { code });

  assert.equal(result.passed, true);
});

/* ------------------------------------------------------------------ *
 * executeInteractiveRun
 * ------------------------------------------------------------------ */

test('an interactive run streams each printed line and reports success', async () => {
  const lines = [];
  const result = await executeInteractiveRun(
    `await __runtime.writeLine('first');
await __runtime.writeLine('second');
`,
    { onStdout: (line) => lines.push(line) },
  );

  assert.deepEqual(lines, ['first', 'second']);
  assert.equal(result.success, true);
  assert.equal(result.cancelled, false);
  assert.equal(result.error, null);
  assert.equal(result.stdout, 'first\nsecond\n');
});

test('an interactive run captures no variables and no prompt diagnostics', async () => {
  const result = await executeInteractiveRun('var value = 1;\n');

  assert.equal(result.success, true);
  assert.deepEqual(result.variables, {});
  assert.deepEqual(result.functions, {});
  assert.deepEqual(result.functionCalls, {});
  assert.equal(result.promptDiagnostics, null);
});

test('requestInput is asked for each prompt with its message and default', async () => {
  const requests = [];
  const result = await executeInteractiveRun(
    `await __runtime.writeLine(await __runtime.promptText('Name?', 'student'));
await __runtime.writeLine(await __runtime.promptNumber('Age?'));
`,
    {
      requestInput: (request) => {
        requests.push(request);
        return request.message === 'Age?' ? '21' : 'Ada';
      },
    },
  );

  assert.deepEqual(requests[0], { message: 'Name?', defaultValue: 'student', inputType: 'text' });
  // A numeric prompt is resolved through the same text provider, so the
  // request shape beyond message and default is not asserted for it.
  assert.equal(requests[1].message, 'Age?');
  assert.equal(requests[1].defaultValue, '');
  assert.equal(result.success, true);
  assert.equal(result.stdout, 'Ada\n21\n');
  assert.deepEqual(result.prompts.map((prompt) => prompt.response), ['Ada', '21']);
});

test('a number prompt parses the answer the console hands back', async () => {
  const result = await executeInteractiveRun(
    `await __runtime.writeLine(await __runtime.promptNumber('How many?') * 2);
`,
    { requestInput: () => '21' },
  );

  assert.equal(result.success, true);
  assert.equal(result.stdout, '42\n');
});

test('without a requestInput hook prompts answer with their default value', async () => {
  const result = await executeInteractiveRun(
    `await __runtime.writeLine(await __runtime.promptText('Name?', 'fallback'));
`,
  );

  assert.equal(result.success, true);
  assert.equal(result.stdout, 'fallback\n');
  assert.deepEqual(result.prompts, [{ message: 'Name?', response: 'fallback', cancelled: false }]);
});

test('a requestInput hook returning nothing falls back to the default', async () => {
  const result = await executeInteractiveRun(
    `await __runtime.writeLine(await __runtime.promptText('Name?', 'fallback'));
`,
    { requestInput: () => null },
  );

  assert.equal(result.success, true);
  assert.equal(result.stdout, 'fallback\n');
});

test('a number prompt rejects blank and non-numeric input', async () => {
  const blank = await executeInteractiveRun(
    `await __runtime.writeLine(await __runtime.promptNumber('How many?', ''));
`,
    { requestInput: () => '   ' },
  );
  assert.equal(blank.success, false);
  assert.equal(blank.error, 'ValueError: could not convert string to float: "   "');
  assert.deepEqual(blank.prompts.map((prompt) => prompt.response), ['   ']);

  const text = await executeInteractiveRun(
    `await __runtime.writeLine(await __runtime.promptNumber('How many?'));
`,
    { requestInput: () => 'lots' },
  );
  assert.equal(text.success, false);
  assert.equal(text.error, 'ValueError: could not convert string to float: "lots"');
});

test('cancelling before the first line reports a cancelled run, not an error', async () => {
  const result = await executeInteractiveRun(PRINT_HI, { isCancelled: () => true });

  assert.equal(result.success, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.error, INTERACTIVE_RUN_CANCELLED_ERROR);
  assert.equal(INTERACTIVE_RUN_CANCELLED_ERROR, 'Run cancelled.');
  assert.equal(result.stdout, '');
});

test('cancelling mid-program stops an endless loop at the next print', async () => {
  const lines = [];
  const result = await executeInteractiveRun(
    `while (true) {
  await __runtime.writeLine('tick');
}
`,
    {
      onStdout: (line) => lines.push(line),
      isCancelled: () => lines.length >= 3,
    },
  );

  assert.equal(result.cancelled, true);
  assert.equal(result.error, INTERACTIVE_RUN_CANCELLED_ERROR);
  assert.deepEqual(lines, ['tick', 'tick', 'tick']);
  assert.equal(result.stdout, 'tick\ntick\ntick\n');
});

test('a requestInput hook that fails ends the run with its error', async () => {
  const code = `await __runtime.writeLine(await __runtime.promptText('Name?'));
`;

  const failed = await executeInteractiveRun(code, {
    requestInput: () => { throw new Error('input channel closed'); },
  });
  assert.equal(failed.success, false);
  assert.equal(failed.cancelled, false);
  assert.equal(failed.error, 'input channel closed');

  // The console cancels a pending input by rejecting with this message.
  const cancelled = await executeInteractiveRun(code, {
    requestInput: () => { throw new Error(INTERACTIVE_RUN_CANCELLED_ERROR); },
  });
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.error, INTERACTIVE_RUN_CANCELLED_ERROR);
});

test('an interactive run reports a syntax error and a runtime error', async () => {
  const syntax = await executeInteractiveRun('function (\n');
  assert.equal(syntax.success, false);
  assert.equal(syntax.cancelled, false);
  assert.ok(syntax.error.length > 0);

  const runtime = await executeInteractiveRun("throw new RangeError('out of range');\n");
  assert.equal(runtime.success, false);
  assert.equal(runtime.cancelled, false);
  assert.equal(runtime.error, 'out of range');
});

test('an interactive run with output before the crash keeps that output', async () => {
  const lines = [];
  const result = await executeInteractiveRun(
    `await __runtime.writeLine('printed');
throw new Error('then failed');
`,
    { onStdout: (line) => lines.push(line) },
  );

  assert.deepEqual(lines, ['printed']);
  assert.equal(result.stdout, 'printed\n');
  assert.equal(result.success, false);
  assert.equal(result.error, 'then failed');
});
