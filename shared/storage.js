import { DEFAULT_STATE, DEFAULT_SETTINGS } from './constants.js';

// ── Runtime state (chrome.storage.local) ─────────────────────────────────────
// Always spread over DEFAULT_STATE so missing keys fall back to defaults —
// critical on first run when storage is empty.
//
// chrome.storage is the single source of truth for state. The service worker
// is the only writer of runtime keys; UI pages read on load and subscribe via
// chrome.storage.onChanged. Writers should batch every key of a transition
// into ONE setState() call so listeners see each transition atomically.

export async function getState() {
  const result = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  return { ...DEFAULT_STATE, ...result };
}

export async function setState(partial) {
  await chrome.storage.local.set(partial);
}

// ── Settings (chrome.storage.sync) ───────────────────────────────────────────

export async function getSettings() {
  const result = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...result };
}

export async function saveSettings(partial) {
  await chrome.storage.sync.set(partial);
}
