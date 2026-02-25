import { DEFAULT_STATE, DEFAULT_SETTINGS } from './constants.js';

// ── Runtime state (chrome.storage.local) ─────────────────────────────────────
// Always spread over DEFAULT_STATE first so missing keys fall back to defaults.
// This is critical on first install when storage is empty.

export async function getState() {
  const result = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  return { ...DEFAULT_STATE, ...result };
}

export async function setState(partial) {
  await chrome.storage.local.set(partial);
}

export async function resetState() {
  await chrome.storage.local.set({ ...DEFAULT_STATE });
}

// ── Settings (chrome.storage.sync) ───────────────────────────────────────────

export async function getSettings() {
  const result = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...result };
}

export async function saveSettings(partial) {
  await chrome.storage.sync.set(partial);
}

// ── Storage change listener helper ───────────────────────────────────────────
// Usage: onStorageChange((changes, area) => { ... })
export function onStorageChange(callback) {
  chrome.storage.onChanged.addListener(callback);
}
