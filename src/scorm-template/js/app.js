/**
 * App Controller — Main orchestrator for the SCORM Blockly activity.
 *
 * Flow: init SCORM → load config → validate → render UI → interact → evaluate → report
 */

import * as scorm from './scorm-wrapper.js';
import { initWorkspace, generateCode, getWorkspace, Blockly } from './blockly-engine.js';
import { executeInteractiveRun, runTests } from './test-runner.js';
import { initHintEngine, onTestFail, requestHint, dismissHint, setBlocklyRef } from './hint-engine.js';

let config = null;
let attemptCount = 0;
const PREVIEW_CONFIG_GLOBAL = '__BLOCKLY_SCORM_PREVIEW_CONFIG__';
const PREVIEW_MODE_GLOBAL = '__BLOCKLY_SCORM_PREVIEW_MODE__';

async function init() {
  // 1. Initialize SCORM
  const lmsConnected = scorm.init();
  const embeddedPreview = isEmbeddedPreview();
  if (!lmsConnected) {
    showStatus(
      embeddedPreview
        ? 'Author preview mode — testing the real student runtime without Moodle.'
        : 'Running in preview mode (not connected to LMS)',
      'info',
    );
  }

  // 2. Load config
  try {
    config = await loadConfig();
  } catch (err) {
    showStatus(`Failed to load activity config: ${err.message}`, 'error');
    return;
  }

  // 3. Render UI
  renderInstructions(config);
  renderUISettings(config);

  // 4. Initialize Blockly
  const blocklyContainer = document.getElementById('blockly-workspace');
  initWorkspace(blocklyContainer, config.blockly_setup, config.ui_settings || {});

  // 5. Initialize hint engine
  setBlocklyRef(Blockly);
  const hintPanel = document.getElementById('hint-panel');
  initHintEngine(config.hints || [], getWorkspace(), hintPanel);

  // 6. Attach event handlers
  document.getElementById('btn-run').addEventListener('click', handleRun);
  document.getElementById('btn-reset').addEventListener('click', handleReset);
  configureHintRequestButton(config);

  const codeToggle = document.getElementById('btn-code-toggle');
  if (codeToggle) {
    if (config.ui_settings?.show_code_toggle === false) {
      codeToggle.style.display = 'none';
    } else {
      codeToggle.addEventListener('click', handleCodeToggle);
    }
  }

  // 7. Handle window resize
  window.addEventListener('resize', () => {
    const ws = getWorkspace();
    if (ws) Blockly.svgResize(ws);
  });

  // 8. Handle page unload
  window.addEventListener('beforeunload', () => scorm.terminate());

  showStatus(
    embeddedPreview
      ? 'Preview ready. Build with blocks, run tests, request hints, and inspect generated code.'
      : 'Activity loaded. Arrange your blocks and click "Run Code"!',
    'info',
  );
}

async function loadConfig() {
  const previewConfig = window[PREVIEW_CONFIG_GLOBAL];
  if (previewConfig) {
    return cloneConfig(previewConfig);
  }

  const resp = await fetch('config/activity_config.json');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function renderInstructions(cfg) {
  const panel = document.getElementById('instructions-panel');
  if (!panel) return;

  let html = '';
  if (cfg.metadata?.title) {
    html += `<h2>${escapeHtml(cfg.metadata.title)}</h2>`;
  }
  if (cfg.instructions?.main) {
    html += `<p class="instruction-main">${escapeHtml(cfg.instructions.main)}</p>`;
  }
  if (cfg.instructions?.steps?.length > 0) {
    html += '<ol class="instruction-steps">';
    for (const step of cfg.instructions.steps) {
      html += `<li>${escapeHtml(step)}</li>`;
    }
    html += '</ol>';
  }
  panel.innerHTML = html;
}

function renderUISettings(cfg) {
  const hintPanel = document.getElementById('hint-panel');
  if (hintPanel && cfg.ui_settings?.show_hint_panel === false) {
    hintPanel.style.display = 'none';
  }
}

function configureHintRequestButton(cfg) {
  const hintButton = document.getElementById('btn-request-hint');
  if (!hintButton) return;

  const hintPanelEnabled = cfg.ui_settings?.show_hint_panel !== false;
  const hasHints = Array.isArray(cfg.hints) && cfg.hints.length > 0;
  hintButton.style.display = hintPanelEnabled && hasHints ? 'inline-flex' : 'none';
  hintButton.onclick = hintPanelEnabled && hasHints ? handleHintRequest : null;
}

async function handleRun() {
  const runBtn = document.getElementById('btn-run');
  runBtn.disabled = true;
  runBtn.textContent = 'Running...';

  try {
    const code = generateCode();
    const workspace = getWorkspace();
    const execution = executeInteractiveRun(code);
    const { results, totalScore, maxScore } = await runTests(
      config.evaluation.test_cases,
      code,
      workspace
    );

    attemptCount++;
    renderRunOutput(execution, results, totalScore, maxScore);

    // Report score to SCORM
    const normalizedScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    scorm.reportScore(normalizedScore);

    // Notify hint engine of failures
    const hasFailures = results.some((r) => !r.passed);
    if (hasFailures) {
      onTestFail(attemptCount);
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Code';
  }
}

function handleReset() {
  const workspace = getWorkspace();
  if (!workspace) return;

  workspace.clear();
  if (config.blockly_setup.starting_blocks) {
    Blockly.serialization.workspaces.load(config.blockly_setup.starting_blocks, workspace);
  }
  document.getElementById('output-panel').innerHTML =
    '<p class="output-placeholder">Run your code to see console output, prompts, and automated checks here.</p>';
  showStatus('Workspace reset to starting state.', 'info');
}

function handleHintRequest() {
  requestHint();
}

function handleCodeToggle() {
  const codePanel = document.getElementById('code-panel');
  if (!codePanel) return;

  if (codePanel.style.display === 'none') {
    try {
      const code = generateCode();
      codePanel.querySelector('code').textContent = code;
      codePanel.style.display = 'block';
    } catch {
      showStatus('Add some blocks first to see the code.', 'info');
    }
  } else {
    codePanel.style.display = 'none';
  }
}

function renderRunOutput(execution, results, totalScore, maxScore) {
  const panel = document.getElementById('output-panel');
  if (!panel) return;

  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const allPassed = results.length > 0 ? results.every((r) => r.passed) : execution.success;

  let html = '<div class="output-section">';
  html += '<h3>Program Output</h3>';

  if (execution.stdout) {
    html += `<pre class="output-console">${escapeHtml(execution.stdout)}</pre>`;
  } else {
    html += '<p class="output-empty">No console output produced.</p>';
  }

  if (execution.prompts.length > 0) {
    html += '<div class="prompt-log">';
    html += '<h4>Inputs used during this run</h4>';
    html += '<ul class="prompt-list">';
    execution.prompts.forEach((entry, index) => {
      const label = entry.message || `Prompt ${index + 1}`;
      const response = entry.cancelled ? '<em>Cancelled</em>' : `<code>${escapeHtml(entry.response)}</code>`;
      html += `<li class="prompt-item"><strong>${escapeHtml(label)}</strong><span class="prompt-arrow">→</span>${response}</li>`;
    });
    html += '</ul></div>';
  }

  if (!execution.success) {
    html += `<div class="run-error"><strong>Runtime error:</strong> ${escapeHtml(execution.error || 'Unknown error')}</div>`;
  }

  html += '</div>';

  if (results.length > 0) {
    html += `<div class="results-section">`;
    html += `<div class="results-header ${allPassed ? 'results-pass' : 'results-fail'}">`;
    html += `<strong>${allPassed ? '✅ All automated checks passed!' : '❌ Some automated checks failed'}</strong>`;
    html += ` — Score: ${percent}%`;
    html += '</div>';

    html += '<ul class="results-list">';
    for (const r of results) {
      html += `<li class="${r.passed ? 'result-pass' : 'result-fail'}">`;
      html += `<span class="result-icon">${r.passed ? '✓' : '✗'}</span> `;
      html += escapeHtml(r.feedback);
      html += '</li>';
    }
    html += '</ul></div>';
  }

  panel.innerHTML = html;
}

function showStatus(message, type) {
  const el = document.getElementById('status-bar');
  if (!el) return;
  el.className = `status-bar status-${type}`;
  el.textContent = message;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function cloneConfig(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isEmbeddedPreview() {
  return window[PREVIEW_MODE_GLOBAL] === true;
}

// Expose functions for inline event handlers
window.BlocklyScorm = { dismissHint, requestHint };

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
