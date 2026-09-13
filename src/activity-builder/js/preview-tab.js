/**
 * Preview Tab — Interactive student-runtime preview.
 *
 * Builds an iframe document that bootstraps the real student app bundle with
 * the current in-memory config injected inline.
 */

import { getConfig, onConfigChange } from './builder-app.js';

export function initPreviewTab() {
  document.getElementById('btn-refresh-preview').addEventListener('click', refreshPreview);
  onConfigChange(() => {
    if (isPreviewActive()) {
      refreshPreview();
    }
  });

  window.addEventListener('tab-activated', (e) => {
    if (e.detail.tab === 'preview') {
      refreshPreview();
    }
  });
}

function refreshPreview() {
  const iframe = document.getElementById('preview-iframe');
  if (!iframe) return;

  iframe.srcdoc = buildPreviewHtml(getConfig());
}

function buildPreviewHtml(config) {
  const previewBaseHref = new URL('./preview/', window.location.href).href;
  const title = escapeHtml(config.metadata?.title || 'Blockly Activity Preview');
  const inlineConfig = serializeForInlineScript(config);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <base href="${escapeAttr(previewBaseHref)}">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <header id="status-bar" class="status-bar status-info">Loading interactive preview...</header>

    <div id="main-layout">
      <aside id="left-panel">
        <div id="instructions-panel" class="panel">
          <h2>Instructions</h2>
          <p>Loading...</p>
        </div>
        <div id="hint-panel" class="panel hint-panel">
          <h3>💡 Hints</h3>
          <p class="hint-empty">No hints available right now.</p>
        </div>
      </aside>

      <main id="workspace-area">
        <div id="blockly-workspace"></div>
        <div id="controls">
          <button id="btn-run" class="btn btn-primary">▶ Run Code</button>
          <button id="btn-reset" class="btn btn-secondary">↺ Reset</button>
          <button id="btn-request-hint" class="btn btn-secondary">💡 Get Hint</button>
          <button id="btn-code-toggle" class="btn btn-secondary">{ } Show Code</button>
        </div>
      </main>

      <aside id="right-panel">
        <div id="output-panel" class="panel">
          <p class="output-placeholder">Run your code to see console output, prompts, and automated checks here.</p>
        </div>
        <div id="code-panel" class="panel" style="display: none;">
          <h3>Generated Code</h3>
          <pre><code></code></pre>
        </div>
      </aside>
    </div>
  </div>
  <script>
    window.__BLOCKLY_SCORM_PREVIEW_MODE__ = true;
    window.__BLOCKLY_SCORM_PREVIEW_CONFIG__ = ${inlineConfig};
  </script>
  <script src="app.bundle.js"></script>
</body>
</html>`;
}

function isPreviewActive() {
  return document.getElementById('tab-preview')?.classList.contains('active');
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}
