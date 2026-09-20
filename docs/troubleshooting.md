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
- Has at least one test worth more than 0 points

The error toast shows the specific validation error.

### Export SCORM produces a non-functional package

If the exported package is non-functional, first rebuild the builder/runtime assets and export again:

```bash
npm run build
# or, during authoring:
npm run dev
```

Then reopen the builder and export a fresh package. The builder export now includes the real `app.bundle.js`.

### `npm run dev` works, but the built static app behaves differently

This usually points to a **bundle-only** issue rather than a server issue. Check these first:

1. **Hard-refresh the built page** — Firefox can keep stale `dist/` assets cached longer than expected.
2. **Rebuild before serving**:
   ```bash
   npm run build
   ```
3. **Serve the built directory over HTTP** rather than opening `index.html` directly from `file://`.

The production build now keeps JavaScript symbol names stable while still minifying whitespace/syntax, which avoids Blockly procedure/toolbox regressions that can show up in Firefox-only static builds.

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

2. **Check the bundle** — `js/app.bundle.js` should be a full bundled runtime, not a tiny placeholder file. If it looks suspiciously small, rebuild and export again.

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

### Student work is not restored next session

The runtime saves the workspace in two layers — `cmi.suspend_data` (portable, 4096 characters by default) and this browser's IndexedDB (large, but per device) — and restores the newest complete snapshot. See [Student Progress Persistence](scorm-deployment.md#student-progress-persistence). If nothing is restored:

1. **Same attempt** — Moodle only keeps `suspend_data` for the current attempt; **Force new attempt** starts fresh
2. **Status-bar notice** — the runtime explains what happened instead of failing silently:
   - *"Your blocks are stored in this browser only — they are too large for the LMS to keep."* → the program exceeds the suspend data budget; it will still restore on this browser, and you can raise `ui_settings.suspend_data_limit` for an LMS that accepts more
   - *"This browser no longer has the saved copy of your blocks (storage was cleared, or you are on another device)."* → the IndexedDB copy was evicted, private browsing was used, or the student changed device; the `suspend_data` snapshot was also missing, so the starting blocks were loaded
   - *"The LMS did not store your blocks, so progress will not be restored next session."* → the LMS rejected the write entirely
   - *"Your blocks are too large to save, so progress will not be restored next session."* → the program exceeds the budget **and** the browser copy is unavailable (for example private browsing), so nothing could be kept
3. **Console** — `[WorkspacePersistence]` warnings report an LMS that truncated or altered a write (for example `LMS stored 4000 of 14667 characters; capping suspend data at 4000 characters`); the runtime lowers its own limit and keeps working
4. **Reset** — clicking **↺ Reset** discards both layers on purpose
5. **Activity id** — saved state is only restored when the stored `activity_id` matches the config in the package
6. **No LMS** — in preview mode (no SCORM API detected) nothing is stored; use Moodle or the builder preview with an LMS API present

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
   - `workspace_change` fires after meaningful Blockly edits such as moving, adding, deleting, or changing block fields
   - `test_fail` only fires after clicking "Check" and failing
3. **Check delay** — If `delay_seconds` is set, wait that long after the condition becomes true; the hint should now appear automatically once the delay elapses
4. **Check condition** — The condition must evaluate to true. Test with simple conditions first (e.g., `workspace_empty`)
5. **Check `show_once`** — If true and already consumed, the hint won't reappear

---

## Configuration Issues

### Tests all show 0 possible points

If every test is worth 0 points, grading cannot award any score.

- **Symptom**: Tests run, but the score never increases
- **Cause**: Every test's `points` value is 0

Fix: Adjust the point values in the Tests tab (or JSON) so at least one test awards points.

### `block_nested` condition not matching

Common issues with the `input_name` parameter:

| Block Type | Correct Input Names | Common Mistake |
|-----------|--------------------|-|
| `controls_for` | `FROM`, `TO`, `BY`, `DO` | Using `"BODY"` instead of `"DO"` |
| `controls_if` | `IF0`, `DO0`, `ELSE` | Using `"IF"` instead of `"IF0"` |
| `controls_repeat_ext` | `TIMES`, `DO` | Using `"BODY"` instead of `"DO"` |
| `text_print` | `TEXT` | Using `"VALUE"` instead of `"TEXT"` |
| `variables_set` | `VALUE` | Using `"TEXT"` instead of `"VALUE"` |

To find the correct input name, check the [Blockly block definitions](https://github.com/google/blockly/tree/master/blocks) or inspect a block in the browser console:

```javascript
// In the browser console (Activity Builder or SCORM preview):
const block = Blockly.getMainWorkspace().getBlocksByType('controls_for')[0];
console.log(block.inputList.map(i => i.name));
// → ["FROM", "TO", "BY", "DO"]
```

`block_nested` now searches the full subtree hanging off that input. For example, `variables_set.VALUE` can match either the directly attached `text_prompt_ext` block or the nested `text` block inside that prompt.

If you also fill in the optional descendant field/value controls, that value match is scoped to the matching descendants found in that subtree rather than unrelated blocks elsewhere in the workspace.

### `block_pattern` condition not matching

Check these first:

1. **Single root block** — the pattern workspace must have exactly one top-level root block
2. **Wildcard choice** — use **any block(s)** only for statement chains, and **any value** only for value inputs
3. **Scoped field constraints** — field constraints are tied to the selected pattern block, not applied workspace-wide
4. **Comparison mode** — choose carefully between exact, contains, regex full-match, and regex search
5. **Structure direction** — nested inputs and vertical `next` chains must be connected in the pattern exactly the way you want them matched
6. **Parameter count** — a **Match parameter count** constraint only exists on function definition and call blocks; it compares arity, so parameter names never need to match

### `block_field_value` not matching

Remember that comparison can be **exact**, **contains**, **regex full-match**, or **regex search**. Common pitfalls:

```json
// ❌ This won't match — field value is string "3", comparing to number 3
{ "expected_value": 3 }

// ✅ Use a string
{ "expected_value": "3" }
```

Both sides are converted to strings via `String()` in exact mode, so `3` and `"3"` should actually match. But if you're seeing mismatches, check:

1. The exact field name (case-sensitive)
2. The exact value (including whitespace)
3. That the block type is correct
4. Whether regex or contains mode is enabled when you meant to use an exact value
5. Whether `case_sensitive` should be `false`

For Blockly variable dropdown fields like `VAR`, the matcher uses the **variable name** shown in the block, not Blockly's generated internal variable id.

Regex full-match uses the whole field value. Regex search matches anywhere inside it. For example:

```json
{ "expected_value": "Who.*\\?", "match_mode": "regex_search", "case_sensitive": false }
```

matches `"Who's there?"`, but:

```json
{ "expected_value": "there", "match_mode": "regex_full" }
```

does **not**, because it is treated like `^(?:there)$`. Use `contains` or `regex_search` if you want a substring-style match.

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
