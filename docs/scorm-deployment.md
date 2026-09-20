# SCORM Deployment Guide

How to deploy Blockly activities to Moodle as SCORM packages.

## Creating a SCORM Package

### Method 1: Command Line (Recommended)

1. Place your activity config at `src/scorm-template/config/activity_config.json`
2. Build and export:

```bash
npm run build
npm run export
```

3. The SCORM package is created at `dist/{activity_id}.zip`

This produces a fully functional SCORM 1.2 package with the Blockly runtime bundled.

### Method 2: Activity Builder Export

1. Open the Activity Builder and configure your activity
2. Click **📦 Export SCORM**
3. Download the `.zip` file

This produces a functional SCORM package with the bundled student runtime included. The command-line method is still useful when you want a repeatable repo-based build artifact.

---

## Uploading to Moodle

### Step 1: Add SCORM Activity

1. In your Moodle course, turn **editing on**
2. Click **Add an activity or resource**
3. Select **SCORM package**

### Step 2: Upload Package

1. In the **Package file** section, upload your `.zip` file
2. Moodle will validate the SCORM manifest

### Step 3: Configure Settings

#### General Settings

| Setting | Recommended Value | Notes |
|---------|-------------------|-------|
| **Name** | Your activity title | Shown in the course page |
| **Description** | Activity description | Shown before launch |

#### Grade Settings

| Setting | Recommended Value | Notes |
|---------|-------------------|-------|
| **Grading method** | Highest grade | Students may attempt multiple times |
| **Maximum grade** | 100 | Matches the 0–100 percentage the runtime reports |

#### Attempts Settings

| Setting | Recommended Value | Notes |
|---------|-------------------|-------|
| **Number of attempts** | Unlimited | Let students retry |
| **Force new attempt** | No | Student continues previous attempt |

#### Appearance Settings

| Setting | Recommended Value | Notes |
|---------|-------------------|-------|
| **Display package** | New window | Avoids Moodle navigation interference |
| **Width** | 100% | Full width for workspace |
| **Height** | 100% | Full height for workspace |
| **Skip content structure page** | Always | Go straight to the activity |

### Step 4: Save and Test

1. Click **Save and display**
2. Click the activity as a student would
3. Verify:
   - [ ] Blockly workspace loads with correct toolbox
   - [ ] Instructions display correctly
   - [ ] Starter blocks appear (if configured)
   - [ ] "Run Code" executes the learner program
   - [ ] "Check" runs automated tests and reports a score
   - [ ] Score reports to Moodle gradebook
   - [ ] Hints appear as expected

---

## SCORM 1.2 Details

### Manifest Structure

The `imsmanifest.xml` declares a single SCO (Sharable Content Object):

```xml
<manifest identifier="blockly_scorm_activity" version="1.0">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="blockly_org">
    <organization identifier="blockly_org">
      <title>Blockly Coding Activity</title>
      <item identifierref="blockly_resource">
        <adlcp:masteryscore>50</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="blockly_resource" type="webcontent"
              adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="css/style.css"/>
      <file href="js/app.bundle.js"/>
      <file href="config/activity_config.json"/>
    </resource>
  </resources>
</manifest>
```

### SCORM API Communication

The activity communicates with Moodle via these SCORM 1.2 API calls:

| Call | When | Purpose |
|------|------|---------|
| `LMSInitialize("")` | Activity loads | Start SCORM session |
| `LMSGetValue("cmi.core.lesson_status")` | Activity loads | Keep an existing passed/failed/completed status on re-entry |
| `LMSGetValue("cmi.core.student_id")` | Activity loads | Scope the browser-side (IndexedDB) copy to one student |
| `LMSGetValue("cmi.suspend_data")` | Activity loads | Restore the student's saved workspace |
| `LMSSetValue("cmi.suspend_data", payload)` | ~1s after the student edits, on Check, on tab hide, and on unload | Save the student's workspace |
| `LMSGetValue("cmi.suspend_data")` | Immediately after each suspend data write | Read the value back to verify the LMS stored it intact; a truncated or altered value lowers the working limit and falls back to IndexedDB |
| `LMSSetValue("cmi.core.score.raw", score)` | After test run | Report score (0–100) |
| `LMSSetValue("cmi.core.lesson_status", status)` | After test run | Report "passed" or "failed" |
| `LMSCommit("")` | At most once per 10 s while editing, immediately on Check / tab hide / leaving | Save the pending values. A commit is a blocking round-trip in Moodle, so background saves are coalesced; a score and its status share one commit |
| `LMSFinish("")` | Page hidden for good (`pagehide` without `persisted`) | End SCORM session; skipped when the page only enters the back/forward cache |
| `LMSInitialize("")` | `pageshow` after a back/forward cache restore | Re-open a session that was finished before the page was cached, so later writes are not dropped |

### Student Progress Persistence

Student workspaces are stored in two layers so a session can survive both a changed device and a large program:

| Layer | Scope | Limit | Used for |
|-------|-------|-------|----------|
| `cmi.suspend_data` | Per student attempt, portable across devices, visible in LMS reports | 4096 characters by default (SCORM 1.2 SPM) | The primary record: the newest snapshot that fits |
| IndexedDB (Moodle origin) | Per browser and device, not visible to the LMS | Effectively unlimited | Full-fidelity copy, and the only copy when the workspace is too large for `suspend_data` |

Behaviour:

- Saving is debounced by one second after the last workspace change, and is also flushed on **Check**, on tab hide (`visibilitychange`), and on `pagehide`; the SCORM session is finished on `pagehide` only (never on `beforeunload`), so a back/forward cache restore keeps reporting, and `pageshow` re-opens the session when it was already finished
- Saving never runs in the middle of a gesture, and the LMS commit behind it is coalesced to at most one per 10 seconds: in Moodle a commit is a **blocking** request that freezes the tab for the length of the server round-trip, so a student dragging blocks would otherwise feel a hitch after every edit
- Every write is verified by reading the value back. If the LMS truncates or rejects it, the runtime lowers its working limit, restores the last good snapshot (or clears the field), and falls back to the IndexedDB layer
- When the workspace only fits in IndexedDB, `cmi.suspend_data` receives a small reference payload (`BS1|activity_id|I|timestamp|`) so the LMS still records that a saved session exists
- Restores always take the **newest complete** snapshot: the IndexedDB copy on the same browser, or the `suspend_data` snapshot on another device. Partial or truncated states are never restored
- Payloads are ASCII-only (SCORM 1.2 data model types are ISO 646): non-ASCII field values take a base64 path, and block ids/coordinates are stripped before encoding
- Saved state is scoped to `activity_id` + `cmi.core.student_id` + the package path, so two activities that reuse a package, or two students on a shared computer, never see each other's work
- **Reset** discards both layers, so the next launch starts from the configured starting blocks
- `cmi.core.lesson_status` is only initialised to `incomplete` when the LMS reports no attempt yet; an existing `passed`, `completed`, or `failed` status is left untouched so re-entry does not wipe completion tracking
- Each Check reports the **best** result of the session: a student who passes and then keeps experimenting cannot lose the pass or the score to a later failed Check, and a pass and score the LMS already holds are adopted when the activity loads. Pair it with Moodle's **Highest grade** method (below) so the gradebook agrees

Capacity in practice (measured, 4096-character default): a plain sequence of `print` statements fits about **240 blocks** (120 prints), a program of variables and nested loops fewer, and one that compresses well more. Programs beyond that are kept in IndexedDB only; the student sees a one-time notice in the status bar, and the teacher can raise `ui_settings.suspend_data_limit` for an LMS that accepts more than the SCORM 1.2 minimum (the runtime verifies the write and falls back automatically if the LMS refuses it).

> **Note:** Moodle stores `cmi.suspend_data` per attempt. With **Force new attempt** enabled, each launch starts a fresh attempt and therefore a fresh workspace.

> **Caveats for the browser layer:** IndexedDB is per browser and per device, can be evicted (Safari's 7-day script-writable storage cap, quota pressure, "clear browsing data", private windows), and is invisible to Moodle's reports. It is a safety net for large workspaces, not a replacement for the LMS record. If it is missing, the runtime says so in the status bar and falls back to the `suspend_data` snapshot or the starting blocks.

### Mastery Score

The default mastery score is **50** (set in `imsmanifest.xml`). Moodle uses this value for its own completion tracking.

> ⚠️ **Note:** The JavaScript runtime uses a **hardcoded** pass threshold of 50 (in `scorm-wrapper.js`'s `reportScore()` function) to set the `cmi.core.lesson_status` to "passed" or "failed". Changing the mastery score in `imsmanifest.xml` affects Moodle's completion interpretation but does **not** change the pass/fail status reported by the activity itself. To change the runtime threshold, edit `scorm-wrapper.js`.

```xml
<!-- In imsmanifest.xml — affects Moodle's completion tracking -->
<adlcp:masteryscore>70</adlcp:masteryscore>
```

### Preview Mode

If no SCORM API is detected (e.g., opening `index.html` directly in a browser), the activity runs in **preview mode**:
- All SCORM calls are logged to the console instead
- Activity is fully functional except for grade reporting
- Useful for testing without uploading to Moodle

---

## Deploying Multiple Activities

Each activity needs its own SCORM package. To create multiple activities:

1. Create configs for each activity (use the Activity Builder or write JSON)
2. For each config:

```bash
# Copy config
cp my-activity.json src/scorm-template/config/activity_config.json

# Build and export
npm run build:scorm
npm run export

# The zip file name comes from the activity_id in the config
# Move to a collection folder
mv dist/*.zip scorm-packages/
```

3. Upload each `.zip` as a separate SCORM activity in Moodle

---

## Updating an Activity

To update an already-deployed activity:

1. Modify the config (or re-export from the Activity Builder)
2. Rebuild and re-export the SCORM package
3. In Moodle, edit the SCORM activity
4. Upload the new `.zip` file (replacing the old one)
5. Moodle will use the updated package for new attempts

> **Note:** Existing student attempts retain their original scores. Updated activities only affect new attempts.

---

## Troubleshooting

### "Activity shows blank page"

- Check that `npm run build` completed successfully before `npm run export`
- Verify the `.zip` contains: `index.html`, `js/app.bundle.js`, `css/style.css`, `config/activity_config.json`, `imsmanifest.xml`

### "Score not appearing in gradebook"

- Open browser developer tools (F12) and check the console
- Look for SCORM API errors
- Verify the activity opens in a popup/new window (not embedded in an iframe with restrictive settings)
- Check Moodle's SCORM report for the activity

### "Student work is not restored on the next session"

- Confirm the student re-enters the **same attempt** — with **Force new attempt** enabled, Moodle starts a fresh attempt with empty `cmi.suspend_data`
- A status-bar notice explains the common causes: *"stored in this browser only"* means the program is too large for the LMS, and *"This browser no longer has the saved copy"* means the browser layer was cleared or the student is on another device
- If the student clicked **Reset**, the saved session was intentionally discarded
- Verify the package was exported after the config's `activity_id` was finalised — saved state is only restored when the stored `activity_id` matches the current config
- Check the browser console for `[WorkspacePersistence]` warnings: they report an LMS that truncated or rejected a write, and the runtime lowers its limit automatically

### "Blockly workspace doesn't load"

- Check browser console for JavaScript errors
- Verify the activity config JSON is valid
- Test in preview mode first (open `dist/scorm-template/index.html` directly)

### "Works locally but not in Moodle"

- Moodle's SCORM player may use iframes — ensure your activity works inside an iframe
- Check that your browser allows popups from Moodle (if using "New window" display)
- Try different **Display package** settings in Moodle's SCORM configuration

See [Troubleshooting](troubleshooting.md) for more solutions.
