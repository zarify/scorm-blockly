/**
 * SCORM 1.2 API Wrapper
 *
 * Locates the SCORM API in parent frames, provides methods for init, score
 * reporting, status setting, and termination. Falls back to no-op mode when
 * not running inside an LMS (e.g., preview/testing).
 */

let api = null;
let initialized = false;
let previewMode = false;

/**
 * Search for the SCORM API object in parent frames.
 * SCORM spec says search up to 7 parent levels + window.opener.
 */
function findAPI(win) {
  let attempts = 0;
  while (win && !win.API && attempts < 7) {
    if (win.parent === win) break;
    win = win.parent;
    attempts++;
  }
  if (win?.API) return win.API;

  // Try window.opener
  if (window.opener) {
    const openerAPI = findAPI(window.opener);
    if (openerAPI) return openerAPI;
  }

  return null;
}

/**
 * Initialize the SCORM session.
 * @returns {boolean} true if connected to LMS, false if in preview mode
 */
export function init() {
  api = findAPI(window);

  if (!api) {
    console.warn('[SCORM] No LMS API found — running in preview mode');
    previewMode = true;
    initialized = true;
    return false;
  }

  const result = api.LMSInitialize('');
  if (result === 'true' || result === true) {
    initialized = true;
    // Set initial status to incomplete
    api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
    api.LMSCommit('');
    return true;
  }

  console.error('[SCORM] LMSInitialize failed:', api.LMSGetLastError());
  previewMode = true;
  initialized = true;
  return false;
}

/**
 * Set the raw score (0–100).
 * @param {number} score
 */
export function setScore(score) {
  if (!initialized) return;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  if (previewMode) {
    console.log(`[SCORM Preview] Score: ${clamped}`);
    return;
  }

  api.LMSSetValue('cmi.core.score.raw', String(clamped));
  api.LMSSetValue('cmi.core.score.min', '0');
  api.LMSSetValue('cmi.core.score.max', '100');
  api.LMSCommit('');
}

/**
 * Set the lesson status.
 * @param {'passed'|'failed'|'completed'|'incomplete'} status
 */
export function setStatus(status) {
  if (!initialized) return;

  if (previewMode) {
    console.log(`[SCORM Preview] Status: ${status}`);
    return;
  }

  api.LMSSetValue('cmi.core.lesson_status', status);
  api.LMSCommit('');
}

/**
 * Persist a score and set status based on pass/fail threshold.
 * @param {number} score - 0-100
 * @param {number} passingScore - Minimum score to pass (default 50)
 */
export function reportScore(score, passingScore = 50) {
  setScore(score);
  setStatus(score >= passingScore ? 'passed' : 'failed');
}

/**
 * Save and end the SCORM session.
 */
export function terminate() {
  if (!initialized) return;

  if (previewMode) {
    console.log('[SCORM Preview] Session terminated');
    return;
  }

  api.LMSCommit('');
  api.LMSFinish('');
  initialized = false;
}

/**
 * Check if running in preview mode (no LMS).
 * @returns {boolean}
 */
export function isPreviewMode() {
  return previewMode;
}
