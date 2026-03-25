/**
 * Export Module — JSON and SCORM package export, config import.
 */

import JSZip from 'jszip';
import { validateConfig } from '../../shared/config-validator.js';

/**
 * Export the config as a JSON file download.
 * @param {object} config
 */
export function exportJSON(config) {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${config.metadata?.activity_id || 'activity_config'}.json`);
}

/**
 * Export a complete SCORM package as a .zip download.
 * Bundles the SCORM template files with the current config.
 * @param {object} config
 */
export async function exportSCORM(config) {
  const zip = new JSZip();

  // Add the config
  zip.file('config/activity_config.json', JSON.stringify(config, null, 2));

  // Add the imsmanifest.xml with the activity title
  zip.file('imsmanifest.xml', generateManifest(config));

  // Add the HTML template
  zip.file('index.html', generateIndexHtml(config));

  // Add the CSS
  zip.file('css/style.css', getScormCSS());

  // The bundled JS would come from the build output.
  // For now, add a placeholder that users replace with the built bundle.
  zip.file('js/app.bundle.js', getScormBundlePlaceholder());

  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  downloadBlob(content, `${config.metadata?.activity_id || 'blockly-scorm'}.zip`);
}

/**
 * Import a config from a JSON file.
 * @param {File} file
 * @returns {Promise<object>}
 */
export async function importConfig(file) {
  const text = await file.text();
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file');
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    const firstErrors = validation.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Config validation failed:\n${firstErrors.join('\n')}`);
  }

  return config;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateManifest(config) {
  const title = escapeXml(config.metadata?.title || 'Blockly Coding Activity');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="blockly_scorm_${config.metadata?.activity_id || 'activity'}"
         version="1.0"
         xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
         xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                             http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
                             http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="blockly_org">
    <organization identifier="blockly_org">
      <title>${title}</title>
      <item identifier="blockly_item" identifierref="blockly_resource" isvisible="true">
        <title>${title}</title>
        <adlcp:masteryscore>50</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="blockly_resource" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="css/style.css"/>
      <file href="js/app.bundle.js"/>
      <file href="config/activity_config.json"/>
    </resource>
  </resources>
</manifest>`;
}

function generateIndexHtml(config) {
  const title = escapeHtml(config.metadata?.title || 'Blockly Activity');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="app">
    <header id="status-bar" class="status-bar status-info">Loading activity...</header>
    <div id="main-layout">
      <aside id="left-panel">
        <div id="instructions-panel" class="panel"><h2>Instructions</h2><p>Loading...</p></div>
        <div id="hint-panel" class="panel hint-panel"><h3>💡 Hints</h3><p class="hint-empty">No hints available right now.</p></div>
      </aside>
      <main id="workspace-area">
        <div id="blockly-workspace"></div>
        <div id="controls">
          <button id="btn-run" class="btn btn-primary">▶ Run Code</button>
          <button id="btn-reset" class="btn btn-secondary">↺ Reset</button>
          <button id="btn-code-toggle" class="btn btn-secondary">{ } Show Code</button>
        </div>
      </main>
      <aside id="right-panel">
        <div id="output-panel" class="panel"><p class="output-placeholder">Run your code to see results here.</p></div>
        <div id="code-panel" class="panel" style="display:none"><h3>Generated Code</h3><pre><code></code></pre></div>
      </aside>
    </div>
  </div>
  <script src="js/app.bundle.js"></script>
</body>
</html>`;
}

function getScormCSS() {
  // Returns the student-facing CSS inline (same as src/scorm-template/css/style.css)
  return `/* Blockly SCORM Activity */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; height: 100vh; overflow: hidden; }
#app { display: flex; flex-direction: column; height: 100vh; }
.status-bar { padding: 8px 16px; font-size: 14px; text-align: center; flex-shrink: 0; }
.status-info { background: #e3f2fd; color: #1565c0; }
.status-error { background: #ffebee; color: #c62828; }
#main-layout { display: grid; grid-template-columns: 280px 1fr 320px; gap: 0; flex: 1; overflow: hidden; }
.panel { background: #fff; padding: 16px; overflow-y: auto; }
#left-panel { display: flex; flex-direction: column; border-right: 1px solid #ddd; overflow-y: auto; }
#instructions-panel { flex: 1; }
#instructions-panel h2 { font-size: 18px; margin-bottom: 12px; }
.instruction-main { font-size: 15px; line-height: 1.6; margin-bottom: 12px; }
.instruction-steps { padding-left: 20px; font-size: 14px; line-height: 1.8; }
.hint-panel { border-top: 1px solid #ddd; max-height: 200px; }
.hint-panel h3 { font-size: 15px; margin-bottom: 8px; }
.hint-empty { font-size: 13px; color: #999; font-style: italic; }
.hint-card { background: #fff8e1; border: 1px solid #ffecb3; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; position: relative; font-size: 14px; }
.hint-dismiss { position: absolute; top: 6px; right: 8px; background: none; border: none; font-size: 14px; cursor: pointer; color: #999; }
#workspace-area { display: flex; flex-direction: column; overflow: hidden; }
#blockly-workspace { flex: 1; min-height: 0; }
#controls { display: flex; gap: 8px; padding: 10px 16px; background: #fff; border-top: 1px solid #ddd; flex-shrink: 0; }
.btn { padding: 8px 20px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary { background: #1976d2; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #1565c0; }
.btn-secondary { background: #e0e0e0; color: #333; }
#right-panel { display: flex; flex-direction: column; border-left: 1px solid #ddd; overflow-y: auto; }
#output-panel { flex: 1; }
.output-placeholder { color: #999; font-style: italic; font-size: 14px; }
.results-header { padding: 10px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 15px; }
.results-pass { background: #e8f5e9; color: #2e7d32; }
.results-fail { background: #ffebee; color: #c62828; }
.results-list { list-style: none; }
.results-list li { padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
.result-pass .result-icon { color: #2e7d32; }
.result-fail .result-icon { color: #c62828; }
#code-panel { border-top: 1px solid #ddd; max-height: 300px; overflow-y: auto; }
#code-panel pre { background: #263238; color: #eeffff; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; }
@media (max-width: 900px) { #main-layout { grid-template-columns: 1fr; } }`;
}

function getScormBundlePlaceholder() {
  return `// This is a placeholder. Replace with the built app.bundle.js from: npm run build:scorm
console.error("[SCORM] app.bundle.js is a placeholder. Run 'npm run build:scorm' and copy dist/scorm-template/js/app.bundle.js here.");`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeXml(str) {
  return escapeHtml(str);
}
