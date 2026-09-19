# Test Types

Tests define how student work is evaluated. Each test runs an assertion and contributes to the overall score based on its point value.

## Overview

| Type | What It Checks | Requires Code Execution | Use When |
|------|---------------|------------------------|----------|
| `stdout_match` | Console output matches expected string | ✅ Yes | Checking program output |
| `block_structure` | Workspace has required block patterns | ❌ No | Enforcing specific approaches |
| `variable_state` | Variable has correct value after execution | ✅ Yes | Checking internal state |

## Common Fields (All Types)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique test identifier |
| `type` | string | ✅ | `"stdout_match"`, `"block_structure"`, or `"variable_state"` |
| `points` | integer | ✅ | Integer points awarded when the test passes |
| `feedback_on_pass` | string | No | Custom message shown to students when this test passes |
| `feedback_on_fail` | string | No | Custom message shown to students when this test fails |

---

## `stdout_match`

Runs the student's code and compares one or both captured runtime text streams:

- **Console output** — text written via `console.log(...)`
- **Prompt text** — the message strings passed into `window.prompt(...)`

### Additional Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt_inputs` | array of strings | No | `[]` | Values returned to successive `window.prompt()` calls |
| `output_assertion` | object | No | disabled unless legacy fields are present | Configures how captured stdout is checked |
| `prompt_assertion` | object | No | disabled | Configures how captured prompt text is checked |
| `expected_output` | string | Legacy | — | Legacy alias for `output_assertion.expected` |
| `match_mode` | string | Legacy | `"exact"` | Legacy alias for `output_assertion.match_mode` |

At least one of `output_assertion` or `prompt_assertion` must be enabled.

### Assertion Fields

Both `output_assertion` and `prompt_assertion` use the same structure:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | No | `false` (`output_assertion` usually `true` in the builder) | Whether this stream is checked or ignored |
| `expected` | string | No | `""` | Expected runtime text for this stream |
| `match_mode` | string | No | `"exact"` | How to compare: `"exact"`, `"contains"`, or `"regex"` |
| `show_expected` | boolean | No | `false` | Show the expected value to the learner if this assertion fails |
| `show_actual` | boolean | No | `false` | Show the captured value to the learner if this assertion fails |
| `success_message` | string | No | built-in default | Optional success message for this assertion |
| `failure_message` | string | No | built-in default / top-level `feedback_on_fail` | Optional failure message for this assertion |

### Match Modes

| Mode | Behaviour | Example |
|------|-----------|---------|
| `exact` | Output must match the expected string exactly (including whitespace and newlines) | `"Hello\n"` matches only `"Hello\n"` |
| `contains` | Output must contain the expected string as a substring | `"Hello"` matches `"Hello, World!\n"` |
| `regex` | Expected string is treated as a regular expression pattern | `"\\d+"` matches any digits in the output |

### How Output Is Captured

1. Student code is executed in a Web Worker
2. `console.log()` calls are intercepted — each call produces one line
3. Output lines are joined with `\n`
4. A trailing `\n` is added if there was any output

**Important:** Blockly's `text_print` block generates `console.log(...)` calls. Each print block produces one line of output ending with `\n`.

Prompt text is captured separately from stdout. Each `window.prompt(message)` call contributes its `message` string to the prompt transcript, and prompt messages are joined with `\n` **without** an automatic trailing newline.

### Examples

```json
// Exact output match
{
  "id": "test_hello",
  "type": "stdout_match",
  "output_assertion": {
    "enabled": true,
    "expected": "Hello, World!\n",
    "match_mode": "exact"
  },
  "points": 10,
  "feedback_on_pass": "Nice work — your output is exactly right!",
  "feedback_on_fail": "Make sure you print exactly: Hello, World!"
}

// Prompt text only
{
  "id": "test_prompt_message",
  "type": "stdout_match",
  "prompt_inputs": ["cow"],
  "output_assertion": {
    "enabled": false
  },
  "prompt_assertion": {
    "enabled": true,
    "expected": "Knock knock",
    "match_mode": "exact",
    "show_expected": true,
    "failure_message": "Use the prompt text \"Knock knock\"."
  },
  "points": 5,
  "feedback_on_pass": "Great — your prompt text is correct.",
  "feedback_on_fail": "Check the text used in your prompt block."
}

// Check both prompt text and output with student-facing detail
{
  "id": "test_io",
  "type": "stdout_match",
  "prompt_inputs": ["Ada"],
  "output_assertion": {
    "enabled": true,
    "expected": "Hello, Ada!\n",
    "match_mode": "exact",
    "show_expected": true,
    "show_actual": true
  },
  "prompt_assertion": {
    "enabled": true,
    "expected": "^What is your name\\?$",
    "match_mode": "regex",
    "show_expected": true
  },
  "points": 6,
  "feedback_on_pass": "Both your prompt and output are correct.",
  "feedback_on_fail": "Make sure both the prompt text and printed greeting are correct."
}
```

### Tips

- Remember that Blockly's `text_print` adds `\n` after each print. Include trailing newlines in `output_assertion.expected` for exact stdout matching
- Use `prompt_inputs` when the Blockly program asks the learner for input via the text prompt block
- `prompt_inputs` are used by automated checks; the normal **▶ Run Code** action still uses real browser prompt dialogs for the live program run, while **✓ Check** uses each test's configured inputs
- Prompt input matching is strict: if the program asks for more inputs than configured, or leaves configured inputs unused, the test fails explicitly
- Prompt-only checks still need `prompt_inputs` if the code calls `prompt(...)`
- `feedback_on_pass` sets the overall success message for the test. For `stdout_match`, it overrides any assertion-specific success messages
- Use `contains` for partial checking when exact whitespace doesn't matter
- Use `regex` when multiple valid outputs are acceptable (e.g., any 3-digit number)

---

## `block_structure`

Inspects the student's workspace for specific block arrangements **without executing any code**. Uses the same condition system as hints.

### Additional Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conditions` | condition object | ✅ | A condition to evaluate against the workspace. See [Condition Reference](condition-reference.md) |

`block_structure` tests can use either the existing predicate conditions (`block_exists`, `block_nested`, etc.) or the newer **`block_pattern`** visual matcher for longer mixed chains/subtrees.

In the authoring UI, **Visual block pattern** is now the primary option for cases that previously needed:
- `block_connected`
- `block_nested`
- `block_field_value`

Those older predicate types are still supported for existing configs and API-level editing, but they are treated as legacy options in the builder.

### Examples

```json
// Student must use a for-loop
{
  "id": "test_uses_loop",
  "type": "block_structure",
  "conditions": {
    "type": "block_exists",
    "block_type": "controls_for"
  },
  "points": 2,
  "feedback_on_fail": "Use a for-loop block from the Loops category"
}

// Print block must be inside a loop
{
  "id": "test_print_in_loop",
  "type": "block_structure",
  "conditions": {
    "type": "block_nested",
    "outer_type": "controls_for",
    "inner_type": "text_print",
    "input_name": "DO"
  },
  "points": 2,
  "feedback_on_fail": "Put the print block inside the loop body"
}

// Prompt with a specific message assigned into a variable
{
  "id": "test_prompt_message",
  "type": "block_structure",
  "conditions": {
    "type": "block_pattern",
    "workspace_state": { "...": "serialized Blockly pattern workspace" },
    "field_constraints": {
      "text_block_id": {
        "TEXT": {
          "expected_value": "Who.*\\?",
          "match_mode": "regex_search",
          "case_sensitive": false
        }
      }
    }
  },
  "points": 2,
  "feedback_on_fail": "Use a prompt with the expected message."
}

// Complex: must use a loop AND have a variable, but NOT use break
{
  "id": "test_proper_structure",
  "type": "block_structure",
  "conditions": {
    "type": "all",
    "conditions": [
      { "type": "block_exists", "block_type": "controls_for" },
      { "type": "block_exists", "block_type": "variables_set" },
      {
        "type": "none",
        "conditions": [
          { "type": "block_exists", "block_type": "controls_flow_statements" }
        ]
      }
    ]
  },
  "points": 3,
  "feedback_on_fail": "Use a for-loop and a variable. Don't use break/continue."
}
```

### When to Use

- **Enforce learning objectives**: Require students to use specific block types (e.g., "must use a loop, not copy-paste")
- **Partial credit**: Give points for having the right structure even if output is wrong
- **Scaffolded activities**: Check intermediate steps before the full solution
- Use the Tests tab's block pickers to choose block types from the saved Workspace/toolbox suggestions instead of memorizing Blockly identifiers

---

## `variable_state`

Runs the student's code and checks the value of a specific variable after execution.

### Additional Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt_inputs` | array of strings | No | `[]` | Values returned to successive `window.prompt()` calls |
| `variable_name` | string | ✅ | — | Name of the variable to inspect after code runs |
| `expected_value` | any | ✅ | — | The expected value to compare against |
| `comparison` | string | No | `"equals"` | Comparison operator |

### Comparison Operators

| Operator | Behaviour | Example |
|----------|-----------|---------|
| `equals` | Loose equality (`==`) | `3 == 3` → pass |
| `gt` | Greater than | `actual > expected` |
| `lt` | Less than | `actual < expected` |
| `gte` | Greater than or equal | `actual >= expected` |
| `lte` | Less than or equal | `actual <= expected` |
| `contains` | String contains substring | `String(actual).includes(String(expected))` |
| `type` | Check JavaScript type | `typeof actual === expected` (e.g., `"number"`) |

### Examples

```json
// Variable 'count' should equal 3
{
  "id": "test_count_value",
  "type": "variable_state",
  "variable_name": "count",
  "expected_value": 3,
  "comparison": "equals",
  "points": 5,
  "feedback_on_fail": "The variable 'count' should be 3 after your code runs"
}

// Variable 'result' should be greater than 10
{
  "id": "test_result_range",
  "type": "variable_state",
  "variable_name": "result",
  "expected_value": 10,
  "comparison": "gt",
  "points": 3,
  "feedback_on_fail": "The result should be greater than 10"
}

// Variable 'name' should be a string
{
  "id": "test_name_type",
  "type": "variable_state",
  "variable_name": "name",
  "expected_value": "string",
  "comparison": "type",
  "points": 2,
  "feedback_on_fail": "The variable 'name' should contain text, not a number"
}
```

### Notes

- Variable capture now follows the `variable_name` fields requested by your test cases
- Prompt input matching is strict here too: missing or unused configured inputs cause the test to fail before value comparison
- Variable capture still relies on the variable being addressable as a JavaScript identifier in generated code
- Complex object state may not be fully captured

---

## Code Execution Details

Tests that require code execution (`stdout_match` and `variable_state`) share the same execution pipeline:

### Web Worker Execution

1. Student code is generated from the Blockly workspace by the JavaScript generator
2. An infinite loop trap is prepended (`var __loopTrap = 10000;`)
3. Code is wrapped in a Web Worker with `console.log` interception
4. Worker executes the code via `new Function(code)()`
5. After execution, stdout, prompt responses, and requested variable state are sent back via `postMessage`
6. **Timeout**: 5 seconds. If the worker doesn't respond, it's terminated and the test reports "Execution timed out (possible infinite loop)"

### Fallback Execution

If Web Workers are unavailable (rare), the code executes directly via `new Function()`. This provides less isolation and **no timeout protection**.

### Error Handling

| Scenario | Behaviour |
|----------|----------|
| Code throws an error | Test fails with the error message as feedback |
| Infinite loop detected | Worker terminated after 5s; "Execution timed out" error |
| Invalid regex in `match_mode: "regex"` | Regex compilation fails silently; match returns false |
| Variable not found | Test fails with "Variable not found after execution" |

---

## Score Calculation

```
For each test:
  score = test.passed ? test.points : 0

totalScore = sum of all test scores
maxScore = sum of all test points
```

The percentage reported to the LMS is:
```
lmsScore = Math.round((totalScore / maxScore) * 100)
```

> **Note:** The `grading_mode` and `max_score` fields in the config schema are defined but **not yet implemented** at runtime. Currently, the LMS score is still reported as a derived percentage based on points earned divided by total available points.

---

## Design Patterns

### Output-Only Activity

Test only the program's output:

```json
{
  "test_cases": [
    { "id": "t1", "type": "stdout_match", "expected_output": "expected\n", "points": 10 }
  ]
}
```

### Structure-Only Activity

Grade based on block arrangement (no code execution):

```json
{
  "test_cases": [
    { "id": "t1", "type": "block_structure", "conditions": { ... }, "points": 5 },
    { "id": "t2", "type": "block_structure", "conditions": { ... }, "points": 5 }
  ]
}
```

### Mixed Assessment

Combine output, structure, and state checks:

```json
{
  "test_cases": [
    { "id": "t1", "type": "stdout_match", "expected_output": "1\n2\n3\n", "points": 5 },
    { "id": "t2", "type": "block_structure", "conditions": { ... }, "points": 3 },
    { "id": "t3", "type": "variable_state", "variable_name": "i", "expected_value": 4, "points": 2 }
  ]
}
```

### Partial Credit

Use lower point values for stretch goals:

```json
{
  "test_cases": [
    { "id": "basic", "type": "stdout_match", "expected_output": "done\n", "points": 7 },
    { "id": "bonus_structure", "type": "block_structure", "conditions": { ... }, "points": 2 },
    { "id": "bonus_efficiency", "type": "block_structure", "conditions": { ... }, "points": 1 }
  ]
}
```
