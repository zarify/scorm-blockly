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
| **Maximum grade** | 100 | Matches the SCORM max_score |

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
   - [ ] "Run Code" executes and shows results
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
| `LMSSetValue("cmi.core.score.raw", score)` | After test run | Report score (0–100) |
| `LMSSetValue("cmi.core.lesson_status", status)` | After test run | Report "passed" or "failed" |
| `LMSCommit("")` | After score set | Save data to LMS |
| `LMSFinish("")` | Page unload | End SCORM session |

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

### "Blockly workspace doesn't load"

- Check browser console for JavaScript errors
- Verify the activity config JSON is valid
- Test in preview mode first (open `dist/scorm-template/index.html` directly)

### "Works locally but not in Moodle"

- Moodle's SCORM player may use iframes — ensure your activity works inside an iframe
- Check that your browser allows popups from Moodle (if using "New window" display)
- Try different **Display package** settings in Moodle's SCORM configuration

See [Troubleshooting](troubleshooting.md) for more solutions.
