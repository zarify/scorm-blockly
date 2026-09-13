/**
 * Preview Tab — Live simulation of the student experience.
 *
 * Creates a sandboxed preview by building an inline HTML document from the
 * current config state and loading it in an iframe.
 */

import { getTestPoints } from '../../shared/test-config.js';
import { getConfig, onConfigChange } from './builder-app.js';

export function initPreviewTab() {
  document.getElementById('btn-refresh-preview').addEventListener('click', refreshPreview);

  window.addEventListener('tab-activated', (e) => {
    if (e.detail.tab === 'preview') {
      refreshPreview();
    }
  });
}

function refreshPreview() {
  const iframe = document.getElementById('preview-iframe');
  if (!iframe) return;

  const config = getConfig();

  // Build a self-contained preview HTML document
  const html = buildPreviewHtml(config);
  iframe.srcdoc = html;
}

function buildPreviewHtml(config) {
  const configJSON = JSON.stringify(config, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 16px;
    }
    h2 { font-size: 16px; margin-bottom: 8px; }
    .instructions { background: #fff; padding: 12px; border-radius: 6px; margin-bottom: 12px; }
    .instructions p { font-size: 14px; line-height: 1.5; margin-bottom: 8px; }
    .instructions ol { padding-left: 20px; font-size: 13px; line-height: 1.7; }
    .preview-note {
      background: #e3f2fd; color: #1565c0; padding: 8px 12px;
      border-radius: 6px; font-size: 13px; margin-bottom: 12px;
    }
    .config-preview {
      background: #263238; color: #eeffff; padding: 12px;
      border-radius: 6px; font-size: 11px; line-height: 1.4;
      max-height: 400px; overflow: auto; white-space: pre-wrap;
      font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    }
    .hint-preview {
      background: #fff8e1; border: 1px solid #ffecb3;
      border-radius: 6px; padding: 10px; margin-bottom: 8px;
      font-size: 13px;
    }
    .test-preview {
      background: #fff; border-radius: 6px; padding: 12px; margin-bottom: 8px;
    }
    .test-item { padding: 4px 0; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
    .section { margin-bottom: 16px; }
    .section h3 { font-size: 14px; color: #555; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="preview-note">
    📋 Preview Mode — This shows a summary of the activity configuration.
    The full interactive Blockly workspace is available in the built SCORM package.
  </div>

  <div class="instructions">
    <h2>${escapeHtml(config.metadata?.title || 'Untitled Activity')}</h2>
    ${config.metadata?.description ? `<p style="color:#666;font-size:13px">${escapeHtml(config.metadata.description)}</p>` : ''}
    ${config.instructions?.main ? `<p>${escapeHtml(config.instructions.main)}</p>` : ''}
    ${config.instructions?.steps?.length ? `
      <ol>
        ${config.instructions.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
      </ol>
    ` : ''}
  </div>

  <div class="section">
    <h3>🧰 Toolbox (${config.blockly_setup?.toolbox?.categories?.length || 0} categories)</h3>
    ${(config.blockly_setup?.toolbox?.categories || []).map((cat) => `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:13px">
        <span style="width:12px;height:12px;border-radius:2px;background:${cat.colour || '#999'}"></span>
        <strong>${escapeHtml(cat.name)}</strong>
        <span style="color:#999">(${cat.blocks?.length || 0} blocks)</span>
      </div>
    `).join('')}
  </div>

  ${(config.hints?.length || 0) > 0 ? `
    <div class="section">
      <h3>💡 Hints (${config.hints.length})</h3>
      ${config.hints.map((h) => `<div class="hint-preview">${escapeHtml(h.message)}</div>`).join('')}
    </div>
  ` : ''}

  <div class="section">
    <h3>✅ Test Cases (${config.evaluation?.test_cases?.length || 0})</h3>
    <div class="test-preview">
      ${(config.evaluation?.test_cases || []).map((tc) => `
        <div class="test-item">
          <strong>${tc.type}</strong> — ${escapeHtml(tc.id)} (${getTestPoints(tc)} point${getTestPoints(tc) === 1 ? '' : 's'})
          ${tc.feedback_on_fail ? `<br><small style="color:#999">${escapeHtml(tc.feedback_on_fail)}</small>` : ''}
        </div>
      `).join('')}
    </div>
  </div>

  <div class="section">
    <h3>📄 Raw Configuration</h3>
    <div class="config-preview">${escapeHtml(configJSON)}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
