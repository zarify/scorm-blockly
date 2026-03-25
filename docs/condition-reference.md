# Condition Reference

Conditions are the building blocks for **hints** and **block structure tests**. They inspect the student's Blockly workspace and evaluate to `true` or `false`.

Conditions are used in two places:
- **Hints**: `hint.trigger.conditions` — determines when a hint should appear
- **Tests**: `test_case.conditions` (for `block_structure` type) — determines if a structural test passes

## Condition Types at a Glance

| Type | Purpose | Key Parameters |
|------|---------|---------------|
| [`block_exists`](#block_exists) | Block type is present | `block_type`, `min_count` |
| [`block_missing`](#block_missing) | Block type is absent | `block_type` |
| [`block_connected`](#block_connected) | Two blocks are snapped together vertically | `upper_type`, `lower_type` |
| [`block_nested`](#block_nested) | Block is inside another block's input | `outer_type`, `inner_type`, `input_name` |
| [`block_field_value`](#block_field_value) | Block field has a specific value | `block_type`, `field_name`, `expected_value` |
| [`block_count`](#block_count) | Count of a block type is within range | `block_type`, `min`, `max` |
| [`workspace_empty`](#workspace_empty) | Workspace has no blocks | — |
| [`all`](#all) | AND — all sub-conditions must pass | `conditions` |
| [`any`](#any) | OR — at least one sub-condition must pass | `conditions` |
| [`none`](#none) | NOR — all sub-conditions must fail | `conditions` |

---

## Atomic Conditions

### `block_exists`

Passes if the workspace contains at least `min_count` blocks of the specified type.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `block_type` | string | ✅ | — | Blockly block type ID (e.g., `"controls_for"`) |
| `min_count` | integer | No | `1` | Minimum number of blocks required (≥ 1) |

**Examples:**

```json
// At least one for-loop block
{
  "type": "block_exists",
  "block_type": "controls_for"
}

// At least 3 print blocks
{
  "type": "block_exists",
  "block_type": "text_print",
  "min_count": 3
}
```

---

### `block_missing`

Passes if the workspace contains **zero** blocks of the specified type.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `block_type` | string | ✅ | Blockly block type ID |

**Example:**

```json
// No while-loop blocks present
{
  "type": "block_missing",
  "block_type": "controls_whileUntil"
}
```

**Use case for hints:** Show a hint when the student hasn't yet added a required block:

```json
{
  "id": "hint_need_loop",
  "trigger": {
    "event": "workspace_change",
    "conditions": {
      "type": "block_missing",
      "block_type": "controls_for"
    }
  },
  "message": "Try using a for-loop from the Loops category."
}
```

---

### `block_connected`

Passes if any block of `upper_type` has a block of `lower_type` directly connected **below** it (i.e., snapped as the next statement).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `upper_type` | string | ✅ | Block type that should be on top |
| `lower_type` | string | ✅ | Block type that should be directly below |

**How it works:** Uses Blockly's `getNextBlock()` method — this checks the **next statement connection**, not value inputs or nested blocks.

```
┌──────────────┐
│  upper_type  │  ← This block
├──────────────┤
│  lower_type  │  ← Connected directly below (getNextBlock)
└──────────────┘
```

**Example:**

```json
// A variables_set block is directly above a text_print block
{
  "type": "block_connected",
  "upper_type": "variables_set",
  "lower_type": "text_print"
}
```

---

### `block_nested`

Passes if a block of `inner_type` is found inside a specific input of an `outer_type` block.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `outer_type` | string | ✅ | The containing block type |
| `inner_type` | string | ✅ | The block type that should be inside |
| `input_name` | string | ✅ | The input name on the outer block (e.g., `"DO"`, `"IF"`, `"VALUE"`) |

**How it works:**

For **value inputs** (e.g., `"VALUE"`, `"IF"`): Checks the directly connected block.

For **statement inputs** (e.g., `"DO"`, `"ELSE"`): Traverses the entire chain of blocks connected inside the statement, following `getNextBlock()` links.

```
┌───────────────────────────┐
│  controls_for             │
│  ┌─────────────────────┐  │
│  │ DO:                 │  │  ← Statement input "DO"
│  │  ┌───────────────┐  │  │
│  │  │  text_print    │  │  │  ← inner_type found!
│  │  └───────────────┘  │  │
│  └─────────────────────┘  │
└───────────────────────────┘
```

**Examples:**

```json
// Print block is inside a for-loop's DO input
{
  "type": "block_nested",
  "outer_type": "controls_for",
  "inner_type": "text_print",
  "input_name": "DO"
}

// A math_number is connected to the FROM input of a for-loop
{
  "type": "block_nested",
  "outer_type": "controls_for",
  "inner_type": "math_number",
  "input_name": "FROM"
}
```

**Common input names by block type:**

| Block Type | Input Names |
|-----------|-------------|
| `controls_if` | `IF0`, `DO0`, `IF1`, `DO1`, `ELSE` |
| `controls_for` | `FROM`, `TO`, `BY`, `DO` |
| `controls_forEach` | `LIST`, `DO` |
| `controls_repeat_ext` | `TIMES`, `DO` |
| `controls_whileUntil` | `BOOL`, `DO` |
| `text_print` | `TEXT` |
| `math_arithmetic` | `A`, `B` |
| `variables_set` | `VALUE` |

---

### `block_field_value`

Passes if any block of the specified type has a field with the expected value.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `block_type` | string | ✅ | Blockly block type ID |
| `field_name` | string | ✅ | Field name on the block (e.g., `"NUM"`, `"TEXT"`, `"OP"`, `"VAR"`) |
| `expected_value` | any | ✅ | Expected value (compared as strings via `String()` conversion) |

**How it works:** Iterates all blocks of the type, calls `block.getFieldValue(field_name)`, and compares `String(actual) === String(expected)`.

**Examples:**

```json
// A math_number block has value 3
{
  "type": "block_field_value",
  "block_type": "math_number",
  "field_name": "NUM",
  "expected_value": "3"
}

// A text block contains "Hello, World!"
{
  "type": "block_field_value",
  "block_type": "text",
  "field_name": "TEXT",
  "expected_value": "Hello, World!"
}

// A math_arithmetic block uses addition
{
  "type": "block_field_value",
  "block_type": "math_arithmetic",
  "field_name": "OP",
  "expected_value": "ADD"
}
```

**Common field names:**

| Block Type | Field Name | Example Values |
|-----------|------------|---------------|
| `math_number` | `NUM` | `"0"`, `"42"`, `"3.14"` |
| `text` | `TEXT` | `"Hello"`, `""` |
| `logic_boolean` | `BOOL` | `"TRUE"`, `"FALSE"` |
| `math_arithmetic` | `OP` | `"ADD"`, `"MINUS"`, `"MULTIPLY"`, `"DIVIDE"`, `"POWER"` |
| `logic_compare` | `OP` | `"EQ"`, `"NEQ"`, `"LT"`, `"LTE"`, `"GT"`, `"GTE"` |
| `logic_operation` | `OP` | `"AND"`, `"OR"` |
| `controls_whileUntil` | `MODE` | `"WHILE"`, `"UNTIL"` |
| `controls_flow_statements` | `FLOW` | `"BREAK"`, `"CONTINUE"` |

---

### `block_count`

Passes if the count of blocks of the specified type falls within the `[min, max]` range (inclusive).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `block_type` | string | ✅ | — | Blockly block type ID |
| `min` | integer | No | `0` | Minimum count (≥ 0) |
| `max` | integer | No | `Infinity` | Maximum count (≥ 0) |

**Examples:**

```json
// Exactly 2 print blocks
{
  "type": "block_count",
  "block_type": "text_print",
  "min": 2,
  "max": 2
}

// At most 1 loop block (including 0)
{
  "type": "block_count",
  "block_type": "controls_for",
  "min": 0,
  "max": 1
}

// At least 3 variable_set blocks (no upper limit)
{
  "type": "block_count",
  "block_type": "variables_set",
  "min": 3
}
```

---

### `workspace_empty`

Passes if the workspace contains **zero** blocks.

No parameters needed.

```json
{
  "type": "workspace_empty"
}
```

**Use case for hints:** Detect when a student hasn't started yet:

```json
{
  "id": "hint_get_started",
  "trigger": {
    "event": "workspace_change",
    "conditions": { "type": "workspace_empty" }
  },
  "message": "Start by dragging some blocks from the toolbox on the left.",
  "delay_seconds": 10
}
```

---

## Composite Conditions

Composite conditions combine other conditions using boolean logic. They can be nested to any depth.

### `all`

**AND logic** — Passes only if **every** sub-condition passes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `conditions` | array of conditions | ✅ | At least 1 sub-condition |

**Example:**

```json
// Student has BOTH a for-loop AND a print block
{
  "type": "all",
  "conditions": [
    { "type": "block_exists", "block_type": "controls_for" },
    { "type": "block_exists", "block_type": "text_print" }
  ]
}
```

---

### `any`

**OR logic** — Passes if **at least one** sub-condition passes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `conditions` | array of conditions | ✅ | At least 1 sub-condition |

**Example:**

```json
// Student uses EITHER a for-loop OR a while-loop
{
  "type": "any",
  "conditions": [
    { "type": "block_exists", "block_type": "controls_for" },
    { "type": "block_exists", "block_type": "controls_whileUntil" },
    { "type": "block_exists", "block_type": "controls_repeat_ext" }
  ]
}
```

---

### `none`

**NOR logic** — Passes only if **all** sub-conditions fail.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `conditions` | array of conditions | ✅ | At least 1 sub-condition |

**Example:**

```json
// Student is NOT using any forbidden blocks
{
  "type": "none",
  "conditions": [
    { "type": "block_exists", "block_type": "controls_flow_statements" },
    { "type": "block_exists", "block_type": "procedures_defnoreturn" }
  ]
}
```

---

## Nesting Composites

Composite conditions can contain other composites for complex logic:

```json
// Has a loop AND (print inside loop OR variable set inside loop)
{
  "type": "all",
  "conditions": [
    {
      "type": "block_exists",
      "block_type": "controls_for"
    },
    {
      "type": "any",
      "conditions": [
        {
          "type": "block_nested",
          "outer_type": "controls_for",
          "inner_type": "text_print",
          "input_name": "DO"
        },
        {
          "type": "block_nested",
          "outer_type": "controls_for",
          "inner_type": "variables_set",
          "input_name": "DO"
        }
      ]
    }
  ]
}
```

---

## Evaluation Details

Every condition evaluator returns an object:

```javascript
{
  passed: boolean,   // Whether the condition is met
  detail: string     // Human-readable explanation (useful for debugging)
}
```

Example detail messages:
- `"Found 2 controls_for block(s) (need >= 1)"`
- `"No text_print blocks found"`
- `"text_print is nested inside controls_for.DO"`
- `"ALL: 3/3 passed"`
- `"ANY: 1/2 passed"`

These detail strings appear in test result debugging output but are not shown to students.
