# Getting Started

Create your first Blockly activity for Moodle in under 10 minutes.

## Prerequisites

- **Node.js** 18 or later ([download](https://nodejs.org/))
- A modern browser (Chrome, Firefox, Edge, Safari)
- Moodle LMS with SCORM activity support (for deployment)

## 1. Install

```bash
git clone <repo-url> moodle-blockly-scorm
cd moodle-blockly-scorm
npm install
```

## 2. Build

```bash
npm run build
```

This produces two outputs in `dist/`:

| Output | Path | Description |
|--------|------|-------------|
| **SCORM Template** | `dist/scorm-template/` | The student-facing activity runtime |
| **Activity Builder** | `dist/activity-builder/` | The educator-facing authoring tool |

## 3. Open the Activity Builder

```bash
open dist/activity-builder/index.html
```

Or start the dev server for live reload:

```bash
npm run dev
# → http://localhost:3000
```

You'll see the builder interface with 6 tabs:

![Builder tabs: Config → Toolbox → Workspace → Hints → Tests → Preview](https://via.placeholder.com/800x50?text=Config+→+Toolbox+→+Workspace+→+Hints+→+Tests+→+Preview)

## 4. Configure Your Activity

### Config Tab

1. Enter a **title** (e.g., "Print Hello World")
2. Write **instructions** explaining what the student should do
3. Add **steps** for guidance (e.g., "1. Find the print block", "2. Drag it to the workspace")

### Toolbox Tab

1. Click **Add Category** to create a block category (e.g., "Text")
2. Pick a **colour** for the category
3. **Check the blocks** you want students to have (e.g., `text`, `text_print`)
4. The **live preview** on the right shows the toolbox as students will see it

### Tests Tab

1. Click **Add Test** to create a test case
2. Choose the **type**:
   - **stdout_match** — Check console output
   - **block_structure** — Check workspace block arrangement
   - **variable_state** — Check variable values after execution
3. Set the **points** for the test
4. Write **feedback** shown when the test fails

## 5. Export

### Export as JSON (for backup or sharing)

Click **💾 Export JSON** in the header. This downloads a `.json` config file you can import later.

### Export as SCORM Package (for Moodle)

**Option A — From the builder:**

Click **📦 Export SCORM** in the header. This creates a `.zip` with a placeholder JavaScript bundle. You'll need to replace it with the built bundle.

**Option B — From the command line (recommended):**

1. Save your config as JSON
2. Copy it to `src/scorm-template/config/activity_config.json`
3. Build and export:

```bash
npm run build
npm run export
```

This creates `dist/{activity_id}.zip` — a complete SCORM package ready for Moodle.

## 6. Upload to Moodle

1. In your Moodle course, click **Add an activity or resource**
2. Select **SCORM package**
3. Upload the `.zip` file
4. Set grading options (the activity reports scores 0–100)
5. Save and test

See [SCORM Deployment](scorm-deployment.md) for detailed Moodle configuration.

## 7. Test It

Open the activity as a student would. You should see:

- **Left panel**: Instructions and hints
- **Centre**: Blockly workspace with your configured toolbox
- **Right panel**: Output and generated code (if enabled)

Click **▶ Run Code** to execute and see test results.

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build both SCORM template and Activity Builder |
| `npm run build:scorm` | Build SCORM template only |
| `npm run build:builder` | Build Activity Builder only |
| `npm run export` | Create SCORM `.zip` from built template |
| `npm run dev` | Dev server with live rebuild (port 3000) |

## Next Steps

- [Activity Builder Guide](activity-builder-guide.md) — Detailed walkthrough of every feature
- [Config Reference](config-reference.md) — Full schema documentation
- [Example Walkthroughs](examples.md) — Learn from the included examples
