# Example Walkthroughs

The project includes three example activity configs in the `examples/` directory. Each demonstrates different features and progressively more complex configurations.

---

## 1. Hello World (`examples/hello-world.json`)

**Difficulty:** Beginner | **Concepts:** Text output, block composition

### What Students Do

Print the text "Hello, World!" using Blockly blocks.

### Configuration Highlights

**Toolbox:** One category with two blocks.

```json
{
  "categories": [
    {
      "name": "Text",
      "colour": "#5CA68D",
      "blocks": ["text", "text_print"]
    }
  ]
}
```

**Test:** Single stdout match for the exact output.

```json
{
  "id": "test_output",
  "type": "stdout_match",
  "expected_output": "Hello, World!\n",
  "match_mode": "exact",
  "weight": 100
}
```

**Hints:** Two progressive hints.

| Hint | Trigger | Delay | Message |
|------|---------|-------|---------|
| 1 | `block_missing: text_print` | 15s | "Start by dragging a print block onto the workspace" |
| 2 | `block_exists: text_print` + `block_missing: text` | 10s | "Now connect a text block to the print block" |

### What This Demonstrates

- **Minimal config** — Only the essential fields
- **Single test type** — Pure output matching
- **Condition-based hints** — Hints react to workspace state
- **Delay timing** — Hints don't appear immediately

### Solution

```
┌──────────────┐
│  text_print   │
│  ┌──────────┐│
│  │  text     ││ → "Hello, World!"
│  └──────────┘│
└──────────────┘
```

---

## 2. Loop Basics (`examples/loop-basics.json`)

**Difficulty:** Intermediate | **Concepts:** For-loops, iteration, block nesting

### What Students Do

Print the numbers 1, 2, and 3, each on a new line, using a loop.

### Configuration Highlights

**Toolbox:** Four categories giving students choice of approach.

```json
{
  "categories": [
    { "name": "Loops", "blocks": ["controls_for", "controls_repeat_ext", "controls_whileUntil"] },
    { "name": "Math", "blocks": ["math_number", "math_arithmetic"] },
    { "name": "Text", "blocks": ["text", "text_print"] },
    { "name": "Variables", "blocks": ["variables_get", "variables_set"] }
  ]
}
```

**Tests:** Mixed assessment with three weighted tests.

| Test | Type | Weight | What It Checks |
|------|------|--------|---------------|
| Output | `stdout_match` | 60% | Output is exactly `"1\n2\n3\n"` |
| Uses loop | `block_structure` | 20% | At least one loop block exists |
| Print in loop | `block_structure` | 20% | Print block is nested inside a loop's DO input |

```json
{
  "id": "test_print_in_loop",
  "type": "block_structure",
  "conditions": {
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
        "outer_type": "controls_repeat_ext",
        "inner_type": "text_print",
        "input_name": "DO"
      }
    ]
  },
  "weight": 20
}
```

Note the `any` composite — it accepts print inside either a `for` or a `repeat` loop.

**Hints:** Progressive escalation.

| Hint | Trigger | After Fails | Message |
|------|---------|-------------|---------|
| 1 | `workspace_change` + `block_missing` any loop | 0 | "You'll need a loop block to repeat the printing" |
| 2 | `test_fail` | 2 | "Make sure your loop counts from 1 to 3" |
| 3 | `test_fail` | 4 | Step-by-step solution guide |

### What This Demonstrates

- **Multiple test types** — Output check + structural checks
- **Weighted scoring** — Partial credit for structure even if output is wrong
- **Composite conditions** — `any` allows multiple valid approaches
- **Progressive hints** — Escalation based on failure count
- **Flexible toolbox** — Multiple loop types, student chooses

---

## 3. Variable Swap (`examples/variable-swap.json`)

**Difficulty:** Advanced | **Concepts:** Variables, assignment order, algorithmic thinking

### What Students Do

Swap the values of two variables `a` and `b` (starting as `a=5`, `b=10`) so that `a=10` and `b=5`.

### Configuration Highlights

**Starting blocks:** Pre-populated workspace with `a=5` and `b=10`.

```json
{
  "starting_blocks": {
    "blocks": {
      "blocks": [
        {
          "type": "variables_set",
          "fields": { "VAR": { "id": "var_a" } },
          "inputs": {
            "VALUE": {
              "block": { "type": "math_number", "fields": { "NUM": 5 } }
            }
          },
          "next": {
            "block": {
              "type": "variables_set",
              "fields": { "VAR": { "id": "var_b" } },
              "inputs": {
                "VALUE": {
                  "block": { "type": "math_number", "fields": { "NUM": 10 } }
                }
              }
            }
          }
        }
      ]
    }
  }
}
```

**Tests:** Variable state assertions.

> ⚠️ **Note:** The `variable_state` test type currently only captures the variable `count` at runtime. Tests for `a` and `b` in this example will not work until dynamic variable capture is implemented. This example demonstrates the intended configuration pattern.

| Test | Type | Weight | What It Checks |
|------|------|--------|---------------|
| a is 10 | `variable_state` | 35% | `a === 10` after execution |
| b is 5 | `variable_state` | 35% | `b === 5` after execution |
| Uses temp | `block_structure` | 30% | At least 5 `variables_set` blocks (implies temp variable) |

```json
{
  "id": "test_a_value",
  "type": "variable_state",
  "variable_name": "a",
  "expected_value": 10,
  "comparison": "equals",
  "weight": 35
}
```

**Hints:** Multi-level with timing and attempt gates.

| Hint | Trigger | Delay | After Fails | Message |
|------|---------|-------|-------------|---------|
| 1 | `workspace_change` | 15s | 0 | "Think about what happens if you set a = b first..." |
| 2 | `test_fail` | 0 | 2 | "The order of assignments matters. Consider a helper variable." |
| 3 | `test_fail` | 0 | 4 | Full solution walkthrough |

### What This Demonstrates

- **Starting blocks** — Pre-populated workspace for "fix this code" activities
- **Variable state tests** — Check internal variable values, not just output
- **Structural enforcement** — Require a specific number of blocks
- **Complex hint strategy** — Time-delayed + attempt-gated hints
- **Algorithmic thinking** — Tests understanding of assignment semantics

### Solution

```
┌───────────────────────┐
│ set temp = get a       │  (temp = 5)
├───────────────────────┤
│ set a = get b          │  (a = 10)
├───────────────────────┤
│ set b = get temp       │  (b = 5)
└───────────────────────┘
```

Students must realise they need a temporary variable to avoid losing a value during the swap.

---

## Using Examples

### Import into the Activity Builder

1. Open the Activity Builder
2. Click **📂 Import**
3. Select an example `.json` file
4. Explore and modify using the tabs

### Build a SCORM Package from an Example

```bash
# Copy example config
cp examples/loop-basics.json src/scorm-template/config/activity_config.json

# Build and export
npm run build
npm run export

# Result: dist/loop_basics.zip (ready for Moodle)
```

### Create Your Own

Use the examples as templates:

1. Copy an example JSON file
2. Modify the metadata, toolbox, tests, and hints
3. Import into the builder for visual editing
4. Export when ready

---

## Example Comparison

| Feature | Hello World | Loop Basics | Variable Swap |
|---------|:-----------:|:-----------:|:-------------:|
| Categories | 1 | 4 | 2 |
| Block types | 2 | 9 | 4 |
| Starting blocks | — | — | ✅ |
| Tests | 1 | 3 | 3 |
| Test types used | stdout | stdout + structure | variable + structure |
| Hints | 2 | 3 | 3 |
| Uses `after_attempts` | — | ✅ | ✅ |
| Uses `delay_seconds` | ✅ | — | ✅ |
| Composite conditions | — | ✅ (`any`) | — |
| Grading mode | pass_fail | weighted | weighted |
