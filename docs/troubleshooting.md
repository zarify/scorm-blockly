# Troubleshooting

Common issues and solutions when working with the Moodle Blockly SCORM project.

---

## Build Issues

### `npm run build` fails

**Error:** `Cannot find module 'esbuild'`

```bash
npm install
```

The dev dependencies need to be installed first.

**Error:** `ENOENT: no such file or directory`

Make sure you're running from the project root (where `package.json` is):

```bash
cd moodle-blockly-scorm
npm run build
```

### `npm run export` produces empty or invalid zip

Make sure to build before exporting:

```bash
npm run build     # ← Required first
npm run export
```

The export script reads from `dist/scorm-template/`, which is created by the build step.

---

## Activity Builder Issues

### Builder page is blank

Check the browser console (F12 → Console) for errors. Common causes:

- **JavaScript disabled** — The builder requires JavaScript
- **File protocol issues** — Some browsers restrict `file://` access. Use the dev server instead:
  ```bash
  npm run dev
  # Open http://localhost:3000
  ```

### Blockly workspace not appearing in Toolbox/Workspace tabs

Blockly workspaces need to be visible when initialised. If you switch tabs too quickly after loading, try:

1. Click to another tab
2. Click back to the Toolbox or Workspace tab
3. The workspace should resize and appear

### Import fails with "Invalid configuration"

Check that your JSON file:
- Is valid JSON (use a JSON validator)
- Has the required fields: `metadata.activity_id`, `metadata.title`, `blockly_setup.toolbox.categories`, `evaluation.test_cases`
- Has test weights that sum to 100

The error toast shows the specific validation error.

### Export SCORM produces a non-functional package

The builder's SCORM export includes a placeholder `app.bundle.js`. For functional packages, use the command-line workflow:

```bash
cp your-config.json src/scorm-template/config/activity_config.json
npm run build
npm run export
```

---

## SCORM / Moodle Issues

### Activity shows blank page in Moodle

1. **Check the zip structure** — Unzip and verify it contains:
   ```
   imsmanifest.xml
   index.html
   css/style.css
   js/app.bundle.js
   config/activity_config.json
   ```

2. **Check the bundle** — If `js/app.bundle.js` is a placeholder (< 1KB), rebuild:
   ```bash
   npm run build && npm run export
   ```

3. **Check browser console** — In Moodle, open the SCORM activity, then press F12 to check for JavaScript errors.

### Score not appearing in Moodle gradebook

1. **Check SCORM API detection** — Open browser console. You should see:
   - `SCORM API found` — Working correctly
   - `No SCORM API found — preview mode` — SCORM communication failed

2. **Check Moodle SCORM settings:**
   - **Display package** should be "New window" or "Current window" (not "embedded" with restrictive CSP)
   - **Force completed** should be disabled (let the activity report its own status)

3. **Check the SCORM report** — In Moodle, go to the SCORM activity → Reports → Overview. You should see attempt data.

4. **Multiple frames issue** — Moodle wraps SCORM content in iframes. The SCORM API search traverses up to 7 parent frames. If your Moodle setup uses more nesting, edit the frame search limit in `scorm-wrapper.js`.

### "Execution timed out" error

The student's code created an infinite loop. The 5-second timeout in the Web Worker caught it. This is expected behaviour — the student needs to fix their loop condition.

If legitimate code needs more than 5 seconds (unlikely for Blockly activities), adjust `EXECUTION_TIMEOUT_MS` in `test-runner.js`.

### Activity works locally but not in Moodle

Common differences between local preview and Moodle:

| Issue | Local | Moodle | Fix |
|-------|-------|--------|-----|
| **SCORM API** | Preview mode (console logs) | Real API calls | Ensure SCORM wrapper detects API |
| **iframe context** | Direct page load | Nested iframes | Check CSP headers, frame options |
| **File paths** | Relative to filesystem | Relative to SCORM package | All paths in the package are relative |
| **Browser popups** | Allowed | May be blocked | Configure Moodle SCORM display settings |

### Hints not appearing

1. **Check `show_hint_panel`** — Must be `true` (or omitted, defaults to true) in `ui_settings`
2. **Check trigger event** — Make sure the event matches what the student is doing:
   - `workspace_change` only fires when blocks are moved/added/deleted
   - `test_fail` only fires after clicking "Run Code" and failing
3. **Check delay** — If `delay_seconds` is set, wait that long after the condition becomes true
4. **Check condition** — The condition must evaluate to true. Test with simple conditions first (e.g., `workspace_empty`)
5. **Check `show_once`** — If true and already dismissed, the hint won't reappear

---

## Configuration Issues

### Test weights don't sum to 100

The validator warns about this but doesn't prevent it. Behaviour with incorrect weights:

- **Weights < 100**: Maximum achievable score is less than 100%
- **Weights > 100**: Score can exceed the expected maximum
- **All weights 0**: Every test reports 0 points regardless of pass/fail

Fix: Adjust weights in the Tests tab (or JSON) to sum to exactly 100.

### `block_nested` condition not matching

Common issues with the `input_name` parameter:

| Block Type | Correct Input Names | Common Mistake |
|-----------|--------------------|-|
| `controls_for` | `FROM`, `TO`, `BY`, `DO` | Using `"BODY"` instead of `"DO"` |
| `controls_if` | `IF0`, `DO0`, `ELSE` | Using `"IF"` instead of `"IF0"` |
| `controls_repeat_ext` | `TIMES`, `DO` | Using `"BODY"` instead of `"DO"` |
| `text_print` | `TEXT` | Using `"VALUE"` instead of `"TEXT"` |

To find the correct input name, check the [Blockly block definitions](https://github.com/google/blockly/tree/master/blocks) or inspect a block in the browser console:

```javascript
// In the browser console (Activity Builder or SCORM preview):
const block = Blockly.getMainWorkspace().getBlocksByType('controls_for')[0];
console.log(block.inputList.map(i => i.name));
// → ["FROM", "TO", "BY", "DO"]
```

### `block_field_value` not matching

Remember that comparison is **string-based**. Common pitfalls:

```json
// ❌ This won't match — field value is string "3", comparing to number 3
{ "expected_value": 3 }

// ✅ Use a string
{ "expected_value": "3" }
```

Both sides are converted to strings via `String()`, so `3` and `"3"` should actually match. But if you're seeing mismatches, check:

1. The exact field name (case-sensitive)
2. The exact value (including whitespace)
3. That the block type is correct

### Regex match not working in stdout_match

Common regex issues:

```json
// ❌ Single backslash is consumed by JSON parsing
{ "expected_output": "\d+" }

// ✅ Double-escape backslashes in JSON strings
{ "expected_output": "\\d+" }
```

Remember that JSON string parsing processes escape sequences first, then the resulting string is used as a regex pattern.

---

## Development Issues

### Dev server not reflecting changes

The esbuild dev server watches source files and rebuilds automatically. If changes aren't appearing:

1. Hard refresh the browser (`Ctrl/⌘ + Shift + R`)
2. Check the terminal — esbuild prints build errors if the rebuild fails
3. Make sure you're editing files in `src/`, not `dist/` (dist is regenerated on each build)

### Changes to shared modules not picked up

Shared modules (`src/shared/`) are imported by both the SCORM template and the builder. When you change a shared module:

- The **dev server** only rebuilds the builder target — SCORM template is not rebuilt
- Run `npm run build` to rebuild both targets

### Bundle too large

Both bundles include Blockly (~700KB). This is expected and necessary for SCORM packages (which must be self-contained). The total SCORM zip is ~200KB after compression.

If you need to reduce bundle size:
- Blockly's tree-shaking support is limited in IIFE format
- Consider importing only the generators you need (JavaScript only, not Dart/Python/Lua/PHP)
- The current setup already imports only what's needed

---

## Getting Help

If you encounter an issue not covered here:

1. **Check the browser console** — Most issues produce error messages
2. **Validate your config** — Import it in the Activity Builder to see validation errors
3. **Test in preview mode** — Open `dist/scorm-template/index.html` directly (no Moodle needed)
4. **Compare with examples** — The `examples/` directory has known-working configs
5. **Check the architecture docs** — [Architecture](architecture.md) explains the data flow and module relationships
