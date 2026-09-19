# Configuration Reference

Every Blockly activity is defined by a single JSON file: `activity_config.json`. This document describes every field in the schema.

## Top-Level Structure

```json
{
  "metadata": { ... },
  "instructions": { ... },
  "ui_settings": { ... },
  "blockly_setup": { ... },
  "hints": [ ... ],
  "evaluation": { ... }
}
```

| Section | Required | Description |
|---------|----------|-------------|
| `metadata` | ✅ | Activity identification |
| `instructions` | No | Student-facing guidance |
| `ui_settings` | No | Theme and UI toggles |
| `blockly_setup` | ✅ | Toolbox, starter blocks, block limits |
| `hints` | No | Contextual hints |
| `evaluation` | ✅ | Test cases and grading |

Student-facing text fields support a safe inline Markdown subset: `**bold**`, `*italic*`, and `` `code` ``. Line breaks in multi-line fields are preserved.

---

## `metadata` (required)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `activity_id` | string | ✅ | — | Unique identifier. Must match `^[a-z0-9_]+$` (lowercase letters, numbers, underscores only) |
| `title` | string | ✅ | — | Display title shown to students (minimum 1 character) |
| `version` | string | No | `"1.0"` | Version string for your own tracking |
| `description` | string | No | — | Brief description of the activity |

**Example:**
```json
{
  "metadata": {
    "activity_id": "loop_basics_01",
    "title": "Basic For-Loops",
    "version": "1.0",
    "description": "Use a loop to print the numbers 1 through 3."
  }
}
```

---

## `instructions` (optional)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `main` | string | No | — | Primary instruction text shown in the instructions panel |
| `steps` | array of strings | No | — | Ordered step-by-step guidance rendered as a numbered list |

**Example:**
```json
{
  "instructions": {
    "main": "Create a program that prints the numbers 1 to 3, each on a new line.",
    "steps": [
      "Drag a for-loop block from the Loops category",
      "Set the loop to count from 1 to 3",
      "Put a print block inside the loop",
      "Click Check to test your solution"
    ]
  }
}
```

---

## `ui_settings` (optional)

| Field | Type | Required | Default | Values | Description |
|-------|------|----------|---------|--------|-------------|
| `theme` | string | No | `"default"` | `"default"`, `"dark"`, `"high_contrast"` | ⚠️ **Not yet implemented.** Defined in schema but not applied at runtime. |
| `show_code_toggle` | boolean | No | `false` | — | Show the "Show Code" button that reveals generated JavaScript |
| `show_hint_panel` | boolean | No | `true` | — | Enable student-facing hints in the UI |
| `max_attempts` | integer or null | No | `null` | `≥ 1` or `null` | ⚠️ **Not yet enforced at runtime.** Defined in schema but the Check button is not disabled after N attempts. |

**Example:**
```json
{
  "ui_settings": {
    "theme": "default",
    "show_code_toggle": false,
    "show_hint_panel": true,
    "max_attempts": null
  }
}
```

---

## `blockly_setup` (required)

### `blockly_setup.toolbox` (required)

Defines the block palette available to students.

#### `toolbox.categories` (required array)

Each category appears as a section in the toolbox sidebar.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Category display name |
| `blocks` | array of strings | ✅ | Block type IDs (minimum 1). See [Block Type Reference](#block-type-reference) |
| `colour` | string | No | Category colour as hex (`"#5CA65C"`) or hue number (`"120"`) |

**Example:**
```json
{
  "toolbox": {
    "categories": [
      {
        "name": "Loops",
        "colour": "#5CA65C",
        "blocks": ["controls_for", "controls_repeat_ext"]
      },
      {
        "name": "Math",
        "colour": "#5C68A6",
        "blocks": ["math_number", "math_arithmetic"]
      },
      {
        "name": "Text",
        "colour": "#5CA68D",
        "blocks": ["text", "text_print"]
      }
    ]
  }
}
```

### Other `blockly_setup` Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `starting_blocks` | object or null | No | `null` | Blockly workspace state in JSON serialisation format. Set via the Workspace tab in the builder. `null` = empty workspace |
| `max_blocks` | integer or null | No | `null` | Maximum number of blocks the student can place. `null` = unlimited |
| `disabled_blocks` | array of strings | No | `[]` | ⚠️ **Not yet implemented.** Defined in schema but not applied at runtime. Intended: block type IDs that appear greyed out and cannot be used |

### Block Type Reference

Common Blockly block types:

| Category | Block Types |
|----------|------------|
| **Logic** | `controls_if`, `controls_ifelse`, `logic_compare`, `logic_operation`, `logic_negate`, `logic_boolean`, `logic_null`, `logic_ternary` |
| **Loops** | `controls_repeat_ext`, `controls_for`, `controls_forEach`, `controls_whileUntil`, `controls_flow_statements` |
| **Math** | `math_number`, `math_arithmetic`, `math_modulo`, `math_round`, `math_random_int`, `math_single`, `math_trig`, `math_on_list`, `math_constrain`, `math_number_property` |
| **Text** | `text`, `text_print`, `text_join`, `text_length`, `text_isEmpty`, `text_charAt`, `text_indexOf`, `text_getSubstring`, `text_changeCase`, `text_trim`, `text_append` |
| **Lists** | `lists_create_with`, `lists_repeat`, `lists_length`, `lists_isEmpty`, `lists_indexOf`, `lists_getIndex`, `lists_setIndex`, `lists_sort`, `lists_split` |
| **Variables** | `variables_get`, `variables_set` |
| **Functions** | `procedures_defnoreturn`, `procedures_defreturn`, `procedures_callnoreturn`, `procedures_callreturn`, `procedures_ifreturn` |

---

## `hints` (optional array)

An array of hint objects. See [Hint System](hint-system.md) for the full guide.

Each hint object:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | ✅ | — | Unique hint identifier |
| `trigger` | object | ✅ | — | When and why the hint appears |
| `trigger.event` | string | ✅ | — | `"workspace_change"`, `"test_fail"`, `"manual"`, or `"timed"` |
| `trigger.conditions` | condition object | No | — | Workspace condition (required for `workspace_change`, optional for others). See [Condition Reference](condition-reference.md) |
| `trigger.after_attempts` | integer | No | `0` | Minimum number of failed test runs before hint can appear |
| `message` | string | ✅ | — | Text shown to the student |
| `display_mode` | string | No | `"triggered"` | `triggered`: hide until fired. `checklist`: always show in the sidebar and tick off once triggered. |
| `priority` | integer | No | `1` | Higher priority hints appear first (sorted descending) |
| `delay_seconds` | integer | No | `0` | Seconds after condition becomes true before hint appears |
| `show_once` | boolean | No | `false` | If `true`, the hint can only be used once. After it is consumed, it will not reappear |
| `style` | string | No | — | Optional visual style: `"success"`, `"warning"`, or `"error"` |
| `trigger.invalidate_on_condition_false` | boolean | No | `false` | For triggered hints, hide the hint again when its condition becomes false |

**Example:**
```json
{
  "hints": [
    {
      "id": "hint_need_loop",
      "display_mode": "triggered",
      "trigger": {
        "event": "workspace_change",
        "conditions": {
          "type": "block_missing",
          "block_type": "controls_for"
        }
      },
      "message": "You'll need a loop to repeat the print action.",
      "priority": 1,
      "delay_seconds": 15,
      "show_once": false
    }
  ]
}
```

Checklist-style hints work best when the condition represents a completed milestone, such as `block_exists` for a required block or a matching `block_pattern` for a finished structure.

For longer mixed chains/subtrees, `trigger.conditions` can also be a `block_pattern` condition built visually in the authoring UI and stored as a serialized pattern workspace plus optional field constraints.

---

## `evaluation` (required)

| Field | Type | Required | Default | Values | Description |
|-------|------|----------|---------|--------|-------------|
| `grading_mode` | string | No | `"weighted"` | `"pass_fail"`, `"weighted"` | ⚠️ **Not yet implemented at runtime.** Intended: pass_fail = 100 or 0, weighted = sum of passing test points. Currently the LMS score is derived from points earned divided by total available points. |
| `max_score` | integer | No | `100` | `1`–`100` | ⚠️ **Not yet implemented at runtime.** Score is always reported as 0–100 percentage. |
| `feedback_on_all_pass` | string | No | — | — | Subtitle shown inside the green results header when every automated test passes |
| `require_previous_test_pass` | boolean | No | `true` | — | If `true`, tests run in list order and later tests stay locked until the previous test passes. Students see only the executed test feedback plus a generic “other tests remain unpassed” message. |
| `test_cases` | array | ✅ | — | Minimum 1 | Array of test case objects |

### Grading Modes

> ⚠️ **Not yet implemented at runtime.** Currently, the score is always calculated as a percentage derived from points earned divided by total available points.

**`weighted`** (default): Each test contributes its points to the score. If a student earns 6 out of 10 total points, they get 60/100.

**`pass_fail`**: Score is 100 if ALL tests pass, 0 if any test fails.

### Sequential test gating

When `require_previous_test_pass` is `true` (the default), tests run strictly in the order shown in the builder:

1. The first test always runs.
2. Each later test runs only if the previous test passed.
3. After the first failure, remaining tests do not run yet.
4. Students are told only that other tests remain unpassed — not how many tests are still locked.

### Test Cases

All test cases share these fields:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | ✅ | — | Unique test identifier |
| `type` | string | ✅ | — | `"stdout_match"`, `"block_structure"`, or `"variable_state"` |
| `points` | integer | ✅ | — | Integer points awarded when the test passes |
| `weight` | integer | Legacy | — | Legacy alias for `points`, still accepted on import |
| `feedback_on_pass` | string | No | — | Custom message shown when this test passes |
| `feedback_on_fail` | string | No | — | Custom message shown when this test fails |

See [Test Types](test-types.md) for type-specific fields.

**Example:**
```json
{
  "evaluation": {
    "grading_mode": "weighted",
    "max_score": 100,
    "require_previous_test_pass": true,
    "feedback_on_all_pass": "Excellent work — every automated check passed.",
    "test_cases": [
      {
        "id": "test_output",
        "type": "stdout_match",
        "output_assertion": {
          "enabled": true,
          "expected": "1\n2\n3\n",
          "match_mode": "exact"
        },
        "points": 6,
        "feedback_on_pass": "Great job — your output is exactly right.",
        "feedback_on_fail": "Expected output: 1, 2, 3 (each on a new line)"
      },
      {
        "id": "test_uses_loop",
        "type": "block_structure",
        "conditions": {
          "type": "block_exists",
          "block_type": "controls_for"
        },
        "points": 2,
        "feedback_on_fail": "Use a for-loop block"
      },
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
        "feedback_on_fail": "Put the print block inside the loop"
      },
      {
        "id": "test_prompt_message",
        "type": "block_structure",
        "conditions": {
          "type": "block_nested",
          "outer_type": "variables_set",
          "inner_type": "text",
          "input_name": "VALUE",
          "field_name": "TEXT",
          "expected_value": "Who.*\\?",
          "match_mode": "regex_search",
          "case_sensitive": false
        },
        "points": 2,
        "feedback_on_fail": "Use a prompt with the expected message."
      }
    ]
  }
}
```

---

## Complete Example

Here is a minimal but complete config:

```json
{
  "metadata": {
    "activity_id": "hello_world",
    "title": "Hello World"
  },
  "instructions": {
    "main": "Use the blocks to print 'Hello, World!'",
    "steps": [
      "Drag a print block onto the workspace",
      "Connect a text block with 'Hello, World!'",
      "Click Check"
    ]
  },
  "blockly_setup": {
    "toolbox": {
      "categories": [
        {
          "name": "Text",
          "colour": "#5CA68D",
          "blocks": ["text", "text_print"]
        }
      ]
    }
  },
  "evaluation": {
    "test_cases": [
      {
        "id": "test_hello",
        "type": "stdout_match",
        "output_assertion": {
          "enabled": true,
          "expected": "Hello, World!\n",
          "match_mode": "exact"
        },
        "points": 10,
        "feedback_on_pass": "Perfect — you printed Hello, World!",
        "feedback_on_fail": "Make sure you print exactly: Hello, World!"
      }
    ]
  }
}
```
