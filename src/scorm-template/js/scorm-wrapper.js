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
    // Only claim the attempt while it has not started; re-entry must not wipe a
    // completed/passed status that the LMS is tracking for this student.
    const currentStatus = api.LMSGetValue('cmi.core.lesson_status');
    if (!currentStatus || currentStatus === 'not attempted' || currentStatus === 'browsed') {
      api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
      api.LMSCommit('');
    }
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
 * Check whether the SCORM session is live and can accept writes.
 * @returns {boolean}
 */
export function isSessionActive() {
  return initialized && !previewMode && Boolean(api);
}

/**
 * Read the LMS user id for the current student.
 * Used to scope browser-side storage to one student per device.
 * @returns {string}
 */
export function getStudentId() {
  if (!initialized || previewMode || !api) return '';

  const value = api.LMSGetValue('cmi.core.student_id');
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read the suspend data string saved by a previous session.
 * @returns {string} Empty string when nothing is stored or no LMS is connected
 */
export function getSuspendData() {
  if (!initialized || previewMode || !api) return '';

  const value = api.LMSGetValue('cmi.suspend_data');
  return typeof value === 'string' ? value : '';
}

/**
 * Store suspend data for the next session and commit it immediately.
 * @param {string} value
 * @returns {boolean} true when the LMS accepted the value
 */
export function setSuspendData(value) {
  if (!initialized || previewMode || !api) {
    console.log('[SCORM Preview] Suspend data not stored (no LMS)');
    return false;
  }

  const result = api.LMSSetValue('cmi.suspend_data', String(value));
  const accepted = result === 'true' || result === true;
  if (accepted) {
    api.LMSCommit('');
  } else {
    console.warn('[SCORM] LMS rejected suspend data:', api.LMSGetLastError());
  }
  return accepted;
}

/**
 * Discard stored suspend data so the next session starts clean.
 * @returns {boolean} true when the LMS accepted the empty value
 */
export function clearSuspendData() {
  if (!initialized || previewMode || !api) return false;

  const result = api.LMSSetValue('cmi.suspend_data', '');
  const accepted = result === 'true' || result === true;
  if (accepted) {
    api.LMSCommit('');
  }
  return accepted;
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
