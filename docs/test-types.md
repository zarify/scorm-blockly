# Test Types

Tests define how student work is evaluated. Each test runs an assertion and contributes to the overall score based on its point value.

If `evaluation.require_previous_test_pass` is enabled (the default), test order matters: the first failing test stops the run, and later tests stay hidden behind a generic “other tests remain unpassed” message until earlier tests pass.

## Overview

| Type | What It Checks | Requires Code Execution | Use When |
|------|---------------|------------------------|----------|
| `stdout_match` | Console output matches expected string | ✅ Yes | Checking program output |
| `block_structure` | Workspace has required block patterns | ❌ No | Enforcing specific approaches |
| `variable_state` | Variable has correct value after execution | ✅ Yes | Checking internal state |
| `function_state` | Function exists, has the expected parameter count, and/or returns the expected value | ✅ Yes | Checking procedure definitions and behaviour |

## Common Fields (All Types)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique test identifier |
| `type` | string | ✅ | `"stdout_match"`, `"block_structure"`, `"variable_state"`, or `"function_state"` |
| `points` | integer | ✅ | Integer points awarded when the test passes |
| `feedback_on_pass` | string | No | Custom message shown to students when this test passes |
| `feedback_on_fail` | string | No | Custom message shown to students when this test fails |

---

## `stdout_match`

Runs the student's code and compares one or both captured runtime text streams:

- **Console output** — text written via `console.log(...)`
- **Prompt text** — the message strings shown when the learner program asks for input

### Additional Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt_inputs` | array of strings | No | `[]` | Values returned to successive learner input requests |
| `strict_prompt_inputs` | boolean | No | `true` | If true, extra or missing `prompt()` calls fail the test |
| `execution_context` | object | No | `{ "scope": "main" }` | Whether to capture the whole top-level run or only one function call |
| `output_assertion` | object | No | disabled unless legacy fields are present | Configures how captured stdout is checked |
| `prompt_assertion` | object | No | disabled | Configures how captured prompt text is checked |
| `expected_output` | string | Legacy | — | Legacy alias for `output_assertion.expected` |
| `match_mode` | string | Legacy | `"exact"` | Legacy alias for `output_assertion.match_mode` |

At least one of `output_assertion` or `prompt_assertion` must be enabled.

### Execution Context

Use `execution_context` to decide what part of the program produces the prompt/output text being checked:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `scope` | string | No | `"main"` | `"main"` captures the whole top-level run; `"function"` captures only one function call after setup finishes |
| `function_name` | string | When `scope` is `"function"` | — | Function name to call |
| `arguments` | array | When `scope` is `"function"` | `[]` | Arguments passed to that function call |

When `scope` is `"function"`, the student's top-level code still runs first so setup can happen, but the text assertions see **only** the stdout/prompt text produced during the configured function call.

### Assertion Fields

Both `output_assertion` and `prompt_assertion` use the same structure:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | No | `false` (`output_assertion` usually `true` in the builder) | Whether this stream is checked or ignored |
| `expected` | string | No | `""` | Expected runtime text for this stream |
| `match_mode` | string | No | `"exact"` | How to compare: `"exact"`, `"contains"`, or `"regex"` |
| `match_any_item` | boolean | No | `false` | When true, compare against any individual captured item instead of the combined transcript |
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

Prompt text is captured separately from stdout. Each learner input request contributes its message string to the prompt transcript, and prompt messages are joined with `\n` **without** an automatic trailing newline.

If `prompt_assertion.match_any_item` is `true`, each prompt message is checked individually instead of joining all prompt text into one transcript. This is useful when a program has multiple prompts and you want to assert that **one whole prompt** is exactly `"Knock knock"` rather than merely appearing as a substring somewhere in the combined prompt text.

If `strict_prompt_inputs` is `false`, the test will still run even when the program asks for more or fewer prompts than the configured `prompt_inputs`. This is helpful when you want to test prompt/output text in isolation without making the test depend on the student's full prompt sequence.

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
  "strict_prompt_inputs": false,
  "output_assertion": {
    "enabled": false
  },
  "prompt_assertion": {
    "enabled": true,
    "expected": "Knock knock",
    "match_mode": "exact",
    "match_any_item": true,
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

// Check only the output produced by a specific function call
{
  "id": "test_greet_output",
  "type": "stdout_match",
  "execution_context": {
    "scope": "function",
    "function_name": "greet",
    "arguments": ["Ada"]
  },
  "output_assertion": {
    "enabled": true,
    "expected": "Hello, Ada!\n",
    "match_mode": "exact",
    "show_expected": true,
    "show_actual": true
  },
  "points": 4,
  "feedback_on_fail": "Calling greet(\"Ada\") should print Hello, Ada!"
}
```

### Tips

- Remember that Blockly's `text_print` adds `\n` after each print. Include trailing newlines in `output_assertion.expected` for exact stdout matching
- Use `prompt_inputs` when the Blockly program asks the learner for input via the text prompt block
- `prompt_inputs` are used by automated checks; the normal **▶ Run Code** action now uses the in-app interactive console for the live program run, while **✓ Check** uses each test's configured inputs
- Prompt input matching is strict: if the program asks for more inputs than configured, or leaves configured inputs unused, the test fails explicitly
- Function-scope checks still use the configured `prompt_inputs` for the full run, including any top-level setup that happens before the scoped function call
- Prompt-only checks still need `prompt_inputs` if the code calls `prompt(...)`
- Use `prompt_assertion.match_any_item: true` when you want exact/contains/regex matching against any one prompt message rather than against the whole combined prompt transcript
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

The builder also supports a **Block connectedness** condition for workspace-wide checks such as "no orphan roots" or "no loose value blocks".

A `block_pattern` condition can constrain a matched block further with `field_constraints` (exact/contains/regex field values) and, for function blocks, `param_constraints` (parameter count by `equals`, `gte`, or `lte`). Parameter count checks let you grade a function signature without prescribing parameter names.

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

// Function definition with any name and exactly two parameters
{
  "id": "test_function_signature",
  "type": "block_structure",
  "conditions": {
    "type": "block_pattern",
    "workspace_state": { "...": "serialized pattern workspace with one function definition block" },
    "param_constraints": {
      "procedure_block_id": { "count": 2, "comparison": "equals" }
    }
  },
  "points": 2,
  "feedback_on_fail": "The function needs exactly two parameters."
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

// Require one connected program with no orphan roots
{
  "id": "test_no_orphans",
  "type": "block_structure",
  "conditions": {
    "type": "workspace_connectedness",
    "mode": "all_connected"
  },
  "points": 2,
  "feedback_on_fail": "Connect all of your blocks into one program."
}

// Allow multiple executable roots, but reject loose value blocks
{
  "id": "test_no_loose_values",
  "type": "block_structure",
  "conditions": {
    "type": "workspace_connectedness",
    "mode": "all_active"
  },
  "points": 1,
  "feedback_on_fail": "Remove any disconnected number, text, list, or variable blocks."
}
```

### When to Use

- **Enforce learning objectives**: Require students to use specific block types (e.g., "must use a loop, not copy-paste")
- **Partial credit**: Give points for having the right structure even if output is wrong
- **Scaffolded activities**: Check intermediate steps before the full solution
- **Workspace hygiene**: Require one connected program (`all_connected`) or reject loose value-block litter while still allowing multiple roots (`all_active`)
- Use the Tests tab's block pickers to choose block types from the saved Workspace/toolbox suggestions instead of memorizing Blockly identifiers

---

## `variable_state`

Runs the student's code and checks the type and/or value of a specific variable after execution. This now supports scalar checks, explicit type checks, and richer list-specific assertions.

### Additional Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt_inputs` | array of strings | No | `[]` | Values returned to successive learner input requests |
| `strict_prompt_inputs` | boolean | No | `true` | If true, extra or missing `prompt()` calls fail the test before value comparison |
| `variable_name` | string | ✅ | — | Name of the variable to inspect after code runs |
| `expected_type` | string | No | `"any"` | Explicit variable type: `"any"`, `"int"`, `"float"`, `"string"`, or `"list"` |
| `value_assertion_enabled` | boolean | No | `true` when `expected_value` is present | Whether to compare the variable's value |
| `expected_value` | any | No | — | The expected value to compare against for scalar checks |
| `comparison` | string | No | `"equals"` | Comparison operator for scalar checks |
| `show_coerced_value_hint` | boolean | No | `false` | If true, failed scalar/index checks can explain when the coerced value is right but the type is wrong |
| `list_assertions` | object | No | all disabled | Extra list-specific checks (length, values, item types, indexes) |

At least one of these must be enabled:
- `expected_type` other than `"any"`
- `value_assertion_enabled: true`
- one or more enabled `list_assertions`

### Scalar Comparison Operators

| Operator | Behaviour | Example |
|----------|-----------|---------|
| `equals` | Loose equality (`==`) | `3 == 3` → pass |
| `gt` | Greater than | `actual > expected` |
| `lt` | Less than | `actual < expected` |
| `gte` | Greater than or equal | `actual >= expected` |
| `lte` | Less than or equal | `actual <= expected` |
| `contains` | String contains substring | `String(actual).includes(String(expected))` |
| `type` | Legacy JavaScript type check | `typeof actual === expected` (e.g., `"number"`) |

For most new authoring, prefer `expected_type` over the legacy `type` comparison because `expected_type` can distinguish `int` from `float`, and `list` from other values.

### Variable Types

| Type | Meaning |
|------|---------|
| `any` | Do not perform a top-level type check |
| `int` | JavaScript number that is an integer |
| `float` | JavaScript number that is not an integer |
| `string` | JavaScript string |
| `list` | JavaScript array |

### List Assertions

`list_assertions` can be combined as needed:

| Field | Type | Description |
|-------|------|-------------|
| `length_enabled` | boolean | Enable list length checking |
| `length_value` | integer | Expected length |
| `length_comparison` | string | `"equals"`, `"gt"`, `"lt"`, `"gte"`, or `"lte"` |
| `values_enabled` | boolean | Enable list value matching |
| `values_match_mode` | string | `"exact_order"`, `"same_values_any_order"`, `"expected_subset_of_actual"`, or `"expected_superset_of_actual"` |
| `expected_values` | array | Expected list values for the chosen value match mode |
| `item_types_enabled` | boolean | Enable checks on item types |
| `item_type_mode` | string | `"all"`, `"some"`, or `"none"` |
| `expected_item_types` | array of strings | Allowed/checked item types (`"int"`, `"float"`, `"string"`, `"list"`) |
| `index_checks` | array | Per-index checks, each with `index` plus `expected_value`, `expected_type`, or both |

### Examples

```json
// Variable 'count' should equal 3
{
  "id": "test_count_value",
  "type": "variable_state",
  "variable_name": "count",
  "expected_type": "int",
  "value_assertion_enabled": true,
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
  "expected_type": "float",
  "value_assertion_enabled": true,
  "expected_value": 10,
  "comparison": "gt",
  "points": 3,
  "feedback_on_fail": "The result should be greater than 10"
}

// Variable 'name' should be a string, and show when the value is right after coercion
{
  "id": "test_name_type",
  "type": "variable_state",
  "variable_name": "name",
  "expected_type": "string",
  "value_assertion_enabled": true,
  "expected_value": "cow",
  "comparison": "equals",
  "show_coerced_value_hint": true,
  "points": 2,
  "feedback_on_fail": "The variable 'name' should contain text, not a number"
}

// Variable 'items' must be a list with the right values, in any order
{
  "id": "test_items_any_order",
  "type": "variable_state",
  "variable_name": "items",
  "expected_type": "list",
  "list_assertions": {
    "values_enabled": true,
    "values_match_mode": "same_values_any_order",
    "expected_values": [1, 2, 3]
  },
  "points": 4,
  "feedback_on_fail": "Your list should contain exactly 1, 2, and 3."
}

// Variable 'answers' must be a list of at least 3 strings and have "cow" at index 0
{
  "id": "test_answers_shape",
  "type": "variable_state",
  "variable_name": "answers",
  "expected_type": "list",
  "list_assertions": {
    "length_enabled": true,
    "length_value": 3,
    "length_comparison": "gte",
    "item_types_enabled": true,
    "item_type_mode": "all",
    "expected_item_types": ["string"],
    "index_checks": [
      { "index": 0, "expected_value": "cow", "expected_type": "string" }
    ]
  },
  "points": 4,
  "feedback_on_fail": "Make sure answers is a list of strings, with \"cow\" first."
}
```

### Notes

- Variable capture now follows the `variable_name` fields requested by your test cases
- Prompt input matching is strict here too: missing or unused configured inputs cause the test to fail before value comparison
- Variable capture still relies on the variable being addressable as a JavaScript identifier in generated code
- `show_coerced_value_hint` is useful when you want students to know they have the right value after coercion but still need the correct type
- List value modes with "subset" / "superset" use multiset semantics, so duplicate values matter
- Complex object state outside arrays may not be fully captured

---

## `function_state`

Runs the student's code, checks that a named function exists, optionally checks its parameter count, and can call it with configured arguments to assert the returned type and/or value.

### Additional Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `function_name` | string | ✅ | — | Name of the function to inspect after code runs |
| `parameter_count_enabled` | boolean | No | `false` | Whether to verify the number of declared parameters |
| `parameter_count` | integer | No | `0` | Expected number of declared parameters when `parameter_count_enabled` is true |
| `return_assertion` | object | No | disabled | Optional function call + return-value assertion |

The function existence/callability check always runs. `parameter_count_enabled` and `return_assertion.enabled` are optional extra checks.

### `return_assertion` Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | No | `false` | Whether to call the function and inspect the returned value |
| `arguments` | array | No | `[]` | Arguments passed to the function call |
| `expected_type` | string | No | `"any"` | Expected return type: `"any"`, `"int"`, `"float"`, `"string"`, or `"list"` |
| `value_assertion_enabled` | boolean | No | `true` when `expected_value` is present | Whether to compare the returned value |
| `expected_value` | any | No | — | Expected return value for scalar checks |
| `comparison` | string | No | `"equals"` | Scalar comparison operator (`"equals"`, `"gt"`, `"lt"`, `"gte"`, `"lte"`, `"contains"`, or `"type"`) |
| `show_coerced_value_hint` | boolean | No | `false` | If true, failures can explain when the coerced return value matches but the type is wrong |
| `show_expected` | boolean | No | `false` | Show the expected return value to the learner when this assertion fails |
| `show_actual` | boolean | No | `false` | Show the actual return value to the learner when this assertion fails |
| `success_message` | string | No | built-in default | Optional success message for the return assertion |
| `failure_message` | string | No | built-in default / top-level `feedback_on_fail` | Optional failure message for the return assertion |
| `list_assertions` | object | No | all disabled | Extra list-specific checks when the function returns a list |

`return_assertion` reuses the same type, scalar comparison, coercion-hint, and list-assertion behaviour as `variable_state`, plus the same expected/actual and custom success/failure message options used by `stdout_match`.

### Examples

```json
// Function must exist and take exactly 2 parameters
{
  "id": "test_has_add",
  "type": "function_state",
  "function_name": "add_numbers",
  "parameter_count_enabled": true,
  "parameter_count": 2,
  "points": 3,
  "feedback_on_fail": "Define add_numbers with exactly two inputs."
}

// Call a function and check the returned value and type
{
  "id": "test_add_result",
  "type": "function_state",
  "function_name": "add_numbers",
  "return_assertion": {
    "enabled": true,
    "arguments": [2, 3],
    "expected_type": "int",
    "value_assertion_enabled": true,
    "expected_value": 5,
    "comparison": "equals",
    "show_expected": true,
    "show_actual": true,
    "failure_message": "Calling add_numbers(2, 3) should give 5."
  },
  "points": 5,
  "feedback_on_pass": "Great — add_numbers returns the right result."
}

// Return a list with a specific shape
{
  "id": "test_build_list",
  "type": "function_state",
  "function_name": "build_list",
  "return_assertion": {
    "enabled": true,
    "arguments": ["cow", 3],
    "expected_type": "list",
    "show_actual": true,
    "list_assertions": {
      "length_enabled": true,
      "length_value": 3,
      "length_comparison": "equals",
      "index_checks": [
        { "index": 0, "expected_value": "cow", "expected_type": "string" }
      ]
    }
  },
  "points": 4,
  "feedback_on_fail": "build_list should return a 3-item list starting with \"cow\"."
}
```

### Notes

- Function lookup uses the configured `function_name` as a JavaScript identifier, just like variable capture uses `variable_name`
- Function calls run after the student's top-level code finishes
- If the student's code calls `prompt(...)` during a `function_state` check, the runtime continues without failing on prompt-count mismatches
- Each `function_state` test with a return assertion runs in its own execution context so side effects from one function call do not leak into another test
- If the function throws an error when called, the test fails and the runtime error is recorded in the test detail

---

## Code Execution Details

Tests that require code execution (`stdout_match`, `variable_state`, and `function_state`) share the same execution pipeline:

### Web Worker Execution

1. Student code is generated from the Blockly workspace by the JavaScript generator
2. An infinite loop trap is prepended (`var __loopTrap = 10000;`)
3. Code is wrapped in a Web Worker with `console.log` interception
4. Worker executes the code via `new Function(code)()`
5. After execution, stdout, prompt responses, requested variable state, and requested function metadata/call results are sent back via `postMessage`
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
