# Activity Builder Guide

The Activity Builder is a browser-based tool for creating Blockly activities without editing JSON by hand. It runs entirely client-side — no server required.

## Opening the Builder

```bash
# Option 1: Open the built file directly
npm run build
open dist/activity-builder/index.html

# Option 2: Use the dev server (recommended during authoring)
npm run dev
# → http://localhost:3000
```

## Interface Overview

The builder has a **header bar** with import/export buttons, a **tab navigation bar**, and a **main content area** that changes per tab.

### Header Actions

| Button | Action |
|--------|--------|
| **📂 Import** | Load an existing `activity_config.json` file |
| **💾 Export JSON** | Download the current config as JSON |
| **📦 Export SCORM** | Download a SCORM `.zip` package |

---

## Tab 1: ⚙️ Config

Set the activity metadata, student instructions, and UI settings.

### Activity Metadata

| Field | Description | Required |
|-------|-------------|----------|
| **Title** | Display name shown to students | ✅ |
| **Activity ID** | Auto-generated from title (lowercase, underscores) | Auto |
| **Version** | Config version for your tracking | No |
| **Description** | Brief description of the activity | No |

### Instructions

| Field | Description |
|-------|-------------|
| **Main Instruction** | Primary text shown at the top of the instructions panel |
| **Steps** | Ordered list of guidance steps. Click **+ Add Step** to add more. Click **✕** to remove. |

### UI Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Show code toggle** | Off | Let students open the generated JavaScript code modal |
| **Enable hints** | ✅ On | Enable student-facing hints in the runtime |
| **Max attempts** | Unlimited | ⚠️ Not yet enforced at runtime. The field is in the schema for future use |
| **Suspend data limit** | 4096 | Characters reserved for saved student work in `cmi.suspend_data`. SCORM 1.2 specifies 4096; raise it only for an LMS known to accept more. Larger programs are also kept in the student's browser via IndexedDB, and each LMS write is verified |

### Results

| Setting | Default | Description |
|---------|---------|-------------|
| **Require each test to pass before the next test runs** | ✅ On | Runs tests in order, stops after the first failure, and hides how many later tests are still locked |
| **All tests passed subtitle** | Blank | Optional success message shown under the heading when every automated check passes |

---

## Tab 2: 🧰 Toolbox

Define which blocks students have available. This is the palette of blocks on the left side of the Blockly workspace.

### Three-Panel Layout

1. **Category List** (left) — Your categories with colours
2. **Block Picker** (centre) — Checkbox list of available blocks
3. **Live Preview** (right) — What the toolbox looks like

### Adding a Category

1. Click **+ Add Category**
2. Enter a name (e.g., "Loops", "Text", "Variables")
3. Pick a colour using the colour picker
4. The category appears in the list

### Adding Blocks to a Category

1. Select a category from the list
2. In the centre panel, browse or **search** for block types
3. Check the blocks you want to include

### Available Block Library

The builder includes all standard Blockly blocks, organised into groups:

| Group | Example Blocks |
|-------|---------------|
| **Logic** | `controls_if`, `controls_ifelse`, `logic_compare`, `logic_operation`, `logic_negate`, `logic_boolean` |
| **Loops** | `controls_repeat_ext`, `controls_for`, `controls_forEach`, `controls_whileUntil`, `controls_flow_statements` |
| **Math** | `math_number`, `math_arithmetic`, `math_modulo`, `math_round`, `math_random_int` |
| **Text** | `text`, `text_print`, `text_join`, `text_length`, `text_isEmpty`, `text_charAt` |
| **Lists** | `lists_create_with`, `lists_length`, `lists_isEmpty`, `lists_indexOf`, `lists_getIndex`, `lists_setIndex` |
| **Variables** | `variables_get`, `variables_set`, `math_change` |
| **Functions** | `procedures_defnoreturn`, `procedures_defreturn`, `procedures_callnoreturn`, `procedures_callreturn` |

### Tips

- Keep the toolbox **minimal** — only include blocks relevant to the learning objective
- Use category **colours** to help students identify related blocks
- The **live preview** updates as you make changes — check it looks right

---

## Tab 3: 🏗️ Workspace

Design the starter blocks that appear when a student opens the activity. This is optional — leave it empty for a blank workspace.

### How It Works

You get a full Blockly workspace with **all** standard blocks available (not just the restricted toolbox). Arrange blocks the way you want students to start.

### Common Patterns

| Pattern | When to Use |
|---------|-------------|
| **Empty workspace** | Student builds everything from scratch |
| **Partial solution** | Give scaffolding; student fills in the blanks |
| **Broken code** | Student debugs by rearranging/fixing blocks |
| **Template** | Pre-connected blocks with empty fields to fill in |

### Saving

Click **Save Starting Blocks** to capture the current workspace state. The status indicator shows:
- Block count
- Whether changes are saved

Click **Clear** to reset to an empty workspace (sets `starting_blocks` to `null`).

---

## Tab 4: 💡 Hints

Create contextual hints that appear as students work. See [Hint System](hint-system.md) for the full reference.

### Two-Panel Layout

1. **Hint List** (left) — All configured hints, each showing its priority
2. **Hint Editor** (right) — Edit the selected hint

Hints can be **drag-and-dropped** in the list to change their order, exactly like test cases. The list order is the tie-break for hints that share the same priority.

### Creating a Hint

1. Click **+ Add Hint**
2. Set the **trigger event**:
   - **workspace_change** — When student modifies blocks (most common)
   - **test_fail** — After a failed test run
   - **manual** — When manually requested with the **💡 Get Hint** button
   - **timed** — After a time delay (⚠️ not yet implemented at runtime)
3. Write the **message** shown to the student
4. Choose the **display mode**:
   - **Hidden until triggered** — The hint stays hidden until it fires
   - **Always visible checklist item** — The hint stays in the sidebar and ticks off once triggered
   - Checklist items work best for completion milestones such as “loop added” or “pattern matched”
5. If using `workspace_change`, build a **condition** (see [Condition Reference](condition-reference.md))
   - For nested structures, **Outer block input name** refers to the parent block input where the whole subtree is plugged in
   - You can optionally add a **matched descendant field/value** constraint to keep the value check scoped to that nested subtree
   - For more complex shapes, choose **Visual block pattern** and build the match with real Blockly blocks plus wildcard pattern blocks
6. Set optional timing:
   - **Priority** — Higher priority hints suppress lower ones
   - **Delay** — Seconds before the hint appears after condition is met
   - **After N fails** — Only show after this many failed test runs
   - **Show once** — Let the hint be used only once

### Progressive Hint Strategy

A good hint sequence escalates from vague to specific:

| Order | Priority | After Fails | Example |
|-------|----------|-------------|---------|
| 1st | 1 | 0 | "Think about which block repeats actions" |
| 2nd | 2 | 2 | "Try using a for-loop block from the Loops category" |
| 3rd | 3 | 4 | "Connect a for-loop with i from 1 to 3, then put a print block inside" |

Use `delay_seconds` on early hints to avoid showing them before the student has had a chance to try.
Workspace-change hints are evaluated automatically after Blockly edits, and delayed hints now appear once the delay elapses even if the student stops dragging blocks.
Only `manual` hints control the **💡 Get Hint** button. If no manual hints exist it stays hidden; if manual hints exist but are not yet eligible it stays disabled. A `show_once` manual hint stops counting toward that button after it has been used.

### Visual Block Patterns

For conditions that are awkward to express with simple predicates, use **Visual block pattern**:

- Build a pattern with real Blockly blocks in the pattern workspace
- Add **any block(s)** to match gaps in a statement chain
- Add **any value** to match any value subtree
- Select a block in the pattern workspace to add optional exact, contains, regex full-match, or regex search field constraints
- For function blocks, tick **Match parameter count** to check how many parameters the student's function takes (exactly / at least / at most) without prescribing the parameter names

The authoring UI now treats **Visual block pattern** as the primary way to express:
- sequential block connections
- nested block-subtree checks
- block field/value matching within a structure

Older configs using those individual predicate types still load and remain editable as **legacy** options.

This is the recommended approach for patterns such as:
- `set variable -> prompt -> text("Who's there?")`
- `print` anywhere inside a loop body
- longer mixed chains that combine `next` links and nested inputs

---

## Tab 5: ✅ Tests

Define how student work is evaluated. See [Test Types](test-types.md) for full details.

### Two-Panel Layout

1. **Test List** (left) — All test cases
2. **Test Editor** (right) — Edit the selected test

### Creating a Test

1. Click **+ Add Test**
2. Choose the **type**:
   - **stdout_match** — Check `console.log` output
   - **block_structure** — Check workspace block arrangement
   - **variable_state** — Check variable values after code execution
   - **function_state** — Check that a function exists, has the right parameters, and returns the expected value
3. Set the **points** awarded for passing the test
4. Configure type-specific fields. `stdout_match` and `variable_state` support `prompt_inputs` when the program uses the input block, and output checks can also switch the execution scope from the whole main program to a specific function call. Missing or unused configured inputs fail the test explicitly only for the test types that expose that setting
5. Write **feedback** shown when the test fails

If the student toolbox includes function call blocks, the **Functions** category populates named call blocks automatically from the saved **Workspace** procedure definitions.

### Points System

- Points can be any non-negative integers
- The indicator at the bottom shows the total points available across all tests
- In **weighted** grading mode, the score is the sum of passing test points
- In **pass_fail** grading mode, the score is 100 if all tests pass, 0 otherwise
- For `block_structure` tests, the editor suggests block types from the saved Workspace and configured toolbox so you do not need to memorize Blockly block IDs

### Example Test Configuration

For a "print 1 to 3" activity:

| Test | Type | Points | Purpose |
|------|------|--------|---------|
| Output check | `stdout_match` | 6 | Correct output "1\n2\n3\n" |
| Uses loop | `block_structure` | 2 | Has a loop block |
| Print in loop | `block_structure` | 2 | Print block nested inside loop |

---

## Tab 6: 👁️ Preview

Run the full student runtime with your current config before exporting.

### What You Can Test

- The real Blockly workspace and restricted student toolbox
- Starter blocks saved from the **Workspace** tab
- Live program execution via **▶ Run Code**, including the in-app interactive console for printed output and typed input
- Automated test execution and scoring via **✓ Check**
- Manual and automatic hints via **💡 Get Hint** and failed checks
- Generated JavaScript via **{ } Show Code**

Click **Reload Preview** to restart the student runtime with your latest config.

> **Note**: The preview uses the same client-side runtime as the exported package, but it still runs without an LMS connection. SCORM score reporting is simulated locally.

When you click **▶ Run Code**, the activity opens the learner's interactive console so stdout appears as the program runs and any prompt/input requests are answered inline. When you click **✓ Check**, it runs the configured automated checks and scores the result using each test case's configured runtime settings, including `prompt_inputs` where that test type supports them.
Run and check results open in a modal so the Blockly workspace keeps the full horizontal space until needed.

---

## Import / Export Workflow

### Saving Your Work

Click **💾 Export JSON** regularly to save your progress. The JSON file contains the complete activity configuration and can be re-imported at any time.

### Importing a Config

1. Click **📂 Import**
2. Select a `.json` config file
3. The builder validates the config and loads it into all tabs
4. If validation fails, you'll see an error toast with details

### Creating a SCORM Package

**Recommended workflow:**

1. Export your config as JSON
2. Copy the JSON to `src/scorm-template/config/activity_config.json`
3. Run:

```bash
npm run build
npm run export
```

This produces `dist/{activity_id}.zip` with the full Blockly runtime bundled.

---

## Keyboard Shortcuts

The builder uses standard Blockly keyboard shortcuts in the Workspace and Toolbox preview panels:

| Shortcut | Action |
|----------|--------|
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Shift + Z` | Redo |
| `Ctrl/⌘ + C` | Copy block |
| `Ctrl/⌘ + V` | Paste block |
| `Delete` / `Backspace` | Delete selected block |
