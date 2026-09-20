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
| [`block_nested`](#block_nested) | Block appears somewhere inside another block's input subtree, with optional scoped descendant value matching | `outer_type`, `inner_type`, `input_name`, `field_name?`, `expected_value?`, `match_mode?`, `regex_flags?` |
| [`block_pattern`](#block_pattern) | Visual Blockly pattern with wildcard blocks and scoped field constraints | `workspace_state`, `field_constraints?`, `param_constraints?` |
| [`block_field_value`](#block_field_value) | Block field matches a value or regex pattern | `block_type`, `field_name`, `expected_value`, `match_mode?`, `regex_flags?` |
| [`block_count`](#block_count) | Count of a block type is within range | `block_type`, `min`, `max` |
| [`workspace_connectedness`](#workspace_connectedness) | Enforce one connected program root or forbid loose value blocks | `mode` |
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

Passes if a block of `inner_type` appears anywhere inside a specific input subtree of an `outer_type` block. This covers direct value/argument connections, deeper nested value inputs, and statement chains.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `outer_type` | string | ✅ | The containing block type |
| `inner_type` | string | ✅ | The block type that should be inside |
| `input_name` | string | ✅ | The input name on the outer block (e.g., `"DO"`, `"TEXT"`, `"VALUE"`) |
| `field_name` | string | No | Field name on the matched descendant block |
| `expected_value` | any | No | Exact value, substring, or regex pattern for the matched descendant field |
| `match_mode` | string | No | `"exact"` (default), `"contains"`, `"regex_full"`, or `"regex_search"` |
| `case_sensitive` | boolean | No | `true` by default. Set `false` for case-insensitive exact/contains/regex checks |
| `regex_flags` | string | No | Extra JavaScript regex flags such as `"m"` or `"s"` (`"i"` is implied when `case_sensitive` is `false`) |

**How it works:**

For **value inputs** (e.g., `"VALUE"`, `"TEXT"`, `"IF"`): Checks the directly connected block and any blocks nested inside that connected block's own inputs.

For **statement inputs** (e.g., `"DO"`, `"ELSE"`): Traverses the entire chain of blocks connected inside the statement, following `getNextBlock()` links and nested child inputs.

If you also provide `field_name`, the match is scoped to the descendant blocks of `inner_type` found in that subtree — it does **not** scan unrelated blocks elsewhere in the workspace.

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

// A prompt block is attached to the VALUE input of a set-variable block
{
  "type": "block_nested",
  "outer_type": "variables_set",
  "inner_type": "text_prompt_ext",
  "input_name": "VALUE"
}

// A string literal is nested inside variables_set.VALUE through a text_prompt_ext block
{
  "type": "block_nested",
  "outer_type": "variables_set",
  "inner_type": "text",
  "input_name": "VALUE"
}

// The prompt message string inside name = input("Who's there?")
{
  "type": "block_nested",
  "outer_type": "text_prompt_ext",
  "inner_type": "text",
  "input_name": "TEXT"
}

// A prompt block inside variables_set.VALUE whose TEXT field matches a regex
{
  "type": "block_nested",
  "outer_type": "variables_set",
  "inner_type": "text",
  "input_name": "VALUE",
  "field_name": "TEXT",
  "expected_value": "Who.*\\?",
  "match_mode": "regex_search",
  "case_sensitive": false
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

Passes if any block of the specified type has a field whose value matches an exact value, contains a substring, or matches a regex pattern.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `block_type` | string | ✅ | Blockly block type ID |
| `field_name` | string | ✅ | Field name on the block (e.g., `"NUM"`, `"TEXT"`, `"OP"`, `"VAR"`) |
| `expected_value` | any | ✅ | Exact value, substring, or regex pattern |
| `match_mode` | string | No | `"exact"` (default), `"contains"`, `"regex_full"`, or `"regex_search"` |
| `case_sensitive` | boolean | No | `true` by default. Set `false` for case-insensitive matching |
| `regex_flags` | string | No | Extra JavaScript regex flags such as `"m"` or `"s"` (`"i"` is implied when `case_sensitive` is `false`) |

**How it works:** Iterates all blocks of the type, calls `block.getFieldValue(field_name)`, and then:
- compares `String(actual) === String(expected)` in exact mode
- checks `String(actual).includes(String(expected))` in contains mode
- applies `^(?:pattern)$` in `regex_full` mode
- applies a normal regex search in `regex_search` mode

For Blockly variable dropdown fields such as `variables_set.VAR`, matching uses the **visible variable name** (for example `name` or `score`) rather than Blockly's internal generated variable id.

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

// A text literal that starts with "Who" and ends with "?"
{
  "type": "block_field_value",
  "block_type": "text",
  "field_name": "TEXT",
  "expected_value": "Who.*\\?",
  "match_mode": "regex_search",
  "case_sensitive": false
}

// A math_arithmetic block uses addition
{
  "type": "block_field_value",
  "block_type": "math_arithmetic",
  "field_name": "OP",
  "expected_value": "ADD"
}
```

To assert a specific nested structure such as `name = input("Who's there?")`, combine conditions with `all`:

```json
{
  "type": "all",
  "conditions": [
    {
      "type": "block_nested",
      "outer_type": "variables_set",
      "inner_type": "text_prompt_ext",
      "input_name": "VALUE"
    },
    {
      "type": "block_field_value",
      "block_type": "text",
      "field_name": "TEXT",
      "expected_value": "Who's there\\?",
      "match_mode": "regex_full"
    }
  ]
}
```

If you want that check to stay scoped to the descendant under `variables_set.VALUE`, you can also express it as a single `block_nested` condition:

```json
{
  "type": "block_nested",
  "outer_type": "variables_set",
  "inner_type": "text",
  "input_name": "VALUE",
  "field_name": "TEXT",
  "expected_value": "Who's there\\?",
  "match_mode": "regex_full"
}
```

---

### `block_pattern`

Passes if the learner workspace matches a visually-authored Blockly pattern workspace.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace_state` | object | ✅ | Serialized Blockly workspace describing the pattern |
| `field_constraints` | object | No | Optional per-pattern-block field constraints, keyed by pattern block id then field name |
| `param_constraints` | object | No | Optional parameter count checks, keyed by pattern block id. Only valid on function blocks (`procedures_defnoreturn`, `procedures_defreturn`, `procedures_callnoreturn`, `procedures_callreturn`) |

**How it works:**

- The pattern workspace has exactly one root block
- Real Blockly blocks describe the required structure
- Special wildcard blocks fill flexible gaps:
  - **`any block(s)`** matches zero or more statement blocks in a chain
  - **`any value`** matches any subtree connected to a value input
- Optional field constraints are scoped to the exact matched pattern block instance
- Optional parameter count constraints check how many parameters a function definition (or arguments a call) has, without prescribing the names

This is the most expressive matcher when you need to combine:
- sequential `next` chains
- nested statement/value inputs
- wildcard gaps
- exact, contains, regex full-match, or regex search checks on a specific matched block
- function signatures by arity

**Examples:**

```json
// A visually-authored pattern matching: set variable -> prompt -> text("Who's there?")
{
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
}
```

```json
// Print anywhere inside a loop body using wildcard statement blocks before/after
{
  "type": "block_pattern",
  "workspace_state": { "...": "serialized Blockly pattern workspace with controls_repeat_ext -> any block(s) -> text_print -> any block(s)" }
}
```

```json
// Function definition with any name and exactly two parameters
{
  "type": "block_pattern",
  "workspace_state": { "...": "serialized pattern workspace with one procedures_defnoreturn block" },
  "param_constraints": {
    "procedure_block_id": { "count": 2, "comparison": "equals" }
  }
}
```

| `param_constraints` entry | Type | Description |
|---------------------------|------|-------------|
| `count` | integer | Parameter (or call argument) count to compare against |
| `comparison` | string | `"equals"` (default), `"gte"` (at least), or `"lte"` (at most) |

Parameter names stay free: the check counts the parameters of the matched student block, so a pattern authored with `(first, second)` also matches `(x, y)`. Combine with a `NAME` field constraint only when the function name must match too.

**Common field names:**

| Block Type | Field Name | Example Values |
|-----------|------------|---------------|
| `math_number` | `NUM` | `"0"`, `"42"`, `"3.14"` |
| `text` | `TEXT` | `"Hello"`, `""` |
| `variables_set` / `variables_get` | `VAR` | `"item"`, `"name"`, `"score"` |
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

### `workspace_connectedness`

Passes when the workspace satisfies one of two global connectedness rules.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | ✅ | `"all_connected"` or `"all_active"` |

#### Modes

- **`all_connected`** — the workspace must have **at most one top-level block root**. This rejects orphan statement stacks and loose value blocks.
- **`all_active`** — every top-level root must be an **active** block. This still allows multiple executable/definition roots, but rejects disconnected value-style blocks such as loose numbers, strings, list literals, or variable-get blocks.

This is useful when Blockly would otherwise ignore or separately run stray blocks that you want to treat as incorrect.

**Examples:**

```json
// Require one fully connected program with no orphan roots
{
  "type": "workspace_connectedness",
  "mode": "all_connected"
}

// Allow multiple top-level executable/definition roots, but no loose value blocks
{
  "type": "workspace_connectedness",
  "mode": "all_active"
}
```

**When not to use `all_connected`:**

Avoid `all_connected` for activities that intentionally need multiple top-level roots, such as separate procedure definitions or event-style entry blocks. In those cases, `all_active` is usually the better fit.

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
