# Moodle Blockly SCORM

Configurable Blockly-based SCORM 1.2 activity engine for Moodle, with a browser-based activity builder tool. Create block-coding activities for students without installing any Moodle plugins.

## Quick Start

```bash
npm install
npm run build
```

- **Activity Builder**: Open `dist/activity-builder/index.html` in your browser
- **SCORM Package**: Run `npm run export` to create a `.zip` for Moodle upload

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build both SCORM template and Activity Builder |
| `npm run build:scorm` | Build SCORM template only |
| `npm run build:builder` | Build Activity Builder only |
| `npm run export` | Create SCORM `.zip` from the built template |
| `npm run dev` | Dev server with live rebuild (port 3000) |
| `npm test` | Run the logic suite (Node's built-in runner, no dependencies) |
| `npm run test:browser` | Build and run the browser suite (Playwright) |

## Tests

```bash
npm test                                 # logic suite (450+ tests, ~1s)
npm run test:browser                     # browser suite (builds first)
node --test test/scorm-wrapper.test.js   # one file
```

### Logic suite (`test/`)

Runs on Node's built-in test runner with no test framework, no DOM emulation
and no network. Tests import `src/` directly, so nothing has to be built first.

```
test/
├── helpers/                  # shared fixtures
│   ├── lms.js                # fake Moodle-shaped SCORM 1.2 runtime (write rejection,
│   │                         #   truncation, commit snapshots, frame nesting)
│   ├── blockly.js            # real headless Blockly workspaces (no DOM needed)
│   ├── config.js             # minimal valid activity config + deep-merge overrides
│   └── fresh.js              # fresh module instance for module-scope session state
└── *.test.js                 # one file per module
```

What it is aimed at: the edges rather than the happy path. Legacy config shapes
and unknown keys, boundary values (size limits, score thresholds, empty and
oversized input), partial or malformed input, precedence between competing
fields, error paths that must not throw, and the cross-module contracts the
runtime depends on (a config that validates must also normalise, grade and
persist). Where behaviour is genuinely a contract — an LMS that rejects a write,
a returning student whose `passed` status must survive re-entry, a
`cmi.suspend_data` write that gets truncated — the fake LMS reproduces it.

### Browser suite (`test/browser/`)

Serves `dist/` and drives it with Playwright, for the parts that only exist in a
browser: `Blockly.inject`, the builder's tab rendering and import/export, and
the student runtime against a mock SCORM API (which it also uses to seed
`cmi.suspend_data` and check that a saved workspace comes back).

It uses the Chrome already on the machine and needs no download. To use
Playwright's own Chromium instead, run `npx playwright install chromium`; set
`PLAYWRIGHT_CHANNEL` to force a channel. When no browser can be launched the
browser tests skip rather than fail, so `npm test` stays usable anywhere.

Still not covered: the Web Worker execution path in `test-runner.js` and its
five-second timeout (Node has no `Worker`, so the logic suite exercises the
direct-execution fallback; the browser suite does not reach an infinite loop).

## Workflow

1. `npm run build` — build everything
2. Open `dist/activity-builder/index.html` in your browser
3. Use the tabbed interface to configure your activity:
   - **Config**: Set title, description, instructions
   - **Workspace**: Design the starter blocks (what students see when they open the activity)
   - **Toolbox**: Seed the student toolbox from the saved Workspace blocks, then rename categories, adjust colours, and choose which blocks students see
   - **Hints**: Create progressive hints triggered by workspace state or test failures, including visual block-pattern matchers
   - **Tests**: Define test cases (output matching, block structure checks, variable state, and function definition/call checks), including visual block-pattern matchers
   - **Preview**: Run the real student experience inside the builder to test blocks, hints, tests, and generated code before exporting
4. Click **Export JSON** to download the config, or **Export SCORM** to get a `.zip`
5. Upload the SCORM `.zip` to Moodle as a SCORM activity

The builder and student runtime automatically ignore toolbox block types that are not supported by the bundled Blockly version, which helps older configs keep working across Blockly upgrades.

## Project Structure

```
src/
├── shared/                    # Shared between SCORM engine and builder
│   ├── activity-config.schema.json   # JSON Schema for config validation
│   ├── workspace-inspector.js        # Block structure condition evaluator
│   ├── hint-evaluator.js             # Hint visibility logic
│   └── config-validator.js           # Config validation
├── scorm-template/            # Student-facing SCORM activity
│   ├── js/app.js              # Main orchestrator
│   ├── js/scorm-wrapper.js    # SCORM 1.2 API abstraction
│   ├── js/blockly-engine.js   # Blockly workspace management
│   ├── js/test-runner.js      # Code execution & assertion engine
│   └── js/hint-engine.js      # Real-time hint system
└── activity-builder/          # Browser-based authoring tool
    └── js/builder-app.js      # Tab management & config state

examples/                      # Example activity configs
├── hello-world.json           # Simplest: print text
├── loop-basics.json           # For-loops with progressive hints
└── variable-swap.json         # Variable manipulation with state tests
```

## Activity Config Schema

Each activity is defined by a single JSON config file (`activity_config.json`) with these sections:

- **metadata** — Activity ID, title, version, description
- **instructions** — Main instruction text + ordered steps
- **ui_settings** — Show/hide toggles and the suspend data limit
- **blockly_setup** — Toolbox categories/blocks, starter blocks, max blocks
- **hints** — Configurable hints triggered by workspace conditions or test results
- **evaluation** — Test cases with four assertion types

### Test Types

| Type | Checks | Example |
|------|--------|---------|
| `stdout_match` | Console output, prompt text, or both match expected text | "Prompt should be `Knock knock`" |
| `block_structure` | Workspace has required block patterns | "Must use a for-loop" |
| `variable_state` | Variable or list has the expected type/value after execution | "`count` should equal 3" |
| `function_state` | Function exists, has the expected parameter count, and/or returns the expected value | "`add_numbers(2, 3)` should return `5`" |

Tests award integer **points** rather than percentages. `stdout_match` and `variable_state` can provide ordered `prompt_inputs` for Blockly programs that use the input/prompt block, and prompt input matching stays strict there: missing or unused configured inputs fail the test explicitly. `stdout_match` can also scope prompt/output assertions to a specific function call after top-level setup runs. `function_state` ignores prompt-count mismatches and simply continues with default empty prompt responses when prompts occur.

When the student toolbox includes Blockly procedure call blocks, the **Functions** category now populates named call blocks automatically from the saved starter-workspace procedure definitions.

### Hint Triggers

| Event | Description |
|-------|-------------|
| `workspace_change` | Evaluates when student modifies blocks (debounced) |
| `test_fail` | Shown after failed test runs |
| `manual` | Student clicks "Get Hint" |

### Hint Conditions

Conditions inspect the Blockly workspace and support:
- `block_exists` / `block_missing` — Check if a block type is present
- `block_pattern` — Visual pattern workspace for arbitrary mixed sequences/subtrees with wildcard blocks
- `block_connected` — Two blocks are connected sequentially
- `block_nested` — Block appears somewhere inside another block's input subtree, optionally with a scoped descendant field/value constraint
- `block_field_value` — Block field has a specific value
- `block_count` — Count of a block type within a range
- `workspace_connectedness` — Require one connected program or reject loose disconnected value blocks
- `all` / `any` / `none` — Composite logic (AND / OR / NOT)

In the builder UI, `block_pattern` is now the preferred authoring path for connected/nested/value-matching structures; the older `block_connected`, `block_nested`, and `block_field_value` matchers remain supported mainly for backward compatibility.

## Architecture

The SCORM package runs entirely client-side in the student's browser. Code execution happens in a Web Worker with a 5-second timeout to prevent infinite loop freezes. Grades are reported to Moodle via the SCORM 1.2 API.

The Activity Builder is also fully client-side — no server needed. It bundles Blockly for visual workspace editing and exports configs as JSON or complete SCORM packages as `.zip` files.

## Limitations

- **Client-side grading**: Technically savvy students can inspect/modify scores. Use for formative assessment only.
- **Web Worker sandboxing**: Not a true security sandbox. Suitable for educational use.
- **SCORM 1.2**: Older standard but universally supported by Moodle. No xAPI/cmi5 support yet.
