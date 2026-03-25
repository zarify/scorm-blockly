# Test Types

Tests define how student work is evaluated. Each test runs an assertion and contributes to the overall score based on its weight.

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
| `weight` | integer | ✅ | Percentage of total score (0–100). All weights must sum to 100 |
| `feedback_on_fail` | string | No | Custom message shown to students when this test fails |

---

## `stdout_match`

Runs the student's code and compares the captured `console.log` output against an expected string.

### Additional Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `expected_output` | string | ✅ | — | The expected console output |
| `match_mode` | string | No | `"exact"` | How to compare: `"exact"`, `"contains"`, or `"regex"` |

### Match Modes

| Mode | Behaviour | Example |
|------|-----------|---------|
| `exact` | Output must match the expected string exactly (including whitespace and newlines) | `"Hello\n"` matches only `"Hello\n"` |
| `contains` | Output must contain the expected string as a substring | `"Hello"` matches `"Hello, World!\n"` |
| `regex` | Expected string is treated as a regular expression pattern | `"\\d+"` matches any digits in the output |

### How Output Is Captured

1. Student code is executed in a Web Worker
2. `console.log()` calls are intercepted — each call produces one line
3. Lines are joined with `\n`
4. A trailing `\n` is added if there was any output

**Important:** Blockly's `text_print` block generates `console.log(...)` calls. Each print block produces one line of output ending with `\n`.

### Examples

```json
// Exact output match
{
  "id": "test_hello",
  "type": "stdout_match",
  "expected_output": "Hello, World!\n",
  "match_mode": "exact",
  "weight": 100,
  "feedback_on_fail": "Make sure you print exactly: Hello, World!"
}

// Output contains a substring
{
  "id": "test_has_greeting",
  "type": "stdout_match",
  "expected_output": "Hello",
  "match_mode": "contains",
  "weight": 50,
  "feedback_on_fail": "Your output should include the word 'Hello'"
}

// Regex pattern match
{
  "id": "test_numbers",
  "type": "stdout_match",
  "expected_output": "^(\\d+\\n){3}$",
  "match_mode": "regex",
  "weight": 60,
  "feedback_on_fail": "Expected three numbers, each on a new line"
}
```

### Tips

- Remember that Blockly's `text_print` adds `\n` after each print. Include trailing newlines in `expected_output` for exact matching
- Use `contains` for partial checking when exact whitespace doesn't matter
- Use `regex` when multiple valid outputs are acceptable (e.g., any 3-digit number)

---

## `block_structure`

Inspects the student's workspace for specific block arrangements **without executing any code**. Uses the same condition system as hints.

### Additional Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conditions` | condition object | ✅ | A condition to evaluate against the workspace. See [Condition Reference](condition-reference.md) |

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
  "weight": 20,
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
  "weight": 20,
  "feedback_on_fail": "Put the print block inside the loop body"
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
  "weight": 30,
  "feedback_on_fail": "Use a for-loop and a variable. Don't use break/continue."
}
```

### When to Use

- **Enforce learning objectives**: Require students to use specific block types (e.g., "must use a loop, not copy-paste")
- **Partial credit**: Give points for having the right structure even if output is wrong
- **Scaffolded activities**: Check intermediate steps before the full solution

---

## `variable_state`

Runs the student's code and checks the value of a specific variable after execution.

### Additional Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
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
  "weight": 50,
  "feedback_on_fail": "The variable 'count' should be 3 after your code runs"
}

// Variable 'result' should be greater than 10
{
  "id": "test_result_range",
  "type": "variable_state",
  "variable_name": "result",
  "expected_value": 10,
  "comparison": "gt",
  "weight": 30,
  "feedback_on_fail": "The result should be greater than 10"
}

// Variable 'name' should be a string
{
  "id": "test_name_type",
  "type": "variable_state",
  "variable_name": "name",
  "expected_value": "string",
  "comparison": "type",
  "weight": 20,
  "feedback_on_fail": "The variable 'name' should contain text, not a number"
}
```

### ⚠️ Current Limitations

> **Variable capture is currently limited.** The Web Worker captures a hardcoded set of variable names (currently only `count`). Tests for other variable names (e.g., `a`, `b`, `result`) will report "Variable not found" even if the code defines them. This is a known issue — dynamic variable discovery based on the test config's `variable_name` fields is planned but not yet implemented.

**What works now:**
- `variable_name: "count"` — captured and testable
- All other variable names — **not yet captured**

**Workaround:** Use `stdout_match` tests instead. Have the student print the variable value, then check the output.

Other limitations:
- Variable capture relies on the variable being accessible in the global scope after code execution
- The fallback execution mode (no Web Worker) returns an empty variables object
- Complex object state may not be fully captured

---

## Code Execution Details

Tests that require code execution (`stdout_match` and `variable_state`) share the same execution pipeline:

### Web Worker Execution

1. Student code is generated from the Blockly workspace by the JavaScript generator
2. An infinite loop trap is prepended (`var __loopTrap = 10000;`)
3. Code is wrapped in a Web Worker with `console.log` interception
4. Worker executes the code via `new Function(code)()`
5. After execution, stdout and variable state are sent back via `postMessage`
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
  score = test.passed ? test.weight : 0

totalScore = sum of all test scores
maxScore = sum of all test weights  (should be 100)
```

The percentage reported to the LMS is:
```
lmsScore = Math.round((totalScore / maxScore) * 100)
```

> **Note:** The `grading_mode` and `max_score` fields in the config schema are defined but **not yet implemented** at runtime. Currently, the score is always calculated as a weighted percentage (0–100) regardless of the `grading_mode` setting. Pass/fail status uses a hardcoded threshold of 50.

---

## Design Patterns

### Output-Only Activity

Test only the program's output:

```json
{
  "test_cases": [
    { "id": "t1", "type": "stdout_match", "expected_output": "expected\n", "weight": 100 }
  ]
}
```

### Structure-Only Activity

Grade based on block arrangement (no code execution):

```json
{
  "test_cases": [
    { "id": "t1", "type": "block_structure", "conditions": { ... }, "weight": 50 },
    { "id": "t2", "type": "block_structure", "conditions": { ... }, "weight": 50 }
  ]
}
```

### Mixed Assessment

Combine output, structure, and state checks:

```json
{
  "test_cases": [
    { "id": "t1", "type": "stdout_match", "expected_output": "1\n2\n3\n", "weight": 50 },
    { "id": "t2", "type": "block_structure", "conditions": { ... }, "weight": 25 },
    { "id": "t3", "type": "variable_state", "variable_name": "i", "expected_value": 4, "weight": 25 }
  ]
}
```

### Partial Credit

Use lower weights for stretch goals:

```json
{
  "test_cases": [
    { "id": "basic", "type": "stdout_match", "expected_output": "done\n", "weight": 70 },
    { "id": "bonus_structure", "type": "block_structure", "conditions": { ... }, "weight": 15 },
    { "id": "bonus_efficiency", "type": "block_structure", "conditions": { ... }, "weight": 15 }
  ]
}
```
