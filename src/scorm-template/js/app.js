/**
 * App Controller — Main orchestrator for the SCORM Blockly activity.
 *
 * Flow: init SCORM → load config → validate → render UI → interact → evaluate → report
 */

import * as scorm from './scorm-wrapper.js';
import { initWorkspace, generateCode, getWorkspace, Blockly } from './blockly-engine.js';
import { runTests } from './test-runner.js';
import { initHintEngine, onTestFail, requestHint, dismissHint, setBlocklyRef } from './hint-engine.js';

let config = null;
let attemptCount = 0;

async function init() {
  // 1. Initialize SCORM
  const lmsConnected = scorm.init();
  if (!lmsConnected) {
    showStatus('Running in preview mode (not connected to LMS)', 'info');
  }

  // 2. Load config
  try {
    const resp = await fetch('config/activity_config.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    config = await resp.json();
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

  showStatus('Activity loaded. Arrange your blocks and click "Run Code"!', 'info');
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

async function handleRun() {
  const runBtn = document.getElementById('btn-run');
  runBtn.disabled = true;
  runBtn.textContent = 'Running...';

  try {
    const code = generateCode();
    const workspace = getWorkspace();
    const { results, totalScore, maxScore } = await runTests(
      config.evaluation.test_cases,
      code,
      workspace
    );

    attemptCount++;
    renderResults(results, totalScore, maxScore);

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
  document.getElementById('output-panel').innerHTML = '';
  showStatus('Workspace reset to starting state.', 'info');
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

function renderResults(results, totalScore, maxScore) {
  const panel = document.getElementById('output-panel');
  if (!panel) return;

  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const allPassed = results.every((r) => r.passed);

  let html = `<div class="results-header ${allPassed ? 'results-pass' : 'results-fail'}">`;
  html += `<strong>${allPassed ? '✅ All tests passed!' : '❌ Some tests failed'}</strong>`;
  html += ` — Score: ${percent}%`;
  html += '</div>';

  html += '<ul class="results-list">';
  for (const r of results) {
    html += `<li class="${r.passed ? 'result-pass' : 'result-fail'}">`;
    html += `<span class="result-icon">${r.passed ? '✓' : '✗'}</span> `;
    html += escapeHtml(r.feedback);
    html += '</li>';
  }
  html += '</ul>';

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
  div.textContent = str;
  return div.innerHTML;
}

// Expose functions for inline event handlers
window.BlocklyScorm = { dismissHint, requestHint };

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
