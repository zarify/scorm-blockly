/**
 * Export Module — JSON and SCORM package export, config import.
 */

import JSZip from 'jszip';
import { normalizeBuilderDraftConfig } from '../../shared/config-normalizer.js';
import { validateBuilderDraftConfig } from '../../shared/config-validator.js';

const BUILDER_RUNTIME_ASSETS_GLOBAL = '__SCORM_BUILDER_ASSETS__';

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
  const runtimeAssets = await loadScormRuntimeAssets();
  const zip = new JSZip();

  // Add the config
  zip.file('config/activity_config.json', JSON.stringify(config, null, 2));

  // Add the imsmanifest.xml with the activity title
  zip.file('imsmanifest.xml', generateManifest(config));

  // Add the HTML template
  zip.file('index.html', generateIndexHtml(config));

  // Add the CSS
  zip.file('css/style.css', runtimeAssets.styleCss);

  // Add the real student runtime bundle.
  zip.file('js/app.bundle.js', runtimeAssets.appBundleJs);

  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  downloadBlob(content, `${config.metadata?.activity_id || 'blockly-scorm'}.zip`);
}

async function loadScormRuntimeAssets() {
  const embeddedAssets = globalThis[BUILDER_RUNTIME_ASSETS_GLOBAL];
  if (hasRuntimeAssets(embeddedAssets)) {
    return embeddedAssets;
  }

  const fetchedAssets = await fetchRuntimeAssets();
  if (hasRuntimeAssets(fetchedAssets)) {
    return fetchedAssets;
  }

  throw new Error(
    'SCORM runtime assets are unavailable. Rebuild the activity builder or run it with "npm run dev", then try exporting again.',
  );
}

async function fetchRuntimeAssets() {
  try {
    const [appBundleResp, styleResp] = await Promise.all([
      fetch(new URL('preview/app.bundle.js', window.location.href)),
      fetch(new URL('preview/style.css', window.location.href)),
    ]);

    if (!appBundleResp.ok || !styleResp.ok) {
      return null;
    }

    const [appBundleJs, styleCss] = await Promise.all([appBundleResp.text(), styleResp.text()]);
    return { appBundleJs, styleCss };
  } catch {
    return null;
  }
}

function hasRuntimeAssets(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof value.appBundleJs === 'string'
      && value.appBundleJs.length > 0
      && typeof value.styleCss === 'string'
      && value.styleCss.length > 0,
  );
}

/**
 * Import a config from a JSON file.
 * @param {File} file
 * @returns {Promise<object>}
 */
export async function importConfig(file) {
  const text = await file.text();
  let rawConfig;
  try {
    rawConfig = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file');
  }

  const { config } = normalizeBuilderDraftConfig(rawConfig);
  const validation = validateBuilderDraftConfig(config);
  if (!validation.valid) {
    const firstErrors = validation.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Imported draft is missing required sections:\n${firstErrors.join('\n')}`);
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
          <button id="btn-check" class="btn btn-secondary">✓ Check</button>
          <button id="btn-reset" class="btn btn-secondary">↺ Reset</button>
          <button id="btn-request-hint" class="btn btn-secondary">💡 Get Hint</button>
          <button id="btn-code-toggle" class="btn btn-secondary">{ } Show Code</button>
        </div>
      </main>
    </div>
  </div>
  <div id="results-modal" class="results-modal hidden" aria-hidden="true">
    <button id="results-modal-backdrop" class="results-modal-backdrop" type="button" aria-label="Close results"></button>
    <section class="results-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="results-modal-title">
      <header class="results-modal-header">
        <h2 id="results-modal-title">Run output</h2>
        <button id="btn-close-results-modal" class="btn btn-secondary results-modal-close" type="button" aria-label="Close results">✕</button>
      </header>
      <div class="results-modal-body">
        <div id="output-panel" class="panel"><p class="output-placeholder">Run your code or check your solution to see output, prompts, and feedback here.</p></div>
        <div id="code-panel" class="panel" style="display:none"><h3>Generated Code</h3><pre><code></code></pre></div>
      </div>
    </section>
  </div>
  <script src="js/app.bundle.js"></script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeXml(str) {
  return escapeHtml(str);
}
