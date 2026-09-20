# Architecture

Technical documentation for developers working on the Moodle Blockly SCORM project.

## System Overview

```
┌─────────────────────────────────────────────────────┐
│            Moodle LMS (SCORM Host)                  │
│  ┌───────────────────────────────────────────────┐  │
│  │  SCORM Package (.zip)                         │  │
│  │  ├── imsmanifest.xml                          │  │
│  │  ├── index.html                               │  │
│  │  ├── css/style.css                            │  │
│  │  ├── js/app.bundle.js    ← Bundled runtime    │  │
│  │  └── config/activity_config.json              │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         ↑ uploads .zip
         │
    ┌────┴────────────────────────────┐
    │   Activity Builder (Browser)     │
    │   ├── index.html                 │
    │   ├── css/builder.css            │
    │   └── js/builder.bundle.js       │
    │                                  │
    │   Exports: JSON config or        │
    │   SCORM .zip package             │
    └──────────────────────────────────┘
```

The project has two main deliverables:

1. **SCORM Template** — The student-facing runtime that loads inside Moodle
2. **Activity Builder** — The educator-facing tool for authoring activities

Both are static browser applications. No server is required.

---

## Module Dependency Graph

```
src/shared/
  ├── activity-config.schema.json    ← Schema definition (no runtime deps)
  ├── config-validator.js            ← Standalone (no imports)
  ├── workspace-inspector.js         ← Standalone (uses Blockly passed as arg)
  └── hint-evaluator.js              ← Imports workspace-inspector

src/scorm-template/js/
  ├── scorm-wrapper.js               ← Standalone (SCORM API detection)
  ├── blockly-engine.js              ← Imports blockly
  ├── workspace-state-codec.js       ← Standalone (suspend_data encoding)
  ├── workspace-persistence.js       ← Imports scorm-wrapper, codec (two-layer storage)
  ├── test-runner.js                 ← Imports workspace-inspector
  ├── hint-engine.js                 ← Imports hint-evaluator
  └── app.js                         ← Imports all above (entry point)

src/activity-builder/js/
  ├── builder-app.js                 ← Imports blockly (entry point)
  ├── list-reorder.js                ← Standalone (shared list drag-and-drop)
  ├── config-tab.js                  ← Imports builder-app
  ├── toolbox-tab.js                 ← Imports builder-app
  ├── workspace-tab.js               ← Imports builder-app
  ├── hints-tab.js                   ← Imports builder-app, list-reorder
  ├── tests-tab.js                   ← Imports builder-app, list-reorder
  ├── preview-tab.js                 ← Imports builder-app
  └── export.js                      ← Imports builder-app, config-validator, jszip
```

---

## Shared Modules

### `workspace-inspector.js`

**Purpose:** Evaluate structural conditions against a Blockly workspace.

**Key function:** `evaluateCondition(workspace, condition) → { passed: boolean, detail: string }`

Handles 11 condition types (8 atomic, 3 composite). Used by both the hint system and block_structure tests. Stateless — pure function with no side effects.

**Blockly dependency:** Receives the workspace as a parameter. Does not import Blockly directly — it calls `workspace.getAllBlocks()`, `block.getNextBlock()`, `block.getInput()`, and `block.getFieldValue()`.

### `hint-evaluator.js`

**Purpose:** Determine which hints should be visible given current state.

**Key function:** `evaluateHints(hints, workspace, state, event) → Array<{ id, message, priority }>`

Imports `evaluateCondition` from workspace-inspector. Manages hint state (active/consumed sets, delay timers, attempt counts).

### `config-validator.js`

**Purpose:** Validate activity configs without external schema libraries.

**Key function:** `validateConfig(config) → { valid: boolean, errors: Array<{ path, message }> }`

Hand-written validation rules matching the JSON Schema. Accumulates all errors (doesn't fail fast).

### `block-pattern.js`

**Purpose:** Visual pattern primitives shared by the builder, validator, and runtime.

**Key exports:** wildcard block types (`pattern_any_statement`, `pattern_any_value`), `getBlockParamCount(block)`, `matchesParamCountConstraint(count, constraint)`, and the parameter count comparison vocabulary (`equals`, `gte`, `lte`).

`getBlockParamCount` reads Blockly's own extra state, so it tracks mutator edits on function definitions and calls. Pattern conditions may therefore constrain arity via `param_constraints` without pinning parameter names.

---

## SCORM Template Architecture

### Initialisation Flow

```
app.js init()
  │
  ├── scorm-wrapper.init()
  │   └── Search parent frames for SCORM API (up to 7 levels + window.opener)
  │   └── If not found → preview mode (console logging)
  │
  ├── fetch('config/activity_config.json')
  │   └── Parse JSON → validate (optional)
  │
  ├── Render UI
  │   ├── renderInstructions() → title, main text, steps
  │   └── renderUISettings() → hide/show panels per config
  │
  ├── blockly-engine.initWorkspace()
  │   ├── Build toolbox from config categories
  │   ├── Blockly.inject() into DOM container
  │   ├── Load starting_blocks (if any) via Blockly.serialization
  │   └── Set maxBlocks (if configured)
  │
  ├── restoreSavedWorkspace()
  │   ├── persistence.restore() → newest of { suspend_data payload, IndexedDB record }
  │   ├── Blockly.serialization.workspaces.load() + cleanUp()
  │   ├── persistence.markCurrent() so load events do not trigger a redundant save
  │   └── Falls back to starting_blocks when nothing is stored or readable
  │
  ├── watchWorkspaceChanges()
  │   ├── workspace.addChangeListener() → debounce 1s → persistence.persist()
  │   ├── persist(): IndexedDB write, then suspend_data write (verified by read-back)
  │   └── unload/visibility flush: persistence.persistNow() (suspend_data only)
  │
  ├── hint-engine.initHintEngine()
  │   ├── Store hints config and workspace reference
  │   ├── Initialise hint state
  │   ├── Render checklist-style hints immediately (if any)
  │   └── workspace.addChangeListener() → debounced evaluation
  │
  └── Attach event handlers
      ├── btn-run → executeInteractiveRun() → updateUI()
      ├── btn-check → runTests() → reportScore() → updateUI()
      ├── btn-reset → clearWorkspace()
      ├── btn-code-toggle → show/hide generated JS
      ├── pagehide → persistence.persistNow(), then scorm.terminate()
      │   └── Skipped when the page only enters the back/forward cache
      └── pageshow (restored from bfcache) → scorm.resume()
```

### `workspace-state-codec.js`

**Purpose:** Encode a Blockly workspace state into SCORM 1.2 `cmi.suspend_data` (4096 characters per the data model) as an ASCII-only payload.

**Key functions:** `encodeWorkspaceState({ activityId, state, savedAt, limit })`, `encodeWorkspaceReference({ activityId, savedAt })`, `decodeWorkspacePayload({ payload, activityId })`

- Payload grammar: `BS1|<activity_id>|<format>|<saved_at base36>|<data>`, so state saved for a different activity is ignored
- Formats: `J` raw JSON and `C` compact JSON (block ids and coordinates stripped) are used only when the JSON is already ASCII; `B` (base64 of the compact JSON) and `L` (LZW + base64) are ASCII by construction and cover non-ASCII field values; `I` is a reference to state held in IndexedDB
- The shortest encoding that fits the configured limit wins; `null` means nothing fits
- Decoding is defensive: foreign, truncated, or malformed payloads return `null` and the runtime falls back to `starting_blocks`

### `workspace-persistence.js`

**Purpose:** Own the two persistence layers and their precedence.

**Key functions:** `createWorkspacePersistence({ activityId, studentId, limit, onWarning })` → `{ restore, persist, persistNow, markCurrent, discard, getEffectiveLimit, isIndexedDbAvailable }`

- `restore()` reads both layers and returns the newest complete snapshot plus an optional notice; `persist()` writes IndexedDB first, then `suspend_data`; `persistNow()` is the synchronous `suspend_data`-only path for unload handlers
- Every `suspend_data` write is read back and compared. A truncated or altered value lowers the working limit, restores the last good snapshot, and falls back to IndexedDB
- IndexedDB records are keyed `activity_id::student_id::path hash` and carry the state, a timestamp, and the learned limit
- All writes are serialised through one promise chain so a slow IndexedDB write cannot land out of order

### Code Execution Pipeline

```
Student clicks "Check"
  │
  ├── blockly-engine.generateCode()
  │   ├── Blockly JavaScript generator
  │   └── Prepend infinite loop trap
  │
  ├── test-runner.runTests(testCases, code, workspace)
  │   │
  │   ├── Check which tests need execution
  │   │   └── stdout_match, variable_state, or function_state → need execution
  │   │
  │   ├── executeCode(code) [if needed]
  │   │   ├── Create Web Worker from Blob
  │   │   ├── Worker patches console.log
  │   │   ├── Worker executes via new Function(code)()
  │   │   ├── Worker captures stdout + variables + functions/call results
  │   │   ├── Worker posts result back
  │   │   └── 5s timeout → terminate worker
  │   │
  │   ├── For each test case:
  │   │   ├── stdout_match → compare output string
  │   │   ├── block_structure → evaluateCondition(workspace, conditions)
  │   │   ├── variable_state → check variable from execution result
  │   │   └── function_state → check function existence / parameters / return value
  │   │
  │   └── Calculate totalScore / maxScore
  │
  ├── scorm-wrapper.reportScore(score)
  │   ├── LMSSetValue("cmi.core.score.raw", score)
  │   ├── LMSSetValue("cmi.core.lesson_status", passed/failed)
  │   └── LMSCommit()
  │
  ├── Update UI with results
  │   ├── Each test → pass/fail indicator + feedback
  │   └── Overall score display
  │
  └── hint-engine.onTestFail(failedCheckCount)
      └── Evaluate hints with 'test_fail' event
```

### Web Worker Communication

Grading runs the program in a Worker and kills it after 5 seconds:

```
Main Thread                          Web Worker (Blob)
──────────                           ──────────────────
  Create worker from Blob URL
  │
  worker.postMessage({ code })  →    onmessage:
  │                                    - Patch console.log
  Set 5s timeout                       - Execute new Function(code)()
  │                                    - Capture stdout array
  │                                    - Capture variables
  │                                    - postMessage(result)
  │                              ←
  worker.onmessage(result)
  │
  Clear timeout
  Terminate worker
```

An interactive Run uses the same Worker mechanism with no deadline, because the
student is part of the loop: output streams out as it is printed, an input prompt
is a message round-trip (`input` → `input-response`), and cancelling terminates
the Worker instead of waiting for the program to reach a print or a prompt. When
there is no Worker (Node, or a browser without one) the run falls back to the
main thread, where cancellation is cooperative and only takes effect at an I/O
point.

---

## Activity Builder Architecture

### State Management

```javascript
// Central state in builder-app.js
const state = {
  config: { ... },        // The activity config being built
  activeTab: 'config',
  changeListeners: []     // Notified on any config change
};
```

All tab modules import `getConfig()` and `notifyChange()` from `builder-app.js`. They modify the config object in place and call `notifyChange()` to trigger listeners.

### Tab Module Pattern

Each tab module follows this pattern:

```javascript
// tab-module.js
import { getConfig, notifyChange, onConfigChange } from './builder-app.js';

export function initTabName() {
  // 1. Get DOM elements
  // 2. Render initial state from getConfig()
  // 3. Attach event handlers that modify config + call notifyChange()
  // 4. Subscribe to config changes via onConfigChange() for external updates
}
```

### Tab Communication

```
builder-app.js (central state)
  │
  ├── config-tab.js      ─┐
  ├── toolbox-tab.js      │
  ├── workspace-tab.js    │── All read/write config via getConfig()
  ├── hints-tab.js        │   All notify via notifyChange()
  ├── tests-tab.js        │
  ├── preview-tab.js     ─┘
  │
  └── export.js ← Reads config for export, validates, generates files
```

### Condition Builder

Both `hints-tab.js` and `tests-tab.js` include inline condition builder UIs. These render a recursive form for building nested conditions:

```
┌─ Condition Type: [dropdown] ──────────────────────┐
│                                                     │
│  For atomic types: show type-specific fields        │
│  For composite types (all/any/none):                │
│    ┌─ Sub-condition 1 ─────────────────────────┐   │
│    │  [Nested condition builder]                │   │
│    └────────────────────────────────────────────┘   │
│    ┌─ Sub-condition 2 ─────────────────────────┐   │
│    │  [Nested condition builder]                │   │
│    └────────────────────────────────────────────┘   │
│    [+ Add Sub-condition]                            │
└─────────────────────────────────────────────────────┘
```

---

## Build System

### esbuild Configuration

Both targets use similar esbuild config:

```javascript
{
  entryPoints: ['src/{target}/js/{entry}.js'],
  bundle: true,
  outfile: 'dist/{target}/js/{output}.bundle.js',
  format: 'iife',
  globalName: '{GlobalName}',
  minify: true,
  target: 'es2020',
  sourcemap: false
}
```

| Target | Entry | Output | Global Name |
|--------|-------|--------|-------------|
| SCORM | `app.js` | `app.bundle.js` | `BlocklyScorm` |
| Builder | `builder-app.js` | `builder.bundle.js` | `ActivityBuilder` |

### Build Output

```
dist/
├── scorm-template/           # → Package into SCORM zip
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.bundle.js     # ~750KB (includes Blockly)
│   ├── config/activity_config.json
│   └── imsmanifest.xml
│
├── activity-builder/         # → Open directly in browser
│   ├── index.html
│   ├── css/builder.css
│   └── js/builder.bundle.js # ~890KB (includes Blockly)
│
└── {activity_id}.zip         # → Upload to Moodle
```

### Why Bundles Are Large

Both bundles include the full Blockly library (~700KB minified). This is intentional — SCORM packages must be self-contained with no external dependencies.

### Dev Server

`scripts/dev.js` uses esbuild's built-in serve:

```javascript
const ctx = await esbuild.context({ /* same config but with sourcemap: true */ });
await ctx.serve({ servedir: 'dist/activity-builder', port: 3000 });
```

Changes to source files trigger automatic rebuilds. Refresh the browser to see updates.

---

## Key Design Decisions

### Config-Driven Architecture

All activity behaviour comes from `activity_config.json`. The SCORM template is a generic engine — it doesn't know what activity it's running until it reads the config. This means:

- **One codebase, many activities** — Only the JSON changes per activity
- **No recompilation needed** — Swap the JSON, re-zip, upload
- **Validation at authoring time** — The builder validates configs before export

### Client-Side Only

Everything runs in the browser. No server-side components, no databases, no APIs beyond the SCORM 1.2 calls to Moodle. This was a deliberate choice:

- **No infrastructure** — Works anywhere Moodle is installed
- **No plugins** — Standard SCORM support is sufficient
- **Offline-capable** — Once loaded, no network calls needed
- **Privacy** — Student code never leaves their browser

### Web Worker Isolation

Student code executes in a Web Worker for two reasons:

1. **Timeout protection** — Infinite loops in the main thread would freeze the entire browser tab. Workers can be terminated after 5 seconds.
2. **Scope isolation** — Code runs in its own global scope, preventing interference with the application.

The Worker is created from a Blob URL (not a separate file) to avoid CORS issues in the SCORM context.

### SCORM 1.2 (Not 2004 or xAPI)

SCORM 1.2 was chosen because:

- **Universal Moodle support** — Every Moodle installation supports it
- **Simple API** — Only need `LMSInitialize`, `LMSSetValue`, `LMSCommit`, `LMSFinish`
- **Sufficient for grading** — Reports a numeric score and pass/fail status
- **Proven reliability** — Mature standard with predictable behaviour

The trade-off is limited data reporting (no detailed analytics or bookmarking).

### JSON Workspace Serialisation

Blockly v12 uses JSON for workspace serialisation (not the legacy XML format). The `starting_blocks` field in the config uses this format:

```json
{
  "blocks": {
    "blocks": [
      {
        "type": "text_print",
        "id": "abc123",
        "x": 10,
        "y": 10,
        "inputs": {
          "TEXT": {
            "block": {
              "type": "text",
              "fields": { "TEXT": "Hello" }
            }
          }
        }
      }
    ]
  }
}
```

---

## Security Considerations

### Client-Side Grading

Scores are calculated in the browser and reported via SCORM. A technically proficient student could:

- Modify the JavaScript to report a fake score
- Call the SCORM API directly from the browser console
- Inspect the config to see expected answers

**Mitigation:** Use this system for **formative assessment** and **practice activities** only. For high-stakes grading, use server-side evaluation.

### Code Execution

Student code runs via `new Function()` inside a Web Worker. This is **not a true sandbox**:

- The Worker has access to Web APIs (fetch, WebSocket, etc.)
- A determined student could make network calls or access browser storage

**Mitigation:** The educational context makes this acceptable. Students aren't motivated to escape the sandbox — they're learning to code.

### Config Exposure

The `activity_config.json` is bundled in the SCORM package and can be inspected by students. This means expected outputs, variable values, and hint conditions are visible.

**Mitigation:** This is inherent to client-side assessment. For activities where answer secrecy matters, don't put the answer in the config — use structural tests instead of output matching.

---

## Extending the Project

### Adding a New Condition Type

1. Define the condition in `activity-config.schema.json`
2. Add an evaluator function in `workspace-inspector.js`
3. Add it to the `evaluateCondition()` dispatch switch
4. Add validation rules in `config-validator.js`
5. Add UI for it in the condition builder (both `hints-tab.js` and `tests-tab.js`)

### Adding a New Test Type

1. Define the test case schema in `activity-config.schema.json`
2. Add an assertion function in `test-runner.js`
3. Add it to the `runTests()` dispatch logic
4. Add validation rules in `config-validator.js`
5. Add a type-specific editor in `tests-tab.js`

### Adding a New Hint Trigger

1. Add the event type to the schema's trigger event enum
2. Handle the event in `hint-evaluator.js`'s `shouldShowHint()`
3. Fire the event from the appropriate place in `app.js`
4. Add the trigger option in `hints-tab.js`'s trigger dropdown
