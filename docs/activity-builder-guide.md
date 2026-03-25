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
| **Show code toggle** | ✅ On | Let students see the generated JavaScript code |
| **Show hint panel** | ✅ On | Display the hints panel in the student UI |
| **Max attempts** | Unlimited | ⚠️ Not yet enforced at runtime. The field is in the schema for future use |

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
| **Variables** | `variables_get`, `variables_set` |
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

1. **Hint List** (left) — All configured hints
2. **Hint Editor** (right) — Edit the selected hint

### Creating a Hint

1. Click **+ Add Hint**
2. Set the **trigger event**:
   - **workspace_change** — When student modifies blocks (most common)
   - **test_fail** — After a failed test run
   - **manual** — When manually requested (⚠️ no UI button yet)
   - **timed** — After a time delay (⚠️ not yet implemented at runtime)
3. Write the **message** shown to the student
4. If using `workspace_change`, build a **condition** (see [Condition Reference](condition-reference.md))
5. Set optional timing:
   - **Priority** — Higher priority hints suppress lower ones
   - **Delay** — Seconds before the hint appears after condition is met
   - **After N fails** — Only show after this many failed test runs
   - **Show once** — Don't re-show after student dismisses it

### Progressive Hint Strategy

A good hint sequence escalates from vague to specific:

| Order | Priority | After Fails | Example |
|-------|----------|-------------|---------|
| 1st | 1 | 0 | "Think about which block repeats actions" |
| 2nd | 2 | 2 | "Try using a for-loop block from the Loops category" |
| 3rd | 3 | 4 | "Connect a for-loop with i from 1 to 3, then put a print block inside" |

Use `delay_seconds` on early hints to avoid showing them before the student has had a chance to try.

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
3. Set the **weight** (percentage of total score)
4. Configure type-specific fields
5. Write **feedback** shown when the test fails

### Weight System

- All weights must sum to **100%**
- The indicator at the bottom shows: ✅ green (100%), ⚠️ yellow (not 100%), ❌ red (all zero)
- In **weighted** grading mode, the score is the sum of passing test weights
- In **pass_fail** grading mode, the score is 100 if all tests pass, 0 otherwise

### Example Test Configuration

For a "print 1 to 3" activity:

| Test | Type | Weight | Purpose |
|------|------|--------|---------|
| Output check | `stdout_match` | 60% | Correct output "1\n2\n3\n" |
| Uses loop | `block_structure` | 20% | Has a loop block |
| Print in loop | `block_structure` | 20% | Print block nested inside loop |

---

## Tab 6: 👁️ Preview

Review a summary of your configured activity before exporting.

### What's Shown

- Activity title, description, and instructions
- Toolbox categories with block counts
- Hint messages
- Test cases with types and weights
- Raw JSON config (for debugging)

Click **Refresh Preview** to update after making changes.

> **Note**: The preview is a static summary — it doesn't render an interactive Blockly workspace. Use the actual SCORM package to test the full student experience.

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
