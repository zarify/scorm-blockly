/**
 * App Controller — Main orchestrator for the SCORM Blockly activity.
 *
 * Flow: init SCORM → load config → validate → render UI → interact → evaluate → report
 */

import * as scorm from './scorm-wrapper.js';
import { initWorkspace, generateCode, getWorkspace, Blockly } from './blockly-engine.js';
import { executeInteractiveRun, INTERACTIVE_RUN_CANCELLED_ERROR, runTests } from './test-runner.js';
import { initHintEngine, onTestFail, requestHint, setBlocklyRef } from './hint-engine.js';
import { renderInlineMarkdown } from '../../shared/inline-markdown.js';

let config = null;
let attemptCount = 0;
let interactiveConsoleState = null;
let activeInteractiveRun = null;
let isResultsModalCloseLocked = false;
const PREVIEW_CONFIG_GLOBAL = '__BLOCKLY_SCORM_PREVIEW_CONFIG__';
const PREVIEW_MODE_GLOBAL = '__BLOCKLY_SCORM_PREVIEW_MODE__';
const OUTPUT_PLACEHOLDER_HTML =
  '<p class="output-placeholder">Run your code or check your solution to open the console, prompts, and feedback here.</p>';

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
  initHintEngine(config.hints || [], getWorkspace(), hintPanel, {
    enabled: areHintsEnabled(config),
    legacyDisplayMode: getLegacyHintDisplayMode(config),
    debounceMs: config.ui_settings?.hint_debounce_ms ?? 250,
    onRequestAvailabilityChange: updateHintRequestButtonState,
  });

  // 6. Attach event handlers
  setupResultsModal();
  document.getElementById('btn-run').addEventListener('click', handleRun);
  document.getElementById('btn-check').addEventListener('click', handleCheck);
  document.getElementById('btn-reset').addEventListener('click', handleReset);
  configureHintRequestButton(config);
  configureCodeToggleButton(config);

  // 7. Handle window resize
  window.addEventListener('resize', () => {
    const ws = getWorkspace();
    if (ws) Blockly.svgResize(ws);
  });

  // 8. Handle page unload
  window.addEventListener('beforeunload', () => scorm.terminate());

  showStatus(
    embeddedPreview
      ? 'Preview ready. Build with blocks, run code, check tests, request hints, and inspect generated code.'
      : 'Activity loaded. Arrange your blocks, then click "Run Code" or "Check".',
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
  const hintPanel = panel.querySelector('#hint-panel');
  hintPanel?.remove();

  let html = '';
  if (cfg.metadata?.title) {
    html += `<h2 class="formatted-text">${renderInlineMarkdown(cfg.metadata.title)}</h2>`;
  }
  if (cfg.instructions?.main) {
    html += `<p class="instruction-main formatted-text">${renderInlineMarkdown(cfg.instructions.main)}</p>`;
  }
  if (cfg.instructions?.steps?.length > 0) {
    html += '<ol class="instruction-steps">';
    for (const step of cfg.instructions.steps) {
      html += `<li class="formatted-text">${renderInlineMarkdown(step)}</li>`;
    }
    html += '</ol>';
  }
  panel.innerHTML = html;
  if (hintPanel) {
    panel.appendChild(hintPanel);
  }
}

function renderUISettings(cfg) {
  const hintPanel = document.getElementById('hint-panel');
  if (hintPanel) {
    hintPanel.style.display = areHintsEnabled(cfg) ? '' : 'none';
  }
}

function configureHintRequestButton(cfg) {
  const hintButton = document.getElementById('btn-request-hint');
  if (!hintButton) return;

  if (!areHintsEnabled(cfg)) {
    hintButton.onclick = null;
    updateHintRequestButtonState();
    return;
  }

  hintButton.onclick = handleHintRequest;
}

function configureCodeToggleButton(cfg) {
  const codeToggle = document.getElementById('btn-code-toggle');
  if (!codeToggle) return;

  if (cfg.ui_settings?.show_code_toggle === false) {
    codeToggle.style.display = 'none';
    return;
  }

  updateCodeToggleButtonLabel(false);
  codeToggle.addEventListener('click', handleCodeToggle);
}

async function handleRun() {
  setExecutionButtonState({ running: true });

  try {
    dismissActiveBlocklyEditing();
    const code = generateCode();
    setResultsModalTitle('Run console');
    renderInteractiveConsole();
    openResultsModal();
    await waitForNextPaint();

    const runControl = {
      cancelled: false,
      cancel() {
        if (this.cancelled) return;
        this.cancelled = true;
        interactiveConsoleState?.pendingRequest?.cancel?.();
      },
    };
    activeInteractiveRun = runControl;

    const execution = await executeInteractiveRun(code, {
      onStdout: appendConsoleOutput,
      requestInput: requestConsoleInput,
      isCancelled: () => runControl.cancelled,
    });

    finalizeInteractiveConsole(execution);
    showStatus(
      execution.cancelled
        ? 'Program run cancelled.'
        : execution.success
        ? 'Program finished.'
        : 'Program stopped because of a runtime error.',
      execution.cancelled || execution.success ? 'info' : 'error',
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    finalizeInteractiveConsole({
      success: false,
      cancelled: errorMessage === INTERACTIVE_RUN_CANCELLED_ERROR,
      stdout: '',
      variables: {},
      prompts: [],
      promptDiagnostics: null,
      error: errorMessage,
    });
    showStatus(
      errorMessage === INTERACTIVE_RUN_CANCELLED_ERROR
        ? 'Program run cancelled.'
        : `Error: ${errorMessage}`,
      errorMessage === INTERACTIVE_RUN_CANCELLED_ERROR ? 'info' : 'error',
    );
  } finally {
    activeInteractiveRun = null;
    setResultsModalClosable(true);
    setExecutionButtonState();
  }
}

async function handleCheck() {
  setExecutionButtonState({ checking: true });

  try {
    dismissActiveBlocklyEditing();
    const code = generateCode();
    const workspace = getWorkspace();
    const {
      results,
      totalScore,
      maxScore,
      hasBlockedTests,
    } = await runTests(
      config.evaluation.test_cases,
      code,
      workspace,
      { requirePreviousTestPass: shouldRequirePreviousTestPass(config) },
    );

    setResultsModalTitle('Check results');
    renderCheckOutput(results, totalScore, maxScore, hasBlockedTests);
    openResultsModal();

    const normalizedScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    scorm.reportScore(normalizedScore);

    if (results.some((result) => !result.passed)) {
      attemptCount += 1;
      onTestFail(attemptCount);
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  } finally {
    setExecutionButtonState();
  }
}

function handleReset() {
  const workspace = getWorkspace();
  if (!workspace) return;

  workspace.clear();
  if (config.blockly_setup.starting_blocks) {
    Blockly.serialization.workspaces.load(config.blockly_setup.starting_blocks, workspace);
  }
  setOutputPlaceholder();
  closeResultsModal();
  showStatus('Workspace reset to starting state.', 'info');
}

function handleHintRequest() {
  requestHint();
}

function handleCodeToggle() {
  const codePanel = document.getElementById('code-panel');
  if (!codePanel) return;

  const shouldShowCode = !isCodePanelVisible();

  if (!shouldShowCode) {
    setCodePanelVisible(false);
    if (!hasRunOutput()) {
      closeResultsModal();
    }
    return;
  }

  try {
    const code = generateCode();
    codePanel.querySelector('code').textContent = code;
    setCodePanelVisible(true);
    openResultsModal();
  } catch {
    showStatus('Add some blocks first to see the code.', 'info');
  }
}

function renderRunOutput(execution) {
  const panel = document.getElementById('output-panel');
  if (!panel) return;
  panel.innerHTML = buildStaticRunOutputHtml(execution);
}

function renderCheckOutput(results, totalScore, maxScore, hasBlockedTests = false) {
  const panel = document.getElementById('output-panel');
  if (!panel) return;
  interactiveConsoleState = null;
  setResultsModalClosable(true);

  if (!results.length) {
    panel.innerHTML = '<p class="output-empty">No automated checks are configured for this activity.</p>';
    return;
  }

  panel.innerHTML = buildCheckResultsHtml(results, totalScore, maxScore, hasBlockedTests);
}

function setupResultsModal() {
  document.getElementById('btn-close-results-modal')?.addEventListener('click', () => {
    closeResultsModal();
  });
  document.getElementById('results-modal-backdrop')?.addEventListener('click', () => {
    closeResultsModal();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeResultsModal();
    }
  });
  setResultsModalTitle('Run output');
  setResultsModalClosable(true);
  setOutputPlaceholder();
}

function openResultsModal() {
  const modal = document.getElementById('results-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeResultsModal() {
  const modal = document.getElementById('results-modal');
  if (!modal) return;

  if (activeInteractiveRun) {
    activeInteractiveRun.cancel();
  }

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  setCodePanelVisible(false);
}

function setOutputPlaceholder() {
  const outputPanel = document.getElementById('output-panel');
  if (!outputPanel) return;
  interactiveConsoleState = null;
  setResultsModalClosable(true);
  outputPanel.innerHTML = OUTPUT_PLACEHOLDER_HTML;
}

function hasRunOutput() {
  return !document.getElementById('output-panel')?.querySelector('.output-placeholder');
}

function isCodePanelVisible() {
  return document.getElementById('code-panel')?.style.display !== 'none';
}

function setCodePanelVisible(visible) {
  const codePanel = document.getElementById('code-panel');
  if (!codePanel) return;
  codePanel.style.display = visible ? 'block' : 'none';
  updateCodeToggleButtonLabel(visible);
}

function updateCodeToggleButtonLabel(visible) {
  const codeToggle = document.getElementById('btn-code-toggle');
  if (!codeToggle) return;
  codeToggle.textContent = visible ? '{ } Hide Code' : '{ } Show Code';
}

function showStatus(message, type) {
  const el = document.getElementById('status-bar');
  if (!el) return;
  el.className = `status-bar status-${type}`;
  el.textContent = message;
}

function setExecutionButtonState({ running = false, checking = false } = {}) {
  const runBtn = document.getElementById('btn-run');
  const checkBtn = document.getElementById('btn-check');
  const resetBtn = document.getElementById('btn-reset');
  const codeToggle = document.getElementById('btn-code-toggle');
  const busy = running || checking;

  if (runBtn) {
    runBtn.disabled = busy;
    runBtn.textContent = running ? 'Running...' : '▶ Run Code';
  }

  if (checkBtn) {
    checkBtn.disabled = busy;
    checkBtn.textContent = checking ? 'Checking...' : '✓ Check';
  }

  if (resetBtn) {
    resetBtn.disabled = busy;
  }

  if (codeToggle) {
    codeToggle.disabled = busy;
  }
}

function setResultsModalTitle(title) {
  const titleElement = document.getElementById('results-modal-title');
  if (titleElement) {
    titleElement.textContent = title;
  }
}

function renderInteractiveConsole() {
  const panel = document.getElementById('output-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="console-shell">
      <div class="console-transcript" data-console-transcript aria-live="polite" aria-label="Program console output"></div>
      <form class="console-input-bar hidden" data-console-form>
        <label class="console-input-label" for="console-stdin">Input</label>
        <input id="console-stdin" class="console-input-field" type="text" autocomplete="off" spellcheck="false">
        <button type="submit" class="btn btn-primary console-submit-button">Enter</button>
      </form>
    </div>
  `;

  interactiveConsoleState = {
    transcriptEl: panel.querySelector('[data-console-transcript]'),
    formEl: panel.querySelector('[data-console-form]'),
    inputEl: panel.querySelector('#console-stdin'),
    pendingRequest: null,
    hasEntries: false,
    isRunning: true,
  };
}

function dismissActiveBlocklyEditing() {
  document.activeElement?.blur?.();
  Blockly.hideChaff?.();
}

function appendConsoleOutput(line) {
  if (!interactiveConsoleState) return;
  appendConsoleEntry('output', line);
}

async function requestConsoleInput({ message, defaultValue = '', inputType = 'text' } = {}) {
  if (!interactiveConsoleState?.transcriptEl || !interactiveConsoleState?.formEl || !interactiveConsoleState?.inputEl) {
    return defaultValue;
  }

  const promptText = String(message ?? '');
  const promptEntry = appendConsoleEntry('prompt', promptText || 'Input requested', {
    awaitingInput: true,
    badge: inputType === 'number' ? 'number' : 'input',
  });
  const promptValueEl = promptEntry.querySelector('.console-entry-value');
  const cursor = document.createElement('span');
  cursor.className = 'console-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  const promptSuffix = document.createElement('span');
  promptSuffix.className = 'console-prompt-suffix';
  const separator = promptText && !/\s$/.test(promptText) ? ' ' : '';
  promptSuffix.append(separator, cursor);
  promptValueEl.append(promptSuffix);

  interactiveConsoleState.formEl.classList.remove('hidden');
  interactiveConsoleState.formEl.dataset.inputType = inputType;
  interactiveConsoleState.inputEl.value = defaultValue == null ? '' : String(defaultValue);
  interactiveConsoleState.inputEl.placeholder = inputType === 'number'
    ? 'Enter a number'
    : 'Enter your response';
  interactiveConsoleState.inputEl.focus();
  interactiveConsoleState.inputEl.select();
  scrollConsoleToBottom();

  return new Promise((resolve, reject) => {
    const submitHandler = (event) => {
      event.preventDefault();
      const response = interactiveConsoleState.inputEl.value;
      promptEntry.classList.remove('is-awaiting-input');
      promptSuffix.replaceWith(document.createTextNode(`${separator}${response}`));
      interactiveConsoleState.formEl.classList.add('hidden');
      interactiveConsoleState.formEl.removeEventListener('submit', submitHandler);
      interactiveConsoleState.pendingRequest = null;
      resolve(response);
    };

    interactiveConsoleState.pendingRequest = {
      cleanup() {
        promptEntry.classList.remove('is-awaiting-input');
        promptSuffix.replaceWith(document.createTextNode(`${separator}${interactiveConsoleState.inputEl.value}`));
        interactiveConsoleState.formEl.classList.add('hidden');
      },
      cancel() {
        promptEntry.classList.remove('is-awaiting-input');
        promptSuffix.replaceWith(document.createTextNode(''));
        interactiveConsoleState.formEl.classList.add('hidden');
        interactiveConsoleState.formEl.removeEventListener('submit', submitHandler);
        interactiveConsoleState.pendingRequest = null;
        reject(new Error(INTERACTIVE_RUN_CANCELLED_ERROR));
      },
    };
    interactiveConsoleState.formEl.addEventListener('submit', submitHandler, { once: true });
  });
}

function appendConsoleEntry(type, text, { awaitingInput = false, badge } = {}) {
  if (!interactiveConsoleState?.transcriptEl) return null;

  interactiveConsoleState.hasEntries = true;

  const row = document.createElement('div');
  row.className = `console-entry console-entry-${type}`;
  if (awaitingInput) {
    row.classList.add('is-awaiting-input');
  }

  const entryBadge = document.createElement('span');
  entryBadge.className = 'console-entry-badge';
  entryBadge.textContent = badge || getConsoleBadge(type);

  const entryValue = document.createElement('span');
  entryValue.className = 'console-entry-value';
  entryValue.textContent = text == null || text === '' ? ' ' : String(text);

  row.append(entryBadge, entryValue);
  interactiveConsoleState.transcriptEl.appendChild(row);
  scrollConsoleToBottom();
  return row;
}

function finalizeInteractiveConsole(execution) {
  if (!interactiveConsoleState) {
    renderRunOutput(execution);
    return;
  }

  const { transcriptEl } = interactiveConsoleState;
  interactiveConsoleState.isRunning = false;

  if (interactiveConsoleState.pendingRequest) {
    interactiveConsoleState.pendingRequest.cleanup?.();
    interactiveConsoleState.pendingRequest = null;
  }

  transcriptEl?.querySelectorAll('.console-entry.is-awaiting-input').forEach((entry) => {
    entry.classList.remove('is-awaiting-input');
    entry.querySelector('.console-cursor')?.remove();
  });

  if (!interactiveConsoleState.hasEntries && execution.success) {
    appendConsoleEntry('status', 'Program finished with no output.', { badge: 'done' });
  }

  if (execution.cancelled) {
    appendConsoleEntry('status', 'Run cancelled.', { badge: 'done' });
  } else if (!execution.success) {
    appendConsoleEntry('error', execution.error || 'Unknown error', { badge: 'error' });
  } else {
    appendConsoleEntry('status', 'Program finished.', { badge: 'done' });
  }

  scrollConsoleToBottom();
}

function buildStaticRunOutputHtml(execution) {
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
  return html;
}

function getConsoleBadge(type) {
  switch (type) {
    case 'prompt':
      return 'in?';
    case 'input':
      return 'you';
    case 'error':
      return 'err';
    case 'status':
      return 'sys';
    case 'output':
    default:
      return 'out';
  }
}

function scrollConsoleToBottom() {
  if (!interactiveConsoleState?.transcriptEl) return;
  interactiveConsoleState.transcriptEl.scrollTop = interactiveConsoleState.transcriptEl.scrollHeight;
}

function setResultsModalClosable(closable) {
  isResultsModalCloseLocked = !closable;

  const closeButton = document.getElementById('btn-close-results-modal');
  const backdrop = document.getElementById('results-modal-backdrop');
  if (closeButton) {
    closeButton.disabled = !closable;
  }
  if (backdrop) {
    backdrop.disabled = !closable;
  }
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function buildCheckResultsHtml(results, totalScore, maxScore, hasBlockedTests = false) {
  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const allPassed = !hasBlockedTests && results.every((result) => result.passed);
  const allPassSubtitle = allPassed ? String(config?.evaluation?.feedback_on_all_pass || '').trim() : '';

  let html = '<div class="results-section">';
  html += `<div class="results-header ${allPassed ? 'results-pass' : 'results-fail'}">`;
  html += '<div class="results-title">';
  html += `<strong>${allPassed ? '✅ All automated checks passed!' : '❌ Some automated checks failed'}</strong>`;
  html += ` — Score: ${percent}%`;
  html += '</div>';
  if (allPassSubtitle) {
    html += `<div class="results-subtitle formatted-text">${renderInlineMarkdown(allPassSubtitle)}</div>`;
  }
  html += '</div>';
  html += '<ul class="results-list">';
  for (const result of results) {
    html += `<li class="${result.passed ? 'result-pass' : 'result-fail'} formatted-text">`;
    html += `<span class="result-icon">${result.passed ? '✓' : '✗'}</span> `;
    html += renderInlineMarkdown(result.feedback);
    if (result.student_detail) {
      html += renderStudentDetailHtml(result.student_detail);
    }
    html += '</li>';
  }
  if (hasBlockedTests) {
    html += '<li class="result-fail formatted-text"><span class="result-icon">…</span>Other tests remain unpassed.</li>';
  }
  html += '</ul></div>';
  return html;
}

function renderStudentDetailHtml(studentDetail) {
  if (typeof studentDetail === 'string') {
    return `<div class="result-detail-note formatted-text">${renderInlineMarkdown(studentDetail)}</div>`;
  }

  if (studentDetail && Array.isArray(studentDetail.sections)) {
    return studentDetail.sections.map((section) => `
      <div class="result-detail-section">
        <div class="result-detail-title">${escapeHtml(section.title || '')}</div>
        <pre class="result-detail-value">${escapeHtml(section.value || '')}</pre>
      </div>
    `).join('');
  }

  return '';
}

function areHintsEnabled(cfg) {
  return cfg.ui_settings?.show_hint_panel !== false;
}

function getLegacyHintDisplayMode(cfg) {
  return cfg.ui_settings?.hint_display_mode === 'checklist' ? 'checklist' : 'triggered';
}

function shouldRequirePreviousTestPass(cfg) {
  return cfg?.evaluation?.require_previous_test_pass !== false;
}

function updateHintRequestButtonState({ hasManualHints = false, canRequest = false } = {}) {
  const hintButton = document.getElementById('btn-request-hint');
  if (!hintButton) return;

  if (!areHintsEnabled(config) || !hasManualHints) {
    hintButton.style.display = 'none';
    hintButton.disabled = true;
    hintButton.removeAttribute('title');
    return;
  }

  hintButton.style.display = 'inline-flex';
  hintButton.disabled = !canRequest;
  hintButton.title = canRequest
    ? 'Request a hint.'
    : 'Hints are configured, but their conditions are not met yet.';
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
window.BlocklyScorm = { requestHint };

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
